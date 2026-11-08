; Preserve the existing explicitly configured profile across a real NSIS update.
; No tokens are passed. A trailing dot avoids a quoted path ending in backslash.
!macro StartApp
  Var /GLOBAL startAppArgs
  Var /GLOBAL cbimUserRoot
  StrCpy $startAppArgs ""
  ${if} ${isUpdated}
    StrCpy $startAppArgs "--updated"
    ReadEnvStr $cbimUserRoot "CBIM_USER_DATA_ROOT"
    ${if} $cbimUserRoot != ""
      StrCpy $startAppArgs '$startAppArgs --cbim-user-data-root="$cbimUserRoot\."'
    ${endif}
  ${endif}
  ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$startAppArgs"
!macroend
