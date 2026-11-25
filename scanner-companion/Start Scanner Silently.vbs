Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
launcher = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "Start Scanner.bat")
shell.Run Chr(34) & launcher & Chr(34), 0, False
