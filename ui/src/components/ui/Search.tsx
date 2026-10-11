/** A search box above a list. */
export function Search({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search" aria-label={label} className="input" />;
}

/** Whether any of the texts holds what was searched for. */
export const matches = (query: string, ...texts: (string | undefined)[]) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = texts.join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
};
