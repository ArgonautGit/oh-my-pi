@echo off
rem Run omp from the flash-input fork instead of the installed binary.
rem Delete this file to fall back to C:\Users\nick\AppData\Local\omp\omp.exe.
setlocal EnableDelayedExpansion
set "CACHE=%LOCALAPPDATA%\omp-leap-update.txt"

rem Print the cached update hint, if any (never blocks on the network).
if exist "%CACHE%" (
	set /p COUNT=<"%CACHE%"
	if not "!COUNT!"=="" if not "!COUNT!"=="0" >&2 echo omp: !COUNT! commit^(s^) behind upstream — rebase flash-input in omp-leap when convenient.
)

rem Refresh the cache in the background, at most once a day.
set "STALE=1"
if exist "%CACHE%" forfiles /P "%LOCALAPPDATA%" /M "omp-leap-update.txt" /D -1 >nul 2>&1 || set "STALE=0"
if "!STALE!"=="1" start "" /b powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Users\nick\.local\bin\omp-update-check.ps1"

endlocal & "C:\Users\nick\.bun\bin\bun.exe" --cwd="C:\Users\nick\Documents\programming\omp-leap\packages\coding-agent" src\cli.ts %*
