Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipPath = "C:\Users\princ\Downloads\1.21.11+Template.zip"
$targetDir = "C:\Users\princ\.gemini\antigravity\scratch\e4all-web\src\public\assets\textures"

if (!(Test-Path -Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)

foreach ($entry in $zip.Entries) {
    if ($entry.FullName -like "*textures/gui/sprites/widget/*" -or `
        $entry.FullName -like "*textures/gui/sprites/container/*" -or `
        $entry.FullName -like "*textures/block/*" -or `
        $entry.FullName -like "*textures/item/*" -or `
        $entry.FullName -eq "pack.png") {
        
        $destName = [System.IO.Path]::GetFileName($entry.FullName)
        if ($destName -ne "" -and $destName.EndsWith(".png")) {
            $dest = Join-Path $targetDir $destName
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
        }
    }
}

$zip.Dispose()
Write-Host "All Minecraft textures extracted successfully."
