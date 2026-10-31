import fs from "fs";
import path from "path";
import { databasePath, hasStoredConfig, loadStoredConfig, saveStoredConfig } from "./database";
import { migrateLegacyProviderModels } from "./model-catalog";
import {
  AgentConfig,
  EnvironmentKind,
  EnvironmentStatus,
  DeploymentStatus,
  ProductConfig,
  ProjectCommand,
  ProjectConfig,
  ProviderConfig,
  RiskLevel,
} from "./types";

const CONFIG_DIRECTORY = ".dev-agent";
const CONFIG_FILE = "config.json";
const DATABASE_FILE = "dev-work-agent.sqlite";

export function findAgentHome(startDirectory = process.cwd()): string {
  const configured = process.env.DEV_AGENT_HOME;
  if (configured) {
    return path.resolve(configured);
  }

  let current = path.resolve(startDirectory);
  while (true) {
    const home = path.join(current, CONFIG_DIRECTORY);
    if (fs.existsSync(path.join(home, DATABASE_FILE)) || fs.existsSync(path.join(home, CONFIG_FILE))) {
      return home;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.join(path.resolve(startDirectory), CONFIG_DIRECTORY);
}

export function configPath(home = findAgentHome()): string {
  return databasePath(home);
}

export function defaultConfig(): AgentConfig {
  const providers: Record<string, ProviderConfig> = {
    openai: {
      id: "openai",
      type: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      defaultModel: "gpt-5.6-sol",
    },
    deepseek: {
      id: "deepseek",
      type: "openai-compatible",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      defaultModel: "deepseek-flash",
    },
    kimi: {
      id: "kimi",
      type: "openai-compatible",
      baseUrl: "https://api.moonshot.cn/v1",
      apiKeyEnv: "KIMI_API_KEY",
      defaultModel: "kimi-k3.1-pro",
    },
  };

  return {
    version: 1,
    defaultProvider: "deepseek",
    providers,
    products: {},
    projects: {},
  };
}

export function initializeConfig(home = findAgentHome(), force = false): string {
  const file = configPath(home);
  if (hasStoredConfig(home) && !force) {
    throw new Error(`Config already exists: ${file}`);
  }
  writeConfig(defaultConfig(), home);
  return file;
}

export function loadConfig(home = findAgentHome()): AgentConfig {
  const file = configPath(home);
  const parsed = loadStoredConfig<AgentConfig>(home);
  if (!parsed) {
    throw new Error(`Config not found: ${file}. Run \"dev-agent init\" first.`);
  }
  // Config version 1 originally contained only repositories. Add the product
  // layer in memory so existing installations migrate without a breaking step.
  let migrated = false;
  if (!parsed.products) {
    parsed.products = {};
    migrated = true;
  }
  for (const product of Object.values(parsed.products)) {
    if (!product.deployments) {
      product.deployments = [];
      migrated = true;
    }
  }
  migrated = migrateLegacyProviderModels(parsed.providers) || migrated;
  validateConfig(parsed);
  if (migrated) saveStoredConfig(home, parsed);
  return parsed;
}

export function writeConfig(config: AgentConfig, home = findAgentHome()): void {
  validateConfig(config);
  saveStoredConfig(home, config);
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === "read" || value === "write" || value === "deploy";
}

export function validateConfig(config: AgentConfig): void {
  if (!config || config.version !== 1) {
    throw new Error("Unsupported or missing config version.");
  }
  if (!config.providers || !config.projects || !config.products) {
    throw new Error("Config must contain providers, products, and projects.");
  }
  if (!config.providers[config.defaultProvider]) {
    throw new Error(`Default provider does not exist: ${config.defaultProvider}`);
  }

  for (const [id, provider] of Object.entries(config.providers)) {
    if (id !== provider.id || !provider.baseUrl || !provider.apiKeyEnv || !provider.defaultModel) {
      throw new Error(`Invalid provider config: ${id}`);
    }
  }

  for (const [id, project] of Object.entries(config.projects)) {
    if (id !== project.id || !project.path || !project.commands) {
      throw new Error(`Invalid project config: ${id}`);
    }
    for (const [name, command] of Object.entries(project.commands)) {
      if (!command.command || !isRiskLevel(command.risk)) {
        throw new Error(`Invalid command ${id}.${name}`);
      }
    }
  }

  for (const [id, product] of Object.entries(config.products)) {
    validateProduct(id, product, config);
  }
}

function validateProduct(id: string, product: ProductConfig, config: AgentConfig): void {
  if (
    id !== product.id ||
    !product.name ||
    !Array.isArray(product.repositories) ||
    !product.environments ||
    !Array.isArray(product.deployments)
  ) {
    throw new Error(`Invalid product config: ${id}`);
  }
  for (const repositoryId of product.repositories) {
    if (!config.projects[repositoryId]) {
      throw new Error(`Product ${id} references unknown repository: ${repositoryId}`);
    }
  }
  for (const [environmentId, environment] of Object.entries(product.environments)) {
    if (
      environmentId !== environment.id ||
      !environment.name ||
      !isEnvironmentKind(environment.kind) ||
      !isEnvironmentStatus(environment.status)
    ) {
      throw new Error(`Invalid environment ${id}.${environmentId}`);
    }
  }
  for (const deployment of product.deployments) {
    if (!product.repositories.includes(deployment.repositoryId)) {
      throw new Error(`Product ${id} deployment references an unlinked repository: ${deployment.repositoryId}`);
    }
    if (!product.environments[deployment.environmentId]) {
      throw new Error(`Product ${id} deployment references an unknown environment: ${deployment.environmentId}`);
    }
    if (!isDeploymentStatus(deployment.status)) {
      throw new Error(`Product ${id} deployment has an invalid status.`);
    }
  }
}

function isEnvironmentKind(value: unknown): value is EnvironmentKind {
  return value === "development" || value === "test" || value === "staging" || value === "production" || value === "other";
}

function isEnvironmentStatus(value: unknown): value is EnvironmentStatus {
  return value === "healthy" || value === "warning" || value === "offline" || value === "unknown";
}

function isDeploymentStatus(value: unknown): value is DeploymentStatus {
  return value === "deployed" || value === "deploying" || value === "failed" || value === "unknown";
}

export function detectProject(projectId: string, projectPath: string): ProjectConfig {
  const absolutePath = path.resolve(projectPath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    throw new Error(`Project directory does not exist: ${absolutePath}`);
  }

  const commands: Record<string, ProjectCommand> = {};
  let stack = "unknown";

  const packageFile = path.join(absolutePath, "package.json");
  if (fs.existsSync(packageFile)) {
    stack = "node";
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageFile, "utf8")) as {
        scripts?: Record<string, string>;
      };
      const scripts = packageJson.scripts ?? {};
      for (const name of ["lint", "typecheck", "test", "build", "dev", "start", "deploy", "release"]) {
        if (!scripts[name]) continue;
        commands[name] = {
          command: `npm run ${name}`,
          risk: name === "deploy" || name === "release" ? "deploy" : name === "dev" || name === "start" ? "write" : "read",
          description: `Run package.json script: ${name}`,
        };
      }
    } catch (error) {
      throw new Error(`Cannot parse ${packageFile}: ${messageOf(error)}`);
    }
  } else if (fs.existsSync(path.join(absolutePath, "pom.xml"))) {
    stack = "java-maven";
    const executable = fs.existsSync(path.join(absolutePath, "mvnw.cmd")) ? "mvnw.cmd" : "mvn";
    commands.test = { command: `${executable} test`, risk: "read", description: "Run Maven tests" };
    commands.build = { command: `${executable} package`, risk: "read", description: "Build Maven package" };
  } else if (
    fs.existsSync(path.join(absolutePath, "build.gradle")) ||
    fs.existsSync(path.join(absolutePath, "build.gradle.kts"))
  ) {
    stack = "java-gradle";
    const executable = fs.existsSync(path.join(absolutePath, "gradlew.bat")) ? "gradlew.bat" : "gradle";
    commands.test = { command: `${executable} test`, risk: "read", description: "Run Gradle tests" };
    commands.build = { command: `${executable} build`, risk: "read", description: "Build Gradle project" };
  } else if (fs.existsSync(path.join(absolutePath, "go.mod"))) {
    stack = "go";
    commands.test = { command: "go test ./...", risk: "read", description: "Run Go tests" };
    commands.build = { command: "go build ./...", risk: "read", description: "Build Go packages" };
  } else if (
    fs.existsSync(path.join(absolutePath, "pyproject.toml")) ||
    fs.existsSync(path.join(absolutePath, "requirements.txt"))
  ) {
    stack = "python";
    commands.test = { command: "python -m pytest", risk: "read", description: "Run Python tests" };
  }

  return {
    id: projectId,
    name: path.basename(absolutePath),
    path: absolutePath,
    stack,
    commands,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
