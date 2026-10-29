#Requires -Version 5.1
<#
.SYNOPSIS
  Instalador amigável do Local Printer Service (sem Node.js).
#>
param(
    [string]$SourceExe = "",
    [string]$NomeImpressora = "",
    [int]$Port = 9100,
    [switch]$Simulacao,
    [switch]$Silent
)

$ErrorActionPreference = "Stop"
$TaskName = "Local Printer Service"
$AppName = "Local Printer Service"
$InstallDir = Join-Path $env:LOCALAPPDATA "LocalPrinterService"
$ExeName = "local-printer-service.exe"
$StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$AppName"

function Write-Step($msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Write-Ok($msg) {
    Write-Host "    $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
    Write-Host "    $msg" -ForegroundColor Yellow
}

function Get-SourceExecutable {
    if ($SourceExe -and (Test-Path $SourceExe)) {
        return (Resolve-Path $SourceExe).Path
    }

    $candidates = @(
        (Join-Path $PSScriptRoot "..\dist\$ExeName"),
        (Join-Path $PSScriptRoot $ExeName),
        (Join-Path (Get-Location) "dist\$ExeName"),
        (Join-Path (Get-Location) $ExeName)
    )

    foreach ($c in $candidates) {
        if (Test-Path $c) {
            return (Resolve-Path $c).Path
        }
    }

    throw "Arquivo $ExeName nao encontrado. Execute 'npm run build' antes de instalar."
}

function Get-PrinterChoices {
    try {
        return @(Get-Printer | Select-Object -ExpandProperty Name)
    } catch {
        return @()
    }
}

function Select-PrinterInteractive {
    param([string[]]$Printers)

    if ($NomeImpressora) {
        return $NomeImpressora
    }

    if ($Silent) {
        if ($Printers.Count -gt 0) { return $Printers[0] }
        return "ZDesigner ZD420-203dpi ZPL"
    }

    Write-Host ""
    Write-Host "Impressoras encontradas:" -ForegroundColor White
    if ($Printers.Count -eq 0) {
        Write-Warn "Nenhuma impressora listada. Digite o nome manualmente."
        $manual = Read-Host "Nome da impressora"
        if ([string]::IsNullOrWhiteSpace($manual)) {
            throw "Nome da impressora e obrigatorio."
        }
        return $manual.Trim()
    }

    for ($i = 0; $i -lt $Printers.Count; $i++) {
        Write-Host ("  [{0}] {1}" -f ($i + 1), $Printers[$i])
    }
    Write-Host "  [0] Digitar nome manualmente"

    $choice = Read-Host "Escolha a impressora"
    if ($choice -eq "0") {
        $manual = Read-Host "Nome da impressora"
        if ([string]::IsNullOrWhiteSpace($manual)) {
            throw "Nome da impressora e obrigatorio."
        }
        return $manual.Trim()
    }

    $index = 0
    if (-not [int]::TryParse($choice, [ref]$index) -or $index -lt 1 -or $index -gt $Printers.Count) {
        throw "Opcao invalida."
    }

    return $Printers[$index - 1]
}

function Stop-ExistingService {
    Get-Process -Name "local-printer-service" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

function Register-StartupTask {
    param([string]$ExePath)

    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

    $action = New-ScheduledTaskAction -Execute $ExePath -WorkingDirectory $InstallDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Inicia o Local Printer Service no login" | Out-Null
}

function New-Shortcut {
    param(
        [string]$Path,
        [string]$Target,
        [string]$Arguments = "",
        [string]$WorkingDirectory = "",
        [string]$Description = ""
    )

    $wsh = New-Object -ComObject WScript.Shell
    $shortcut = $wsh.CreateShortcut($Path)
    $shortcut.TargetPath = $Target
    if ($Arguments) { $shortcut.Arguments = $Arguments }
    if ($WorkingDirectory) { $shortcut.WorkingDirectory = $WorkingDirectory }
    if ($Description) { $shortcut.Description = $Description }
    $shortcut.Save()
}

try {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host "  INSTALADOR LOCAL PRINTER SERVICE" -ForegroundColor Magenta
    Write-Host "========================================" -ForegroundColor Magenta

    $source = Get-SourceExecutable
    Write-Step "Executavel de origem"
    Write-Ok $source

    $printers = Get-PrinterChoices
    $selectedPrinter = Select-PrinterInteractive -Printers $printers

    if (-not $Silent) {
        $portInput = Read-Host "Porta HTTP [$Port]"
        if (-not [string]::IsNullOrWhiteSpace($portInput)) {
            $Port = [int]$portInput
        }

        if (-not $PSBoundParameters.ContainsKey("Simulacao")) {
            $simInput = Read-Host "Ativar modo simulacao? (s/N)"
            $Simulacao = $simInput -match '^[sS]'
        }
    }

    Write-Step "Preparando pasta de instalacao"
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Write-Ok $InstallDir

    Write-Step "Parando instancia anterior (se existir)"
    Stop-ExistingService
    Write-Ok "OK"

    Write-Step "Copiando executavel"
    $destExe = Join-Path $InstallDir $ExeName
    Copy-Item -Path $source -Destination $destExe -Force
    Write-Ok $destExe

    Write-Step "Salvando configuracao"
    $config = @{
        PORT = $Port
        NOME_IMPRESSORA = $selectedPrinter
        SIMULACAO = [bool]$Simulacao
    }
    $config | ConvertTo-Json | Set-Content -Path (Join-Path $InstallDir "config.json") -Encoding UTF8
    Write-Ok "Impressora: $selectedPrinter"
    Write-Ok "Porta: $Port"
    Write-Ok ("Simulacao: {0}" -f $Simulacao)

    Write-Step "Criando atalhos no Menu Iniciar"
    New-Item -ItemType Directory -Path $StartMenuDir -Force | Out-Null
    New-Shortcut -Path (Join-Path $StartMenuDir "Iniciar Local Printer Service.lnk") -Target $destExe -WorkingDirectory $InstallDir -Description "Inicia o servico de impressao"
    New-Shortcut -Path (Join-Path $StartMenuDir "Desinstalar Local Printer Service.lnk") -Target "powershell.exe" -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`"" -WorkingDirectory $InstallDir -Description "Remove o servico"
    Copy-Item -Path (Join-Path $PSScriptRoot "uninstall.ps1") -Destination (Join-Path $InstallDir "uninstall.ps1") -Force
    Copy-Item -Path (Join-Path $PSScriptRoot "uninstall.bat") -Destination (Join-Path $InstallDir "uninstall.bat") -Force
    Write-Ok $StartMenuDir

    Write-Step "Registrando inicio automatico no login"
    Register-StartupTask -ExePath $destExe
    Write-Ok "Tarefa agendada: $TaskName"

    Write-Step "Iniciando servico"
    Start-Process -FilePath $destExe -WorkingDirectory $InstallDir
    Start-Sleep -Seconds 2

    try {
        $status = Invoke-RestMethod -Uri "http://localhost:$Port/status" -TimeoutSec 5
        Write-Ok ("Servico online: {0}" -f $status.status)
    } catch {
        Write-Warn "Servico iniciado, mas ainda nao respondeu em http://localhost:$Port/status"
        Write-Warn "Abra o executavel manualmente se necessario."
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  INSTALACAO CONCLUIDA" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "Pasta:      $InstallDir"
    Write-Host "URL:        http://localhost:$Port"
    Write-Host "Status:     http://localhost:$Port/status"
    Write-Host "Impressora: $selectedPrinter"
    Write-Host ""
    Write-Host "O servico inicia automaticamente no login do Windows."
    Write-Host "Para remover: Menu Iniciar > $AppName > Desinstalar"
    Write-Host ""

    if (-not $Silent) {
        Pause
    }
} catch {
    Write-Host ""
    Write-Host "ERRO na instalacao: $($_.Exception.Message)" -ForegroundColor Red
    if (-not $Silent) { Pause }
    exit 1
}
