' SignageCMS v3.11.25 - arret 100 % invisible (double-clic) :
' execute stop-cms.bat sans AUCUNE fenetre, sans confirmation
' et sans message. Tout est journalise dans service.log.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dirWin = fso.GetParentFolderName(WScript.ScriptFullName)
appDir = fso.GetParentFolderName(fso.GetParentFolderName(dirWin))
sh.Environment("PROCESS")("SMCMS_SILENT") = "1"
sh.Run "cmd /c """ & dirWin & "\stop-cms.bat"" >> """ & appDir & "\service.log"" 2>&1", 0, False
