; ============================================================
; Grabbit — Inno Setup Script
; Builds GrabbitSetup.exe installer for Windows
; ============================================================

#define AppName      "Grabbit"
#define AppVersion   "1.1.2"
#define AppPublisher "AppGrabbit"
#define AppURL       "https://appgrabbit.com"
#define AppExeName   "Grabbit.exe"
#define SourceDir    "C:\Users\enriq\OneDrive\Documents\grabbit-app"

[Setup]
AppId={{A7B3C9D1-E2F4-4A5B-8C6D-9E0F1A2B3C4D}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
AppCopyright=Copyright (C) 2026 Grabbit
VersionInfoVersion={#AppVersion}
VersionInfoCompany=Grabbit
VersionInfoDescription=Grabbit Video Downloader
VersionInfoProductName=Grabbit
VersionInfoProductVersion={#AppVersion}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir={#SourceDir}\dist
OutputBaseFilename=GrabbitSetup
SetupIconFile={#SourceDir}\grabbit.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName=Grabbit
CloseApplications=yes
CloseApplicationsFilter=*.exe
RestartApplications=no
MissingRunOnceIdsWarning=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Everything from PyInstaller output (already includes templates and static)
Source: "{#SourceDir}\dist\Grabbit\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}";                  Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}";        Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}";            Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\__pycache__"
Type: filesandordirs; Name: "{app}\.grabbit_tmp"

[Code]
function InitializeSetup(): Boolean;
begin
  // Kill running Grabbit instance before installing
  Exec('taskkill.exe', '/F /IM Grabbit.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := True;
end;

// Keep user data folder on uninstall
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then begin
    // data/ folder is intentionally NOT deleted
    // Users keep their library and settings
  end;
end;
