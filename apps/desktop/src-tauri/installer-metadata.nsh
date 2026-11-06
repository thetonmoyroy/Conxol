; Display the current maintainer without changing original license attribution.
VIAddVersionKey "CompanyName" "Tonmoy"
VIAddVersionKey "Comments" "Conxol terminal and remote connection manager; maintained by Tonmoy"

; Publisher changes must retain the folder argument used by older uninstallers.
!define MUI_CUSTOMFUNCTION_GUIINIT ConxolRestoreLegacyInstall
Function ConxolRestoreLegacyInstall
  Push $0
  ReadRegStr $0 SHCTX "Software\Tonmoy\Conxol" ""
  StrCmp $0 "" 0 conxol_migration_done
  ReadRegStr $0 SHCTX "Software\othmane\Conxol" ""
  StrCmp $0 "" 0 conxol_migration_found
  ReadRegStr $0 SHCTX "Software\Othmane Blial\Conxol" ""
  conxol_migration_found:
  StrCmp $0 "" conxol_migration_done
  IfFileExists "$0\conxol.exe" 0 conxol_migration_done
  WriteRegStr SHCTX "Software\Tonmoy\Conxol" "" "$0"
  StrCpy $INSTDIR $0
  conxol_migration_done:
  Pop $0
FunctionEnd
