$code = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class User32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue

$hwnd = [User32]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[User32]::GetWindowText($hwnd, $sb, 512) | Out-Null
$targetProcId = 0
[User32]::GetWindowThreadProcessId($hwnd, [ref]$targetProcId) | Out-Null
$proc = Get-Process -Id $targetProcId -ErrorAction SilentlyContinue

[PSCustomObject]@{
    ProcessName = if ($proc) { $proc.ProcessName } else { "Unknown" }
    WindowTitle = $sb.ToString()
} | ConvertTo-Json -Compress
