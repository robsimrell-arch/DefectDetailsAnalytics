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

# 2. CHECK IF SERVER IS ALREADY ACTIVE (INSTANT 0.1s LAUNCH)
$alreadyRunning = $false
try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect('127.0.0.1', 8080, $null, $null)
    $wait = $iar.AsyncWaitHandle.WaitOne(150, $false)
    if ($wait -and $client.Connected) {
        $client.EndConnect($iar)
        $client.Close()
        $alreadyRunning = $true
    } else {
        $client.Close()
    }
} catch {}

if ($alreadyRunning) {
    Update-SplashStatus "Dashboard ready! Opening browser..."
    Start-Sleep -Milliseconds 150
    Start-Process "http://127.0.0.1:8080"
    Start-Sleep -Milliseconds 200
    Close-Splash
    exit 0
}

# 3. START LOCAL PYTHON BACKEND SERVER DIRECTLY
Update-SplashStatus "Starting local data engine..."

# Find best python executable
$pythonExe = "pythonw.exe"
if (Test-Path "C:\Python314\pythonw.exe") {
    $pythonExe = "C:\Python314\pythonw.exe"
} elseif (Test-Path "C:\Python314\python.exe") {
    $pythonExe = "C:\Python314\python.exe"
} elseif (Get-Command pythonw -ErrorAction SilentlyContinue) {
    $pythonExe = "pythonw"
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonExe = "python"
}

$serverPy = Join-Path $ShareDir "server.py"
$serverExe = Join-Path $ShareDir "server.exe"

if (Test-Path $serverExe) {
    Start-Process -FilePath $serverExe -WorkingDirectory $ShareDir -WindowStyle Hidden
} elseif (Test-Path $serverPy) {
    Start-Process -FilePath $pythonExe -ArgumentList "-u server.py" -WorkingDirectory $ShareDir -WindowStyle Hidden
}

# 4. FAST POLLING LOOP (50ms intervals)
Update-SplashStatus "Loading defect records..."
$connected = $false

for ($i = 0; $i -lt 120; $i++) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect('127.0.0.1', 8080, $null, $null)
        $wait = $iar.AsyncWaitHandle.WaitOne(80, $false)
        if ($wait -and $client.Connected) {
            $client.EndConnect($iar)
            $client.Close()
            $connected = $true
            break
        }
        $client.Close()
    } catch {}
    
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 50
}

# 5. LAUNCH BROWSER
if ($connected) {
    Update-SplashStatus "Ready! Opening dashboard..."
    Start-Sleep -Milliseconds 100
    Start-Process "http://127.0.0.1:8080"
} else {
    $localIndex = Join-Path $ShareDir "index.html"
    if (Test-Path $localIndex) {
        Start-Process $localIndex
    }
}

Start-Sleep -Milliseconds 250
Close-Splash
