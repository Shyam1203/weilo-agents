import type { Call } from "../proto/Call";
import type { CallValue } from "../proto/CallValue";
import type { Changed } from "../proto/Changed";
import type { ClientFrame } from "../proto/ClientFrame";
import type { Event } from "../proto/Event";
import type { ServerFrame } from "../proto/ServerFrame";
import { decode, encode } from "./wire";

export const PROTOCOL_VERSION = 1;
export const CALL_TIMEOUT_MS = 30_000;

/** `connecting` before the first welcome, `reconnecting` after a drop, `unpaired` when the host refuses this device. */
export type ConnStatus = "connecting" | "online" | "reconnecting" | "unpaired";

export interface Welcome {
  hostName: string;
  deviceId: string;
}

/** The subset of the browser WebSocket we use, so tests can pass a fake. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface HostListener {
  status?(status: ConnStatus): void;
  welcome?(welcome: Welcome): void;
  /** A durable event, in order and never twice. */
  event?(threadId: string, event: Event): void;
  /** The reply being written right now, or null when it is done. */
  streaming?(threadId: string, text: string | null): void;
  changed?(what: Changed): void;
  /** The host's own health: `ok` false while it can't take new work (the message says why). */
  health?(ok: boolean, message: string | null): void;
}

/** What the app needs from a host. The real connection and the fixture both implement it. */
export interface HostApi {
  start(): void;
  stop(): void;
  subscribe(threadId: string, afterSeq?: bigint): void;
  unsubscribe(threadId: string): void;
  call(call: Call): Promise<CallValue>;
  presence(threadId: string | null): void;
}

export class HostError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "HostError";
  }
}

/** Plain words for error codes whose host message is too technical or missing. */
export function plainError(code: string, message: string): string {
  if (code === "busy") return "Weilo is busy. Try again in a moment.";
  if (code === "unknown") return "Not sure that went through. Check before trying again.";
  return message || "Something went wrong. Try again.";
}

export interface HostOptions {
  url: string;
  listener: HostListener;
  socketFactory?: (url: string) => SocketLike;
  /** Called when a connection closes before the host said welcome. */
  checkAuth?: () => Promise<"ok" | "unpaired">;
  newId?: () => string;
  random?: () => number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  callTimeoutMs?: number;
}

interface Sub {
  active: boolean;
  /** Highest durable seq seen. Sent as `after_seq` when we (re)subscribe. */
  lastSeq: bigint;
  /** Pieces of replies being written, by `after_seq`, then `sub_seq`. */
  deltas: Map<bigint, Map<bigint, string>>;
}

interface PendingCall {
  frame: ClientFrame;
  resolve(value: CallValue): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const OPEN = 1;
const UNPAIRED_CODES = new Set([1008, 4401, 4403]);
const TOKEN_KEY = "weilo.device";

/** This device's token from pairing, kept in the app's own storage (not a cookie). */
export function savedToken(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: pairing lasts for this page only */
  }
}

export class HostConnection implements HostApi {
  private readonly opts: Required<Omit<HostOptions, "checkAuth">> & Pick<HostOptions, "checkAuth">;
  private socket: SocketLike | null = null;
  private welcomed = false;
  private running = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly subs = new Map<string, Sub>();
  private readonly pending = new Map<string, PendingCall>();
  private presenceThread: string | null = null;
  private statusValue: ConnStatus = "connecting";

  constructor(options: HostOptions) {
    this.opts = {
      socketFactory: (url) => new WebSocket(url) as unknown as SocketLike,
      newId: () => crypto.randomUUID(),
      random: Math.random,
      backoffBaseMs: 500,
      backoffMaxMs: 15_000,
      callTimeoutMs: CALL_TIMEOUT_MS,
      ...options,
    };
  }

  get status(): ConnStatus {
    return this.statusValue;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = null;
      s.close(1000, "bye");
    }
  }

  subscribe(threadId: string, afterSeq?: bigint): void {
    let sub = this.subs.get(threadId);
    if (!sub) {
      sub = { active: true, lastSeq: afterSeq ?? 0n, deltas: new Map() };
      this.subs.set(threadId, sub);
    } else {
      if (sub.active) return;
      sub.active = true;
      if (afterSeq !== undefined && afterSeq > sub.lastSeq) sub.lastSeq = afterSeq;
    }
    this.sendIfOnline({ t: "sub", thread_id: threadId, after_seq: sub.lastSeq });
  }

  unsubscribe(threadId: string): void {
    const sub = this.subs.get(threadId);
    if (!sub || !sub.active) return;
    sub.active = false;
    if (sub.deltas.size) {
      sub.deltas.clear();
      this.opts.listener.streaming?.(threadId, null);
    }
    this.sendIfOnline({ t: "unsub", thread_id: threadId });
  }

  /** Last durable seq we hold for a thread. */
  cursor(threadId: string): bigint {
    return this.subs.get(threadId)?.lastSeq ?? 0n;
  }

  call(call: Call): Promise<CallValue> {
    const callId = this.opts.newId();
    const frame: ClientFrame = { t: "call", call_id: callId, call };
    return new Promise<CallValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        reject(new HostError("timeout", "Your Weilo computer didn't answer in time. Try again."));
      }, this.opts.callTimeoutMs);
      this.pending.set(callId, { frame, resolve, reject, timer });
      this.sendIfOnline(frame);
    });
  }

  presence(threadId: string | null): void {
    this.presenceThread = threadId;
    this.sendIfOnline({ t: "presence", thread_id: threadId });
  }

  // -- internals -----------------------------------------------------------

  private setStatus(status: ConnStatus): void {
    if (this.statusValue === status) return;
    this.statusValue = status;
    this.opts.listener.status?.(status);
  }

  private connect(): void {
    this.retryTimer = null;
    if (!this.running) return;
    this.welcomed = false;
    let socket: SocketLike;
    try {
      socket = this.opts.socketFactory(this.opts.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      const token = savedToken();
      this.write(socket, token ? { t: "hello", version: PROTOCOL_VERSION, token } : { t: "hello", version: PROTOCOL_VERSION });
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let frame: ServerFrame;
      try {
        frame = decode<ServerFrame>(ev.data);
      } catch {
        return;
      }
      this.handle(frame);
    };
    socket.onerror = () => {
      /* onclose follows */
    };
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      const wasWelcomed = this.welcomed;
      this.welcomed = false;
      this.dropStreaming();
      if (!this.running) return;
      if (UNPAIRED_CODES.has(ev.code)) {
        saveToken(null);
        this.running = false;
        this.setStatus("unpaired");
        return;
      }
      if (!wasWelcomed && this.opts.checkAuth) {
        this.opts.checkAuth().then(
          (r) => {
            if (r === "unpaired") {
              this.running = false;
              this.setStatus("unpaired");
            } else this.scheduleRetry();
          },
          () => this.scheduleRetry(),
        );
        return;
      }
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer) return;
    this.setStatus(this.statusValue === "connecting" && this.attempt === 0 ? "connecting" : "reconnecting");
    const exp = Math.min(this.opts.backoffMaxMs, this.opts.backoffBaseMs * 2 ** this.attempt);
    const delay = Math.round(exp * (0.5 + this.opts.random() / 2));
    this.attempt += 1;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private handle(frame: ServerFrame): void {
    switch (frame.t) {
      case "welcome":
        this.onWelcome(frame.host_name, frame.device_id);
        return;
      case "ev":
        this.onEvent(frame.thread_id, frame.event);
        return;
      case "delta":
        this.onDelta(frame.thread_id, frame.after_seq, frame.sub_seq, frame.delta.text);
        return;
      case "ret": {
        const p = this.pending.get(frame.call_id);
        if (!p) return;
        this.pending.delete(frame.call_id);
        clearTimeout(p.timer);
        if (frame.result.ok === "done") p.resolve(frame.result.value);
        else {
          const { code, message } = frame.result.error;
          p.reject(new HostError(code, plainError(code, message)));
        }
        return;
      }
      case "changed":
        this.opts.listener.changed?.(frame.what);
        return;
      case "status":
        this.opts.listener.health?.(frame.ok, frame.ok ? null : (frame.message ?? null));
        return;
    }
  }

  private onWelcome(hostName: string, deviceId: string): void {
    const socket = this.socket;
    if (!socket) return;
    this.welcomed = true;
    this.attempt = 0;
    this.setStatus("online");
    // A new connection starts healthy; the host sends `status` right after when it isn't.
    this.opts.listener.health?.(true, null);
    this.opts.listener.welcome?.({ hostName, deviceId });
    for (const [threadId, sub] of this.subs) {
      if (sub.active) this.write(socket, { t: "sub", thread_id: threadId, after_seq: sub.lastSeq });
    }
    if (this.presenceThread) this.write(socket, { t: "presence", thread_id: this.presenceThread });
    // Calls are idempotent by call_id, so a retry after a drop never runs twice.
    for (const p of this.pending.values()) this.write(socket, p.frame);
  }

  private onEvent(threadId: string, event: Event): void {
    const sub = this.subs.get(threadId);
    if (!sub) return;
    if (event.seq <= sub.lastSeq) return; // already have it
    sub.lastSeq = event.seq;
    let dropped = false;
    for (const afterSeq of sub.deltas.keys()) {
      if (afterSeq < event.seq) {
        sub.deltas.delete(afterSeq);
        dropped = true;
      }
    }
    this.opts.listener.event?.(threadId, event);
    if (dropped) this.opts.listener.streaming?.(threadId, streamingText(sub));
  }

  private onDelta(threadId: string, afterSeq: bigint, subSeq: bigint, text: string): void {
    const sub = this.subs.get(threadId);
    if (!sub || !sub.active) return;
    if (afterSeq < sub.lastSeq) return; // its durable event already arrived
    let parts = sub.deltas.get(afterSeq);
    if (!parts) {
      parts = new Map();
      sub.deltas.set(afterSeq, parts);
    }
    if (parts.has(subSeq)) return;
    parts.set(subSeq, text);
    this.opts.listener.streaming?.(threadId, streamingText(sub));
  }

  /** A dropped connection loses the replies being written: clear them (the durable events follow on resubscribe). */
  private dropStreaming(): void {
    for (const [threadId, sub] of this.subs) {
      if (sub.deltas.size === 0) continue;
      sub.deltas.clear();
      this.opts.listener.streaming?.(threadId, null);
    }
  }

  private sendIfOnline(frame: ClientFrame): void {
    if (this.socket && this.welcomed) this.write(this.socket, frame);
  }

  private write(socket: SocketLike, frame: ClientFrame): void {
    if (socket.readyState !== OPEN) return;
    try {
      socket.send(encode(frame));
    } catch {
      /* the close handler retries */
    }
  }
}

/** The newest reply being written: pieces under the highest `after_seq`, in `sub_seq` order. */
export function streamingText(sub: Pick<Sub, "deltas">): string | null {
  let newest: bigint | null = null;
  for (const k of sub.deltas.keys()) if (newest === null || k > newest) newest = k;
  if (newest === null) return null;
  const parts = sub.deltas.get(newest);
  if (!parts || parts.size === 0) return null;
  return [...parts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, t]) => t)
    .join("");
}

/** ws:// or wss:// URL for `/api/ws` on the page's own origin. */
export function socketUrl(loc: Pick<Location, "protocol" | "host"> = window.location): string {
  return `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}/api/ws`;
}

/**
 * Asks the host whether this browser is paired (`/api/health` says `paired: false` when not).
 * Without a token, first trades the device cookie older versions set for one (`/api/token`).
 */
export async function checkPaired(fetcher: typeof fetch = fetch): Promise<"ok" | "unpaired"> {
  if (!savedToken()) {
    const res = await fetcher("/api/token", { method: "POST", credentials: "same-origin" }).catch(() => null);
    const body: unknown = res?.ok ? await res.json().catch(() => null) : null;
    const token = body && typeof body === "object" ? (body as { token?: unknown }).token : null;
    if (typeof token === "string" && token) {
      saveToken(token);
      return "ok";
    }
  }
  const token = savedToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetcher("/api/health", { credentials: "same-origin", headers });
  if (res.status === 401 || res.status === 403) return "unpaired";
  const body: unknown = await res.json().catch(() => null);
  return body && typeof body === "object" && (body as { paired?: unknown }).paired === false ? "unpaired" : "ok";
}
