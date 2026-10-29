#Requires -Version 5.1
param([switch]$Silent)

$ErrorActionPreference = "Stop"
$TaskName = "Local Printer Service"
$AppName = "Local Printer Service"
$InstallDir = Join-Path $env:LOCALAPPDATA "LocalPrinterService"
$StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$AppName"

try {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host "  DESINSTALAR LOCAL PRINTER SERVICE" -ForegroundColor Magenta
    Write-Host "========================================" -ForegroundColor Magenta

    if (-not $Silent) {
        $confirm = Read-Host "Confirma a remocao do servico? (s/N)"
        if ($confirm -notmatch '^[sS]') {
            Write-Host "Operacao cancelada."
            exit 0
        }
    }

    Write-Host "==> Parando processo..."
    Get-Process -Name "local-printer-service" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    Write-Host "==> Removendo tarefa agendada..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

    Write-Host "==> Removendo atalhos..."
    if (Test-Path $StartMenuDir) {
        Remove-Item -Path $StartMenuDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host "==> Removendo arquivos..."
    if (Test-Path $InstallDir) {
        # Remove tudo, exceto este script se ainda estiver em uso
        Get-ChildItem -Path $InstallDir -Force | Where-Object {
            $_.Name -notin @("uninstall.ps1", "uninstall.bat")
        } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

        # Tenta remover a pasta inteira em segundo plano
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c timeout /t 2 /nobreak >nul & rmdir /s /q `"$InstallDir`"" -WindowStyle Hidden
    }

    Write-Host ""
    Write-Host "Desinstalacao concluida." -ForegroundColor Green
    if (-not $Silent) { Pause }
} catch {
    Write-Host "ERRO na desinstalacao: $($_.Exception.Message)" -ForegroundColor Red
    if (-not $Silent) { Pause }
    exit 1
}
