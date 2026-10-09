// Non-visual scan feedback for noisy gates. Purely presentational: it runs
// only after a server decision has been rendered and never affects entry.
export type FeedbackOutcome = "accepted" | "duplicate" | "rejected" | "unknown";

const SOUND_KEY = "eoc.scanner.sound.v1";

export function storedSoundPreference(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

export function rememberSoundPreference(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // A storage failure only loses the convenience preference.
  }
}

const tones: Record<FeedbackOutcome, [number, number][]> = {
  // [frequency Hz, duration ms] — rising for accepted, flat pair for
  // duplicate, low falling for rejected / unknown.
  accepted: [
    [880, 90],
    [1320, 130],
  ],
  duplicate: [
    [660, 110],
    [660, 110],
  ],
  rejected: [
    [330, 160],
    [220, 220],
  ],
  unknown: [[300, 300]],
};

const vibration: Record<FeedbackOutcome, number[]> = {
  accepted: [60],
  duplicate: [60, 80, 60],
  rejected: [200, 80, 200],
  unknown: [300],
};

let audio: AudioContext | null = null;

export function playScanFeedback(outcome: FeedbackOutcome, sound: boolean) {
  try {
    navigator.vibrate?.(vibration[outcome]);
  } catch {
    // Vibration is optional.
  }
  if (!sound) return;
  const Context =
    typeof window !== "undefined"
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext)
      : undefined;
  if (!Context) return;
  try {
    audio ??= new Context();
    let at = audio.currentTime;
    for (const [frequency, ms] of tones[outcome]) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + ms / 1000 + 0.02);
      at += ms / 1000 + 0.04;
    }
  } catch {
    // Audio is optional; the visual result remains authoritative.
  }
}
