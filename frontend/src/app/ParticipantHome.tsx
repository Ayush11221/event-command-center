import { Accent } from "../components/common/Iso";
// Sign out lives in the header Settings menu.
export function ParticipantHome() {
  return (
    <main className="page-shell participant-home">
      <p className="eyebrow">YOU'RE SIGNED IN</p>
      <h1>
        Find your next <Accent>event</Accent>
      </h1>
      <p>
        Your account is ready. Browse events, register, and show your entry QR
        when you arrive.
      </p>
      <a className="participant-link" href="/events">
        Browse events
      </a>
      <h2>Already registered?</h2>
      <p>
        Open your event and choose View my registration to find your entry QR.
        You can also use a saved registration link.
      </p>
    </main>
  );
}
