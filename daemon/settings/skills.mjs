import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { fail, SKILLS, slug } from "../common.mjs";
import { SKILL_DEPTH } from "../config.mjs";
import { unzip } from "./zip.mjs";

// Skills are pi's own: a folder in agent/skills/ with a SKILL.md. Which agent uses which is the
// agent's profile; this only keeps the library.

const ID = /^[\w-]+$/;

// A value from SKILL.md's front matter.
const field = (text, key) => (text.split(/^---\s*$/m)[1] ?? "").match(new RegExp(`^${key}:[ \\t]*(.+)$`, "m"))?.[1].trim().replace(/^["']|["']$/g, "");

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

export async function removeSkill(id) {
  if (!ID.test(id)) throw fail(404, "This skill does not exist");
  await rm(join(SKILLS, id), { recursive: true, force: true });
}

// The folders of these skills that exist, for pi's command line.
export async function skillPaths(ids) {
  const have = new Set(await readdir(SKILLS).catch(() => []));
  return ids.filter((id) => have.has(id)).map((id) => join(SKILLS, id));
}
