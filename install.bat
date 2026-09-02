@echo off
:: Etiketas installer entry point.
:: This is the only file you need to hand a colleague -- it fetches its
:: PowerShell companion (install.ps1) from GitHub if it isn't already sitting
:: next to it, then runs it. No admin rights are needed for any of this.
setlocal

set "PS1_URL=https://raw.githubusercontent.com/Nyedveg/Etiketas/main/install.ps1"
set "PS1_PATH=%~dp0install.ps1"

if not exist "%PS1_PATH%" (
    echo Fetching installer script...
    powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%PS1_URL%' -OutFile '%PS1_PATH%' -UseBasicParsing } catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }"
    if errorlevel 1 (
        echo.
        echo Could not download install.ps1. Check your internet connection, or
        echo place install.ps1 next to this file manually, then run this again.
        pause
        exit /b 1
    )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1_PATH%"
pause
