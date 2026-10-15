import { rm } from "node:fs/promises";
import { join } from "node:path";
import { SCRATCH, WORKSPACE } from "../common.mjs";
import { AGENTS_GID } from "../config.mjs";
import { folder } from "../users.mjs";
import { homeOf, isIsolated } from "./agents.mjs";

export const scratchOf = (id) => join(SCRATCH, id);

let clearing = Promise.resolve();

export const makeScratch = (agent) => clearing.then(() => folder(SCRATCH, 0, AGENTS_GID, 0o751)).then(() => folder(scratchOf(agent.id), agent.uid, agent.uid, 0o700));

export const clearScratch = (id) => (clearing = clearing.then(() => rm(id ? scratchOf(id) : SCRATCH, { recursive: true, force: true }).catch(() => {})));

export const rulesOf = (agent) => (isIsolated(agent) ? isolatedRules(homeOf(agent), scratchOf(agent.id)) : workspaceRules(agent.folder, scratchOf(agent.id)));

const workspaceRules = (folder, scratch) => `## Your folder and the workspace

Your current folder is your home: ${folder}/ in the workspace, ${WORKSPACE}. The user looks through the workspace, and the other agents have folders of their own in it. Keep it tidy.

- Save your work in your folder: results, documents, code for a project. Put a task's files together in a folder with a clear name (for example \`robot-vacuum-comparison/\`), not loose at the top level; continue in the same folder when you come back to the task. Files the user attaches are in \`uploads/\` there.
- The rest of the workspace is shared: read anything in it, and use another agent's files when the user asks (for example \`../research/report.md\`). Write outside your folder only when the user asks, and never change another agent's files unless the user asks.
- Scratch work goes in ${scratch}, never in the workspace: downloaded or saved web pages, raw search results, one-off scripts, logs, intermediate data. It is your own folder and is emptied after you finish, so keep nothing there that the user needs.
- Name files for what they are (\`comparison.md\`, not \`out2.txt\`), and update a file instead of saving new copies of it (\`final\`, \`v2\`, \`new\`).
- Before you finish, delete any temporary files you left in the workspace.
- Never delete, move or rename files you did not make unless the user asks.
- When you name a file for the user, give its path from your folder (\`notes/plan.md\`) or in full; the chat makes it a link.`;

const isolatedRules = (home, scratch) => `## Your folder

Your current folder, ${home}, is the only one you have: you have no access to the user's workspace, the other agents' folders or the shared memory. The user looks through your folder, and the other agents may read and change it too.

- Save your work here: results, documents, code for a project. Put a task's files together in a folder with a clear name, and continue in the same folder when you come back to the task. Files the user attaches are in \`uploads/\` here.
- Keep your own notes as files here (for example \`notes.md\`): what the user told you, decisions, what you learned. Read them when you start on a task; nothing else is kept for you between chats.
- Scratch work goes in ${scratch}: downloaded or saved web pages, raw search results, one-off scripts, logs, intermediate data. It is emptied after you finish, so keep nothing there that the user needs.
- To get a skill, a plugin or an extension, ask for it with manage_agents; the user decides.
- Name files for what they are, update a file instead of saving new copies of it, and delete temporary files before you finish.
- When you name a file for the user, give its path from your folder (\`notes/plan.md\`) or in full; the chat makes it a link.`;
