import { useState } from "react";

export function EntryCode({ code }: { code?: string }) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  if (!code || !/^qr1\.[A-Za-z0-9_-]{43}$/.test(code))
    return <p>Text entry code unavailable. Use your entry QR.</p>;
  return (
    <section className="certificate-panel" aria-label="Manual entry code">
      <button
        type="button"
        aria-expanded={visible}
        onClick={() => {
          setVisible(!visible);
          setMessage("");
        }}
      >
        {visible ? "Hide entry code" : "Show entry code"}
      </button>
      {visible && (
        <>
          <p>
            This is the same credential as your entry QR. Keep it private. Gate
            staff can paste it into Manual entry if the camera cannot scan.
          </p>
          <label>
            Entry code
            <input
              value={code}
              readOnly
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code);
                setMessage("Entry code copied.");
              } catch {
                setMessage("Select the entry code above and copy it manually.");
              }
            }}
          >
            Copy entry code
          </button>
          {message && <p role="status">{message}</p>}
        </>
      )}
    </section>
  );
}
