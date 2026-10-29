import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { savePrefs } from "../../lib/app";
import { cx, shortName } from "../../lib/format";
import { navigate, paths, type Route } from "../../lib/router";
import {
  allHidden,
  buildSections,
  collapsedLabel,
  hiddenHasLiveWork,
  showAll,
  withSection,
  type SectionKey,
  type SidebarSection,
} from "../../lib/sidebar";
import { pendingNeedsYou, problemLines, useApp } from "../../lib/store";
import { jumpItems, recentPlaces, searchJump, startJump, type JumpItem } from "../../lib/jump";
import { Avatar } from "../../ui/Avatar";
import { Badge, EmptyState } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { ArrowRightIcon, ChevronDownIcon, CodeIcon, InboxIcon, MoreIcon, PlusIcon, SearchIcon, SidebarIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";
import { Link } from "../../ui/Link";
import { Menu, MenuItem } from "../../ui/Menu";
import { shortcut, useTouchOnly } from "../../lib/platform";
import { focusComposerSoon } from "../thread/useThread";
import { CustomizeSidebar } from "./CustomizeSidebar";
import { NewAgentDialog, NewChannelDialog, NewSessionDialog } from "./dialogs";
import { SidebarRow } from "./SidebarRow";

const ADD_LABEL: Partial<Record<SectionKey, string>> = {
  agents: "New agent",
  channels: "New channel",
  sessions: "New session",
};

function selectedId(route: Route, snapAgents: Array<{ id: string }>): string | null {
  switch (route.name) {
    case "agent":
      return route.agentId;
    case "home":
      return snapAgents[0]?.id ?? null;
    case "channel":
      return route.channelId;
    case "session":
      return route.threadId;
    default:
      return null;
  }
}

export function Sidebar({ route, floating, focusSearch }: { route: Route; floating?: boolean; focusSearch?: boolean }) {
  const snap = useApp((s) => s.snapshot)!;
  const needs = useApp((s) => pendingNeedsYou(s).length);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<SectionKey | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const problems = useApp(problemLines);
  const sections = useMemo(() => buildSections(snap, "", problems), [snap, problems]);
  const everything = useMemo(() => jumpItems(snap, problems), [snap, problems]);
  // Focused with nothing typed: recent places and the common things to do.
  const [jumpOpen, setJumpOpen] = useState(false);
  const results = useMemo(
    () => (query.trim() ? searchJump(everything, query) : jumpOpen ? startJump(everything, recentPlaces()) : []),
    [everything, query, jumpOpen],
  );
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (focusSearch) search.current?.focus();
  }, [focusSearch]);
  const hiddenLive = useMemo(() => hiddenHasLiveWork(snap), [snap]);
  const selected = selectedId(route, snap.agents);
  const main = snap.agents[0];
  const searching = query.trim().length > 0 || (jumpOpen && results.length > 0);
  const touch = useTouchOnly();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = (key: SectionKey) => void savePrefs(withSection(snap.prefs, key, { open: !snap.prefs[key].open }));
  const hide = (key: SectionKey) => void savePrefs(withSection(snap.prefs, key, { shown: false }));
  const run = (item: JumpItem) => {
    setQuery("");
    setJumpOpen(false);
    search.current?.blur();
    const a = item.action;
    if (a.type === "go") {
      navigate(a.href);
      if (item.kind !== "page") focusComposerSoon();
    } else if (a.type === "new") {
      setDialog(a.what === "agent" ? "agents" : a.what === "channel" ? "channels" : "sessions");
    } else {
      void savePrefs(withSection(snap.prefs, a.key, { shown: a.shown }));
    }
  };

  return (
    <aside
      id="sidebar"
      aria-label="Sidebar"
      className={cx(
        "flex w-[272px] shrink-0 flex-col border-r border-border bg-bg",
        floating && "fixed inset-y-0 left-20 z-40 shadow-e3",
      )}
    >
      <div className="flex h-14 shrink-0 items-center px-3 shadow-line">
        <label className="ring-within flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-2 text-text-tertiary">
          <SearchIcon className="shrink-0" />
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setJumpOpen(true)}
            onBlur={() => setJumpOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (query) setQuery("");
                else e.currentTarget.blur();
              }
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                if (results.length === 0) return;
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                setActive((i) => (i + step + results.length) % results.length);
              }
              if (e.key === "Enter" && results[active]) {
                e.preventDefault();
                run(results[active]!);
              }
            }}
            placeholder="Search or jump to…"
            aria-label="Search or jump to"
            role="combobox"
            aria-expanded={searching}
            aria-controls="jump-list"
            aria-autocomplete="list"
            aria-activedescendant={searching && results[active] ? `jump-${results[active]!.id}` : undefined}
            className="min-w-0 flex-1 border-0 bg-transparent text-body-sm text-text outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {!touch && (
            <kbd className="shrink-0 rounded-sm border border-border px-1 font-sans text-caption text-text-tertiary">{shortcut("K")}</kbd>
          )}
        </label>
      </div>

      {searching ? (
        <JumpList query={query.trim()} items={results} active={active} onHover={setActive} onRun={run} />
      ) : (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-3 text-body-sm">
        <div className="flex flex-col gap-0.5">
          <Link
            href={paths.needs()}
            aria-current={route.name === "needs" ? "page" : undefined}
            className={cx(
              "flex h-8 items-center gap-2 rounded-md px-2 font-medium hover:no-underline",
              route.name === "needs" ? "bg-accent-subtle text-accent-text" : "text-text hover:bg-surface-muted",
            )}
          >
            <span className="flex w-6 shrink-0 justify-center">
              <InboxIcon />
            </span>
            <span className="flex-1">Needs you</span>
            <Badge count={needs} />
          </Link>
          {!snap.prefs.agents.shown && main && (
            <Link
              href={paths.agent(main.id)}
              className="flex h-8 items-center gap-2 rounded-md px-2 font-medium text-text hover:bg-surface-muted hover:no-underline"
            >
              <Avatar name={main.name} color={main.color} size={24} />
              Chat with {main.name}
            </Link>
          )}
        </div>

        {allHidden(snap.prefs) && (
          <EmptyState
            className="px-2"
            title="Your sidebar is empty."
            action={
              <Button size="sm" onClick={() => void savePrefs(showAll(snap.prefs))}>
                Show all
              </Button>
            }
          />
        )}

        {sections.map((sec) => (
          <Section
            key={sec.key}
            section={sec}
            open={sec.prefs.open}
            onToggle={() => toggle(sec.key)}
            onAdd={ADD_LABEL[sec.key] ? () => setDialog(sec.key) : undefined}
            mainName={main?.name ?? "Ava"}
            onHide={() => hide(sec.key)}
            selected={selected}
          />
        ))}

      </div>
      )}

      <CustomizeSidebar prefs={snap.prefs} hiddenLive={hiddenLive} />

      <NewAgentDialog open={dialog === "agents"} onClose={() => setDialog(null)} />
      <NewChannelDialog open={dialog === "channels"} onClose={() => setDialog(null)} />
      <NewSessionDialog open={dialog === "sessions"} onClose={() => setDialog(null)} />
    </aside>
  );
}

function Section({
  section,
  open,
  onToggle,
  onAdd,
  onHide,
  selected,
  mainName,
}: {
  section: SidebarSection;
  open: boolean;
  onToggle(): void;
  onAdd?: () => void;
  mainName: string;
  onHide(): void;
  selected: string | null;
}) {
  const [menu, setMenu] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  const label = open ? "" : collapsedLabel(section.rows);
  const listId = `sidebar-${section.key}`;
  return (
    <section aria-label={section.title} className="flex flex-col gap-0.5">
      <div className="reveal-host relative flex h-7 items-center px-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={onToggle}
          className="flex h-7 min-w-0 flex-1 items-center gap-1 border-0 bg-transparent p-0 text-left text-caption font-medium text-text-tertiary"
        >
          <ChevronDownIcon size={12} className={cx("shrink-0 transition-transform duration-[120ms]", !open && "-rotate-90")} />
          <span className="flex-1">{section.title}</span>
          {label && <span className="reveal-under">{label}</span>}
        </button>
        {/* Shown on hover and keyboard focus, on an opaque background so the collapsed label never shows through. */}
        <div className={cx("reveal-on-hover absolute top-0.5 right-1 flex items-center gap-0.5 rounded-sm bg-bg", menu && "opacity-100")}>
          <IconButton
            ref={trigger}
            label={`More for ${section.title}`}
            size={24}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            <MoreIcon />
          </IconButton>
          {onAdd && (
            <IconButton label={ADD_LABEL[section.key]!} size={24} onClick={onAdd}>
              <PlusIcon />
            </IconButton>
          )}
          <Menu open={menu} onClose={closeMenu} anchor={trigger} label={`${section.title} actions`} className="w-44">
            <MenuItem
              onSelect={() => {
                setMenu(false);
                onHide();
              }}
            >
              Hide section
            </MenuItem>
          </Menu>
        </div>
      </div>
      {open && (
        <div id={listId} className="flex flex-col gap-0.5">
          {section.rows.map((r) => (
            <SidebarRow key={r.id} row={r} selected={r.id === selected} />
          ))}
          {section.rows.length === 0 && section.key === "channels" && (
            <p className="m-0 px-2 text-caption text-text-secondary">
              <b className="font-medium text-text">No channels yet.</b> {shortName(mainName)} files work here as it comes in.
            </p>
          )}
          {/* The "+" shows only on hover, so an empty section gets a real button. */}
          {section.rows.length === 0 && (section.key === "agents" || section.key === "sessions") && onAdd && (
            <div className="flex flex-col items-start gap-1.5 px-2 text-caption text-text-secondary">
              <p className="m-0">
                {section.key === "agents" ? (
                  <b className="font-medium text-text">No agents yet.</b>
                ) : (
                  <>
                    <b className="font-medium text-text">No sessions yet.</b> Work on code in a folder on this computer.
                  </>
                )}
              </p>
              <Button size="sm" onClick={onAdd}>
                {section.key === "agents" ? "New agent" : "Start a session"}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const KIND_WORD: Record<JumpItem["kind"], string> = {
  agent: "Agent",
  channel: "Channel",
  session: "Session",
  page: "Page",
  action: "Action",
};

/** What Ctrl+K found: places to go, then things to do. ↑ ↓ move, Enter opens. */
function JumpList({
  query,
  items,
  active,
  onHover,
  onRun,
}: {
  query: string;
  items: JumpItem[];
  active: number;
  onHover(i: number): void;
  onRun(item: JumpItem): void;
}) {
  const snap = useApp((s) => s.snapshot)!;
  if (items.length === 0) {
    return <p className="m-0 px-4 py-3 text-body-sm text-text-secondary">Nothing matches “{query}”.</p>;
  }
  return (
    <ul id="jump-list" role="listbox" aria-label="Jump to" className="m-0 flex min-h-0 flex-1 list-none flex-col gap-0.5 overflow-y-auto px-2 py-3 text-body-sm">
      {items.map((item, i) => {
        const first = i === 0 || items[i - 1]!.group !== item.group;
        const agent = item.kind === "agent" ? snap.agents.find((a) => a.id === item.id) : undefined;
        return (
          <li key={item.id} role="presentation" className="flex flex-col">
            {first && <span className={cx("flex h-7 items-center px-2 text-caption font-medium text-text-tertiary", i > 0 && "mt-2")}>{item.group}</span>}
            <div
              id={`jump-${item.id}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onRun(item)}
              className={cx("flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1", i === active ? "bg-accent-subtle text-accent-text" : "text-text")}
            >
              <span className="flex w-6 shrink-0 justify-center text-text-tertiary">
                {agent ? <Avatar name={agent.name} color={agent.color} size={20} /> : item.kind === "channel" ? "#" : item.kind === "session" ? <CodeIcon size={14} /> : item.action.type === "new" ? <PlusIcon size={14} /> : item.action.type === "section" ? <SidebarIcon size={14} /> : <ArrowRightIcon size={14} />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="ellipsis">{item.label}</span>
                {item.sub && <span className="ellipsis text-caption text-text-tertiary">{item.sub}</span>}
              </span>
              <span className="sr-only">{KIND_WORD[item.kind]}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
