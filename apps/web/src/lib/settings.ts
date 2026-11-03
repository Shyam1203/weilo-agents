import type { DeviceInfo } from "../proto/DeviceInfo";
import { whenInSentence } from "./format";

/** A device's one line under its name: this one, when it was last used, or when it paired. */
export function deviceLine(d: DeviceInfo, now = new Date(), sameName = false): string {
  // Two devices with one name: when each was paired tells them apart.
  const paired = sameName ? ` · paired ${whenInSentence(d.paired_at, now)}` : "";
  if (d.this_device) return `This device${paired}`;
  if (d.last_seen_at) return `Last used ${whenInSentence(d.last_seen_at, now)}${paired}`;
  return `Paired ${whenInSentence(d.paired_at, now)}`;
}

/** This device first, then the most recently used. */
export function sortDevices(list: DeviceInfo[]): DeviceInfo[] {
  const used = (d: DeviceInfo) => d.last_seen_at ?? d.paired_at;
  return [...list].sort((a, b) => Number(b.this_device) - Number(a.this_device) || used(b).localeCompare(used(a)));
}

/** Names that more than one device has. */
export function repeatedNames(list: DeviceInfo[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const d of list) (seen.has(d.name) ? twice : seen).add(d.name);
  return twice;
}

/** What removing a device means, in one line. */
export function removeDeviceLine(d: DeviceInfo): string {
  return d.this_device ? "This device will need a new pairing code to use Weilo again." : "It will need a new pairing code to use Weilo again.";
}
