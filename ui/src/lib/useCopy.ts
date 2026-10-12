// Copying text, and whether it was just copied (for a moment of "Copied"). The clipboard API needs a secure page
// (localhost, or the https Tailscale name) and the browser's permission; without them a hidden text box's text is copied.
import { useEffect, useRef, useState } from "react";

/** How long (ms) a button shows that it copied. */
const COPIED_MS = 1500;

async function copyText(text: string) {
  try {
    return await navigator.clipboard.writeText(text);
  } catch {
    copyByTextBox(text);
  }
}

function copyByTextBox(text: string) {
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.opacity = "0";
  document.body.append(box);
  box.select();
  const done = document.execCommand("copy");
  box.remove();
  if (!done) throw new Error("Could not copy");
}

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (text: string) =>
    copyText(text).then(
      () => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => {},
    );
  return { copied, copy };
}
