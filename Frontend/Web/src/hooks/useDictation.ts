/**
 * Speaking into a text box: the browser's recogniser, in the page's language,
 * writing what it hears into the box as it hears it.
 *
 * **What was heard is put in the box, never sent.** Recognition mishears, and
 * the box is where somebody reads it back and fixes a word before pressing
 * Send — voice search's rule that what was heard is shown before anything is
 * done with it.
 *
 * It listens once (`continuous: false`): the recogniser stops on a pause, and
 * pressing the microphone again while it listens stops it there. A refusal is
 * a state the caller draws — the microphone blocked, or nothing heard —
 * rather than a button that silently does nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { recogniser, type Recognition } from "@/lib/speech";

export type DictationProblem = "denied" | "nothing" | "unsupported";

export function useDictation({ arabic, onHeard }: {
  arabic: boolean;
  /** Called with everything heard so far, each time more arrives. */
  onHeard: (text: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<DictationProblem | null>(null);
  const live = useRef<Recognition | null>(null);
  const heard = useRef(onHeard);
  heard.current = onHeard;

  const end = useCallback(() => {
    const recognition = live.current;
    live.current = null;
    if (recognition) {
      recognition.onresult = recognition.onerror = recognition.onend = null;
      recognition.abort();
    }
    setListening(false);
  }, []);

  /* Leaving the page, or the panel, stops the microphone. */
  useEffect(() => end, [end]);

  const start = useCallback(() => {
    const Recogniser = recogniser();
    if (!Recogniser) { setProblem("unsupported"); return; }
    end();
    setProblem(null);
    const recognition = new Recogniser();
    recognition.lang = arabic ? "ar-KW" : "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    let final = "";
    let any = false;
    recognition.onresult = event => {
      let partial = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) final += result[0].transcript;
        else partial += result[0].transcript;
      }
      const text = `${final}${partial}`.trim();
      if (text) { any = true; heard.current(text); }
    };
    recognition.onerror = event => {
      setProblem(event.error === "not-allowed" || event.error === "service-not-allowed" ? "denied"
        : event.error === "audio-capture" ? "unsupported"
        : event.error === "aborted" ? null
        : "nothing");
    };
    recognition.onend = () => {
      if (live.current !== recognition) return;
      live.current = null;
      setListening(false);
      if (!any) setProblem(current => current ?? "nothing");
    };
    live.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      live.current = null;
      setProblem("unsupported");
    }
  }, [arabic, end]);

  /* Stop where it is: what was heard so far stays in the box. */
  const stop = useCallback(() => {
    const recognition = live.current;
    if (!recognition) return;
    recognition.stop();
  }, []);

  return { listening, problem, start, stop, cancel: end, dismiss: () => setProblem(null) };
}
