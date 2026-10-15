// Writes the OpenUI component prompt that the daemon appends to the show tool's description.
// The prompt comes from the component library in src/features/chat/openui/library.tsx.
import { writeFile } from "node:fs/promises";
import { runnerImport } from "vite";

process.env.OPENUI_TELEMETRY_DISABLED = "1";
const { module } = await runnerImport("/src/features/chat/openui/library.tsx", { root: new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1") });
const prompt = module.library.prompt(module.PROMPT);
const out = new URL("../../daemon/openui-prompt.md", import.meta.url);
await writeFile(out, prompt.trim() + "\n");
console.log(`Wrote ${out.pathname} (${prompt.length} characters)`);
