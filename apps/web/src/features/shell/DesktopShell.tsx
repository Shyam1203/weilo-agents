import { useEffect, useState } from "react";
import type { Route } from "../../lib/router";
import { notePlace } from "../../lib/jump";
import { useApp } from "../../lib/store";
import { useMedia } from "../../lib/useMedia";
import { Rail } from "./Rail";
import { RoutePage } from "./Pages";
import { Sidebar } from "./Sidebar";

/** Below this width the sidebar folds into the rail and opens over the page. */
export const SIDEBAR_MIN_WIDTH = 1000;
/** From here the sidebar, the chat and a side panel all fit side by side. */
export const ALL_SIDE_BY_SIDE = 1280;

/**
 * Rail (80) · Sidebar (272) · the page (at least 480), with its side panel when open.
 * On narrow windows the sidebar is reached from the rail and floats over the page.
 */
export function DesktopShell({ route }: { route: Route }) {
  const mid = useMedia(`(min-width: ${SIDEBAR_MIN_WIDTH}px)`);
  const wide = useMedia(`(min-width: ${ALL_SIDE_BY_SIDE}px)`);
  // Between the two, an open side panel takes the sidebar's room (it's one click away in the rail).
  const panelOpen = useApp((s) => s.panelOpen);
  const roomy = wide || (mid && !panelOpen);
  const [floating, setFloating] = useState(false);
  const [jump, setJump] = useState(false);

  // Ctrl+K on a narrow window opens the sidebar first, ready to type.
  useEffect(() => {
    if (roomy) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !floating) {
        e.preventDefault();
        setJump(true);
        setFloating(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roomy, floating]);
  useEffect(() => {
    if (!floating) setJump(false);
  }, [floating]);

  const mainAgent = useApp((s) => s.snapshot?.agents[0]?.id ?? null);
  // Ctrl+K lists the places opened lately before anything is typed.
  useEffect(() => notePlace(route, mainAgent), [route, mainAgent]);

  // Going somewhere closes the floating sidebar.
  useEffect(() => setFloating(false), [route]);
  useEffect(() => {
    if (roomy) setFloating(false);
  }, [roomy]);
  useEffect(() => {
    if (!floating) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFloating(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [floating]);

  return (
    <div className="relative flex h-full min-h-0 bg-bg">
      <Rail route={route} sidebar={roomy ? null : { open: floating, toggle: () => setFloating((v) => !v) }} />
      {roomy && <Sidebar route={route} />}
      {!roomy && floating && (
        <>
          <div aria-hidden="true" className="fixed inset-0 left-20 z-30" onClick={() => setFloating(false)} />
          <Sidebar route={route} floating focusSearch={jump} />
        </>
      )}
      <div className="flex min-h-0 min-w-[480px] flex-1">
        <RoutePage route={route} />
      </div>
    </div>
  );
}
