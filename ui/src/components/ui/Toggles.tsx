import { useState } from "react";
import { matches, Search } from "./Search";
import { Switch } from "./Switch";
import { Tabs } from "./Tabs";

interface Item {
  id: string;
  name: string;
  description?: string;
}

interface Props {
  label: string;
  items: Item[];
  empty: string;
  value: string[];
  onChange: (value: string[]) => void;
}

export function Toggles({ label, items, empty, value, onChange }: Props) {
  const [show, setShow] = useState<"all" | "enabled">(() => (value.length ? "enabled" : "all"));
  const [query, setQuery] = useState("");
  if (items.length === 0) return <p className="hint">{empty}</p>;

  const on = items.filter((item) => value.includes(item.id));
  const shown = (show === "enabled" ? on : items).filter((item) => matches(query, item.name, item.description));

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <Tabs
        label={`Show ${label}`}
        tabs={[
          { value: "enabled", label: `Enabled ${on.length}` },
          { value: "all", label: `All ${items.length}` },
        ]}
        value={show}
        onChange={setShow}
      />
      <Search value={query} onChange={setQuery} label={`Search ${label}`} />
      <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-xl ring-1 ring-line-strong">
        {shown.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-3.5 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px]">{item.name}</span>
              {item.description && <span className="block truncate text-xs text-ink-3">{item.description}</span>}
            </span>
            <Switch label={item.name} checked={value.includes(item.id)} onChange={(checked) => onChange(checked ? [...value, item.id] : value.filter((id) => id !== item.id))} />
          </li>
        ))}
        {shown.length === 0 && <li className="px-3.5 py-3 text-[13px] text-ink-3">{show === "enabled" && !query.trim() ? "None are enabled." : "No match."}</li>}
      </ul>
    </div>
  );
}
