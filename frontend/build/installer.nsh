!macro customInit
  nsExec::Exec 'taskkill /F /IM "ShapCut.exe" /T'
  nsExec::Exec 'taskkill /F /IM "shapcut_api.exe" /T'
  nsExec::Exec 'taskkill /F /IM "ffmpeg.exe" /T'
  nsExec::Exec 'taskkill /F /IM "ffprobe.exe" /T'
  nsExec::Exec 'taskkill /F /IM "Uninstall ShapCut.exe" /T'
  nsExec::Exec 'taskkill /F /IM "uninstaller.exe" /T'
!macroend

!macro customUnInstall
  nsExec::Exec 'taskkill /F /IM "ShapCut.exe" /T'
  nsExec::Exec 'taskkill /F /IM "shapcut_api.exe" /T'
  nsExec::Exec 'taskkill /F /IM "ffmpeg.exe" /T'
  nsExec::Exec 'taskkill /F /IM "ffprobe.exe" /T'
!macroend
