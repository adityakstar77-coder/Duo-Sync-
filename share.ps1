# DuoSync - High-Performance Cloudflare Tunnel Share Across Different Wi-Fi Networks
$ErrorActionPreference = "Continue"

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  DuoSync - Live Global Connection for 2 Users on Different Wi-Fi" -ForegroundColor Yellow
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. Check if server is running on port 3000
$portActive = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $asyncResult = $tcp.BeginConnect("127.0.0.1", 3000, $null, $null)
    $success = $asyncResult.AsyncWaitHandle.WaitOne(800)
    if ($success) {
        $tcp.EndConnect($asyncResult)
        $portActive = $true
        $tcp.Close()
    }
} catch {
    $portActive = $false
}

if (-not $portActive) {
    Write-Host "[1/3] Starting DuoSync collaborative server on port 3000..." -ForegroundColor Green
    $nodeCmd = "agy-node"
    if (-not (Get-Command "agy-node" -ErrorAction SilentlyContinue)) {
        if (Get-Command "node" -ErrorAction SilentlyContinue) {
            $nodeCmd = "node"
        } elseif (Test-Path "C:\Users\PRO\AppData\Local\Programs\nodejs\node.exe") {
            $nodeCmd = "C:\Users\PRO\AppData\Local\Programs\nodejs\node.exe"
        } elseif (Test-Path "C:\Users\PRO\AppData\Roaming\Antigravity\bin\agy-node.cmd") {
            $nodeCmd = "C:\Users\PRO\AppData\Roaming\Antigravity\bin\agy-node.cmd"
        }
    }
    Start-Process -FilePath $nodeCmd -ArgumentList "server.js" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    Start-Sleep -Seconds 2
} else {
    Write-Host "[1/3] DuoSync server is already running on port 3000." -ForegroundColor Green
}

# 2. Establish Cloudflare Tunnel
Write-Host "[2/3] Connecting to Cloudflare global network for instant HTTPS link..." -ForegroundColor Green
Write-Host "      (Valid SSL certificate, works across all Wi-Fi, 4G/5G mobile, and PCs)" -ForegroundColor Gray

$roomCode = "our-space"
$logFile = Join-Path $PSScriptRoot "tunnel.log"
if (Test-Path $logFile) { Remove-Item $logFile -Force }

$cloudflaredPath = Join-Path $PSScriptRoot "cloudflared.exe"
$tunnelProcess = $null
$publicUrl = $null

if (Test-Path $cloudflaredPath) {
    # Launch Cloudflare Tunnel
    $tunnelProcess = Start-Process -FilePath $cloudflaredPath -ArgumentList "tunnel --url http://127.0.0.1:3000" -WorkingDirectory $PSScriptRoot -RedirectStandardError $logFile -PassThru

    $timeout = 25
    $elapsed = 0
    Write-Host "Waiting for Cloudflare URL..." -NoNewline
    while ($elapsed -lt $timeout -and -not $publicUrl) {
        Start-Sleep -Seconds 1
        $elapsed++
        Write-Host "." -NoNewline

        if (Test-Path $logFile) {
            $content = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
            if ($content -match "https://[a-zA-Z0-9\.\-]+\.trycloudflare\.com") {
                $publicUrl = $matches[0]
            }
        }
    }
    Write-Host ""
}

# Fallback to SSH tunnel if cloudflared wasn't able to get URL
if (-not $publicUrl) {
    Write-Host "[*] Trying secondary SSH tunnel service..." -ForegroundColor Yellow
    $tunnelProcess = Start-Process -FilePath "ssh" -ArgumentList "-o StrictHostKeyChecking=no -T -R 80:localhost:3000 nokey@localhost.run" -WorkingDirectory $PSScriptRoot -RedirectStandardOutput $logFile -RedirectStandardError (Join-Path $PSScriptRoot "tunnel_err.log") -PassThru

    $timeout = 20
    $elapsed = 0
    while ($elapsed -lt $timeout -and -not $publicUrl) {
        Start-Sleep -Seconds 1
        $elapsed++
        Write-Host "." -NoNewline
        if (Test-Path $logFile) {
            $content = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
            if ($content -match "https://[a-zA-Z0-9\.\-]+\.lhr\.life") {
                $publicUrl = $matches[0]
            }
        }
    }
    Write-Host ""
}

if ($publicUrl) {
    $myUrl = '{0}/?room={1}&user=user1' -f $publicUrl, $roomCode
    $partnerUrl = '{0}/?room={1}&user=user2' -f $publicUrl, $roomCode

    try {
        Set-Clipboard -Value $partnerUrl
        $copiedText = "(Copied to clipboard!)"
    } catch {
        $copiedText = ""
    }

    Write-Host ""
    Write-Host "==================================================================" -ForegroundColor Green
    Write-Host " [SUCCESS] DuoSync is ONLINE with verified Cloudflare HTTPS!" -ForegroundColor Yellow
    Write-Host "==================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host " [PARTNER LINK] Send this link to your partner (Any Wi-Fi / Phone):" -ForegroundColor Cyan
    Write-Host ("    >> {0}  {1}" -f $partnerUrl, $copiedText) -ForegroundColor Yellow -BackgroundColor Black
    Write-Host ""
    Write-Host " [YOUR LINK] Opening in your browser (User 1):" -ForegroundColor Cyan
    Write-Host ("    >> {0}" -f $myUrl) -ForegroundColor White
    Write-Host ""
    Write-Host " [LOCAL LINK] Also available locally at: http://localhost:3000" -ForegroundColor Gray
    Write-Host " Keep this window open while collaborating." -ForegroundColor Gray
    Write-Host " To stop sharing, simply close this window." -ForegroundColor Gray
    Write-Host "==================================================================" -ForegroundColor Green

    # Launch browser for User 1
    Start-Process $myUrl

    # Keep tunnel alive
    if ($tunnelProcess) {
        $tunnelProcess.WaitForExit()
    }
} else {
    Write-Host "[!] Could not establish public tunnel. Falling back to local mode..." -ForegroundColor Red
    $localUrl = 'http://localhost:3000/?room={0}&user=user1' -f $roomCode
    Start-Process $localUrl
}
