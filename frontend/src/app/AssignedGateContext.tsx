import { useEffect, useState } from "react";
import type { ActorState } from "../services/proof";
import { scannerScope, type ScannerScope } from "../services/scanning";

// Display names come from the authorized scope read, never from IDs or memory.
export function AssignedGateContext({
  assignments,
}: {
  assignments: ActorState["assignments"];
}) {
  const [attempt, setAttempt] = useState(0);
  const [scopes, setScopes] = useState<(ScannerScope | null)[] | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setScopes(null);
    void Promise.all(
      assignments
        .filter(
          (assignment) =>
            assignment.role === "GATE_SECURITY" && assignment.gate_id,
        )
        .map((assignment) =>
          scannerScope(
            assignment.event_id,
            assignment.gate_id!,
            abort.signal,
          ).catch(() => null),
        ),
    ).then((values) => {
      if (!abort.signal.aborted) setScopes(values);
    });
    return () => abort.abort();
  }, [assignments, attempt]);
  return (
    <div className="active-context assigned-gate-context">
      <p>Role: Gate / Security</p>
      {scopes === null ? (
        <p role="status">Checking assigned event and gate…</p>
      ) : (
        scopes.map((scope, index) => (
          <p key={index}>
            {scope ? (
              <>
                Event: {scope.event_name} · Gate: {scope.gate_label}
              </>
            ) : (
              "Assigned event and gate could not be confirmed."
            )}
          </p>
        ))
      )}
      {scopes?.some((scope) => !scope) && (
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry assigned gate information
        </button>
      )}
    </div>
  );
}
