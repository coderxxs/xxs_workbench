import { AssigneeRole, TaskExecutionStage, WorkflowStage, WorkflowTemplateId } from "./types";

export interface WorkflowTemplateStage {
  id: TaskExecutionStage;
  label: string;
  role: AssigneeRole;
  keywords: string[];
  agentInstruction: string;
}

export interface WorkflowTemplate {
  id: WorkflowTemplateId;
  name: string;
  shortName: string;
  description: string;
  icon: string;
  color: string;
  requiresRepository: boolean;
  intakeLabels: { requirement: string; plan: string; tasks: string };
  planSystemPrompt: string;
  taskSystemPrompt: string;
  planChecklist: string;
  stages: WorkflowTemplateStage[];
}

export const WORKFLOW_TEMPLATE_CATALOG: WorkflowTemplate[] = [
  {
    id: "software_delivery",
    name: "软件研发",
    shortName: "研发",
    description: "适合功能开发、缺陷修复与版本交付",
    icon: "</>",
    color: "violet",
    requiresRepository: true,
    intakeLabels: { requirement: "需求", plan: "方案", tasks: "任务" },
    planSystemPrompt: "你是资深研发负责人。只输出可执行的研发计划，不编写代码，不虚构仓库事实。",
    taskSystemPrompt: "你是资深技术项目经理。把已确认的计划拆成有顺序、可验证、可独立完成的研发任务，不编写代码。",
    planChecklist: "目标与非目标、影响范围、技术方案、实施步骤、风险与回滚、部署方案、测试方案",
    stages: [
      { id: "coding", label: "编码", role: "developer", keywords: ["编码", "开发", "实现", "coding", "development", "implementation"], agentInstruction: "检查关联仓库现状，按任务清单编码并执行必要验证。" },
      { id: "deployment", label: "部署", role: "deployer", keywords: ["部署", "deploy"], agentInstruction: "检查部署命令、目标环境与工作区状态，完成部署并报告真实输出。" },
      { id: "testing", label: "测试", role: "tester", keywords: ["测试", "验收", "test", "qa"], agentInstruction: "执行相关测试，分析失败原因并给出验收结论。" },
      { id: "release", label: "发布", role: "releaser", keywords: ["发布", "release"], agentInstruction: "确认测试结果、版本号和发布条件，完成发布并记录产物。" },
    ],
  },
  {
    id: "content_operations",
    name: "内容运营",
    shortName: "运营",
    description: "适合公众号文章、短视频脚本与活动内容",
    icon: "Aa",
    color: "mint",
    requiresRepository: false,
    intakeLabels: { requirement: "内容需求", plan: "策划", tasks: "任务" },
    planSystemPrompt: "你是资深内容运营负责人。只输出可执行的内容策划，不虚构数据，不直接完成成稿。",
    taskSystemPrompt: "你是内容项目经理。把策划拆成有顺序、有负责人边界、可审核的内容生产任务。",
    planChecklist: "受众与目标、核心信息、内容结构、渠道规格、素材清单、审核标准、发布时间与效果指标",
    stages: [
      { id: "topic_planning", label: "选题", role: "operator", keywords: ["选题", "调研", "topic"], agentInstruction: "完成受众分析、选题角度和素材调研。" },
      { id: "content_creation", label: "创作", role: "operator", keywords: ["创作", "撰写", "脚本", "成稿", "creation", "writing", "draft"], agentInstruction: "按渠道规格完成文案、脚本或配套素材。" },
      { id: "content_review", label: "审核", role: "operator", keywords: ["审核", "校对", "review", "proofread"], agentInstruction: "检查事实、表达、品牌口径和发布合规性。" },
      { id: "content_publishing", label: "发布", role: "operator", keywords: ["发布", "投放", "publish", "distribution"], agentInstruction: "整理发布物料，按渠道要求完成发布并记录链接。" },
      { id: "content_analysis", label: "复盘", role: "operator", keywords: ["复盘", "数据", "分析", "analysis", "retrospective"], agentInstruction: "汇总效果数据，沉淀结论和下一轮优化建议。" },
    ],
  },
  {
    id: "incident_response",
    name: "故障处理",
    shortName: "故障",
    description: "适合线上告警、服务异常与紧急修复",
    icon: "!",
    color: "amber",
    requiresRepository: false,
    intakeLabels: { requirement: "事件", plan: "处置方案", tasks: "任务" },
    planSystemPrompt: "你是资深 SRE 负责人。基于已知事实输出安全、可回滚的故障处置方案，不虚构监控和日志。",
    taskSystemPrompt: "你是故障指挥官。把处置方案拆成有顺序、可验证、职责明确的故障处理任务。",
    planChecklist: "影响范围、已知事实、止损措施、排查路径、修复方案、验证方式、回滚条件与复盘安排",
    stages: [
      { id: "incident_triage", label: "响应", role: "deployer", keywords: ["响应", "止损", "分级", "triage", "containment"], agentInstruction: "确认影响并执行低风险止损，保留现场信息。" },
      { id: "incident_diagnosis", label: "诊断", role: "deployer", keywords: ["诊断", "排查", "定位", "diagnosis", "investigation"], agentInstruction: "基于监控、日志和变更记录定位根因。" },
      { id: "incident_fix", label: "修复", role: "developer", keywords: ["修复", "处置", "fix", "remediation"], agentInstruction: "实施最小安全修复，并明确回滚点。" },
      { id: "incident_verification", label: "验证", role: "tester", keywords: ["验证", "恢复", "verification", "recovery"], agentInstruction: "验证服务恢复、核心路径和关键指标。" },
      { id: "incident_review", label: "复盘", role: "deployer", keywords: ["复盘", "改进", "postmortem", "review"], agentInstruction: "整理时间线、根因和可追踪的改进项。" },
    ],
  },
];

export const WORKFLOW_TEMPLATE_IDS = WORKFLOW_TEMPLATE_CATALOG.map((template) => template.id);
export const WORKFLOW_EXECUTION_STAGES = WORKFLOW_TEMPLATE_CATALOG.flatMap((template) => template.stages.map((stage) => stage.id));
export const WORKFLOW_STAGES: WorkflowStage[] = ["requirement", "plan", "tasks", ...WORKFLOW_EXECUTION_STAGES];

export function workflowTemplate(templateId: WorkflowTemplateId | string | undefined): WorkflowTemplate {
  return WORKFLOW_TEMPLATE_CATALOG.find((template) => template.id === templateId) ?? WORKFLOW_TEMPLATE_CATALOG[0];
}

export function workflowStageSequence(templateId: WorkflowTemplateId | string | undefined): WorkflowStage[] {
  return ["requirement", "plan", "tasks", ...workflowTemplate(templateId).stages.map((stage) => stage.id)];
}

export function workflowStageLabel(templateId: WorkflowTemplateId | string | undefined, stage: WorkflowStage): string {
  const template = workflowTemplate(templateId);
  if (stage === "requirement" || stage === "plan" || stage === "tasks") return template.intakeLabels[stage];
  return template.stages.find((item) => item.id === stage)?.label ?? stage;
}

export function workflowTaskRole(stage: TaskExecutionStage): AssigneeRole {
  for (const template of WORKFLOW_TEMPLATE_CATALOG) {
    const found = template.stages.find((item) => item.id === stage);
    if (found) return found.role;
  }
  return "developer";
}

export function workflowTaskStageFromHeading(templateId: WorkflowTemplateId, heading: string): TaskExecutionStage | undefined {
  const normalized = heading.toLowerCase();
  return workflowTemplate(templateId).stages.find((stage) => stage.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())))?.id;
}

export function nextWorkflowStage(templateId: WorkflowTemplateId, current: WorkflowStage): WorkflowStage | undefined {
  const stages = workflowStageSequence(templateId);
  const index = stages.indexOf(current);
  return index >= 0 ? stages[index + 1] : undefined;
}
