@echo off
cd /d "%~dp0"
py -3 scanner_companion.py
if errorlevel 1 pause
