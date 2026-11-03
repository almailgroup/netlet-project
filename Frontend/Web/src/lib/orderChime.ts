/**
 * The sound an order makes when it is placed — on the owner's word ("for the
 * order confirmation, add a sound and animation"). The same file as the app's
 * (`order-placed.wav`): a soft thump as the circle springs in, a rising bell
 * arpeggio as the tick draws, and an E major chord that rings out, the key the
 * app's launch chime ends on. About two seconds, 23 KB.
 *
 * **It is unlocked on the press and played on the answer.** Safari plays a
 * sound only from inside a press, and the order is placed a round trip after
 * Confirm was pressed, by which time the press is over. So `primeOrderChime`
 * runs in Confirm's handler — it makes the `AudioContext` there and resumes
 * it, which keeps it allowed to play, and starts fetching the file — and
 * `playOrderChime` plays it once the server has said yes. A browser with no
 * Web Audio, a file that does not load and a context the browser refuses are
 * each a quiet order rather than a failed one: nothing here may throw.
 */
import chimeUrl from "@/assets/sounds/order-placed.mp3";

let context: AudioContext | null = null;
let decoded: Promise<AudioBuffer | null> | null = null;

/** In Confirm's own handler: wake the sound so it may play after the answer. */
export function primeOrderChime(): void {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    context ??= new Context();
    void context.resume().catch(() => {});
    decoded ??= fetch(chimeUrl)
      .then(response => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
      .then(bytes => new Promise<AudioBuffer>((resolve, reject) => context!.decodeAudioData(bytes, resolve, reject)))
      .catch(() => null);
  } catch {
    context = null;
  }
}

/** Once the order exists. Silent when the tab is hidden or nothing was primed. */
export async function playOrderChime(): Promise<void> {
  try {
    if (!context || !decoded || document.visibilityState === "hidden") return;
    const buffer = await decoded;
    if (!buffer) return;
    if (context.state === "suspended") await context.resume();
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = 0.8;
    source.buffer = buffer;
    source.connect(gain).connect(context.destination);
    source.start();
  } catch {
    /* A sound that will not play is an order placed quietly. */
  }
}
