# Defect Analytics Dashboard Ultra-Fast Launcher with Visual Splash Indicator
# Direct Local In-Place Execution with Animated Loading Window & Wait Cursor

$ShareDir = $PSScriptRoot
if (-not $ShareDir) {
    $ShareDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

# 1. SHOW BEAUTIFUL ANIMATED SPLASH SCREEN INSTANTLY (<0.05s)
Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue

$window = $null
$statusText = $null

try {
    $xamlString = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Benchmark Defect Analytics" Height="210" Width="430"
        WindowStartupLocation="CenterScreen" WindowStyle="None" AllowsTransparency="True" Background="Transparent" Topmost="True" ShowInTaskbar="True">
    <Border Background="#0f172a" CornerRadius="16" BorderBrush="#0284c7" BorderThickness="1.5">
        <Border.Effect>
            <DropShadowEffect BlurRadius="25" ShadowDepth="8" Direction="270" Color="#000000" Opacity="0.65"/>
        </Border.Effect>
        <Grid Margin="22">
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="*"/>
                <RowDefinition Height="Auto"/>
            </Grid.RowDefinitions>
            
            <!-- App Title Header -->
            <StackPanel Grid.Row="0" Orientation="Horizontal" HorizontalAlignment="Center" Margin="0,0,0,5">
                <TextBlock Text="Benchmark" Foreground="#38bdf8" FontSize="18" FontWeight="ExtraBold" FontFamily="Segoe UI" Margin="0,0,6,0"/>
                <TextBlock Text="Defect Analytics" Foreground="#ffffff" FontSize="18" FontWeight="Bold" FontFamily="Segoe UI"/>
            </StackPanel>
            
            <TextBlock Grid.Row="1" Text="Interactive Customer &amp; Part Drill-Down System" Foreground="#94a3b8" FontSize="11" FontWeight="Medium" HorizontalAlignment="Center" Margin="0,0,0,16"/>
            
            <!-- Animated Loading Progress Bar -->
            <StackPanel Grid.Row="2" VerticalAlignment="Center" Margin="12,0,12,0">
                <ProgressBar Name="LaunchProgressBar" IsIndeterminate="True" Height="4" Foreground="#38bdf8" Background="#1e293b" BorderThickness="0"/>
            </StackPanel>
            
            <!-- Status Text -->
            <TextBlock Grid.Row="3" Name="StatusText" Text="Starting application..." Foreground="#64748b" FontSize="11" HorizontalAlignment="Center" Margin="0,8,0,0"/>
        </Grid>
    </Border>
</Window>
"@

    $stringReader = New-Object System.IO.StringReader($xamlString)
    $xmlReader = [System.Xml.XmlReader]::Create($stringReader)
    $window = [System.Windows.Markup.XamlReader]::Load($xmlReader)
    $statusText = $window.FindName("StatusText")

    $window.Show()
    [System.Windows.Forms.Cursor]::Current = [System.Windows.Forms.Cursors]::WaitCursor
    [System.Windows.Forms.Application]::DoEvents()
} catch {}

function Update-SplashStatus($text) {
    if ($statusText) {
        $statusText.Text = $text
        [System.Windows.Forms.Cursor]::Current = [System.Windows.Forms.Cursors]::WaitCursor
        [System.Windows.Forms.Application]::DoEvents()
    }
}

function Close-Splash() {
    if ($window) {
        [System.Windows.Forms.Cursor]::Current = [System.Windows.Forms.Cursors]::Default
        $window.Close()
    }
}

# 2. KILL ANY PREVIOUS SERVER PROCESSES BEFORE COPYING OR LAUNCHING (ENSURES LATEST EXECUTABLE & SYNC CONFIG)
try {
    Get-Process -Name "server" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
} catch {}

# 3. PREPARE EXECUTION ENVIRONMENT
Update-SplashStatus "Starting local data engine..."

$isNetworkShare = $false
if ($ShareDir.StartsWith('\\')) {
    $isNetworkShare = $true
} else {
    try {
        $driveLetter = $ShareDir.Substring(0, 1)
        $psDrive = Get-PSDrive -Name $driveLetter -ErrorAction SilentlyContinue
        if ($psDrive -and $psDrive.DisplayRoot) {
            $isNetworkShare = $true
        }
    } catch {}
}

$LocalAppDir = Join-Path $env:LOCALAPPDATA "DefectAnalysisApp"
$targetDir = $ShareDir
$targetExe = Join-Path $ShareDir "server.exe"

if ($isNetworkShare) {
    Update-SplashStatus "Syncing local launcher..."
    try {
        if (-not (Test-Path $LocalAppDir)) {
            New-Item -ItemType Directory -Path $LocalAppDir -Force | Out-Null
        }

        $localServerExe = Join-Path $LocalAppDir "server.exe"
        $shareServerExe = Join-Path $ShareDir "server.exe"

        if (Test-Path $shareServerExe) {
            if (-not (Test-Path $localServerExe) -or ((Get-Item $shareServerExe).LastWriteTime -gt (Get-Item $localServerExe).LastWriteTime)) {
                Copy-Item -Path $shareServerExe -Destination $localServerExe -Force -ErrorAction SilentlyContinue
            }
        }

        # Sync web asset folders and internal binaries quickly (R:1 / W:1 prevents any indefinite retry hangs)
        foreach ($folder in @("assets", "css", "js", "lib", "_internal")) {
            $src = Join-Path $ShareDir $folder
            $dst = Join-Path $LocalAppDir $folder
            if (Test-Path $src) {
                if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }
                robocopy "$src" "$dst" /XO /FFT /NDL /NFL /NJH /NJS /nc /ns /np /R:1 /W:1 | Out-Null
            }
        }

        $shareIndex = Join-Path $ShareDir "index.html"
        if (Test-Path $shareIndex) {
            Copy-Item -Path $shareIndex -Destination (Join-Path $LocalAppDir "index.html") -Force -ErrorAction SilentlyContinue
        }

        $shareServerPy = Join-Path $ShareDir "server.py"
        if (Test-Path $shareServerPy) {
            Copy-Item -Path $shareServerPy -Destination (Join-Path $LocalAppDir "server.py") -Force -ErrorAction SilentlyContinue
        }

        # Configure shared_data_dir so local server directly uses shared network drive data
        $localDataDir = Join-Path $LocalAppDir "data"
        if (-not (Test-Path $localDataDir)) { New-Item -ItemType Directory -Path $localDataDir -Force | Out-Null }

        $cfgObj = @{
            shared_data_dir = (Join-Path $ShareDir "data")
            network_share_dir = $ShareDir
            port = 8080
            comment = "Auto-configured shared network drive path"
        }
        $cfgJson = $cfgObj | ConvertTo-Json
        Set-Content -Path (Join-Path $localDataDir "shared_config.json") -Value $cfgJson -Encoding UTF8

        $targetDir = $LocalAppDir
        $targetExe = $localServerExe
    } catch {}
}

# 5. START SERVER PROCESS
Update-SplashStatus "Starting local data engine..."

# Find python if server.exe is not available
$pythonExe = "python.exe"
if (Test-Path "C:\Python314\pythonw.exe") {
    $pythonExe = "C:\Python314\pythonw.exe"
} elseif (Test-Path "C:\Python314\python.exe") {
    $pythonExe = "C:\Python314\python.exe"
} elseif (Get-Command pythonw -ErrorAction SilentlyContinue) {
    $pythonExe = "pythonw.exe"
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonExe = "python.exe"
}

if (Test-Path $targetExe) {
    Start-Process -FilePath $targetExe -WorkingDirectory $targetDir -WindowStyle Hidden
} elseif (Test-Path (Join-Path $targetDir "server.py")) {
    Start-Process -FilePath $pythonExe -ArgumentList "-u server.py" -WorkingDirectory $targetDir -WindowStyle Hidden
} elseif (Test-Path (Join-Path $ShareDir "server.exe")) {
    Start-Process -FilePath (Join-Path $ShareDir "server.exe") -WorkingDirectory $ShareDir -WindowStyle Hidden
} elseif (Test-Path (Join-Path $ShareDir "server.py")) {
    Start-Process -FilePath $pythonExe -ArgumentList "-u server.py" -WorkingDirectory $ShareDir -WindowStyle Hidden
}

# 6. FAST POLLING LOOP (100ms intervals)
Update-SplashStatus "Loading defect records..."
$connected = $false

for ($i = 0; $i -lt 80; $i++) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect('127.0.0.1', 8080, $null, $null)
        $wh = $iar.AsyncWaitHandle.WaitOne(150, $false)
        if ($wh -and $client.Connected) {
            $client.EndConnect($iar)
            $client.Close()
            $connected = $true
            break
        }
        $client.Close()
    } catch {}
    
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 100
}

# 7. LAUNCH BROWSER
if ($connected) {
    Update-SplashStatus "Ready! Opening dashboard..."
    Start-Sleep -Milliseconds 100
    Start-Process "http://127.0.0.1:8080"
} else {
    $localIndex = Join-Path $targetDir "index.html"
    if (-not (Test-Path $localIndex)) {
        $localIndex = Join-Path $ShareDir "index.html"
    }
    if (Test-Path $localIndex) {
        Start-Process $localIndex
    }
}

Start-Sleep -Milliseconds 250
Close-Splash
