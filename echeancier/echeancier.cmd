@echo off
rem Lanceur Windows : utilise le venv du depot s'il existe, sinon le Python du systeme.
setlocal
set "RACINE=%~dp0"
set "PYTHONPATH=%RACINE%;%PYTHONPATH%"

if exist "%RACINE%venv\Scripts\python.exe" (
    set "PY=%RACINE%venv\Scripts\python.exe"
) else if exist "%RACINE%..\venv\Scripts\python.exe" (
    set "PY=%RACINE%..\venv\Scripts\python.exe"
) else (
    set "PY=py"
    set "PYARGS=-3"
)

"%PY%" %PYARGS% -m echeancier %*
exit /b %ERRORLEVEL%
