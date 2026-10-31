import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { linuxRuntimes, runtimeList } from "./runtime-manifest.mjs";

const product = "xxs_workbench";
const version = "1.0.0.0";
const platform = "linux-x64";
const workspace = process.cwd();
const releaseRoot = path.resolve(workspace, "release");
const folderName = `${product}-${version}-${platform}`;
const stage = path.join(releaseRoot, folderName);
const archive = path.join(releaseRoot, `${folderName}.tar.gz`);

if (!stage.startsWith(`${releaseRoot}${path.sep}`)) throw new Error("Invalid release staging path.");
fs.mkdirSync(releaseRoot, { recursive: true });
fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(archive, { force: true });
fs.mkdirSync(stage, { recursive: true });

copyDirectory("dist");
copyDirectory("web");
fs.rmSync(path.join(stage, "dist", "tests"), { recursive: true, force: true });
copyFile("README.md");
fs.mkdirSync(path.join(stage, "runtimes"), { recursive: true });
for (const runtime of runtimeList) {
  fs.copyFileSync(
    path.join(workspace, ".cache", "linux-runtimes", runtime.fileName),
    path.join(stage, "runtimes", runtime.fileName),
  );
}

writeFile("VERSION", `${version}\n`);
writeFile("package.json", `${JSON.stringify({
  name: product,
  version: "1.0.0",
  appVersion: version,
  private: true,
  description: "小小生开发工作台 Linux 发行包",
  scripts: { start: "node dist/src/server.js" },
  engines: { node: ">=16.20" },
}, null, 2)}\n`);

copyTemplateExecutable("packaging/linux/start.sh", "start.sh");
copyTemplateExecutable("packaging/linux/install.sh", "install.sh", {
  "@APP_VERSION@": version,
  "@NODE_ARCHIVE@": linuxRuntimes.node.fileName,
  "@NODE_DIRECTORY@": linuxRuntimes.node.extractedDirectory,
  "@PYTHON_ARCHIVE@": linuxRuntimes.python.fileName,
});

writeFile("runtimes/SHA256SUMS", runtimeList.map((runtime) => `${runtime.sha256}  ${runtime.fileName}`).join("\n") + "\n");

writeFile("RUNTIME-SOURCES.md", `# Bundled runtime sources

- Node.js ${linuxRuntimes.node.version}: ${linuxRuntimes.node.url}
  - SHA-256: \`${linuxRuntimes.node.sha256}\`
- CPython ${linuxRuntimes.python.version} portable build (${linuxRuntimes.python.build}): ${linuxRuntimes.python.url}
  - SHA-256: \`${linuxRuntimes.python.sha256}\`

The Node.js archive is provided by the Node.js project. The portable CPython archive is provided by Astral's python-build-standalone project. License files are included inside each runtime archive and remain present after installation.
`);

writeFile("README-LINUX.md", `# 小小生开发工作台 ${version}（Linux x64）

## 环境要求

- Linux x64（glibc 2.28 或更高版本）
- tar、sha256sum（安装时校验并解压运行时）
- Git（读取代码仓库状态时需要）

安装包已经内置 Node.js ${linuxRuntimes.node.version} LTS 和 Python ${linuxRuntimes.python.version}，不依赖服务器预装 Node/Python。

## 一键离线安装

\`\`\`bash
chmod +x start.sh install.sh
./install.sh
~/.local/share/xxs_workbench/start.sh
\`\`\`

默认安装到 \`~/.local/share/xxs_workbench\`，访问地址为 \`http://127.0.0.1:4317\`。首次启动会在安装目录的 \`data/\` 下自动创建纯净 SQLite 数据库。

安装过程完全离线，并会在解压前校验 Node.js、Python 安装包的 SHA-256。

## 指定安装目录

\`\`\`bash
./install.sh /opt/xxs_workbench
/opt/xxs_workbench/start.sh
\`\`\`

安装到 \`/opt\` 等系统目录时可能需要 \`sudo\`。重复执行安装脚本会更新程序和运行时，并保留 \`data/\` 数据目录。

## 配置 DeepSeek 等模型

启动工作台后进入“设置 → 模型 Provider 与 API Key”进行配置。Key 保存在 SQLite 的 \`provider_secrets\` 表中，页面和接口不会回显明文。也可以通过 \`OPENAI_API_KEY\`、\`DEEPSEEK_API_KEY\`、\`KIMI_API_KEY\` 环境变量临时覆盖数据库配置。

## 监听其他地址

\`\`\`bash
DEV_AGENT_HOST=0.0.0.0 DEV_AGENT_PORT=4317 ./start.sh
\`\`\`

该工作台当前默认管理员拥有全部本地权限。监听公网地址前，请通过防火墙、VPN 或带认证的反向代理限制访问。

数据目录可以通过 \`DEV_AGENT_HOME\` 指定。高级场景可以通过 \`DEV_AGENT_NODE\`、\`DEV_AGENT_PYTHON\` 覆盖内置运行时。
`);

const python = process.env.DEV_AGENT_PYTHON || (process.platform === "win32" ? "python" : "python3");
const tar = spawnSync(python, ["-X", "utf8", path.join(workspace, "scripts", "create_linux_tar.py"), stage, archive, folderName], { encoding: "utf8" });
if (tar.error) throw tar.error;
if (tar.status !== 0) throw new Error(tar.stderr || "tar packaging failed");
console.log(archive);

function copyDirectory(relativePath) {
  fs.cpSync(path.join(workspace, relativePath), path.join(stage, relativePath), { recursive: true });
}

function copyFile(relativePath) {
  fs.copyFileSync(path.join(workspace, relativePath), path.join(stage, path.basename(relativePath)));
}

function writeFile(relativePath, content) {
  fs.writeFileSync(path.join(stage, relativePath), content.replace(/\r\n/g, "\n"), "utf8");
}

function writeExecutable(relativePath, content) {
  const target = path.join(stage, relativePath);
  writeFile(relativePath, content);
  fs.chmodSync(target, 0o755);
}

function copyTemplateExecutable(sourcePath, targetPath, replacements = {}) {
  let content = fs.readFileSync(path.join(workspace, sourcePath), "utf8");
  for (const [token, value] of Object.entries(replacements)) content = content.split(token).join(value);
  writeExecutable(targetPath, content);
}
