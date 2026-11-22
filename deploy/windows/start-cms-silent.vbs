' SignageCMS v3.11.25 - demarrage 100 % invisible (double-clic) :
' execute start-cms.bat sans AUCUNE fenetre ni console.
' Les messages du script sont ajoutes a service.log.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dirWin = fso.GetParentFolderName(WScript.ScriptFullName)
appDir = fso.GetParentFolderName(fso.GetParentFolderName(dirWin))
sh.Environment("PROCESS")("SMCMS_SILENT") = "1"
sh.Run "cmd /c """ & dirWin & "\start-cms.bat"" >> """ & appDir & "\service.log"" 2>&1", 0, False
