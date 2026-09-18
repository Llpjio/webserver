@echo off
title E4ALL Fast Delta Sync
cd /d "%~dp0"
python e4all_sync.py
if errorlevel 1 (
    echo.
    echo Python 3 is required to run E4ALL Sync.
    echo Please make sure Python is installed and added to PATH.
    pause
)
