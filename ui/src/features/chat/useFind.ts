// Finding words in the open chat. Every match is marked with CSS highlights (the messages' own markup is untouched), and
// one is current: the view scrolls to it.
import { useEffect, useRef, useState, type RefObject } from "react";

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS;

// Where a match is in the chat: the time of its message (`data-at` on the message's row), in seconds.
const timeOf = (range: Range) => Number(range.startContainer.parentElement?.closest("[data-at]")?.getAttribute("data-at") ?? NaN);

/**
 * `query` is searched in `box` whenever it or one of `deps` (the messages) changes. New words start at the newest match; a
 * new `target` (a result of the search of all chats: its words, and its message's time in seconds) at the match nearest to it.
 */
export function useFind(box: RefObject<HTMLElement | null>, query: string, deps: unknown[], target?: { query: string; at: number } | null) {
  const [ranges, setRanges] = useState<Range[]>([]);
  const [current, setCurrent] = useState(0);
  const searched = useRef<{ needle: string; target?: object | null }>({ needle: "" });
  const near = target && target.query.toLowerCase() === query.trim().toLowerCase() ? target.at : null;

  useEffect(() => {
    const el = box.current;
    const needle = query.trim().toLowerCase();
    const found: Range[] = [];
    if (el && needle) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.nodeValue ?? "").toLowerCase();
        for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
          const range = new Range();
          range.setStart(node, i);
          range.setEnd(node, i + needle.length);
          found.push(range);
        }
      }
    }
    setRanges(found);
    // New words: start over (once there are matches: the messages may still be loading). New messages with the same
    // words: stay on the same match.
    if ((searched.current.needle !== needle || searched.current.target !== target) && (found.length || !needle)) {
      searched.current = { needle, target };
      let start = found.length - 1;
      if (near != null) {
        let best = Infinity;
        found.forEach((range, i) => {
          const off = Math.abs(timeOf(range) - near);
          if (off < best) (best = off), (start = i);
        });
      }
      setCurrent(Math.max(0, start));
    }
  }, [query, target, ...deps]);

  // Marks every match, and the current one more strongly.
  useEffect(() => {
    if (!supported()) return;
    CSS.highlights.set("find", new Highlight(...ranges));
    if (ranges[current]) {
      const mark = new Highlight(ranges[current]);
      mark.priority = 1; // above "find", where they overlap
      CSS.highlights.set("find-current", mark);
    }
    return () => void (CSS.highlights.delete("find"), CSS.highlights.delete("find-current"));
  }, [ranges, current]);

  // Brings the current match into the middle of the view.
  useEffect(() => {
    const el = box.current;
    const range = ranges[current];
    if (!el || !range) return;
    const at = range.getBoundingClientRect();
    const view = el.getBoundingClientRect();
    if (at.top < view.top + 40 || at.bottom > view.bottom - 120) el.scrollTo({ top: el.scrollTop + at.top - view.top - view.height / 3, behavior: "smooth" });
  }, [ranges, current]);

  const step = (by: number) => ranges.length && setCurrent((current + by + ranges.length) % ranges.length);
  return { count: ranges.length, current, next: () => step(1), previous: () => step(-1) };
}
