; Recreate the Start Menu and Desktop shortcuts at the END of every install
; and update, with a clean, valid icon location.
;
; Background: electron-builder's CreateShortCut writes the app description
; (package.json "description") into the .lnk StringData. NSIS's shortcut
; writer overflows for long descriptions, corrupting the icon-location string
; and leaving Windows with an unresolvable icon — the shortcut then renders
; as the generic white "paper" icon. Keeping the description short here (and
; in package.json) plus unconditionally rewriting the shortcuts heals both
; fresh installs and upgrades of earlier affected versions.

!macro customInstall
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${If} $newStartMenuLink != ""
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "DeepSeek Harness Desktop"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${EndIf}
  !endif
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${ifNot} ${isNoDesktopShortcut}
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "DeepSeek Harness Desktop"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${endIf}
  !endif
!macroend
