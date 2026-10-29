; Inno Setup script - gera LocalPrinterService-Setup.exe
; Requer Inno Setup 6+: https://jrsoftware.org/isinfo.php
; Compilar: iscc installer\setup.iss

#define MyAppName "Local Printer Service"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Local Printer Service"
#define MyAppExeName "local-printer-service.exe"

[Setup]
AppId={{A7C3E2F1-9B4D-4E8A-91C2-6F0D5B8A3E21}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\LocalPrinterService
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\release
OutputBaseFilename=LocalPrinterService-Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=
InfoBeforeFile=

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "startup"; Description: "Iniciar automaticamente no login do Windows"; Flags: checkedonce

[Files]
Source: "..\dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "config.example.json"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Iniciar {#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{app}\uninstall.bat"; WorkingDir: "{app}"

[Run]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$cfg=@{PORT=9100; NOME_IMPRESSORA=(Get-Printer | Select-Object -First 1 -ExpandProperty Name); SIMULACAO=$false}; if(-not $cfg.NOME_IMPRESSORA){$cfg.NOME_IMPRESSORA='ZDesigner ZD420-203dpi ZPL'}; $cfg | ConvertTo-Json | Set-Content -Path '{app}\config.json' -Encoding UTF8"""; \
  StatusMsg: "Criando configuracao..."; Flags: runhidden waituntilterminated
Filename: "{app}\{#MyAppExeName}"; Description: "Iniciar o servico agora"; Flags: nowait postinstall skipifsilent; WorkingDir: "{app}"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "LocalPrinterService"; ValueData: """{app}\{#MyAppExeName}"""; Tasks: startup; Flags: uninsdeletevalue

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Get-Process -Name 'local-printer-service' -ErrorAction SilentlyContinue | Stop-Process -Force"""; Flags: runhidden waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Unregister-ScheduledTask -TaskName 'Local Printer Service' -Confirm:$false -ErrorAction SilentlyContinue"""; Flags: runhidden waituntilterminated
