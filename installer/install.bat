@echo off
setlocal
cd /d "%~dp0"

echo.
echo ========================================
echo   LOCAL PRINTER SERVICE - INSTALADOR
echo ========================================
echo.

REM Se o exe estiver na mesma pasta do instalador (pacote de distribuicao), usa ele
set "EXE="
if exist "%~dp0local-printer-service.exe" set "EXE=%~dp0local-printer-service.exe"
if exist "%~dp0..\dist\local-printer-service.exe" set "EXE=%~dp0..\dist\local-printer-service.exe"

if "%EXE%"=="" (
    echo ERRO: local-printer-service.exe nao encontrado.
    echo Gere o executavel com: npm run build
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -SourceExe "%EXE%"
exit /b %ERRORLEVEL%
