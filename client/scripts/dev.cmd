@echo off
rem Lance Tomo en mode dev sans modifier la politique d'exécution de Windows.
rem Usage : scripts\dev.cmd   (ou double-clic)
rem Un premier argument optionnel = dossier de compilation Rust (si chemin du projet trop long).
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" -TargetDir "%~1"
)
