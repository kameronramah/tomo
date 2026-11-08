# Lance le simulateur Mumble Link (fait croire à Tomo qu'un jeu compatible tourne).
# Usage (depuis n'importe où) :  client\scripts\mumble-sim.cmd   — Ctrl+C pour arrêter
param(
  # Dossier de compilation Rust (à préciser si le chemin du projet est très long : erreur LNK1104)
  [string]$TargetDir,
  # Centre du cercle parcouru par le joueur simulé (mètres)
  [double]$X = 0,
  [double]$Z = 0
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\src-tauri")

# Recharge le PATH (Rust installé récemment)
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

if ($TargetDir) {
  $env:CARGO_TARGET_DIR = $TargetDir
} elseif ((Get-Location).Path.Length -gt 100) {
  $env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA "tomo-build"
}

cargo run --example mumble_sim -- $X $Z
