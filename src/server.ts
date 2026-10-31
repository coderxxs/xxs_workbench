import fs from "fs";
import http, { IncomingMessage, ServerResponse } from "http";
import path from "path";
import { audit, createRunId, readAudit } from "./audit";
import { AGENT_PRESET_CATALOG, SKILL_CATALOG, skillInstruction, TOOL_CATALOG } from "./capabilities";
import { configPath, detectProject, findAgentHome, initializeConfig, loadConfig, writeConfig } from "./config";
import { hasStoredConfig } from "./database";
import { listLocalDirectories, suggestRepositoryId } from "./directory-browser";
import { createGroupChat, loadGroupChats, mentionedGroupChatMemberIds, postGroupChatMessage } from "./group-chats";
import { consolidatePersonAgents, createPerson, deletePerson, ensurePersonAgentSkill, findPersonAgent, hasPersonAgentForRole, loadPeople, savePersonAgent, updatePerson } from "./people";
import { runCaptured, runShellCaptured } from "./process";
import { chat, runAgent } from "./providers";
import { loadSecretFile, secretFilePath } from "./secrets";
import { currentUser } from "./session";
import { AgentConfig, AgentToolPermission, AssigneeRole, DevelopmentMilestone, DevelopmentPerson, DevelopmentWorkflow, GroupChat, GroupChatActivity, PersonAgentProfile, ProductConfig, ProductDeployment, ProductEnvironment, ProjectConfig, TaskExecutionStage, WorkflowStage, WorkflowTaskItem } from "./types";
import { buildAgentTools, executeAgentTool } from "./workbench";
import { createMilestone, createWorkflow, loadMilestones, loadWorkflows, parseWorkflowTaskItems, saveWorkflow } from "./workflows";
import { PRODUCT_NAME, PRODUCT_VERSION } from "./version";

interface ServerOptions {
  webRoot?: string;
}

interface ProjectSnapshot {
  id: string;
  name: string;
  path: string;
  stack: string;
  exists: boolean;
  branch: string;
  changes: number;
  clean: boolean;
  gitAvailable: boolean;
  commands: ProjectConfig["commands"];
  ahead: number;
  behind: number;
  lastCommit: string;
}

interface ProductSnapshot extends Omit<ProductConfig, "environments"> {
  environments: ProductEnvironment[];
  repositoryDetails: ProjectSnapshot[];
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function createWorkbenchServer(options: ServerOptions = {}): http.Server {
  const webRoot = path.resolve(options.webRoot ?? path.join(process.cwd(), "web"));
  return http.createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url);
        return;
      }
      serveStatic(response, webRoot, url.pathname);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      sendJson(response, status, { ok: false, error: messageOf(error) });
    }
  });
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const method = request.method ?? "GET";
  if (method === "POST") validateWriteRequest(request);
  loadSecretFile();

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, service: PRODUCT_NAME, version: PRODUCT_VERSION, time: new Date().toISOString() });
    return;
  }
  if (method === "GET" && url.pathname === "/api/session") {
    sendJson(response, 200, { ok: true, user: currentUser() });
    return;
  }
  if (method === "GET" && url.pathname === "/api/overview") {
    const config = loadConfig();
    const repositories = await Promise.all(Object.values(config.projects).map(projectSnapshot));
    const products = productSnapshots(config, repositories);
    const runs = readRuns(12);
    sendJson(response, 200, {
      ok: true,
      workspace: path.dirname(findAgentHome()),
      products,
      repositories,
      projects: repositories,
      providers: publicProviders(config),
      recentRuns: runs,
      stats: {
        products: products.length,
        environments: products.reduce((total, product) => total + product.environments.length, 0),
        repositories: repositories.length,
        cleanRepositories: repositories.filter((repository) => repository.clean).length,
        readyProviders: Object.values(config.providers).filter((provider) => Boolean(process.env[provider.apiKeyEnv]))
          .length,
        completedRuns: runs.filter((run) => run.event === "completed").length,
      },
    });
    return;
  }
  if (method === "GET" && url.pathname === "/api/runs") {
    const requested = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 200) : 50;
    sendJson(response, 200, { ok: true, runs: readRuns(limit) });
    return;
  }
  if (method === "GET" && url.pathname === "/api/workflows") {
    sendJson(response, 200, { ok: true, milestones: loadMilestones(), workflows: loadWorkflows() });
    return;
  }
  if (method === "GET" && url.pathname === "/api/people") {
    sendJson(response, 200, { ok: true, people: loadPeople(), skills: SKILL_CATALOG, tools: TOOL_CATALOG, presets: AGENT_PRESET_CATALOG });
    return;
  }
  if (method === "GET" && url.pathname === "/api/group-chats") {
    sendJson(response, 200, { ok: true, groupChats: loadGroupChats() });
    return;
  }
  if (method === "GET" && url.pathname === "/api/doctor") {
    sendJson(response, 200, { ok: true, checks: await doctorChecks() });
    return;
  }
  if (method === "GET" && url.pathname === "/api/settings") {
    const config = loadConfig();
    sendJson(response, 200, {
      ok: true,
      configPath: configPath(),
      secretPath: secretFilePath(),
      providers: publicProviders(config),
    });
    return;
  }
  if (method === "POST" && url.pathname === "/api/directories") {
    const body = await readJsonBody(request);
    const requestedPath = typeof body.path === "string" ? body.path.trim() : undefined;
    const listing = listLocalDirectories(requestedPath || undefined);
    sendJson(response, 200, {
      ok: true,
      ...listing,
      suggestedId: listing.current ? suggestRepositoryId(path.basename(listing.current)) : "",
    });
    return;
  }
  if (method === "POST" && url.pathname === "/api/people") {
    const body = await readJsonBody(request);
    const person = createPerson({
      name: requiredString(body.name, "name"),
      roles: requiredRoleArray(body.roles, "roles"),
    });
    sendJson(response, 201, { ok: true, person });
    return;
  }
  if (method === "POST" && url.pathname === "/api/people/update") {
    const body = await readJsonBody(request);
    const personId = requiredIdentifier(body.id, "id");
    const roles = requiredRoleArray(body.roles, "roles");
    const requiredRoles = rolesRequiredByAssignedTasks(personId);
    const missingRole = Array.from(requiredRoles).find((role) => !roles.includes(role));
    if (missingRole) throw new HttpError(409, `Role ${missingRole} is still required by an assigned task.`);
    try {
      const person = updatePerson(personId, { name: requiredString(body.name, "name"), roles });
      sendJson(response, 200, { ok: true, person });
    } catch (error) {
      throw new HttpError(messageOf(error).startsWith("Unknown person") ? 404 : 409, messageOf(error));
    }
    return;
  }
  if (method === "POST" && url.pathname === "/api/people/delete") {
    const body = await readJsonBody(request);
    const personId = requiredIdentifier(body.id, "id");
    const person = loadPeople().find((item) => item.id === personId);
    if (!person) throw new HttpError(404, `Unknown person: ${personId}`);
    if (requiredString(body.confirmName, "confirmName") !== person.name) throw new HttpError(409, "Person name confirmation does not match.");
    const agentIds = new Set(person.agents.map((agent) => agent.id));
    const references = loadWorkflows().flatMap((workflow) => (workflow.taskItems || []).filter((task) =>
      task.ownerId === person.id || Boolean(task.agentId && agentIds.has(task.agentId)),
    ));
    if (references.length) throw new HttpError(409, `Person is still referenced by ${references.length} workflow task(s). Unassign those tasks first.`);
    deletePerson(person.id);
    sendJson(response, 200, { ok: true, deletedId: person.id, deletedAgents: person.agents.length });
    return;
  }
  if (method === "POST" && url.pathname === "/api/people/agents") {
    const body = await readJsonBody(request);
    const config = loadConfig();
    const personId = requiredIdentifier(body.personId, "personId");
    const person = loadPeople().find((item) => item.id === personId);
    if (!person) throw new HttpError(404, `Unknown person: ${personId}`);
    const role = requiredEnum(body.role, "role", ["developer", "tester", "deployer", "releaser"] as const) as AssigneeRole;
    if (!person.roles.includes(role)) throw new HttpError(409, "Agent role must be one of the person's roles.");
    const providerId = requiredIdentifier(body.providerId, "providerId");
    if (!config.providers[providerId]) throw new HttpError(404, `Unknown provider: ${providerId}`);
    const skillIds = requiredStringArray(body.skillIds, "skillIds");
    const toolIds = requiredStringArray(body.toolIds, "toolIds") as AgentToolPermission[];
    const repositoryIds = requiredStringArray(body.repositoryIds, "repositoryIds");
    const environmentIds = requiredStringArray(body.environmentIds, "environmentIds");
    validateAgentCapabilities(config, skillIds, toolIds, repositoryIds, environmentIds);
    const updated = savePersonAgent(personId, {
      id: typeof body.id === "string" && body.id ? requiredIdentifier(body.id, "id") : undefined,
      name: requiredString(body.name, "name"),
      role,
      providerId,
      skillIds,
      toolIds,
      repositoryIds,
      environmentIds,
    });
    sendJson(response, 200, { ok: true, person: updated });
    return;
  }
  if (method === "POST" && url.pathname === "/api/group-chats") {
    const body = await readJsonBody(request);
    const memberIds = requiredStringArray(body.memberIds, "memberIds");
    if (memberIds.length < 2) throw new HttpError(400, "A group chat requires at least two members.");
    const peopleById = new Map(loadPeople().map((person) => [person.id, person]));
    const unknownMember = memberIds.find((id) => !peopleById.has(id));
    if (unknownMember) throw new HttpError(404, `Unknown group chat member: ${unknownMember}`);
    const groupChat = createGroupChat({ name: requiredString(body.name, "name"), memberIds });
    sendJson(response, 201, { ok: true, groupChat });
    return;
  }
  if (method === "POST" && url.pathname === "/api/group-chats/messages") {
    const body = await readJsonBody(request);
    const groupChatId = requiredIdentifier(body.groupChatId, "groupChatId");
    const senderPersonId = requiredIdentifier(body.senderPersonId, "senderPersonId");
    const activity = requiredEnum(body.activity, "activity", ["message", "started", "completed", "confirmation"] as const) as GroupChatActivity;
    const groupChat = loadGroupChats().find((item) => item.id === groupChatId);
    if (!groupChat) throw new HttpError(404, `Unknown group chat: ${groupChatId}`);
    const administrator = currentUser();
    const people = loadPeople();
    const sender = people.find((person) => person.id === senderPersonId);
    const isAdministrator = senderPersonId === administrator.id;
    if (!sender && !isAdministrator) throw new HttpError(404, `Unknown message sender: ${senderPersonId}`);
    if (sender && !groupChat.memberIds.includes(sender.id)) throw new HttpError(409, "Message sender is not a member of this group chat.");
    if (isAdministrator && (activity === "started" || activity === "completed")) {
      throw new HttpError(409, "Administrators can send messages and confirmation requests, but cannot post employee task progress.");
    }

    const workflowId = typeof body.workflowId === "string" ? body.workflowId.trim() : "";
    const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
    if (Boolean(workflowId) !== Boolean(taskId)) throw new HttpError(400, "workflowId and taskId must be provided together.");
    if ((activity === "started" || activity === "completed") && !taskId) {
      throw new HttpError(400, `${activity} messages must reference an assigned task.`);
    }

    let workflow: DevelopmentWorkflow | undefined;
    let task: WorkflowTaskItem | undefined;
    if (workflowId && taskId) {
      workflow = findWorkflow(workflowId);
      task = workflow.taskItems?.find((item) => item.id === taskId);
      if (!task) throw new HttpError(404, `Unknown workflow task: ${taskId}`);
      if (!sender || task.ownerId !== sender.id) throw new HttpError(409, "Employees can only post work updates for tasks assigned to them.");
      if (activity === "started") task.status = "in_progress";
      if (activity === "completed") task.status = "completed";
    }

    const suppliedText = typeof body.text === "string" ? body.text.trim() : "";
    const defaultText = task
      ? activity === "started" ? `开始处理：${task.title}`
        : activity === "completed" ? `已完成：${task.title}`
          : activity === "confirmation" ? `需要确认：${task.title}` : ""
      : "";
    const text = suppliedText || defaultText;
    if (!text) throw new HttpError(400, "text is required.");

    const mentionedIds = isAdministrator ? mentionedGroupChatMemberIds(text, groupChat.memberIds, people) : [];
    const mentionedPeople = people.filter((person) => mentionedIds.includes(person.id));

    if (workflow && (activity === "started" || activity === "completed")) saveWorkflow(workflow);
    let updated = postGroupChatMessage(groupChat.id, {
      senderPersonId: isAdministrator ? administrator.id : sender!.id,
      senderName: isAdministrator ? administrator.name : sender!.name,
      senderType: isAdministrator ? "administrator" : "person",
      activity,
      text,
      workflowId: workflow?.id,
      workflowTitle: workflow?.title,
      taskId: task?.id,
      taskTitle: task?.title,
    });

    const replyErrors: Array<{ personName: string; error: string }> = [];
    const repliedBy: string[] = [];
    for (const responder of mentionedPeople) {
      const agent = responder.agents[0];
      if (!agent) {
        replyErrors.push({ personName: responder.name, error: "尚未配置 Agent，只能查看消息" });
        continue;
      }
      if (!agent.skillIds.includes("team_chat")) {
        replyErrors.push({ personName: responder.name, error: "Agent 尚未启用群聊协作 Skill" });
        continue;
      }
      try {
        updated = await replyToAdministratorInGroupChat(updated, responder, agent);
        repliedBy.push(responder.name);
      } catch (error) {
        replyErrors.push({ personName: responder.name, error: messageOf(error) });
      }
    }
    sendJson(response, 201, { ok: true, groupChat: updated, workflow, repliedBy, replyErrors });
    return;
  }
  if (method === "POST" && url.pathname === "/api/workflows") {
    const body = await readJsonBody(request);
    const config = loadConfig();
    const milestoneId = requiredString(body.milestoneId, "milestoneId");
    const milestone = loadMilestones().find((item) => item.id === milestoneId);
    if (!milestone) throw new HttpError(404, `Unknown milestone: ${milestoneId}`);
    if (!config.products[milestone.productId]) throw new HttpError(404, `Unknown product: ${milestone.productId}`);
    if (!config.providers[milestone.providerId]) throw new HttpError(404, `Unknown provider: ${milestone.providerId}`);
    const workflow = createWorkflow({
      milestoneId,
      productId: milestone.productId,
      providerId: milestone.providerId,
      title: requiredString(body.title, "title"),
      requirement: requiredString(body.requirement, "requirement"),
    });
    sendJson(response, 201, { ok: true, workflow });
    return;
  }
  if (method === "POST" && url.pathname === "/api/milestones") {
    const body = await readJsonBody(request);
    const config = loadConfig();
    const productId = requiredIdentifier(body.productId, "productId");
    const providerId = requiredIdentifier(body.providerId, "providerId");
    if (!config.products[productId]) throw new HttpError(404, `Unknown product: ${productId}`);
    if (!config.providers[providerId]) throw new HttpError(404, `Unknown provider: ${providerId}`);
    const milestone = createMilestone({
      productId,
      providerId,
      title: requiredString(body.title, "title"),
      goal: requiredString(body.goal, "goal"),
      targetDate: typeof body.targetDate === "string" && body.targetDate.trim() ? body.targetDate.trim() : undefined,
    });
    sendJson(response, 201, { ok: true, milestone });
    return;
  }
  if (method === "POST" && url.pathname === "/api/workflows/generate") {
    const body = await readJsonBody(request);
    const workflow = findWorkflow(requiredString(body.id, "id"));
    const action = requiredString(body.action, "action");
    if (action !== "plan" && action !== "tasks") throw new HttpError(400, `Unsupported workflow action: ${action}`);
    if (action === "tasks" && !workflow.plan) throw new HttpError(409, "Generate the plan before splitting tasks.");
    const config = loadConfig();
    const product = config.products[workflow.productId];
    if (!product) throw new HttpError(404, `Unknown product: ${workflow.productId}`);
    const version = loadMilestones().find((item) => item.id === workflow.milestoneId);
    if (!version) throw new HttpError(404, `Unknown version: ${workflow.milestoneId}`);
    const providerId = typeof body.providerId === "string" && body.providerId ? body.providerId : workflow.providerId;
    const provider = config.providers[providerId];
    if (!provider) throw new HttpError(404, `Unknown provider: ${providerId}`);
    if (!process.env[provider.apiKeyEnv]) throw new HttpError(400, `Provider key is not configured: ${providerId}`);

    const runId = createRunId();
    audit(runId, "started", `web.workflow-${action}`, { workflowId: workflow.id, productId: product.id, provider: providerId });
    try {
      const output = await chat(provider, {
        prompt: action === "plan" ? workflowPlanPrompt(workflow, product, version) : workflowTasksPrompt(workflow, product, version),
        system: action === "plan"
          ? "你是资深研发负责人。只输出可执行的研发计划，不编写代码，不虚构仓库事实。"
          : "你是资深技术项目经理。把已确认的计划拆成有顺序、可验证、可独立完成的任务清单，不编写代码。",
      });
      workflow.providerId = providerId;
      if (action === "plan") {
        workflow.plan = output;
        workflow.tasks = undefined;
        workflow.taskItems = undefined;
        workflow.stage = "plan";
      } else {
        workflow.tasks = output;
        workflow.taskItems = parseWorkflowTaskItems(output);
        workflow.stage = "tasks";
      }
      saveWorkflow(workflow);
      audit(runId, "completed", `web.workflow-${action}`, { workflowId: workflow.id, provider: providerId, outputCharacters: output.length });
      sendJson(response, 200, { ok: true, runId, workflow });
    } catch (error) {
      audit(runId, "failed", `web.workflow-${action}`, { workflowId: workflow.id, provider: providerId, error: messageOf(error) });
      throw error;
    }
    return;
  }
  if (method === "POST" && url.pathname === "/api/workflows/assign-task") {
    const body = await readJsonBody(request);
    const workflow = findWorkflow(requiredString(body.workflowId, "workflowId"));
    const taskId = requiredString(body.taskId, "taskId");
    const task = workflow.taskItems?.find((item) => item.id === taskId);
    if (!task) throw new HttpError(404, `Unknown workflow task: ${taskId}`);
    const expectedRole = roleForTaskStage(task.stage);
    const ownerId = typeof body.ownerId === "string" ? body.ownerId.trim() : "";
    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    const owner = ownerId ? loadPeople().find((person) => person.id === ownerId) : undefined;
    if (ownerId && !owner) throw new HttpError(404, `Unknown task owner: ${ownerId}`);
    if (owner && !owner.roles.includes(expectedRole)) {
      throw new HttpError(409, `${task.stage} tasks require an owner with the ${expectedRole} role.`);
    }
    if (owner && !hasPersonAgentForRole(owner, expectedRole)) {
      throw new HttpError(409, `Task owner must configure a ${expectedRole} Agent before tasks can be assigned.`);
    }
    if (agentId) {
      if (!owner) throw new HttpError(409, "Select a task owner before selecting an Agent.");
      const agent = owner.agents.find((item) => item.id === agentId);
      if (!agent) throw new HttpError(404, `Agent does not belong to the selected owner: ${agentId}`);
      if (agent.role !== expectedRole) throw new HttpError(409, `${task.stage} tasks require a ${expectedRole} Agent.`);
    }
    if (owner) task.ownerId = owner.id;
    else delete task.ownerId;
    if (agentId) task.agentId = agentId;
    else delete task.agentId;
    saveWorkflow(workflow);
    sendJson(response, 200, { ok: true, workflow });
    return;
  }
  if (method === "POST" && url.pathname === "/api/workflows/stage") {
    const body = await readJsonBody(request);
    const workflow = findWorkflow(requiredString(body.id, "id"));
    const target = requiredString(body.stage, "stage") as WorkflowStage;
    const transitions: Partial<Record<WorkflowStage, WorkflowStage>> = {
      tasks: "coding",
      coding: "deployment",
      deployment: "testing",
      testing: "release",
    };
    if (transitions[workflow.stage] !== target) {
      throw new HttpError(409, `Cannot move workflow from ${workflow.stage} to ${target}.`);
    }
    workflow.stage = target;
    saveWorkflow(workflow);
    sendJson(response, 200, { ok: true, workflow });
    return;
  }
  if (method === "POST" && url.pathname === "/api/run") {
    const body = await readJsonBody(request);
    const config = loadConfig();
    const projectId = requiredString(body.projectId, "projectId");
    const commandName = requiredString(body.commandName, "commandName");
    const project = config.projects[projectId];
    if (!project) throw new HttpError(404, `Unknown project: ${projectId}`);
    const command = project.commands[commandName];
    if (!command) throw new HttpError(404, `Unknown command: ${projectId}.${commandName}`);
    if (command.risk !== "read" && body.approved !== true) {
      sendJson(response, 409, {
        ok: false,
        approvalRequired: true,
        risk: command.risk,
        command: command.command,
      });
      return;
    }
    const runId = createRunId();
    audit(runId, "started", "web.project-command", {
      projectId,
      commandName,
      risk: command.risk,
    });
    const result = await runShellCaptured(command.command, project.path);
    audit(runId, result.code === 0 ? "completed" : "failed", "web.project-command", {
      projectId,
      commandName,
      code: result.code,
      truncated: result.truncated ?? false,
    });
    sendJson(response, 200, {
      ok: result.code === 0,
      runId,
      code: result.code,
      stdout: tail(result.stdout, 50_000),
      stderr: tail(result.stderr, 50_000),
      truncated: result.truncated ?? false,
    });
    return;
  }
  if (method === "POST" && url.pathname === "/api/repositories") {
    const body = await readJsonBody(request);
    const config = loadConfig();
    const repositoryId = requiredIdentifier(body.id, "id");
    const repositoryPath = requiredString(body.path, "path");
    if (config.projects[repositoryId]) throw new HttpError(409, `Repository already exists: ${repositoryId}`);
    config.projects[repositoryId] = detectProject(repositoryId, repositoryPath);
    writeConfig(config);
    sendJson(response, 201, { ok: true, repository: config.projects[repositoryId] });
    return;
  }
  if (method === "POST" && url.pathname === "/api/product-repositories") {
    const body = await readJsonBody(request);
    const config = loadConfig();
    const productId = requiredIdentifier(body.productId, "productId");
    const repositoryId = requiredIdentifier(body.id, "id");
    const product = config.products[productId];
    if (!product) throw new HttpError(404, `Unknown product: ${productId}`);
    if (!config.projects[repositoryId]) {
      const repositoryPath = requiredString(body.path, "path");
      config.projects[repositoryId] = detectProject(repositoryId, repositoryPath);
    }
    if (!product.repositories.includes(repositoryId)) product.repositories.push(repositoryId);
    writeConfig(config);
    sendJson(response, 200, { ok: true, repository: config.projects[repositoryId], product });
    return;
  }
  if (method === "POST" && url.pathname === "/api/products") {
    const body = await readJsonBody(request);
    const product = normalizeProduct(body.product);
    const config = loadConfig();
    for (const repositoryId of product.repositories) {
      if (!config.projects[repositoryId]) throw new HttpError(400, `Unknown repository: ${repositoryId}`);
    }
    config.products[product.id] = product;
    writeConfig(config);
    sendJson(response, 200, { ok: true, product });
    return;
  }
  if (method === "POST" && url.pathname === "/api/agent") {
    const body = await readJsonBody(request);
    const config = loadConfig();
    const prompt = requiredString(body.prompt, "prompt");
    const profile = typeof body.agentId === "string" && body.agentId ? findPersonAgent(body.agentId) : undefined;
    if (body.agentId && !profile) throw new HttpError(404, `Unknown Agent profile: ${String(body.agentId)}`);
    const providerId = profile?.agent.providerId ?? (typeof body.providerId === "string" ? body.providerId : config.defaultProvider);
    const provider = config.providers[providerId];
    if (!provider) throw new HttpError(404, `Unknown provider: ${providerId}`);
    if (!process.env[provider.apiKeyEnv]) throw new HttpError(400, `Provider key is not configured: ${providerId}`);
    const productId = typeof body.productId === "string" && body.productId ? body.productId : undefined;
    const legacyProjectId = typeof body.projectId === "string" && body.projectId ? body.projectId : undefined;
    if (productId && !config.products[productId]) throw new HttpError(404, `Unknown product: ${productId}`);
    if (legacyProjectId && !config.projects[legacyProjectId]) throw new HttpError(404, `Unknown repository: ${legacyProjectId}`);
    const requestedRepositoryIds = productId
      ? config.products[productId].repositories
      : legacyProjectId
        ? [legacyProjectId]
        : Object.keys(config.projects);
    const repositoryIds = profile
      ? requestedRepositoryIds.filter((id) => profile.agent.repositoryIds.includes(id))
      : requestedRepositoryIds;
    const projects = repositoryIds.map((id) => config.projects[id]).filter(Boolean);
    if (!projects.length) {
      throw new HttpError(profile ? 403 : 400, profile
        ? "The selected Agent has no repository access in this product scope."
        : productId ? "This product has no linked code repositories." : "No repositories are registered.");
    }
    const allowedTools = profile?.agent.toolIds;
    const runId = createRunId();
    audit(runId, "started", "web.agent-task", {
      provider: providerId,
      personId: profile?.person.id,
      agentId: profile?.agent.id,
      productId,
      projects: projects.map((project) => project.id),
      promptCharacters: prompt.length,
    });
    try {
      const answer = await runAgent(provider, {
        prompt,
        model: typeof body.model === "string" ? body.model : undefined,
        tools: buildAgentTools(projects, allowedTools),
        system: [
          "You are a local developer workbench agent.",
          "Use tools for project facts and registered commands; never invent execution results.",
          "Explain failures and approval requirements clearly.",
          profile ? `Responsible person: ${profile.person.name}. Agent profile: ${profile.agent.name}. Role: ${profile.agent.role}.` : "Manual Agent mode is active.",
          profile ? `Configured Skills: ${skillInstruction(profile.agent.skillIds)}` : "No saved Agent Skills are active.",
          profile ? `Environment scope: ${profile.agent.environmentIds.join(", ") || "none"}.` : "Environment scope follows the selected product.",
          productId ? `Product in scope: ${config.products[productId].name}.` : "All registered products are in scope.",
          `Code repositories in scope: ${projects.map((project) => project.id).join(", ")}.`,
        ].join(" "),
        execute: (name, argumentsValue) =>
          executeAgentTool(config, projects, name, argumentsValue, { allowRisk: body.allowRisk === true, allowedTools }),
      });
      audit(runId, "completed", "web.agent-task", { provider: providerId, agentId: profile?.agent.id, outputCharacters: answer.length });
      sendJson(response, 200, { ok: true, runId, answer });
    } catch (error) {
      audit(runId, "failed", "web.agent-task", { provider: providerId, agentId: profile?.agent.id, error: messageOf(error) });
      throw error;
    }
    return;
  }
  throw new HttpError(404, "API endpoint not found.");
}

async function replyToAdministratorInGroupChat(
  groupChat: GroupChat,
  responder: DevelopmentPerson,
  agent: PersonAgentProfile,
): Promise<GroupChat> {
  const config = loadConfig();
  const provider = config.providers[agent.providerId];
  if (!provider) throw new HttpError(404, `Unknown provider for ${agent.name}: ${agent.providerId}`);
  if (!process.env[provider.apiKeyEnv]) throw new HttpError(400, `Provider key is not configured: ${agent.providerId}`);

  const assignedTasks = loadWorkflows().flatMap((workflow) => (workflow.taskItems || [])
    .filter((task) => task.ownerId === responder.id)
    .map((task) => `${workflow.title} / ${task.id} ${task.title}（${task.status}）`));
  const transcript = groupChat.messages.slice(-16).map((message) =>
    `${message.senderName}${message.senderType === "agent" ? "[Agent]" : message.senderType === "administrator" ? "[管理员]" : "[员工]"}：${message.text}`,
  ).join("\n");
  const runId = createRunId();
  audit(runId, "started", "web.group-chat-reply", {
    groupChatId: groupChat.id,
    personId: responder.id,
    agentId: agent.id,
    provider: provider.id,
  });
  try {
    const answer = await chat(provider, {
      prompt: [
        `群聊：${groupChat.name}`,
        "最近消息：",
        transcript,
        `当前分配给你的任务：${assignedTasks.length ? assignedTasks.join("；") : "暂无"}`,
        "请直接回复管理员最后一条消息。",
      ].join("\n"),
      system: [
        `你是员工“${responder.name}”配置的“${agent.name}”，角色是 ${agent.role}。`,
        `已配置 Skills：${skillInstruction(agent.skillIds)}`,
        "你正在团队群聊中协作。只依据群聊上下文和已列出的任务回答，不虚构执行结果。",
        "如果信息不足或需要管理员决策，要明确提出需要确认的内容。回答简洁、直接、可执行。",
      ].join(" "),
    });
    const updated = postGroupChatMessage(groupChat.id, {
      senderPersonId: responder.id,
      senderName: responder.name,
      senderType: "agent",
      activity: "message",
      text: answer,
    });
    audit(runId, "completed", "web.group-chat-reply", {
      groupChatId: groupChat.id,
      personId: responder.id,
      agentId: agent.id,
      provider: provider.id,
      outputCharacters: answer.length,
    });
    return updated;
  } catch (error) {
    audit(runId, "failed", "web.group-chat-reply", {
      groupChatId: groupChat.id,
      personId: responder.id,
      agentId: agent.id,
      provider: provider.id,
      error: messageOf(error),
    });
    throw error;
  }
}

async function projectSnapshot(project: ProjectConfig): Promise<ProjectSnapshot> {
  const exists = fs.existsSync(project.path);
  if (!exists) {
    return {
      id: project.id,
      name: project.name,
      path: project.path,
      stack: project.stack,
      exists: false,
      branch: "unavailable",
      changes: 0,
      clean: false,
      gitAvailable: false,
      commands: project.commands,
      ahead: 0,
      behind: 0,
      lastCommit: "unavailable",
    };
  }
  const result = await runCaptured("git", ["status", "--short", "--branch"], project.path);
  if (result.code !== 0) {
    return {
      id: project.id,
      name: project.name,
      path: project.path,
      stack: project.stack,
      exists: true,
      branch: "not a repository",
      changes: 0,
      clean: false,
      gitAvailable: false,
      commands: project.commands,
      ahead: 0,
      behind: 0,
      lastCommit: "unavailable",
    };
  }
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  const divergence = parseDivergence(lines[0] ?? "");
  const lastCommitResult = await runCaptured("git", ["log", "-1", "--pretty=%h · %s · %cr"], project.path);
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    stack: project.stack,
    exists: true,
    branch: parseBranch(lines[0] ?? ""),
    changes: Math.max(lines.length - 1, 0),
    clean: lines.length <= 1,
    gitAvailable: true,
    commands: project.commands,
    ahead: divergence.ahead,
    behind: divergence.behind,
    lastCommit: lastCommitResult.code === 0 ? lastCommitResult.stdout.trim() : "No commits yet",
  };
}

function parseBranch(header: string): string {
  if (header.startsWith("## No commits yet on ")) return header.slice("## No commits yet on ".length);
  const value = header.replace(/^##\s*/, "");
  return value.split("...")[0].split(" ")[0] || "unknown";
}

function parseDivergence(header: string): { ahead: number; behind: number } {
  const aheadMatch = header.match(/ahead (\d+)/);
  const behindMatch = header.match(/behind (\d+)/);
  return {
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
  };
}

function productSnapshots(config: AgentConfig, repositories: ProjectSnapshot[]): ProductSnapshot[] {
  const byId = new Map(repositories.map((repository) => [repository.id, repository]));
  return Object.values(config.products).map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    repositories: product.repositories,
    environments: Object.values(product.environments),
    deployments: product.deployments,
    repositoryDetails: product.repositories.flatMap((id) => {
      const repository = byId.get(id);
      return repository ? [repository] : [];
    }),
  }));
}

function findWorkflow(id: string): DevelopmentWorkflow {
  const workflow = loadWorkflows().find((item) => item.id === id);
  if (!workflow) throw new HttpError(404, `Unknown workflow: ${id}`);
  return workflow;
}

function workflowPlanPrompt(workflow: DevelopmentWorkflow, product: ProductConfig, version: DevelopmentMilestone): string {
  return [
    `产品：${product.name}`,
    `版本：${version.title}`,
    `版本目标：${version.goal}`,
    `关联仓库：${product.repositories.length ? product.repositories.join(", ") : "尚未关联"}`,
    `需求标题：${workflow.title}`,
    "需求内容：",
    workflow.requirement,
    "",
    "请输出中文 Markdown 计划，必须覆盖：目标与非目标、影响范围、技术方案、实施步骤、风险与回滚、部署方案、测试方案。",
    "研发阶段顺序固定为：需求 → 计划 → 任务 → 编码 → 部署 → 测试 → 发布。不要编写代码。",
  ].join("\n");
}

function workflowTasksPrompt(workflow: DevelopmentWorkflow, product: ProductConfig, version: DevelopmentMilestone): string {
  return [
    `产品：${product.name}`,
    `版本：${version.title}`,
    `版本目标：${version.goal}`,
    `关联仓库：${product.repositories.length ? product.repositories.join(", ") : "尚未关联"}`,
    `需求标题：${workflow.title}`,
    "需求内容：",
    workflow.requirement,
    "",
    "已确认计划：",
    workflow.plan || "",
    "",
    "请拆分为中文 Markdown 任务清单。每项使用“- [ ] [T编号] 标题”，并写明目标、涉及仓库、完成标准和验证方式。",
    "任务必须按编码、部署、测试、发布四个阶段分组，依赖关系明确，粒度适合 Agent 逐项执行。不要编写代码。",
  ].join("\n");
}

function roleForTaskStage(stage: TaskExecutionStage): AssigneeRole {
  const roles: Record<TaskExecutionStage, AssigneeRole> = {
    coding: "developer",
    deployment: "deployer",
    testing: "tester",
    release: "releaser",
  };
  return roles[stage];
}

function rolesRequiredByAssignedTasks(personId: string): Set<AssigneeRole> {
  const roles = new Set<AssigneeRole>();
  for (const workflow of loadWorkflows()) {
    for (const task of workflow.taskItems || []) {
      if (task.ownerId === personId) roles.add(roleForTaskStage(task.stage));
    }
  }
  return roles;
}

function normalizeProduct(value: unknown): ProductConfig {
  if (!isRecord(value)) throw new HttpError(400, "product must be an object.");
  const id = requiredIdentifier(value.id, "product.id");
  const name = requiredString(value.name, "product.name");
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const repositories = Array.isArray(value.repositories)
    ? Array.from(new Set(value.repositories.map((item) => requiredIdentifier(item, "repository id"))))
    : [];
  const rawEnvironments = Array.isArray(value.environments)
    ? value.environments
    : isRecord(value.environments)
      ? Object.values(value.environments)
      : [];
  const environments: Record<string, ProductEnvironment> = {};
  for (const item of rawEnvironments) {
    if (!isRecord(item)) throw new HttpError(400, "Each environment must be an object.");
    const environmentId = requiredIdentifier(item.id, "environment.id");
    const kind = typeof item.kind === "string" ? item.kind : "other";
    const status = typeof item.status === "string" ? item.status : "unknown";
    if (!["development", "test", "staging", "production", "other"].includes(kind)) {
      throw new HttpError(400, `Invalid environment kind: ${kind}`);
    }
    if (!["healthy", "warning", "offline", "unknown"].includes(status)) {
      throw new HttpError(400, `Invalid environment status: ${status}`);
    }
    environments[environmentId] = {
      id: environmentId,
      name: requiredString(item.name, "environment.name"),
      kind: kind as ProductEnvironment["kind"],
      status: status as ProductEnvironment["status"],
      url: typeof item.url === "string" ? item.url.trim() : undefined,
      namespace: typeof item.namespace === "string" ? item.namespace.trim() : undefined,
    };
  }
  const rawDeployments = Array.isArray(value.deployments) ? value.deployments : [];
  const deployments: ProductDeployment[] = rawDeployments.map((item) => {
    if (!isRecord(item)) throw new HttpError(400, "Each deployment mapping must be an object.");
    const environmentId = requiredIdentifier(item.environmentId, "deployment.environmentId");
    const repositoryId = requiredIdentifier(item.repositoryId, "deployment.repositoryId");
    if (!environments[environmentId]) throw new HttpError(400, `Unknown deployment environment: ${environmentId}`);
    if (!repositories.includes(repositoryId)) throw new HttpError(400, `Unknown deployment repository: ${repositoryId}`);
    const status = typeof item.status === "string" ? item.status : "unknown";
    if (!["deployed", "deploying", "failed", "unknown"].includes(status)) {
      throw new HttpError(400, `Invalid deployment status: ${status}`);
    }
    return {
      environmentId,
      repositoryId,
      branch: typeof item.branch === "string" ? item.branch.trim() : undefined,
      version: typeof item.version === "string" ? item.version.trim() : undefined,
      status: status as ProductDeployment["status"],
      deployedAt: typeof item.deployedAt === "string" ? item.deployedAt : undefined,
    };
  });
  return { id, name, description, repositories, environments, deployments };
}

function publicProviders(config: AgentConfig): Array<Record<string, unknown>> {
  return Object.values(config.providers).map((provider) => ({
    id: provider.id,
    type: provider.type,
    baseUrl: provider.baseUrl,
    model: provider.defaultModel,
    ready: Boolean(process.env[provider.apiKeyEnv]),
    isDefault: provider.id === config.defaultProvider,
  }));
}

async function doctorChecks(): Promise<Array<Record<string, unknown>>> {
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const pythonExecutable = process.env.DEV_AGENT_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const checks: Array<[string, string, string[], boolean]> = [
    ["Node.js", process.execPath, ["--version"], true],
    ["Python", pythonExecutable, ["--version"], true],
    ["Git", "git", ["--version"], true],
    ["npm", npmExecutable, ["--version"], true],
    ["Docker", "docker", ["--version"], false],
  ];
  return Promise.all(
    checks.map(async ([name, executable, args, required]) => {
      const result = await runCaptured(executable, args);
      return {
        name,
        required,
        ready: result.code === 0,
        version: (result.stdout || result.stderr).trim(),
      };
    }),
  );
}

function readRuns(limit: number): Array<Record<string, unknown>> {
  return readAudit(limit) as unknown as Array<Record<string, unknown>>;
}

function validateWriteRequest(request: IncomingMessage): void {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "POST requests must use application/json.");
  }
  const origin = request.headers.origin;
  if (origin && new URL(origin).host !== request.headers.host) {
    throw new HttpError(403, "Cross-origin write requests are not allowed.");
  }
}

function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 1024 * 1024) request.destroy(new Error("Request body is too large."));
    });
    request.on("error", reject);
    request.on("end", () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        if (!isRecord(parsed)) throw new Error("JSON body must be an object.");
        resolve(parsed);
      } catch (error) {
        reject(new HttpError(400, `Invalid JSON body: ${messageOf(error)}`));
      }
    });
  });
}

function serveStatic(response: ServerResponse, webRoot: string, requestPath: string): void {
  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const file = path.resolve(webRoot, relative);
  if (file !== webRoot && !file.startsWith(`${webRoot}${path.sep}`)) throw new HttpError(403, "Invalid path.");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, "Page not found.");
  response.statusCode = 200;
  response.setHeader("Content-Type", MIME_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream");
  response.end(fs.readFileSync(file));
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${name} is required.`);
  return value.trim();
}

function requiredStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, `${name} must be an array.`);
  return Array.from(new Set(value.map((item) => requiredString(item, name))));
}

function requiredRoleArray(value: unknown, name: string): AssigneeRole[] {
  const roles = requiredStringArray(value, name).map((role) =>
    requiredEnum(role, name, ["developer", "tester", "deployer", "releaser"] as const) as AssigneeRole,
  );
  if (!roles.length) throw new HttpError(400, `${name} must contain at least one role.`);
  return roles;
}

function validateAgentCapabilities(
  config: AgentConfig,
  skillIds: string[],
  toolIds: AgentToolPermission[],
  repositoryIds: string[],
  environmentIds: string[],
): void {
  const validSkills = new Set(SKILL_CATALOG.map((skill) => skill.id));
  const validTools = new Set(TOOL_CATALOG.map((tool) => tool.id));
  const validEnvironments = new Set(Object.values(config.products).flatMap((product) =>
    Object.keys(product.environments).map((environmentId) => `${product.id}:${environmentId}`),
  ));
  for (const skillId of skillIds) if (!validSkills.has(skillId)) throw new HttpError(400, `Unknown Skill: ${skillId}`);
  for (const toolId of toolIds) if (!validTools.has(toolId)) throw new HttpError(400, `Unknown Tool: ${toolId}`);
  for (const repositoryId of repositoryIds) if (!config.projects[repositoryId]) throw new HttpError(400, `Unknown repository: ${repositoryId}`);
  for (const environmentId of environmentIds) if (!validEnvironments.has(environmentId)) throw new HttpError(400, `Unknown environment scope: ${environmentId}`);
}

function requiredIdentifier(value: unknown, name: string): string {
  const result = requiredString(value, name);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(result)) {
    throw new HttpError(400, `${name} may contain letters, numbers, dot, underscore, and dash.`);
  }
  return result;
}

function requiredEnum<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  const result = requiredString(value, name);
  if (!allowed.includes(result as T)) throw new HttpError(400, `Invalid ${name}: ${result}`);
  return result as T;
}

function tail(value: string, maxCharacters: number): string {
  return value.length <= maxCharacters ? value : value.slice(-maxCharacters);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

if (require.main === module) {
  loadSecretFile();
  const home = findAgentHome();
  if (!hasStoredConfig(home)) {
    initializeConfig(home);
    console.log(`Initialized clean ${PRODUCT_NAME} database: ${configPath(home)}`);
  }
  const agentReplacements = consolidatePersonAgents();
  if (Object.keys(agentReplacements).length) {
    for (const workflow of loadWorkflows()) {
      let changed = false;
      for (const task of workflow.taskItems || []) {
        if (!task.agentId || !agentReplacements[task.agentId]) continue;
        task.agentId = agentReplacements[task.agentId];
        changed = true;
      }
      if (changed) saveWorkflow(workflow);
    }
    console.log(`Consolidated ${Object.keys(agentReplacements).length} duplicate Agent profile(s).`);
  }
  const upgradedChatAgents = ensurePersonAgentSkill("team_chat");
  if (upgradedChatAgents) console.log(`Enabled group chat collaboration for ${upgradedChatAgents} Agent profile(s).`);
  const host = process.env.DEV_AGENT_HOST ?? "127.0.0.1";
  const port = Number(process.env.DEV_AGENT_PORT ?? "4317");
  const server = createWorkbenchServer();
  server.listen(port, host, () => {
    console.log(`${PRODUCT_NAME} ${PRODUCT_VERSION}: http://${host}:${port}`);
    console.log(`${host === "127.0.0.1" ? "Local-only" : "Network"} server. Press Ctrl+C to stop.`);
  });
}
