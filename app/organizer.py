#!/usr/bin/env python3
"""
Label File Organizer
--------------------
Scans any folder recursively for label files matching the naming convention
(see labelnames.py):
  ProductName[_NEW]_Packaging_LANG1[_LANG2]_WxH_YYYY_MM[_deze][+2mm].ext

COPIES them into labels_dir (default: ~/Documents/Etiketas):
    unsorted/           <- files that could not be parsed, or whose product isn't in the catalogue
    CATEGORY/ProductName/
      LANG1,LANG2/
        1kg/  5kg/  1L/  Box/  ...

Source files are NEVER modified or deleted.

`resort` is the one exception: it moves files already inside labels_dir out of
unsorted/ once the catalogue (or the parser) can place them, e.g. after a new
product is added. It only plans unless told to apply.
"""

import filecmp
import json
import os
import shutil
from datetime import datetime
from pathlib import Path

from labelnames import Catalogue, label_entry, label_kind, pack_amount, parse_stem

DEFAULT_LABELS_DIR = Path.home() / "Documents" / "Etiketas"
UNSORTED = "unsorted"
RESORT_LOG = "resort_log.json"

# -- Destination builder -------------------------------------------------------
def build_destination(info: dict, labels_dir: Path, cat: Catalogue = None) -> Path:
    prod_cfg = cat.product(info["product"]) if cat else None
    if not prod_cfg:
        return labels_dir / UNSORTED
    if info["deze"]:
        pack_folder = "Box"
    else:
        amount = pack_amount(info["packaging"])
        if amount:
            unit = 'L' if amount[1] == 'l' else amount[1]
            pack_folder = f"{amount[0]:g}{unit}"
        else:
            pack_folder = info["packaging"]
    return labels_dir / prod_cfg["category"] / prod_cfg["name"] / ",".join(info["languages"]) / pack_folder

def _destination(path: Path, labels_dir: Path, cat: Catalogue) -> Path:
    """The folder a label file belongs in (unsorted/ if its name can't be placed)."""
    info = parse_stem(path.stem, cat)
    return build_destination(info, labels_dir, cat) if info else labels_dir / UNSORTED

# -- Ingest function -----------------------------------------------------------
def ingest(source_dir: Path, labels_dir: Path = None, dry_run: bool = False, cat: Catalogue = None) -> dict:
    """
    Walk source_dir recursively. COPY all design/print files to labels_dir.
    The source directory is NEVER modified.

    Returns:
        {entries: [...], skipped: int, errors: [...], total_found: int, dry_run: bool}
    Each entry is a label-map record (see labelnames.label_entry).
    """
    source_dir   = Path(source_dir)
    labels_dir   = Path(labels_dir or DEFAULT_LABELS_DIR)

    entries = []
    skipped = 0
    errors  = []

    for root, dirs, files in os.walk(source_dir):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for fname in sorted(files):
            if fname.startswith('.'):
                continue
            src_file = Path(root) / fname
            if label_kind(src_file.suffix, src_file.stem) not in ('indd', 'print'):
                continue

            dest_dir  = _destination(src_file, labels_dir, cat)
            dest_file = dest_dir / src_file.name

            if dest_file.exists():
                skipped += 1
                continue

            if not dry_run:
                try:
                    dest_dir.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(str(src_file), str(dest_file))
                except Exception as exc:
                    errors.append({"file": fname, "error": str(exc)})
                    continue

            entries.append(label_entry(str(dest_file.relative_to(labels_dir)), src_file.name, cat))

    return {
        "entries":     entries,
        "skipped":     skipped,
        "errors":      errors,
        "total_found": len(entries) + skipped + len(errors),
        "dry_run":     dry_run,
    }

# -- Re-sort -------------------------------------------------------------------
def _newer(a: Path, b: Path):
    """Whichever of two files was modified last; None if the times tie."""
    ma, mb = a.stat().st_mtime, b.stat().st_mtime
    return a if ma > mb else b if mb > ma else None

def resort(labels_dir: Path, cat: Catalogue, apply: bool = False, keep_newest: bool = False,
           drop_identical: bool = False, discard=None) -> dict:
    """Plan (and with apply=True, perform) moving files out of labels_dir/unsorted
    into the folder their name now places them in. Nothing is overwritten: a file
    whose destination already exists is reported as a conflict and left where it is.

    Two opt-in ways to settle a conflict, both sending the loser to the Recycle Bin
    via `discard(path)`:
      keep_newest    two *different* files: the older one goes, the newer ends up
                     at the destination (a tie in modification time is left alone)
      drop_identical the unsorted copy is byte-for-byte the filed one: it goes

    Applied moves are appended to labels_dir/resort_log.json; `undo_resort` reverses
    the last run. A file that can't be moved (locked by InDesign, OneDrive...) is
    reported in `errors` and the rest carry on.
    Returns {moves, conflicts: [(from, existing)], replaced: [(from, replaced file)],
    discarded: [unsorted copies that go], errors: [(from, why)], left: n, applied: bool}
    with paths relative to labels_dir."""
    if apply and (keep_newest or drop_identical) and not discard:
        raise ValueError("keep_newest / drop_identical need a discard function to delete the loser")
    labels_dir = Path(labels_dir)
    unsorted_dir = labels_dir / UNSORTED
    moves, conflicts, replaced, discarded, left = [], [], [], [], 0
    for path in sorted(unsorted_dir.rglob("*")) if unsorted_dir.exists() else []:
        if not path.is_file() or path.name.startswith('.') or not label_kind(path.suffix, path.stem):
            continue
        dest_dir = _destination(path, labels_dir, cat)
        target = dest_dir / path.name
        if dest_dir == unsorted_dir:
            left += 1
        elif not target.exists():
            moves.append((path, target))
        elif filecmp.cmp(path, target, shallow=False):   # the same bytes are already filed
            if drop_identical:
                discarded.append(path)
            else:
                conflicts.append((path, target))
        else:
            newer = _newer(path, target) if keep_newest else None
            if newer is None:
                conflicts.append((path, target))
            elif newer == path:
                replaced.append((path, target))       # the filed copy is the older one
            else:
                discarded.append(path)                 # this copy is the older one

    rel = lambda p: str(p.relative_to(labels_dir))
    done, recycled, errors = [], [], []
    if apply:
        try:
            for src, dest in moves + replaced:
                try:
                    if dest.exists():                  # a replacement: the older filed copy goes first
                        discard(dest)
                        recycled.append(rel(dest))
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(src), str(dest))
                    done.append({"from": rel(src), "to": rel(dest)})
                except (OSError, RuntimeError) as exc:
                    errors.append((rel(src), str(exc)))
            for src in discarded:
                try:
                    discard(src)
                    recycled.append(rel(src))
                except (OSError, RuntimeError) as exc:
                    errors.append((rel(src), str(exc)))
        finally:                                  # whatever was moved is logged, even if the run is cut short
            if done or recycled:
                _append_log(labels_dir, {"time": datetime.now().isoformat(), "moves": done, "recycled": recycled})
    return {"moves": [(rel(a), rel(b)) for a, b in moves],
            "conflicts": [(rel(a), rel(b)) for a, b in conflicts],
            "replaced": [(rel(a), rel(b)) for a, b in replaced],
            "discarded": [rel(a) for a in discarded],
            "errors": errors, "left": left, "applied": bool(done or recycled)}

def _read_log(labels_dir: Path) -> list:
    try:
        return json.loads((labels_dir / RESORT_LOG).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []

def _append_log(labels_dir: Path, run: dict):
    (labels_dir / RESORT_LOG).write_text(json.dumps(_read_log(labels_dir) + [run], ensure_ascii=False, indent=2), encoding="utf-8")

def undo_resort(labels_dir: Path) -> dict:
    """Move the files of the last applied `resort` back where they were. A file that
    has since moved or been replaced is skipped. Files the run sent to the Recycle Bin
    are not restored (only the Recycle Bin can do that); they are listed in `recycled`.
    Returns {restored: n, skipped: [(path, why)], recycled: [path]}."""
    labels_dir = Path(labels_dir)
    log = _read_log(labels_dir)
    if not log:
        return {"restored": 0, "skipped": [], "recycled": []}
    restored, skipped = 0, []
    for m in log[-1]["moves"]:
        src, dest = labels_dir / m["to"], labels_dir / m["from"]
        if not src.exists():
            skipped.append((m["to"], "no longer there"))
        elif dest.exists():
            skipped.append((m["to"], "original location is occupied"))
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dest))
            restored += 1
    (labels_dir / RESORT_LOG).write_text(json.dumps(log[:-1], ensure_ascii=False, indent=2), encoding="utf-8")
    return {"restored": restored, "skipped": skipped, "recycled": log[-1].get("recycled", [])}

# -- Entry point ---------------------------------------------------------------
def _app_catalogue():
    """The app's own product/language catalogue (imported late: the app imports this module)."""
    import etiketas
    return etiketas.make_catalogue(etiketas.merged_config())

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(
        description="Copy label files from any folder into the Etiketas labels folder, "
                    "or re-sort the ones already in its unsorted/ folder."
    )
    parser.add_argument("--source", "-s",
                        help="Source folder to scan recursively")
    parser.add_argument("--target", "-t", default=str(DEFAULT_LABELS_DIR),
                        help=f"Labels output directory (default: {DEFAULT_LABELS_DIR})")
    parser.add_argument("--dry-run", "-n", action="store_true",
                        help="Preview without copying anything")
    parser.add_argument("--resort", action="store_true",
                        help="Move files from the target's unsorted/ folder to where their names now place them "
                             "(a preview unless --apply is also given)")
    parser.add_argument("--apply", action="store_true",
                        help="With --resort: actually move the files")
    parser.add_argument("--keep-newest", action="store_true",
                        help="With --resort: when a different file already sits at the destination, keep the "
                             "newer of the two and send the older to the Recycle Bin")
    parser.add_argument("--drop-identical", action="store_true",
                        help="With --resort: when the same file (byte for byte) already sits at the destination, "
                             "send the unsorted copy to the Recycle Bin")
    parser.add_argument("--undo-resort", action="store_true",
                        help="Move the files of the last applied --resort back where they were")
    args   = parser.parse_args()
    tgt    = Path(args.target)

    if args.undo_resort:
        result = undo_resort(tgt)
        print(f"Restored {result['restored']} file(s).")
        for path, why in result["skipped"]:
            print(f"  skipped {path}: {why}")
        for path in result["recycled"]:
            print(f"  in the Recycle Bin (restore it from there if needed): {path}")
        raise SystemExit

    cat    = _app_catalogue()
    if args.resort:
        import etiketas
        plan = resort(tgt, cat, apply=args.apply, keep_newest=args.keep_newest,
                      drop_identical=args.drop_identical, discard=etiketas.trash_path)
        tag = "MOVED" if args.apply else "WOULD MOVE"
        for src, dest in plan["moves"]:
            print(f"[{tag}] {src}\n          -> {dest}")
        for src, filed in plan["replaced"]:
            print(f"[{'REPLACED' if args.apply else 'WOULD REPLACE'}] {src}\n          is newer than {filed}, which goes to the Recycle Bin")
        for src in plan["discarded"]:
            print(f"[{'RECYCLED' if args.apply else 'WOULD RECYCLE'}] {src} (a newer or identical copy is already filed)")
        for src, existing in plan["conflicts"]:
            print(f"[CONFLICT] {src}\n          already exists: {existing}")
        for src, why in plan["errors"]:
            print(f"[ERROR] {src}: {why}")
        print("-" * 60)
        print(f"{len(plan['moves'])} file(s) {'moved' if args.apply else 'would move'}, "
              f"{len(plan['replaced']) + len(plan['discarded'])} duplicate(s) settled, "
              f"{len(plan['conflicts'])} conflict(s) left, {len(plan['errors'])} error(s), "
              f"{plan['left']} still can't be placed.")
        if (plan["moves"] or plan["replaced"] or plan["discarded"]) and not args.apply:
            print("Nothing was changed. Add --apply to move them (a log is written to " + RESORT_LOG + ").")
        raise SystemExit

    if not args.source:
        parser.error("--source is required (unless --resort is used)")
    src    = Path(args.source)
    print(f"Source : {src}")
    print(f"Target : {tgt}")
    print("-" * 60)
    result = ingest(src, tgt, dry_run=args.dry_run, cat=cat)
    for e in result["entries"]:
        print(f"[{'DRY' if args.dry_run else 'COPY':4s}] {e['filename']}")
        print(f"       -> {e['path']}")
    print("-" * 60)
    tag = "DRY RUN:" if args.dry_run else "Done:"
    print(f"{tag} {len(result['entries'])} file(s) processed, {result['skipped']} skipped.")
    if result["errors"]:
        print(f"Errors ({len(result['errors'])}):")
        for err in result["errors"]:
            print(f"  {err['file']}: {err['error']}")
