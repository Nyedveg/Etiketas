"""Copies label files from any folder into the labels folder, each to where its name places it
(see labelnames.py):

    unsorted/           <- files that could not be parsed, or whose product isn't in the catalogue
    CATEGORY/ProductName/
      LANG1,LANG2/
        1kg/  5kg/  1L/  Box/  ...

Source files are never modified or deleted.
"""
import os
import shutil
from pathlib import Path

from labelnames import Catalogue, label_entry, label_kind, parse_pack, parse_stem

UNSORTED = "unsorted"

def _destination(path: Path, labels_dir: Path, cat: Catalogue) -> Path:
    """The folder a label file belongs in (unsorted/ if its name can't be placed)."""
    info = parse_stem(path.stem, cat)
    prod_cfg = cat.product(info["product"]) if info else None
    if not prod_cfg:
        return labels_dir / UNSORTED
    if info["deze"]:
        pack_folder = "Box"
    else:
        pack = parse_pack(info["packaging"])
        if pack:
            unit = pack.unit.lower()
            pack_folder = f"{pack.amount:g}{'L' if unit == 'l' else unit}"
        else:
            pack_folder = info["packaging"]
    return labels_dir / prod_cfg["category"] / prod_cfg["name"] / ",".join(info["languages"]) / pack_folder

def ingest(source_dir: Path, labels_dir: Path, cat: Catalogue) -> dict:
    """Walk source_dir and copy every design and print file into labels_dir.
    Returns {entries: [label-map records], skipped: n, errors: [{file, error}]}."""
    entries, skipped, errors = [], 0, []
    for root, dirs, files in os.walk(source_dir):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for fname in sorted(files):
            if fname.startswith('.'):
                continue
            src_file = Path(root) / fname
            if label_kind(src_file.suffix, src_file.stem) not in ('indd', 'print'):
                continue
            dest_dir = _destination(src_file, labels_dir, cat)
            dest_file = dest_dir / src_file.name
            if dest_file.exists():
                skipped += 1
                continue
            try:
                dest_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(str(src_file), str(dest_file))
            except Exception as exc:
                errors.append({"file": fname, "error": str(exc)})
                continue
            entries.append(label_entry(str(dest_file.relative_to(labels_dir)), src_file.name, cat))
    return {"entries": entries, "skipped": skipped, "errors": errors}
