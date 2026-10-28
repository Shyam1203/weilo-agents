import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostConnection, HostError, streamingText, type HostListener, type SocketLike } from "../lib/host";
import type { Event } from "../proto/Event";

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  welcome() {
    this.receive({ t: "welcome", version: 1, host_name: "Home", device_id: "d1" });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  frames(t: string) {
    return this.sent.filter((f) => f.t === t);
  }
}

const ev = (seq: number, text = `m${seq}`) => ({
  seq,
  at: "2026-10-28T09:41:00Z",
  source: "agent",
  tainted: false,
  body: { kind: "agent_message", text, agent_id: null },
});

function setup(listener: HostListener = {}) {
  let n = 0;
  const host = new HostConnection({
    url: "ws://test/api/ws",
    listener,
    socketFactory: (url) => new FakeSocket(url),
    newId: () => `call-${++n}`,
    random: () => 1,
    backoffBaseMs: 100,
    backoffMaxMs: 1000,
  });
  host.start();
  const sock = () => FakeSocket.all[FakeSocket.all.length - 1]!;
  return { host, sock };
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("HostConnection", () => {
  it("says hello on open and goes online on welcome", () => {
    const statuses: string[] = [];
    const { sock } = setup({ status: (s) => statuses.push(s) });
    sock().open();
    expect(sock().frames("hello")).toEqual([{ t: "hello", version: 1 }]);
    sock().welcome();
    expect(statuses).toEqual(["online"]);
  });

  it("re-subscribes with the last durable seq after a reconnect", () => {
    const events: Array<[string, bigint]> = [];
    const { host, sock } = setup({ event: (id, e: Event) => events.push([id, e.seq]) });
    sock().open();
    sock().welcome();
    host.subscribe("t1");
    expect(sock().frames("sub")).toEqual([{ t: "sub", thread_id: "t1", after_seq: 0 }]);
    sock().receive({ t: "ev", thread_id: "t1", event: ev(1) });
    sock().receive({ t: "ev", thread_id: "t1", event: ev(2) });

    const first = sock();
    first.drop();
    vi.advanceTimersByTime(100);
    expect(FakeSocket.all.length).toBe(2);
    const second = sock();
    expect(second).not.toBe(first);
    second.open();
    expect(second.frames("sub")).toEqual([]); // waits for welcome
    second.welcome();
    expect(second.frames("sub")).toEqual([{ t: "sub", thread_id: "t1", after_seq: 2 }]);
    expect(events).toEqual([
      ["t1", 1n],
      ["t1", 2n],
    ]);
  });

  it("backs off exponentially, up to the cap", () => {
    const { sock } = setup();
    sock().drop();
    vi.advanceTimersByTime(99);
    expect(FakeSocket.all.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all.length).toBe(2);
    sock().drop();
    vi.advanceTimersByTime(199);
    expect(FakeSocket.all.length).toBe(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all.length).toBe(3);
    for (let i = 0; i < 6; i++) {
      sock().drop();
      vi.advanceTimersByTime(1000);
    }
    expect(FakeSocket.all.length).toBe(9);
  });

  it("drops events it already has", () => {
    const seen: bigint[] = [];
    const { host, sock } = setup({ event: (_id, e) => seen.push(e.seq) });
    sock().open();
    sock().welcome();
    host.subscribe("t1");
    for (const s of [1, 2, 2, 1, 3]) sock().receive({ t: "ev", thread_id: "t1", event: ev(s) });
    expect(seen).toEqual([1n, 2n, 3n]);
    expect(host.cursor("t1")).toBe(3n);
  });

  it("builds the reply being written and clears it when the durable event arrives", () => {
    const streaming: Array<string | null> = [];
    const { host, sock } = setup({ streaming: (_id, t) => streaming.push(t) });
    sock().open();
    sock().welcome();
    host.subscribe("t1");
    sock().receive({ t: "ev", thread_id: "t1", event: ev(4) });
    const delta = (after: number, sub: number, text: string) =>
      sock().receive({ t: "delta", thread_id: "t1", after_seq: after, sub_seq: sub, delta: { kind: "agent_text", text } });
    delta(4, 2, "world");
    delta(4, 1, "Hello ");
    delta(4, 1, "Hello "); // repeat ignored
    delta(3, 1, "stale"); // older than what we have
    expect(streaming).toEqual(["world", "Hello world"]);
    sock().receive({ t: "ev", thread_id: "t1", event: ev(5, "Hello world") });
    expect(streaming[streaming.length - 1]).toBeNull();
  });

  it("retries a call with the same call_id after a reconnect", async () => {
    const { host, sock } = setup();
    sock().open();
    sock().welcome();
    const p = host.call({ method: "snapshot" });
    expect(sock().frames("call")).toEqual([{ t: "call", call_id: "call-1", call: { method: "snapshot" } }]);
    sock().drop();
    vi.advanceTimersByTime(100);
    sock().open();
    sock().welcome();
    expect(sock().frames("call")).toEqual([{ t: "call", call_id: "call-1", call: { method: "snapshot" } }]);
    sock().receive({ t: "ret", call_id: "call-1", result: { ok: "done", value: { type: "none" } } });
    await expect(p).resolves.toEqual({ type: "none" });
  });

  it("queues calls made while offline and sends them on welcome", async () => {
    const { host, sock } = setup();
    const p = host.call({ method: "needs_you" });
    expect(sock().sent).toEqual([]);
    sock().open();
    sock().welcome();
    expect(sock().frames("call")).toHaveLength(1);
    sock().receive({ t: "ret", call_id: "call-1", result: { ok: "failed", error: { code: "invalid", message: "Nope." } } });
    await expect(p).rejects.toEqual(new HostError("invalid", "Nope."));
  });

  it("gives up on a call after 30 seconds with a plain error", async () => {
    const { host, sock } = setup();
    sock().open();
    sock().welcome();
    const p = host.call({ method: "snapshot" });
    const check = expect(p).rejects.toThrow("didn't answer in time");
    vi.advanceTimersByTime(30_000);
    await check;
  });

  it("stops retrying when the host refuses this device", () => {
    const statuses: string[] = [];
    const { sock } = setup({ status: (s) => statuses.push(s) });
    sock().drop(4401);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all.length).toBe(1);
    expect(statuses).toEqual(["unpaired"]);
  });

  it("passes Changed through", () => {
    const changed: string[] = [];
    const { sock } = setup({ changed: (w) => changed.push(w) });
    sock().open();
    sock().welcome();
    sock().receive({ t: "changed", what: "needs_you" });
    expect(changed).toEqual(["needs_you"]);
  });
});

describe("streamingText", () => {
  it("uses the newest after_seq only", () => {
    const deltas = new Map([
      [1n, new Map([[1n, "old"]])],
      [2n, new Map([[2n, "b"], [1n, "a"]])],
    ]);
    expect(streamingText({ deltas })).toBe("ab");
    expect(streamingText({ deltas: new Map() })).toBeNull();
  });
});
