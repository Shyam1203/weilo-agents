import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { fail } from "../common.mjs";
import { BIN, MAX_UNZIPPED } from "../config.mjs";

const run = promisify(execFile);

export async function unzip(dir, data, what) {
  const zip = join(dir, "upload.zip");
  const files = join(dir, "files");
  await writeFile(zip, Buffer.from(data, "base64"));
  const invalid = () => {
    throw fail(400, "The file is not a valid .zip file");
  };
  const { stdout } = await run(BIN.zipinfo, [zip]).catch(invalid);
  if (/^l/m.test(stdout)) throw fail(400, `This ${what} cannot contain links`);
  if (Number(/(\d+) bytes uncompressed/.exec(stdout)?.[1]) > MAX_UNZIPPED) throw fail(400, `The ${what} is too large (${MAX_UNZIPPED / 1e6} MB at most)`);
  await mkdir(files);
  await run(BIN.unzip, ["-q", zip, "-d", files]).catch(invalid);
  return files;
}
