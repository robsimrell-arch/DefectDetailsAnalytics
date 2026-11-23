param(
    [string]$ShareDir = "\\bench.com\cuidata\HSV\TestEng\CUSTOMER_FVT\DefectAnalysis"
)

$ErrorActionPreference = "Stop"

$WsDir = $PSScriptRoot
if (-not $WsDir) {
    $WsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

Write-Host "Deploying application code from $WsDir"
Write-Host "Target network share: $ShareDir"

if (-not (Test-Path $ShareDir)) {
    Write-Error "Network share is not reachable: $ShareDir"
    exit 1
}

Write-Host "Safety check: $ShareDir\data will NOT be touched or overwritten."

foreach ($folder in @("assets", "backend", "css", "js", "lib")) {
    $src = Join-Path $WsDir $folder
    $dst = Join-Path $ShareDir $folder
    if (Test-Path $src) {
        if (-not (Test-Path $dst)) {
            New-Item -ItemType Directory -Path $dst -Force | Out-Null
        }
        Write-Host "Syncing $folder\ ..."
        robocopy "$src" "$dst" /E /XD __pycache__ /XF *.pyc /FFT /NDL /NFL /NJH /NJS /nc /ns /np /R:2 /W:1 | Out-Null
        $rc = $LASTEXITCODE
        if ($rc -ge 8) {
            Write-Error "Robocopy failed for $folder with exit code $rc"
            exit $rc
        }
    }
}
$global:LASTEXITCODE = 0

$rootFiles = @(
    "index.html",
    "server.py",
    "version.txt",
    "Launch_Dashboard.ps1",
    "Launch_Dashboard.vbs",
    "Install_Local_Desktop_App.cmd",
    "Create_Desktop_Shortcut.vbs"
)
foreach ($rf in $rootFiles) {
    $srcFile = Join-Path $WsDir $rf
    $dstFile = Join-Path $ShareDir $rf
    if (-not (Test-Path $srcFile)) {
        Write-Error "Missing workspace file: $srcFile"
        exit 1
    }
    Write-Host "Copying $rf ..."
    Copy-Item -Path $srcFile -Destination $dstFile -Force
}

$verifyFiles = @(
    "index.html",
    "server.py",
    "version.txt",
    "Launch_Dashboard.ps1",
    "backend\config.py",
    "backend\handlers.py",
    "backend\pfs_client.py",
    "css\styles.css",
    "js\mainPanel.js",
    "js\modules\ui\pfsRouteDrawer.js",
    "js\modules\ui\recordsTable.js",
    "js\modules\ui\annotationModal.js"
)

Write-Host "Verifying SHA-256 checksums on network share..."
foreach ($vf in $verifyFiles) {
    $wsPath = Join-Path $WsDir $vf
    $shPath = Join-Path $ShareDir $vf
    if (-not (Test-Path $shPath)) {
        Write-Error "Verification failed: missing deployed file $shPath"
        exit 1
    }
    $wsHash = (Get-FileHash -Path $wsPath -Algorithm SHA256).Hash
    $shHash = (Get-FileHash -Path $shPath -Algorithm SHA256).Hash
    if ($wsHash -ne $shHash) {
        Write-Error "SHA-256 mismatch for $vf (WS=$wsHash, Share=$shHash)"
        exit 1
    }
    Write-Host "  OK  $vf"
}

Write-Host "Deployment and verification completed successfully."
