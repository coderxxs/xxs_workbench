import { audit, createRunId } from "./audit";
import { runCaptured, runShellCaptured } from "./process";
import { AgentTool } from "./providers";
import { AgentConfig, AgentToolPermission, ProjectCommand, ProjectConfig, RiskLevel } from "./types";

const ALL_TOOL_PERMISSIONS: AgentToolPermission[] = [
  "inspect_repositories",
  "run_read_commands",
  "run_write_commands",
  "run_deploy_commands",
];

export interface ToolExecutionOptions {
  allowRisk?: boolean;
  allowedTools?: AgentToolPermission[];
  echoOutput?: boolean;
  approveRisk?: (
    project: ProjectConfig,
    commandName: string,
    command: ProjectCommand,
  ) => Promise<boolean>;
}

export function buildAgentTools(projects: ProjectConfig[], allowedTools: AgentToolPermission[] = ALL_TOOL_PERMISSIONS): AgentTool[] {
  const projectIds = projects.map((project) => project.id);
  const commandSummary = projects
    .map((project) => {
      const commands = Object.entries(project.commands)
        .filter(([, command]) => allowedTools.includes(permissionForRisk(command.risk)))
        .map(([name, command]) => `${name}(${command.risk})`)
        .join(", ");
      return `${project.id}: ${commands || "no registered commands"}`;
    })
    .join("; ");
  const projectParameter = {
    type: "string",
    enum: projectIds,
    description: "Registered project id.",
  };

  const tools: AgentTool[] = [];
  if (allowedTools.includes("inspect_repositories")) tools.push({
      name: "get_project",
      description: "Read a project's path, detected stack, and registered command metadata.",
      parameters: {
        type: "object",
        properties: { projectId: projectParameter },
        required: ["projectId"],
        additionalProperties: false,
      },
    });
  if (allowedTools.includes("inspect_repositories")) tools.push({
      name: "get_git_status",
      description: "Read the current Git branch and worktree status of a registered project.",
      parameters: {
        type: "object",
        properties: { projectId: projectParameter },
        required: ["projectId"],
        additionalProperties: false,
      },
    });
  if (allowedTools.some((tool) => tool !== "inspect_repositories")) tools.push({
      name: "run_project_command",
      description: `Run one command from the project registry and return its output. Available commands: ${commandSummary}`,
      parameters: {
        type: "object",
        properties: {
          projectId: projectParameter,
          commandName: { type: "string", description: "Exact registered command name." },
        },
        required: ["projectId", "commandName"],
        additionalProperties: false,
      },
    });
  return tools;
}

export async function executeAgentTool(
  config: AgentConfig,
  scopedProjects: ProjectConfig[],
  name: string,
  argumentsValue: Record<string, unknown>,
  options: ToolExecutionOptions = {},
): Promise<unknown> {
  const allowedTools = options.allowedTools ?? ALL_TOOL_PERMISSIONS;
  const projectId = typeof argumentsValue.projectId === "string" ? argumentsValue.projectId : "";
  if (!scopedProjects.some((project) => project.id === projectId)) {
    throw new Error(`Project is outside this task's scope: ${projectId}`);
  }
  const project = config.projects[projectId];
  if (!project) throw new Error(`Unknown project: ${projectId}`);

  if (name === "get_project") {
    requireToolPermission(allowedTools, "inspect_repositories");
    return {
      ok: true,
      project: {
        id: project.id,
        name: project.name,
        path: project.path,
        stack: project.stack,
        commands: project.commands,
      },
    };
  }
  if (name === "get_git_status") {
    requireToolPermission(allowedTools, "inspect_repositories");
    const result = await runCaptured("git", ["status", "--short", "--branch"], project.path);
    return { ok: result.code === 0, code: result.code, stdout: result.stdout, stderr: result.stderr };
  }
  if (name === "run_project_command") {
    const commandName = typeof argumentsValue.commandName === "string" ? argumentsValue.commandName : "";
    const registered = project.commands[commandName];
    if (!registered) throw new Error(`Command is not registered for ${projectId}: ${commandName}`);
    requireToolPermission(allowedTools, permissionForRisk(registered.risk));

    if (registered.risk !== "read" && !options.allowRisk) {
      const approved = options.approveRisk
        ? await options.approveRisk(project, commandName, registered)
        : false;
      if (!approved) {
        return {
          ok: false,
          approvalRequired: true,
          projectId,
          commandName,
          risk: registered.risk,
          reason: "This command requires explicit local approval.",
        };
      }
    }

    const toolRunId = createRunId();
    audit(toolRunId, "started", "agent.project-command", {
      projectId,
      commandName,
      risk: registered.risk,
    });
    const result = await runShellCaptured(registered.command, project.path);
    audit(toolRunId, result.code === 0 ? "completed" : "failed", "agent.project-command", {
      projectId,
      commandName,
      code: result.code,
      truncated: result.truncated ?? false,
    });
    const stdout = tail(result.stdout, 12_000);
    const stderr = tail(result.stderr, 12_000);
    if (options.echoOutput) {
      if (stdout) process.stdout.write(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
      if (stderr) process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
    }
    return { ok: result.code === 0, code: result.code, stdout, stderr, truncated: result.truncated ?? false };
  }
  throw new Error(`Unknown agent tool: ${name}`);
}

function permissionForRisk(risk: RiskLevel): AgentToolPermission {
  if (risk === "deploy") return "run_deploy_commands";
  if (risk === "write") return "run_write_commands";
  return "run_read_commands";
}

function requireToolPermission(allowedTools: AgentToolPermission[], required: AgentToolPermission): void {
  if (!allowedTools.includes(required)) throw new Error(`Agent profile does not allow tool capability: ${required}`);
}

function tail(value: string, maxCharacters: number): string {
  return value.length <= maxCharacters ? value : value.slice(-maxCharacters);
}
