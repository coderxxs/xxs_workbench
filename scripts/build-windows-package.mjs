import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const product = "xxs_workbench";
const version = "1.0.0.0";
const platform = "windows-x64";
const workspace = process.cwd();
const releaseRoot = path.resolve(workspace, "release");
const folderName = `${product}-${version}-${platform}`;
const stage = path.join(releaseRoot, folderName);
const archive = path.join(releaseRoot, `${folderName}.zip`);

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Windows x64 release packages must be built on Windows x64.");
}
if (!stage.startsWith(`${releaseRoot}${path.sep}`)) throw new Error("Invalid release staging path.");

const nodeExecutable = path.resolve(process.env.DEV_AGENT_NODE || process.execPath);
const nodeRoot = path.dirname(nodeExecutable);
const pythonExecutable = resolvePythonExecutable();
const pythonRoot = path.dirname(pythonExecutable);

fs.mkdirSync(releaseRoot, { recursive: true });
fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(archive, { force: true });
fs.rmSync(`${archive}.sha256`, { force: true });
fs.mkdirSync(stage, { recursive: true });

copyDirectory("dist");
copyDirectory("web");
fs.rmSync(path.join(stage, "dist", "tests"), { recursive: true, force: true });
copyFile("README.md");
copyFile("packaging/windows/start.cmd", "start.cmd");
copyFile("packaging/windows/update.cmd", "update.cmd");
copyFile("packaging/windows/update.ps1", "update.ps1");

const runtimeRoot = path.join(stage, "runtime");
const bundledNodeRoot = path.join(runtimeRoot, "node");
const bundledPythonRoot = path.join(runtimeRoot, "python");
fs.mkdirSync(bundledNodeRoot, { recursive: true });
fs.mkdirSync(bundledPythonRoot, { recursive: true });
copyNodeRuntime(nodeRoot, bundledNodeRoot);
copyPythonRuntime(pythonRoot, bundledPythonRoot);

const nodeVersion = commandVersion(nodeExecutable, ["--version"]);
const pythonVersion = commandVersion(pythonExecutable, ["--version"]);
writeFile("VERSION", `${version}\n`);
writeFile("RUNTIME-VERSIONS.txt", `Node.js ${nodeVersion}\n${pythonVersion}\n`);
writeFile("package.json", `${JSON.stringify({
  name: product,
  version: "1.0.0",
  appVersion: version,
  private: true,
  description: "小小生开发工作台 Windows 发行包",
  scripts: { start: "runtime/node/node.exe dist/src/server.js" },
}, null, 2)}\n`);
writeFile("README-WINDOWS.md", windowsReadme(nodeVersion, pythonVersion));

const zipScript = path.join(workspace, "scripts", "create_windows_zip.py");
const zip = spawnSync(pythonExecutable, ["-X", "utf8", zipScript, stage, archive, folderName], { encoding: "utf8" });
if (zip.error) throw zip.error;
if (zip.status !== 0) throw new Error(zip.stderr || "ZIP packaging failed.");
const checksum = sha256(archive);
fs.writeFileSync(`${archive}.sha256`, `${checksum}  ${path.basename(archive)}\n`, "utf8");
console.log(`${archive}\nSHA-256: ${checksum}`);

function resolvePythonExecutable() {
  if (process.env.DEV_AGENT_PYTHON) return path.resolve(process.env.DEV_AGENT_PYTHON);
  const result = spawnSync("python", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error("Python is required to build the Windows ZIP package.");
  return path.resolve(result.stdout.trim());
}

function copyNodeRuntime(source, target) {
  for (const item of ["node.exe", "npm", "npm.cmd", "npx", "npx.cmd", "node_modules", "LICENSE"]) {
    const from = path.join(source, item);
    if (!fs.existsSync(from)) continue;
    const to = path.join(target, item);
    fs.statSync(from).isDirectory() ? fs.cpSync(from, to, { recursive: true }) : fs.copyFileSync(from, to);
  }
  if (!fs.existsSync(path.join(target, "node.exe"))) throw new Error(`Invalid Node.js runtime: ${source}`);
}

function copyPythonRuntime(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const lower = entry.name.toLowerCase();
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (lower === "dlls") fs.cpSync(from, to, { recursive: true, filter: pythonFilter });
      if (lower === "lib") fs.cpSync(from, to, { recursive: true, filter: pythonFilter });
      continue;
    }
    if (/^(python.*\.(exe|dll)|vcruntime.*\.dll|license.*)$/i.test(entry.name)) fs.copyFileSync(from, to);
  }
  if (!fs.existsSync(path.join(target, "python.exe"))) throw new Error(`Invalid Python runtime: ${source}`);
}

function pythonFilter(sourcePath) {
  const normalized = sourcePath.replaceAll("\\", "/").toLowerCase();
  return !normalized.includes("/site-packages") && !normalized.includes("/__pycache__") && !normalized.includes("/lib/test/");
}

function copyDirectory(relativePath) {
  fs.cpSync(path.join(workspace, relativePath), path.join(stage, relativePath), { recursive: true });
}

function copyFile(relativePath, targetName = path.basename(relativePath)) {
  fs.copyFileSync(path.join(workspace, relativePath), path.join(stage, targetName));
}

function writeFile(relativePath, content) {
  fs.writeFileSync(path.join(stage, relativePath), content.replace(/\r\n/g, "\n"), "utf8");
}

function commandVersion(executable, args) {
  const result = spawnSync(executable, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Cannot run ${executable}`);
  return `${result.stdout || result.stderr}`.trim();
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function windowsReadme(nodeVersion, pythonVersion) {
  return `# 小小生开发工作台 ${version}（Windows x64）

## 直接运行

1. 解压整个 ZIP，不能只单独复制 \`start.cmd\`。
2. 双击 \`start.cmd\`。
3. 浏览器访问 \`http://127.0.0.1:4317\`；局域网其他电脑使用本机 IP 和端口 4317。

安装包内置 Node.js ${nodeVersion} 和 ${pythonVersion}，不要求 Windows 预装 Node/Python。Git 状态与代码仓库功能仍需要系统安装 Git。

程序数据保存在解压目录的 \`data\\dev-work-agent.sqlite\`。发行包本身不包含 SQLite 数据库、API Key、产品、人员或历史消息。

## 后续版本升级

先停止旧版本，再在新版本解压目录运行：

\`update.cmd D:\\software\\xxs_workbench-1.0.0.0-windows-x64\`

升级脚本会先把目标 SQLite 备份到 \`data\\backups\`，然后只替换 \`dist\`、\`web\`、\`runtime\` 和程序文件，保留整个 \`data\`。新程序首次启动时会自动执行兼容的数据结构迁移。

## 代码仓库目录

“配置 → 产品配置 → 选择目录”读取当前 Windows 部署机的盘符和目录。工作台不会连接或控制其他 Windows 电脑。

## 局域网访问与防火墙

\`start.cmd\` 默认监听 \`0.0.0.0:4317\`。如需放行 Windows 防火墙，请在管理员 PowerShell 执行：

\`New-NetFirewallRule -DisplayName "xxs_workbench 4317" -Direction Inbound -Protocol TCP -LocalPort 4317 -Action Allow\`

工作台当前是本地管理员模式，没有多用户登录认证。仅应在可信局域网或受控防火墙范围内开放。
`;
}
