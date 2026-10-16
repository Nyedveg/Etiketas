<#
.SYNOPSIS
    Etiketas installer, updater and uninstaller. No admin rights required for any step.
.DESCRIPTION
    install.bat                 install Etiketas -- or, if it is already installed, offer to update it
    install.bat update          update without asking (reinstall the latest version from GitHub)
    install.bat uninstall       remove the installed app (uninstall.bat does the same)
    add -Yes to skip the confirmation questions

    Install / update:
    1. Confirms the shared OneDrive/SharePoint folder is synced to this PC
       (hard requirement -- stops here if it isn't).
    2. Confirms Python is installed.
    3. Downloads the latest Etiketas from GitHub and checks it. The installed copy is only
       touched after that has worked, so a failed download changes nothing.
    4. Installs its Python dependencies, stops the running app, and swaps the new copy in --
       the old folder is replaced completely, not overlaid.
    5. Links Documents\Etiketas to the shared OneDrive folder (a junction --
       see docs\SYNC_SETUP.md for what that means and why).
    6. Creates a Desktop shortcut (not a Start Menu one -- that needs admin
       rights for an all-users install; a Desktop shortcut doesn't).

    Uninstall: stops the running app, then deletes the install folder and the Desktop
    shortcut. Your labels, settings and the shared OneDrive folder are never touched
    (Documents\Etiketas is only a link to it and is left in place), and the Python
    packages installed for Etiketas stay (other Python tools may use them).
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('Auto', 'Install', 'Update', 'Uninstall')]
    [string]$Action = 'Auto',
    [switch]$Yes,
    [string]$InstallDir  = (Join-Path $env:LOCALAPPDATA 'Programs\Etiketas'),
    # Point this at a separate "built" distribution repo instead, if the dev repo
    # ever becomes private -- this only works against a repo that's public,
    # since it's an anonymous download (no auth/token handling here).
    # A path to a local .zip of the repo works too (offline installs, testing).
    [string]$RepoZipUrl  = 'https://github.com/Nyedveg/Etiketas/archive/refs/heads/main.zip',
    [string]$ShortcutDir = [Environment]::GetFolderPath('Desktop'),
    # The shared OneDrive folder, and the link to it that the app reads its labels through.
    [string]$OneDriveFolder = (Join-Path $env:USERPROFILE 'OneDrive - Nando, UAB\Marketing - Etiketas'),
    [string]$LabelsDir      = (Join-Path $env:USERPROFILE 'Documents\Etiketas')
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "    $msg" -ForegroundColor Red }

function Stop-Setup($msg) {
    Write-Fail $msg
    Write-Host "`nSetup stopped -- nothing beyond what's noted above was changed." -ForegroundColor Red
    exit 1
}

function Confirm-Step([string]$question, [bool]$defaultYes) {
    if ($Yes) { return $true }
    $hint = if ($defaultYes) { '[Y/n]' } else { '[y/N]' }
    $answer = Read-Host "    $question $hint"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $defaultYes }
    return $answer.Trim().ToLower().StartsWith('y')
}

# An Etiketas install has app\etiketas.py (current layout) or etiketas.py (older installs).
function Test-IsEtiketasDir([string]$dir) {
    return ((Test-Path -LiteralPath (Join-Path $dir 'app\etiketas.py')) -or (Test-Path -LiteralPath (Join-Path $dir 'etiketas.py')))
}

function Test-IsLink([string]$path) {
    return [bool]((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)
}

# Never delete a tree that holds a junction/symlink: Windows PowerShell 5.1 can follow it
# and delete what it points at (here: the shared OneDrive labels).
function Find-Link([string]$path) {
    return (Get-ChildItem -LiteralPath $path -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1)
}
function Remove-Tree([string]$path) {
    if (Test-IsLink $path) { throw "refusing to delete $path -- it is a link, not a folder" }
    $link = Find-Link $path
    if ($link) { throw "refusing to delete $path -- it contains a link ($($link.FullName)) that could lead to other folders" }
    Remove-Item -LiteralPath $path -Recurse -Force
}

# Refuses anything that is not plainly "the Etiketas program folder".
function Assert-SafeInstallDir([string]$dir, [bool]$mustExist) {
    $full = [IO.Path]::GetFullPath($dir).TrimEnd('\')
    $root = [IO.Path]::GetPathRoot($full).TrimEnd('\')
    $depth = $full.Substring($root.Length).Trim('\').Split('\').Count
    if ($depth -lt 3) { Stop-Setup "Refusing to use '$full' as the install folder -- it is too close to the top of the drive." }
    $protected = @($env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA, $env:SystemRoot, $env:ProgramFiles, ${env:ProgramFiles(x86)},
                   (Join-Path $env:LOCALAPPDATA 'Programs'), [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('MyDocuments'),
                   $LabelsDir, $OneDriveFolder, (Split-Path -Parent $OneDriveFolder)) |
                 Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') }
    if ($protected -contains $full) { Stop-Setup "Refusing to use '$full' as the install folder -- it is a folder that holds your own files." }
    # the install folder must not contain the labels (it would be deleted with it)
    foreach ($data in @($LabelsDir, $OneDriveFolder)) {
        $d = [IO.Path]::GetFullPath($data).TrimEnd('\')
        if ($d.ToLower().StartsWith($full.ToLower() + '\')) { Stop-Setup "Refusing to use '$full' as the install folder -- your labels folder ($d) is inside it." }
    }
    if ($PSCommandPath -and $PSCommandPath.ToLower().StartsWith($full.ToLower() + '\')) {
        Stop-Setup "This installer is running from inside '$full'. Run it from somewhere else (for example the folder you downloaded it to)."
    }
    if (Test-Path -LiteralPath $full) {
        if (Test-IsLink $full) { Stop-Setup "'$full' is a link, not a folder -- not touching it." }
        if (-not (Test-IsEtiketasDir $full)) { Stop-Setup "'$full' exists but does not look like an Etiketas install (no etiketas.py in it) -- not touching it." }
    } elseif ($mustExist) {
        Stop-Setup "'$full' does not exist."
    }
}

# Stops a running Etiketas server (python running etiketas.py). The app keeps one instance on
# its port anyway, and a running copy would hold files open and block the swap/delete.
function Stop-Etiketas {
    $procs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.Name -match '^(pythonw?|pyw?)\.exe$' -and $_.CommandLine.ToLower().Contains('etiketas.py') })
    if ($procs.Count -eq 0) { return }
    Write-Host "    Stopping the running Etiketas app..."
    foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    for ($i = 0; $i -lt 20; $i++) {
        $alive = @($procs | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
        if ($alive.Count -eq 0) { break }
        Start-Sleep -Milliseconds 250
    }
    Start-Sleep -Milliseconds 500   # let Windows release the file handles
}

# Removes the Desktop shortcut -- but only if it points into the install folder.
function Remove-Shortcut {
    $lnk = Join-Path $ShortcutDir 'Etiketas.lnk'
    if (-not (Test-Path -LiteralPath $lnk)) { return }
    $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
    $points = ($sc.TargetPath + ' ' + $sc.Arguments + ' ' + $sc.WorkingDirectory).ToLower()
    if ($points.Contains($InstallDir.ToLower())) {
        Remove-Item -LiteralPath $lnk -Force
        Write-Ok "Removed the Desktop shortcut"
    } else {
        Write-Warn "Left the Desktop shortcut alone -- it points somewhere else ($($sc.TargetPath))."
    }
}

Write-Host "Etiketas installer" -ForegroundColor White
Write-Host "==================="

$InstallDir = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$ShortcutDir = [IO.Path]::GetFullPath($ShortcutDir)
$installed = Test-Path -LiteralPath $InstallDir
Assert-SafeInstallDir $InstallDir $false

# ---- What are we doing? --------------------------------------------------------
if ($Action -eq 'Auto') {
    if ($installed) {
        Write-Host "`n    Etiketas is already installed at $InstallDir"
        if (-not (Confirm-Step 'Update it to the latest version from GitHub? (the app is reinstalled; your labels and settings are not touched)' $true)) {
            Write-Host "`nNothing changed." -ForegroundColor White
            exit 0
        }
        $Action = 'Update'
    } else {
        $Action = 'Install'
    }
}
if ($Action -eq 'Install' -and $installed) { $Action = 'Update' }
if ($Action -eq 'Update' -and -not $installed) { $Action = 'Install' }

# ==== Uninstall ====================================================================
if ($Action -eq 'Uninstall') {
    Write-Step "Uninstalling Etiketas"
    if (-not $installed) {
        Write-Warn "Etiketas is not installed at $InstallDir -- nothing to remove."
        Remove-Shortcut
        exit 0
    }
    $link = Find-Link $InstallDir      # checked first: nothing (not even the running app) is touched if this fails
    if ($link) { Stop-Setup "Refusing to delete $InstallDir -- it contains a link ($($link.FullName)) that could lead to other folders, such as your labels." }
    $files = @(Get-ChildItem -LiteralPath $InstallDir -Recurse -File -Force -ErrorAction SilentlyContinue)
    $mb = [math]::Round((($files | Measure-Object Length -Sum).Sum) / 1MB, 1)
    Write-Host "    This deletes $InstallDir ($($files.Count) files, $mb MB) and the Desktop shortcut."
    Write-Host "    Your labels, settings and the shared OneDrive folder are not touched."
    $own = @(Get-ChildItem -LiteralPath (Join-Path $InstallDir 'translations') -Recurse -File -Force -ErrorAction SilentlyContinue)
    if ($own.Count -gt 0) {
        Write-Warn "The install folder has a translations\ folder with $($own.Count) file(s) in it -- they are deleted too."
    }
    if (-not (Confirm-Step 'Uninstall Etiketas?' $false)) {
        Write-Host "`nNothing changed." -ForegroundColor White
        exit 0
    }
    Stop-Etiketas
    try { Remove-Tree $InstallDir } catch { Stop-Setup "Could not delete $InstallDir : $($_.Exception.Message)`n`n    Close anything that is using that folder (File Explorer, an editor, a terminal) and run this again." }
    Write-Ok "Removed $InstallDir"
    Remove-Shortcut
    Write-Host "`n=======================================" -ForegroundColor White
    Write-Host " Etiketas is uninstalled." -ForegroundColor Green
    Write-Host " Kept on purpose:"
    Write-Host "   - $LabelsDir (a link to the shared OneDrive folder, with all your labels)"
    Write-Host "   - the Python packages Pillow, PyMuPDF and numpy (remove with: pip uninstall Pillow PyMuPDF numpy)"
    Write-Host " To install it again, run install.bat."
    Write-Host "======================================="
    exit 0
}

# ==== Install / Update ==============================================================
$updating = ($Action -eq 'Update')
if ($updating) { Write-Host "`n    Updating the existing install at $InstallDir" }

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

    Then run this installer again. See docs\SYNC_SETUP.md for more detail.
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

# ---- Step 3: get the app (the installed copy is not touched yet) ---------------
Write-Step "Getting Etiketas"
$stage  = "$InstallDir.new"
$backup = "$InstallDir.old"
# Leftovers of an interrupted run: a previous copy that was moved aside but never replaced
# is put back first, so there is never "nothing installed" because of a crash.
if ((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $InstallDir)) {
    Move-Item -LiteralPath $backup -Destination $InstallDir
    Write-Warn "Put back the previous copy that an interrupted update had moved aside."
    $installed = $true; $updating = $true
}
foreach ($leftover in @($stage, $backup)) {
    if (Test-Path -LiteralPath $leftover) { Remove-Tree $leftover }
}

$tag = Get-Random
$zipPath = Join-Path $env:TEMP "etiketas_install_$tag.zip"
$extractDir = Join-Path $env:TEMP "etiketas_extract_$tag"
try {
    if (Test-Path -LiteralPath $RepoZipUrl -PathType Leaf) {
        Write-Host "    Using local file $RepoZipUrl ..."
        Copy-Item -LiteralPath $RepoZipUrl -Destination $zipPath
    } else {
        Write-Host "    Downloading from $RepoZipUrl ..."
        Invoke-WebRequest -Uri $RepoZipUrl -OutFile $zipPath -UseBasicParsing
    }
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
    $innerFolder = Get-ChildItem -LiteralPath $extractDir -Directory | Select-Object -First 1
    if (-not $innerFolder -or -not (Test-IsEtiketasDir $innerFolder.FullName) -or -not (Test-Path -LiteralPath (Join-Path $innerFolder.FullName 'requirements.txt'))) {
        throw "the download does not look like Etiketas (no etiketas.py / requirements.txt in it)"
    }
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Copy-Item -Path (Join-Path $innerFolder.FullName '*') -Destination $stage -Recurse -Force
} catch {
    if (Test-Path -LiteralPath $stage) { Remove-Tree $stage }
    $why = $_.Exception.Message
    $tail = if ($updating) { "The existing install was left exactly as it was." } else { "Nothing was installed." }
    Stop-Setup "Download failed: $why`n`n    $tail`n    If the source repo is private, this installer needs a public 'built'`n    distribution repo instead -- see the comment at the top of this script."
} finally {
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
}
# Setup tooling, not part of the app itself -- don't leave a copy sitting inside the installed folder.
foreach ($tool in 'install.bat', 'install.ps1', 'uninstall.bat') {
    Remove-Item -LiteralPath (Join-Path $stage $tool) -Force -ErrorAction SilentlyContinue
}
# Files someone put in the old translations folder survive the update (the new copy wins on a name clash).
$oldTrans = Join-Path $InstallDir 'translations'
if ($updating -and (Test-Path -LiteralPath $oldTrans)) {
    $kept = 0
    foreach ($f in Get-ChildItem -LiteralPath $oldTrans -Recurse -File -Force) {
        $rel = $f.FullName.Substring($oldTrans.Length).TrimStart('\')
        $dest = Join-Path (Join-Path $stage 'translations') $rel
        if (-not (Test-Path -LiteralPath $dest)) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
            Copy-Item -LiteralPath $f.FullName -Destination $dest
            $kept++
        }
    }
    if ($kept -gt 0) { Write-Ok "Kept $kept file(s) from your translations folder" }
}
Write-Ok "Downloaded and checked the latest version"

# ---- Step 4: dependencies, then swap the new copy in --------------------------------
Write-Step "Installing Python dependencies"
$reqFile = Join-Path $stage 'requirements.txt'
& $python.Source -m pip install --user --quiet -r $reqFile
if ($LASTEXITCODE -ne 0) {
    Remove-Tree $stage
    Stop-Setup "pip install failed -- see the output above. The existing install (if any) was left as it was."
}
Write-Ok "Dependencies installed"

Write-Step $(if ($updating) { "Replacing the old version" } else { "Installing" })
if ($updating) { Stop-Etiketas }
$movedAside = $false
try {
    if ($updating) {
        Move-Item -LiteralPath $InstallDir -Destination $backup
        $movedAside = $true
    }
    Move-Item -LiteralPath $stage -Destination $InstallDir
} catch {
    $why = $_.Exception.Message
    if ($movedAside -and -not (Test-Path -LiteralPath $InstallDir)) { Move-Item -LiteralPath $backup -Destination $InstallDir -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $stage) { Remove-Tree $stage }
    Stop-Setup "Could not put the new version in place: $why`n`n    Close anything that is using the Etiketas folder (File Explorer, an editor, a terminal) and run this again.`n    The previous version was left in place."
}
if ($movedAside) {
    try { Remove-Tree $backup } catch { Write-Warn "The old version is still at $backup -- delete that folder when nothing is using it." }
}
Write-Ok $(if ($updating) { "Updated $InstallDir" } else { "Installed to $InstallDir" })

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
        Write-Warn "See docs\SYNC_SETUP.md for how to move existing data into the shared folder,"
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
New-Item -ItemType Directory -Path $ShortcutDir -Force | Out-Null
$shortcutPath = Join-Path $ShortcutDir 'Etiketas.lnk'
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
# Launch through the .vbs so no console window ever appears; the app itself
# takes the port back from any older instance, so re-launching is always safe.
$shortcut.TargetPath       = 'wscript.exe'
$shortcut.Arguments        = '"' + (Join-Path $InstallDir 'Etiketas.vbs') + '"'
$shortcut.WorkingDirectory = $InstallDir
$iconPath = Join-Path $InstallDir 'Nando-ico.ico'
if (Test-Path -LiteralPath $iconPath) { $shortcut.IconLocation = "$iconPath,0" }
$shortcut.Save()
Write-Ok "Shortcut created on your Desktop"

# ---- Done -----------------------------------------------------------------------
Write-Host "`n=======================================" -ForegroundColor White
Write-Host $(if ($updating) { " Etiketas is updated." } else { " Etiketas is installed." }) -ForegroundColor Green
Write-Host " Launch it from the new Desktop shortcut, or run:"
Write-Host "   $InstallDir\Start_Etiketas.bat            (windowless)"
Write-Host "   $InstallDir\Start_Etiketas.bat console    (with a debug console)"
Write-Host " To update later, run install.bat again. To remove it: uninstall.bat"
if (-not $linked) {
    Write-Host "`n NOTE: the labels folder link was not set up -- see the warning above." -ForegroundColor Yellow
}
Write-Host "======================================="
