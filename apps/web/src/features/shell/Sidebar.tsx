import { useEffect, useMemo, useRef, useState } from "react";
import { savePrefs } from "../../lib/app";
import { cx } from "../../lib/format";
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
import { pendingNeedsYou, useApp } from "../../lib/store";
import { Avatar } from "../../ui/Avatar";
import { Badge, EmptyState } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { ChevronDownIcon, InboxIcon, MoreIcon, PlusIcon, SearchIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";
import { Link } from "../../ui/Link";
import { MenuItem, Popover } from "../../ui/Popover";
import { shortcut, useTouchOnly } from "../../lib/platform";
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

export function Sidebar({ route, floating }: { route: Route; floating?: boolean }) {
  const snap = useApp((s) => s.snapshot)!;
  const needs = useApp((s) => pendingNeedsYou(s).length);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<SectionKey | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const sections = useMemo(() => buildSections(snap, query), [snap, query]);
  const hiddenLive = useMemo(() => hiddenHasLiveWork(snap), [snap]);
  const selected = selectedId(route, snap.agents);
  const main = snap.agents[0];
  const searching = query.trim().length > 0;
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
  const firstMatch = sections.flatMap((s) => s.rows)[0];

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
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
              if (e.key === "Enter" && firstMatch) {
                navigate(firstMatch.href);
                setQuery("");
              }
            }}
            placeholder="Search or jump to…"
            aria-label="Search the sidebar"
            className="min-w-0 flex-1 border-0 bg-transparent text-body-sm text-text outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {!touch && (
            <kbd className="shrink-0 rounded-sm border border-border px-1 font-sans text-caption text-text-tertiary">{shortcut("K")}</kbd>
          )}
        </label>
      </div>

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
            open={searching || sec.prefs.open}
            onToggle={() => toggle(sec.key)}
            onAdd={ADD_LABEL[sec.key] ? () => setDialog(sec.key) : undefined}
            onHide={() => hide(sec.key)}
            selected={selected}
            searching={searching}
          />
        ))}

        {searching && !firstMatch && (
          <p className="m-0 px-2 text-text-secondary">Nothing matches “{query.trim()}”.</p>
        )}
      </div>

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
  searching,
}: {
  section: SidebarSection;
  open: boolean;
  onToggle(): void;
  onAdd?: () => void;
  onHide(): void;
  selected: string | null;
  searching: boolean;
}) {
  const [menu, setMenu] = useState(false);
  if (searching && section.rows.length === 0) return null;
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
          disabled={searching}
          className="flex h-7 min-w-0 flex-1 items-center gap-1 border-0 bg-transparent p-0 text-left text-caption font-medium text-text-tertiary disabled:cursor-default"
        >
          <ChevronDownIcon size={12} className={cx("shrink-0 transition-transform duration-[120ms]", !open && "-rotate-90")} />
          <span className="flex-1">{section.title}</span>
          {label && <span>{label}</span>}
        </button>
        {/* Shown on hover and keyboard focus, on an opaque background so the collapsed label never shows through. */}
        <div className={cx("reveal-on-hover absolute top-0.5 right-1 flex items-center gap-0.5 rounded-sm bg-bg", menu && "opacity-100")}>
          <IconButton
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
          <Popover open={menu} onClose={() => setMenu(false)} label={`${section.title} actions`} role="menu" className="top-7 right-0 w-44">
            <MenuItem
              onSelect={() => {
                setMenu(false);
                onHide();
              }}
            >
              Hide section
            </MenuItem>
          </Popover>
        </div>
      </div>
      {open && (
        <div id={listId} className="flex flex-col gap-0.5">
          {section.rows.map((r) => (
            <SidebarRow key={r.id} row={r} selected={r.id === selected} />
          ))}
          {section.rows.length === 0 && section.key === "channels" && (
            <p className="m-0 px-2 text-caption text-text-secondary">
              <b className="font-medium text-text">No channels yet.</b> Ava files work here as it comes in.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
