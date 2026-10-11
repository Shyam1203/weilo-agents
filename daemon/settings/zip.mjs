import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { fail } from "../common.mjs";
import { MAX_UNZIPPED } from "../config.mjs";

const run = promisify(execFile);

// Unpacks an uploaded .zip (base64) into `dir/files`, after the checks that make it safe to unpack. `what` names the
// upload in the refusals ("skill", "add-on"). Returns the folder.
export async function unzip(dir, data, what) {
  const zip = join(dir, "upload.zip");
  const files = join(dir, "files");
  await writeFile(zip, Buffer.from(data, "base64"));
  const invalid = () => {
    throw fail(400, "The file is not a valid .zip file");
  };
  const { stdout } = await run("zipinfo", [zip]).catch(invalid);
  // A link in the archive could reach any file on this computer.
  if (/^l/m.test(stdout)) throw fail(400, `This ${what} cannot contain links`);
  // A small zip can hold a huge amount of data.
  if (Number(/(\d+) bytes uncompressed/.exec(stdout)?.[1]) > MAX_UNZIPPED) throw fail(400, `The ${what} is too large (${MAX_UNZIPPED / 1e6} MB at most)`);
  await mkdir(files);
  await run("unzip", ["-q", zip, "-d", files]).catch(invalid);
  return files;
}
