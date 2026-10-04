Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$pluginRoot = Join-Path $repoRoot 'plugin'
$manifestPath = Join-Path $pluginRoot 'smartcrop.xml'
$buildRoot = Join-Path $repoRoot 'build'
$stageRoot = Join-Path $buildRoot 'stage'
$outputRoot = Join-Path $buildRoot 'output'
$packagePrefix = 'plg_content_smartcrop'

function Ensure-CleanDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    if (Test-Path $Path) {
        Remove-Item -Path $Path -Recurse -Force
    }

    New-Item -ItemType Directory -Path $Path | Out-Null
}

function New-ZipFromDirectoryContents {
    param(
        [Parameter(Mandatory = $true)]
        [string] $SourceDirectory,

        [Parameter(Mandatory = $true)]
        [string] $DestinationZip
    )

    if (Test-Path $DestinationZip) {
        Remove-Item -Path $DestinationZip -Force
    }

    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if ($null -ne $pythonCmd) {
        $pyScript = @"
import os, sys, zipfile

source_dir = os.path.abspath(sys.argv[1])
dest_zip = os.path.abspath(sys.argv[2])

with zipfile.ZipFile(dest_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for root, dirs, files in os.walk(source_dir):
        dirs.sort()
        files.sort()
        for d in dirs:
            full_dir = os.path.join(root, d)
            rel_dir = os.path.relpath(full_dir, source_dir).replace('\\', '/') + '/'
            zinfo = zipfile.ZipInfo(rel_dir)
            zinfo.create_system = 3  # UNIX
            zinfo.external_attr = (0o755 << 16) | 0o040000
            zf.writestr(zinfo, '')
        for f in files:
            full_file = os.path.join(root, f)
            rel_file = os.path.relpath(full_file, source_dir).replace('\\', '/')
            zinfo = zipfile.ZipInfo(rel_file)
            zinfo.create_system = 3  # UNIX
            zinfo.external_attr = (0o644 << 16) | 0o100000
            with open(full_file, 'rb') as fp:
                zf.writestr(zinfo, fp.read(), compress_type=zipfile.ZIP_DEFLATED)
"@
        $tempPy = [System.IO.Path]::GetTempFileName() + ".py"
        try {
            [System.IO.File]::WriteAllText($tempPy, $pyScript, [System.Text.Encoding]::UTF8)
            & python $tempPy $SourceDirectory $DestinationZip
            if ($LASTEXITCODE -ne 0) {
                throw "Python zip packaging failed with exit code $LASTEXITCODE"
            }
        }
        finally {
            if (Test-Path $tempPy) { Remove-Item -Path $tempPy -Force }
        }
        return
    }

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $destinationStream = [System.IO.File]::Open($DestinationZip, [System.IO.FileMode]::Create)

    try {
        $archive = New-Object System.IO.Compression.ZipArchive(
            $destinationStream,
            [System.IO.Compression.ZipArchiveMode]::Create,
            $false
        )

        try {
            $rootPath = [System.IO.Path]::GetFullPath($SourceDirectory).TrimEnd('\', '/')

            Get-ChildItem -Path $SourceDirectory -Recurse -Directory | ForEach-Object {
                $dirPath = [System.IO.Path]::GetFullPath($_.FullName)
                $relDir = $dirPath.Substring($rootPath.Length).TrimStart('\', '/').Replace('\', '/')
                if (-not [string]::IsNullOrEmpty($relDir)) {
                    $archive.CreateEntry($relDir + '/') | Out-Null
                }
            }

            Get-ChildItem -Path $SourceDirectory -Recurse -File | ForEach-Object {
                $filePath = [System.IO.Path]::GetFullPath($_.FullName)
                $entryPath = $filePath.Substring($rootPath.Length).TrimStart('\', '/').Replace('\', '/')
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $archive,
                    $filePath,
                    $entryPath,
                    [System.IO.Compression.CompressionLevel]::Optimal
                ) | Out-Null
            }
        }
        finally {
            $archive.Dispose()
        }
    }
    finally {
        $destinationStream.Dispose()
    }
}

function Get-ManifestVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string] $ManifestPath
    )

    if (-not (Test-Path $ManifestPath)) {
        throw "Manifest not found: $ManifestPath"
    }

    [xml]$manifest = Get-Content $ManifestPath -Raw
    $versionNode = $manifest.SelectSingleNode('/extension/version')
    $version = if ($null -ne $versionNode) { $versionNode.InnerText.Trim() } else { '' }

    if ([string]::IsNullOrWhiteSpace($version)) {
        throw "Version element not found in $ManifestPath"
    }

    return $version
}

function Assert-ZipContainsRootEntry {
    param(
        [Parameter(Mandatory = $true)]
        [string] $ZipPath,

        [Parameter(Mandatory = $true)]
        [string] $EntryName
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)

    try {
        $entry = $zip.Entries | Where-Object { $_.FullName -eq $EntryName } | Select-Object -First 1

        if ($null -eq $entry) {
            throw "Expected '$EntryName' at the ZIP root, but it was not found."
        }
    }
    finally {
        $zip.Dispose()
    }
}

function Assert-ZipNoBackslashes {
    param(
        [Parameter(Mandatory = $true)]
        [string] $ZipPath
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)

    try {
        $badEntries = @($zip.Entries | Where-Object { $_.FullName -like '*\*' })
        if ($badEntries.Count -gt 0) {
            $names = ($badEntries | ForEach-Object { $_.FullName }) -join ', '
            throw "ZIP contains Windows backslash paths: $names"
        }
    }
    finally {
        $zip.Dispose()
    }
}

if (-not (Test-Path $pluginRoot)) {
    throw "Plugin source folder not found: $pluginRoot"
}

$version = Get-ManifestVersion -ManifestPath $manifestPath

Ensure-CleanDirectory -Path $stageRoot
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$pluginStage = Join-Path $stageRoot 'plugin'
New-Item -ItemType Directory -Path $pluginStage | Out-Null
Copy-Item -Path (Join-Path $pluginRoot '*') -Destination $pluginStage -Recurse -Force

$zipPath = Join-Path $outputRoot ('{0}-v{1}.zip' -f $packagePrefix, $version)
New-ZipFromDirectoryContents -SourceDirectory $pluginStage -DestinationZip $zipPath
Assert-ZipContainsRootEntry -ZipPath $zipPath -EntryName 'smartcrop.xml'
Assert-ZipNoBackslashes -ZipPath $zipPath

# Remove previous version ZIP packages
Get-ChildItem -Path $outputRoot -Filter ('{0}-*.zip' -f $packagePrefix) -File |
    Where-Object { $_.FullName -ne $zipPath } |
    ForEach-Object {
        Remove-Item -Path $_.FullName -Force
        Write-Host ('Removed previous package: {0}' -f $_.Name)
    }

Write-Host ('Created package: {0}' -f $zipPath)
