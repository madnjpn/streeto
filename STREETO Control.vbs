Option Explicit

' Launch STREETO Control without a command prompt window.
Dim shell, fso, root, script
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
script = root & "\STREETO-Control.ps1"

If Not fso.FileExists(script) Then
  MsgBox "STREETO-Control.ps1 was not found next to this shortcut.", 16, "STREETO Control"
  WScript.Quit 1
End If

shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File """ & script & """", 0, False
