import { useEffect, useRef, useState } from "react";

type Phase = "idle" | "requesting" | "running" | "stopped" | "error";
const cameraError = (error: unknown) => {
  const name =
    error && typeof error === "object" && "name" in error ? error.name : "";
  return name === "NotAllowedError" || name === "SecurityError"
    ? "Camera access was blocked. Allow camera access in your browser settings or use manual entry."
    : name === "NotFoundError"
      ? "No camera is available on this device. Use manual entry or a device with a camera."
      : "Camera couldn't be started. Try again or use manual entry.";
};

// Capture and decode only. Authorization and scan decisions belong to the
// existing scanner/server path. No frames or decoded values are persisted.
export function CameraCapture({
  onDetect,
  blocked,
  onManualEntry,
}: {
  onDetect: (value: string) => void;
  blocked: boolean;
  onManualEntry?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const detachTracks = useRef<() => void>(() => {});
  const latest = useRef({ onDetect, blocked });
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("Camera inactive.");
  useEffect(() => {
    latest.current = { onDetect, blocked };
  }, [onDetect, blocked]);

  function release() {
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    detachTracks.current();
    detachTracks.current = () => {};
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }
  useEffect(() => {
    const hide = () => {
      release();
      setPhase("stopped");
      setMessage("Camera stopped. Start it when you are ready to scan.");
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") hide();
      else if (
        stream.current &&
        (stream.current
          .getVideoTracks()
          .some((track) => track.readyState === "ended" || track.muted) ||
          video.current?.paused)
      )
        hide();
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      release();
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  async function start() {
    release();
    const current = generation.current;
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setPhase("error");
      setMessage(
        "Camera access needs a secure browser connection and camera support. Use manual entry below.",
      );
      return;
    }
    setPhase("requesting");
    setMessage("Starting camera… Allow camera access when your browser asks.");
    try {
      // Load the QR-only reader only when camera scanning is requested.
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (generation.current !== current) return;
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      if (generation.current !== current) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = acquired;
      if (
        !acquired.getVideoTracks().length ||
        acquired.getVideoTracks().some((track) => track.readyState === "ended")
      )
        throw new Error("Camera inactive");
      const preview = video.current!;
      preview.srcObject = acquired;
      await preview.play();
      if (generation.current !== current) return;
      if (
        acquired
          .getVideoTracks()
          .some((track) => track.readyState === "ended" || track.muted)
      )
        throw new Error("Camera interrupted while starting");
      const reader = new BrowserQRCodeReader();
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Camera view unavailable");
      setPhase("running");
      setMessage("Camera ready.");
      const interrupted = () => {
        if (generation.current !== current) return;
        release();
        setPhase("stopped");
        setMessage(
          "Camera stopped or disconnected. Start it again or use manual entry.",
        );
      };
      const tracks = acquired.getVideoTracks();
      tracks.forEach((track) => {
        track.addEventListener("ended", interrupted);
        track.addEventListener("mute", interrupted);
      });
      detachTracks.current = () =>
        tracks.forEach((track) => {
          track.removeEventListener("ended", interrupted);
          track.removeEventListener("mute", interrupted);
        });
      let lastValue = "",
        lastSeen = 0;
      const frame = () => {
        if (generation.current !== current) return;
        if (
          preview.readyState >= 2 &&
          preview.videoWidth &&
          preview.videoHeight
        ) {
          const scale = Math.min(
            1,
            720 / Math.max(preview.videoWidth, preview.videoHeight),
          );
          canvas.width = Math.round(preview.videoWidth * scale);
          canvas.height = Math.round(preview.videoHeight * scale);
          context.drawImage(preview, 0, 0, canvas.width, canvas.height);
          let decoded: string | null = null;
          try {
            decoded = reader.decodeFromCanvas(canvas).getText();
          } catch {
            /* No readable QR in this frame. */
          }
          const now = performance.now();
          if (decoded) {
            // Keep a stationary QR suppressed for as long as it remains in
            // view. It must leave the view for 1.2s before a fresh attempt.
            if (
              !latest.current.blocked &&
              (decoded !== lastValue || now - lastSeen >= 1200)
            ) {
              lastValue = decoded;
              latest.current.onDetect(decoded);
            }
            if (decoded === lastValue) lastSeen = now;
          }
        }
        timer.current = setTimeout(frame, 250);
      };
      frame();
    } catch (error) {
      if (generation.current !== current) return;
      release();
      setPhase("error");
      setMessage(cameraError(error));
    }
  }
  return (
    <section className="camera-capture" aria-labelledby="camera-heading">
      <h2 id="camera-heading">Scan entry QR</h2>
      <p role={phase === "error" ? "alert" : "status"}>
        {blocked && phase === "running"
          ? "Scanning paused while this entry decision is being confirmed. Hold entry."
          : message}
      </p>
      {phase === "running" && !blocked && (
        <p>Point the camera at the entry QR code.</p>
      )}
      <div className="camera-actions">
        {phase === "running" || phase === "requesting" ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              release();
              setPhase("stopped");
              setMessage(
                "Camera stopped. Start it when you are ready to scan.",
              );
            }}
          >
            Stop camera
          </button>
        ) : (
          <button type="button" disabled={blocked} onClick={() => void start()}>
            {phase === "error" ? "Try camera again" : "Start camera"}
          </button>
        )}
        {phase === "error" && onManualEntry && (
          <button
            type="button"
            className="secondary-button"
            onClick={onManualEntry}
          >
            Use manual entry
          </button>
        )}
      </div>
      <div className="camera-viewport">
        <video ref={video} muted playsInline aria-label="Camera QR view" />
      </div>
    </section>
  );
}
