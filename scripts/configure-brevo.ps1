param(
    [Parameter(Mandatory = $true)][string]$SmtpUser,
    [switch]$ReplaceExisting
)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$folder = Join-Path $workspace '.secrets'
$target = Join-Path $folder 'smtp_url'
if ([string]::IsNullOrWhiteSpace($SmtpUser) -or $SmtpUser -match '[\r\n\0]') {
    throw 'Provide the Brevo SMTP login, not an API key or sender address'
}
if ((Test-Path -LiteralPath $target) -and -not $ReplaceExisting) {
    throw 'SMTP file exists; use -ReplaceExisting only when intentionally configuring Brevo'
}
New-Item -ItemType Directory -Path $folder -Force | Out-Null
if (-not (Test-Path -LiteralPath $target)) {
    [System.IO.File]::WriteAllText($target, '', [System.Text.UTF8Encoding]::new($false))
}
# Restrict the destination before writing any credential. Existing contents
# are never read; the explicit switch authorizes replacing the SMTP URL only.
if ($env:OS -eq 'Windows_NT') {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = [System.Security.AccessControl.FileSecurity]::new()
    $acl.SetOwner($identity)
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $identity, [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow
    ))
    Set-Acl -LiteralPath $target -AclObject $acl
} else {
    & chmod 600 -- $target
    if ($LASTEXITCODE -ne 0) { throw 'Cannot restrict SMTP file permissions' }
}
$key = Read-Host 'Paste your already-generated Brevo SMTP key (hidden)' -AsSecureString
$pointer = [IntPtr]::Zero
try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($key)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($plain) -or $plain -match '[\r\n\0]') {
        throw 'Invalid SMTP key'
    }
    $login = [Uri]::EscapeDataString($SmtpUser)
    $password = [Uri]::EscapeDataString($plain)
    $url = "smtp://${login}:${password}@smtp-relay.brevo.com:587/?requireTLS=true"
    [System.IO.File]::WriteAllText($target, $url + "`n", [System.Text.UTF8Encoding]::new($false))
} catch {
    throw 'SMTP configuration failed; no credential values are included in diagnostics'
} finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    $plain = $password = $url = $null
    $key.Dispose()
}
Write-Output 'Configured .secrets/smtp_url with mandatory STARTTLS. No email was sent.'
