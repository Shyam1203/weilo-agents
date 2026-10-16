// Compresses the built files once, so the app does not do it when it starts.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const SQUEEZE = new Set([".html", ".js", ".css", ".json", ".svg", ".webmanifest"]);
const dist = join(import.meta.dirname, "..", "dist");

for (const entry of await readdir(dist, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !SQUEEZE.has(extname(entry.name))) continue;
  const file = join(entry.parentPath, entry.name);
  const data = await readFile(file);
  await writeFile(`${file}.br`, brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY } }));
  await writeFile(`${file}.gz`, gzipSync(data, { level: 9 }));
}
