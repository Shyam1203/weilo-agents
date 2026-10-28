import { describe, expect, it } from "vitest";
import { listWords, projectName } from "../lib/format";
import { isMac, shortcut } from "../lib/platform";
import { decideLocally, initialState, loadQueued, revertPrefs, saveQueued, undecideLocally, applySnapshot, setNeedsYou } from "../lib/store";
import { defaultTab } from "../features/thread/ChannelView";
import { knownProjects } from "../features/shell/dialogs";
import { item, snapshot, thread } from "./fixtures";
import type { UiPrefs } from "../proto/UiPrefs";

const prefs = (o: Partial<Record<keyof UiPrefs, Partial<UiPrefs[keyof UiPrefs]>>> = {}): UiPrefs => ({
  agents: { shown: true, open: true, ...o.agents },
  channels: { shown: true, open: true, ...o.channels },
  sessions: { shown: true, open: true, ...o.sessions },
  archived: { shown: true, open: false, ...o.archived },
});

describe("rolling back only what changed", () => {
  it("puts back a failed approval without touching newer items", () => {
    const a = item({ approval_id: "a", state: "pending" });
    let s = applySnapshot(initialState, snapshot({ needs_you: [a] }));
    s = decideLocally(s, "a", true);
    // A refresh arrives while the call is in flight, with a new item.
    const b = item({ approval_id: "b", state: "pending" });
    s = setNeedsYou(s, [...s.snapshot!.needs_you, b]);
    s = undecideLocally(s, "a", true);
    expect(s.snapshot!.needs_you.map((n) => [n.approval_id, n.state])).toEqual([
      ["a", "pending"],
      ["b", "pending"],
    ]);
  });
  it("leaves an item alone when the host has since changed it", () => {
    let s = applySnapshot(initialState, snapshot({ needs_you: [item({ approval_id: "a", state: "pending" })] }));
    s = decideLocally(s, "a", true);
    s = setNeedsYou(s, [item({ approval_id: "a", state: "expired" })]);
    expect(undecideLocally(s, "a", true)).toBe(s);
  });
  it("reverts only the section setting a failed save changed", () => {
    const before = prefs();
    const attempted = prefs({ sessions: { shown: false } });
    // Meanwhile the person folded Channels, and that save worked.
    const current = prefs({ sessions: { shown: false }, channels: { open: false } });
    expect(revertPrefs(current, before, attempted)).toEqual(prefs({ channels: { open: false } }));
  });
  it("keeps a newer change to the same setting", () => {
    const before = prefs();
    const attempted = prefs({ sessions: { shown: false } });
    const current = prefs({ sessions: { shown: true, open: false } });
    expect(revertPrefs(current, before, attempted)).toEqual(current);
  });
});

describe("Next up survives a reload", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      data,
    };
  };
  it("saves and loads per thread, dropping empty lists", () => {
    const m = memory();
    saveQueued({ t1: [{ id: "q1", text: "Also make an Instagram version" }], t2: [] }, m);
    expect(loadQueued(m)).toEqual({ t1: [{ id: "q1", text: "Also make an Instagram version" }] });
    saveQueued({ t1: [] }, m);
    expect(m.data.size).toBe(0);
  });
  it("ignores broken or blocked storage", () => {
    expect(loadQueued({ getItem: () => "{not json" })).toEqual({});
    expect(loadQueued({ getItem: () => JSON.stringify({ t1: [{ id: 1 }], t2: "x" }) })).toEqual({});
    expect(
      loadQueued({
        getItem: () => {
          throw new Error("SecurityError");
        },
      }),
    ).toEqual({});
    expect(() =>
      saveQueued({ t1: [{ id: "q", text: "x" }] }, {
        setItem: () => {
          throw new Error("QuotaExceeded");
        },
        removeItem: () => {},
      }),
    ).not.toThrow();
  });
});

describe("a channel opens the lead's conversation", () => {
  const launch = thread({ id: "launch", kind: "chat", agent_id: "ava", updated_at: "2026-10-28T09:42:00Z" });
  const teaser = thread({ id: "teaser", kind: "chat", agent_id: "mia", updated_at: "2026-10-28T09:44:00Z" });
  it("prefers the lead's conversation over a newer one", () => {
    expect(defaultTab([teaser, launch], "ava")).toBe("launch");
  });
  it("falls back to the newest, then Overview", () => {
    expect(defaultTab([launch, teaser], "zed")).toBe("teaser");
    expect(defaultTab([launch, teaser])).toBe("teaser");
    expect(defaultTab([])).toBe("overview");
  });
});

describe("plain words", () => {
  it("lists hidden sections the reader's way", () => {
    expect(listWords(["Sessions"], "en")).toBe("Sessions");
    expect(listWords(["Agents", "Sessions"], "en")).toBe("Agents and Sessions");
    expect(listWords(["Agents", "Channels", "Sessions"], "en")).toBe("Agents, Channels, and Sessions");
  });
  it("names a project by its folder's last part", () => {
    expect(projectName("~/code/shop")).toBe("shop");
    expect(projectName("C:\\work\\store\\")).toBe("store");
    expect(projectName(null)).toBeNull();
  });
  it("lists known projects newest first, once each", () => {
    const list = knownProjects([
      thread({ kind: "session", folder: "~/code/shop", updated_at: "2026-10-28T09:00:00Z" }),
      thread({ kind: "session", folder: "~/code/blog", updated_at: "2026-10-28T10:00:00Z" }),
      thread({ kind: "session", folder: "~/code/shop", updated_at: "2026-10-28T11:00:00Z" }),
      thread({ kind: "chat", folder: null }),
    ]);
    expect(list).toEqual(["~/code/shop", "~/code/blog"]);
  });
  it("says ⌘ on a Mac and Ctrl elsewhere", () => {
    expect(isMac({ platform: "MacIntel" })).toBe(true);
    expect(isMac({ platform: "Win32" })).toBe(false);
    expect(isMac({ platform: "", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe(false);
    expect(shortcut("K", true)).toBe("⌘K");
    expect(shortcut("K", false)).toBe("Ctrl+K");
  });
});
