#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "==> Instalando dependencias de build..." -ForegroundColor Cyan
npm install
npm install --save-dev @yao-pkg/pkg

Write-Host "==> Gerando executavel com pkg..." -ForegroundColor Cyan
npx pkg . --targets node22-win-x64 --output dist/local-printer-service.exe

if (-not (Test-Path "dist\local-printer-service.exe")) {
    throw "Falha ao gerar dist\local-printer-service.exe"
}

$releaseDir = Join-Path $Root "release"
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

Write-Host "==> Montando pacote de distribuicao..." -ForegroundColor Cyan
$packageDir = Join-Path $releaseDir "LocalPrinterService"
if (Test-Path $packageDir) {
    Remove-Item $packageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $packageDir -Force | Out-Null

Copy-Item "dist\local-printer-service.exe" $packageDir
Copy-Item "installer\install.bat" (Join-Path $packageDir "Instalar.bat")
Copy-Item "installer\install.ps1" $packageDir
Copy-Item "installer\uninstall.bat" (Join-Path $packageDir "Desinstalar.bat")
Copy-Item "installer\uninstall.ps1" $packageDir
Copy-Item "installer\config.example.json" $packageDir

$readme = @(
    "Local Printer Service",
    "=====================",
    "",
    "Instalacao (recomendado):",
    "1. Clique duas vezes em Instalar.bat",
    "2. Escolha a impressora na lista",
    "3. Pronto - o servico inicia e sobe automatico no login",
    "",
    "Uso:",
    "- URL: http://localhost:9100",
    "- Status: http://localhost:9100/status",
    "- Impressoras: http://localhost:9100/impressoras",
    "",
    "Desinstalacao:",
    "- Clique em Desinstalar.bat",
    "",
    "Observacao:",
    "- Nao e necessario instalar Node.js"
) -join "`r`n"

Set-Content -Path (Join-Path $packageDir "LEIA-ME.txt") -Value $readme -Encoding UTF8

$isccCandidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
)
$iscc = $isccCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($iscc) {
    Write-Host "==> Compilando instalador Inno Setup..." -ForegroundColor Cyan
    & $iscc (Join-Path $Root "installer\setup.iss")
    $setupPath = Join-Path $releaseDir "LocalPrinterService-Setup.exe"
    if (Test-Path $setupPath) {
        Write-Host "Setup gerado: $setupPath" -ForegroundColor Green
    }
} else {
    Write-Host "==> Inno Setup nao encontrado - pacote pasta sera usado." -ForegroundColor Yellow
    Write-Host "    (Opcional) Instale Inno Setup 6 para gerar LocalPrinterService-Setup.exe" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Pacote pronto em: $packageDir" -ForegroundColor Green
Write-Host "Distribua a pasta inteira OU apenas o Setup.exe (se gerado)." -ForegroundColor Green
