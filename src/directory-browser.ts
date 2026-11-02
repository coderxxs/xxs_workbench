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
    `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PickerFocus {
  private delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr handle, int command);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr handle, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  public static bool BringToFront(uint targetProcessId) {
    bool found = false;
    EnumWindows((handle, parameter) => {
      uint processId;
      GetWindowThreadProcessId(handle, out processId);
      if (processId != targetProcessId || !IsWindowVisible(handle)) return true;
      ShowWindow(handle, 9);
      SetWindowPos(handle, new IntPtr(-1), 0, 0, 0, 0, 0x0003);
      SetForegroundWindow(handle);
      found = true;
      return false;
    }, IntPtr.Zero);
    return found;
  }
}
'@`,
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = '选择本地仓库目录'",
    "$dialog.ShowNewFolderButton = $true",
    `$initial = '${initial}'`,
    "if ($initial -and [IO.Directory]::Exists($initial)) { $dialog.SelectedPath = $initial }",
    "$focusTimer = New-Object System.Windows.Forms.Timer",
    "$focusTimer.Interval = 200",
    "$focusTimer.Add_Tick({ if ([PickerFocus]::BringToFront([uint32]$PID)) { $focusTimer.Stop() } })",
    "$focusTimer.Start()",
    "try { if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) } } finally { $focusTimer.Stop(); $focusTimer.Dispose(); $dialog.Dispose() }",
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = await runCaptured(powershell, ["-NoProfile", "-STA", "-EncodedCommand", encoded], process.cwd(), 10 * 60_000);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "无法打开 Windows 目录选择器。");
  const selected = result.stdout.trim();
  if (!selected) return undefined;
  if (!fs.existsSync(selected) || !fs.statSync(selected).isDirectory()) throw new Error("选择的目录不存在或无法访问。");
  return path.resolve(selected);
}
