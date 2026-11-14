# SPDX-FileCopyrightText: 2026 MSHost contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
param([switch]$InstallDependencies, [switch]$RequireSignature)
$ErrorActionPreference = 'Stop'
if ($RequireSignature -and -not $env:WINDOWS_SIGN_PARAMS) {
    throw 'Trusted Windows signing credentials are required; configure WINDOWS_SIGN_PARAMS'
}
$buildOriginalPath = $env:Path
$env:Path = $env:Path.Replace('"', '')
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    if ($InstallDependencies) {
        npm.cmd ci --ignore-scripts --cache D:\MSHost\Builds\TalkDesktop\npm-cache --no-audit --no-fund
        if ($LASTEXITCODE) { throw 'npm ci failed' }
        node node_modules/electron/install.js
        if ($LASTEXITCODE) { throw 'Electron installation failed' }
        node node_modules/esbuild/install.js
        if ($LASTEXITCODE) { throw 'esbuild installation failed' }
    }
    Push-Location node_modules/electron-winstaller
    try {
        node script/select-7z-arch.js
        if ($LASTEXITCODE) { throw 'Squirrel 7-Zip setup failed' }
    } finally { Pop-Location }
    node branding/prepare-assets.cjs
    if ($LASTEXITCODE) { throw 'Asset generation failed' }
    $env:CHANNEL = 'stable'
    $package = Get-Content -Raw package.json | ConvertFrom-Json
    $env:npm_package_name = $package.name
    $env:npm_package_version = $package.version
    node node_modules/@electron-forge/cli/dist/electron-forge.js package --platform=win32 --arch=x64
    if ($LASTEXITCODE) { throw 'Windows build failed' }
    node node_modules/@electron-forge/cli/dist/electron-forge.js make --from-package --platform=win32 --arch=x64 --targets=squirrel
    if ($LASTEXITCODE) { throw 'Windows installer packaging failed' }
    if ($RequireSignature) {
        $signature = Get-AuthenticodeSignature 'out/make/squirrel.windows/x64/MSHost.Talk-windows-x64.exe'
        if ($signature.Status -ne 'Valid') { throw 'Installer must have a valid trusted Authenticode signature' }
    }
    python branding/export-release.py
    if ($LASTEXITCODE) { throw 'Release export failed' }
} finally {
    $env:Path = $buildOriginalPath
    Remove-Item Env:\CHANNEL -ErrorAction SilentlyContinue
    Remove-Item Env:\npm_package_name -ErrorAction SilentlyContinue
    Remove-Item Env:\npm_package_version -ErrorAction SilentlyContinue
    Pop-Location
}
