param(
  [Parameter(Mandatory = $true)]
  [string]$TargetPath
)

$ErrorActionPreference = "Stop"
$sourceRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$targetRoot = [IO.Path]::GetFullPath($TargetPath).TrimEnd('\')
$targetDriveRoot = [IO.Path]::GetPathRoot($targetRoot).TrimEnd('\')

if ($targetRoot -eq $targetDriveRoot -or $targetRoot.Length -lt 8) {
  throw "Refusing unsafe update target: $targetRoot"
}
if ($sourceRoot -eq $targetRoot) {
  Write-Output "Package is already located at the target path. No files need to be copied."
  exit 0
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot "dist\src\server.js"))) {
  throw "The source package is incomplete: $sourceRoot"
}

$runtimePrefix = [IO.Path]::GetFullPath((Join-Path $targetRoot "runtime\node"))
try {
  $running = Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($runtimePrefix, [StringComparison]::OrdinalIgnoreCase)
  } | Select-Object -First 1
  if ($running) {
    throw "xxs_workbench is still running (PID $($running.ProcessId)). Stop it before updating."
  }
} catch {
  if ($_.Exception.Message -like "xxs_workbench is still running*") { throw }
}

New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
$dataRoot = Join-Path $targetRoot "data"
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
$database = Join-Path $dataRoot "dev-work-agent.sqlite"
if (Test-Path -LiteralPath $database) {
  $backupRoot = Join-Path $dataRoot "backups"
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  $backup = Join-Path $backupRoot ("dev-work-agent-{0}.sqlite" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
  Copy-Item -LiteralPath $database -Destination $backup -Force
  Write-Output "Database backup: $backup"
}

foreach ($directoryName in @("dist", "web", "runtime")) {
  $sourceDirectory = Join-Path $sourceRoot $directoryName
  $targetDirectory = [IO.Path]::GetFullPath((Join-Path $targetRoot $directoryName))
  if (-not $targetDirectory.StartsWith($targetRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe resolved target: $targetDirectory"
  }
  if (Test-Path -LiteralPath $targetDirectory) {
    Remove-Item -LiteralPath $targetDirectory -Recurse -Force
  }
  Copy-Item -LiteralPath $sourceDirectory -Destination $targetDirectory -Recurse -Force
}

foreach ($fileName in @("package.json", "README.md", "README-WINDOWS.md", "RUNTIME-VERSIONS.txt", "VERSION", "start.cmd", "update.cmd", "update.ps1")) {
  $sourceFile = Join-Path $sourceRoot $fileName
  if (Test-Path -LiteralPath $sourceFile) {
    Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $targetRoot $fileName) -Force
  }
}

Write-Output "Updated xxs_workbench at $targetRoot"
Write-Output "Data preserved at $dataRoot"
