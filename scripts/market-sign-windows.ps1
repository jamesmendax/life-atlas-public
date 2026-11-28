[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string] $SigningDirectory,
  [string] $OutputDirectory,
  [string] $PriorDirectory,
  [string] $PreserveTrustedKeys,
  [string] $Only,
  [switch] $Initialize
)

$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw '此脚本需要 Windows。' }
if (!([IO.Path]::IsPathRooted($SigningDirectory) -and ($SigningDirectory -match '^[A-Za-z]:\\'))) { throw '签名目录必须为绝对路径。' }
$directory = [IO.Path]::GetFullPath($SigningDirectory)
$sourceDirectory = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd([char]92)
if ($directory.TrimEnd([char]92).Equals($sourceDirectory, [StringComparison]::OrdinalIgnoreCase) -or
    $directory.StartsWith($sourceDirectory + [char]92, [StringComparison]::OrdinalIgnoreCase)) {
  throw '请在源码目录之外保管市集签名密钥。'
}
$parent = Split-Path -Parent $directory
if (!$parent -or !(Test-Path -LiteralPath $parent -PathType Container)) { throw '请指定现有物理父目录下的签名目录。' }
for ($part = $parent; $null -ne $part; $part = [IO.Path]::GetDirectoryName($part)) {
  if ((Get-Item -LiteralPath $part -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '签名目录不得经过重解析点。' }
}
if (!(Test-Path -LiteralPath $directory) -and $Initialize) { New-Item -ItemType Directory -Path $directory | Out-Null }
$resolved = Get-Item -LiteralPath $directory -Force
if (!$resolved.PSIsContainer -or ($resolved.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '签名目录不安全。' }
$keyFile = Join-Path $directory 'market-signing-ed25519.dpapi'
$script = Join-Path $PSScriptRoot 'market-build.mjs'
try { Add-Type -AssemblyName System.Security.Cryptography.ProtectedData -ErrorAction Stop } catch { Add-Type -AssemblyName System.Security }
$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
$plain = $null
$pem = $null
try {
  if ($Initialize) {
    if (Test-Path -LiteralPath $keyFile) { throw '签名密钥已经存在。请去掉 -Initialize，继续使用现有密钥。' }
    $text = @(& node -e "const { generateKeyPairSync } = require('node:crypto'); process.stdout.write(generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'}))")
    if ($LASTEXITCODE -ne 0) { throw '生成 Ed25519 签名密钥失败。' }
    $plain = [Text.Encoding]::UTF8.GetBytes(($text -join "`n") + "`n")
    $text = $null
    $encrypted = [Security.Cryptography.ProtectedData]::Protect($plain, $null, $scope)
    $stream = [IO.File]::Open($keyFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($encrypted, 0, $encrypted.Length); $stream.Flush($true) } finally { $stream.Dispose() }
  } else {
    $entry = Get-Item -LiteralPath $keyFile -Force
    if ($entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $entry.Length -gt 8192) { throw '签名密钥文件无效。' }
    $plain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($keyFile), $null, $scope)
  }
  $pem = [Text.Encoding]::UTF8.GetString($plain)
  $arguments = @($script, '--key-stdin')
  if ($OutputDirectory) { $arguments += @('--output', $OutputDirectory) }
  if ($PriorDirectory) { $arguments += @('--prior', $PriorDirectory) }
  if ($PreserveTrustedKeys) { $arguments += @('--preserve-trusted-keys', $PreserveTrustedKeys) }
  if ($Only) { $arguments += @('--only', $Only) }
  $pem | & node @arguments
  if ($LASTEXITCODE -ne 0) { throw '市集构建失败，签名密钥已保留。' }
} finally {
  if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
  $pem = $null
}
