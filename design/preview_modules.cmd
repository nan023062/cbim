@echo off
setlocal
set "CBIM_PROJECT=%~1"
if not defined CBIM_PROJECT set /p "CBIM_PROJECT=Project root: "
if not defined CBIM_PROJECT exit /b 1
python -B "%~dp0scripts\preview_module_tree.py" --root "%CBIM_PROJECT%" --open
if errorlevel 1 pause
