# Sharing the labels folder over SharePoint / OneDrive

Etiketas always reads and writes to a fixed local folder:
`Documents\Etiketas` (specifically `%USERPROFILE%\Documents\Etiketas`).

To share that folder with colleagues, we don't change the app at all.
Instead, we make `Documents\Etiketas` a **directory junction** — an
NTFS-level alias — pointing into a OneDrive-synced copy of a shared
SharePoint folder. The app keeps reading/writing the same path it
always has; OneDrive does the actual syncing to SharePoint in the
background, same as it does for any other file on your machine.

Once this is set up, the topbar in the app shows a small status dot
telling you whether the link is in place and whether OneDrive is
currently able to sync it — see **Reading the status indicator** below.

## Prerequisite: the SharePoint folder must already be synced to your PC

This is a one-time step per person, done through OneDrive itself (not Etiketas):

1. Open the SharePoint site (or the relevant Teams channel's Files tab) in your browser.
2. Find the shared folder (e.g. "Marketing - Etiketas").
3. Click **Sync** (or, if it was shared with you rather than owned by your team, **Add shortcut to OneDrive**).
4. Wait for OneDrive to finish its initial sync. You should end up with a real folder at:
   `%USERPROFILE%\OneDrive - Nando, UAB\Marketing - Etiketas`
   (Check in File Explorer — it should show a green checkmark/cloud icon once synced.)

Everyone who wants to share the same library needs to do this once. The
folder name after `OneDrive - Nando, UAB\` must be the same for everyone
syncing the same library, but the `OneDrive - Nando, UAB` part itself is
already consistent per Microsoft 365 tenant, and `%USERPROFILE%`
automatically resolves to each person's own home folder — so nobody
needs to type their own username anywhere.

## One-time setup: if you already have Etiketas data (do this once)

You have real files sitting in `Documents\Etiketas` already. **Move**
them into the OneDrive folder, then link the old location to the new one.

Open Command Prompt (not PowerShell) and run:

```bat
robocopy "%USERPROFILE%\Documents\Etiketas" "%USERPROFILE%\OneDrive - Nando, UAB\Marketing - Etiketas" /E /MOVE
mklink /J "%USERPROFILE%\Documents\Etiketas" "%USERPROFILE%\OneDrive - Nando, UAB\Marketing - Etiketas"
```

- `robocopy /MOVE` copies everything into the shared folder, then deletes it from the old location once the copy succeeds.
- `mklink /J` creates the junction. No administrator rights needed — junctions (unlike symlinks) don't require elevation or Developer Mode.

## One-time setup: colleagues with no existing Etiketas data

Just the link — nothing to move:

```bat
mklink /J "%USERPROFILE%\Documents\Etiketas" "%USERPROFILE%\OneDrive - Nando, UAB\Marketing - Etiketas"
```

This exact command works unmodified on every machine, because
`%USERPROFILE%` resolves per-user automatically.

> **If `Documents\Etiketas` already exists as a folder** (e.g. Etiketas
> was run once and auto-created it), `mklink` will refuse to overwrite
> it. Delete the empty auto-created folder first (check it's actually
> empty!), then run the command above.

## Reading the status indicator

Once linked, the topbar of the app shows a small dot + label reflecting
what it can detect on disk. It cannot show live upload/download
progress — Windows doesn't expose that without much deeper integration
with OneDrive's internals — but it reliably tells you whether the link
itself is healthy:

| Dot | Label | Meaning | What to do |
|---|---|---|---|
| ⚪ Gray | **Not shared** | `Documents\Etiketas` is a normal local folder, not linked to anything. | Follow the setup steps above if you want this device to share the library. |
| 🔴 Red | **Shared link broken** | It's linked, but the target folder doesn't exist anymore (moved, renamed, or unsynced). | Re-check the OneDrive folder path and re-run the `mklink` step. |
| 🔴 Red | **Labels folder missing** | Nothing exists at the expected path at all. | Restart the app (it recreates the folder) or restore the link. |
| 🟡 Amber | **OneDrive not running** | The link is fine and points at a real OneDrive folder, but OneDrive itself isn't running right now. | Changes will just sit locally until OneDrive starts again (sign back in, or just wait if it's still loading). Nothing is lost. |
| 🟢 Green | **OneDrive active** | Linked, and OneDrive is running. | Normal operation — changes will sync automatically. |

Hover over the dot for the resolved folder path and link target.

## Things to know before relying on this

- **This is file sync, not a shared database.** If two people use the
  app at the exact same moment and both trigger a save (creating a
  label, deleting a file, changing settings), whichever change OneDrive
  finishes uploading *last* wins for the shared metadata files
  (`labels_map.json`, `app_config.json`, `colors_config.json`,
  `creation_history.json` — each is rewritten in full on every save,
  not merged). The actual label files themselves aren't affected by
  this — only the app's own bookkeeping about them. Clicking **Rescan**
  in the app rebuilds that bookkeeping from what's actually on disk, so
  it self-heals if this ever happens.
- **Files On-Demand**: if a colleague's OneDrive frees up space by
  making files cloud-only, the app may hit a placeholder file that
  needs to download before it can be read. Right-click the synced
  folder in File Explorer and choose "Always keep on this device" to
  avoid this.
- **Windows only.** Junctions are an NTFS feature. A Mac user would
  need a symlink (`ln -s`) to their local OneDrive sync path instead —
  same idea, different command.
