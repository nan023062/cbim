param(
  [int]$TargetProcessId,
  [string]$ExpectedPath,
  [int]$TimeoutMilliseconds = 60000
)

# Acceptance-only observation: never close windows or terminate the observed process.
# A process may exit after enumeration; an empty Path does not prove PID reuse.
function Wait-DesktopProcessExit {
  param(
    [System.Diagnostics.Process]$Process,
    [string]$ExpectedPath,
    [int]$TimeoutMilliseconds
  )
  if (-not $Process -or $Process.HasExited) { return }
  $actualPath = $Process.Path
  if ($Process.HasExited) { return }
  if ($actualPath -ne $ExpectedPath) {
    throw "Desktop PID identity changed: expected=$ExpectedPath actual=$actualPath"
  }
  if (-not $Process.WaitForExit($TimeoutMilliseconds)) { throw 'Desktop native exit timed out' }
}

# Dot-sourcing only defines the function, allowing a real captured-process race test.
if ($TargetProcessId -gt 0) {
  $ErrorActionPreference = 'Stop'
  $observed = Get-Process -ErrorAction Stop | Where-Object Id -eq $TargetProcessId
  Wait-DesktopProcessExit -Process $observed -ExpectedPath $ExpectedPath -TimeoutMilliseconds $TimeoutMilliseconds
}
