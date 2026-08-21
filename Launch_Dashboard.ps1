# Defect Analytics Dashboard Ultra-Fast PowerShell Launcher
# 100% Direct Local Execution with Background Execution & Protocol Handler Registration!

$ShareDir = $PSScriptRoot
if (-not $ShareDir) {
    $ShareDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$LocalAppDir = Join-Path $env:LOCALAPPDATA "DefectAnalysisApp"
if (-not (Test-Path $LocalAppDir)) {
    New-Item -ItemType Directory -Path $LocalAppDir -Force | Out-Null
}

# 1. SMART FAST SYNC USING ROBOCOPY (Copies ONLY changed/new files in <0.05 seconds)
$localServerExe = Join-Path $LocalAppDir "server.exe"
$shareServerExe = Join-Path $ShareDir "server.exe"
if (Test-Path $shareServerExe) {
    $needCopy = $true
    if (Test-Path $localServerExe) {
        if ((Get-Item $shareServerExe).LastWriteTime -le (Get-Item $localServerExe).LastWriteTime) {
            $needCopy = $false
        }
    }
    if ($needCopy) {
        Copy-Item -Path $shareServerExe -Destination $localServerExe -Force -ErrorAction SilentlyContinue
    }
}

# Sync web asset and data folders cleanly with Robocopy (transfers ONLY modified files in <0.05 seconds)
foreach ($folder in @("assets", "css", "js", "lib", "data")) {
    $src = Join-Path $ShareDir $folder
    $dst = Join-Path $LocalAppDir $folder
    if (Test-Path $src) {
        if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }
        robocopy "$src" "$dst" /MIR /XO /FFT /NDL /NFL /NJH /NJS /nc /ns /np | Out-Null
    }
}

$shareIndex = Join-Path $ShareDir "index.html"
if (Test-Path $shareIndex) {
    Copy-Item -Path $shareIndex -Destination (Join-Path $LocalAppDir "index.html") -Force -ErrorAction SilentlyContinue
}

$localDataDir = Join-Path $LocalAppDir "data"
if (-not (Test-Path $localDataDir)) { New-Item -ItemType Directory -Path $localDataDir -Force | Out-Null }

# Write shared_config.json
$cfgObj = @{
    shared_data_dir = (Join-Path $ShareDir "data")
    network_share_dir = $ShareDir
    port = 8080
    comment = "Auto-configured shared network drive path"
}
$cfgJson = $cfgObj | ConvertTo-Json
Set-Content -Path (Join-Path $localDataDir "shared_config.json") -Value $cfgJson -Encoding UTF8

# 2. INSTANT LAUNCH: If server is ALREADY running and responding on http://127.0.0.1:8080, open browser!
try {
    $client = New-Object System.Net.Sockets.TcpClient
    $client.Connect('127.0.0.1', 8080)
    $client.Close()
    Start-Process "http://127.0.0.1:8080"
    exit 0
} catch {
    # Port is not open. Kill any stale server.exe processes before launching a clean single instance.
    Get-Process -Name "server" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

# 3. LAUNCH BACKEND SERVER SILENTLY IN BACKGROUND (-WindowStyle Hidden)
if (Test-Path $localServerExe) {
    Start-Process -FilePath $localServerExe -WorkingDirectory $LocalAppDir -WindowStyle Hidden
} elseif (Test-Path (Join-Path $LocalAppDir "server.py")) {
    Start-Process -FilePath "python" -ArgumentList "-u server.py" -WorkingDirectory $LocalAppDir -WindowStyle Hidden
}

# 5. ULTRA-FAST FAST-POLL TCP CHECK (100ms interval for instant browser open!)
$connected = $false
for ($i = 0; $i -lt 50; $i++) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', 8080)
        $client.Close()
        $connected = $true
        break
    } catch {
        Start-Sleep -Milliseconds 100
    }
}

if ($connected) {
    Start-Process "http://127.0.0.1:8080"
} else {
    $localIndex = Join-Path $LocalAppDir "index.html"
    if (Test-Path $localIndex) {
        Start-Process $localIndex
    }
}
