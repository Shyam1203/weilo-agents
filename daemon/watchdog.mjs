import { Worker } from "node:worker_threads";

const WATCH = `
const { workerData: { beat, limit } } = process.getBuiltinModule("node:worker_threads");
let last = -1;
let since = Date.now();
setInterval(() => {
  const now = Atomics.load(beat, 0);
  if (now !== last) [last, since] = [now, Date.now()];
  else if (Date.now() - since > limit) {
    process.getBuiltinModule("node:fs").writeSync(2, "The app stopped responding for " + Math.round(limit / 1000) + " s; restarting it\\n");
    process.kill(process.pid, "SIGKILL");
  }
}, 5000);
`;

export function watchdog(limit) {
  const beat = new Int32Array(new SharedArrayBuffer(4));
  setInterval(() => Atomics.add(beat, 0, 1), 1000).unref();
  new Worker(WATCH, { eval: true, workerData: { beat, limit } }).unref();
}
