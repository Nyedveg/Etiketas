<#
.SYNOPSIS
    Etiketas installer. No admin rights required for any step.
.DESCRIPTION
    1. Confirms the shared OneDrive/SharePoint folder is synced to this PC
       (hard requirement -- stops here if it isn't).
    2. Confirms Python is installed.
    3. Downloads Etiketas from GitHub and installs its Python dependencies.
    4. Links Documents\Etiketas to the shared OneDrive folder (a junction --
       see SYNC_SETUP.md for what that means and why).
    5. Creates a Desktop shortcut (not a Start Menu one -- that needs admin
       rights for an all-users install; a Desktop shortcut doesn't).
#>

$ErrorActionPreference = 'Stop'

# ---- Configuration ----------------------------------------------------------
# Point this at a separate "built" distribution repo instead, if the dev repo
# ever becomes private -- this only works against a repo that's public,
# since it's an anonymous download (no auth/token handling here).
$RepoZipUrl     = 'https://github.com/Nyedveg/Etiketas/archive/refs/heads/main.zip'
$InstallDir     = Join-Path $env:USERPROFILE 'Documents\GitHub\Etiketas'
$OneDriveFolder = Join-Path $env:USERPROFILE 'OneDrive - Nando, UAB\Marketing - Etiketas'
$LabelsDir      = Join-Path $env:USERPROFILE 'Documents\Etiketas'
# ------------------------------------------------------------------------------

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "    $msg" -ForegroundColor Red }

function Stop-Setup($msg) {
    Write-Fail $msg
    Write-Host "`nSetup stopped -- nothing beyond what's noted above was changed." -ForegroundColor Red
    exit 1
}

Write-Host "Etiketas installer" -ForegroundColor White
Write-Host "==================="

# ---- Step 1: the shared OneDrive folder is a hard prerequisite --------------
Write-Step "Checking for the shared OneDrive folder"
$resolvedOneDrive = $null
if (Test-Path -LiteralPath $OneDriveFolder) {
    $resolvedOneDrive = $OneDriveFolder
} else {
    # Fall back to a fuzzy search in case the tenant display name differs
    $candidates = Get-ChildItem -LiteralPath $env:USERPROFILE -Directory -Filter 'OneDrive*' -ErrorAction SilentlyContinue
    foreach ($c in $candidates) {
        $maybe = Join-Path $c.FullName 'Marketing - Etiketas'
        if (Test-Path -LiteralPath $maybe) { $resolvedOneDrive = $maybe; break }
    }
}

if (-not $resolvedOneDrive) {
    Write-Fail "Could not find a synced 'Marketing - Etiketas' folder under any OneDrive folder in your profile."
    Write-Host @"

    Expected it at:
      $OneDriveFolder

    Before running this installer, sync the shared SharePoint folder to this PC:
      1. Open the SharePoint site (or the relevant Teams channel's Files tab).
      2. Find "Marketing - Etiketas".
      3. Click Sync (or "Add shortcut to OneDrive" if it was shared with you).
      4. Wait for OneDrive to finish its initial sync -- check File Explorer
         for a green checkmark/cloud icon on the folder.

    Then run this installer again. See SYNC_SETUP.md for more detail.
"@ -ForegroundColor Yellow
    exit 1
}
Write-Ok "Found: $resolvedOneDrive"

# ---- Step 2: Python ----------------------------------------------------------
Write-Step "Checking for Python"
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }
if (-not $python) {
    Stop-Setup @"
Python was not found on this PC.

    Install it from https://python.org/downloads -- check "Add python.exe to
    PATH" during setup. No admin rights are needed if you install for your
    user only (that's the default on the python.org installer).

    Then run this installer again.
"@
}
$pyVersion = & $python.Source --version 2>&1
Write-Ok "Found $pyVersion at $($python.Source)"

# ---- Step 3: download the app ------------------------------------------------
Write-Step "Getting Etiketas"
if (Test-Path -LiteralPath $InstallDir) {
    Write-Warn "Etiketas already exists at $InstallDir -- skipping download."
    Write-Warn "Delete that folder first if you want a clean re-download."
} else {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    $zipPath = Join-Path $env:TEMP "etiketas_install_$(Get-Random).zip"
    Write-Host "    Downloading from $RepoZipUrl ..."
    try {
        Invoke-WebRequest -Uri $RepoZipUrl -OutFile $zipPath -UseBasicParsing
    } catch {
        Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
        Stop-Setup "Download failed: $($_.Exception.Message)`n`n    If the source repo is private, this installer needs a public 'built'`n    distribution repo instead -- see the comment at the top of this script."
    }
    $extractDir = Join-Path $env:TEMP "etiketas_extract_$(Get-Random)"
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
    $innerFolder = Get-ChildItem -LiteralPath $extractDir -Directory | Select-Object -First 1
    Copy-Item -Path (Join-Path $innerFolder.FullName '*') -Destination $InstallDir -Recurse -Force
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Ok "Installed to $InstallDir"
}

$reqFile = Join-Path $InstallDir 'requirements.txt'
if (-not (Test-Path -LiteralPath $reqFile)) {
    Stop-Setup "requirements.txt not found in $InstallDir -- the download looks incomplete or the folder pre-existed without it."
}

# ---- Step 4: dependencies -----------------------------------------------------
Write-Step "Installing Python dependencies"
& $python.Source -m pip install --user --quiet -r $reqFile
if ($LASTEXITCODE -ne 0) { Stop-Setup "pip install failed -- see the output above." }
Write-Ok "Dependencies installed"

# ---- Step 5: link the labels folder --------------------------------------------
Write-Step "Linking the labels folder to the shared OneDrive folder"
$linked = $false
if (Test-Path -LiteralPath $LabelsDir) {
    $item = Get-Item -LiteralPath $LabelsDir -Force
    if ($item.LinkType) {
        # Compare canonical resolved paths, not raw strings -- otherwise this
        # can false-negative on short-vs-long filename form, trailing slashes,
        # or other representational differences that still mean "same folder".
        $currentTarget  = if (Test-Path -LiteralPath $item.Target) { (Get-Item -LiteralPath $item.Target -Force).FullName } else { $item.Target }
        $expectedTarget = (Get-Item -LiteralPath $resolvedOneDrive -Force).FullName
        if ($currentTarget -eq $expectedTarget) {
            Write-Ok "Already linked correctly -- nothing to do."
            $linked = $true
        } else {
            Write-Warn "Documents\Etiketas is already linked elsewhere ($($item.Target))."
            Write-Warn "Not touching it -- remove it manually first if you want this installer to relink it."
        }
    } elseif ((Get-ChildItem -LiteralPath $LabelsDir -Force | Measure-Object).Count -eq 0) {
        Remove-Item -LiteralPath $LabelsDir -Force
        Write-Host "    (removed an empty placeholder folder)"
    } else {
        Write-Warn "Documents\Etiketas already contains files -- not touching it automatically."
        Write-Warn "See SYNC_SETUP.md for how to move existing data into the shared folder,"
        Write-Warn "then re-run this installer."
    }
}
if (-not $linked -and -not (Test-Path -LiteralPath $LabelsDir)) {
    New-Item -ItemType Junction -Path $LabelsDir -Target $resolvedOneDrive | Out-Null
    Write-Ok "Linked Documents\Etiketas -> $resolvedOneDrive"
    $linked = $true
}

# ---- Step 6: desktop shortcut ---------------------------------------------------
Write-Step "Creating a desktop shortcut"
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Etiketas.lnk'
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $InstallDir 'Start_Etiketas.bat'
$shortcut.WorkingDirectory = $InstallDir
$iconPath = Join-Path $InstallDir 'Nando-ico.ico'
if (Test-Path -LiteralPath $iconPath) { $shortcut.IconLocation = "$iconPath,0" }
$shortcut.Save()
Write-Ok "Shortcut created on your Desktop"

# ---- Done -----------------------------------------------------------------------
Write-Host "`n=======================================" -ForegroundColor White
Write-Host " Etiketas is installed." -ForegroundColor Green
Write-Host " Launch it from the new Desktop shortcut, or run:"
Write-Host "   $InstallDir\Start_Etiketas.bat"
if (-not $linked) {
    Write-Host "`n NOTE: the labels folder link was not set up -- see the warning above." -ForegroundColor Yellow
}
Write-Host "======================================="
