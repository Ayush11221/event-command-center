import { Accent, IsoScene } from "../components/common/Iso";
import { currentActor, type ActorState } from "../services/proof";
import { VerificationForm } from "./VerificationForm";
interface Props {
  onAccountAuthenticated: (actor: ActorState) => void;
  expired?: boolean;
}
export function ProofEntry({ onAccountAuthenticated, expired = false }: Props) {
  return (
    <main className="page-shell entry-layout">
      <div className="entry-intro">
        <p className="eyebrow">WELCOME TO YOUR NEXT EVENT</p>
        <h1>
          Sign in or create <Accent>an account</Accent>
        </h1>
        <p>Use your email to receive a verification code.</p>
        <p>
          New here? Verifying your email creates your account automatically. No
          password needed.
        </p>
        {expired && (
          <p role="alert">
            Your session has expired. Sign in again to continue.
          </p>
        )}
        <a className="participant-link" href="/events">
          Browse events
        </a>
        <IsoScene
          className="entry-scene"
          chips={["Live check-in", "QR entry pass", "Crowd forecast"]}
        />
      </div>
      <section className="entry-panel" aria-labelledby="proof-heading">
        <h2 id="proof-heading">Continue with email</h2>
        <VerificationForm
          mode="account"
          onVerified={async () => onAccountAuthenticated(await currentActor())}
        />
      </section>
    </main>
  );
}
