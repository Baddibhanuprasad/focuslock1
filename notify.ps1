param(
    [string]$Title = "Focus Mode Alert 🚨",
    [string]$Message = "YouTube Shorts / Music detected! Return to your focus goal."
)

try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    $n = New-Object System.Windows.Forms.NotifyIcon
    $n.Icon = [System.Drawing.SystemIcons]::Warning
    $n.Visible = $true
    $n.ShowBalloonTip(5000, $Title, $Message, [System.Windows.Forms.ToolTipIcon]::Warning)
} catch {
    # Fallback
}
