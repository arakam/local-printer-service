@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo    LOCAL PRINTER SERVICE
echo ========================================
echo.
echo Escolha o modo de instalacao:
echo.
echo   [1] Instalacao amigavel (recomendado)
echo       - Usa o .exe (sem Node.js no PC do usuario)
echo       - Configura impressora e inicio automatico
echo.
echo   [2] Instalacao para desenvolvimento
echo       - Requer Node.js e npm install
echo.
set /p opcao="Opcao [1/2]: "

if "%opcao%"=="2" goto DEV_INSTALL
goto APP_INSTALL

:APP_INSTALL
echo.
if not exist "dist\local-printer-service.exe" (
    echo Executavel nao encontrado. Gerando com npm run build...
    call npm install
    if errorlevel 1 (
        echo ERRO: falha ao instalar dependencias.
        pause
        exit /b 1
    )
    call npm run build
    if errorlevel 1 (
        echo ERRO: falha ao gerar o executavel.
        pause
        exit /b 1
    )
)
call "%~dp0installer\install.bat"
exit /b %ERRORLEVEL%

:DEV_INSTALL
echo.
echo [1/4] Verificando Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERRO: Node.js nao encontrado!
    echo Instale o Node.js 18+ em https://nodejs.org
    pause
    exit /b 1
)
echo Node.js encontrado:
node --version

echo.
echo [2/4] Instalando dependencias...
call npm install
if %errorlevel% neq 0 (
    echo ERRO: Falha ao instalar dependencias!
    pause
    exit /b 1
)

echo.
echo [3/4] Criando diretorio de logs...
if not exist logs mkdir logs

if not exist config.json (
    copy /Y installer\config.example.json config.json >nul
)

echo.
echo [4/4] Instalacao de desenvolvimento concluida!
echo.
echo Para iniciar: npm start
echo Para gerar instalador: npm run build:release
echo.
pause
exit /b 0
