import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ManagementDetail } from "../services/events";
import { ProofError } from "../services/proof";
import {
  grantStaff,
  listStaff,
  lookupStaffAccount,
  revokeStaff,
  staffRoleLabels,
  type StaffAccount,
  type StaffAssignment,
  type StaffGrant,
  type StaffList,
  type StaffRole,
} from "../services/staff";
import { gateLabel } from "./gate-label";

interface Props {
  detail: ManagementDetail;
  csrf: string;
  onSessionExpired: () => void;
  onScopeLost: () => void;
  onLoaded?: (data: StaffList) => void;
  refreshToken?: number;
}
interface Operation {
  kind: "add" | "remove" | "change";
  assignment?: StaffAssignment;
  grant: StaffGrant;
  stage: "revoke" | "grant";
  ready?: boolean;
}
export function TeamPanel({
  detail,
  csrf,
  onSessionExpired,
  onScopeLost,
  onLoaded,
  refreshToken = 0,
}: Props) {
  const [data, setData] = useState<StaffList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [email, setEmail] = useState("");
  const [account, setAccount] = useState<StaffAccount | null>(null);
  const [role, setRole] = useState<StaffRole>("GATE_SECURITY");
  const [gateId, setGateId] = useState("");
  const [editing, setEditing] = useState<StaffAssignment | null>(null);
  const [removing, setRemoving] = useState<StaffAssignment | null>(null);
  const [pending, setPending] = useState<Operation | null>(null);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const dataGeneration = useRef(0);
  const { event_id: eventId, gates } = detail;

  useEffect(() => {
    if (lock.current) return;
    const abort = new AbortController();
    const generation = ++dataGeneration.current;
    void listStaff(eventId, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted && generation === dataGeneration.current) {
          setData(value);
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || generation !== dataGeneration.current)
          return;
        if (error instanceof ProofError && error.status === 401)
          onSessionExpired();
        else if (
          error instanceof ProofError &&
          [403, 404].includes(error.status)
        )
          onScopeLost();
        setLoading(false);
        setFeedback(
          "Team & Staff could not be loaded. You need staff-management access for this event.",
        );
      });
    return () => {
      abort.abort();
    };
  }, [eventId, refreshToken, onSessionExpired, onScopeLost]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (data) onLoaded?.(data);
  }, [data, onLoaded]);

  function begin(): AbortSignal | null {
    if (lock.current) return null;
    lock.current = true;
    dataGeneration.current += 1;
    setBusy(true);
    controller.current = new AbortController();
    return controller.current.signal;
  }
  function finish(signal: AbortSignal) {
    lock.current = false;
    if (!signal.aborted) setBusy(false);
  }
  function expired(error: unknown) {
    if (error instanceof ProofError && error.status === 401) {
      onSessionExpired();
      return true;
    }
    return false;
  }
  function resetForm() {
    setAccount(null);
    setEmail("");
    setEditing(null);
    setGateId("");
    setRemoving(null);
  }

  async function refresh() {
    const signal = begin();
    if (!signal) return;
    try {
      const current = await listStaff(eventId, signal);
      if (signal.aborted) return;
      setData(current);
      if (pending) {
        if (pending.stage === "grant") {
          const found = current.assignments.some(
            (row) =>
              row.userId === pending.grant.user_id &&
              row.role === pending.grant.role &&
              row.gateId === (pending.grant.gate_id ?? null),
          );
          if (found) {
            setPending(null);
            resetForm();
            setFeedback("Assignment confirmed. The team list is current.");
          } else
            setFeedback(
              "The assignment result is still unknown. Refresh again to confirm it before making another change.",
            );
        } else if (
          !current.assignments.some((row) => row.id === pending.assignment?.id)
        ) {
          if (pending.kind === "change") {
            setPending({ ...pending, stage: "grant", ready: true });
            setFeedback(
              "The previous assignment is removed. Continue to add the replacement assignment.",
            );
          } else {
            setPending(null);
            resetForm();
            setFeedback("Assignment removal confirmed.");
          }
        } else
          setFeedback(
            "Removal is not yet confirmed. Refresh again before making another change.",
          );
      } else setFeedback("Team list refreshed.");
    } catch (error) {
      if (signal.aborted || expired(error)) return;
      setData(null);
      if (error instanceof ProofError && [403, 404].includes(error.status))
        onScopeLost();
      setFeedback(
        "The current team list is unavailable. Refresh to check your access and assignment status.",
      );
    } finally {
      if (!signal.aborted) setLoading(false);
      finish(signal);
    }
  }
  async function lookup(event: FormEvent) {
    event.preventDefault();
    const signal = begin();
    if (!signal) return;
    setAccount(null);
    setFeedback("");
    try {
      const found = await lookupStaffAccount(
        eventId,
        email.trim(),
        csrf,
        signal,
      );
      if (!signal.aborted) {
        setAccount(found);
        setFeedback(
          found
            ? "Verified account found. Choose their role and gate below."
            : "No verified account was found for this email. Ask the person to create and verify their account first.",
        );
      }
    } catch (error) {
      if (!signal.aborted && !expired(error))
        setFeedback(
          error instanceof ProofError && error.code === "SELF_ASSIGNMENT"
            ? "You cannot assign yourself to this event."
            : error instanceof ProofError && error.status === 403
              ? "You do not have permission to look up staff for this event."
              : "We could not find the account. Check the email and your connection, then try again.",
        );
    } finally {
      finish(signal);
    }
  }
  async function execute(operation: Operation) {
    const signal = begin();
    if (!signal) return;
    let current = { ...operation, ready: false };
    setPending(current);
    setFeedback("");
    try {
      if (current.stage === "revoke") {
        await revokeStaff(eventId, current.assignment!.id, csrf, signal);
        if (signal.aborted) return;
        if (current.kind === "change") {
          current = { ...current, stage: "grant" };
          setPending(current);
        }
      }
      if (current.stage === "grant")
        await grantStaff(eventId, current.grant, csrf, signal);
      if (signal.aborted) return;
      setPending(null);
      resetForm();
      setFeedback(
        current.kind === "remove"
          ? "Assignment removed."
          : "Team assignment saved.",
      );
      // The write is confirmed even if the subsequent read fails; never re-send it.
      setData(null);
      try {
        const value = await listStaff(eventId, signal);
        if (!signal.aborted) setData(value);
      } catch (error) {
        if (!signal.aborted && !expired(error))
          setFeedback(
            "The change is confirmed, but the team list could not be refreshed. Refresh the team list.",
          );
      }
    } catch (error) {
      if (signal.aborted || expired(error)) return;
      if (
        !(error instanceof ProofError) ||
        error.status === 0 ||
        error.status >= 500
      ) {
        setPending(current);
        setFeedback(
          "We could not confirm this change. Refresh the team list to recover its result before making another change.",
        );
      } else {
        setPending(null);
        setData(null);
        setFeedback(
          (current.kind === "change" && current.stage === "grant"
            ? "The previous assignment was removed, but its replacement was not added. "
            : "") +
            (error.status === 403
              ? "You do not have permission to make this assignment change."
              : error.code === "AUTH_RENEWED_RETRY_REQUIRED"
                ? "Your sign-in was renewed. Refresh the team list, then review and retry the change."
                : error.status === 409
                  ? "This assignment already exists or has changed. Refresh the team list."
                  : error.status === 404
                    ? "The account or assignment is no longer available. Refresh the team list."
                    : "The assignment was not accepted. Choose a verified account and a configured gate, then refresh the team list."),
        );
      }
    } finally {
      finish(signal);
    }
  }
  const disabled = busy || !!pending || !data;
  const valid =
    !!account &&
    !!data?.allowed_roles.includes(role) &&
    (role !== "GATE_SECURITY" || gates.some((gate) => gate.gate_id === gateId));
  const unchanged =
    editing &&
    editing.role === role &&
    editing.gateId === (role === "GATE_SECURITY" ? gateId : null);
  function save(event: FormEvent) {
    event.preventDefault();
    if (disabled || !valid || unchanged) return;
    void execute({
      kind: editing ? "change" : "add",
      assignment: editing ?? undefined,
      grant: {
        user_id: account!.user_id,
        role,
        ...(role === "GATE_SECURITY" ? { gate_id: gateId } : {}),
      },
      stage: editing ? "revoke" : "grant",
    });
  }
  return (
    <section
      className="team-panel"
      aria-labelledby="team-heading"
      aria-busy={busy}
    >
      <div className="page-heading">
        <h3 id="team-heading">Team &amp; Staff</h3>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh team list
        </button>
      </div>
      <p>
        Add existing verified accounts to this event. Staff access is checked by
        the server.
      </p>
      {data && !data.allowed_roles.includes("EVENT_ADMIN") && (
        <p>
          Event Admins can manage Gate / Security and Volunteers. Only the
          Organizer can manage Event Admin assignments.
        </p>
      )}
      {loading && <p role="status">Loading team assignments…</p>}
      {feedback && (
        <p className="notice" role="status">
          {feedback}
        </p>
      )}
      {data &&
        (data.assignments.length ? (
          <ul className="team-list">
            {data.assignments.map((row) => (
              <li key={row.id}>
                <div
                  className="person-row"
                  data-initial={(row.email ?? "V").slice(0, 1).toUpperCase()}
                >
                  <strong>{row.email ?? "Verified account"}</strong>
                  <p>Role: {staffRoleLabels[row.role]}</p>
                  {row.gateId && <p>Gate: {gateLabel(gates, row.gateId)}</p>}
                  <span className="status-badge">
                    {pending
                      ? "Last confirmed assignment"
                      : "Active assignment"}
                  </span>
                </div>
                {data.allowed_roles.includes(row.role) && (
                  <div className="team-actions">
                    <button
                      aria-label={`Change assignment for ${row.email ?? "verified account"}`}
                      type="button"
                      className="secondary-button"
                      disabled={disabled}
                      onClick={() => {
                        setEditing(row);
                        setAccount({
                          user_id: row.userId,
                          email: row.email ?? "Verified account",
                        });
                        setRole(row.role);
                        setGateId(row.gateId ?? "");
                        setFeedback("");
                      }}
                    >
                      Change assignment
                    </button>
                    <button
                      aria-label={`Remove assignment for ${row.email ?? "verified account"}`}
                      type="button"
                      className="secondary-button"
                      disabled={disabled}
                      onClick={() => {
                        setRemoving(row);
                      }}
                    >
                      Remove assignment
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>No team members assigned yet. Add a verified account below.</p>
        ))}
      {removing && !pending && (
        <div
          className="notice"
          role="group"
          aria-label="Confirm assignment removal"
        >
          <p>
            Remove {staffRoleLabels[removing.role]} access for{" "}
            {removing.email ?? "this verified account"}? Their access will end
            immediately. Volunteer tasks bound to this assignment do not
            transfer if the role is added again.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setEditing(null);
              void execute({
                kind: "remove",
                assignment: removing,
                grant: { user_id: removing.userId, role: removing.role },
                stage: "revoke",
              });
            }}
          >
            Confirm removal
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => setRemoving(null)}
          >
            Keep assignment
          </button>
        </div>
      )}
      {pending?.ready && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void execute(pending)}
        >
          Continue assignment change
        </button>
      )}
      <h4>{editing ? "Change team assignment" : "Add team member"}</h4>
      {!editing && (
        <form className="team-form" onSubmit={(event) => void lookup(event)}>
          <label htmlFor="staff-email">Verified email</label>
          <input
            id="staff-email"
            type="email"
            required
            maxLength={254}
            autoComplete="off"
            value={email}
            disabled={disabled}
            onChange={(event) => {
              setEmail(event.target.value);
              setAccount(null);
            }}
          />
          <button type="submit" disabled={disabled || !email.trim()}>
            Find verified account
          </button>
        </form>
      )}
      {account && (
        <form className="team-form" onSubmit={save}>
          <p>
            <strong>{account.email}</strong>
          </p>
          {editing && (
            <p>
              Changing the role or gate removes the previous assignment before
              adding its replacement. Existing volunteer tasks do not transfer
              to a new role assignment.
            </p>
          )}
          <label htmlFor="staff-role">Role</label>
          <select
            id="staff-role"
            value={role}
            disabled={disabled}
            onChange={(event) => setRole(event.target.value as StaffRole)}
          >
            {data?.allowed_roles.map((value) => (
              <option key={value} value={value}>
                {staffRoleLabels[value]}
              </option>
            ))}
          </select>
          {role === "GATE_SECURITY" && (
            <>
              <label htmlFor="staff-gate">Gate</label>
              <select
                id="staff-gate"
                value={gateId}
                required
                disabled={disabled}
                onChange={(event) => setGateId(event.target.value)}
              >
                <option value="">Choose a configured gate</option>
                {[...gates]
                  .sort((a, b) => a.gate_id.localeCompare(b.gate_id))
                  .map((gate) => (
                    <option key={gate.gate_id} value={gate.gate_id}>
                      {gateLabel(gates, gate.gate_id)}
                    </option>
                  ))}
              </select>
              {!gates.length && (
                <p>
                  Create an event gate above before assigning Gate / Security
                  staff.
                </p>
              )}
            </>
          )}
          <button type="submit" disabled={disabled || !valid || !!unchanged}>
            {editing ? "Save assignment change" : "Add team member"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !!pending}
            onClick={resetForm}
          >
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}
