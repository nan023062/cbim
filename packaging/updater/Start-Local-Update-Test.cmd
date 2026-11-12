@echo off
setlocal
if "%~1"=="" (
  echo Usage: Start-Local-Update-Test.cmd "C:\path\to\installed\CBIM Desktop.exe" [--allow-install-on-isolated-machine]
  exit /b 2
)
if not exist "%~1" (
  echo The installed A executable does not exist.
  exit /b 2
)
if not "%~2"=="" if not "%~2"=="--allow-install-on-isolated-machine" (
  echo Unknown option. Default mode only downloads and blocks installation.
  exit /b 2
)
if not exist "%~dp0..\reports" mkdir "%~dp0..\reports"
set "ELECTRON_RUN_AS_NODE=1"
set "CBIM_LOCAL_TEST_INSTALL_FLAG="
if "%~2"=="--allow-install-on-isolated-machine" set "CBIM_LOCAL_TEST_INSTALL_FLAG=--allow-install-on-isolated-machine"
"%~1" "%~dp0desktop-local-update-test.mjs" --exe "%~1" --a "%~dp0..\A-0.1.10" --b "%~dp0..\B-0.1.11" --profile "%~dp0..\test-user" --report "%~dp0..\reports\run-%RANDOM%-%RANDOM%" %CBIM_LOCAL_TEST_INSTALL_FLAG%
exit /b %ERRORLEVEL%
