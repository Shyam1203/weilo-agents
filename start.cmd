@echo off
cd /d "%~dp0"

if not exist compose.yaml (
  echo compose.yaml is not in this folder.
  echo If you opened start.cmd from inside the zip, extract the zip first. Then run start.cmd from the extracted folder.
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker is not running. Install or start Docker Desktop. Then run this script again.
  pause
  exit /b 1
)

rem The data folder, and the parts of it the sandbox mounts.
for %%d in (isolated isolated-sessions isolated-homes agent\skills agent\extensions) do if not exist "%USERPROFILE%\.weilo-agents\%%d" mkdir "%USERPROFILE%\.weilo-agents\%%d"

if exist VERSION set /p WEILO_VERSION=<VERSION
echo Getting Weilo Agents %WEILO_VERSION%. The first time this downloads the app and can take a few minutes.
docker compose pull
if errorlevel 1 (
  echo Could not download it. Building it here instead, which takes longer.
  docker compose build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Starting Weilo Agents...
docker compose up -d
if errorlevel 1 (
  pause
  exit /b 1
)

echo Waiting for Weilo Agents to be ready...
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
set url=http://localhost:3210
for /f "delims=" %%l in ('docker exec weilo-core node /app/pair.mjs 2^>nul') do set url=%%l
echo Ready. Opening Weilo Agents
start "" "%url%"
