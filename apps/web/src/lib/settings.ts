import type { DeviceInfo } from "../proto/DeviceInfo";
import { whenInSentence } from "./format";

/** A device's one line under its name: this one, when it was last used, or when it paired. */
export function deviceLine(d: DeviceInfo, now = new Date()): string {
  if (d.this_device) return "This device";
  if (d.last_seen_at) return `Last used ${whenInSentence(d.last_seen_at, now)}`;
  return `Paired ${whenInSentence(d.paired_at, now)}`;
}

/** What removing a device means, in one line. */
export function removeDeviceLine(d: DeviceInfo): string {
  return d.this_device ? "This device will need a new pairing code to use Weilo again." : "It will need a new pairing code to use Weilo again.";
}
