param([Parameter(Mandatory=$true)][ValidateSet('devices','scan')][string]$Action)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    $manager = New-Object -ComObject WIA.DeviceManager
    if ($Action -eq 'devices') {
        $devices = @()
        foreach ($info in $manager.DeviceInfos) {
            if ($info.Type -eq 1) {
                $name = 'Scanner'
                try { $name = [string]$info.Properties.Item('Name').Value } catch {}
                $devices += @{ id = [string]$info.DeviceID; name = $name }
            }
        }
        @{ devices = $devices } | ConvertTo-Json -Compress -Depth 5
        exit 0
    }
    $info = $null
    foreach ($candidate in $manager.DeviceInfos) {
        if ($candidate.Type -eq 1 -and $candidate.DeviceID -ceq $env:BILTY_SCANNER_DEVICE) { $info = $candidate; break }
    }
    if ($null -eq $info) { throw 'Scanner not found.' }
    $device = $info.Connect()
    $item = $device.Items.Item(1)
    # Prefer a 200 dpi color page when the scanner exposes these WIA properties.
    foreach ($pair in @(@(6147, 200), @(6148, 200), @(6146, 1))) {
        try { $item.Properties.Item($pair[0]).Value = $pair[1] } catch {}
    }
    $sourcePath = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString() + '.bmp')
    $jpegPath = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString() + '.jpg')
    try {
        # WIA scanners commonly supply BMP even when they do not support JPEG transfer.
        $image = $item.Transfer('{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}')
        $image.SaveFile($sourcePath)
        Add-Type -AssemblyName System.Drawing
        $source = [System.Drawing.Image]::FromFile($sourcePath)
        try {
            $rgb = [System.Drawing.Bitmap]::new([int]$source.Width, [int]$source.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
            try {
                $graphics = [System.Drawing.Graphics]::FromImage($rgb)
                try { $graphics.DrawImage($source, 0, 0, $source.Width, $source.Height) } finally { $graphics.Dispose() }
                $rgb.Save($jpegPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
            } finally { $rgb.Dispose() }
        } finally { $source.Dispose() }
        $data = [System.IO.File]::ReadAllBytes($jpegPath)
        if ($data.Length -gt 5242880) { throw 'Scan exceeds 5 MB.' }
        @{ data = [Convert]::ToBase64String($data) } | ConvertTo-Json -Compress
    } finally {
        foreach ($path in @($sourcePath, $jpegPath)) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
    }

} catch {
    [Console]::Error.WriteLine('Scanner operation failed.')
    exit 1
}
