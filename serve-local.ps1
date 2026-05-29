param(
  [int]$Port = 42021
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse("127.0.0.1"), $Port)
$utf8 = [Text.UTF8Encoding]::new($false)

function Get-ContentType {
  param([string]$Path)

  switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8" }
    ".css" { "text/css; charset=utf-8" }
    ".js" { "text/javascript; charset=utf-8" }
    ".mjs" { "text/javascript; charset=utf-8" }
    ".wasm" { "application/wasm" }
    ".txt" { "text/plain; charset=utf-8" }
    default { "application/octet-stream" }
  }
}

function Send-Response {
  param(
    [Net.Sockets.NetworkStream]$Stream,
    [int]$Status,
    [string]$StatusText,
    [string]$ContentType,
    [byte[]]$Body
  )

  $header = "HTTP/1.1 $Status $StatusText`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store, max-age=0`r`nPragma: no-cache`r`nExpires: 0`r`nConnection: close`r`n`r`n"
  $headerBytes = $utf8.GetBytes($header)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
}

$listener.Start()
Write-Host "Serving $root at http://127.0.0.1:$Port/"

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $buffer = New-Object byte[] 4096
      $count = $stream.Read($buffer, 0, $buffer.Length)
      if ($count -le 0) {
        continue
      }

      $request = $utf8.GetString($buffer, 0, $count)
      $firstLine = ($request -split "`r?`n")[0]
      $parts = $firstLine -split " "
      $requestPath = if ($parts.Length -ge 2) { $parts[1] } else { "/" }
      $requestPath = ($requestPath -split "\?")[0].TrimStart("/")
      $requestPath = [Uri]::UnescapeDataString($requestPath)
      if ([string]::IsNullOrWhiteSpace($requestPath)) {
        $requestPath = "index.html"
      }

      $fullPath = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $requestPath))
      if (-not $fullPath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        Send-Response $stream 403 "Forbidden" "text/plain; charset=utf-8" $utf8.GetBytes("Forbidden")
        continue
      }

      if (-not [IO.File]::Exists($fullPath)) {
        Send-Response $stream 404 "Not Found" "text/plain; charset=utf-8" $utf8.GetBytes("Not Found")
        continue
      }

      $bytes = [IO.File]::ReadAllBytes($fullPath)
      Send-Response $stream 200 "OK" (Get-ContentType $fullPath) $bytes
    }
    finally {
      $client.Close()
    }
  }
}
finally {
  $listener.Stop()
}
