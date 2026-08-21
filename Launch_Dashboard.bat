@echo off
title Defect Analytics Dashboard
pushd "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File "Launch_Dashboard.ps1"
popd
