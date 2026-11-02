import fs from "fs";
import os from "os";
import path from "path";
import { randomBytes } from "crypto";
import { findAgentHome } from "./config";
import { loadRecords, replaceRecords } from "./database";
import { AgentToolPermission, AssigneeRole, DevelopmentPerson, PersonAgentProfile, PersonGender } from "./types";

const PEOPLE_FILE = "people.json";
const PEOPLE_AGENT_ARCHIVE_FILE = "people-agent-archive.json";
const ROLES: AssigneeRole[] = ["developer", "tester", "deployer", "releaser", "operator"];
const TOOLS: AgentToolPermission[] = ["inspect_repositories", "run_read_commands", "run_write_commands", "run_deploy_commands"];

export interface NewPerson {
  name: string;
  age?: number;
  gender?: PersonGender;
  signature?: string;
  roles: AssigneeRole[];
}

export interface AgentProfileInput {
  id?: string;
  name: string;
  role: AssigneeRole;
  providerId: string;
  skillIds: string[];
  toolIds: AgentToolPermission[];
  repositoryIds: string[];
  environmentIds: string[];
}

export function peoplePath(home = findAgentHome()): string {
  return path.join(home, PEOPLE_FILE);
}

export function peopleAgentArchivePath(home = findAgentHome()): string {
  return path.join(home, PEOPLE_AGENT_ARCHIVE_FILE);
}

export function loadPeople(home = findAgentHome()): DevelopmentPerson[] {
  const parsed = loadRecords<DevelopmentPerson>(home, "people");
  parsed.forEach(validatePerson);
  return parsed;
}

export function createPerson(input: NewPerson, home = findAgentHome()): DevelopmentPerson {
  const people = loadPeople(home);
  const now = new Date().toISOString();
  const person: DevelopmentPerson = {
    id: `person-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
    name: input.name,
    age: input.age,
    gender: input.gender,
    signature: input.signature,
    roles: unique(input.roles),
    agents: [],
    createdAt: now,
    updatedAt: now,
  };
  validatePerson(person);
  people.unshift(person);
  writePeople(people, home);
  return person;
}

export function updatePerson(personId: string, input: NewPerson, home = findAgentHome()): DevelopmentPerson {
  const people = loadPeople(home);
  const person = people.find((item) => item.id === personId);
  if (!person) throw new Error(`Unknown person: ${personId}`);
  const roles = unique(input.roles);
  const unsupportedAgent = person.agents.find((agent) => !roles.includes(agent.role));
  if (unsupportedAgent) throw new Error(`Role ${unsupportedAgent.role} is still used by Agent: ${unsupportedAgent.name}`);
  person.name = input.name;
  person.age = input.age;
  person.gender = input.gender;
  person.signature = input.signature;
  delete person.personality;
  person.roles = roles;
  person.updatedAt = new Date().toISOString();
  validatePerson(person);
  writePeople(people, home);
  return person;
}

export function deletePerson(personId: string, home = findAgentHome()): DevelopmentPerson {
  const people = loadPeople(home);
  const index = people.findIndex((item) => item.id === personId);
  if (index < 0) throw new Error(`Unknown person: ${personId}`);
  const [removed] = people.splice(index, 1);
  writePeople(people, home);
  return removed;
}

export function savePersonAgent(personId: string, input: AgentProfileInput, home = findAgentHome()): DevelopmentPerson {
  const people = loadPeople(home);
  const person = people.find((item) => item.id === personId);
  if (!person) throw new Error(`Unknown person: ${personId}`);
  if (!person.roles.includes(input.role)) throw new Error(`Agent role is not assigned to person: ${input.role}`);
  const now = new Date().toISOString();
  const existing = input.id ? person.agents.find((agent) => agent.id === input.id) : undefined;
  if (input.id && !existing) throw new Error(`Unknown agent: ${input.id}`);
  if (!existing && person.agents.length) throw new Error("Person already has an Agent. Edit the existing Agent instead.");
  const agent: PersonAgentProfile = {
    id: existing?.id ?? `agent-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
    name: input.name,
    role: input.role,
    providerId: input.providerId,
    skillIds: unique(input.skillIds),
    toolIds: unique(input.toolIds),
    repositoryIds: unique(input.repositoryIds),
    environmentIds: unique(input.environmentIds),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  validateAgent(agent);
  person.agents = [agent];
  person.updatedAt = now;
  writePeople(people, home);
  return person;
}

export function consolidatePersonAgents(home = findAgentHome()): Record<string, string> {
  // Read raw records here because this migration intentionally repairs the
  // legacy multi-Agent shape before normal validation is applied.
  const parsed = loadRecords<DevelopmentPerson>(home, "people");
  const replacements: Record<string, string> = {};
  const archivedPeople: Array<Record<string, unknown>> = [];
  for (const value of parsed) {
    if (!isRecord(value) || !Array.isArray(value.agents) || value.agents.length <= 1) continue;
    const ordered = [...value.agents].sort((left, right) => agentTimestamp(right) - agentTimestamp(left));
    const kept = ordered[0] as PersonAgentProfile;
    const removed = ordered.slice(1) as PersonAgentProfile[];
    removed.forEach((agent) => { replacements[agent.id] = kept.id; });
    archivedPeople.push({
      personId: value.id,
      personName: value.name,
      keptAgentId: kept.id,
      removedAgents: removed,
    });
    value.agents = [kept];
    value.updatedAt = kept.updatedAt;
  }
  if (!archivedPeople.length) return replacements;
  writePeople(parsed as DevelopmentPerson[], home);
  const archiveFile = peopleAgentArchivePath(home);
  const history = fs.existsSync(archiveFile) ? JSON.parse(fs.readFileSync(archiveFile, "utf8")) : [];
  if (!Array.isArray(history)) throw new Error("People Agent archive must be an array.");
  history.push({
    archivedAt: new Date().toISOString(),
    reason: "single-agent-per-person",
    people: archivedPeople,
  });
  writeJsonAtomically(archiveFile, history);
  return replacements;
}

export function ensurePersonAgentSkill(skillId: string, home = findAgentHome()): number {
  const people = loadPeople(home);
  const now = new Date().toISOString();
  let changed = 0;
  for (const person of people) {
    const agent = person.agents[0];
    if (!agent || agent.skillIds.includes(skillId)) continue;
    agent.skillIds.push(skillId);
    agent.updatedAt = now;
    person.updatedAt = now;
    changed += 1;
  }
  if (changed) writePeople(people, home);
  return changed;
}

export function findPersonAgent(agentId: string, home = findAgentHome()): { person: DevelopmentPerson; agent: PersonAgentProfile } | undefined {
  for (const person of loadPeople(home)) {
    const agent = person.agents.find((item) => item.id === agentId);
    if (agent) return { person, agent };
  }
  return undefined;
}

export function hasPersonAgentForRole(person: DevelopmentPerson, role: AssigneeRole): boolean {
  return person.agents.length === 1 && person.agents[0].role === role;
}

export function writePeople(people: DevelopmentPerson[], home = findAgentHome()): void {
  people.forEach(validatePerson);
  replaceRecords(home, "people", people);
}

function validatePerson(value: unknown): void {
  if (!isRecord(value)) throw new Error("Invalid person record.");
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    (value.age !== undefined && (!Number.isInteger(value.age) || value.age < 1 || value.age > 120)) ||
    (value.gender !== undefined && !["male", "female", "other"].includes(value.gender)) ||
    (value.signature !== undefined && typeof value.signature !== "string") ||
    (value.personality !== undefined && typeof value.personality !== "string") ||
    !Array.isArray(value.roles) ||
    !value.roles.length ||
    value.roles.some((role) => !ROLES.includes(role)) ||
    !Array.isArray(value.agents) ||
    value.agents.length > 1 ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error(`Invalid person: ${String(value.id || "unknown")}`);
  }
  value.agents.forEach(validateAgent);
}

function agentTimestamp(value: unknown): number {
  if (!isRecord(value)) return 0;
  const updated = typeof value.updatedAt === "string" ? Date.parse(value.updatedAt) : Number.NaN;
  const created = typeof value.createdAt === "string" ? Date.parse(value.createdAt) : Number.NaN;
  return Number.isFinite(updated) ? updated : Number.isFinite(created) ? created : 0;
}

function writeJsonAtomically(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}${os.EOL}`, "utf8");
  fs.renameSync(temporary, file);
}

function validateAgent(value: unknown): void {
  if (!isRecord(value)) throw new Error("Invalid person agent.");
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !ROLES.includes(value.role) ||
    typeof value.providerId !== "string" ||
    !isStringArray(value.skillIds) ||
    !isStringArray(value.toolIds) ||
    value.toolIds.some((tool) => !TOOLS.includes(tool as AgentToolPermission)) ||
    !isStringArray(value.repositoryIds) ||
    !isStringArray(value.environmentIds) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error(`Invalid person agent: ${String(value.id || "unknown")}`);
  }
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
