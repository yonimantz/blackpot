; Inno Setup script for the SpotOn installer.
;
; Installs per user, so it never asks for an administrator password: the app
; lands in %LOCALAPPDATA%\Programs\SpotOn rather than Program Files.
;
; Build packaging\dist\SpotOn first (see build.bat), then compile this.

; MyAppVersion is normally passed in by build.bat via /DMyAppVersion=..., read
; from backend\version.py so there is one source of truth. This fallback only
; matters if someone compiles this script directly with ISCC.
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif

#define MyAppName "SpotOn"
#define MyAppExeName "SpotOn.exe"

[Setup]
; Never change AppId: it is how Windows recognizes an existing install and
; offers to upgrade it instead of installing a second copy.
AppId={{8B4C1E42-9F73-4A16-B0D5-6E2A7C93F118}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=.
OutputBaseFilename=SpotOn-Setup
SetupIconFile=SpotOn.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName} {#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Offer to close a running copy rather than failing on locked files.
CloseApplications=yes
RestartApplications=no
; Detects a running copy the reliable way: a named mutex the app holds for
; its whole process lifetime (see main.py), not just the port-based check
; the app uses to redirect a second launch to the already-open browser tab.
AppMutex=SpotOn.SingleInstance

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "dist\SpotOn\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Start {#MyAppName} now"; Flags: nowait postinstall skipifsilent

; Workflows, images and API keys live in %APPDATA%\SpotOn and are deliberately
; left behind on uninstall. Removing them is the user's call, not ours.
[UninstallDelete]
Type: filesandordirs; Name: "{app}\_internal"
