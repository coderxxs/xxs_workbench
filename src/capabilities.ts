import { AgentToolPermission, AssigneeRole, EnvironmentKind } from "./types";

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  roles: AssigneeRole[];
}

export interface ToolDefinition {
  id: AgentToolPermission;
  name: string;
  description: string;
  risk: "read" | "write" | "deploy";
}

export interface AgentPresetDefinition {
  id: string;
  name: string;
  description: string;
  role: AssigneeRole;
  skillIds: string[];
  toolIds: AgentToolPermission[];
  environmentKinds: EnvironmentKind[];
}

export const SKILL_CATALOG: SkillDefinition[] = [
  { id: "team_chat", name: "群聊协作", description: "阅读群聊上下文，以员工身份同步进展、回答问题并指出需要确认的事项。", roles: ["developer", "tester", "deployer", "releaser"] },
  { id: "requirement_analysis", name: "需求分析", description: "澄清目标、边界、依赖和验收标准。", roles: ["developer", "tester"] },
  { id: "implementation", name: "编码实现", description: "按计划修改代码，并保持变更范围可控。", roles: ["developer"] },
  { id: "code_review", name: "代码审查", description: "检查正确性、可维护性、安全性和回归风险。", roles: ["developer"] },
  { id: "unit_testing", name: "单元测试", description: "设计并执行单元测试，分析失败原因。", roles: ["developer", "tester"] },
  { id: "test_design", name: "测试设计", description: "生成测试场景、验收用例和缺陷报告。", roles: ["tester"] },
  { id: "deployment_check", name: "部署检查", description: "执行部署前检查、验证结果并准备回滚。", roles: ["deployer"] },
  { id: "release_governance", name: "发布治理", description: "核对版本、变更、审批、产物和发布结果。", roles: ["releaser"] },
  { id: "incident_diagnosis", name: "故障诊断", description: "结合日志、环境和代码状态定位异常。", roles: ["developer", "tester", "deployer"] },
];

export const TOOL_CATALOG: ToolDefinition[] = [
  { id: "inspect_repositories", name: "读取仓库状态", description: "读取仓库元数据、分支和 Git 工作区状态。", risk: "read" },
  { id: "run_read_commands", name: "运行检查与测试", description: "运行登记为 read 的检查、测试和诊断命令。", risk: "read" },
  { id: "run_write_commands", name: "运行写入命令", description: "运行登记为 write 的构建、格式化等命令，仍需单次确认。", risk: "write" },
  { id: "run_deploy_commands", name: "运行部署与发布", description: "运行登记为 deploy 的命令，仍需单次确认。", risk: "deploy" },
];

export const AGENT_PRESET_CATALOG: AgentPresetDefinition[] = [
  {
    id: "general_development",
    name: "开发通用 Agent",
    description: "覆盖需求分析、编码、审查、单测与故障定位。",
    role: "developer",
    skillIds: ["team_chat", "requirement_analysis", "implementation", "code_review", "unit_testing", "incident_diagnosis"],
    toolIds: ["inspect_repositories", "run_read_commands", "run_write_commands"],
    environmentKinds: ["development"],
  },
  {
    id: "general_testing",
    name: "测试通用 Agent",
    description: "负责测试设计、自动化执行、验收与缺陷定位。",
    role: "tester",
    skillIds: ["team_chat", "requirement_analysis", "unit_testing", "test_design", "incident_diagnosis"],
    toolIds: ["inspect_repositories", "run_read_commands"],
    environmentKinds: ["test", "staging"],
  },
  {
    id: "general_deployment",
    name: "部署通用 Agent",
    description: "执行部署前检查、部署操作、结果验证与回滚准备。",
    role: "deployer",
    skillIds: ["team_chat", "deployment_check", "incident_diagnosis"],
    toolIds: ["inspect_repositories", "run_read_commands", "run_deploy_commands"],
    environmentKinds: ["development", "test", "staging"],
  },
  {
    id: "general_release",
    name: "发布通用 Agent",
    description: "核对版本、审批、产物和测试结论并执行正式发布。",
    role: "releaser",
    skillIds: ["team_chat", "release_governance"],
    toolIds: ["inspect_repositories", "run_read_commands", "run_deploy_commands"],
    environmentKinds: ["staging", "production"],
  },
];

export function skillInstruction(skillIds: string[]): string {
  const selected = SKILL_CATALOG.filter((skill) => skillIds.includes(skill.id));
  return selected.length
    ? selected.map((skill) => `${skill.name}：${skill.description}`).join("；")
    : "未配置专用 Skills，只按用户指令工作。";
}
