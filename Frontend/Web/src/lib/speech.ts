/**
 * The browser's own speech recogniser, under either of the names it ships
 * with — one copy for voice search and the shop assistant's microphone.
 *
 * NetLet receives only the words. In Chrome and Edge the browser sends the
 * sound to Google or Microsoft to get them, which is why every place that
 * listens says so (`search.voicePrivacy`).
 */
export type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export function recogniser(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** Whether this browser can listen at all, so a microphone is never a button that only apologises. */
export const canListen = (): boolean => recogniser() !== null;
