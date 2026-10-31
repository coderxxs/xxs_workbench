import { spawn } from "child_process";

export interface CapturedResult {
  code: number;
  stdout: string;
  stderr: string;
  truncated?: boolean;
}

export function runCaptured(
  executable: string,
  args: string[],
  cwd = process.cwd(),
  timeoutMs = 15_000,
): Promise<CapturedResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function runShellCaptured(
  command: string,
  cwd: string,
  timeoutMs = 10 * 60_000,
  maxCharacters = 200_000,
): Promise<CapturedResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;

    const append = (current: string, chunk: Buffer): string => {
      const combined = current + chunk.toString();
      if (combined.length <= maxCharacters) return combined;
      truncated = true;
      return combined.slice(-maxCharacters);
    };

    const timer = setTimeout(() => {
      if (!settled) child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}`, truncated });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, truncated });
    });
  });
}

export function runInteractive(command: string, cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: false,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}
