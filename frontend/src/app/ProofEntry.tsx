import { Accent, IsoScene } from "../components/common/Iso";
import { currentActor, type ActorState } from "../services/proof";
import { VerificationForm } from "./VerificationForm";
import { useState } from "react";
import { AccountProfileForm } from "./AccountProfileForm";
interface Props {
  onAccountAuthenticated: (actor: ActorState) => void;
  expired?: boolean;
}
export function ProofEntry({ onAccountAuthenticated, expired = false }: Props) {
  const [verified, setVerified] = useState<ActorState | null>(null);
  return (
    <main className="page-shell entry-layout">
      <div className="entry-intro">
        <p className="eyebrow">WELCOME TO YOUR NEXT EVENT</p>
        <h1>
          {verified ? (
            <>
              Complete <Accent>your details</Accent>
            </>
          ) : (
            <>
              Sign in or create <Accent>an account</Accent>
            </>
          )}
        </h1>
        <p>
          {verified
            ? "Your email is verified. Add your details to continue."
            : "Use your email to receive a verification code."}
        </p>
        {!verified && (
          <p>
            New here? Verifying your email creates your account automatically.
            No password needed.
          </p>
        )}
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
      <section
        className={verified ? undefined : "entry-panel"}
        aria-labelledby={verified ? undefined : "proof-heading"}
      >
        {!verified && <h2 id="proof-heading">Continue with email</h2>}
        {verified ? (
          <AccountProfileForm
            actor={verified}
            onComplete={onAccountAuthenticated}
          />
        ) : (
          <VerificationForm
            mode="account"
            onVerified={async () => setVerified(await currentActor())}
          />
        )}
      </section>
    </main>
  );
}
