import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { pipeline } from "node:stream";
import { promisify } from "node:util";
import { runtimeList } from "./runtime-manifest.mjs";

const pipe = promisify(pipeline);
const cacheDirectory = path.resolve(process.cwd(), ".cache", "linux-runtimes");
fs.mkdirSync(cacheDirectory, { recursive: true });

for (const runtime of runtimeList) {
  const target = path.join(cacheDirectory, runtime.fileName);
  if (fs.existsSync(target) && await sha256(target) === runtime.sha256) {
    console.log(`Using cached ${runtime.fileName}`);
    continue;
  }

  const partial = `${target}.partial`;
  let downloaded = false;
  for (let attempt = 1; attempt <= 3 && !downloaded; attempt += 1) {
    fs.rmSync(partial, { force: true });
    console.log(`Downloading ${runtime.url}${attempt > 1 ? ` (attempt ${attempt}/3)` : ""}`);
    try {
      await download(runtime.url, partial);
      downloaded = true;
    } catch (error) {
      fs.rmSync(partial, { force: true });
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
  const actual = await sha256(partial);
  if (actual !== runtime.sha256) {
    fs.rmSync(partial, { force: true });
    throw new Error(`SHA-256 mismatch for ${runtime.fileName}: expected ${runtime.sha256}, got ${actual}`);
  }
  fs.renameSync(partial, target);
  console.log(`Verified ${runtime.fileName}`);
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  await pipe(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function download(url, target, redirects = 0) {
  if (redirects > 8) throw new Error(`Too many redirects while downloading ${url}`);
  await new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "xxs_workbench-builder/1.0.0.0" } }, (response) => {
      const location = response.headers.location;
      if (location && response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        download(new URL(location, url).toString(), target, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed (${response.statusCode}) for ${url}`));
        return;
      }
      const output = fs.createWriteStream(target, { flags: "wx" });
      pipe(response, output).then(resolve, reject);
    });
    request.setTimeout(120000, () => request.destroy(new Error(`Download timed out for ${url}`)));
    request.on("error", reject);
  });
}
