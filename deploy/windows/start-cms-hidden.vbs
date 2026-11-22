' ============================================================
'  SignageCMS v3.11.25 - lancement SILENCIEUX du serveur
'  Appel par start-cms.bat : wscript.exe start-cms-hidden.vbs <port> [--check]
'  Le serveur demarre SANS AUCUNE fenetre CMD ni PowerShell et
'  continue de tourner apres la fermeture du terminal.
'  Le pid est ecrit dans server.pid ; le journal dans service.log.
'  Codes de sortie : 0 = lance, 2 = deja actif, 1 = echec.
' ============================================================
Option Explicit
Dim sh, fso, dirWin, appDir, port, logFile, pidFile
Dim wmi, procs, p, f, cmd
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dirWin = fso.GetParentFolderName(WScript.ScriptFullName)
appDir = fso.GetParentFolderName(fso.GetParentFolderName(dirWin))
logFile = appDir & "\service.log"
pidFile = appDir & "\server.pid"
port = "3000"
If WScript.Arguments.Count >= 1 Then
  If Len(WScript.Arguments(0)) > 0 Then port = WScript.Arguments(0)
End If

Sub LogLine(msg)
  Dim tf
  On Error Resume Next
  Set tf = fso.OpenTextFile(logFile, 8, True)
  tf.WriteLine "[" & Now & "] " & msg
  tf.Close
  On Error GoTo 0
End Sub

On Error Resume Next
Set wmi = GetObject("winmgmts:{impersonationLevel=impersonate}!\\.\root\cimv2")
If Err.Number <> 0 Then
  LogLine "ERREUR : WMI indisponible (" & Err.Description & ")"
  WScript.Quit 1
End If
On Error GoTo 0

' ---------- deja actif ? (anti-demarrage multiple) ----------
Set procs = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='node.exe' AND CommandLine LIKE '%standalone%server.js%'")
If procs.Count > 0 Then
  For Each p In procs
    Set f = fso.CreateTextFile(pidFile, True)
    f.WriteLine CStr(p.ProcessId)
    f.Close
    Exit For
  Next
  LogLine "Serveur deja actif - rien a lancer."
  WScript.Quit 2
End If

' ---------- mode verification seule ----------
If WScript.Arguments.Count >= 2 Then
  If WScript.Arguments(1) = "--check" Then WScript.Quit 0
End If

' ---------- lancement invisible ----------
sh.Environment("PROCESS")("PORT") = port
sh.Environment("PROCESS")("NODE_ENV") = "production"
sh.Environment("PROCESS")("HOSTNAME") = "0.0.0.0"
LogLine "Demarrage silencieux : node .next\standalone\server.js, port " & port
cmd = "cmd /c node .next\standalone\server.js >> """ & logFile & """ 2>&1"
On Error Resume Next
sh.Run cmd, 0, False
If Err.Number <> 0 Then
  LogLine "ERREUR : lancement impossible (" & Err.Description & ")"
  WScript.Quit 1
End If
On Error GoTo 0

' ---------- memoriser le pid ----------
WScript.Sleep 2500
Set procs = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='node.exe' AND CommandLine LIKE '%standalone%server.js%'")
If procs.Count = 0 Then
  LogLine "ERREUR : le serveur ne s est pas lance - verifier le journal ci-dessus."
  WScript.Quit 1
End If
For Each p In procs
  Set f = fso.CreateTextFile(pidFile, True)
  f.WriteLine CStr(p.ProcessId)
  f.Close
  LogLine "Serveur demarre : pid " & p.ProcessId & ", port " & port
  Exit For
Next
WScript.Quit 0
