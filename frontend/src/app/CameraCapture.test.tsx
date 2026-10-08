import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraCapture } from "./CameraCapture";

const decode = vi.hoisted(() => vi.fn());
vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    decodeFromCanvas = decode;
  },
}));
const stop = vi.fn(),
  drawImage = vi.fn();
const track = { stop, addEventListener: vi.fn(), removeEventListener: vi.fn() };
const stream = {
  getTracks: () => [track],
  getVideoTracks: () => [track],
} as unknown as MediaStream;
let getUserMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(2);
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(
    640,
  );
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(
    480,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  decode.mockImplementation(() => {
    throw new Error("No QR");
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function start() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
  });
}
describe("camera capture boundary", () => {
  it("waits for preview startup before treating initial track mute as a failure", async () => {
    const startupTrack = { ...track, readyState: "live", muted: true };
    getUserMedia.mockResolvedValue({
      getTracks: () => [startupTrack],
      getVideoTracks: () => [startupTrack],
    });
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(async () => {
      startupTrack.muted = false;
    });
    render(<CameraCapture onDetect={vi.fn()} blocked={false} />);
    await start();
    expect(screen.getByRole("status")).toHaveTextContent("Camera ready");
  });
  it("does not claim readiness if the camera ends while its preview is starting", async () => {
    const startupTrack = { ...track, readyState: "live", muted: false };
    getUserMedia.mockResolvedValue({
      getTracks: () => [startupTrack],
      getVideoTracks: () => [startupTrack],
    });
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(async () => {
      startupTrack.readyState = "ended";
    });
    render(<CameraCapture onDetect={vi.fn()} blocked={false} />);
    await start();
    expect(screen.getByRole("alert")).toHaveTextContent("couldn't be started");
    expect(screen.queryByText("Camera ready.")).toBeNull();
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it("announces initial, permission, active and stopped states without automatic restart", async () => {
    let resolve!: (value: MediaStream) => void;
    getUserMedia.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<CameraCapture onDetect={vi.fn()} blocked={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Camera inactive");
    await start();
    expect(screen.getByRole("status")).toHaveTextContent("Starting camera");
    await act(async () => resolve(stream));
    expect(screen.getByRole("status")).toHaveTextContent("Camera ready");
    expect(
      screen.getByText("Point the camera at the entry QR code."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    expect(screen.getByRole("status")).toHaveTextContent("Camera stopped");
    fireEvent(document, new Event("visibilitychange"));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
  it("offers a deliberate camera retry and manual fallback after a safe failure", async () => {
    getUserMedia.mockRejectedValueOnce(
      new DOMException("private", "NotAllowedError"),
    );
    const manual = vi.fn();
    render(
      <CameraCapture
        onDetect={vi.fn()}
        blocked={false}
        onManualEntry={manual}
      />,
    );
    await start();
    fireEvent.click(screen.getByRole("button", { name: "Use manual entry" }));
    expect(manual).toHaveBeenCalledOnce();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try camera again" }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Camera ready");
  });
  it("detects camera suspension and detaches track handlers before restarting", async () => {
    render(<CameraCapture onDetect={vi.fn()} blocked={false} />);
    await start();
    const mute = track.addEventListener.mock.calls.find(
      ([name]) => name === "mute",
    )![1];
    act(() => mute());
    expect(screen.getByRole("status")).toHaveTextContent("Camera stopped");
    expect(track.removeEventListener).toHaveBeenCalledWith("mute", mute);
    expect(stop).toHaveBeenCalledTimes(1);
    await start();
    expect(screen.getByRole("status")).toHaveTextContent("Camera ready");
  });
  it("requests permission only after start, prefers rear camera and stops every track", async () => {
    const view = render(<CameraCapture onDetect={vi.fn()} blocked={false} />);
    expect(getUserMedia).not.toHaveBeenCalled();
    await start();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
    expect(screen.getByLabelText("Camera QR view")).toHaveAttribute(
      "playsinline",
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Camera QR view")).toHaveProperty(
      "srcObject",
      null,
    );
    await start();
    view.unmount();
    expect(stop).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["NotAllowedError", "Camera access was blocked"],
    ["NotFoundError", "No camera"],
    ["NotReadableError", "couldn't be started"],
  ])("explains %s with manual fallback", async (name, message) => {
    getUserMedia.mockRejectedValue(
      new DOMException("private browser detail", name),
    );
    render(<CameraCapture onDetect={vi.fn()} blocked={false} />);
    await start();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("alert")).toHaveTextContent("manual entry");
    expect(
      screen.queryByText(/private browser detail/),
    ).not.toBeInTheDocument();
  });
  it("supports browsers without camera APIs or a secure context", async () => {
    vi.stubGlobal("isSecureContext", false);
    render(<CameraCapture onDetect={vi.fn()} blocked={false} />);
    await start();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "secure browser connection",
    );
  });
  it("decodes locally, suppresses a stationary QR beyond cooldown and accepts the next QR", async () => {
    const detected = vi.fn();
    decode.mockReturnValue({ getText: () => "opaque-first" });
    render(<CameraCapture onDetect={detected} blocked={false} />);
    await start();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(detected).toHaveBeenCalledTimes(1);
    expect(detected).toHaveBeenCalledWith("opaque-first");
    decode.mockReturnValue({ getText: () => "opaque-next" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(detected).toHaveBeenCalledTimes(2);
    expect(detected).toHaveBeenLastCalledWith("opaque-next");
    expect(drawImage).toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("opaque-");
    expect(
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ).not.toContain("opaque-");
  });
  it("allows the same QR only after it leaves the view long enough", async () => {
    const detected = vi.fn();
    decode.mockReturnValue({ getText: () => "opaque" });
    render(<CameraCapture onDetect={detected} blocked={false} />);
    await start();
    decode.mockImplementation(() => {
      throw new Error("No QR");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    decode.mockReturnValue({ getText: () => "opaque" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(detected).toHaveBeenCalledTimes(2);
  });
  it("holds detections during an unknown scan and gives readable non-QR guidance", async () => {
    const detected = vi.fn();
    const view = render(<CameraCapture onDetect={detected} blocked={false} />);
    await start();
    expect(screen.getByText(/Point the camera/)).toBeVisible();
    view.rerender(<CameraCapture onDetect={detected} blocked />);
    decode.mockReturnValue({ getText: () => "opaque" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(detected).not.toHaveBeenCalled();
    expect(screen.getByText(/Scanning paused/)).toBeVisible();
  });
  it("stops late permission grants after unmount or stop during the permission prompt", async () => {
    let resolve!: (value: MediaStream) => void;
    getUserMedia.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<CameraCapture onDetect={vi.fn()} blocked={false} />);
    await start();
    view.unmount();
    await act(async () => {
      resolve(stream);
    });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(decode).not.toHaveBeenCalled();
  });
  it("cancels an open permission prompt and stops its late stream without claiming readiness", async () => {
    let resolve!: (value: MediaStream) => void;
    getUserMedia.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<CameraCapture onDetect={vi.fn()} blocked={false} />);
    await start();
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    await act(async () => resolve(stream));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Camera stopped");
    expect(screen.queryByText("Camera ready.")).toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });
  it("stops on pagehide and handles a disconnected camera", async () => {
    render(<CameraCapture onDetect={vi.fn()} blocked={false} />);
    await start();
    const ended = track.addEventListener.mock.calls[0][1];
    act(() => ended());
    expect(screen.getByRole("status")).toHaveTextContent("disconnected");
    await start();
    fireEvent(window, new Event("pagehide"));
    expect(stop).toHaveBeenCalledTimes(2);
  });
  it("releases the camera when the page is hidden", async () => {
    render(<CameraCapture onDetect={vi.fn()} blocked={false} />);
    await start();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Start camera" })).toBeVisible();
  });
});
