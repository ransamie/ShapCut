@echo off
REM ShapCut — Windows launcher
REM Starts both the Python backend and the React frontend

TITLE ShapCut Launcher

echo.
echo  ╔══════════════════════════════════════╗
echo  ║      ShapCut AI Video Editor         ║
echo  ╚══════════════════════════════════════╝
echo.

REM ── Check Python ──
set PYTHON_CMD=python
py -3.12 --version >nul 2>&1
IF NOT ERRORLEVEL 1 (
    set PYTHON_CMD=py -3.12
) ELSE (
    py -3.11 --version >nul 2>&1
    IF NOT ERRORLEVEL 1 (
        set PYTHON_CMD=py -3.11
    )
)

%PYTHON_CMD% --version >nul 2>&1
IF ERRORLEVEL 1 (
    echo [ERROR] Python not found. Please install Python 3.11 or 3.12
    pause
    exit /b 1
)

REM ── Check Node.js ──
node --version >nul 2>&1
IF ERRORLEVEL 1 (
    echo [ERROR] Node.js not found. Please install Node.js 18+
    pause
    exit /b 1
)

REM ── Install backend dependencies ──
echo [1/4] Checking backend dependencies...
IF NOT EXIST backend\venv (
    echo Creating Python virtual environment...
    %PYTHON_CMD% -m venv backend\venv
)
call backend\venv\Scripts\activate.bat
pip install -r backend\requirements.txt
echo Backend dependencies ready.

REM ── Install frontend dependencies ──
echo [2/4] Checking frontend dependencies...
IF NOT EXIST frontend\node_modules (
    echo Installing npm packages...
    cd frontend
    call npm install
    cd ..
)
echo Installing Electron (Desktop App) wrapper if missing...
cd frontend
call npm install -D electron concurrently wait-on
cd ..
echo Frontend dependencies ready.

REM ── Start backend ──
echo [3/4] Starting Python backend on http://127.0.0.1:8000 ...
start "ShapCut Backend" /min cmd /c "call backend\venv\Scripts\activate.bat && cd backend && python main.py"

REM ── Wait for backend ──
timeout /t 3 /nobreak >nul

REM ── Start frontend (Electron Desktop App) ──
echo [4/4] Starting Electron Desktop App ...
start "ShapCut Frontend" /min cmd /c "cd frontend && npm run electron:dev"

echo.
echo  ShapCut Desktop App is launching!
echo.

echo Press any key to stop all services...
pause >nul

REM ── Cleanup ──
taskkill /FI "WindowTitle eq ShapCut Backend*" /F >nul 2>&1
taskkill /FI "WindowTitle eq ShapCut Frontend*" /F >nul 2>&1
echo Stopped.
