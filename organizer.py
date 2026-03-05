#!/usr/bin/env python3
"""
Label File Organizer
--------------------
Scans any folder recursively for label files matching the naming convention:
  ProductName[_NEW]_Packaging_LANG1[_LANG2]_WxH_YYYY_MM[_deze][_BC][+2mm].ext

COPIES them into labels_dir (default: ~/labels):
    unsorted/           <- files that could not be parsed
    ProductName/
      LANG1_LANG2/
        1kg/  5kg/  1L/  Deze/  ...

Source files are NEVER modified or deleted.
"""

import os
import re
import shutil
from datetime import datetime
from pathlib import Path

# -- Defaults ------------------------------------------------------------------
DEFAULT_LABELS_DIR = Path.home() / "labels"

# -- Regex helpers -------------------------------------------------------------
RE_PACKAGING  = re.compile(r'^\d+(\.\d+)?(kg|g|l|ml)(x\d+)?$', re.IGNORECASE)
RE_LANG       = re.compile(r'^[A-Z]{2}$')
RE_DIMENSIONS = re.compile(r'^\d+x\d+$', re.IGNORECASE)
RE_YEAR       = re.compile(r'^(19|20)\d{2}$')
RE_MONTH      = re.compile(r'^(0[1-9]|1[0-2])$')
RE_BLEEDS     = re.compile(r'\+2mm', re.IGNORECASE)
RE_PACK_AMT   = re.compile(r'^(\d+(?:\.\d+)?)(kg|g|l|ml)', re.IGNORECASE)
RE_BARCODE    = re.compile(r'^(BC|BARCODE)$', re.IGNORECASE)

# -- Filename parser -----------------------------------------------------------
def parse_label_filename(stem: str) -> dict | None:
    """Parse a filename stem into its components. Returns a dict or None."""
    clean = RE_BLEEDS.sub('', stem)
    clean = re.sub(r'_NEW_', '_', clean, flags=re.IGNORECASE)
    clean = re.sub(r'_NEW$',  '',  clean, flags=re.IGNORECASE)
    clean = re.sub(r'^NEW_',  '',  clean, flags=re.IGNORECASE)
    clean = clean.strip('_').strip('+').strip()
    parts = clean.split('_')
    if len(parts) < 4:
        return None
    idx = 0
    product_parts = []
    while idx < len(parts):
        if RE_PACKAGING.match(parts[idx]):
            break
        product_parts.append(parts[idx])
        idx += 1
    if not product_parts or idx >= len(parts):
        return None
    product   = ' '.join(product_parts)
    packaging = parts[idx]; idx += 1
    languages = []
    while idx < len(parts) and RE_LANG.match(parts[idx]):
        languages.append(parts[idx]); idx += 1
    if not languages:
        return None
    dimensions = None
    if idx < len(parts) and RE_DIMENSIONS.match(parts[idx]):
        dimensions = parts[idx]; idx += 1
    date = None
    if idx < len(parts) and RE_YEAR.match(parts[idx]):
        year = parts[idx]; idx += 1
        if idx < len(parts) and RE_MONTH.match(parts[idx]):
            date = f"{year}-{parts[idx]}"; idx += 1
        else:
            date = year
    deze = False
    if idx < len(parts) and parts[idx].lower() == 'deze':
        deze = True; idx += 1
    has_barcode = any(RE_BARCODE.match(p) for p in parts)
    return {
        "product":     product,
        "packaging":   packaging,
        "languages":   languages,
        "dimensions":  dimensions,
        "date":        date,
        "deze":        deze,
        "has_barcode": has_barcode,
        "label_type":  "box_label" if deze else "packaging_label",
    }

# -- Destination builder -------------------------------------------------------
def build_destination(info: dict, labels_dir: Path) -> Path:
    product_folder  = info["product"].replace(' ', '_')
    language_folder = '_'.join(info["languages"])
    if info["deze"]:
        pack_folder = "Deze"
    else:
        m = RE_PACK_AMT.match(info["packaging"])
        if m:
            amount = m.group(1).rstrip('0').rstrip('.')
            unit   = m.group(2)
            unit   = 'L' if unit.lower() == 'l' else unit.lower()
            pack_folder = f"{amount}{unit}"
        else:
            pack_folder = info["packaging"]
    return labels_dir / product_folder / language_folder / pack_folder

# -- Ingest function -----------------------------------------------------------
def ingest(source_dir: Path, labels_dir: Path = None, dry_run: bool = False) -> dict:
    """
    Walk source_dir recursively. COPY all design/print files to labels_dir.
    The source directory is NEVER modified.

    Returns:
        {entries: [...], skipped: int, errors: [...], total_found: int, dry_run: bool}
    Each entry has an 'added_at' ISO timestamp.
    """
    source_dir = Path(source_dir)
    if labels_dir is None:
        labels_dir = DEFAULT_LABELS_DIR
    labels_dir   = Path(labels_dir)
    unsorted_dir = labels_dir / "unsorted"

    entries = []
    skipped = 0
    errors  = []
    now_iso = datetime.now().isoformat()

    for root, dirs, files in os.walk(source_dir):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for fname in sorted(files):
            if fname.startswith('.'):
                continue
            src_file  = Path(root) / fname
            ext       = src_file.suffix.lower()
            stem      = src_file.stem
            is_print  = ext == '.pdf' and '2mm' in stem.lower()
            is_design = ext == '.indd'
            if not is_design and not is_print:
                continue

            info      = parse_label_filename(stem)
            dest_dir  = build_destination(info, labels_dir) if info else unsorted_dir
            dest_file = dest_dir / src_file.name
            try:
                rel_path = str(dest_dir.relative_to(labels_dir) / src_file.name)
            except ValueError:
                rel_path = str(dest_file)

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

            entries.append({
                "filename":   src_file.name,
                "path":       rel_path,
                "file_type":  ("print_file" if is_print else info["label_type"]) if info else "unknown",
                "extension":  ext,
                "product":    info["product"]     if info else None,
                "packaging":  info["packaging"]   if info else None,
                "languages":  info["languages"]   if info else None,
                "dimensions": info["dimensions"]  if info else None,
                "date":       info["date"]         if info else None,
                "deze":       info["deze"]         if info else False,
                "has_barcode":info["has_barcode"]  if info else False,
                "print_file": is_print,
                "sorted":     info is not None,
                "wip":        'WIP' in stem,
                "added_at":   now_iso,
            })

    return {
        "entries":     entries,
        "skipped":     skipped,
        "errors":      errors,
        "total_found": len(entries) + skipped + len(errors),
        "dry_run":     dry_run,
    }

# -- Entry point ---------------------------------------------------------------
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(
        description="Copy label files from any folder into ~/labels/."
    )
    parser.add_argument("--source", "-s", required=True,
                        help="Source folder to scan recursively")
    parser.add_argument("--target", "-t", default=str(DEFAULT_LABELS_DIR),
                        help=f"Labels output directory (default: {DEFAULT_LABELS_DIR})")
    parser.add_argument("--dry-run", "-n", action="store_true",
                        help="Preview without copying anything")
    args   = parser.parse_args()
    src    = Path(args.source)
    tgt    = Path(args.target)
    print(f"Source : {src}")
    print(f"Target : {tgt}")
    print("-" * 60)
    result = ingest(src, tgt, dry_run=args.dry_run)
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
