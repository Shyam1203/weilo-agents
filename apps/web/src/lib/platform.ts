import { useMedia } from "./useMedia";

/** Macs say ⌘; everything else says Ctrl. */
export function isMac(nav: { platform?: string; userAgent?: string } | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  const ua = (nav as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? "";
  return /mac|iphone|ipad|ipod/i.test(ua);
}

/** "⌘K" on a Mac, "Ctrl+K" elsewhere. */
export function shortcut(key: string, mac = isMac()): string {
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}

/** Touch-only devices have no keyboard to speak of, so keyboard hints are hidden there. */
export const useTouchOnly = () => useMedia("(hover: none) and (pointer: coarse)");
