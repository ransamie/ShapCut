!macro customInit
  ; Terminate any running ShapCut processes or background workers before installing/updating
  nsExec::Exec 'taskkill /F /IM "ShapCut.exe" /T'
  nsExec::Exec 'taskkill /F /IM "shapcut_api.exe" /T'
  nsExec::Exec 'taskkill /F /IM "ffmpeg.exe" /T'
  nsExec::Exec 'taskkill /F /IM "ffprobe.exe" /T'
  nsExec::Exec 'taskkill /F /IM "Uninstall ShapCut.exe" /T'
  nsExec::Exec 'taskkill /F /IM "uninstaller.exe" /T'
!macroend

!macro customUnInstall
  ; Terminate any running ShapCut processes before uninstalling
  nsExec::Exec 'taskkill /F /IM "ShapCut.exe" /T'
  nsExec::Exec 'taskkill /F /IM "shapcut_api.exe" /T'
  nsExec::Exec 'taskkill /F /IM "ffmpeg.exe" /T'
  nsExec::Exec 'taskkill /F /IM "ffprobe.exe" /T'
!macroend
