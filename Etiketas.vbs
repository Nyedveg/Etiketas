' Etiketas -- windowless launcher.
' Starts the local server with pythonw.exe so no console window appears.
' etiketas.py itself takes over the port from any older instance, so it is
' always safe to just run this again -- the newest launch wins.

Dim sh, fso, here
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here

On Error Resume Next
sh.Run "pythonw.exe """ & here & "\etiketas.py""", 0, False
If Err.Number <> 0 Then
    Err.Clear
    sh.Run "pyw.exe """ & here & "\etiketas.py""", 0, False
End If
