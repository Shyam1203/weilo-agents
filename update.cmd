@echo off
rem Update Weilo Agents to the newest release, then start it. Your chats and settings stay (they are in your .weilo-agents folder).
if /i not "%~1"=="run" (
  rem Run from a copy: this file is replaced during the update, and cmd reads a script as it runs.
  copy /y "%~f0" "%TEMP%\weilo-update.cmd" >nul
  "%TEMP%\weilo-update.cmd" run "%~dp0"
  exit /b
)
cd /d "%~2"

if not exist compose.yaml (
  echo compose.yaml is not in this folder. Run update.cmd from the extracted folder.
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker is not running. Install or start Docker Desktop. Then run this script again.
  pause
  exit /b 1
)

set CURRENT=
if exist VERSION set /p CURRENT=<VERSION
set LATEST=
echo Checking for a newer version...
for /f "delims=" %%v in ('powershell -NoProfile -Command "try { (Invoke-RestMethod https://api.github.com/repos/Shyam1203/weilo-agents/releases/latest -TimeoutSec 20).tag_name.TrimStart('v') } catch { }"') do set LATEST=%%v
if not defined LATEST (
  echo Could not check for a new version. Check your internet connection and try again.
  pause
  exit /b 1
)
if "%LATEST%"=="%CURRENT%" (
  echo You have the newest version, %CURRENT%.
  pause
  exit /b 0
)

echo Updating from %CURRENT% to %LATEST%...
set WORK=%TEMP%\weilo-update
rmdir /s /q "%WORK%" >nul 2>&1
mkdir "%WORK%"
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest 'https://github.com/Shyam1203/weilo-agents/releases/download/v%LATEST%/weilo-agents-%LATEST%.zip' -OutFile '%WORK%\app.zip' -TimeoutSec 300; Expand-Archive '%WORK%\app.zip' '%WORK%\app' -Force } catch { exit 1 }"
if errorlevel 1 (
  echo Could not download version %LATEST%. Try again in a few minutes.
  rmdir /s /q "%WORK%" >nul 2>&1
  pause
  exit /b 1
)
xcopy /y /q "%WORK%\app\*" "%CD%\" >nul
rmdir /s /q "%WORK%" >nul 2>&1

call "%CD%\start.cmd"
