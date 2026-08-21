@echo off
title Installing Defect Analytics Dashboard to Local Desktop...
echo.
echo ============================================================
echo   Installing Defect Analytics Dashboard to Local PC...
echo ============================================================
echo.

set TARGET_DIR=%LOCALAPPDATA%\DefectAnalysisApp
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

echo Copying application files to local C: drive (%TARGET_DIR%)...
xcopy "%~dp0assets" "%TARGET_DIR%\assets\" /E /Y /I /Q >nul 2>&1
xcopy "%~dp0css" "%TARGET_DIR%\css\" /E /Y /I /Q >nul 2>&1
xcopy "%~dp0data" "%TARGET_DIR%\data\" /E /Y /I /Q >nul 2>&1
xcopy "%~dp0js" "%TARGET_DIR%\js\" /E /Y /I /Q >nul 2>&1
xcopy "%~dp0lib" "%TARGET_DIR%\lib\" /E /Y /I /Q >nul 2>&1
copy "%~dp0index.html" "%TARGET_DIR%\index.html" /Y >nul 2>&1
copy "%~dp0server.exe" "%TARGET_DIR%\server.exe" /Y >nul 2>&1
copy "%~dp0server.py" "%TARGET_DIR%\server.py" /Y >nul 2>&1

echo.
echo Launching local server and opening dashboard...
start "" "%TARGET_DIR%\server.exe"

echo.
echo ============================================================
echo   SUCCESS! Local server started on C: drive.
echo   Opening dashboard in your default browser...
echo ============================================================
echo.
timeout /t 2 >nul
start http://127.0.0.1:8080
