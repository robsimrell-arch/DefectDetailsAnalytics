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

# 2. CHECK IF SERVER IS ALREADY ACTIVE AND RESPONDING (INSTANT 0.1s LAUNCH)
$alreadyRunning = $false
try {
    $req = [System.Net.WebRequest]::Create('http://127.0.0.1:8080/api/status')
    $req.Timeout = 250
    $resp = $req.GetResponse()
    if ($resp.StatusCode -eq 200) {
        $alreadyRunning = $true
    }
    $resp.Close()
} catch {}

if ($alreadyRunning) {
    Update-SplashStatus "Dashboard ready! Opening browser..."
    Start-Sleep -Milliseconds 100
    Start-Process "http://127.0.0.1:8080"
    Start-Sleep -Milliseconds 150
    Close-Splash
    exit 0
}

# 3. SYNC TO LOCAL C: DRIVE (%LOCALAPPDATA%\DefectAnalysisApp) FOR ULTRA-FAST & SECURE LOCAL EXECUTION
Update-SplashStatus "Syncing local environment..."

$LocalAppDir = Join-Path $env:LOCALAPPDATA "DefectAnalysisApp"
if (-not (Test-Path $LocalAppDir)) {
    New-Item -ItemType Directory -Path $LocalAppDir -Force | Out-Null
}

$localServerExe = Join-Path $LocalAppDir "server.exe"
$shareServerExe = Join-Path $ShareDir "server.exe"

# If running from network share or external folder, sync files locally to bypass UNC network execution limits
if ($ShareDir -ne $LocalAppDir) {
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

    $shareServerPy = Join-Path $ShareDir "server.py"
    if (Test-Path $shareServerPy) {
        Copy-Item -Path $shareServerPy -Destination (Join-Path $LocalAppDir "server.py") -Force -ErrorAction SilentlyContinue
    }

    $localDataDir = Join-Path $LocalAppDir "data"
    if (-not (Test-Path $localDataDir)) { New-Item -ItemType Directory -Path $localDataDir -Force | Out-Null }

    # Write shared_config.json so local server writes annotations to shared drive
    $cfgObj = @{
        shared_data_dir = (Join-Path $ShareDir "data")
        network_share_dir = $ShareDir
        port = 8080
        comment = "Auto-configured shared network drive path"
    }
    $cfgJson = $cfgObj | ConvertTo-Json
    Set-Content -Path (Join-Path $localDataDir "shared_config.json") -Value $cfgJson -Encoding UTF8
}

# 4. KILL ANY STALE UNRESPONSIVE SERVER PROCESSES BEFORE LAUNCH
try {
    Get-Process -Name "server" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
} catch {}

# 5. START LOCAL BACKEND SERVER
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

if (Test-Path $localServerExe) {
    Start-Process -FilePath $localServerExe -WorkingDirectory $LocalAppDir -WindowStyle Hidden
} elseif (Test-Path (Join-Path $LocalAppDir "server.py")) {
    Start-Process -FilePath $pythonExe -ArgumentList "-u server.py" -WorkingDirectory $LocalAppDir -WindowStyle Hidden
} elseif (Test-Path $shareServerExe) {
    Start-Process -FilePath $shareServerExe -WorkingDirectory $ShareDir -WindowStyle Hidden
} elseif (Test-Path (Join-Path $ShareDir "server.py")) {
    Start-Process -FilePath $pythonExe -ArgumentList "-u server.py" -WorkingDirectory $ShareDir -WindowStyle Hidden
}

# 6. FAST POLLING LOOP (50ms intervals)
Update-SplashStatus "Loading defect records..."
$connected = $false

for ($i = 0; $i -lt 100; $i++) {
    try {
        $req = [System.Net.WebRequest]::Create('http://127.0.0.1:8080/api/status')
        $req.Timeout = 150
        $resp = $req.GetResponse()
        if ($resp.StatusCode -eq 200) {
            $resp.Close()
            $connected = $true
            break
        }
        $resp.Close()
    } catch {}
    
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 50
}

# 7. LAUNCH BROWSER
if ($connected) {
    Update-SplashStatus "Ready! Opening dashboard..."
    Start-Sleep -Milliseconds 100
    Start-Process "http://127.0.0.1:8080"
} else {
    $localIndex = Join-Path $LocalAppDir "index.html"
    if (-not (Test-Path $localIndex)) {
        $localIndex = Join-Path $ShareDir "index.html"
    }
    if (Test-Path $localIndex) {
        Start-Process $localIndex
    }
}

Start-Sleep -Milliseconds 250
Close-Splash
