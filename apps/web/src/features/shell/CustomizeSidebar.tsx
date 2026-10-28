import { useState } from "react";
import { savePrefs } from "../../lib/app";
import { SECTION_KEYS, SECTION_TITLES, withSection } from "../../lib/sidebar";
import type { UiPrefs } from "../../proto/UiPrefs";
import { Button } from "../../ui/Button";
import { Dot } from "../../ui/bits";
import { SidebarIcon } from "../../ui/glyphs";
import { Popover } from "../../ui/Popover";
import { Switch } from "../../ui/Switch";

/** The sidebar is the user's: show or hide each section. Hidden sections still send alerts to Needs you. */
export function CustomizeSidebar({ prefs, hiddenLive }: { prefs: UiPrefs; hiddenLive: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative border-t border-border p-2">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className="ghost flex h-8 w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-body-sm font-medium text-text-secondary"
      >
        <SidebarIcon />
        <span className="flex-1">Customize sidebar</span>
        {hiddenLive && <Dot tone="warning" label="A hidden section has live work" />}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label="Customize sidebar" className="bottom-12 left-2 w-60">
        <div className="px-2 pt-1 pb-2 text-caption font-medium text-text-tertiary">Show in sidebar</div>
        {SECTION_KEYS.map((k) => (
          <div key={k} className="flex h-8 items-center gap-2 px-2">
            <span className="flex-1">{SECTION_TITLES[k]}</span>
            <Switch
              checked={prefs[k].shown}
              label={`Show ${SECTION_TITLES[k]}`}
              onChange={(shown) => void savePrefs(withSection(prefs, k, { shown }))}
            />
          </div>
        ))}
        <div className="p-2 text-caption text-text-secondary">Hidden sections still send alerts to Needs you.</div>
        <div className="flex justify-end px-2 pb-1">
          <Button variant="primary" size="sm" className="px-3" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </Popover>
    </div>
  );
}
