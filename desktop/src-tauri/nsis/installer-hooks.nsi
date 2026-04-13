; 安装前杀掉旧进程
!macro NSIS_HOOK_PREINSTALL
  ; 杀掉主程序
  nsExec::ExecToLog 'taskkill /F /IM "筋斗云AI.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "desktop.exe" /T'
  ; 杀掉 Go sidecar
  nsExec::ExecToLog 'taskkill /F /IM "server.exe" /T'
  ; 等待进程完全退出
  Sleep 1000
!macroend
