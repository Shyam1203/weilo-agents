export type Block =
  | { type: "text"; text: string }
  | { type: "table"; title: string; columns: string[]; rows: string[][] }
  | { type: "metrics"; items: { label: string; value: string; note: string }[] }
  | { type: "cards"; items: { title: string; text: string; link: string; message: string; image: string }[] }
  | { type: "chart"; title: string; shape: "bar" | "line"; points: { label: string; value: number }[] }
  | { type: "buttons"; options: { label: string; message: string }[] }
  | { type: "file"; path: string; name: string }
  | { type: "page"; title: string; html: string }
  | { type: "openui"; source: string };

type Raw = Record<string, unknown>;

const record = (x: unknown): Raw => (x && typeof x === "object" ? (x as Raw) : {});
const list = (x: unknown) => (Array.isArray(x) ? x : []);
const str = (x: unknown) => (typeof x === "string" || typeof x === "number" ? String(x) : "");
export const workspacePath = (x: unknown) => str(x).replace(/^\/home\/node\/\.pi\/workspace\//, "").replace(/^\.?\/+/, "");
export const link = (x: unknown) => (/^https?:\/\//i.test(str(x)) ? str(x) : "");

function blockOf(raw: Raw): Block | null {
  switch (raw.type) {
    case "text":
      return str(raw.text) ? { type: "text", text: str(raw.text) } : null;
    case "table": {
      const columns = list(raw.columns).map(str);
      const rows = list(raw.rows).map((row) => list(row).map(str));
      return columns.length ? { type: "table", title: str(raw.title), columns, rows } : null;
    }
    case "metrics": {
      const items = list(raw.items).map(record).filter((i) => str(i.label) && str(i.value));
      return items.length ? { type: "metrics", items: items.map((i) => ({ label: str(i.label), value: str(i.value), note: str(i.note) })) } : null;
    }
    case "cards": {
      const items = list(raw.items).map(record).filter((i) => str(i.title));
      return items.length ? { type: "cards", items: items.map((i) => ({ title: str(i.title), text: str(i.text), link: link(i.link), message: str(i.message), image: link(i.image) })) } : null;
    }
    case "chart": {
      const points = list(raw.points).map(record).filter((p) => Number.isFinite(Number(p.value)));
      return points.length ? { type: "chart", title: str(raw.title), shape: raw.shape === "line" ? "line" : "bar", points: points.map((p) => ({ label: str(p.label), value: Number(p.value) })) } : null;
    }
    case "buttons": {
      const options = list(raw.options).map(record).filter((o) => str(o.label));
      return options.length ? { type: "buttons", options: options.map((o) => ({ label: str(o.label), message: str(o.message) || str(o.label) })) } : null;
    }
    case "file": {
      const path = workspacePath(raw.path);
      return path ? { type: "file", path, name: str(raw.name) || path.split("/").pop()! } : null;
    }
    case "openui":
      return str(raw.source).trim() ? { type: "openui", source: str(raw.source) } : null;
    case "page":
      return str(raw.html) ? { type: "page", title: str(raw.title), html: str(raw.html) } : null;
    default:
      return null;
  }
}

export function blocksOf(args: unknown): Block[] {
  const { blocks, ui, page } = record(args);
  if (Array.isArray(blocks)) return blocks.flatMap((b) => blockOf(record(b)) ?? []);
  return [blockOf({ type: "openui", source: ui }), blockOf({ type: "page", ...record(page) })].flatMap((b) => b ?? []);
}
