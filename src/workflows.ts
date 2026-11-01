import path from "path";
import { randomBytes } from "crypto";
import { findAgentHome } from "./config";
import { loadRecords, replaceRecords } from "./database";
import { DevelopmentMilestone, DevelopmentWorkflow, TaskExecutionStage, WorkflowStage, WorkflowTaskItem, WorkflowTemplateId } from "./types";
import { WORKFLOW_EXECUTION_STAGES, WORKFLOW_STAGES, WORKFLOW_TEMPLATE_IDS, workflowTaskStageFromHeading, workflowTemplate } from "./workflow-templates";

const WORKFLOW_FILE = "workflows.json";
const MILESTONE_FILE = "milestones.json";
export interface NewWorkflow {
  milestoneId: string;
  productId: string;
  providerId: string;
  title: string;
  requirement: string;
  templateId?: WorkflowTemplateId;
}

export interface NewMilestone {
  productId: string;
  providerId: string;
  title: string;
  goal: string;
  targetDate?: string;
}

export function workflowsPath(home = findAgentHome()): string {
  return path.join(home, WORKFLOW_FILE);
}

export function milestonesPath(home = findAgentHome()): string {
  return path.join(home, MILESTONE_FILE);
}

export function loadMilestones(home = findAgentHome()): DevelopmentMilestone[] {
  const parsed = loadRecords<DevelopmentMilestone>(home, "milestones");
  parsed.forEach(validateMilestone);
  return parsed;
}

export function createMilestone(input: NewMilestone, home = findAgentHome()): DevelopmentMilestone {
  const milestones = loadMilestones(home);
  const now = new Date().toISOString();
  const milestone: DevelopmentMilestone = {
    id: `ms-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
    productId: input.productId,
    providerId: input.providerId,
    title: input.title,
    goal: input.goal,
    targetDate: input.targetDate,
    createdAt: now,
    updatedAt: now,
  };
  milestones.unshift(milestone);
  writeMilestones(milestones, home);
  return milestone;
}

export function loadWorkflows(home = findAgentHome()): DevelopmentWorkflow[] {
  const parsed = loadRecords<DevelopmentWorkflow>(home, "workflows");
  parsed.forEach(validateWorkflow);
  return parsed.map((workflow) => ({
    ...workflow,
    templateId: workflow.templateId ?? "software_delivery",
    taskItems: workflow.taskItems ?? (workflow.tasks ? parseWorkflowTaskItems(workflow.tasks, workflow.templateId ?? "software_delivery") : undefined),
  }));
}

export function createWorkflow(input: NewWorkflow, home = findAgentHome()): DevelopmentWorkflow {
  const workflows = loadWorkflows(home);
  const now = new Date().toISOString();
  const workflow: DevelopmentWorkflow = {
    id: `wf-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
    milestoneId: input.milestoneId,
    productId: input.productId,
    providerId: input.providerId,
    title: input.title,
    requirement: input.requirement,
    templateId: input.templateId ?? "software_delivery",
    stage: "requirement",
    createdAt: now,
    updatedAt: now,
  };
  workflows.unshift(workflow);
  writeWorkflows(workflows, home);
  return workflow;
}

export function saveWorkflow(workflow: DevelopmentWorkflow, home = findAgentHome()): DevelopmentWorkflow {
  const workflows = loadWorkflows(home);
  const index = workflows.findIndex((item) => item.id === workflow.id);
  if (index < 0) throw new Error(`Unknown workflow: ${workflow.id}`);
  workflow.updatedAt = new Date().toISOString();
  validateWorkflow(workflow);
  workflows[index] = workflow;
  writeWorkflows(workflows, home);
  return workflow;
}

export function writeWorkflows(workflows: DevelopmentWorkflow[], home = findAgentHome()): void {
  workflows.forEach(validateWorkflow);
  replaceRecords(home, "workflows", workflows);
}

export function writeMilestones(milestones: DevelopmentMilestone[], home = findAgentHome()): void {
  milestones.forEach(validateMilestone);
  replaceRecords(home, "milestones", milestones);
}

export function parseWorkflowTaskItems(markdown: string, templateId: WorkflowTemplateId = "software_delivery"): WorkflowTaskItem[] {
  let stage: TaskExecutionStage = workflowTemplate(templateId).stages[0].id;
  const tasks: WorkflowTaskItem[] = [];
  const usedIds = new Set<string>();

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*$/);
    if (heading) stage = workflowTaskStageFromHeading(templateId, heading[1]) ?? stage;

    const item = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(?:\[([^\]]+)\]\s*)?(.+?)\s*$/);
    if (!item) continue;
    const preferredId = (item[2] || `T${tasks.length + 1}`).trim();
    const id = uniqueTaskId(preferredId, usedIds);
    usedIds.add(id);
    tasks.push({
      id,
      title: item[3].replace(/^\*\*(.+)\*\*$/, "$1").trim(),
      stage,
      status: item[1].toLowerCase() === "x" ? "completed" : "pending",
    });
  }

  return tasks;
}

function validateMilestone(value: unknown): void {
  if (!isRecord(value)) throw new Error("Invalid milestone record.");
  if (
    typeof value.id !== "string" ||
    typeof value.productId !== "string" ||
    typeof value.providerId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.goal !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error(`Invalid milestone: ${String(value.id || "unknown")}`);
  }
}

function validateWorkflow(value: unknown): void {
  if (!isRecord(value)) throw new Error("Invalid workflow record.");
  if (
    typeof value.id !== "string" ||
    typeof value.milestoneId !== "string" ||
    typeof value.productId !== "string" ||
    typeof value.providerId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.requirement !== "string" ||
    typeof value.stage !== "string" ||
    !WORKFLOW_STAGES.includes(value.stage as WorkflowStage) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error(`Invalid workflow: ${String(value.id || "unknown")}`);
  }
  if (value.templateId !== undefined && !WORKFLOW_TEMPLATE_IDS.includes(value.templateId)) {
    throw new Error(`Invalid workflow template: ${String(value.templateId)}`);
  }
  if (value.taskItems !== undefined) {
    if (!Array.isArray(value.taskItems)) throw new Error(`Invalid workflow tasks: ${value.id}`);
    value.taskItems.forEach(validateTaskItem);
  }
}

function validateTaskItem(value: unknown): void {
  if (!isRecord(value)) throw new Error("Invalid workflow task.");
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    !WORKFLOW_EXECUTION_STAGES.includes(value.stage) ||
    !["pending", "in_progress", "blocked", "completed", "failed"].includes(value.status) ||
    (value.ownerId !== undefined && typeof value.ownerId !== "string") ||
    (value.agentId !== undefined && typeof value.agentId !== "string")
  ) {
    throw new Error(`Invalid workflow task: ${String(value.id || "unknown")}`);
  }
}

function uniqueTaskId(preferred: string, usedIds: Set<string>): string {
  const base = preferred.replace(/\s+/g, "-") || "task";
  if (!usedIds.has(base)) return base;
  let suffix = 2;
  while (usedIds.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
