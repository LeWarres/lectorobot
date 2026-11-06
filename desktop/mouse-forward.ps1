param([long]$WindowHandle)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DesktopMouse {
  [StructLayout(LayoutKind.Sequential)] struct Point { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] struct Mouse { public Point point; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr hwnd; public uint id; public IntPtr w, l; public uint time; public Point point; }
  delegate IntPtr Hook(int code, IntPtr message, IntPtr data);
  delegate bool Child(IntPtr window, IntPtr state);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int id, Hook callback, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder value, int length);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Child callback, IntPtr state);
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr window, ref Point point);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  static IntPtr target, hook; static Hook callback = OnMouse; static bool down;
  static string Class(IntPtr window) { var value = new StringBuilder(256); GetClassName(window, value, value.Capacity); return value.ToString(); }
  static IntPtr OnMouse(int code, IntPtr message, IntPtr data) {
    long kind = message.ToInt64();
    if (code >= 0 && (kind == 0x200 || kind == 0x201 || kind == 0x202)) {
      var mouse = (Mouse)Marshal.PtrToStructure(data, typeof(Mouse));
      Rect rect;
      if (!GetWindowRect(target, out rect) || mouse.point.x < rect.left || mouse.point.x >= rect.right || mouse.point.y < rect.top || mouse.point.y >= rect.bottom) return CallNextHookEx(hook, code, message, data);
      string root = Class(GetAncestor(WindowFromPoint(mouse.point), 2));
      if (root == "Progman" || root == "WorkerW") {
        IntPtr widget = IntPtr.Zero;
        EnumChildWindows(target, (w, s) => { if (Class(w) == "Chrome_RenderWidgetHostHWND") { widget = w; return false; } return true; }, IntPtr.Zero);
        if (widget != IntPtr.Zero) {
          if (kind == 0x201) down = true;
          if (kind == 0x202) down = false;
          var p = mouse.point; ScreenToClient(widget, ref p);
          int packed = (p.x & 0xffff) | ((p.y & 0xffff) << 16);
          PostMessage(widget, (uint)kind, down ? new IntPtr(1) : IntPtr.Zero, new IntPtr(packed));
        }
      }
    }
    return CallNextHookEx(hook, code, message, data);
  }
  public static void Run(IntPtr window) {
    target = window; hook = SetWindowsHookEx(14, callback, IntPtr.Zero, 0);
    if (hook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    Console.WriteLine("READY");
    try { Message m; while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref m); DispatchMessage(ref m); } }
    finally { UnhookWindowsHookEx(hook); }
  }
}
'@
[DesktopMouse]::Run([IntPtr]$WindowHandle)
