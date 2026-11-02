import fs from "fs";
import path from "path";
import { runCaptured } from "./process";

export function suggestRepositoryId(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "")
    .toLowerCase();
}

export async function pickWindowsDirectory(initialPath?: string): Promise<string | undefined> {
  if (process.platform !== "win32") throw new Error("Windows 原生目录选择器仅支持 Windows。");
  const powershell = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  const initial = (initialPath || "").replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$owner = New-Object System.Windows.Forms.Form",
    "$owner.ShowInTaskbar = $false",
    "$owner.TopMost = $true",
    "$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow",
    "$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual",
    "$owner.Location = New-Object System.Drawing.Point(-32000, -32000)",
    "$owner.Size = New-Object System.Drawing.Size(1, 1)",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = '选择本地仓库目录'",
    "$dialog.ShowNewFolderButton = $true",
    `$initial = '${initial}'`,
    "if ($initial -and [IO.Directory]::Exists($initial)) { $dialog.SelectedPath = $initial }",
    "$owner.Show()",
    "$owner.Activate()",
    "try { if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) } } finally { $dialog.Dispose(); $owner.Close(); $owner.Dispose() }",
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = await runCaptured(powershell, ["-NoProfile", "-STA", "-EncodedCommand", encoded], process.cwd(), 10 * 60_000);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "无法打开 Windows 目录选择器。");
  const selected = result.stdout.trim();
  if (!selected) return undefined;
  if (!fs.existsSync(selected) || !fs.statSync(selected).isDirectory()) throw new Error("选择的目录不存在或无法访问。");
  return path.resolve(selected);
}
