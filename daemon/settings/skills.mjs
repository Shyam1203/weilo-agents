import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { fail, SKILLS, slug } from "../common.mjs";
import { MAX_SKILL_DESCRIPTION, MAX_SKILL_TEXT, SKILL_DEPTH } from "../config.mjs";
import { unzip } from "./zip.mjs";

// Skills are pi's own: a folder in agent/skills/ with a SKILL.md. Which agent uses which is the
// agent's profile; this only keeps the library.

const ID = /^[\w-]+$/;

// A value from SKILL.md's front matter.
const field = (text, key) => {
  const value = (text.split(/^---\s*$/m)[1] ?? "").match(new RegExp(`^${key}:[ \\t]*(.+)$`, "m"))?.[1].trim();
  if (value?.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {}
  }
  return value?.replace(/^["']|["']$/g, "");
};

export async function listSkills() {
  const ids = (await readdir(SKILLS).catch(() => [])).filter((id) => ID.test(id));
  const skills = await Promise.all(
    ids.map(async (id) => {
      const text = await readFile(join(SKILLS, id, "SKILL.md"), "utf8").catch(() => null);
      return text && { id, name: field(text, "name") ?? id, description: field(text, "description") ?? "" };
    }),
  );
  return skills.filter(Boolean);
}

// The folders at or under `dir` that hold a SKILL.md.
async function skillFolders(dir, depth = 0) {
  if (await access(join(dir, "SKILL.md")).then(() => true, () => false)) return [dir];
  if (depth === SKILL_DEPTH) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => skillFolders(join(dir, e.name), depth + 1)));
  return nested.flat();
}

// Adds the skills in an uploaded .zip or SKILL.md (base64), replacing any with the same name.
export async function addSkills({ name, data }) {
  if (typeof name !== "string" || typeof data !== "string") throw fail(400, "The file is not valid");
  const kind = extname(name).toLowerCase();
  if (kind !== ".zip" && kind !== ".md") throw fail(400, "Add a .zip file or a SKILL.md file");
  const work = await mkdtemp(join(tmpdir(), "skill-"));
  try {
    let files = join(work, "files");
    if (kind === ".md") {
      await mkdir(files);
      await writeFile(join(files, "SKILL.md"), Buffer.from(data, "base64"));
    } else files = await unzip(work, data, "skill");
    const folders = await skillFolders(files);
    if (!folders.length) throw fail(400, "The file does not contain a SKILL.md");
    // Check every skill before adding any.
    const found = await Promise.all(
      folders.map(async (folder) => {
        const text = await readFile(join(folder, "SKILL.md"), "utf8");
        if (!field(text, "description")) throw fail(400, "A skill needs a description in its SKILL.md");
        const id = slug(field(text, "name") ?? (folder === files ? basename(name, extname(name)) : basename(folder)), 48);
        if (!id) throw fail(400, "The skill has no name");
        return { folder, id };
      }),
    );
    await mkdir(SKILLS, { recursive: true });
    for (const { folder, id } of found) {
      await rm(join(SKILLS, id), { recursive: true, force: true });
      await cp(folder, join(SKILLS, id), { recursive: true });
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// A skill an agent makes (its `skill` tool): the folder is the library's, so Settings lists it. SKILL.md is written whole; other files
// in the folder (an earlier version's scripts) stay. Returns the skill's id and folder, for the agent to add files to.
export async function saveSkill({ name, description, instructions } = {}) {
  const id = typeof name === "string" ? slug(name, 48) : "";
  if (!id) throw fail(400, "Give the skill a name");
  const about = typeof description === "string" ? description.replace(/\s+/g, " ").trim() : "";
  if (!about) throw fail(400, "Give the skill a description: when to use it");
  if (about.length > MAX_SKILL_DESCRIPTION) throw fail(400, `The description is too long. Use ${MAX_SKILL_DESCRIPTION} characters at most.`);
  if (typeof instructions !== "string" || !instructions.trim()) throw fail(400, "Give the skill its instructions");
  if (instructions.length > MAX_SKILL_TEXT) throw fail(400, `The instructions are too long. Use ${MAX_SKILL_TEXT} characters at most.`);
  const folder = join(SKILLS, id);
  await mkdir(folder, { recursive: true });
  // Quoted when plain YAML would misread it (a colon and a space, a leading symbol).
  const line = /: |\s#|^[-?&*!|>%@`'"[\]{}]/.test(about) ? JSON.stringify(about) : about;
  await writeFile(join(folder, "SKILL.md"), `---\nname: ${id}\ndescription: ${line}\n---\n\n${instructions.trim()}\n`);
  return { id, folder };
}

export async function removeSkill(id) {
  if (!ID.test(id)) throw fail(404, "This skill does not exist");
  await rm(join(SKILLS, id), { recursive: true, force: true });
}

// The folders of these skills that exist, for pi's command line.
export async function skillPaths(ids) {
  const have = new Set(await readdir(SKILLS).catch(() => []));
  return ids.filter((id) => have.has(id)).map((id) => join(SKILLS, id));
}
