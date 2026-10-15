import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { SCRATCH, WORKSPACE } from "../common.mjs";

// Keeping the workspace tidy. The user browses it; each agent works in a folder of its own there, its home, and can still
// read and write the rest. Each gets house rules for it, and a scratch folder outside it for what it only needs while it
// works (downloaded pages, one-off scripts, raw data). The scratch folder is emptied when the agent goes idle, and all of
// them when the app starts.

export const scratchOf = (id) => join(SCRATCH, id);

// Emptying a folder takes a moment: an agent that starts again meanwhile waits for it, so its new folder is not removed.
let clearing = Promise.resolve();

// The agent's scratch folder, ready for use.
export const makeScratch = (id) => clearing.then(() => mkdir(scratchOf(id), { recursive: true }));

// Empties one agent's scratch folder, or every agent's.
export const clearScratch = (id) => (clearing = clearing.then(() => rm(id ? scratchOf(id) : SCRATCH, { recursive: true, force: true }).catch(() => {})));

export const workspaceRules = (folder, scratch) => `## Your folder and the workspace

Your current folder is your home: ${folder}/ in the workspace, ${WORKSPACE}. The user looks through the workspace, and the other agents have folders of their own in it. Keep it tidy.

- Save your work in your folder: results, documents, code for a project. Put a task's files together in a folder with a clear name (for example \`robot-vacuum-comparison/\`), not loose at the top level; continue in the same folder when you come back to the task. Files the user attaches are in \`uploads/\` there.
- The rest of the workspace is shared: read anything in it, and use another agent's files when the user asks (for example \`../research/report.md\`). Write outside your folder only when the user asks, and never change another agent's files unless the user asks.
- Scratch work goes in ${scratch}, never in the workspace: downloaded or saved web pages, raw search results, one-off scripts, logs, intermediate data. It is your own folder and is emptied after you finish, so keep nothing there that the user needs.
- Name files for what they are (\`comparison.md\`, not \`out2.txt\`), and update a file instead of saving new copies of it (\`final\`, \`v2\`, \`new\`).
- Before you finish, delete any temporary files you left in the workspace.
- Never delete, move or rename files you did not make unless the user asks.
- When you name a file for the user, give its path from your folder (\`notes/plan.md\`) or in full; the chat makes it a link.`;
