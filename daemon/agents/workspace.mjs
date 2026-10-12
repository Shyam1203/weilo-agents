import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { SCRATCH } from "../common.mjs";

// Keeping the shared workspace tidy. Every agent works in the same folder, which the user browses, so each gets house
// rules for it, and a scratch folder of its own outside it for what it only needs while it works (downloaded pages,
// one-off scripts, raw data). The scratch folder is emptied when the agent goes idle, and all of them when the app starts.

export const scratchOf = (id) => join(SCRATCH, id);

// Emptying a folder takes a moment: an agent that starts again meanwhile waits for it, so its new folder is not removed.
let clearing = Promise.resolve();

// The agent's scratch folder, ready for use.
export const makeScratch = (id) => clearing.then(() => mkdir(scratchOf(id), { recursive: true }));

// Empties one agent's scratch folder, or every agent's.
export const clearScratch = (id) => (clearing = clearing.then(() => rm(id ? scratchOf(id) : SCRATCH, { recursive: true, force: true }).catch(() => {})));

export const workspaceRules = (scratch) => `## Keeping the workspace tidy

Your current folder is the workspace: the user and the other agents share it, and the user looks through it. Keep it tidy.

- Scratch work goes in ${scratch}, never in the workspace: downloaded or saved web pages, raw search results, one-off scripts, logs, intermediate data. It is your own folder and is emptied after you finish, so keep nothing there that the user needs.
- Save in the workspace only what the user wants to keep: results, documents, code for a project. Put a task's files together in one folder with a clear name (for example \`robot-vacuum-comparison/\`), not loose at the top level; continue in the same folder when you come back to the task.
- Name files for what they are (\`comparison.md\`, not \`out2.txt\`), and update a file instead of saving new copies of it (\`final\`, \`v2\`, \`new\`).
- Before you finish, delete any temporary files you left in the workspace.
- Never delete, move or rename files you did not make unless the user asks.`;
