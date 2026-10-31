const state = {
  currentUser: null,
  overview: null,
  doctor: [],
  runs: [],
  milestones: [],
  workflows: [],
  people: [],
  skills: [],
  agentTools: [],
  agentPresets: [],
  groupChats: [],
  activeGroupChatId: null,
  kanbanProductId: "",
  kanbanMilestoneId: "",
  kanbanOwnerId: "",
  draggedKanbanTask: null,
  settings: null,
  pendingCommand: null,
  productDraft: null,
  directoryListing: null,
  activeView: "overview",
  activeConfigSection: "people",
  peopleViewMode: "workstation",
};

let confirmationResolver = null;
let confirmationRestoreFocus = null;

const viewMeta = {
  overview: ["WORKSPACE", "工作台总览"],
  workflow: ["DELIVERY", "任务"],
  kanban: ["BOARD", "研发任务看板"],
  "group-chat": ["TEAM", "团队群聊"],
  projects: ["CONFIG", "配置中心"],
  agent: ["AGENT CONSOLE", "Agent控制台"],
  runs: ["AUDIT", "运行记录"],
};

const workflowStages = [
  ["requirement", "需求"],
  ["plan", "计划"],
  ["tasks", "任务"],
  ["coding", "编码"],
  ["deployment", "部署"],
  ["testing", "测试"],
  ["release", "发布"],
];

document.addEventListener("DOMContentLoaded", () => {
  initializeThemeToggle();
  bindNavigation();
  bindActions();
  loadDashboard();
});

function initializeThemeToggle() {
  updateThemeToggle();
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { window.localStorage.setItem("dev-agent-theme", next); } catch (_error) { /* local persistence is optional */ }
    updateThemeToggle();
  });
}

function updateThemeToggle() {
  const isDark = document.documentElement.dataset.theme === "dark";
  document.getElementById("theme-icon").textContent = isDark ? "☀" : "☾";
  document.getElementById("theme-label").textContent = isDark ? "浅色" : "深色";
  document.getElementById("theme-toggle").setAttribute("aria-label", isDark ? "切换到浅色主题" : "切换到深色主题");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers,
  });
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) {
    const error = new Error(payload.error || `请求失败：HTTP ${response.status}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function loadDashboard() {
  setRefreshState(true);
  try {
    const [session, overview, doctor, runs, settings, workflows, people, groupChats] = await Promise.all([
      api("/api/session"),
      api("/api/overview"),
      api("/api/doctor"),
      api("/api/runs?limit=80"),
      api("/api/settings"),
      api("/api/workflows"),
      api("/api/people"),
      api("/api/group-chats"),
    ]);
    state.currentUser = session.user;
    state.overview = overview;
    state.doctor = doctor.checks || [];
    state.runs = runs.runs || [];
    state.settings = settings;
    state.milestones = workflows.milestones || [];
    state.workflows = workflows.workflows || [];
    state.people = people.people || [];
    state.skills = people.skills || [];
    state.agentTools = people.tools || [];
    state.agentPresets = people.presets || [];
    state.groupChats = groupChats.groupChats || [];
    renderAll();
    document.getElementById("last-updated").textContent = `刚刚同步 · ${formatClock(new Date())}`;
  } catch (error) {
    showToast(error.message, true);
    renderLoadError(error.message);
  } finally {
    setRefreshState(false);
  }
}

function renderAll() {
  renderCurrentUser();
  renderMetrics();
  renderOverviewProjects();
  renderPeople();
  renderProjectCards();
  renderWorkflows();
  renderKanban();
  renderEnvironment();
  renderActivity();
  renderRuns();
  renderAgentOptions();
  renderGroupChats();
  renderSettings();
  document.getElementById("nav-project-count").textContent = "3";
  document.getElementById("nav-person-count").textContent = String(state.people.length);
  document.getElementById("nav-product-count").textContent = String(state.overview.products.length);
  document.getElementById("nav-provider-count").textContent = String(state.settings.providers.filter((provider) => provider.ready).length);
  document.getElementById("nav-workflow-count").textContent = String(state.milestones.length);
  document.getElementById("nav-kanban-count").textContent = String(allKanbanTasks().filter(({ task }) => normalizedTaskStatus(task.status) !== "completed").length);
  document.getElementById("nav-group-chat-count").textContent = String(state.groupChats.length);
}

function renderCurrentUser() {
  const user = state.currentUser;
  if (!user) return;
  document.getElementById("current-user-name").textContent = user.name;
  document.getElementById("current-user-role").textContent = user.roleLabel;
  document.getElementById("current-user-role").title = `${user.permissions.length} 项管理权限`;
  document.getElementById("current-user-avatar").textContent = user.name.slice(0, 1).toUpperCase();
}

function bindNavigation() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-view-target]");
    if (!target) return;
    switchView(target.dataset.viewTarget);
    if (target.dataset.configTarget) switchConfigSection(target.dataset.configTarget);
  });
}

function switchView(view) {
  if (!viewMeta[view]) return;
  state.activeView = view;
  document.body.classList.toggle("group-chat-active", view === "group-chat");
  document.body.classList.toggle("overview-active", view === "overview");
  document.querySelectorAll("[data-view]").forEach((section) => section.classList.toggle("is-active", section.dataset.view === view));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("is-active", item.dataset.viewTarget === view));
  document.querySelector('[data-nav-group="projects"]')?.classList.toggle("is-open", view === "projects");
  document.getElementById("page-eyebrow").textContent = viewMeta[view][0];
  document.getElementById("page-title").textContent = viewMeta[view][1];
  if (view === "projects") switchConfigSection(state.activeConfigSection);
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "agent") setTimeout(() => document.getElementById("agent-prompt").focus(), 100);
}

function switchConfigSection(section) {
  if (!["people", "products", "models"].includes(section)) return;
  state.activeConfigSection = section;
  document.querySelectorAll("[data-config-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.configPanel === section));
  document.querySelectorAll(".nav-subitem").forEach((item) => item.classList.toggle("is-active", item.dataset.configTarget === section));
  if (state.activeView === "projects") {
    document.getElementById("page-eyebrow").textContent = "CONFIG";
    document.getElementById("page-title").textContent = ({ people: "人员配置", products: "产品配置", models: "模型配置" })[section];
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindActions() {
  document.getElementById("action-confirm-close").addEventListener("click", () => settleConfirmation(false));
  document.getElementById("action-confirm-cancel").addEventListener("click", () => settleConfirmation(false));
  document.getElementById("action-confirm-accept").addEventListener("click", () => settleConfirmation(true));
  document.getElementById("action-confirm-modal").addEventListener("click", (event) => {
    if (event.target.id === "action-confirm-modal") settleConfirmation(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("action-confirm-modal").hidden) settleConfirmation(false);
  });
  document.getElementById("refresh-button").addEventListener("click", loadDashboard);
  document.getElementById("projects-refresh").addEventListener("click", loadDashboard);
  document.getElementById("runs-refresh").addEventListener("click", refreshRuns);
  document.getElementById("clear-chat").addEventListener("click", clearChat);
  document.getElementById("agent-form").addEventListener("submit", submitAgentTask);
  document.getElementById("kanban-product-filter").addEventListener("change", (event) => {
    state.kanbanProductId = event.target.value;
    state.kanbanMilestoneId = "";
    renderKanban();
  });
  document.getElementById("kanban-milestone-filter").addEventListener("change", (event) => {
    state.kanbanMilestoneId = event.target.value;
    renderKanban();
  });
  document.getElementById("kanban-owner-filter").addEventListener("change", (event) => {
    state.kanbanOwnerId = event.target.value;
    renderKanban();
  });
  const kanbanBoard = document.getElementById("kanban-board");
  kanbanBoard.addEventListener("change", (event) => {
    const select = event.target.closest("[data-kanban-status]");
    if (select) updateKanbanTaskStatus(select.dataset.workflowId, select.dataset.taskId, select.value, select);
  });
  kanbanBoard.addEventListener("click", (event) => {
    const button = event.target.closest("[data-kanban-open]");
    if (button) openKanbanWorkflow(button.dataset.kanbanOpen);
  });
  kanbanBoard.addEventListener("dragstart", beginKanbanDrag);
  kanbanBoard.addEventListener("dragend", endKanbanDrag);
  kanbanBoard.addEventListener("dragover", allowKanbanDrop);
  kanbanBoard.addEventListener("dragleave", leaveKanbanDrop);
  kanbanBoard.addEventListener("drop", dropKanbanTask);
  document.getElementById("provider-grid").addEventListener("submit", saveProviderKey);
  document.getElementById("provider-grid").addEventListener("change", (event) => {
    const select = event.target.closest("[data-provider-model]");
    if (select) saveProviderModel(select);
  });
  document.getElementById("provider-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-clear-provider-key]");
    if (button && !button.disabled) clearProviderKey(button.dataset.clearProviderKey);
  });
  document.getElementById("add-product").addEventListener("click", () => openProductModal());
  document.getElementById("add-person").addEventListener("click", openPersonModal);
  document.querySelector(".people-view-switch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-people-view]");
    if (!button) return;
    state.peopleViewMode = button.dataset.peopleView;
    renderPeople();
  });
  document.getElementById("person-form").addEventListener("submit", createDevelopmentPerson);
  document.getElementById("person-modal-close").addEventListener("click", closePersonModal);
  document.getElementById("person-modal-cancel").addEventListener("click", closePersonModal);
  document.getElementById("person-agent-form").addEventListener("submit", saveDevelopmentAgent);
  document.getElementById("person-agent-modal-close").addEventListener("click", closePersonAgentModal);
  document.getElementById("person-agent-modal-cancel").addEventListener("click", closePersonAgentModal);
  document.getElementById("person-agent-presets").addEventListener("click", (event) => {
    const target = event.target.closest("[data-agent-preset]");
    if (target && !target.disabled) applyAgentPreset(target.dataset.agentPreset);
  });
  document.getElementById("person-agent-form").addEventListener("change", (event) => {
    if (!event.target.closest("[data-agent-preset]")) clearAgentPresetSelection();
  });
  document.getElementById("add-group-chat").addEventListener("click", openGroupChatModal);
  document.getElementById("group-chat-create-form").addEventListener("submit", createTeamGroupChat);
  document.getElementById("group-chat-modal-close").addEventListener("click", closeGroupChatModal);
  document.getElementById("group-chat-modal-cancel").addEventListener("click", closeGroupChatModal);
  document.getElementById("group-chat-form").addEventListener("submit", sendGroupChatMessage);
  document.getElementById("group-chat-sender").addEventListener("change", updateGroupChatComposer);
  document.getElementById("group-chat-activity").addEventListener("change", updateGroupChatComposer);
  document.getElementById("group-chat-mention-options").addEventListener("click", (event) => {
    const target = event.target.closest("[data-mention-person]");
    if (!target || target.disabled) return;
    const textarea = document.getElementById("group-chat-message");
    const mention = `@${target.dataset.mentionPerson} `;
    const prefix = textarea.value && !/\s$/.test(textarea.value) ? " " : "";
    textarea.value += `${prefix}${mention}`;
    textarea.focus();
  });
  document.getElementById("group-chat-list").addEventListener("click", (event) => {
    const target = event.target.closest("[data-group-chat-id]");
    if (target) selectGroupChat(target.dataset.groupChatId);
  });
  document.getElementById("group-chat-message").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      document.getElementById("group-chat-form").requestSubmit();
    }
  });
  document.getElementById("agent-profile").addEventListener("change", applyAgentProfile);
  document.getElementById("add-milestone").addEventListener("click", openMilestoneModal);
  document.getElementById("milestone-form").addEventListener("submit", createDevelopmentMilestone);
  document.getElementById("milestone-modal-close").addEventListener("click", closeMilestoneModal);
  document.getElementById("milestone-modal-cancel").addEventListener("click", closeMilestoneModal);
  document.getElementById("workflow-form").addEventListener("submit", createDevelopmentWorkflow);
  document.getElementById("workflow-modal-close").addEventListener("click", closeWorkflowModal);
  document.getElementById("workflow-modal-cancel").addEventListener("click", closeWorkflowModal);
  document.getElementById("product-modal-close").addEventListener("click", closeProductModal);
  document.getElementById("product-modal-cancel").addEventListener("click", closeProductModal);
  document.getElementById("product-form").addEventListener("submit", saveProduct);
  document.getElementById("add-environment-row").addEventListener("click", addEnvironmentRow);
  document.getElementById("product-repository-add").addEventListener("click", registerProductRepository);
  document.getElementById("product-repository-browse").addEventListener("click", chooseRepositoryDirectory);
  document.getElementById("directory-modal-close").addEventListener("click", closeDirectoryModal);
  document.getElementById("directory-modal-cancel").addEventListener("click", closeDirectoryModal);
  document.getElementById("directory-up").addEventListener("click", () => loadDirectory(state.directoryListing?.parent));
  document.getElementById("directory-select-current").addEventListener("click", selectCurrentDirectory);
  document.getElementById("directory-list").addEventListener("click", (event) => {
    const target = event.target.closest("[data-directory-path]");
    if (target) loadDirectory(target.dataset.directoryPath);
  });
  document.getElementById("agent-prompt").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      document.getElementById("agent-form").requestSubmit();
    }
  });
  document.querySelectorAll(".quick-prompt").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById("agent-prompt").value = button.dataset.prompt;
      document.getElementById("agent-prompt").focus();
    });
  });
  document.addEventListener("click", (event) => {
    const commandButton = event.target.closest("[data-command-name]");
    if (!commandButton) return;
    openCommandModal(commandButton.dataset.projectId, commandButton.dataset.commandName);
  });
  document.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-product]");
    if (editButton) openProductModal(editButton.dataset.editProduct);
    const deleteProductButton = event.target.closest("[data-delete-product]");
    if (deleteProductButton) deleteProductConfiguration(deleteProductButton.dataset.deleteProduct, deleteProductButton);
    const removeEnvironment = event.target.closest("[data-remove-environment]");
    if (removeEnvironment) removeEnvironmentRow(removeEnvironment.dataset.removeEnvironment);
    const generateWorkflow = event.target.closest("[data-workflow-generate]");
    if (generateWorkflow) generateWorkflowContent(generateWorkflow.dataset.workflowId, generateWorkflow.dataset.workflowGenerate, generateWorkflow);
    const advanceWorkflow = event.target.closest("[data-workflow-stage]");
    if (advanceWorkflow) advanceWorkflowStage(advanceWorkflow.dataset.workflowId, advanceWorkflow.dataset.workflowStage, advanceWorkflow);
    const workflowAgent = event.target.closest("[data-workflow-agent]");
    if (workflowAgent) openWorkflowInAgent(workflowAgent.dataset.workflowId, workflowAgent.dataset.workflowAgent);
    const workflowConfig = event.target.closest("[data-workflow-config]");
    if (workflowConfig) {
      switchView("projects");
      switchConfigSection("products");
      openProductModal(workflowConfig.dataset.workflowConfig);
    }
    const addMilestoneRequirement = event.target.closest("[data-milestone-add]");
    if (addMilestoneRequirement) openWorkflowModal(addMilestoneRequirement.dataset.milestoneAdd);
    const addPersonAgent = event.target.closest("[data-add-person-agent]");
    if (addPersonAgent) openPersonAgentModal(addPersonAgent.dataset.addPersonAgent);
    const editPersonAgent = event.target.closest("[data-edit-person-agent]");
    if (editPersonAgent) openPersonAgentModal(editPersonAgent.dataset.personId, editPersonAgent.dataset.editPersonAgent);
    const editPerson = event.target.closest("[data-edit-person]");
    if (editPerson) openPersonModal(editPerson.dataset.editPerson);
    const deletePerson = event.target.closest("[data-delete-person]");
    if (deletePerson) deleteDevelopmentPerson(deletePerson.dataset.deletePerson, deletePerson);
  });
  document.getElementById("product-repository-options").addEventListener("change", syncProductRepositories);
  document.getElementById("environment-editor").addEventListener("input", syncEnvironmentDraft);
  document.getElementById("environment-editor").addEventListener("change", syncEnvironmentDraft);
  document.getElementById("deployment-editor").addEventListener("input", syncDeploymentDraft);
  document.getElementById("deployment-editor").addEventListener("change", syncDeploymentDraft);
  document.addEventListener("change", (event) => {
    const ownerSelect = event.target.closest("[data-task-owner]");
    if (ownerSelect) assignWorkflowTask(ownerSelect.dataset.workflowId, ownerSelect.dataset.taskId, ownerSelect.value, "", ownerSelect);
    const agentSelect = event.target.closest("[data-task-agent]");
    if (agentSelect) assignWorkflowTask(agentSelect.dataset.workflowId, agentSelect.dataset.taskId, agentSelect.dataset.ownerId, agentSelect.value, agentSelect);
  });
  document.getElementById("modal-close").addEventListener("click", closeCommandModal);
  document.getElementById("modal-cancel").addEventListener("click", closeCommandModal);
  document.getElementById("modal-run").addEventListener("click", runPendingCommand);
  document.getElementById("command-modal").addEventListener("click", (event) => {
    if (event.target.id === "command-modal") closeCommandModal();
  });
  document.getElementById("product-modal").addEventListener("click", (event) => {
    if (event.target.id === "product-modal") closeProductModal();
  });
  document.getElementById("directory-modal").addEventListener("click", (event) => {
    if (event.target.id === "directory-modal") closeDirectoryModal();
  });
  document.getElementById("workflow-modal").addEventListener("click", (event) => {
    if (event.target.id === "workflow-modal") closeWorkflowModal();
  });
  document.getElementById("milestone-modal").addEventListener("click", (event) => {
    if (event.target.id === "milestone-modal") closeMilestoneModal();
  });
  document.getElementById("person-modal").addEventListener("click", (event) => {
    if (event.target.id === "person-modal") closePersonModal();
  });
  document.getElementById("person-agent-modal").addEventListener("click", (event) => {
    if (event.target.id === "person-agent-modal") closePersonAgentModal();
  });
  document.getElementById("group-chat-modal").addEventListener("click", (event) => {
    if (event.target.id === "group-chat-modal") closeGroupChatModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("command-modal").hidden) closeCommandModal();
    if (event.key === "Escape" && !document.getElementById("directory-modal").hidden) closeDirectoryModal();
    if (event.key === "Escape" && !document.getElementById("workflow-modal").hidden) closeWorkflowModal();
    if (event.key === "Escape" && !document.getElementById("milestone-modal").hidden) closeMilestoneModal();
    if (event.key === "Escape" && !document.getElementById("person-modal").hidden) closePersonModal();
    if (event.key === "Escape" && !document.getElementById("person-agent-modal").hidden) closePersonAgentModal();
    if (event.key === "Escape" && !document.getElementById("group-chat-modal").hidden) closeGroupChatModal();
  });
}

function renderMetrics() {
  const stats = state.overview.stats;
  const dirty = Math.max(stats.repositories - stats.cleanRepositories, 0);
  const metrics = [
    { label: "产品", value: stats.products, note: `${stats.environments} 个环境`, icon: "◇", tone: "" },
    { label: "代码仓库", value: stats.repositories, note: `${stats.cleanRepositories} 个工作区干净`, icon: "⌘", tone: "blue" },
    { label: "待处理仓库", value: dirty, note: dirty ? "存在未提交变更" : "代码状态稳定", icon: "↗", tone: "amber" },
    { label: "可用模型", value: stats.readyProviders, note: `${state.overview.providers.length} 个 Provider`, icon: "✦", tone: "mint" },
  ];
  document.getElementById("metric-grid").innerHTML = metrics.map((metric) => `
    <article class="metric-card">
      <div class="metric-top"><span class="metric-label">${escapeHtml(metric.label)}</span><span class="metric-icon ${metric.tone}">${metric.icon}</span></div>
      <div class="metric-value">${metric.value}</div>
      <div class="metric-note">${escapeHtml(metric.note)}</div>
    </article>
  `).join("");
}

function renderOverviewProjects() {
  const products = state.overview.products;
  const target = document.getElementById("overview-projects");
  if (!products.length) {
    target.innerHTML = '<div class="empty-state">尚未创建产品。</div>';
    return;
  }
  target.innerHTML = products.slice(0, 5).map((product) => `
    <article class="product-summary-row">
      <div class="project-identity"><span class="project-glyph">${productInitial(product)}</span><div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.description || product.id)}</small></div></div>
      <span class="dimension-count">${product.environments.length} 个环境</span>
      <span class="dimension-count">${product.repositoryDetails.length} 个仓库</span>
      <button class="row-button" data-edit-product="${escapeAttr(product.id)}">配置产品</button>
    </article>
  `).join("");
}

function renderProjectCards() {
  const target = document.getElementById("project-card-grid");
  const products = state.overview.products;
  if (!products.length) {
    target.innerHTML = '<div class="empty-state">没有已创建产品。</div>';
    return;
  }
  target.innerHTML = products.map(renderProductCard).join("");
}

function renderPeople() {
  const target = document.getElementById("people-grid");
  document.getElementById("nav-person-count").textContent = String(state.people.length);
  const workstationInfo = state.people.map((person) => personWorkstationInfo(person));
  const busyCount = workstationInfo.filter((item) => item.isBusy).length;
  document.getElementById("people-status-summary").textContent = `${busyCount} 忙碌 · ${state.people.length - busyCount} 空闲`;
  document.querySelectorAll("[data-people-view]").forEach((button) => {
    const active = button.dataset.peopleView === state.peopleViewMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  target.classList.toggle("is-workstation", state.peopleViewMode === "workstation");
  if (state.peopleViewMode === "workstation") {
    target.innerHTML = renderWorkstationZones(workstationInfo);
    return;
  }
  if (!state.people.length) {
    target.innerHTML = '<div class="empty-state">尚未创建人员。先定义责任人，再为其配置具有不同能力的 Agent。</div>';
    return;
  }
  target.innerHTML = state.people.map(renderPersonCard).join("");
}

function renderPersonCard(person) {
  return `
    <article class="person-card">
      <header class="person-card-header">
        <div class="person-identity"><span class="person-avatar">${escapeHtml(person.name.slice(0, 1).toUpperCase())}</span><div><strong>${escapeHtml(person.name)}</strong><small>${person.roles.map(assigneeRoleLabel).map(escapeHtml).join(" · ")}</small></div></div>
        <div class="person-card-actions"><button class="icon-button subtle" data-edit-person="${escapeAttr(person.id)}" aria-label="编辑 ${escapeAttr(person.name)}">✎</button><button class="icon-button danger-subtle" data-delete-person="${escapeAttr(person.id)}" aria-label="删除 ${escapeAttr(person.name)}">×</button>${person.agents[0] ? `<button class="row-button" data-edit-person-agent="${escapeAttr(person.agents[0].id)}" data-person-id="${escapeAttr(person.id)}">编辑 Agent</button>` : `<button class="row-button" data-add-person-agent="${escapeAttr(person.id)}">＋ 配置 Agent</button>`}</div>
      </header>
      <div class="person-agent-list">
        ${person.agents[0] ? renderPersonAgent(person.agents[0]) : '<div class="person-agent-empty">尚未配置 Agent</div>'}
      </div>
    </article>`;
}

function personWorkstationInfo(person) {
  const assigned = state.workflows.flatMap((workflow) => (workflow.taskItems || [])
    .filter((task) => task.ownerId === person.id)
    .map((task) => ({ workflow, task })));
  const active = assigned.filter(({ task }) => normalizedTaskStatus(task.status) === "in_progress");
  return { isBusy: active.length > 0, active, assigned };
}

function personWorkstationZone(person) {
  const supportedRoles = ["developer", "tester", "deployer", "releaser", "operator"];
  const role = supportedRoles.includes(person.agents?.[0]?.role)
    ? person.agents[0].role
    : [...person.roles].reverse().find((item) => supportedRoles.includes(item));
  if (role === "tester") return "testing";
  if (role === "deployer" || role === "releaser") return "operations";
  if (role === "operator") return "content";
  return "development";
}

function renderWorkstationZones(workstationInfo) {
  const people = state.people.map((person, index) => ({ person, info: workstationInfo[index] }));
  const zones = [
    { id: "development", title: "研发区", icon: "</>" },
    { id: "testing", title: "测试区", icon: "✓" },
    { id: "operations", title: "运维区", icon: "⌁" },
    { id: "content", title: "运营区", icon: "文" },
  ];
  return zones.map((zone) => {
    const members = people.filter(({ person }) => personWorkstationZone(person) === zone.id);
    const busyCount = members.filter(({ info }) => info.isBusy).length;
    const workstations = members.length
      ? members.map(({ person, info }) => renderPersonWorkstation(person, info)).join("")
      : `<div class="workstation-zone-empty">${escapeHtml(zone.title)}暂无人员</div>`;
    return `
      <section class="workstation-zone workstation-zone-${zone.id}">
        <header class="workstation-zone-header">
          <div class="workstation-zone-identity"><span class="workstation-zone-icon">${escapeHtml(zone.icon)}</span><strong>${escapeHtml(zone.title)}</strong></div>
          <span class="workstation-zone-summary" title="${busyCount} 人忙碌，${members.length - busyCount} 人空闲"><i></i>${members.length}</span>
        </header>
        <div class="workstation-zone-grid">${workstations}</div>
      </section>`;
  }).join("");
}

function renderPersonWorkstation(person, info) {
  const statusLabel = info.isBusy ? "忙碌" : "空闲";
  return `
    <article class="workstation-card ${info.isBusy ? "is-busy" : "is-idle"}" aria-label="${escapeAttr(person.name)}，当前${statusLabel}">
      <div class="workstation-scene" role="img" aria-label="${escapeAttr(`${person.name}当前${statusLabel}，${info.isBusy ? "正在工位敲击键盘" : "趴在工位休息"}`)}">
        <span class="workstation-person-name">${escapeHtml(person.name)}</span>
        <span class="workstation-status"><i></i>${statusLabel}</span>
      </div>
    </article>`;
}

function renderPersonAgent(agent) {
  const prioritizedSkillIds = [...agent.skillIds].sort((left, right) => Number(right === "team_chat") - Number(left === "team_chat"));
  const skillNames = prioritizedSkillIds.map((id) => state.skills.find((skill) => skill.id === id)?.name || id);
  return `
    <article class="person-agent-card">
      <span class="person-agent-mark">✦</span>
      <div class="person-agent-copy">
        <div><strong>${escapeHtml(agent.name)}</strong><span class="badge neutral">${escapeHtml(assigneeRoleLabel(agent.role))}</span></div>
        <small>${escapeHtml(agent.providerId)} · ${agent.toolIds.length} Tools · ${agent.repositoryIds.length} 仓库 · ${agent.environmentIds.length} 环境</small>
        <p>${skillNames.length ? skillNames.slice(0, 5).map((name) => `<span>${escapeHtml(name)}</span>`).join("") : "<em>未配置 Skills</em>"}</p>
      </div>
    </article>`;
}

function renderWorkflows() {
  const target = document.getElementById("workflow-list");
  if (!state.milestones.length) {
    target.innerHTML = '<section class="panel workflow-empty"><span class="workflow-empty-icon">⇢</span><h3>从第一个版本开始</h3><p>定义版本号和目标，再把多个需求纳入同一个交付版本。</p><button class="primary-button" type="button" data-open-milestone>＋ 新建版本</button></section>';
    target.querySelector("[data-open-milestone]").addEventListener("click", openMilestoneModal);
    return;
  }
  target.innerHTML = state.milestones.map(renderVersionCard).join("");
}

const kanbanColumns = [
  { status: "pending", label: "待办", hint: "尚未开始", tone: "pending" },
  { status: "in_progress", label: "进行中", hint: "正在处理", tone: "progress" },
  { status: "blocked", label: "阻塞", hint: "等待确认或处理", tone: "blocked" },
  { status: "completed", label: "已完成", hint: "已交付结果", tone: "completed" },
];

function allKanbanTasks() {
  const milestones = new Map(state.milestones.map((item) => [item.id, item]));
  const products = new Map((state.overview?.products || []).map((item) => [item.id, item]));
  return state.workflows.flatMap((workflow) => (workflow.taskItems || []).map((task) => ({
    workflow,
    task,
    milestone: milestones.get(workflow.milestoneId),
    product: products.get(workflow.productId),
    owner: state.people.find((person) => person.id === task.ownerId),
  })));
}

function normalizedTaskStatus(status) {
  return status === "failed" ? "blocked" : status;
}

function renderKanban() {
  const productSelect = document.getElementById("kanban-product-filter");
  const milestoneSelect = document.getElementById("kanban-milestone-filter");
  const ownerSelect = document.getElementById("kanban-owner-filter");
  if (!productSelect || !milestoneSelect || !ownerSelect) return;

  const products = state.overview?.products || [];
  productSelect.innerHTML = '<option value="">请选择产品</option>' + products.map((product) =>
    `<option value="${escapeAttr(product.id)}">${escapeHtml(product.name)}</option>`,
  ).join("");
  if (products.some((item) => item.id === state.kanbanProductId)) productSelect.value = state.kanbanProductId;
  else {
    state.kanbanProductId = "";
    state.kanbanMilestoneId = "";
  }

  const productMilestones = state.milestones.filter((milestone) => milestone.productId === state.kanbanProductId);
  milestoneSelect.disabled = !state.kanbanProductId || productMilestones.length === 0;
  milestoneSelect.innerHTML = `<option value="">${state.kanbanProductId ? (productMilestones.length ? "请选择版本" : "该产品暂无版本") : "请先选择产品"}</option>` + productMilestones.map((milestone) =>
    `<option value="${escapeAttr(milestone.id)}">${escapeHtml(milestone.title)}</option>`,
  ).join("");
  if (productMilestones.some((item) => item.id === state.kanbanMilestoneId)) milestoneSelect.value = state.kanbanMilestoneId;
  else state.kanbanMilestoneId = "";

  ownerSelect.innerHTML = '<option value="">全部负责人</option><option value="__unassigned__">未分配</option>' + state.people.map((person) =>
    `<option value="${escapeAttr(person.id)}">${escapeHtml(person.name)}</option>`,
  ).join("");
  if (state.kanbanOwnerId === "__unassigned__" || state.people.some((item) => item.id === state.kanbanOwnerId)) ownerSelect.value = state.kanbanOwnerId;
  else state.kanbanOwnerId = "";

  const allTasks = allKanbanTasks();
  document.getElementById("nav-kanban-count").textContent = String(allTasks.filter(({ task }) => normalizedTaskStatus(task.status) !== "completed").length);
  if (!state.kanbanProductId || !state.kanbanMilestoneId) {
    document.getElementById("kanban-summary").textContent = state.kanbanProductId ? "请选择版本" : "请选择产品和版本";
    document.getElementById("kanban-board").innerHTML = `<div class="kanban-scope-empty"><span>▦</span><h3>${state.kanbanProductId ? "请选择交付版本" : "先确定产品和版本"}</h3><p>${state.kanbanProductId ? "版本选择后，将显示该版本的全部研发任务。" : "看板以单个产品的单个版本为工作范围，避免不同交付批次的任务混在一起。"}</p></div>`;
    return;
  }
  const tasks = allTasks.filter(({ workflow, task }) => {
    if (workflow.productId !== state.kanbanProductId || workflow.milestoneId !== state.kanbanMilestoneId) return false;
    if (state.kanbanOwnerId === "__unassigned__" && task.ownerId) return false;
    if (state.kanbanOwnerId && state.kanbanOwnerId !== "__unassigned__" && task.ownerId !== state.kanbanOwnerId) return false;
    return true;
  });
  const completed = tasks.filter(({ task }) => normalizedTaskStatus(task.status) === "completed").length;
  document.getElementById("kanban-summary").innerHTML = `<strong>${tasks.length}</strong> 个任务 · <strong>${completed}</strong> 已完成`;

  document.getElementById("kanban-board").innerHTML = kanbanColumns.map((column) => {
    const columnTasks = tasks.filter(({ task }) => normalizedTaskStatus(task.status) === column.status);
    return `
      <section class="kanban-column ${column.tone}" data-kanban-column="${column.status}">
        <header><div><span class="kanban-status-dot"></span><h3>${column.label}</h3><b>${columnTasks.length}</b></div><small>${column.hint}</small></header>
        <div class="kanban-column-body">
          ${columnTasks.length ? columnTasks.map(renderKanbanCard).join("") : '<div class="kanban-column-empty">拖动任务到这里</div>'}
        </div>
      </section>`;
  }).join("");
}

function renderKanbanCard({ workflow, task, milestone, product, owner }) {
  const status = normalizedTaskStatus(task.status);
  const agent = owner?.agents?.find((item) => item.id === task.agentId);
  return `
    <article class="kanban-card" draggable="true" data-kanban-card data-workflow-id="${escapeAttr(workflow.id)}" data-task-id="${escapeAttr(task.id)}">
      <div class="kanban-card-meta"><span class="task-stage ${escapeAttr(task.stage)}">${escapeHtml(workflowStageLabel(task.stage))}</span><span>${escapeHtml(task.id)}</span></div>
      <h4>${escapeHtml(task.title)}</h4>
      <button class="kanban-requirement" type="button" data-kanban-open="${escapeAttr(workflow.id)}" title="查看需求">${escapeHtml(workflow.title)}</button>
      <div class="kanban-card-scope"><span>${escapeHtml(product?.name || workflow.productId)}</span><span>${escapeHtml(milestone?.title || "未归属版本")}</span></div>
      <div class="kanban-card-footer">
        <div class="kanban-owner"><span>${owner ? escapeHtml(owner.name.slice(0, 1)) : "?"}</span><div><strong>${owner ? escapeHtml(owner.name) : "未分配"}</strong><small>${agent ? escapeHtml(agent.name) : owner ? "人工负责" : "等待分配"}</small></div></div>
        <select data-kanban-status data-workflow-id="${escapeAttr(workflow.id)}" data-task-id="${escapeAttr(task.id)}" aria-label="更新 ${escapeAttr(task.title)} 的状态">
          ${kanbanColumns.map((column) => `<option value="${column.status}" ${column.status === status ? "selected" : ""}>${column.label}</option>`).join("")}
        </select>
      </div>
    </article>`;
}

function beginKanbanDrag(event) {
  const card = event.target.closest("[data-kanban-card]");
  if (!card) return;
  state.draggedKanbanTask = { workflowId: card.dataset.workflowId, taskId: card.dataset.taskId };
  card.classList.add("is-dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${card.dataset.workflowId}::${card.dataset.taskId}`);
  }
}

function endKanbanDrag(event) {
  event.target.closest("[data-kanban-card]")?.classList.remove("is-dragging");
  document.querySelectorAll(".kanban-column.is-drop-target").forEach((column) => column.classList.remove("is-drop-target"));
  state.draggedKanbanTask = null;
}

function allowKanbanDrop(event) {
  const column = event.target.closest("[data-kanban-column]");
  if (!column || !state.draggedKanbanTask) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  document.querySelectorAll(".kanban-column.is-drop-target").forEach((item) => item.classList.toggle("is-drop-target", item === column));
}

function leaveKanbanDrop(event) {
  const column = event.target.closest("[data-kanban-column]");
  if (column && !column.contains(event.relatedTarget)) column.classList.remove("is-drop-target");
}

function dropKanbanTask(event) {
  const column = event.target.closest("[data-kanban-column]");
  if (!column || !state.draggedKanbanTask) return;
  event.preventDefault();
  const { workflowId, taskId } = state.draggedKanbanTask;
  column.classList.remove("is-drop-target");
  updateKanbanTaskStatus(workflowId, taskId, column.dataset.kanbanColumn, column);
}

async function updateKanbanTaskStatus(workflowId, taskId, status, control) {
  const workflow = state.workflows.find((item) => item.id === workflowId);
  const task = workflow?.taskItems?.find((item) => item.id === taskId);
  if (!task || normalizedTaskStatus(task.status) === status) return;
  control?.classList?.add("is-updating");
  if ("disabled" in (control || {})) control.disabled = true;
  try {
    const result = await api("/api/workflows/task-status", {
      method: "POST",
      body: JSON.stringify({ workflowId, taskId, status }),
    });
    state.workflows = state.workflows.map((item) => item.id === workflowId ? result.workflow : item);
    renderWorkflows();
    renderKanban();
    renderPeople();
    renderGroupChats();
    showToast(`任务已移至“${taskStatusLabel(status)}”`);
  } catch (error) {
    showToast(error.message, true);
    await refreshWorkflows();
  }
}

function openKanbanWorkflow(workflowId) {
  switchView("workflow");
  setTimeout(() => document.getElementById(`workflow-${workflowId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
}

function renderVersionCard(version) {
  const product = state.overview.products.find((item) => item.id === version.productId);
  const requirements = state.workflows.filter((workflow) => workflow.milestoneId === version.id);
  const stageTotal = requirements.reduce((total, workflow) => total + Math.max(workflowStages.findIndex(([stage]) => stage === workflow.stage), 0), 0);
  const progress = requirements.length ? Math.round((stageTotal / (requirements.length * (workflowStages.length - 1))) * 100) : 0;
  return `
    <section class="version-card panel">
      <header class="version-card-header">
        <div><span class="panel-kicker">${escapeHtml(product?.name || version.productId)}</span><h3>${escapeHtml(version.title)}</h3><p>${escapeHtml(version.goal)}</p></div>
        <div class="version-summary"><span class="badge neutral">${requirements.length} 个需求</span><strong>${progress}%</strong><small>${version.targetDate ? `目标 ${escapeHtml(version.targetDate)}` : "未设置目标日期"}</small></div>
      </header>
      <div class="version-progress"><span style="width:${progress}%"></span></div>
      <div class="version-requirements">
        ${requirements.length ? requirements.map(renderWorkflowCard).join("") : '<div class="product-empty-dimension">当前版本还没有需求。</div>'}
      </div>
      <footer class="version-card-footer"><button class="secondary-button" data-milestone-add="${escapeAttr(version.id)}">＋ 添加需求</button></footer>
    </section>`;
}

function renderWorkflowCard(workflow) {
  const product = state.overview.products.find((item) => item.id === workflow.productId);
  const stageIndex = Math.max(workflowStages.findIndex(([stage]) => stage === workflow.stage), 0);
  const progress = workflowStages.map(([stage, label], index) => `
    <span class="workflow-step ${index < stageIndex ? "is-complete" : ""} ${index === stageIndex ? "is-current" : ""}"><b>${index < stageIndex ? "✓" : String(index + 1).padStart(2, "0")}</b>${label}</span>
  `).join('<i class="workflow-step-arrow">→</i>');
  const documents = [
    ["需求", workflow.requirement, "requirement"],
    ["计划", workflow.plan, "plan"],
    ["任务", workflow.tasks, "tasks"],
  ].filter(([, content]) => content).map(([label, content, kind]) => `
    <section class="workflow-document ${kind}"><span>${label}</span><pre>${escapeHtml(content)}</pre></section>
  `).join("");
  return `
    <article class="workflow-card" id="workflow-${escapeAttr(workflow.id)}">
      <header class="workflow-card-header">
        <div><span class="panel-kicker">${escapeHtml(product?.name || workflow.productId)}</span><h3>${escapeHtml(workflow.title)}</h3><p>${escapeHtml(workflow.providerId)} · 更新于 ${escapeHtml(formatRelative(workflow.updatedAt))}</p></div>
        <span class="badge neutral">${escapeHtml(workflowStageLabel(workflow.stage))}</span>
      </header>
      <div class="workflow-progress">${progress}</div>
      <div class="workflow-documents">${documents}</div>
      ${renderWorkflowTaskBoard(workflow)}
      <footer class="workflow-card-footer">${renderWorkflowAction(workflow, product)}</footer>
    </article>`;
}

function renderWorkflowTaskBoard(workflow) {
  const tasks = workflow.taskItems || [];
  if (!tasks.length) return "";
  return `
    <section class="workflow-task-board">
      <header><div><span class="panel-kicker">RESPONSIBILITY</span><h4>负责人和执行 Agent</h4></div><small>${tasks.filter((task) => task.ownerId).length} / ${tasks.length} 已明确负责人</small></header>
      <div class="workflow-task-list">
        ${tasks.map((task) => {
          const role = taskRole(task.stage);
          const eligiblePeople = state.people.filter((person) => person.roles.includes(role) && person.agents.some((agent) => agent.role === role));
          const owner = state.people.find((person) => person.id === task.ownerId);
          const eligibleAgents = owner ? owner.agents.filter((agent) => agent.role === role) : [];
          const ownerIsEligible = owner && eligiblePeople.some((person) => person.id === owner.id);
          return `
            <article class="workflow-task-row">
              <span class="task-stage ${escapeAttr(task.stage)}">${escapeHtml(workflowStageLabel(task.stage))}</span>
              <div class="task-copy"><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.id)} · ${escapeHtml(taskStatusLabel(task.status))}</small></div>
              <label class="task-assignment-field"><span>负责人</span><select data-task-owner data-workflow-id="${escapeAttr(workflow.id)}" data-task-id="${escapeAttr(task.id)}" aria-label="为任务 ${escapeAttr(task.title)} 选择负责人">
                <option value="" ${task.ownerId ? "" : "selected"}>未分配${eligiblePeople.length ? "" : `（需配置${assigneeRoleLabel(role)} Agent）`}</option>
                ${owner && !ownerIsEligible ? `<option value="${escapeAttr(owner.id)}" selected disabled>${escapeHtml(owner.name)}（Agent 不可用）</option>` : ""}
                ${eligiblePeople.map((person) => `<option value="${escapeAttr(person.id)}" ${person.id === task.ownerId ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}
              </select></label>
              <label class="task-assignment-field"><span>执行 Agent（可选）</span><select data-task-agent data-workflow-id="${escapeAttr(workflow.id)}" data-task-id="${escapeAttr(task.id)}" data-owner-id="${escapeAttr(task.ownerId || "")}" ${ownerIsEligible ? "" : "disabled"} aria-label="为任务 ${escapeAttr(task.title)} 选择执行 Agent">
                <option value="" ${task.agentId ? "" : "selected"}>${ownerIsEligible ? "不使用 Agent" : "请先选择可用负责人"}</option>
                ${eligibleAgents.map((agent) => `<option value="${escapeAttr(agent.id)}" ${agent.id === task.agentId ? "selected" : ""}>${escapeHtml(agent.name)}</option>`).join("")}
              </select></label>
            </article>`;
        }).join("")}
      </div>
    </section>`;
}

function renderWorkflowAction(workflow, product) {
  if (workflow.stage === "requirement") {
    return `<button class="primary-button" data-workflow-generate="plan" data-workflow-id="${escapeAttr(workflow.id)}">AI 生成计划 →</button>`;
  }
  if (workflow.stage === "plan") {
    return `<button class="primary-button" data-workflow-generate="tasks" data-workflow-id="${escapeAttr(workflow.id)}">AI 拆分任务 →</button>`;
  }
  const hasRepository = Boolean(product?.repositoryDetails?.length);
  if (!hasRepository) {
    return `<span class="workflow-action-note">编码、部署和测试需要代码仓库</span><button class="primary-button" data-workflow-config="${escapeAttr(workflow.productId)}">去关联仓库 →</button>`;
  }
  if (workflow.stage === "tasks") {
    return `<button class="primary-button" data-workflow-stage="coding" data-workflow-id="${escapeAttr(workflow.id)}">开始编码 →</button>`;
  }
  if (workflow.stage === "coding") {
    return `<button class="secondary-button" data-workflow-agent="coding" data-workflow-id="${escapeAttr(workflow.id)}">继续 Agent 编码</button><button class="primary-button" data-workflow-stage="deployment" data-workflow-id="${escapeAttr(workflow.id)}">编码完成，进入部署 →</button>`;
  }
  if (workflow.stage === "deployment") {
    return `<button class="secondary-button" data-workflow-agent="deployment" data-workflow-id="${escapeAttr(workflow.id)}">交给 Agent 部署</button><button class="primary-button" data-workflow-stage="testing" data-workflow-id="${escapeAttr(workflow.id)}">部署完成，进入测试 →</button>`;
  }
  if (workflow.stage === "testing") {
    return `<button class="secondary-button" data-workflow-agent="testing" data-workflow-id="${escapeAttr(workflow.id)}">交给 Agent 测试</button><button class="primary-button" data-workflow-stage="release" data-workflow-id="${escapeAttr(workflow.id)}">测试完成，进入发布 →</button>`;
  }
  return `<button class="primary-button" data-workflow-agent="release" data-workflow-id="${escapeAttr(workflow.id)}">交给 Agent 发布 →</button>`;
}

function workflowStageLabel(stage) {
  return workflowStages.find(([value]) => value === stage)?.[1] || stage;
}

function assigneeRoleLabel(role) {
  return ({ developer: "开发", tester: "测试", deployer: "部署", releaser: "发布", operator: "运营" })[role] || role;
}

function taskRole(stage) {
  return ({ coding: "developer", testing: "tester", deployment: "deployer", release: "releaser" })[stage] || "developer";
}

function taskStatusLabel(status) {
  return ({ pending: "待处理", in_progress: "进行中", blocked: "已阻塞", completed: "已完成", failed: "失败" })[status] || status;
}

function renderProductCard(product) {
  const environmentCells = product.environments.length
    ? product.environments.map(renderEnvironmentChip).join("")
    : '<div class="product-empty-dimension">尚未配置环境</div>';

  const repositoryRows = product.repositoryDetails.length
    ? `<div class="repository-table">
        <div class="repository-table-row header"><span>代码仓库</span><span>当前分支</span><span>工作区</span></div>
        ${product.repositoryDetails.map((repository) => `
          <div class="repository-table-row">
            <div class="repo-name"><strong>${escapeHtml(repository.id)}</strong><small title="${escapeAttr(repository.path)}">${escapeHtml(repository.lastCommit)}</small></div>
            <span class="branch-name">${escapeHtml(repository.branch)}</span>
            <span class="badge ${repository.clean ? "success" : "warn"}">${repository.clean ? "clean" : `${repository.changes} changes`}</span>
          </div>`).join("")}
      </div>`
    : '<div class="product-empty-dimension">尚未关联代码仓库，可在“配置产品”中选择。</div>';

  return `
    <article class="project-card product-card">
      <div class="project-card-head product-card-head">
        <div class="project-card-title"><span class="project-glyph">${productInitial(product)}</span><div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description || product.id)}</p></div></div>
        <div class="product-card-head-actions"><span class="badge neutral">${product.environments.length} ENV · ${product.repositoryDetails.length} REPO</span><button class="row-button" data-edit-product="${escapeAttr(product.id)}">配置产品</button><button class="icon-button danger-subtle" data-delete-product="${escapeAttr(product.id)}" aria-label="删除 ${escapeAttr(product.name)}" title="删除产品">×</button></div>
      </div>
      <div class="product-body">
        <section class="product-dimension">
          <div class="dimension-header"><h4>环境</h4><span>独立维护运行状态</span></div>
          <div class="environment-chip-list">${environmentCells}</div>
        </section>
        <section class="product-dimension">
          <div class="dimension-header"><h4>代码仓库</h4><span>实时读取本地 Git 状态</span></div>
          ${repositoryRows}
        </section>
      </div>
      <section class="deployment-section">
        <div class="dimension-header"><h4>部署矩阵</h4><span>环境 × 代码仓库的关联关系</span></div>
        ${renderDeploymentMatrix(product)}
      </section>
    </article>`;
}

function renderEnvironmentChip(environment) {
  const href = safeEnvironmentUrl(environment.url);
  const tag = href ? "a" : "div";
  const linkAttributes = href
    ? ` href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer" aria-label="打开环境：${escapeAttr(environment.name)}" title="打开环境：${escapeAttr(href)}"`
    : "";
  return `
    <${tag} class="environment-chip${href ? " is-link" : ""}"${linkAttributes}>
      <span class="environment-state ${escapeAttr(environment.status)}"></span>
      <div><strong>${escapeHtml(environment.name)}</strong><small>${escapeHtml(environment.url || environment.namespace || "地址待配置")}</small></div>
      <span class="environment-chip-meta"><span class="environment-kind">${escapeHtml(environment.kind)}</span>${href ? '<span class="environment-open" aria-hidden="true">↗</span>' : ""}</span>
    </${tag}>`;
}

function safeEnvironmentUrl(value) {
  const candidate = String(value || "").trim();
  if (!/^https?:\/\//i.test(candidate)) return "";
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch (_error) {
    return "";
  }
}

function renderDeploymentMatrix(product) {
  if (!product.environments.length || !product.repositoryDetails.length) {
    return '<div class="product-empty-dimension">关联环境和代码仓库后，可在这里维护各环境部署的分支或版本。</div>';
  }
  const deploymentByKey = new Map((product.deployments || []).map((deployment) => [`${deployment.environmentId}:${deployment.repositoryId}`, deployment]));
  return `<div class="deployment-matrix"><table><thead><tr><th>代码仓库</th>${product.environments.map((environment) => `<th>${escapeHtml(environment.name)}</th>`).join("")}</tr></thead><tbody>
    ${product.repositoryDetails.map((repository) => `<tr><td><strong>${escapeHtml(repository.id)}</strong><br><span class="unmapped">当前 ${escapeHtml(repository.branch)}</span></td>${product.environments.map((environment) => {
      const deployment = deploymentByKey.get(`${environment.id}:${repository.id}`);
      return `<td>${deployment ? `<div class="deployment-cell"><strong>${escapeHtml(deployment.branch || deployment.version || "未记录版本")}</strong><small>${escapeHtml(deployment.status)}${deployment.version ? ` · ${escapeHtml(deployment.version)}` : ""}</small></div>` : '<span class="unmapped">未映射</span>'}</td>`;
    }).join("")}</tr>`).join("")}
  </tbody></table></div>`;
}

function renderEnvironment() {
  const checks = state.doctor;
  const readyRequired = checks.filter((check) => check.required).every((check) => check.ready);
  const summary = document.getElementById("environment-summary");
  summary.className = `badge ${readyRequired ? "success" : "danger"}`;
  summary.textContent = readyRequired ? "核心环境正常" : "需要处理";
  document.getElementById("environment-list").innerHTML = checks.map((check) => `
    <div class="environment-item">
      <div class="environment-name"><span class="environment-glyph">${escapeHtml(check.name.slice(0, 2).toUpperCase())}</span><div><strong>${escapeHtml(check.name)}</strong><small>${escapeHtml(check.version || "未检测到")}</small></div></div>
      <span class="badge ${check.ready ? "success" : (check.required ? "danger" : "warn")}">${check.ready ? "ready" : (check.required ? "missing" : "optional")}</span>
    </div>
  `).join("");
}

function renderActivity() {
  const target = document.getElementById("overview-activity");
  const runs = state.overview.recentRuns || [];
  if (!runs.length) {
    target.innerHTML = '<div class="empty-state">暂无运行记录</div>';
    return;
  }
  target.innerHTML = runs.slice(0, 6).map((run) => `
    <article class="activity-item">
      <span class="activity-mark ${escapeAttr(run.event)}">${run.event === "completed" ? "✓" : run.event === "failed" ? "×" : "…"}</span>
      <div class="activity-copy"><strong>${escapeHtml(actionName(run.action))}</strong><small>${escapeHtml(detailSummary(run.details))}</small></div>
      <span class="badge ${run.event === "completed" ? "success" : run.event === "failed" ? "danger" : "warn"}">${escapeHtml(run.event)}</span>
      <time class="activity-time">${formatRelative(run.timestamp)}</time>
    </article>
  `).join("");
}

function renderRuns() {
  const body = document.getElementById("runs-table-body");
  if (!state.runs.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-state">暂无运行记录</td></tr>';
    return;
  }
  body.innerHTML = state.runs.map((run) => `
    <tr>
      <td><span class="run-status"><span class="status-dot ${run.event === "failed" ? "is-warn" : ""}"></span>${escapeHtml(run.event)}</span></td>
      <td>${escapeHtml(actionName(run.action))}</td>
      <td>${runModelCell(run.details)}</td>
      <td><code>${escapeHtml(run.runId || "—")}</code></td>
      <td>${formatDateTime(run.timestamp)}</td>
      <td class="detail-text" title="${escapeAttr(detailSummary(run.details, false))}">${escapeHtml(detailSummary(run.details, false))}</td>
    </tr>
  `).join("");
}

function renderGroupChats() {
  const list = document.getElementById("group-chat-list");
  if (!state.groupChats.some((chat) => chat.id === state.activeGroupChatId)) {
    state.activeGroupChatId = state.groupChats[0]?.id || null;
  }
  list.innerHTML = state.groupChats.length
    ? state.groupChats.map((chat) => {
        const latest = chat.messages[chat.messages.length - 1];
        return `<button type="button" class="group-chat-channel ${chat.id === state.activeGroupChatId ? "is-active" : ""}" data-group-chat-id="${escapeAttr(chat.id)}"><span class="group-chat-channel-mark">#</span><span><strong>${escapeHtml(chat.name)}</strong><small>${chat.memberIds.length + 1} 人${latest ? ` · ${escapeHtml(formatRelative(latest.createdAt))}` : " · 暂无消息"}</small></span><b>${chat.messages.length}</b></button>`;
      }).join("")
    : '<div class="empty-state">尚未新建群聊</div>';

  const chat = state.groupChats.find((item) => item.id === state.activeGroupChatId);
  const header = document.getElementById("group-chat-header");
  const messages = document.getElementById("group-chat-messages");
  const form = document.getElementById("group-chat-form");
  if (!chat) {
    header.innerHTML = "<h3>选择群聊</h3>";
    messages.innerHTML = '<div class="empty-state">暂无群聊消息</div>';
    form.hidden = true;
    return;
  }

  const members = chat.memberIds.map((id) => state.people.find((person) => person.id === id)).filter(Boolean);
  header.innerHTML = `<h3>${escapeHtml(chat.name)}<span>（${members.length + 1}人）</span></h3>`;
  messages.innerHTML = chat.messages.length
    ? chat.messages.map((message) => `
        <article class="group-chat-message ${escapeAttr(message.activity)} ${escapeAttr(message.senderType || "person")} ${message.clientPending ? "is-pending" : ""}">
          <span class="group-chat-avatar">${escapeHtml(message.senderName.slice(0, 1))}</span>
          <div class="group-chat-message-body">
            <header><strong>${escapeHtml(message.senderName)}</strong><span class="group-chat-actor ${escapeAttr(message.senderType || "person")}">${escapeHtml(groupChatSenderLabel(message.senderType))}</span>${message.activity === "message" ? "" : `<span class="group-chat-activity ${escapeAttr(message.activity)}">${escapeHtml(groupChatActivityLabel(message.activity))}</span>`}<time>${message.clientPending ? "发送中…" : escapeHtml(formatRelative(message.createdAt))}</time></header>
            ${message.taskTitle ? `<div class="group-chat-task-context"><span>${escapeHtml(message.workflowTitle || "研发任务")}</span><strong>${escapeHtml(message.taskId)} · ${escapeHtml(message.taskTitle)}</strong></div>` : ""}
            <p>${escapeHtml(message.text)}</p>
          </div>
        </article>`).join("")
    : '<div class="empty-state">暂无消息，发送第一条工作动态吧。</div>';
  form.hidden = false;
  const sender = document.getElementById("group-chat-sender");
  const previousSender = sender.value;
  sender.innerHTML = `<option value="${escapeAttr(state.currentUser.id)}">${escapeHtml(state.currentUser.name)}（当前管理员）</option>` + members.map((person) => `<option value="${escapeAttr(person.id)}">${escapeHtml(person.name)}（员工）</option>`).join("");
  if (previousSender === state.currentUser.id || members.some((person) => person.id === previousSender)) sender.value = previousSender;
  renderGroupChatMentionOptions(members);
  updateGroupChatComposer();
  messages.scrollTop = messages.scrollHeight;
}

function selectGroupChat(groupChatId) {
  state.activeGroupChatId = groupChatId;
  renderGroupChats();
}

function renderGroupChatTaskOptions() {
  const senderId = document.getElementById("group-chat-sender").value;
  const activity = document.getElementById("group-chat-activity").value;
  const select = document.getElementById("group-chat-task");
  const previous = select.value;
  const tasks = state.workflows.flatMap((workflow) => (workflow.taskItems || [])
    .filter((task) => task.ownerId === senderId)
    .map((task) => ({ workflow, task })));
  const isAdministrator = senderId === state.currentUser?.id;
  const requiresTask = !isAdministrator && (activity === "started" || activity === "completed");
  select.innerHTML = `<option value="">${requiresTask ? "选择已分配任务" : "不关联任务"}</option>` + tasks.map(({ workflow, task }) => `<option value="${escapeAttr(`${workflow.id}::${task.id}`)}">${escapeHtml(workflow.title)} / ${escapeHtml(task.title)}（${escapeHtml(taskStatusLabel(task.status))}）</option>`).join("");
  if (tasks.some(({ workflow, task }) => `${workflow.id}::${task.id}` === previous)) select.value = previous;
  select.disabled = isAdministrator || (!tasks.length && requiresTask);
}

function renderGroupChatMentionOptions(members) {
  const target = document.getElementById("group-chat-mention-options");
  const availableAgentCount = members.filter((person) => person.agents?.[0]?.skillIds?.includes("team_chat")).length;
  const everyoneOption = `<button type="button" class="mention-everyone" data-mention-person="所有人" ${availableAgentCount ? "" : "disabled"} title="${escapeAttr(availableAgentCount ? `通知全部群成员，${availableAgentCount} 个 Agent 将结合群聊上下文回答` : "群内尚无可回答的 Agent")}">@所有人</button>`;
  target.innerHTML = '<span>快捷 @</span>' + everyoneOption + members.map((person) => {
    const agent = person.agents?.[0];
    const available = Boolean(agent?.skillIds?.includes("team_chat"));
    return `<button type="button" data-mention-person="${escapeAttr(person.name)}" ${available ? "" : "disabled"} title="${escapeAttr(available ? `${agent.name} 将结合群聊上下文回答` : "尚未配置可回答的 Agent")}">@${escapeHtml(person.name)}${available ? "" : "（无 Agent）"}</button>`;
  }).join("");
}

function updateGroupChatComposer() {
  const senderId = document.getElementById("group-chat-sender").value;
  const activitySelect = document.getElementById("group-chat-activity");
  const isAdministrator = senderId === state.currentUser?.id;
  Array.from(activitySelect.options).forEach((option) => {
    option.disabled = isAdministrator && (option.value === "started" || option.value === "completed");
  });
  if (isAdministrator && ["started", "completed"].includes(activitySelect.value)) activitySelect.value = "message";
  const activity = activitySelect.value;
  const message = document.getElementById("group-chat-message");
  message.placeholder = isAdministrator
    ? "输入消息，例如：@所有人 请同步当前进度"
    : activity === "started"
    ? "可补充计划或预计完成时间；留空将自动发送“开始处理：任务名”"
    : activity === "completed" ? "可补充结果或验证结论；留空将自动发送“已完成：任务名”"
      : activity === "confirmation" ? "说明需要团队确认的问题或决策"
        : "输入群聊消息";
  document.getElementById("group-chat-mention-options").hidden = !isAdministrator;
  renderGroupChatTaskOptions();
}

function openGroupChatModal() {
  if (state.people.length < 2) {
    showToast("至少需要两名员工才能新建群聊", true);
    return;
  }
  document.getElementById("group-chat-name").value = "";
  document.getElementById("group-chat-member-options").innerHTML = state.people.map((person) => capabilityOption(person.id, person.name, person.roles.map(assigneeRoleLabel).join(" · "), true)).join("");
  document.getElementById("group-chat-modal").hidden = false;
  setTimeout(() => document.getElementById("group-chat-name").focus(), 50);
}

function closeGroupChatModal() {
  document.getElementById("group-chat-modal").hidden = true;
}

async function createTeamGroupChat(event) {
  event.preventDefault();
  const memberIds = checkedValues("group-chat-member-options");
  if (memberIds.length < 2) {
    showToast("群聊至少选择两名成员", true);
    return;
  }
  const button = document.getElementById("group-chat-create");
  button.disabled = true;
  button.textContent = "创建中…";
  try {
    const result = await api("/api/group-chats", {
      method: "POST",
      body: JSON.stringify({ name: document.getElementById("group-chat-name").value.trim(), memberIds }),
    });
    state.groupChats = [result.groupChat, ...state.groupChats];
    state.activeGroupChatId = result.groupChat.id;
    document.getElementById("nav-group-chat-count").textContent = String(state.groupChats.length);
    renderGroupChats();
    closeGroupChatModal();
    showToast(`群聊“${result.groupChat.name}”已创建`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "创建群聊";
  }
}

async function sendGroupChatMessage(event) {
  event.preventDefault();
  const chat = state.groupChats.find((item) => item.id === state.activeGroupChatId);
  if (!chat) return;
  const senderPersonId = document.getElementById("group-chat-sender").value;
  const activity = document.getElementById("group-chat-activity").value;
  const taskValue = document.getElementById("group-chat-task").value;
  const [workflowId, taskId] = taskValue ? taskValue.split("::") : ["", ""];
  const messageInput = document.getElementById("group-chat-message");
  const text = messageInput.value.trim();
  if ((activity === "started" || activity === "completed") && !taskId) {
    showToast("开始或完成工作时必须选择已分配任务", true);
    return;
  }
  if ((activity === "message" || activity === "confirmation") && !text && !taskId) {
    showToast("请输入要发送的内容", true);
    return;
  }
  const button = document.getElementById("group-chat-send");
  button.disabled = true;
  button.textContent = "发送中…";
  const workflow = state.workflows.find((item) => item.id === workflowId);
  const task = workflow?.taskItems?.find((item) => item.id === taskId);
  const sender = senderPersonId === state.currentUser.id
    ? state.currentUser
    : state.people.find((person) => person.id === senderPersonId);
  const defaultText = task
    ? activity === "started" ? `开始处理：${task.title}`
      : activity === "completed" ? `已完成：${task.title}`
        : activity === "confirmation" ? `需要确认：${task.title}` : ""
    : "";
  const pendingMessageId = `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  chat.messages.push({
    id: pendingMessageId,
    senderPersonId,
    senderName: sender?.name || "未知成员",
    senderType: senderPersonId === state.currentUser.id ? "administrator" : "person",
    activity,
    text: text || defaultText,
    workflowId: workflow?.id,
    workflowTitle: workflow?.title,
    taskId: task?.id,
    taskTitle: task?.title,
    createdAt: new Date().toISOString(),
    clientPending: true,
  });
  messageInput.value = "";
  renderGroupChats();
  try {
    const result = await api("/api/group-chats/messages", {
      method: "POST",
      body: JSON.stringify({
        groupChatId: chat.id,
        senderPersonId,
        activity,
        text,
        workflowId: workflowId || undefined,
        taskId: taskId || undefined,
      }),
    });
    state.groupChats = state.groupChats.map((item) => item.id === result.groupChat.id ? result.groupChat : item);
    if (result.workflow) state.workflows = state.workflows.map((item) => item.id === result.workflow.id ? result.workflow : item);
    renderGroupChats();
    renderWorkflows();
    renderKanban();
    renderPeople();
    if (result.replyErrors?.length) showToast(`消息已发送；${result.replyErrors.map((item) => `${item.personName}：${item.error}`).join("；")}`, true);
    else showToast(result.repliedBy?.length ? `${result.repliedBy.join("、")} 的 Agent 已回答` : "群聊消息已发送");
  } catch (error) {
    state.groupChats = state.groupChats.map((item) => item.id === chat.id
      ? { ...item, messages: item.messages.filter((message) => message.id !== pendingMessageId) }
      : item);
    renderGroupChats();
    if (state.activeGroupChatId === chat.id && !messageInput.value.trim()) messageInput.value = text;
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = '发送消息 <span>↑</span>';
  }
}

function groupChatActivityLabel(activity) {
  return ({ message: "普通消息", started: "开始处理", completed: "完成任务", confirmation: "需要确认" })[activity] || activity;
}

function groupChatSenderLabel(senderType) {
  return ({ administrator: "管理员", agent: "Agent", person: "员工" })[senderType || "person"] || "员工";
}

function renderAgentOptions() {
  const profileSelect = document.getElementById("agent-profile");
  const profiles = allAgentProfiles();
  profileSelect.innerHTML = '<option value="">手动模式（不使用人员配置）</option>' + profiles.map(({ person, agent }) => `
    <option value="${escapeAttr(agent.id)}">${escapeHtml(person.name)} / ${escapeHtml(agent.name)}</option>
  `).join("");

  const providerSelect = document.getElementById("agent-provider");
  providerSelect.innerHTML = state.overview.providers.map((provider) => `
    <option value="${escapeAttr(provider.id)}" ${provider.ready ? "" : "disabled"}>${escapeHtml(provider.id)} · ${escapeHtml(provider.modelName || provider.model)}${provider.ready ? "" : "（未配置）"}</option>
  `).join("");
  const readyProvider = state.overview.providers.find((provider) => provider.ready);
  if (readyProvider) providerSelect.value = readyProvider.id;
  renderAgentProductOptions();
  applyAgentProfile();
}

function allAgentProfiles() {
  return state.people.flatMap((person) => person.agents.map((agent) => ({ person, agent })));
}

function findAgentContext(agentId) {
  return allAgentProfiles().find(({ agent }) => agent.id === agentId);
}

function renderAgentProductOptions(context) {
  const projectSelect = document.getElementById("agent-project");
  const allowed = new Set(context?.agent.repositoryIds || []);
  projectSelect.innerHTML = '<option value="">所有授权代码仓库</option>' + state.overview.products.map((product) => {
    const available = context
      ? product.repositoryDetails.filter((repository) => allowed.has(repository.id)).length
      : product.repositoryDetails.length;
    return `<option value="${escapeAttr(product.id)}" ${available ? "" : "disabled"}>${escapeHtml(product.name)} · ${available} 个可用仓库${available ? "" : "（无权限或待关联）"}</option>`;
  }).join("");
}

function applyAgentProfile() {
  const context = findAgentContext(document.getElementById("agent-profile").value);
  const providerSelect = document.getElementById("agent-provider");
  providerSelect.disabled = Boolean(context);
  if (context) providerSelect.value = context.agent.providerId;
  renderAgentProductOptions(context);
  const risk = document.getElementById("agent-risk");
  const hasHighRiskTool = !context || context.agent.toolIds.some((tool) => tool === "run_write_commands" || tool === "run_deploy_commands");
  risk.disabled = !hasHighRiskTool;
  if (!hasHighRiskTool) risk.checked = false;
}

function renderSettings() {
  const providers = state.settings.providers || [];
  document.getElementById("provider-grid").innerHTML = providers.map((provider) => `
    <article class="provider-card">
      <div class="provider-card-head"><span class="provider-logo ${escapeAttr(provider.id)}">${escapeHtml(provider.id.slice(0, 2))}</span><span class="badge ${provider.ready ? "success" : "neutral"}">${provider.ready ? "已配置" : "未配置"}</span></div>
      <h4>${escapeHtml(provider.id)} ${provider.isDefault ? '<span class="badge neutral">default</span>' : ""}</h4>
      <p title="${escapeAttr(provider.baseUrl)}">${escapeHtml(provider.baseUrl)}</p>
      <div class="provider-model">
        <label for="provider-model-${escapeAttr(provider.id)}">默认模型</label>
        <select id="provider-model-${escapeAttr(provider.id)}" data-provider-model="${escapeAttr(provider.id)}">
          ${(provider.models || []).map((model) => `<option value="${escapeAttr(model.id)}" ${model.id === provider.model ? "selected" : ""}>${escapeHtml(model.name)}</option>`).join("")}
        </select>
        <small>切换后，新请求将使用所选模型</small>
      </div>
      <form class="provider-key-form" data-provider-key-form="${escapeAttr(provider.id)}">
        <label for="provider-key-${escapeAttr(provider.id)}">API Key</label>
        <input id="provider-key-${escapeAttr(provider.id)}" name="apiKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="输入新 Key（不会回显）" required />
        <small>当前来源：${escapeHtml(providerKeySourceLabel(provider.keySource))}</small>
        <div class="provider-key-actions">
          <button class="primary-button" type="submit">保存 Key</button>
          <button class="secondary-button" type="button" data-clear-provider-key="${escapeAttr(provider.id)}" ${provider.databaseConfigured ? "" : "disabled"}>清除数据库 Key</button>
        </div>
      </form>
    </article>
  `).join("");
  document.getElementById("config-path").textContent = state.settings.configPath;
}

function providerKeySourceLabel(source) {
  if (source === "database") return "SQLite 数据库";
  if (source === "environment") return "环境变量";
  return "未配置";
}

async function saveProviderModel(select) {
  const providerId = select.dataset.providerModel;
  select.disabled = true;
  try {
    const result = await api("/api/settings/provider-model", {
      method: "POST",
      body: JSON.stringify({ providerId, modelId: select.value }),
    });
    state.settings.providers = result.providers;
    state.overview.providers = result.providers;
    document.getElementById("nav-provider-count").textContent = String(result.providers.filter((provider) => provider.ready).length);
    renderSettings();
    showToast(result.message || "默认模型已更新");
  } catch (error) {
    renderSettings();
    showToast(error.message, true);
  }
}

async function saveProviderKey(event) {
  const form = event.target.closest("[data-provider-key-form]");
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const input = form.elements.apiKey;
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    const result = await api("/api/settings/provider-key", {
      method: "POST",
      body: JSON.stringify({ providerId: form.dataset.providerKeyForm, action: "save", apiKey: input.value }),
    });
    state.settings.providers = result.providers;
    state.overview.providers = result.providers;
    document.getElementById("nav-provider-count").textContent = String(result.providers.filter((provider) => provider.ready).length);
    state.overview.stats.readyProviders = result.providers.filter((provider) => provider.ready).length;
    renderSettings();
    renderMetrics();
    showToast(result.message || "API Key 已保存");
  } catch (error) {
    showToast(error.message, true);
    button.disabled = false;
    button.textContent = "保存 Key";
  }
}

async function clearProviderKey(providerId) {
  const confirmed = await confirmAction({
    kicker: "CLEAR API KEY",
    title: `清除 ${providerId} API Key？`,
    message: "清除后，该 Provider 将暂时无法调用模型，直到重新配置 Key。",
    details: ["只删除 SQLite 中保存的 Key", "不会修改模型选择和其他 Provider", "环境变量中的 Key 不受影响"],
    confirmText: "清除 Key",
  });
  if (!confirmed) return;
  try {
    const result = await api("/api/settings/provider-key", {
      method: "POST",
      body: JSON.stringify({ providerId, action: "delete" }),
    });
    state.settings.providers = result.providers;
    state.overview.providers = result.providers;
    document.getElementById("nav-provider-count").textContent = String(result.providers.filter((provider) => provider.ready).length);
    state.overview.stats.readyProviders = result.providers.filter((provider) => provider.ready).length;
    renderSettings();
    renderMetrics();
    showToast(result.message || "数据库 Key 已清除");
  } catch (error) {
    showToast(error.message, true);
  }
}

function openPersonModal(personId) {
  const person = personId ? state.people.find((item) => item.id === personId) : undefined;
  document.getElementById("person-id").value = person?.id || "";
  document.getElementById("person-name").value = person?.name || "";
  document.getElementById("person-modal-kicker").textContent = person ? "EDIT PERSON" : "NEW PERSON";
  document.getElementById("person-modal-title").textContent = person ? `编辑 ${person.name}` : "新建人员";
  document.getElementById("person-role-options").innerHTML = roleDefinitions().map((role, index) => capabilityOption(role.value, role.label, role.description, person ? person.roles.includes(role.value) : index === 0)).join("");
  document.getElementById("person-create").textContent = person ? "保存人员" : "创建人员";
  document.getElementById("person-modal").hidden = false;
  setTimeout(() => document.getElementById("person-name").focus(), 50);
}

function closePersonModal() {
  document.getElementById("person-modal").hidden = true;
}

async function createDevelopmentPerson(event) {
  event.preventDefault();
  const button = document.getElementById("person-create");
  button.disabled = true;
  button.textContent = "创建中…";
  try {
    const personId = document.getElementById("person-id").value;
    const result = await api(personId ? "/api/people/update" : "/api/people", {
      method: "POST",
      body: JSON.stringify({
        id: personId || undefined,
        name: document.getElementById("person-name").value.trim(),
        roles: checkedValues("person-role-options"),
      }),
    });
    state.people = personId
      ? state.people.map((person) => person.id === result.person.id ? result.person : person)
      : [result.person, ...state.people];
    renderPeople();
    renderWorkflows();
    renderAgentOptions();
    closePersonModal();
    showToast(personId ? "人员信息已更新" : "人员已创建，现在可以为其配置 Agent");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = document.getElementById("person-id").value ? "保存人员" : "创建人员";
  }
}

async function deleteDevelopmentPerson(personId, button) {
  const person = state.people.find((item) => item.id === personId);
  if (!person) return;
  const agentNote = person.agents.length ? "，并同时删除其 Agent" : "";
  const confirmed = await confirmAction({
    kicker: "DELETE PERSON",
    title: `删除人员“${person.name}”？`,
    message: `该人员将从责任人列表中移除${agentNote}。`,
    details: ["人员信息和专用 Agent 将被删除", "仍被研发任务引用时会自动阻止", "产品、仓库和群聊记录不会删除"],
    confirmText: "删除人员",
  });
  if (!confirmed) return;
  button.disabled = true;
  try {
    await api("/api/people/delete", {
      method: "POST",
      body: JSON.stringify({ id: person.id, confirmName: person.name }),
    });
    state.people = state.people.filter((item) => item.id !== person.id);
    renderPeople();
    renderWorkflows();
    renderAgentOptions();
    showToast(`人员 ${person.name} 已删除`);
  } catch (error) {
    button.disabled = false;
    showToast(error.message, true);
  }
}

async function deleteProductConfiguration(productId, button) {
  const product = state.overview.products.find((item) => item.id === productId);
  if (!product) return;
  const confirmed = await confirmAction({
    kicker: "DELETE PRODUCT",
    title: `删除产品“${product.name}”？`,
    message: "删除后无法从工作台恢复该产品配置。",
    details: ["删除产品环境和部署矩阵", "保留全局登记的本地代码仓库", "有关联版本、研发任务或 Agent 时自动阻止"],
    confirmText: "删除产品",
  });
  if (!confirmed) return;
  button.disabled = true;
  try {
    const result = await api("/api/products/delete", {
      method: "POST",
      body: JSON.stringify({ id: product.id, confirmName: product.name }),
    });
    state.overview = await api("/api/overview");
    if (state.kanbanProductId === product.id) {
      state.kanbanProductId = "";
      state.kanbanMilestoneId = "";
    }
    renderAll();
    showToast(result.message || `产品 ${product.name} 已删除`);
  } catch (error) {
    button.disabled = false;
    showToast(error.message, true);
  }
}

function openPersonAgentModal(personId, agentId) {
  const person = state.people.find((item) => item.id === personId);
  if (!person) return;
  const agent = agentId ? person.agents.find((item) => item.id === agentId) : undefined;
  document.getElementById("person-agent-person-id").value = person.id;
  document.getElementById("person-agent-id").value = agent?.id || "";
  document.getElementById("person-agent-name").value = agent?.name || "";
  document.getElementById("person-agent-modal-title").textContent = agent ? `编辑 ${agent.name}` : `为 ${person.name} 配置 Agent`;
  renderAgentPresetChoices(person);
  const roleSelect = document.getElementById("person-agent-role");
  roleSelect.innerHTML = person.roles.map((role) => `<option value="${escapeAttr(role)}">${escapeHtml(assigneeRoleLabel(role))}</option>`).join("");
  roleSelect.value = agent?.role || person.roles[0];
  const providerSelect = document.getElementById("person-agent-provider");
  providerSelect.innerHTML = state.overview.providers.map((provider) => `<option value="${escapeAttr(provider.id)}" ${provider.ready ? "" : "disabled"}>${escapeHtml(provider.id)} · ${escapeHtml(provider.modelName || provider.model)}${provider.ready ? "" : "（未配置）"}</option>`).join("");
  const readyProvider = state.overview.providers.find((provider) => provider.ready);
  providerSelect.value = agent?.providerId || readyProvider?.id || state.overview.providers[0]?.id || "";

  const defaultSkills = state.skills.filter((skill) => skill.roles.includes(roleSelect.value)).map((skill) => skill.id);
  renderCapabilityChoices("person-agent-skills", state.skills, agent?.skillIds || defaultSkills);
  renderCapabilityChoices("person-agent-tools", state.agentTools, agent?.toolIds || ["inspect_repositories", "run_read_commands"]);
  renderCapabilityChoices("person-agent-repositories", state.overview.repositories.map((repository) => ({ id: repository.id, name: repository.id, description: compactPath(repository.path) })), agent?.repositoryIds || []);
  const environments = agentEnvironmentOptions();
  renderCapabilityChoices("person-agent-environments", environments, agent?.environmentIds || []);
  document.getElementById("person-agent-modal").hidden = false;
  setTimeout(() => document.getElementById("person-agent-name").focus(), 50);
}

function renderAgentPresetChoices(person) {
  const icons = { developer: "开", tester: "测", deployer: "部", releaser: "发", operator: "营" };
  const target = document.getElementById("person-agent-presets");
  target.innerHTML = state.agentPresets.length
    ? state.agentPresets.map((preset) => {
        const available = person.roles.includes(preset.role);
        const hint = available ? "点击应用此预设" : `该人员未承担${assigneeRoleLabel(preset.role)}角色`;
        return `<button type="button" class="agent-preset-card" data-agent-preset="${escapeAttr(preset.id)}" aria-pressed="false" ${available ? "" : "disabled"} title="${escapeAttr(hint)}"><span class="agent-preset-icon">${escapeHtml(icons[preset.role] || "✦")}</span><span><strong>${escapeHtml(preset.name)}</strong><small>${escapeHtml(preset.description)}</small><em>${escapeHtml(assigneeRoleLabel(preset.role))} · ${preset.skillIds.length} Skills · ${preset.toolIds.length} Tools</em></span></button>`;
      }).join("")
    : '<div class="capability-empty">暂无可用预设</div>';
  document.getElementById("person-agent-preset-help").textContent = "选择预设只会填充当前表单，点击“保存 Agent”后才会生效。";
}

function applyAgentPreset(presetId) {
  const preset = state.agentPresets.find((item) => item.id === presetId);
  const person = state.people.find((item) => item.id === document.getElementById("person-agent-person-id").value);
  if (!preset || !person?.roles.includes(preset.role)) return;
  document.getElementById("person-agent-name").value = preset.name;
  document.getElementById("person-agent-role").value = preset.role;
  renderCapabilityChoices("person-agent-skills", state.skills, preset.skillIds);
  renderCapabilityChoices("person-agent-tools", state.agentTools, preset.toolIds);
  renderCapabilityChoices(
    "person-agent-repositories",
    state.overview.repositories.map((repository) => ({ id: repository.id, name: repository.id, description: compactPath(repository.path) })),
    state.overview.repositories.map((repository) => repository.id),
  );
  const environments = agentEnvironmentOptions();
  renderCapabilityChoices(
    "person-agent-environments",
    environments,
    environments.filter((environment) => preset.environmentKinds.includes(environment.kind)).map((environment) => environment.id),
  );
  document.querySelectorAll("[data-agent-preset]").forEach((button) => {
    const active = button.dataset.agentPreset === preset.id;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const environmentCount = environments.filter((environment) => preset.environmentKinds.includes(environment.kind)).length;
  document.getElementById("person-agent-preset-help").textContent = `已应用“${preset.name}”：${state.overview.repositories.length} 个仓库、${environmentCount} 个匹配环境。可继续调整后保存。`;
}

function clearAgentPresetSelection() {
  document.querySelectorAll("[data-agent-preset]").forEach((button) => {
    button.classList.remove("is-active");
    button.setAttribute("aria-pressed", "false");
  });
  const help = document.getElementById("person-agent-preset-help");
  if (help) help.textContent = "当前为自定义配置，点击“保存 Agent”后才会生效。";
}

function agentEnvironmentOptions() {
  return state.overview.products.flatMap((product) => product.environments.map((environment) => ({
    id: `${product.id}:${environment.id}`,
    name: `${product.name} / ${environment.name}`,
    description: environment.kind,
    kind: environment.kind,
  })));
}

function closePersonAgentModal() {
  document.getElementById("person-agent-modal").hidden = true;
}

function renderCapabilityChoices(targetId, items, selected) {
  const selectedValues = new Set(selected);
  document.getElementById(targetId).innerHTML = items.length
    ? items.map((item) => capabilityOption(item.id, item.name, item.description || "", selectedValues.has(item.id))).join("")
    : '<div class="capability-empty">暂无可配置项</div>';
}

function capabilityOption(value, label, description, checked) {
  return `<label class="capability-option"><input type="checkbox" value="${escapeAttr(value)}" ${checked ? "checked" : ""} /><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(description)}</small></span></label>`;
}

function checkedValues(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)).map((input) => input.value);
}

function roleDefinitions() {
  return [
    { value: "developer", label: "开发", description: "需求分析、编码实现与代码审查" },
    { value: "tester", label: "测试", description: "测试设计、执行与故障验证" },
    { value: "deployer", label: "部署", description: "环境部署、验证与回滚准备" },
    { value: "releaser", label: "发布", description: "版本核对、审批与正式发布" },
    { value: "operator", label: "运营", description: "公众号文章、短视频脚本与内容运营" },
  ];
}

async function saveDevelopmentAgent(event) {
  event.preventDefault();
  const button = document.getElementById("person-agent-save");
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    const result = await api("/api/people/agents", {
      method: "POST",
      body: JSON.stringify({
        personId: document.getElementById("person-agent-person-id").value,
        id: document.getElementById("person-agent-id").value || undefined,
        name: document.getElementById("person-agent-name").value.trim(),
        role: document.getElementById("person-agent-role").value,
        providerId: document.getElementById("person-agent-provider").value,
        skillIds: checkedValues("person-agent-skills"),
        toolIds: checkedValues("person-agent-tools"),
        repositoryIds: checkedValues("person-agent-repositories"),
        environmentIds: checkedValues("person-agent-environments"),
      }),
    });
    state.people = state.people.map((person) => person.id === result.person.id ? result.person : person);
    renderPeople();
    renderWorkflows();
    renderAgentOptions();
    closePersonAgentModal();
    showToast("Agent 配置已保存，能力和范围将在服务端强制校验");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "保存 Agent";
  }
}

async function assignWorkflowTask(workflowId, taskId, ownerId, agentId, select) {
  select.disabled = true;
  try {
    const result = await api("/api/workflows/assign-task", {
      method: "POST",
      body: JSON.stringify({ workflowId, taskId, ownerId, agentId }),
    });
    state.workflows = state.workflows.map((workflow) => workflow.id === workflowId ? result.workflow : workflow);
    renderWorkflows();
    renderKanban();
    renderPeople();
    showToast(ownerId ? (agentId ? "负责人和执行 Agent 已更新" : "任务负责人已更新") : "已取消任务分配");
  } catch (error) {
    select.disabled = false;
    showToast(error.message, true);
    await refreshWorkflows();
  }
}

function openMilestoneModal() {
  if (!state.overview.products.length) {
    showToast("请先在配置中心创建产品", true);
    switchView("projects");
    switchConfigSection("products");
    return;
  }
  const productSelect = document.getElementById("milestone-product");
  productSelect.innerHTML = state.overview.products.map((product) => `<option value="${escapeAttr(product.id)}">${escapeHtml(product.name)}</option>`).join("");
  const providerSelect = document.getElementById("milestone-provider");
  providerSelect.innerHTML = state.overview.providers.map((provider) => `<option value="${escapeAttr(provider.id)}" ${provider.ready ? "" : "disabled"}>${escapeHtml(provider.id)} · ${escapeHtml(provider.modelName || provider.model)}${provider.ready ? "" : "（未配置）"}</option>`).join("");
  const readyProvider = state.overview.providers.find((provider) => provider.ready);
  if (readyProvider) providerSelect.value = readyProvider.id;
  document.getElementById("milestone-title").value = "";
  document.getElementById("milestone-target-date").value = "";
  document.getElementById("milestone-goal").value = "";
  document.getElementById("milestone-modal").hidden = false;
  setTimeout(() => document.getElementById("milestone-title").focus(), 50);
}

function closeMilestoneModal() {
  document.getElementById("milestone-modal").hidden = true;
}

async function createDevelopmentMilestone(event) {
  event.preventDefault();
  const button = document.getElementById("milestone-create");
  button.disabled = true;
  button.textContent = "创建中…";
  try {
    const result = await api("/api/milestones", {
      method: "POST",
      body: JSON.stringify({
        productId: document.getElementById("milestone-product").value,
        providerId: document.getElementById("milestone-provider").value,
        title: document.getElementById("milestone-title").value.trim(),
        targetDate: document.getElementById("milestone-target-date").value || undefined,
        goal: document.getElementById("milestone-goal").value.trim(),
      }),
    });
    closeMilestoneModal();
    await refreshWorkflows();
    switchView("workflow");
    showToast(`版本 ${result.milestone.title} 已创建`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "创建版本";
  }
}

function openWorkflowModal(milestoneId) {
  if (!state.milestones.length) {
    showToast("请先创建版本", true);
    openMilestoneModal();
    return;
  }
  const milestoneSelect = document.getElementById("workflow-milestone");
  milestoneSelect.innerHTML = state.milestones.map((version) => {
    const product = state.overview.products.find((item) => item.id === version.productId);
    return `<option value="${escapeAttr(version.id)}">${escapeHtml(version.title)} · ${escapeHtml(product?.name || version.productId)}</option>`;
  }).join("");
  if (milestoneId) milestoneSelect.value = milestoneId;
  document.getElementById("workflow-title").value = "";
  document.getElementById("workflow-requirement").value = "";
  document.getElementById("workflow-modal").hidden = false;
  setTimeout(() => document.getElementById("workflow-title").focus(), 50);
}

function closeWorkflowModal() {
  document.getElementById("workflow-modal").hidden = true;
}

async function createDevelopmentWorkflow(event) {
  event.preventDefault();
  const button = document.getElementById("workflow-create");
  button.disabled = true;
  button.textContent = "创建中…";
  try {
    await api("/api/workflows", {
      method: "POST",
      body: JSON.stringify({
        milestoneId: document.getElementById("workflow-milestone").value,
        title: document.getElementById("workflow-title").value.trim(),
        requirement: document.getElementById("workflow-requirement").value.trim(),
      }),
    });
    closeWorkflowModal();
    await refreshWorkflows();
    switchView("workflow");
    showToast("需求已进入研发工作流");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "创建需求";
  }
}

async function refreshWorkflows() {
  const payload = await api("/api/workflows");
  state.milestones = payload.milestones || [];
  state.workflows = payload.workflows || [];
  renderWorkflows();
  renderKanban();
  renderPeople();
  document.getElementById("nav-workflow-count").textContent = String(state.milestones.length);
}

async function generateWorkflowContent(workflowId, action, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = action === "plan" ? "正在生成计划…" : "正在拆分任务…";
  try {
    const workflow = state.workflows.find((item) => item.id === workflowId);
    const result = await api("/api/workflows/generate", {
      method: "POST",
      body: JSON.stringify({ id: workflowId, action, providerId: workflow?.providerId }),
    });
    state.workflows = state.workflows.map((item) => item.id === workflowId ? result.workflow : item);
    renderWorkflows();
    renderKanban();
    renderPeople();
    showToast(action === "plan" ? "计划已生成" : "任务已拆分");
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    showToast(error.message, true);
  }
}

async function advanceWorkflowStage(workflowId, stage, button) {
  button.disabled = true;
  try {
    const result = await api("/api/workflows/stage", {
      method: "POST",
      body: JSON.stringify({ id: workflowId, stage }),
    });
    state.workflows = state.workflows.map((item) => item.id === workflowId ? result.workflow : item);
    renderWorkflows();
    renderKanban();
    renderPeople();
    if (stage === "coding") openWorkflowInAgent(workflowId, "coding");
    else showToast(`工作流已进入${workflowStageLabel(stage)}阶段`);
  } catch (error) {
    button.disabled = false;
    showToast(error.message, true);
  }
}

function openWorkflowInAgent(workflowId, mode) {
  const workflow = state.workflows.find((item) => item.id === workflowId);
  if (!workflow) return;
  const version = state.milestones.find((item) => item.id === workflow.milestoneId);
  const product = state.overview.products.find((item) => item.id === workflow.productId);
  if (!product?.repositoryDetails?.length) {
    showToast("请先为产品关联代码仓库", true);
    switchView("projects");
    switchConfigSection("products");
    openProductModal(workflow.productId);
    return;
  }
  switchView("agent");
  const assignedTask = (workflow.taskItems || []).find((task) => task.stage === mode && task.agentId);
  const profileSelect = document.getElementById("agent-profile");
  profileSelect.value = assignedTask?.agentId || "";
  applyAgentProfile();
  document.getElementById("agent-project").value = workflow.productId;
  const providerSelect = document.getElementById("agent-provider");
  const providerOption = Array.from(providerSelect.options).find((option) => option.value === workflow.providerId);
  if (!assignedTask?.agentId && providerOption && !providerOption.disabled) providerSelect.value = workflow.providerId;
  document.getElementById("agent-prompt").value = workflowAgentPrompt(workflow, product, version, mode);
  document.getElementById("agent-prompt").focus();
  showToast(`已载入${workflowStageLabel(mode)}上下文，确认后发送给 Agent`);
}

function workflowAgentPrompt(workflow, product, version, mode) {
  const instructions = {
    coding: "请先检查关联仓库现状，再按任务清单逐项编码。每次修改后执行必要验证，并汇报实际变更与剩余任务。",
    deployment: "请检查仓库中已登记的 deploy 命令和当前工作区状态，给出部署前检查。只有在我启用高风险命令后才执行部署，并报告真实输出。",
    testing: "请根据需求、计划和任务运行相关测试，分析失败原因，并给出是否满足验收标准的结论。",
    release: "请确认测试结果、版本号和工作区状态，检查已登记的 release 命令。只有在我启用高风险命令后才执行正式发布，并报告版本产物和真实输出。",
  };
  return [
    `研发阶段：${workflowStageLabel(mode)}`,
    `产品：${product.name}`,
    `版本：${version?.title || "未指定"}`,
    `版本目标：${version?.goal || "未填写"}`,
    `需求：${workflow.title}`,
    "",
    "需求内容：",
    workflow.requirement,
    "",
    "计划：",
    workflow.plan || "未生成",
    "",
    "任务：",
    workflow.tasks || "未拆分",
    "",
    instructions[mode] || "请基于以上上下文继续处理。",
  ].join("\n");
}

function openProductModal(productId) {
  const source = productId ? state.overview.products.find((product) => product.id === productId) : null;
  state.productDraft = source
    ? {
        id: source.id,
        name: source.name,
        description: source.description || "",
        repositories: [...source.repositories],
        environments: source.environments.map((environment) => ({ ...environment })),
        deployments: (source.deployments || []).map((deployment) => ({ ...deployment })),
        existing: true,
      }
    : { id: "", name: "", description: "", repositories: [], environments: [], deployments: [], existing: false };
  renderProductEditor();
  document.getElementById("product-modal").hidden = false;
  setTimeout(() => document.getElementById("product-name").focus(), 50);
}

function closeProductModal() {
  document.getElementById("product-modal").hidden = true;
  state.productDraft = null;
}

function renderProductEditor() {
  const draft = state.productDraft;
  if (!draft) return;
  document.getElementById("product-modal-title").textContent = draft.existing ? `配置 ${draft.name}` : "新建产品";
  document.getElementById("product-name").value = draft.name;
  document.getElementById("product-description").value = draft.description;

  const repositoryOptions = document.getElementById("product-repository-options");
  repositoryOptions.innerHTML = state.overview.repositories.length
    ? state.overview.repositories.map((repository) => `
        <label class="repo-option"><input type="checkbox" value="${escapeAttr(repository.id)}" ${draft.repositories.includes(repository.id) ? "checked" : ""} /><span><strong>${escapeHtml(repository.id)}</strong><small title="${escapeAttr(repository.path)}">${escapeHtml(repository.path)}</small></span></label>
      `).join("")
    : '<div class="product-empty-dimension">还没有代码仓库，请使用上方“添加并关联”。</div>';

  renderEnvironmentEditor();
  renderDeploymentEditor();
}

function renderEnvironmentEditor() {
  const target = document.getElementById("environment-editor");
  const environments = state.productDraft?.environments || [];
  target.innerHTML = environments.length
    ? environments.map((environment, index) => `
        <div class="environment-row" data-environment-index="${index}">
          <input data-environment-field="id" value="${escapeAttr(environment.id)}" placeholder="环境 ID" aria-label="环境 ID" />
          <input data-environment-field="name" value="${escapeAttr(environment.name)}" placeholder="环境名称" aria-label="环境名称" />
          <select data-environment-field="kind" aria-label="环境类型">${environmentKindOptions(environment.kind)}</select>
          <select data-environment-field="status" aria-label="环境状态">${environmentStatusOptions(environment.status)}</select>
          <input data-environment-field="url" value="${escapeAttr(environment.url || "")}" placeholder="访问地址（http/https）或备注" aria-label="环境地址" />
          <button type="button" class="remove-row" data-remove-environment="${index}" aria-label="删除环境">×</button>
        </div>`).join("")
    : '<div class="product-empty-dimension">还没有环境，点击“添加环境”开始配置。</div>';
}

function renderDeploymentEditor() {
  const target = document.getElementById("deployment-editor");
  const draft = state.productDraft;
  if (!draft || !draft.repositories.length || !draft.environments.length) {
    target.innerHTML = '<div class="product-empty-dimension">选择代码仓库并添加环境后，可维护部署映射。</div>';
    return;
  }
  const repositoryMap = new Map(state.overview.repositories.map((repository) => [repository.id, repository]));
  const deploymentMap = new Map(draft.deployments.map((deployment) => [`${deployment.environmentId}:${deployment.repositoryId}`, deployment]));
  target.innerHTML = `<div class="deployment-edit-table env-count-${Math.min(draft.environments.length, 8)}">
    <div class="deployment-edit-row"><strong>代码仓库</strong>${draft.environments.map((environment) => `<strong>${escapeHtml(environment.name || environment.id || "未命名环境")}</strong>`).join("")}</div>
    ${draft.repositories.map((repositoryId) => `<div class="deployment-edit-row"><div class="repo-name"><strong>${escapeHtml(repositoryId)}</strong><small>${escapeHtml(repositoryMap.get(repositoryId)?.branch || "未读取分支")}</small></div>${draft.environments.map((environment) => {
      const deployment = deploymentMap.get(`${environment.id}:${repositoryId}`) || { branch: "", status: "unknown" };
      return `<div class="deployment-input"><input data-deployment-repository="${escapeAttr(repositoryId)}" data-deployment-environment="${escapeAttr(environment.id)}" data-deployment-field="branch" value="${escapeAttr(deployment.branch || "")}" placeholder="分支或版本" aria-label="${escapeAttr(repositoryId)} ${escapeAttr(environment.name)} 分支" /><select data-deployment-repository="${escapeAttr(repositoryId)}" data-deployment-environment="${escapeAttr(environment.id)}" data-deployment-field="status" aria-label="部署状态">${deploymentStatusOptions(deployment.status)}</select></div>`;
    }).join("")}</div>`).join("")}
  </div>`;
}

function addEnvironmentRow() {
  if (!state.productDraft) return;
  const existing = new Set(state.productDraft.environments.map((environment) => environment.id));
  let counter = state.productDraft.environments.length + 1;
  let id = `env-${counter}`;
  while (existing.has(id)) id = `env-${++counter}`;
  state.productDraft.environments.push({ id, name: "新环境", kind: "other", status: "unknown", url: "" });
  renderEnvironmentEditor();
  renderDeploymentEditor();
}

function removeEnvironmentRow(indexText) {
  const draft = state.productDraft;
  if (!draft) return;
  const index = Number(indexText);
  const environment = draft.environments[index];
  if (!environment) return;
  draft.environments.splice(index, 1);
  draft.deployments = draft.deployments.filter((deployment) => deployment.environmentId !== environment.id);
  renderEnvironmentEditor();
  renderDeploymentEditor();
}

function syncProductRepositories() {
  const draft = state.productDraft;
  if (!draft) return;
  draft.repositories = Array.from(document.querySelectorAll("#product-repository-options input:checked")).map((input) => input.value);
  draft.deployments = draft.deployments.filter((deployment) => draft.repositories.includes(deployment.repositoryId));
  renderDeploymentEditor();
}

function syncEnvironmentDraft(event) {
  const draft = state.productDraft;
  const row = event.target.closest("[data-environment-index]");
  const field = event.target.dataset.environmentField;
  if (!draft || !row || !field) return;
  const environment = draft.environments[Number(row.dataset.environmentIndex)];
  if (!environment) return;
  const previousId = environment.id;
  environment[field] = event.target.value;
  if (field === "id" && event.type === "change" && previousId !== environment.id) {
    draft.deployments.forEach((deployment) => {
      if (deployment.environmentId === previousId) deployment.environmentId = environment.id;
    });
    renderDeploymentEditor();
  } else if (field === "name" && event.type === "change") {
    renderDeploymentEditor();
  }
}

function syncDeploymentDraft(event) {
  const draft = state.productDraft;
  const repositoryId = event.target.dataset.deploymentRepository;
  const environmentId = event.target.dataset.deploymentEnvironment;
  const field = event.target.dataset.deploymentField;
  if (!draft || !repositoryId || !environmentId || !field) return;
  let deployment = draft.deployments.find((item) => item.repositoryId === repositoryId && item.environmentId === environmentId);
  if (!deployment) {
    deployment = { repositoryId, environmentId, branch: "", status: "unknown" };
    draft.deployments.push(deployment);
  }
  deployment[field] = event.target.value;
}

async function saveProduct(event) {
  event.preventDefault();
  const draft = state.productDraft;
  if (!draft) return;
  syncEnvironmentDraftFromDom();
  const ids = draft.environments.map((environment) => environment.id.trim());
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    return showToast("环境 ID 不能为空或重复", true);
  }
  const productName = document.getElementById("product-name").value.trim();
  const product = {
    id: draft.id || createProductId(productName),
    name: productName,
    description: document.getElementById("product-description").value.trim(),
    repositories: draft.repositories,
    environments: draft.environments.map((environment) => ({ ...environment, id: environment.id.trim(), name: environment.name.trim() })),
    deployments: draft.deployments.filter((deployment) => deployment.branch || deployment.status !== "unknown"),
  };
  const saveButton = document.getElementById("product-save");
  saveButton.disabled = true;
  saveButton.textContent = "保存中…";
  try {
    await api("/api/products", { method: "POST", body: JSON.stringify({ product }) });
    closeProductModal();
    await loadDashboard();
    switchView("projects");
    switchConfigSection("products");
    showToast(`${product.name} 已保存`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "保存产品";
  }
}

function syncEnvironmentDraftFromDom() {
  document.querySelectorAll("#environment-editor [data-environment-index]").forEach((row) => {
    const environment = state.productDraft.environments[Number(row.dataset.environmentIndex)];
    row.querySelectorAll("[data-environment-field]").forEach((input) => {
      environment[input.dataset.environmentField] = input.value;
    });
  });
}

async function registerProductRepository() {
  const draft = state.productDraft;
  if (!draft) return;
  syncEnvironmentDraftFromDom();
  draft.name = document.getElementById("product-name").value.trim();
  if (!draft.id) draft.id = createProductId(draft.name);
  draft.description = document.getElementById("product-description").value.trim();
  const idInput = document.getElementById("product-repository-id");
  const pathInput = document.getElementById("product-repository-path");
  const repositoryId = idInput.value.trim();
  const repositoryPath = pathInput.value.trim();
  if (!repositoryId) return showToast("请输入仓库 ID", true);
  const existing = state.overview.repositories.find((repository) => repository.id === repositoryId);
  try {
    if (draft.existing) {
      if (!existing && !repositoryPath) return showToast("请输入仓库本地绝对路径", true);
      await api("/api/product-repositories", {
        method: "POST",
        body: JSON.stringify({ productId: draft.id, id: repositoryId, path: repositoryPath || undefined }),
      });
      state.overview = await api("/api/overview");
    } else if (!existing) {
      if (!repositoryPath) return showToast("请输入仓库本地绝对路径", true);
      await api("/api/repositories", { method: "POST", body: JSON.stringify({ id: repositoryId, path: repositoryPath }) });
      state.overview = await api("/api/overview");
    }
    if (!draft.repositories.includes(repositoryId)) draft.repositories.push(repositoryId);
    idInput.value = "";
    pathInput.value = "";
    renderProductEditor();
    showToast(`${repositoryId} 已添加并关联当前产品`);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function chooseRepositoryDirectory() {
  const pathInput = document.getElementById("product-repository-path");
  document.getElementById("directory-modal").hidden = false;
  await loadDirectory(pathInput.value.trim() || undefined);
}

async function loadDirectory(directoryPath) {
  const list = document.getElementById("directory-list");
  const current = document.getElementById("directory-current");
  const upButton = document.getElementById("directory-up");
  const selectButton = document.getElementById("directory-select-current");
  list.innerHTML = '<div class="empty-state">正在读取目录…</div>';
  upButton.disabled = true;
  selectButton.disabled = true;
  try {
    const payload = await api("/api/directories", {
      method: "POST",
      body: JSON.stringify({ path: directoryPath || undefined }),
    });
    state.directoryListing = payload;
    current.textContent = payload.current || "选择磁盘";
    current.title = payload.current || "本机磁盘";
    upButton.disabled = !payload.current;
    selectButton.disabled = !payload.current;
    list.innerHTML = payload.entries.length
      ? payload.entries.map((entry) => `<button type="button" class="directory-entry" data-directory-path="${escapeAttr(entry.path)}"><span class="directory-icon" aria-hidden="true">▱</span><span>${escapeHtml(entry.name)}</span><span aria-hidden="true">›</span></button>`).join("")
      : '<div class="empty-state">当前目录没有子文件夹，可以直接选择此目录。</div>';
  } catch (error) {
    state.directoryListing = null;
    current.textContent = "无法读取目录";
    list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    showToast(error.message, true);
  }
}

function selectCurrentDirectory() {
  const listing = state.directoryListing;
  if (!listing?.current) return;
  const pathInput = document.getElementById("product-repository-path");
  const idInput = document.getElementById("product-repository-id");
  pathInput.value = listing.current;
  if (!idInput.value.trim() && listing.suggestedId) idInput.value = listing.suggestedId;
  closeDirectoryModal();
  showToast(`已选择 ${listing.current}`);
}

function closeDirectoryModal() {
  document.getElementById("directory-modal").hidden = true;
  state.directoryListing = null;
}

function environmentKindOptions(selected) {
  return [["development", "开发"], ["test", "测试"], ["staging", "预发布"], ["production", "生产"], ["other", "其他"]]
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function environmentStatusOptions(selected) {
  return [["unknown", "未知"], ["healthy", "正常"], ["warning", "告警"], ["offline", "离线"]]
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function deploymentStatusOptions(selected) {
  return [["unknown", "未知"], ["deployed", "已部署"], ["deploying", "部署中"], ["failed", "失败"]]
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

async function refreshRuns() {
  try {
    const payload = await api("/api/runs?limit=80");
    state.runs = payload.runs || [];
    renderRuns();
    showToast("运行记录已刷新");
  } catch (error) {
    showToast(error.message, true);
  }
}

function openCommandModal(projectId, commandName) {
  const project = state.overview.projects.find((item) => item.id === projectId);
  const command = project?.commands?.[commandName];
  if (!project || !command) return showToast("未找到项目命令", true);
  state.pendingCommand = { project, commandName, command };
  document.getElementById("modal-title").textContent = `${project.id} · ${commandName}`;
  document.getElementById("modal-kicker").textContent = `${command.risk.toUpperCase()} COMMAND`;
  document.getElementById("command-preview").textContent = `${project.path}> ${command.command}`;
  document.getElementById("terminal-output").textContent = "等待执行…";
  document.getElementById("approval-note").hidden = command.risk === "read";
  document.getElementById("modal-run").textContent = command.risk === "read" ? "运行命令" : `确认并运行 ${command.risk}`;
  document.getElementById("modal-run").disabled = false;
  document.getElementById("modal-cancel").disabled = false;
  document.getElementById("command-modal").hidden = false;
}

function closeCommandModal() {
  if (document.getElementById("modal-run").disabled) return;
  document.getElementById("command-modal").hidden = true;
  state.pendingCommand = null;
}

async function runPendingCommand() {
  if (!state.pendingCommand) return;
  const { project, commandName, command } = state.pendingCommand;
  const runButton = document.getElementById("modal-run");
  const cancelButton = document.getElementById("modal-cancel");
  runButton.disabled = true;
  cancelButton.disabled = true;
  runButton.textContent = "运行中…";
  document.getElementById("terminal-output").textContent = `$ ${command.command}\n\n正在执行，请稍候…`;
  try {
    const result = await api("/api/run", {
      method: "POST",
      body: JSON.stringify({ projectId: project.id, commandName, approved: command.risk !== "read" }),
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    document.getElementById("terminal-output").textContent = output || `命令结束，退出码 ${result.code}`;
    runButton.textContent = result.ok ? "执行成功" : `失败 · ${result.code}`;
    showToast(result.ok ? `${project.id}.${commandName} 执行成功` : `${project.id}.${commandName} 执行失败`, !result.ok);
    await refreshAfterAction();
  } catch (error) {
    document.getElementById("terminal-output").textContent = `Error: ${error.message}`;
    runButton.textContent = "执行失败";
    showToast(error.message, true);
  } finally {
    runButton.disabled = false;
    cancelButton.disabled = false;
  }
}

async function submitAgentTask(event) {
  event.preventDefault();
  const promptInput = document.getElementById("agent-prompt");
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  const allowRisk = document.getElementById("agent-risk").checked;
  if (allowRisk) {
    const confirmed = await confirmAction({
      kicker: "ELEVATED PERMISSION",
      title: "允许 Agent 执行高风险操作？",
      message: "本次任务将临时允许 Agent 调用 write / deploy 命令。",
      details: ["可能修改本地代码和配置", "可能执行构建或部署命令", "所有执行结果会写入运行记录"],
      confirmText: "允许并继续",
      tone: "warning",
    });
    if (!confirmed) return;
  }
  const providerId = document.getElementById("agent-provider").value;
  const agentId = document.getElementById("agent-profile").value;
  const projectId = document.getElementById("agent-project").value;
  appendMessage("user", prompt);
  promptInput.value = "";
  const typingId = appendTyping();
  const submit = document.getElementById("agent-submit");
  submit.disabled = true;
  submit.textContent = "处理中…";
  try {
    const result = await api("/api/agent", {
      method: "POST",
      body: JSON.stringify({ prompt, providerId, agentId: agentId || undefined, productId: projectId || undefined, allowRisk }),
    });
    removeMessage(typingId);
    appendMessage("assistant", result.answer);
    await refreshAfterAction();
  } catch (error) {
    removeMessage(typingId);
    appendMessage("assistant", `任务失败：${error.message}`);
    showToast(error.message, true);
  } finally {
    submit.disabled = false;
    submit.innerHTML = "发送 <span>↑</span>";
    promptInput.focus();
  }
}

function appendMessage(role, text) {
  const container = document.getElementById("chat-messages");
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user-message" : "assistant-message"}`;
  article.innerHTML = `<div class="message-avatar">${role === "user" ? "我" : "✦"}</div><div class="message-body"><span class="message-author">${role === "user" ? "You" : "智能小助手"}</span><p></p></div>`;
  article.querySelector("p").textContent = text;
  container.appendChild(article);
  container.scrollTop = container.scrollHeight;
}

function appendTyping() {
  const id = `typing-${Date.now()}`;
  const container = document.getElementById("chat-messages");
  const article = document.createElement("article");
  article.id = id;
  article.className = "message assistant-message";
  article.innerHTML = '<div class="message-avatar">✦</div><div class="message-body"><span class="message-author">智能小助手</span><p class="typing-dots"><span></span><span></span><span></span></p></div>';
  container.appendChild(article);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeMessage(id) {
  document.getElementById(id)?.remove();
}

function clearChat() {
  document.getElementById("chat-messages").innerHTML = '<article class="message assistant-message"><div class="message-avatar">✦</div><div class="message-body"><span class="message-author">智能小助手</span><p>对话已清空。告诉我接下来要处理哪个项目。</p></div></article>';
}

async function refreshAfterAction() {
  const [overview, runs] = await Promise.all([api("/api/overview"), api("/api/runs?limit=80")]);
  state.overview = overview;
  state.runs = runs.runs || [];
  renderMetrics();
  renderOverviewProjects();
  renderProjectCards();
  renderActivity();
  renderRuns();
}

function renderLoadError(message) {
  document.getElementById("metric-grid").innerHTML = `<article class="metric-card"><span class="metric-label">加载失败</span><div class="metric-note">${escapeHtml(message)}</div></article>`;
}

function setRefreshState(loading) {
  const button = document.getElementById("refresh-button");
  button.disabled = loading;
  button.textContent = loading ? "…" : "↻";
}

function showToast(message, isError = false) {
  const region = document.getElementById("toast-region");
  const toast = document.createElement("div");
  toast.className = `toast ${isError ? "error" : ""}`;
  toast.textContent = message;
  region.appendChild(toast);
  setTimeout(() => toast.remove(), 3600);
}

function confirmAction({ kicker = "CONFIRM ACTION", title, message, details = [], confirmText = "确认", tone = "danger" }) {
  if (confirmationResolver) settleConfirmation(false);
  const modal = document.getElementById("action-confirm-modal");
  const accept = document.getElementById("action-confirm-accept");
  document.getElementById("action-confirm-kicker").textContent = kicker;
  document.getElementById("action-confirm-title").textContent = title;
  document.getElementById("action-confirm-message").textContent = message;
  document.getElementById("action-confirm-icon").textContent = tone === "warning" ? "↗" : "!";
  const detailList = document.getElementById("action-confirm-details");
  detailList.replaceChildren(...details.map((detail) => {
    const item = document.createElement("li");
    item.textContent = detail;
    return item;
  }));
  detailList.hidden = !details.length;
  accept.textContent = confirmText;
  accept.className = `action-confirm-button ${tone}`;
  modal.dataset.tone = tone;
  confirmationRestoreFocus = document.activeElement;
  modal.hidden = false;
  return new Promise((resolve) => {
    confirmationResolver = resolve;
    window.requestAnimationFrame(() => accept.focus());
  });
}

function settleConfirmation(confirmed) {
  const modal = document.getElementById("action-confirm-modal");
  if (modal.hidden) return;
  modal.hidden = true;
  const resolve = confirmationResolver;
  confirmationResolver = null;
  resolve?.(confirmed);
  if (confirmationRestoreFocus instanceof HTMLElement) confirmationRestoreFocus.focus();
  confirmationRestoreFocus = null;
}

function projectInitial(project) {
  return escapeHtml((project.id || "P").slice(0, 2).toUpperCase());
}

function createProductId(name) {
  const normalized = String(name || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 48);
  const base = normalized || `product-${Date.now().toString(36)}`;
  const existing = new Set((state.overview?.products || []).map((product) => product.id));
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function productInitial(product) {
  const source = product.name || product.id || "P";
  const latin = source.match(/[A-Za-z0-9]/g);
  return escapeHtml(latin?.slice(0, 2).join("").toUpperCase() || source.slice(0, 2));
}

function actionName(action) {
  const names = {
    "project.command": "CLI 项目命令",
    "agent.project-command": "Agent 项目命令",
    "agent.task": "CLI Agent 任务",
    "model.ask": "模型问答",
    "web.project-command": "页面项目命令",
    "web.agent-task": "页面 Agent 任务",
    "web.workflow-plan": "生成研发计划",
    "web.workflow-tasks": "拆分研发任务",
    "web.group-chat-reply": "群聊 Agent 回复",
    "web.provider-model-select": "切换默认模型",
    "web.task-status": "更新看板任务状态",
  };
  return names[action] || action || "未知操作";
}

function runModelCell(details) {
  const modelId = details?.model;
  if (!modelId) return '<span class="run-model-empty">—</span>';
  const provider = (state.overview?.providers || []).find((item) => item.id === details.provider);
  const modelName = provider?.models?.find((item) => item.id === modelId)?.name || modelId;
  return `<span class="run-model"><strong>${escapeHtml(modelName)}</strong><small>${escapeHtml(details.provider || "模型")}</small></span>`;
}

function detailSummary(details, includeModel = true) {
  if (!details || typeof details !== "object") return "—";
  const parts = [];
  if (details.projectId) parts.push(details.projectId);
  if (details.commandName) parts.push(details.commandName);
  if (includeModel && details.provider) parts.push(details.provider);
  if (includeModel && details.model) parts.push(details.model);
  if (typeof details.code === "number") parts.push(`exit ${details.code}`);
  if (details.error) parts.push(String(details.error));
  return parts.join(" · ") || "已记录";
}

function formatRelative(value) {
  const date = new Date(value);
  const delta = Date.now() - date.getTime();
  if (!Number.isFinite(delta)) return "—";
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

function formatClock(date) {
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function compactPath(value) {
  if (!value) return "Local workspace";
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}
