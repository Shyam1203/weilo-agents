@echo off
rem Start Weilo Agents and open it in the browser.
cd /d "%~dp0"

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker is not running. Install or start Docker Desktop. Then run this script again.
  pause
  exit /b 1
)

rem The released image for this version (the VERSION file); built here only if it cannot be pulled.
if exist VERSION set /p WEILO_VERSION=<VERSION
docker compose pull --quiet >nul 2>&1
if errorlevel 1 docker compose build
if errorlevel 1 (
  pause
  exit /b 1
)
docker compose up -d
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
