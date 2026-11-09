param(
  [Parameter(Mandatory = $true)][ValidateSet('certificate', 'signature')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$Target,
  [ValidateSet('CurrentUser', 'LocalMachine')][string]$Store = 'CurrentUser'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
if ($Mode -eq 'certificate') {
  if ($Target -notmatch '^[A-F0-9]{40}$') { throw 'Invalid certificate thumbprint' }
  $cert = Get-Item -LiteralPath "Cert:\$Store\My\$Target"
  $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
  try {
    $chain.ChainPolicy.RevocationMode = 'Online'
    $chain.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(20)
    [void]$chain.ChainPolicy.ApplicationPolicy.Add((New-Object System.Security.Cryptography.Oid('1.3.6.1.5.5.7.3.3')))
    $valid = $chain.Build($cert)
    [pscustomobject]@{
      valid = $valid
      hasPrivateKey = $cert.HasPrivateKey
      selfSigned = ($cert.Subject -eq $cert.Issuer)
      thumbprint = $cert.Thumbprint
      publisherName = $cert.GetNameInfo('SimpleName', $false)
      subject = $cert.Subject
      issuer = $cert.Issuer
      notAfter = $cert.NotAfter.ToUniversalTime().ToString('o')
      errors = @($chain.ChainStatus | ForEach-Object { $_.Status.ToString() })
    } | ConvertTo-Json -Compress
  } finally { $chain.Dispose() }
} else {
  $sig = Get-AuthenticodeSignature -LiteralPath $Target
  [pscustomobject]@{
    status = $sig.Status.ToString()
    thumbprint = $(if ($sig.SignerCertificate) { $sig.SignerCertificate.Thumbprint } else { $null })
    publisherName = $(if ($sig.SignerCertificate) { $sig.SignerCertificate.GetNameInfo('SimpleName', $false) } else { $null })
    timestampThumbprint = $(if ($sig.TimeStamperCertificate) { $sig.TimeStamperCertificate.Thumbprint } else { $null })
  } | ConvertTo-Json -Compress
}
