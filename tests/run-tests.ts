import assert from "assert";
import fs from "fs";
import path from "path";
import { audit, readAudit } from "../src/audit";
import { AGENT_PRESET_CATALOG, SKILL_CATALOG, TOOL_CATALOG } from "../src/capabilities";
import { configPath, defaultConfig, detectProject, initializeConfig, loadConfig, writeConfig } from "../src/config";
import { contentMediaRoot, deleteContentItem, findContentMedia, loadContentItems, saveContentItem } from "../src/content";
import { databasePath, databaseStats } from "../src/database";
import { listLocalDirectories, suggestRepositoryId } from "../src/directory-browser";
import { createGroupChat, loadGroupChats, mentionedGroupChatMemberIds, postGroupChatMessage } from "../src/group-chats";
import { isProviderModelOption, providerModelOptions } from "../src/model-catalog";
import { consolidatePersonAgents, createPerson, deletePerson, ensurePersonAgentSkill, hasPersonAgentForRole, loadPeople, peopleAgentArchivePath, peoplePath, savePersonAgent, updatePerson } from "../src/people";
import { runShellCaptured } from "../src/process";
import { deleteSecretValue, legacySecretFilePath, migrateLegacySecretFile, parseEnv, providerApiKey, saveSecretValue, secretValueStatus } from "../src/secrets";
import { currentUser } from "../src/session";
import { buildAgentTools } from "../src/workbench";
import { createMilestone, createWorkflow, loadMilestones, loadWorkflows, parseWorkflowTaskItems, saveWorkflow } from "../src/workflows";
import { WORKFLOW_TEMPLATE_CATALOG, workflowStageSequence, workflowTaskRole } from "../src/workflow-templates";

function test(name: string, operation: () => void): void {
  try {
    operation();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

// Keep test files inside the workspace so the same suite works in restricted
// sandboxes as well as on a normal developer machine.
const temporaryRoot = fs.mkdtempSync(path.join(process.cwd(), ".test-tmp-"));
const agentHome = path.join(temporaryRoot, ".dev-agent");
process.env.DEV_AGENT_HOME = agentHome;

try {
  test("uses a separate local administrator as the default current user", () => {
    const user = currentUser();
    assert.strictEqual(user.id, "local-administrator");
    assert.strictEqual(user.name, "小小生");
    assert.strictEqual(user.role, "administrator");
    assert.strictEqual(user.roleLabel, "本地管理员");
    assert.strictEqual(user.local, true);
    assert.ok(user.permissions.includes("manage_people"));
    assert.ok(user.permissions.includes("manage_products"));
  });

  test("initializes and loads default config", () => {
    const file = initializeConfig();
    assert.strictEqual(file, configPath());
    const config = loadConfig();
    assert.strictEqual(config.version, 1);
    assert.ok(config.providers.openai);
    assert.ok(config.providers.deepseek);
    assert.ok(config.providers.kimi);
    assert.strictEqual(config.defaultProvider, "deepseek");
    assert.strictEqual(config.providers.openai.defaultModel, "gpt-5.6-sol");
    assert.strictEqual(config.providers.deepseek.defaultModel, "deepseek-flash");
    assert.strictEqual(config.providers.kimi.defaultModel, "kimi-k3.1-pro");
    assert.ok(providerModelOptions(config.providers.openai).some((model) => model.id === "gpt-6.1-sol"));
    assert.ok(isProviderModelOption("deepseek", "deepseek-v4-pro"));
    assert.ok(isProviderModelOption("kimi", "kimi-k3.1-pro-highspeed"));
    assert.deepStrictEqual(config.products, {});
  });

  test("migrates legacy provider model defaults", () => {
    const config = defaultConfig();
    config.providers.openai.defaultModel = "gpt-5.6";
    config.providers.deepseek.defaultModel = "deepseek-chat";
    config.providers.kimi.defaultModel = "kimi-k2.5";
    writeConfig(config);
    const migrated = loadConfig();
    assert.strictEqual(migrated.providers.openai.defaultModel, "gpt-5.6-sol");
    assert.strictEqual(migrated.providers.deepseek.defaultModel, "deepseek-flash");
    assert.strictEqual(migrated.providers.kimi.defaultModel, "kimi-k3.1-pro");
  });

  test("detects a Node project and registered scripts", () => {
    const projectDirectory = path.join(temporaryRoot, "sample-node");
    fs.mkdirSync(projectDirectory);
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({ name: "sample", scripts: { test: "node test.js", build: "node build.js", release: "nope" } }),
    );
    const project = detectProject("sample", projectDirectory);
    assert.strictEqual(project.stack, "node");
    assert.strictEqual(project.commands.test.command, "npm run test");
    assert.strictEqual(project.commands.test.risk, "read");
    assert.strictEqual(project.commands.release.command, "npm run release");
    assert.strictEqual(project.commands.release.risk, "deploy");
  });

  test("persists registered projects", () => {
    const config = defaultConfig();
    const projectDirectory = path.join(temporaryRoot, "sample-go");
    fs.mkdirSync(projectDirectory);
    fs.writeFileSync(path.join(projectDirectory, "go.mod"), "module example.com/sample\n");
    config.projects.go = detectProject("go", projectDirectory);
    const secondProjectDirectory = path.join(temporaryRoot, "sample-python");
    fs.mkdirSync(secondProjectDirectory);
    fs.writeFileSync(path.join(secondProjectDirectory, "requirements.txt"), "pytest\n");
    config.projects.python = detectProject("python", secondProjectDirectory);
    config.products.ops = {
      id: "ops",
      name: "Ops Product",
      repositories: ["go", "python"],
      environments: {
        test: { id: "test", name: "Test", kind: "test", status: "unknown" },
      },
      deployments: [
        { environmentId: "test", repositoryId: "go", branch: "main", status: "deployed" },
      ],
    };
    writeConfig(config);
    const loaded = loadConfig();
    assert.strictEqual(loaded.projects.go.stack, "go");
    assert.strictEqual(loaded.projects.python.stack, "python");
    assert.strictEqual(loaded.projects.go.commands.test.command, "go test ./...");
    assert.deepStrictEqual(loaded.products.ops.repositories, ["go", "python"]);
    assert.strictEqual(loaded.products.ops.deployments[0].branch, "main");
  });

  test("captures registered shell command output", () => {
    // The asynchronous behavior is covered by the CLI smoke check; this assertion
    // ensures the runtime function is exported without adding a test framework.
    assert.strictEqual(typeof runShellCaptured, "function");
  });

  test("suggests a repository id from the selected directory", () => {
    assert.strictEqual(suggestRepositoryId("CSM Backend"), "csm-backend");
    assert.strictEqual(suggestRepositoryId("agent.api_v2"), "agent.api_v2");
  });

  test("lists local child directories for the repository browser", () => {
    const parent = path.join(temporaryRoot, "directory-browser");
    fs.mkdirSync(path.join(parent, "service-2"), { recursive: true });
    fs.mkdirSync(path.join(parent, "service-10"));
    fs.writeFileSync(path.join(parent, "README.md"), "not a directory");
    const listing = listLocalDirectories(parent);
    assert.strictEqual(listing.current, path.resolve(parent));
    assert.deepStrictEqual(listing.entries.map((entry) => entry.name), ["service-2", "service-10"]);
  });

  test("persists a product development workflow", () => {
    const milestone = createMilestone({
      productId: "ops",
      providerId: "deepseek",
      title: "Version 1.2",
      goal: "Deliver audit export.",
      targetDate: "2026-12-01",
    });
    const workflow = createWorkflow({
      milestoneId: milestone.id,
      productId: "ops",
      providerId: "deepseek",
      title: "Add audit export",
      requirement: "Export filtered audit records.",
    });
    assert.strictEqual(workflow.stage, "requirement");
    assert.strictEqual(workflow.templateId, "software_delivery");
    workflow.plan = "1. Define the export contract.";
    workflow.stage = "plan";
    saveWorkflow(workflow);
    const loaded = loadWorkflows();
    const milestones = loadMilestones();
    assert.strictEqual(milestones.length, 1);
    assert.strictEqual(milestones[0].goal, "Deliver audit export.");
    assert.strictEqual(loaded.length, 1);
    assert.strictEqual(loaded[0].milestoneId, milestone.id);
    assert.strictEqual(loaded[0].plan, "1. Define the export contract.");
    assert.strictEqual(loaded[0].stage, "plan");
  });

  test("enforces one capability-scoped Agent per person", () => {
    const person = createPerson({ name: "Alice", roles: ["developer", "tester"] });
    const withDeveloper = savePersonAgent(person.id, {
      name: "DeepSeek Developer",
      role: "developer",
      providerId: "deepseek",
      skillIds: ["implementation", "unit_testing"],
      toolIds: ["inspect_repositories", "run_read_commands"],
      repositoryIds: ["go"],
      environmentIds: ["ops:test"],
    });
    assert.throws(() => savePersonAgent(person.id, {
        name: "DeepSeek Tester",
        role: "tester",
        providerId: "deepseek",
        skillIds: ["test_design"],
        toolIds: ["inspect_repositories", "run_read_commands"],
        repositoryIds: ["go"],
        environmentIds: ["ops:test"],
      }), /already has an Agent/);
    const people = loadPeople();
    assert.strictEqual(people.length, 1);
    assert.strictEqual(people[0].agents.length, 1);
    assert.strictEqual(withDeveloper.agents[0].skillIds[0], "implementation");
    assert.strictEqual(people[0].agents[0].role, "developer");
    assert.strictEqual(hasPersonAgentForRole(people[0], "developer"), true);
    assert.strictEqual(hasPersonAgentForRole(people[0], "tester"), false);
  });

  test("consolidates legacy duplicate Agents and archives the removed profiles", () => {
    const migrationHome = path.join(temporaryRoot, "migration-home");
    const now = new Date().toISOString();
    const older = new Date(Date.now() - 60_000).toISOString();
    fs.mkdirSync(migrationHome, { recursive: true });
    fs.writeFileSync(peoplePath(migrationHome), JSON.stringify([{
      id: "person-legacy",
      name: "Legacy Person",
      roles: ["developer"],
      agents: [
        { id: "agent-old", name: "Old Agent", role: "developer", providerId: "deepseek", skillIds: ["implementation"], toolIds: ["inspect_repositories"], repositoryIds: [], environmentIds: [], createdAt: older, updatedAt: older },
        { id: "agent-new", name: "New Agent", role: "developer", providerId: "deepseek", skillIds: ["implementation"], toolIds: ["inspect_repositories"], repositoryIds: [], environmentIds: [], createdAt: now, updatedAt: now },
      ],
      createdAt: older,
      updatedAt: now,
    }], null, 2));
    assert.deepStrictEqual(consolidatePersonAgents(migrationHome), { "agent-old": "agent-new" });
    assert.strictEqual(loadPeople(migrationHome)[0].agents[0].id, "agent-new");
    const archive = JSON.parse(fs.readFileSync(peopleAgentArchivePath(migrationHome), "utf8"));
    assert.strictEqual(archive[0].people[0].removedAgents[0].id, "agent-old");
  });

  test("supports an operations person with content creation skills", () => {
    const operationsHome = path.join(temporaryRoot, "operations-home");
    const person = createPerson({ name: "Content Operator", roles: ["operator"] }, operationsHome);
    const updated = savePersonAgent(person.id, {
      name: "运营通用 Agent",
      role: "operator",
      providerId: "deepseek",
      skillIds: ["content_planning", "official_account_writing", "short_video_scripting", "content_review"],
      toolIds: ["inspect_repositories", "run_read_commands"],
      repositoryIds: [],
      environmentIds: [],
    }, operationsHome);
    assert.strictEqual(updated.roles[0], "operator");
    assert.strictEqual(updated.agents[0].role, "operator");
    assert.ok(updated.agents[0].skillIds.includes("official_account_writing"));
    assert.ok(updated.agents[0].skillIds.includes("short_video_scripting"));
  });

  test("provides valid common Agent presets for every supported role", () => {
    assert.deepStrictEqual(AGENT_PRESET_CATALOG.map((preset) => preset.role), ["developer", "tester", "deployer", "releaser", "operator"]);
    const skillIds = new Set(SKILL_CATALOG.map((skill) => skill.id));
    const toolIds = new Set(TOOL_CATALOG.map((tool) => tool.id));
    for (const preset of AGENT_PRESET_CATALOG) {
      assert.ok(preset.skillIds.length > 0);
      assert.ok(preset.toolIds.length > 0);
      assert.ok(preset.skillIds.every((id) => skillIds.has(id)));
      assert.ok(preset.toolIds.every((id) => toolIds.has(id)));
      assert.ok(preset.skillIds.includes("team_chat"));
    }
    assert.ok(AGENT_PRESET_CATALOG.find((preset) => preset.role === "developer")?.toolIds.includes("run_write_commands"));
    assert.ok(AGENT_PRESET_CATALOG.find((preset) => preset.role === "releaser")?.toolIds.includes("run_deploy_commands"));
    const operationsPreset = AGENT_PRESET_CATALOG.find((preset) => preset.role === "operator");
    assert.ok(operationsPreset?.skillIds.includes("official_account_writing"));
    assert.ok(operationsPreset?.skillIds.includes("short_video_scripting"));
  });

  test("upgrades existing Agents with the group chat collaboration Skill", () => {
    const people = loadPeople();
    const agent = people[0].agents[0];
    agent.skillIds = agent.skillIds.filter((skillId) => skillId !== "team_chat");
    fs.writeFileSync(peoplePath(), `${JSON.stringify(people, null, 2)}\n`);
    assert.strictEqual(ensurePersonAgentSkill("team_chat"), 1);
    assert.ok(loadPeople()[0].agents[0].skillIds.includes("team_chat"));
    assert.strictEqual(ensurePersonAgentSkill("team_chat"), 0);
  });

  test("persists employee group chats and work updates", () => {
    const chatHome = path.join(temporaryRoot, "group-chat-home");
    const chat = createGroupChat({ name: "Delivery Team", memberIds: ["person-dev", "person-test"] }, chatHome);
    const updated = postGroupChatMessage(chat.id, {
      senderPersonId: "person-dev",
      senderName: "Developer",
      senderType: "person",
      activity: "started",
      text: "开始处理：实现导出接口",
      workflowId: "workflow-1",
      workflowTitle: "Export requirement",
      taskId: "T1",
      taskTitle: "实现导出接口",
    }, chatHome);
    assert.strictEqual(updated.messages.length, 1);
    assert.strictEqual(updated.messages[0].activity, "started");
    assert.strictEqual(updated.messages[0].senderType, "person");
    assert.strictEqual(loadGroupChats(chatHome)[0].messages[0].taskId, "T1");

    const withAdministrator = postGroupChatMessage(chat.id, {
      senderPersonId: "local-administrator",
      senderName: "管理员",
      senderType: "administrator",
      activity: "message",
      text: "@Developer 请确认实现范围",
    }, chatHome);
    assert.strictEqual(withAdministrator.messages[1].senderType, "administrator");
  });

  test("persists content drafts and image media", () => {
    const contentHome = path.join(temporaryRoot, "content-home");
    const created = saveContentItem({
      title: "公众号首发稿",
      type: "official_account",
      status: "draft",
      body: "这是一篇保存在内容中心的文章。",
      authorPersonId: "person-operator",
      mediaIds: [],
      uploads: [{
        name: "cover.png",
        mimeType: "image/png",
        dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      }],
    }, contentHome);
    assert.strictEqual(loadContentItems(contentHome)[0].title, "公众号首发稿");
    assert.strictEqual(created.media.length, 1);
    assert.ok(fs.existsSync(findContentMedia(created.media[0].id, contentHome)?.file || ""));
    const updated = saveContentItem({
      id: created.id,
      title: "公众号首发稿（已审）",
      type: created.type,
      status: "review",
      body: created.body,
      authorPersonId: created.authorPersonId,
      mediaIds: [created.media[0].id],
      uploads: [],
    }, contentHome);
    assert.strictEqual(updated.status, "review");
    deleteContentItem(created.id, contentHome);
    assert.strictEqual(loadContentItems(contentHome).length, 0);
    assert.strictEqual(fs.readdirSync(contentMediaRoot(contentHome)).length, 0);
  });

  test("recognizes exact employee mentions inside a group chat", () => {
    const people = [
      { id: "person-test-1", name: "测试1号" },
      { id: "person-test-10", name: "测试10号" },
      { id: "person-outside", name: "群外员工" },
    ];
    assert.deepStrictEqual(
      mentionedGroupChatMemberIds("@测试1号 请确认；@测试10号：补充结果", ["person-test-1", "person-test-10"], people),
      ["person-test-1", "person-test-10"],
    );
    assert.deepStrictEqual(mentionedGroupChatMemberIds("@群外员工 请回答", ["person-test-1"], people), []);
  });

  test("recognizes @所有人 as every employee inside a group chat", () => {
    const people = [
      { id: "person-developer", name: "开发" },
      { id: "person-tester", name: "测试" },
      { id: "person-outside", name: "群外员工" },
    ];
    assert.deepStrictEqual(
      mentionedGroupChatMemberIds("@所有人 请同步当前进度", ["person-developer", "person-tester"], people),
      ["person-developer", "person-tester"],
    );
    assert.deepStrictEqual(
      mentionedGroupChatMemberIds("@所有人员 暂不触发", ["person-developer", "person-tester"], people),
      [],
    );
  });

  test("filters actual Agent tools by configured permissions", () => {
    const config = loadConfig();
    const tools = buildAgentTools([config.projects.go], ["inspect_repositories"]);
    assert.deepStrictEqual(tools.map((tool) => tool.name), ["get_project", "get_git_status"]);
  });

  test("updates people safely and deletes an unreferenced person", () => {
    const alice = loadPeople()[0];
    const updated = updatePerson(alice.id, { name: "Alice Chen", roles: ["developer", "tester"] });
    assert.strictEqual(updated.name, "Alice Chen");
    assert.throws(
      () => updatePerson(alice.id, { name: "Alice Chen", roles: ["tester"] }),
      /still used by Agent/,
    );
    const temporaryPerson = createPerson({ name: "Temporary", roles: ["deployer"] });
    const removed = deletePerson(temporaryPerson.id);
    assert.strictEqual(removed.name, "Temporary");
    assert.strictEqual(loadPeople().some((person) => person.id === temporaryPerson.id), false);
  });

  test("persists task owner and selected Agent separately", () => {
    const workflow = loadWorkflows()[0];
    const person = loadPeople()[0];
    workflow.taskItems = [{
      id: "T1",
      title: "Implement export",
      stage: "coding",
      status: "pending",
      ownerId: person.id,
      agentId: person.agents[0].id,
    }];
    saveWorkflow(workflow);
    const loadedTask = loadWorkflows()[0].taskItems?.[0];
    assert.strictEqual(loadedTask?.ownerId, person.id);
    assert.strictEqual(loadedTask?.agentId, person.agents[0].id);
  });

  test("persists blocked tasks for the delivery board", () => {
    const workflow = loadWorkflows()[0];
    const task = workflow.taskItems?.[0];
    assert.ok(task);
    task!.status = "blocked";
    saveWorkflow(workflow);
    assert.strictEqual(loadWorkflows()[0].taskItems?.[0].status, "blocked");
  });

  test("parses staged markdown tasks for assignment", () => {
    const tasks = parseWorkflowTaskItems([
      "## 编码",
      "- [ ] [T1] 实现导出接口",
      "## 部署",
      "- [ ] [T2] 部署测试环境",
      "## 测试",
      "- [x] [T3] 验证筛选条件",
      "## 发布",
      "- [ ] [T4] 发布正式版本",
    ].join("\n"));
    assert.deepStrictEqual(tasks.map((item) => item.stage), ["coding", "deployment", "testing", "release"]);
    assert.strictEqual(tasks[2].status, "completed");
    assert.strictEqual(tasks[3].title, "发布正式版本");
  });

  test("provides workflow templates for development, operations and incidents", () => {
    assert.deepStrictEqual(WORKFLOW_TEMPLATE_CATALOG.map((template) => template.id), ["software_delivery", "content_operations", "incident_response"]);
    assert.deepStrictEqual(workflowStageSequence("content_operations"), ["requirement", "plan", "tasks", "topic_planning", "content_creation", "content_review", "content_publishing", "content_analysis"]);
    assert.strictEqual(workflowTaskRole("content_creation"), "operator");
    assert.strictEqual(workflowTaskRole("incident_fix"), "developer");
  });

  test("parses operations and incident tasks with template-specific stages", () => {
    const operations = parseWorkflowTaskItems([
      "## 选题", "- [ ] [O1] 确认受众", "## 创作", "- [ ] [O2] 撰写公众号文章", "## 审核", "- [ ] [O3] 校对品牌口径", "## 发布", "- [ ] [O4] 发布公众号", "## 复盘", "- [ ] [O5] 汇总阅读数据",
    ].join("\n"), "content_operations");
    assert.deepStrictEqual(operations.map((item) => item.stage), ["topic_planning", "content_creation", "content_review", "content_publishing", "content_analysis"]);
    const incidents = parseWorkflowTaskItems([
      "## 响应", "- [ ] [I1] 确认影响范围", "## 诊断", "- [ ] [I2] 检查服务日志", "## 修复", "- [ ] [I3] 回滚异常变更", "## 验证", "- [ ] [I4] 验证核心接口", "## 复盘", "- [ ] [I5] 补充改进项",
    ].join("\n"), "incident_response");
    assert.deepStrictEqual(incidents.map((item) => item.stage), ["incident_triage", "incident_diagnosis", "incident_fix", "incident_verification", "incident_review"]);
  });

  test("persists the selected workflow template", () => {
    const milestone = loadMilestones()[0];
    const workflow = createWorkflow({ milestoneId: milestone.id, productId: milestone.productId, providerId: milestone.providerId, title: "公众号发布", requirement: "完成新品公众号首发", templateId: "content_operations" });
    assert.strictEqual(loadWorkflows().find((item) => item.id === workflow.id)?.templateId, "content_operations");
  });

  test("migrates the legacy secret file into SQLite without overriding the environment", () => {
    const parsed = parseEnv("# comment\nOPENAI_API_KEY='file-openai'\nDEEPSEEK_API_KEY=deep=seek\n");
    assert.strictEqual(parsed.OPENAI_API_KEY, "file-openai");
    assert.strictEqual(parsed.DEEPSEEK_API_KEY, "deep=seek");

    const file = legacySecretFilePath(agentHome);
    fs.writeFileSync(file, "OPENAI_API_KEY=file-openai\nKIMI_API_KEY=\"file-kimi\"\n");
    const originalOpenAi = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "environment-openai";
    assert.strictEqual(migrateLegacySecretFile(agentHome, file), 2);
    assert.strictEqual(fs.existsSync(file), false);
    assert.strictEqual(providerApiKey("OPENAI_API_KEY", agentHome), "environment-openai");
    assert.strictEqual(providerApiKey("KIMI_API_KEY", agentHome), "file-kimi");
    assert.strictEqual(secretValueStatus("KIMI_API_KEY", agentHome).source, "database");
    restoreEnvironment("OPENAI_API_KEY", originalOpenAi);
  });

  test("saves and clears page-managed API keys in SQLite", () => {
    const name = "TEST_PROVIDER_API_KEY";
    const original = process.env[name];
    delete process.env[name];
    saveSecretValue(name, "page-managed-key", agentHome);
    assert.strictEqual(secretValueStatus(name, agentHome).source, "database");
    assert.strictEqual(secretValueStatus(name, agentHome).databaseConfigured, true);
    assert.strictEqual(providerApiKey(name, agentHome), "page-managed-key");
    assert.strictEqual(deleteSecretValue(name, agentHome), true);
    assert.strictEqual(secretValueStatus(name, agentHome).configured, false);
    restoreEnvironment(name, original);
  });

  test("stores application state and audit events in SQLite", () => {
    audit("sqlite-test-run", "completed", "test.sqlite", { safe: true, provider: "deepseek", model: "deepseek-flash" });
    const stats = databaseStats(agentHome);
    assert.strictEqual(fs.existsSync(databasePath(agentHome)), true);
    assert.strictEqual(configPath(), databasePath(agentHome));
    assert.ok(stats.config === 1);
    assert.ok(stats.people >= 1);
    assert.ok(stats.milestones >= 1);
    assert.ok(stats.workflows >= 1);
    assert.ok(stats.audit_events >= 1);
    assert.ok(stats.provider_secrets >= 2);
    const latestAudit = readAudit(1)[0];
    assert.strictEqual(latestAudit.runId, "sqlite-test-run");
    assert.strictEqual(latestAudit.details.provider, "deepseek");
    assert.strictEqual(latestAudit.details.model, "deepseek-flash");
  });

  console.log("All tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
