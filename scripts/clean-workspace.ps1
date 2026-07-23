param(
  [string]$ProjectPath = (Get-Location).Path
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path $ProjectPath).Path

$directories = @(
  "node_modules",
  "dist",
  "release",
  "test-results",
  "playwright-report",
  ".tmp",
  "tmp"
)

foreach ($relative in $directories) {
  $target = Join-Path $root $relative
  if (Test-Path $target) {
    Remove-Item $target -Recurse -Force
    Write-Host "Removido: $relative"
  }
}

Get-ChildItem $root -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -like "*.tsbuildinfo" -or
    $_.Name -like "*.code-workspace" -or
    $_.Name -like "* - Copy*" -or
    $_.Name -in @("vite.config.js", "vite.config.d.ts")
  } |
  ForEach-Object {
    Remove-Item $_.FullName -Force
    Write-Host "Removido: $($_.FullName.Substring($root.Length + 1))"
  }

$duplicateServerScripts = Join-Path $root "server\scripts"
$rootScripts = Join-Path $root "scripts"
if ((Test-Path $duplicateServerScripts) -and (Test-Path $rootScripts)) {
  Remove-Item $duplicateServerScripts -Recurse -Force
  Write-Host "Removido: server\scripts (duplicado legado)"
}

Write-Host ""
Write-Host "Limpeza segura concluída. server\.env, server\data e pastas de backup não foram alterados."
