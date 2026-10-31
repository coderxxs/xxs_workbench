#!/usr/bin/env node
import fs from "fs";
import readline from "readline";
import { audit, createRunId } from "./audit";
import {
  configPath,
  detectProject,
  findAgentHome,
  initializeConfig,
  loadConfig,
  writeConfig,
} from "./config";
import { runCaptured, runInteractive } from "./process";
import { chat, runAgent } from "./providers";
import { migrateLegacySecretFile, providerApiKey, secretValueStatus } from "./secrets";
import { AgentConfig, ProjectConfig, RiskLevel } from "./types";
import { buildAgentTools, executeAgentTool } from "./workbench";
import { PRODUCT_NAME, PRODUCT_VERSION } from "./version";

const HELP = `${PRODUCT_NAME} ${PRODUCT_VERSION}

Usage:
  xxs_workbench init [--force]
  xxs_workbench doctor
  xxs_workbench config path
  xxs_workbench secrets check
  xxs_workbench project add <id> <path>
  xxs_workbench project list
  xxs_workbench project show <id>
  xxs_workbench status [--all | <project>]
  xxs_workbench run <project> <command> [--yes]
  xxs_workbench model list
  xxs_workbench ask <prompt> [--provider <id>] [--model <name>]
  xxs_workbench task <request> [--project <id>] [--provider <id>] [--model <name>] [--yes]

Examples:
  xxs_workbench project add api /srv/workspace/api
  xxs_workbench status --all
  xxs_workbench run api test
  xxs_workbench ask "Summarize this failure" --provider deepseek
  xxs_workbench task "Check api status and run its tests" --project api
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return 0;
  }

  switch (command) {
    case "init":
      return initialize(args);
    case "doctor":
      return doctor();
    case "config":
      return configCommand(args);
    case "secrets":
      return secretsCommand(args);
    case "project":
      return projectCommand(args);
    case "status":
      return statusCommand(args);
    case "run":
      return runCommand(args);
    case "model":
      return modelCommand(args);
    case "ask":
      return askCommand(args);
    case "task":
      return taskCommand(args);
    default:
      throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  }
}

function initialize(args: string[]): number {
  const file = initializeConfig(findAgentHome(), args.includes("--force"));
  console.log(`Initialized: ${file}`);
  console.log("API Keys are configured from the Settings page and stored in SQLite.");
  return 0;
}

async function doctor(): Promise<number> {
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const pythonExecutable = process.env.DEV_AGENT_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const checks: Array<[string, string, string[]]> = [
    ["node", process.execPath, ["--version"]],
    ["python", pythonExecutable, ["--version"]],
    ["git", "git", ["--version"]],
    ["npm", npmExecutable, ["--version"]],
    ["docker", "docker", ["--version"]],
  ];
  let failures = 0;

  for (const [name, executable, args] of checks) {
    const result = await runCaptured(executable, args);
    if (result.code === 0) {
      console.log(`OK   ${name.padEnd(10)} ${result.stdout.trim() || result.stderr.trim()}`);
    } else {
      failures += name === "docker" ? 0 : 1;
      console.log(`${name === "docker" ? "WARN" : "FAIL"} ${name.padEnd(10)} ${result.stderr.trim() || "not available"}`);
    }
  }

  const file = configPath();
  if (!fs.existsSync(file)) {
    console.log(`FAIL config     not found (${file})`);
    return 1;
  }
  const config = loadConfig();
  console.log(`OK   config     ${file}`);
  for (const project of Object.values(config.projects)) {
    const exists = fs.existsSync(project.path);
    console.log(`${exists ? "OK  " : "FAIL"} project    ${project.id} -> ${project.path}`);
    if (!exists) failures += 1;
  }
  return failures === 0 ? 0 : 1;
}

function configCommand(args: string[]): number {
  if (args[0] !== "path") throw new Error("Usage: dev-agent config path");
  console.log(configPath());
  return 0;
}

function secretsCommand(args: string[]): number {
  const [subcommand] = args;
  if (subcommand === "check") {
    const config = loadConfig();
    console.log(`Secret storage: ${configPath()} (SQLite; environment variables override database values)`);
    for (const provider of Object.values(config.providers)) {
      const status = secretValueStatus(provider.apiKeyEnv);
      console.log(`${provider.id.padEnd(12)} ${status.configured ? `configured (${status.source})` : "missing"}`);
    }
    return 0;
  }
  throw new Error("Usage: xxs_workbench secrets check");
}

function projectCommand(args: string[]): number {
  const [subcommand, ...rest] = args;
  const config = loadConfig();
  if (subcommand === "add") {
    const [id, projectPath] = rest;
    if (!id || !projectPath) throw new Error("Usage: dev-agent project add <id> <path>");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) {
      throw new Error("Project id may contain letters, numbers, dot, underscore, and dash.");
    }
    if (config.projects[id]) throw new Error(`Project already exists: ${id}`);
    const project = detectProject(id, projectPath);
    config.projects[id] = project;
    writeConfig(config);
    console.log(`Added ${id}: ${project.path}`);
    console.log(`Stack: ${project.stack}; commands: ${Object.keys(project.commands).join(", ") || "none"}`);
    return 0;
  }
  if (subcommand === "list") {
    const projects = Object.values(config.projects);
    if (!projects.length) {
      console.log("No projects registered.");
      return 0;
    }
    for (const project of projects) {
      console.log(`${project.id.padEnd(20)} ${project.stack.padEnd(14)} ${project.path}`);
    }
    return 0;
  }
  if (subcommand === "show") {
    const project = requireProject(config, rest[0]);
    console.log(JSON.stringify(project, null, 2));
    return 0;
  }
  throw new Error("Usage: dev-agent project <add|list|show> ...");
}

async function statusCommand(args: string[]): Promise<number> {
  const config = loadConfig();
  let projects: ProjectConfig[];
  if (args.includes("--all")) {
    projects = Object.values(config.projects);
  } else if (args[0]) {
    projects = [requireProject(config, args[0])];
  } else {
    throw new Error("Usage: dev-agent status [--all | <project>]");
  }
  if (!projects.length) {
    console.log("No projects registered.");
    return 0;
  }

  let exitCode = 0;
  for (const project of projects) {
    console.log(`\n[${project.id}] ${project.path}`);
    if (!fs.existsSync(project.path)) {
      console.log("Project path does not exist.");
      exitCode = 1;
      continue;
    }
    const result = await runCaptured("git", ["status", "--short", "--branch"], project.path);
    if (result.code !== 0) {
      console.log(result.stderr.trim() || "Not a Git repository.");
      exitCode = 1;
    } else {
      console.log(result.stdout.trim() || "Clean worktree");
    }
  }
  return exitCode;
}

async function runCommand(args: string[]): Promise<number> {
  const [projectId, commandName] = args;
  if (!projectId || !commandName) throw new Error("Usage: dev-agent run <project> <command> [--yes]");
  const config = loadConfig();
  const project = requireProject(config, projectId);
  const registered = project.commands[commandName];
  if (!registered) {
    throw new Error(
      `Unknown command ${projectId}.${commandName}. Available: ${Object.keys(project.commands).join(", ") || "none"}`,
    );
  }
  if (registered.risk !== "read" && !args.includes("--yes")) {
    const approved = await confirmRisk(registered.risk, projectId, commandName, registered.command);
    if (!approved) {
      console.log("Cancelled.");
      return 2;
    }
  }

  const runId = createRunId();
  audit(runId, "started", "project.command", {
    projectId,
    commandName,
    risk: registered.risk,
    cwd: project.path,
  });
  console.log(`[${runId}] ${registered.command}`);
  try {
    const code = await runInteractive(registered.command, project.path);
    audit(runId, code === 0 ? "completed" : "failed", "project.command", { projectId, commandName, code });
    return code;
  } catch (error) {
    audit(runId, "failed", "project.command", { projectId, commandName, error: messageOf(error) });
    throw error;
  }
}

function modelCommand(args: string[]): number {
  if (args[0] !== "list") throw new Error("Usage: dev-agent model list");
  const config = loadConfig();
  for (const provider of Object.values(config.providers)) {
    const keyState = providerApiKey(provider.apiKeyEnv) ? "key:ready" : `key:missing(${provider.apiKeyEnv})`;
    const defaultMarker = provider.id === config.defaultProvider ? " default" : "";
    console.log(`${provider.id.padEnd(12)} ${provider.type.padEnd(20)} ${provider.defaultModel} ${keyState}${defaultMarker}`);
  }
  return 0;
}

async function askCommand(args: string[]): Promise<number> {
  const providerId = flagValue(args, "--provider");
  const model = flagValue(args, "--model");
  const promptParts = withoutFlags(args, ["--provider", "--model"]);
  const prompt = promptParts.join(" ").trim();
  if (!prompt) throw new Error("Usage: dev-agent ask <prompt> [--provider <id>] [--model <name>]");

  const config = loadConfig();
  const selectedId = providerId ?? config.defaultProvider;
  const provider = config.providers[selectedId];
  if (!provider) throw new Error(`Unknown provider: ${selectedId}`);

  const runId = createRunId();
  audit(runId, "started", "model.ask", {
    provider: selectedId,
    model: model ?? provider.defaultModel,
    promptCharacters: prompt.length,
  });
  try {
    const answer = await chat(provider, {
      prompt,
      model,
      system: "You are a pragmatic software engineering assistant. Be concise, explicit about uncertainty, and never claim an action was executed when it was not.",
    });
    console.log(answer);
    audit(runId, "completed", "model.ask", { provider: selectedId, outputCharacters: answer.length });
    return 0;
  } catch (error) {
    audit(runId, "failed", "model.ask", { provider: selectedId, error: messageOf(error) });
    throw error;
  }
}

async function taskCommand(args: string[]): Promise<number> {
  const allowRisk = args.includes("--yes");
  const cleanArgs = args.filter((value) => value !== "--yes");
  const providerId = flagValue(cleanArgs, "--provider");
  const model = flagValue(cleanArgs, "--model");
  const projectFilter = flagValue(cleanArgs, "--project");
  const prompt = withoutFlags(cleanArgs, ["--provider", "--model", "--project"]).join(" ").trim();
  if (!prompt) {
    throw new Error(
      "Usage: dev-agent task <request> [--project <id>] [--provider <id>] [--model <name>] [--yes]",
    );
  }

  const config = loadConfig();
  if (projectFilter) requireProject(config, projectFilter);
  const projects = projectFilter ? [config.projects[projectFilter]] : Object.values(config.projects);
  if (!projects.length) throw new Error("No projects registered. Add a project before running an agent task.");
  const selectedId = providerId ?? config.defaultProvider;
  const provider = config.providers[selectedId];
  if (!provider) throw new Error(`Unknown provider: ${selectedId}`);

  const projectIds = projects.map((project) => project.id);
  const tools = buildAgentTools(projects);
  const runId = createRunId();
  audit(runId, "started", "agent.task", {
    provider: selectedId,
    model: model ?? provider.defaultModel,
    projects: projectIds,
    promptCharacters: prompt.length,
  });

  try {
    const answer = await runAgent(provider, {
      prompt,
      model,
      tools,
      system: [
        "You are a local developer workbench agent.",
        "Use the supplied tools when the request depends on project state or requires running a registered command.",
        "Never invent command output, project names, or completed actions.",
        "Only registered commands are available; explain any capability that is missing.",
        `Projects in scope: ${projectIds.join(", ")}.`,
      ].join(" "),
      execute: (name, argumentsValue) =>
        executeAgentTool(config, projects, name, argumentsValue, {
          allowRisk,
          echoOutput: true,
          approveRisk: (project, commandName, command) =>
            confirmRisk(command.risk, project.id, commandName, command.command),
        }),
    });
    console.log(answer);
    audit(runId, "completed", "agent.task", { provider: selectedId, outputCharacters: answer.length });
    return 0;
  } catch (error) {
    audit(runId, "failed", "agent.task", { provider: selectedId, error: messageOf(error) });
    throw error;
  }
}


function requireProject(config: AgentConfig, id: string | undefined): ProjectConfig {
  if (!id || !config.projects[id]) throw new Error(`Unknown project: ${id ?? "<missing>"}`);
  return config.projects[id];
}

function confirmRisk(risk: RiskLevel, projectId: string, commandName: string, command: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`Command risk is ${risk}. Re-run with --yes for non-interactive approval.`);
  }
  const prompt = `Approve ${risk} command ${projectId}.${commandName}?\n  ${command}\nType \"yes\" to continue: `;
  return new Promise((resolve) => {
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    input.question(prompt, (answer) => {
      input.close();
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

function withoutFlags(args: string[], flags: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (flags.includes(args[index])) {
      index += 1;
    } else {
      result.push(args[index]);
    }
  }
  return result;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function bootstrap(): Promise<number> {
  const argv = process.argv.slice(2);
  migrateLegacySecretFile();
  return main(argv);
}

bootstrap()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`Error: ${messageOf(error)}`);
    process.exitCode = 1;
  });
