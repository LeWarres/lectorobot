param([Parameter(Mandatory=$true)][long]$WindowHandle)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DesktopWindow {
  public delegate bool EnumProc(IntPtr window, IntPtr state);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string name, string title);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string name, string title);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EnumWindows(EnumProc callback, IntPtr state);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetParent(IntPtr child);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW", SetLastError=true)] public static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongW", SetLastError=true)] public static extern int SetWindowLong(IntPtr window, int index, int value);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
  public static IntPtr GetDesktop() { return FindWindow("Progman", null); }
  public static IntPtr FindShell(IntPtr window) { return FindWindowEx(window, IntPtr.Zero, "SHELLDLL_DefView", null); }
  public static IntPtr FindWorker(IntPtr window) { return FindWindowEx(IntPtr.Zero, window, "WorkerW", null); }
  public static bool Attach(IntPtr window, IntPtr parent) {
    int style = GetWindowLong(window, -16);
    SetWindowLong(window, -16, (style & unchecked((int)0x7fffffff)) | 0x40000000);
    SetParent(window, parent);
    return GetParent(window) == parent;
  }
}
'@
$progman = [DesktopWindow]::GetDesktop()
if ($progman -eq [IntPtr]::Zero) { throw 'No se encontró el escritorio de Windows.' }
$result = [IntPtr]::Zero
[void][DesktopWindow]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$result)
$found = [IntPtr]::Zero
$callback = [DesktopWindow+EnumProc]{ param($window, $state)
  if ([DesktopWindow]::FindShell($window) -ne [IntPtr]::Zero) {
    $script:found = [DesktopWindow]::FindWorker($window)
    return $false
  }
  return $true
}
[void][DesktopWindow]::EnumWindows($callback, [IntPtr]::Zero)
if ($found -eq [IntPtr]::Zero) { throw 'No se encontró la capa de fondo de Windows.' }
if (-not [DesktopWindow]::Attach([IntPtr]$WindowHandle, $found)) { throw 'No se pudo colocar la ventana en el escritorio.' }
