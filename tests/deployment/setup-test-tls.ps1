# Generates short-lived synthetic material under ignored .artifacts only.
$ErrorActionPreference = 'Stop'
$opensslCommand = Get-Command openssl -ErrorAction SilentlyContinue
$openssl = if ($opensslCommand) { $opensslCommand.Source } else { 'C:/Program Files/Git/usr/bin/openssl.exe' }
if (-not (Test-Path -LiteralPath $openssl)) { throw 'OpenSSL is required; no dependency is installed by this script' }
$root = (Resolve-Path "$PSScriptRoot/../..").Path
$target = Join-Path $root '.artifacts/railway/pki'
if (Test-Path -LiteralPath $target) { throw 'Synthetic PKI already exists; existing material is never replaced' }
New-Item -ItemType Directory -Path $target -Force | Out-Null
if ($env:OS -eq 'Windows_NT') {
    & icacls $target /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
} else {
    & chmod 700 $target
}
# Windows PowerShell reports OpenSSL progress on stderr as NativeCommandError.
# Exit codes below, rather than progress output, determine command failure.
$ErrorActionPreference = 'Continue'
& $openssl req -x509 -newkey rsa:2048 -nodes -keyout "$target/ca.key" -out "$target/ca.crt" -days 2 -subj '/CN=Synthetic Railway Test CA' -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Synthetic CA creation failed' }
& $openssl req -newkey rsa:2048 -nodes -keyout "$target/server.key" -out "$target/server.csr" -subj '/CN=forecast.railway.internal' 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Synthetic CSR creation failed' }
$ErrorActionPreference = 'Stop'
@'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:forecast.railway.internal
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid:always
'@ | Set-Content -LiteralPath "$target/server.ext" -Encoding ascii
$ErrorActionPreference = 'Continue'
& $openssl x509 -req -in "$target/server.csr" -CA "$target/ca.crt" -CAkey "$target/ca.key" -CAcreateserial -out "$target/server.crt" -days 2 -extfile "$target/server.ext" 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Synthetic signing failed' }
if ($env:OS -ne 'Windows_NT') {
    # Keep CA key operator-only; the nonroot test container can read its leaf.
    & chmod 600 "$target/ca.key"
    & chmod 644 "$target/ca.crt" "$target/server.crt" "$target/server.key"
}
Write-Output 'Synthetic PKI created; never use these short-lived files for deployment'
