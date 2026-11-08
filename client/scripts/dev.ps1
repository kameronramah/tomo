# Lance tomo en mode développement (rechargement à chaud de l'interface).
# Usage (depuis le dossier client) :  .\scripts\dev.ps1
# Prérequis : le serveur de dev tourne (cd server ; docker compose -f docker-compose.dev.yml up -d)
param(
  # Dossier de compilation Rust. À préciser si le chemin du projet est très long (erreur LNK1104).
  [string]$TargetDir
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

# Recharge le PATH (Node, Rust installés récemment)
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

if ($TargetDir) {
  $env:CARGO_TARGET_DIR = $TargetDir
} elseif ((Get-Location).Path.Length -gt 120) {
  $env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA "tomo-build"
  Write-Host "Chemin du projet long : compilation dans $env:CARGO_TARGET_DIR" -ForegroundColor Yellow
}

try {
  $null = Invoke-RestMethod "http://localhost:3000/health" -TimeoutSec 3
  Write-Host "API de dev joignable sur http://localhost:3000" -ForegroundColor Green
} catch {
  Write-Host "API de dev injoignable : lance d'abord 'docker compose -f docker-compose.dev.yml up -d' dans server/" -ForegroundColor Red
}

if (-not (Test-Path "node_modules")) { npm install }
npm run tauri dev
