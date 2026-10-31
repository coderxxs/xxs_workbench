import fs from "fs";
import path from "path";
import { findAgentHome } from "./config";

const SECRET_FILE = "secrets.env";
const TEMPLATE = `# 小小生开发工作台 local secrets
# Keep this file private. It is stored under .dev-agent/ and ignored by Git.
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
KIMI_API_KEY=
`;

export function secretFilePath(home = findAgentHome()): string {
  const configured = process.env.DEV_AGENT_ENV_FILE;
  return configured ? path.resolve(configured) : path.join(home, SECRET_FILE);
}

export function initializeSecretFile(home = findAgentHome(), force = false): string {
  const file = secretFilePath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, TEMPLATE, {
      encoding: "utf8",
      flag: force ? "w" : "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (isFileExistsError(error)) {
      throw new Error(`Secret file already exists: ${file}`);
    }
    throw error;
  }
  return file;
}

export function loadSecretFile(file = secretFilePath()): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  const values = parseEnv(fs.readFileSync(file, "utf8"));
  for (const [name, value] of Object.entries(values)) {
    // Explicit process environment always wins over the local file.
    if (process.env[name] === undefined) process.env[name] = value;
  }
  return file;
}

export function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`Invalid secret file line ${index + 1}: expected NAME=value.`);
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Invalid environment variable name on secret file line ${index + 1}.`);
    }
    result[name] = parseValue(line.slice(separator + 1).trim());
  }
  return result;
}

function parseValue(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return value;
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "EEXIST";
}
