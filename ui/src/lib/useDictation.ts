// Voice typing with the browser's built-in speech recognition (Chrome, Edge, Safari; not
// Firefox). Recognized phrases are handed to onText as they're finalized. Note: Chrome sends the
// audio to Google's speech service to transcribe it.
import { useCallback, useEffect, useRef, useState } from "react";

interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionConstructor = new () => Recognition;

const Speech: RecognitionConstructor | undefined =
  typeof window === "undefined" ? undefined : ((window as unknown as Record<string, RecognitionConstructor | undefined>).SpeechRecognition ?? (window as unknown as Record<string, RecognitionConstructor | undefined>).webkitSpeechRecognition);

interface Dictation {
  supported: boolean;
  listening: boolean;
  /** Words heard but not final yet, to show while speaking. */
  interim: string;
  error: string | null;
  toggle: () => void;
  stop: () => void;
}

/** How long (ms) a stopped recognition may take to end before it is ended here (Safari on iPhone sometimes never ends it). */
const END_MS = 1500;

export function useDictation(onText: (text: string) => void): Dictation {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  // The words heard but not final yet, and the end of the recognition going on.
  const pending = useRef("");
  const finish = useRef<(() => void) | null>(null);
  const handler = useRef(onText);
  handler.current = onText;

  const stop = useCallback(() => {
    const r = recognition.current;
    if (!r) return;
    r.stop();
    // Safari on iPhone may never say it ended: end it here after a moment.
    setTimeout(() => recognition.current === r && finish.current?.(), END_MS);
  }, []);

  const toggle = useCallback(() => {
    if (!Speech) return;
    if (recognition.current) return stop();
    const r = new Speech();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    // Each result is a phrase, and every event has all of them so far: each final one is handed on once, from the first.
    // Safari on iPhone often never marks the last one final, so ending hands on what is pending too.
    let given = 0;
    r.onresult = (event) => {
      const results = Array.from(event.results);
      for (; given < results.length && results[given].isFinal; given++) {
        const text = results[given][0].transcript.trim();
        if (text) handler.current(text);
      }
      pending.current = results.slice(given).map((result) => result[0].transcript).join("");
      setInterim(pending.current);
    };
    r.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") setError("This site cannot use the microphone. Allow access in the browser settings.");
      else if (event.error !== "no-speech" && event.error !== "aborted") setError("Voice typing stopped: " + event.error);
    };
    // Ending keeps the words heard so far, final or not.
    const end = () => {
      if (recognition.current !== r) return;
      recognition.current = null;
      finish.current = null;
      const left = pending.current.trim();
      pending.current = "";
      if (left) handler.current(left);
      setListening(false);
      setInterim("");
    };
    r.onend = end;
    finish.current = () => {
      r.abort();
      end();
    };
    setError(null);
    pending.current = "";
    recognition.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      end();
      setError("Voice typing could not start. Try again.");
    }
  }, [stop]);

  useEffect(() => () => recognition.current?.stop(), []);

  return { supported: !!Speech, listening, interim, error, toggle, stop };
}
