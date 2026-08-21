Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
strDir = FSO.GetParentFolderName(WScript.ScriptFullName)
strPS = "powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File " & Chr(34) & strDir & "\Launch_Dashboard.ps1" & Chr(34)
WshShell.Run strPS, 0, False
