@echo off
where python >nul 2>&1
if errorlevel 1 (
    echo Python 3 is required. Install it from https://www.python.org/downloads/
    pause
    exit /b 1
)
python -I -B "%~dp0serve.py"
if errorlevel 1 pause
