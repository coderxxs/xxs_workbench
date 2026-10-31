import fs from "fs";
import path from "path";
import { findAgentHome } from "./config";
import { deleteStoredSecret, listStoredSecretNames, loadStoredSecret, saveStoredSecret } from "./database";

const LEGACY_SECRET_FILE = "secrets.env";

export type SecretValueSource = "environment" | "database" | null;

export interface SecretValueStatus {
  configured: boolean;
  databaseConfigured: boolean;
  source: SecretValueSource;
}

export function legacySecretFilePath(home = findAgentHome()): string {
  const configured = process.env.DEV_AGENT_ENV_FILE;
  return configured ? path.resolve(configured) : path.join(home, LEGACY_SECRET_FILE);
}

export function migrateLegacySecretFile(home = findAgentHome(), file = legacySecretFilePath(home)): number {
  if (!fs.existsSync(file)) return 0;
  const values = parseEnv(fs.readFileSync(file, "utf8"));
  let migrated = 0;
  for (const [name, value] of Object.entries(values)) {
    if (!value || loadStoredSecret(home, name)) continue;
    saveStoredSecret(home, name, value);
    migrated += 1;
  }
  fs.rmSync(file);
  return migrated;
}

export function providerApiKey(name: string, home = findAgentHome()): string | undefined {
  validateSecretName(name);
  return process.env[name] || loadStoredSecret(home, name) || undefined;
}

export function saveSecretValue(name: string, value: string, home = findAgentHome()): void {
  validateSecretName(name);
  const normalized = value.trim();
  if (!normalized) throw new Error("API Key cannot be empty.");
  if (normalized.length > 16_384) throw new Error("API Key is too long.");
  saveStoredSecret(home, name, normalized);
}

export function deleteSecretValue(name: string, home = findAgentHome()): boolean {
  validateSecretName(name);
  return deleteStoredSecret(home, name);
}

export function secretValueStatus(name: string, home = findAgentHome()): SecretValueStatus {
  validateSecretName(name);
  const databaseConfigured = listStoredSecretNames(home).includes(name);
  const source: SecretValueSource = process.env[name]
    ? "environment"
    : databaseConfigured
      ? "database"
      : null;
  return { configured: source !== null, databaseConfigured, source };
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
    validateSecretName(name, `Invalid environment variable name on secret file line ${index + 1}.`);
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

function validateSecretName(name: string, message = "Invalid secret name."): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(message);
}
