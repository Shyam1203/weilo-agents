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

export function useDictation(onText: (text: string) => void): Dictation {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const handler = useRef(onText);
  handler.current = onText;

  const stop = useCallback(() => recognition.current?.stop(), []);

  const toggle = useCallback(() => {
    if (!Speech) return;
    if (recognition.current) return recognition.current.stop();
    const r = new Speech();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    r.onresult = (event) => {
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) handler.current(result[0].transcript.trim());
        else pending += result[0].transcript;
      }
      setInterim(pending);
    };
    r.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") setError("This site cannot use the microphone. Allow access in the browser settings.");
      else if (event.error !== "no-speech" && event.error !== "aborted") setError("Voice typing stopped: " + event.error);
    };
    r.onend = () => {
      recognition.current = null;
      setListening(false);
      setInterim("");
    };
    setError(null);
    recognition.current = r;
    setListening(true);
    r.start();
  }, []);

  useEffect(() => () => recognition.current?.stop(), []);

  return { supported: !!Speech, listening, interim, error, toggle, stop };
}
