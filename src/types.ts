export type RiskLevel = "read" | "write" | "deploy";

export interface ProjectCommand {
  command: string;
  risk: RiskLevel;
  description?: string;
}

export interface ProjectConfig {
  id: string;
  name: string;
  path: string;
  stack: string;
  commands: Record<string, ProjectCommand>;
}

export type EnvironmentKind = "development" | "test" | "staging" | "production" | "other";
export type EnvironmentStatus = "healthy" | "warning" | "offline" | "unknown";
export type DeploymentStatus = "deployed" | "deploying" | "failed" | "unknown";

export interface ProductEnvironment {
  id: string;
  name: string;
  kind: EnvironmentKind;
  status: EnvironmentStatus;
  url?: string;
  namespace?: string;
}

export interface ProductDeployment {
  environmentId: string;
  repositoryId: string;
  branch?: string;
  version?: string;
  status: DeploymentStatus;
  deployedAt?: string;
}

export interface ProductConfig {
  id: string;
  name: string;
  description?: string;
  repositories: string[];
  environments: Record<string, ProductEnvironment>;
  deployments: ProductDeployment[];
}

export type ProviderType = "openai-responses" | "openai-compatible";

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  baseUrl: string;
  apiKeyEnv: string;
  defaultModel: string;
}

export interface AgentConfig {
  version: 1;
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
  products: Record<string, ProductConfig>;
  projects: Record<string, ProjectConfig>;
}

export type WorkflowTemplateId = "software_delivery" | "content_operations" | "incident_response";
export type TaskExecutionStage =
  | "coding" | "deployment" | "testing" | "release"
  | "topic_planning" | "content_creation" | "content_review" | "content_publishing" | "content_analysis"
  | "incident_triage" | "incident_diagnosis" | "incident_fix" | "incident_verification" | "incident_review";
export type WorkflowStage = "requirement" | "plan" | "tasks" | TaskExecutionStage;
export type TaskStatus = "pending" | "in_progress" | "blocked" | "completed" | "failed";
export type AssigneeRole = "developer" | "tester" | "deployer" | "releaser" | "operator";
export type AgentToolPermission = "inspect_repositories" | "run_read_commands" | "run_write_commands" | "run_deploy_commands";

export interface WorkflowTaskItem {
  id: string;
  title: string;
  stage: TaskExecutionStage;
  status: TaskStatus;
  ownerId?: string;
  agentId?: string;
}

export interface PersonAgentProfile {
  id: string;
  name: string;
  role: AssigneeRole;
  providerId: string;
  skillIds: string[];
  toolIds: AgentToolPermission[];
  repositoryIds: string[];
  environmentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DevelopmentPerson {
  id: string;
  name: string;
  roles: AssigneeRole[];
  agents: PersonAgentProfile[];
  createdAt: string;
  updatedAt: string;
}

export type GroupChatActivity = "message" | "started" | "completed" | "confirmation";
export type GroupChatSenderType = "administrator" | "person" | "agent";
export type ContentType = "official_account" | "short_video" | "general";
export type ContentStatus = "draft" | "review" | "published";

export interface ContentMedia {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  storedName: string;
  createdAt: string;
}

export interface ContentItem {
  id: string;
  title: string;
  type: ContentType;
  status: ContentStatus;
  body: string;
  authorPersonId?: string;
  media: ContentMedia[];
  createdAt: string;
  updatedAt: string;
}

export interface GroupChatMessage {
  id: string;
  senderPersonId: string;
  senderName: string;
  senderType?: GroupChatSenderType;
  activity: GroupChatActivity;
  text: string;
  workflowId?: string;
  workflowTitle?: string;
  taskId?: string;
  taskTitle?: string;
  createdAt: string;
}

export interface GroupChat {
  id: string;
  name: string;
  memberIds: string[];
  messages: GroupChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface DevelopmentMilestone {
  id: string;
  productId: string;
  providerId: string;
  title: string;
  goal: string;
  targetDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DevelopmentWorkflow {
  id: string;
  milestoneId: string;
  productId: string;
  providerId: string;
  title: string;
  requirement: string;
  plan?: string;
  tasks?: string;
  taskItems?: WorkflowTaskItem[];
  templateId: WorkflowTemplateId;
  stage: WorkflowStage;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  runId: string;
  event: "started" | "completed" | "failed";
  action: string;
  timestamp: string;
  details: Record<string, unknown>;
}
