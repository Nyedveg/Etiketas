@echo off
:: Etiketas installer entry point.
:: This is the only file you need to hand a colleague -- it fetches its
:: PowerShell companion (install.ps1) from GitHub, then runs it. No admin
:: rights are needed for any of this.
::
::   install.bat             install Etiketas, or update it if it is already installed
::   install.bat update      update without asking (reinstalls the latest version from GitHub)
::   install.bat uninstall   remove it (the same as running uninstall.bat)
::   add -Yes to skip the confirmation questions
setlocal

set "PS1_URL=https://raw.githubusercontent.com/Nyedveg/Etiketas/main/install.ps1"
set "PS1_PATH=%~dp0install.ps1"
set "PS1_TMP=%TEMP%\etiketas_install_%RANDOM%.ps1"

:: Always try to pick up the newest installer script, so a rerun gets the current
:: update logic. Not inside a git checkout (there, install.ps1 is the file being
:: edited), and if GitHub can't be reached the copy already next to this file is used.
if exist "%~dp0.git" goto :run

echo Checking for the latest installer script...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%PS1_URL%' -OutFile '%PS1_TMP%' -UseBasicParsing } catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }"
if errorlevel 1 (
    if not exist "%PS1_PATH%" (
        echo.
        echo Could not download install.ps1. Check your internet connection, or
        echo place install.ps1 next to this file manually, then run this again.
        pause
        exit /b 1
    )
    echo Could not reach GitHub - using the installer script that is already here.
) else (
    move /y "%PS1_TMP%" "%PS1_PATH%" >nul
)

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1_PATH%" %*
pause
