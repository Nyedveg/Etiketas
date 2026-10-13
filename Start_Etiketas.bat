@echo off
REM Etiketas launcher.
REM   Start_Etiketas.bat           -> runs the server windowless (no console)
REM   Start_Etiketas.bat console   -> runs it with a visible console for debugging
cd /d "%~dp0"

if /i "%~1"=="console" (
    python app\etiketas.py
    pause
    exit /b
)

where pythonw >nul 2>&1
if %errorlevel%==0 (
    start "" pythonw.exe app\etiketas.py
) else (
    start "" pyw.exe app\etiketas.py
)
exit /b
