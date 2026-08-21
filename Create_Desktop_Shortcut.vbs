Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
strDir = FSO.GetParentFolderName(WScript.ScriptFullName)
strDesktop = WshShell.SpecialFolders("Desktop")
strLnk = strDesktop & "\Defect Analytics Dashboard.lnk"
strLocalApp = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\DefectAnalysisApp"
strLocalAssets = strLocalApp & "\assets"
strLocalIcon = strLocalAssets & "\app_icon.ico"
strShareIcon = strDir & "\assets\app_icon.ico"

If FSO.FileExists(strShareIcon) Then
    If Not FSO.FolderExists(strLocalApp) Then FSO.CreateFolder(strLocalApp)
    If Not FSO.FolderExists(strLocalAssets) Then FSO.CreateFolder(strLocalAssets)
    FSO.CopyFile strShareIcon, strLocalIcon, True
End If

Set shortcut = WshShell.CreateShortcut(strLnk)
shortcut.TargetPath = "wscript.exe"
shortcut.Arguments = Chr(34) & strDir & "\Launch_Dashboard.vbs" & Chr(34)
shortcut.WorkingDirectory = strDir
If FSO.FileExists(strLocalIcon) Then
    shortcut.IconLocation = strLocalIcon & ",0"
Else
    shortcut.IconLocation = strShareIcon & ",0"
End If
shortcut.Description = "Defect Details Analytics Dashboard"
shortcut.Save

MsgBox "Shortcut successfully created on your Desktop!" & vbCrLf & vbCrLf & "You can now launch the Defect Analytics Dashboard directly from your Desktop anytime.", vbInformation, "Defect Analytics Dashboard"
