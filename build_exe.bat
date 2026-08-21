@echo off
title Build Standalone Executable for Defect Analytics Dashboard
echo Installing PyInstaller if needed and compiling server.py to server.exe...
python -m pip install pyinstaller
python -m PyInstaller --onefile --name server server.py
if exist "%~dp0dist\server.exe" (
    copy /Y "%~dp0dist\server.exe" "%~dp0server.exe"
    echo.
    echo SUCCESS: Created standalone server.exe in project root!
    echo Any user can now run Launch_Dashboard.bat without Python installed.
) else (
    echo.
    echo ERROR: Build failed. Please check output messages above.
)
pause
