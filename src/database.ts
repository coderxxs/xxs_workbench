import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { AuditEvent } from "./types";

export type SqliteCollection = "people" | "milestones" | "workflows" | "group_chats" | "content_items";

const DATABASE_FILE = "dev-work-agent.sqlite";
const initializedDatabases = new Set<string>();

export function databasePath(home: string): string {
  return path.join(home, DATABASE_FILE);
}

export function initializeDatabase(home: string): void {
  const file = databasePath(home);
  if (initializedDatabases.has(file) && fs.existsSync(file)) return;
  fs.mkdirSync(home, { recursive: true });
  invokeSqlite(home, { action: "initialize" });
  invokeSqlite(home, legacyImportPayload(home));
  initializedDatabases.add(file);
}

export function hasStoredConfig(home: string): boolean {
  initializeDatabase(home);
  return invokeSqlite<boolean>(home, { action: "has_config" });
}

export function loadStoredConfig<T>(home: string): T | null {
  initializeDatabase(home);
  return invokeSqlite<T | null>(home, { action: "get_config" });
}

export function saveStoredConfig(home: string, data: unknown): void {
  initializeDatabase(home);
  invokeSqlite(home, { action: "set_config", data });
}

export function loadStoredSecret(home: string, name: string): string | null {
  initializeDatabase(home);
  return invokeSqlite<string | null>(home, { action: "get_secret", name });
}

export function saveStoredSecret(home: string, name: string, value: string): void {
  initializeDatabase(home);
  invokeSqlite(home, { action: "set_secret", name, value });
}

export function deleteStoredSecret(home: string, name: string): boolean {
  initializeDatabase(home);
  return invokeSqlite<boolean>(home, { action: "delete_secret", name });
}

export function listStoredSecretNames(home: string): string[] {
  initializeDatabase(home);
  return invokeSqlite<string[]>(home, { action: "list_secret_names" });
}

export function loadRecords<T>(home: string, domain: SqliteCollection): T[] {
  initializeDatabase(home);
  return invokeSqlite<T[]>(home, { action: "list_records", domain });
}

export function replaceRecords(home: string, domain: SqliteCollection, records: unknown[]): void {
  initializeDatabase(home);
  invokeSqlite(home, { action: "replace_records", domain, records });
}

export function appendAuditEvent(home: string, event: AuditEvent): void {
  initializeDatabase(home);
  invokeSqlite(home, { action: "append_audit", event });
}

export function loadAuditEvents(home: string, limit: number): AuditEvent[] {
  initializeDatabase(home);
  return invokeSqlite<AuditEvent[]>(home, { action: "list_audit", limit });
}

export function databaseStats(home: string): Record<string, number> {
  initializeDatabase(home);
  return invokeSqlite<Record<string, number>>(home, { action: "stats" });
}

function legacyImportPayload(home: string): Record<string, unknown> {
  return {
    action: "import_legacy",
    config: readJsonFile(path.join(home, "config.json"), null),
    collections: {
      people: readJsonFile(path.join(home, "people.json"), []),
      milestones: readJsonFile(path.join(home, "milestones.json"), []),
      workflows: readJsonFile(path.join(home, "workflows.json"), []),
      group_chats: readJsonFile(path.join(home, "group-chats.json"), []),
      content_items: readJsonFile(path.join(home, "content-items.json"), []),
    },
    auditEvents: readJsonLines(path.join(home, "runs.jsonl")),
  };
}

function readJsonFile<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function readJsonLines(file: string): unknown[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function invokeSqlite<T = unknown>(home: string, input: Record<string, unknown>): T {
  const bridge = sqliteBridgePath();
  const payload = JSON.stringify({ ...input, databasePath: databasePath(home) });
  const python = process.env.DEV_AGENT_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(python, ["-X", "utf8", bridge], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, PYTHONUTF8: "1" },
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new Error(`Cannot start SQLite bridge with ${python}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`SQLite operation failed: ${(result.stderr || result.stdout).trim()}`);
  const output = result.stdout.trim();
  return (output ? JSON.parse(output) : null) as T;
}

function sqliteBridgePath(): string {
  const candidates = [
    path.join(__dirname, "sqlite_bridge.py"),
    path.join(process.cwd(), "src", "sqlite_bridge.py"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("SQLite bridge script was not found.");
  return found;
}
