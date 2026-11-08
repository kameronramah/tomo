@echo off
rem Simulateur Mumble Link pour tester l'audio spatial de tomo sans jeu.
rem Usage : client\scripts\mumble-sim.cmd   (Ctrl+C pour arrêter)
rem Premier argument optionnel = dossier de compilation Rust (si chemin du projet trop long).
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mumble-sim.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mumble-sim.ps1" -TargetDir "%~1"
)
