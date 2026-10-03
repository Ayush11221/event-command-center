import { useEffect, useState, type ReactNode } from "react";
import { currentActor, ProofError, type ActorState } from "../services/proof";
import { reviewMessage } from "../services/event-review";
import { ProofEntry } from "./ProofEntry";
export function ReviewEntry({
  title,
  children,
}: {
  title: string;
  children: (actor: ActorState, fail: (error: unknown) => void) => ReactNode;
}) {
  const [actor, setActor] = useState<ActorState | null>(null),
    [message, setMessage] = useState(""),
    [verify, setVerify] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setActor(null);
    setMessage("");
    void currentActor()
      .then((a) => {
        if (current) {
          setActor(a);
          setVerify(false);
        }
      })
      .catch((e) => {
        if (current) {
          setMessage(reviewMessage(e));
          setVerify(e instanceof ProofError && e.status === 401);
        }
      });
    return () => {
      current = false;
    };
  }, [attempt]);
  function fail(e: unknown) {
    if (e instanceof ProofError && [401, 403, 404].includes(e.status)) {
      setActor(null);
      setMessage(reviewMessage(e));
      setVerify(e.status === 401);
    }
  }
  return (
    <main className="page-shell public-page review-page">
      <h1>{title}</h1>
      {actor ? (
        children(actor, fail)
      ) : (
        <>
          {message ? (
            <p role="alert">{message}</p>
          ) : (
            <p role="status">Checking your session…</p>
          )}
          {verify ? (
            <ProofEntry
              onAccountAuthenticated={() => setAttempt((a) => a + 1)}
            />
          ) : message ? (
            <button onClick={() => setAttempt((a) => a + 1)}>
              Retry access
            </button>
          ) : null}
        </>
      )}
    </main>
  );
}
