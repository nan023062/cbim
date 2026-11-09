; Windows Shell does not inherit the application's process environment.
; Replace only the launch macro after electron-builder loads common.nsh.
!define CBIM_UPDATER_INCLUDE_ROOT "${__FILEDIR__}"
!macro customHeader
  !macroundef StartApp
  !include "${CBIM_UPDATER_INCLUDE_ROOT}\launch.nsh"
!macroend
