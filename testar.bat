@echo off
echo ========================================
echo    TESTANDO LOCAL PRINTER SERVICE
echo ========================================
echo.

echo [1/3] Iniciando servico em modo simulacao...
echo.
start "Local Printer Service" cmd /k "SIMULACAO=true npm start"

echo Aguardando servico inicializar...
timeout /t 3 /nobreak >nul

echo.
echo [2/3] Testando endpoint de status...
curl -s http://localhost:9100/status
if %errorlevel% neq 0 (
    echo ERRO: Servico nao respondeu!
    echo Verifique se o servico esta rodando.
    pause
    exit /b 1
)

echo.
echo.
echo [3/3] Testando impressao (modo simulacao)...
curl -X POST http://localhost:9100/imprimir ^
  -H "Content-Type: text/plain" ^
  -d "^XA^FO50,50^ADN,36,20^FDTeste de Impressao^FS^XZ"

echo.
echo.
echo ========================================
echo    TESTE CONCLUIDO!
echo ========================================
echo.
echo Verifique se o arquivo 'saida_zpl.txt' foi criado.
echo Para testar com impressora real, use: npm start
echo.
pause

