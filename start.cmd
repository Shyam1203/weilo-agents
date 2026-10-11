@echo off
rem Start Weilo Agents and open it in the browser.
cd /d "%~dp0"

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker is not running. Install or start Docker Desktop. Then run this script again.
  pause
  exit /b 1
)

docker compose up -d --build
if errorlevel 1 (
  pause
  exit /b 1
)

set tries=0
:wait
curl -fs http://localhost:3210 >nul 2>&1
if not errorlevel 1 goto open
set /a tries+=1
if %tries% geq 90 (
  echo Weilo Agents did not start. For details, run: docker compose logs
  pause
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait

:open
start http://localhost:3210
