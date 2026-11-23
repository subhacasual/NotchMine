; NotchMine setup wizard additions. electron-builder includes build/installer.nsh automatically.
;
; Pages:  Welcome -> License -> Install for (me / everyone) -> Folder -> Extras -> Installing -> Finish
; Extras: install Everything (voidtools) for instant file search, and start NotchMine with Windows.
;
; Everything's own installer (MIT licensed, signed by voidtools PTY LTD) is bundled from
; build/everything/Everything-Setup.exe and run silently. It needs admin rights, so Windows asks once.

!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
  Var nmEvChoice      ; "1" = install Everything, "0" = don't, "" = page not shown (update / silent)
  Var nmLoginChoice   ; "1" = start with Windows, "0" = don't, "" = page not shown
  Var nmEvBox
  Var nmLoginBox
  Var nmEvFound       ; path of Everything.exe if it's installed
!endif

; ------------------------------------------------------------------ welcome
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to NotchMine ${VERSION}"
  !define MUI_WELCOMEPAGE_TEXT "This wizard installs NotchMine, a dynamic notch for Windows: media controls, a music visualizer, widgets, quick search, live wallpaper and more.$\r$\n$\r$\nIt can also install Everything (free, by voidtools) so NotchMine's search box finds your files instantly.$\r$\n$\r$\nClose any running copy of NotchMine, then click Next."
  !insertmacro MUI_PAGE_WELCOME
!macroend

; ------------------------------------------------------------------ extras page
!macro customPageAfterChangeDir
  Page custom nmExtrasShow nmExtrasLeave

  Function nmFindEverything
    StrCpy $nmEvFound ""
    ExpandEnvStrings $1 "%LOCALAPPDATA%"
    ${If} ${FileExists} "$PROGRAMFILES64\Everything\Everything.exe"
      StrCpy $nmEvFound "$PROGRAMFILES64\Everything\Everything.exe"
    ${ElseIf} ${FileExists} "$PROGRAMFILES32\Everything\Everything.exe"
      StrCpy $nmEvFound "$PROGRAMFILES32\Everything\Everything.exe"
    ${ElseIf} ${FileExists} "$1\Programs\Everything\Everything.exe"
      StrCpy $nmEvFound "$1\Programs\Everything\Everything.exe"
    ${EndIf}
  FunctionEnd

  Function nmExtrasShow
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    Call nmFindEverything
    !insertmacro MUI_HEADER_TEXT "Extras" "Choose what else Setup should do."

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${If} $nmEvFound == ""
      ${NSD_CreateCheckbox} 0 0 100% 12u "Install Everything by voidtools  (recommended, 2 MB)"
      Pop $nmEvBox
      ${If} $nmEvChoice != "0"
        ${NSD_Check} $nmEvBox
      ${EndIf}
      ${NSD_CreateLabel} 12u 14u -12u 34u "Lets NotchMine's search box (Ctrl+Alt+Space) find any file or folder by name instantly. Everything is free and starts with Windows. Without it, search uses the slower Windows index. Windows will ask for permission to install it."
      Pop $0
    ${Else}
      StrCpy $nmEvBox ""
      ${NSD_CreateLabel} 0 0 100% 24u "Everything by voidtools is already installed, so file search will be instant."
      Pop $0
    ${EndIf}

    ${NSD_CreateCheckbox} 0 60u 100% 12u "Start NotchMine when Windows starts"
    Pop $nmLoginBox
    ${If} $nmLoginChoice != "0"
      ${NSD_Check} $nmLoginBox
    ${EndIf}
    ${NSD_CreateLabel} 12u 74u -12u 20u "You can change this later from NotchMine's tray menu or Settings."
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function nmExtrasLeave
    StrCpy $nmEvChoice "0"
    ${If} $nmEvBox != ""
      ${NSD_GetState} $nmEvBox $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $nmEvChoice "1"
      ${EndIf}
    ${EndIf}
    ${NSD_GetState} $nmLoginBox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $nmLoginChoice "1"
    ${Else}
      StrCpy $nmLoginChoice "0"
    ${EndIf}
  FunctionEnd
!macroend

; ------------------------------------------------------------------ install
!macro customInstall
  ; Tell the app what was picked; it reads this once, on its first run.
  ${If} $nmLoginChoice != ""
    FileOpen $0 "$INSTDIR\resources\setup.json" w
    ${If} $nmLoginChoice == "1"
      FileWrite $0 '{"launchAtLogin":true}'
    ${Else}
      FileWrite $0 '{"launchAtLogin":false}'
    ${EndIf}
    FileClose $0
  ${EndIf}

  ${If} $nmEvChoice == "1"
    DetailPrint "Installing Everything by voidtools (fast file search)..."
    InitPluginsDir
    File "/oname=$PLUGINSDIR\Everything-Setup.exe" "${BUILD_RESOURCES_DIR}\everything\Everything-Setup.exe"
    ; runas: Everything installs a small service in Program Files, so it needs admin rights
    ExecShellWait "runas" "$PLUGINSDIR\Everything-Setup.exe" "/S" SW_HIDE
    Delete "$PLUGINSDIR\Everything-Setup.exe"
    Call nmFindEverything
    ${If} $nmEvFound != ""
      DetailPrint "Everything is installed."
      ${StdUtils.ExecShellAsUser} $0 "$nmEvFound" "open" "-startup"
    ${Else}
      DetailPrint "Everything wasn't installed (permission declined?). NotchMine will use Windows search; you can get Everything later from the search box."
    ${EndIf}
  ${EndIf}
!macroend

; ------------------------------------------------------------------ uninstall
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; the "start with Windows" entry the app registers (Everything stays: it's its own app)
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NotchMine"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "NotchMine"
  ${endIf}
!macroend
