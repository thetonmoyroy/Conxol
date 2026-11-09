param(
    [Parameter(Mandatory)][System.Net.IPAddress]$Server,
    [System.Management.Automation.PSCredential]$Credential,
    [string]$TcpTarget
)
$ErrorActionPreference = 'Stop'
if ($Server.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'IPv4 required.' }
$tcpArgument = ''
if ($TcpTarget) {
    $endpoint = [System.Net.IPEndPoint]::Parse($TcpTarget)
    if ($endpoint.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or $endpoint.Port -eq 0) { throw 'TCP target must be IPv4:port.' }
    $tcpArgument = " --tcp-target '$endpoint'"
}
if (-not $Credential) { $Credential = Get-Credential -Message 'Temporary PPTP test credentials' }
if ($Credential.UserName.Contains("`n") -or $Credential.UserName.Contains("`r")) { throw 'Invalid username.' }
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$executable = Join-Path $workspace 'target/pptp-native-build/debug/conxol-pptp-native-probe.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Build the development probe first; see docs/testing/pptp-native.md.' }
$runId = [Guid]::NewGuid().ToString('N')
$pipeName = "conxol-pptp-$runId"
$logPath = Join-Path $workspace "target/pptp-native-live-$runId.log"

# Explicit DACL: only this Windows user may read credentials, including an
# elevated process for the same user. No credentials enter child command lines.
$security = [System.IO.Pipes.PipeSecurity]::new()
$security.SetAccessRuleProtection($true, $false)
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$rule = [System.IO.Pipes.PipeAccessRule]::new($identity, [System.IO.Pipes.PipeAccessRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
$security.AddAccessRule($rule)
$pipe = [System.IO.Pipes.NamedPipeServerStreamAcl]::Create($pipeName, [System.IO.Pipes.PipeDirection]::Out, 1, [System.IO.Pipes.PipeTransmissionMode]::Byte, [System.IO.Pipes.PipeOptions]::Asynchronous, 4096, 4096, $security, [System.IO.HandleInheritability]::None, [System.IO.Pipes.PipeAccessRights]0)
$passwordPointer = [IntPtr]::Zero
$passwordChars = $null
$passwordBytes = $null
try {
    $connection = $pipe.WaitForConnectionAsync()
    # Quote literal paths for the elevated shell; none of these values are secrets.
    $quotedExe = $executable.Replace("'", "''")
    $quotedLog = $logPath.Replace("'", "''")
    $command = "& '$quotedExe' --server '$Server' --credential-pipe '$pipeName'$tcpArgument *> '$quotedLog'; exit `$LASTEXITCODE"
    $shell = (Get-Process -Id $PID).Path
    $child = Start-Process -FilePath $shell -Verb RunAs -ArgumentList '-NoProfile', '-Command', $command -WindowStyle Hidden -PassThru
    if (-not $connection.Wait(20000)) { throw 'Elevated probe did not connect to credential pipe within 20 seconds.' }
    $connection.GetAwaiter().GetResult()
    $usernameBytes = [System.Text.Encoding]::UTF8.GetBytes($Credential.UserName + "`n")
    $pipe.Write($usernameBytes, 0, $usernameBytes.Length)
    $passwordPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Credential.Password)
    $passwordChars = [char[]]::new($Credential.Password.Length)
    [System.Runtime.InteropServices.Marshal]::Copy($passwordPointer, $passwordChars, 0, $passwordChars.Length)
    $passwordBytes = [System.Text.Encoding]::UTF8.GetBytes($passwordChars)
    $pipe.Write($passwordBytes, 0, $passwordBytes.Length)
    $pipe.Flush()
} finally {
    if ($passwordBytes) { [Array]::Clear($passwordBytes, 0, $passwordBytes.Length) }
    if ($passwordChars) { [Array]::Clear($passwordChars, 0, $passwordChars.Length) }
    if ($passwordPointer -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($passwordPointer) }
    $pipe.Dispose()
}
while (-not $child.WaitForExit(1000)) {
    if ($child.StartTime -lt (Get-Date).AddSeconds(-90)) { throw 'Probe exceeded its expected deadline; inspect the elevated process.' }
}
Write-Output "Elevated probe exit code: $($child.ExitCode)"
Write-Output "Sanitized result: $logPath"
if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath }
if ($child.ExitCode -ne 0) { throw 'Native PPTP probe did not complete encrypted traffic verification. See the stage results above.' }
