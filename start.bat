@echo off
cd /d "%~dp0"
if exist "%~dp0target\release\a8-devtools.exe" (
    start "" "%~dp0target\release\a8-devtools.exe"
) else (
    echo [INFO] 正在编译 a8-devtools...
    cargo build --release --workspace
    start "" "%~dp0target\release\a8-devtools.exe"
)
