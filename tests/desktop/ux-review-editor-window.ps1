param([int]$AppProcessId, [string]$Executable, [int]$Width, [int]$Height, [string]$WindowTitle)
$ErrorActionPreference = "Stop"
$process = Get-Process -Id $AppProcessId -ErrorAction Stop
if (-not [string]::Equals($process.Path, $Executable, [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected executable" }
$process.Refresh()
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class EditorReviewWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
  private delegate bool Visitor(IntPtr hwnd, IntPtr unused);
  [DllImport("user32.dll")] private static extern bool EnumWindows(Visitor visit, IntPtr unused);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int len);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int len);
  public static IntPtr Find(uint expected, string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr hwnd, IntPtr unused) {
      uint owner; GetWindowThreadProcessId(hwnd,out owner); if(owner != expected) return true;
      var name = new StringBuilder(256); var caption = new StringBuilder(256);
      GetClassName(hwnd,name,name.Capacity); GetWindowText(hwnd,caption,caption.Capacity);
      if(name.ToString() == "Chrome_WidgetWin_1" && (caption.ToString() == title || caption.ToString() == "Life Atlas")) { found = hwnd; return false; }
      return true;
    },IntPtr.Zero);
    return found;
  }
}
'@
$window = [EditorReviewWindow]::Find([uint32]$AppProcessId, $WindowTitle)
if ($window -eq [IntPtr]::Zero) { throw "The isolated process has no matching workspace window" }
[uint32]$owner = 0
[void][EditorReviewWindow]::GetWindowThreadProcessId($window, [ref]$owner)
if ($owner -ne $AppProcessId) { throw "Window ownership changed" }
[void][EditorReviewWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
$scale = [EditorReviewWindow]::GetDpiForWindow($window) / 96.0
[void][EditorReviewWindow]::ShowWindow($window, 9)
if (-not [EditorReviewWindow]::SetWindowPos($window, [IntPtr]::Zero, 0, 0, [int]($Width * $scale), [int]($Height * $scale), 0x16)) { throw "Resize failed" }
$frame = New-Object EditorReviewWindow+Rect
$client = New-Object EditorReviewWindow+Rect
[void][EditorReviewWindow]::GetWindowRect($window, [ref]$frame)
[void][EditorReviewWindow]::GetClientRect($window, [ref]$client)
[PSCustomObject]@{ hwnd = $window.ToInt64(); pid = $AppProcessId; scale = $scale; width = $frame.Right - $frame.Left; height = $frame.Bottom - $frame.Top; clientWidth = $client.Right; clientHeight = $client.Bottom } | ConvertTo-Json -Compress
