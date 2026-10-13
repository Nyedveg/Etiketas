"""Label filename conventions, shared by the app (etiketas.py) and the folder
organizer (organizer.py) so the two can never disagree about what a name means:

    ProductName[_NEW]_Packaging_LANG1[_LANG2..]_WxH_YYYY_MM[_deze][+2mm_bleeds].ext

Older files differ in small ways (language before the pack size, no pack size
at all, "0,25kg", "2025 11"). Those are understood too, but only with a
Catalogue -- the known products and languages -- to confirm the guess.
"""
import re
from pathlib import Path

RE_PACK     = re.compile(r'^\d+([.,]\d+)?(kg|g|l|ml)(x\d+)?$', re.I)
RE_PACK_AMT = re.compile(r'^(\d+(?:[.,]\d+)?)(kg|g|l|ml)', re.I)
RE_LANG     = re.compile(r'^[A-Z]{2}$')
RE_DIMS     = re.compile(r'^\d+x\d+$', re.I)
RE_YEAR     = re.compile(r'^(19|20)\d{2}$')
RE_MON      = re.compile(r'^(0[1-9]|1[0-2])$')
RE_BLEED    = re.compile(r'\+2mm', re.I)
RE_SPACED_DATE = re.compile(r'(?<=_)((?:19|20)\d{2}) (0[1-9]|1[0-2])(?=_|$)')   # "2025 11" for "2025_11"

# Language codes that were used in filenames for a language that has another, correct code.
LANG_ALIASES = {"BL": "BG"}      # BL was written for Bulgarian

def norm_name(s: str) -> str:
    """Case/space/punctuation-insensitive key, for matching product names to
    logo/QR files and catalogue entries ("Opti Oil" == "OptiOil")."""
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())

def pack_amount(packaging: str):
    """("0,25kgx40" -> (0.25, "kg")), or None if it doesn't start with an amount and unit."""
    m = RE_PACK_AMT.match((packaging or '').strip())
    return (float(m.group(1).replace(',', '.')), m.group(2).lower()) if m else None

class Catalogue:
    """The products and languages the app knows about. With one, a filename's
    product is matched to the catalogue spelling ("pH water power" -> "pH Water
    Power") and the looser older name layouts are accepted; without one only the
    strict current convention is read.

    `pack_for_dims(product_cfg, "150x141")` may be given to tell which pack size
    a label size belongs to for that product (None if it can't say)."""
    def __init__(self, products=(), languages=(), pack_for_dims=None):
        self._by_key = {norm_name(p["name"]): p for p in products}
        self.languages = {l["code"] for l in languages} | set(LANG_ALIASES)
        self.categories = {p["category"] for p in products}      # CE, MO, PAM: also written into names as a tag
        self.pack_for_dims = pack_for_dims

    def product(self, name: str):
        return self._by_key.get(norm_name(name))

def take_date(parts: list, idx: int):
    """Read an optional YYYY[_MM] at parts[idx]. Returns ("YYYY-MM" | "YYYY" | None, next idx)."""
    if idx < len(parts) and RE_YEAR.match(parts[idx]):
        year = parts[idx]
        if idx + 1 < len(parts) and RE_MON.match(parts[idx + 1]):
            return f"{year}-{parts[idx + 1]}", idx + 2
        return year, idx + 1
    return None, idx

def _trailing_langs(tokens: list, cat: Catalogue):
    """Split off the run of known language codes at the end of `tokens`: (rest, langs)."""
    k = len(tokens)
    while k > 1 and tokens[k - 1] in cat.languages:
        k -= 1
    return tokens[:k], [LANG_ALIASES.get(l, l) for l in tokens[k:]]

def _without_category_tag(prod: list, cat: Catalogue):
    """Product words without a trailing category tag ("S power CE"), but only when the tag
    is the category the catalogue gives the product before it -- a CE tag on a PAM product
    is a contradiction that is left for a person to settle."""
    if cat and len(prod) > 1 and prod[-1] in cat.categories:
        base = cat.product(' '.join(prod[:-1]))
        if base and base["category"] == prod[-1]:
            return prod[:-1]
    return prod

def _parse_without_pack(parts: list, cat: Catalogue):
    """Product_LANG..._WxH[_YYYY[_MM]] with no pack size in the name. The pack size is
    taken from the label size, which for a known product points to exactly one."""
    if not cat.pack_for_dims:
        return None
    for j, token in enumerate(parts):
        if RE_DIMS.match(token):
            break
    else:
        return None
    prod, langs = _trailing_langs(parts[:j], cat)
    prod_cfg = cat.product(' '.join(_without_category_tag(prod, cat)))
    if not prod_cfg or not langs:
        return None
    packaging = cat.pack_for_dims(prod_cfg, token.lower())
    date, end = take_date(parts, j + 1)
    leftover = [p for p in parts[end:] if p.lower() != 'bleeds']   # "+2mm_bleeds" leaves a "bleeds"
    if not packaging or leftover:               # anything unexplained left over: don't guess
        return None
    return {"product": prod_cfg["name"], "packaging": packaging, "languages": langs,
            "dimensions": token, "date": date, "deze": False}

def parse_stem(stem: str, cat: Catalogue = None):
    """Split a label filename stem into its parts, or None if it doesn't follow the convention."""
    clean = RE_BLEED.sub('', stem)
    clean = RE_SPACED_DATE.sub(r'\1_\2', clean)
    clean = re.sub(r'_NEW_', '_', clean, flags=re.I)
    clean = re.sub(r'_NEW$', '',  clean, flags=re.I)
    clean = re.sub(r'^NEW_', '',  clean, flags=re.I)
    parts = [p for p in clean.strip('_+ ').split('_') if p]     # "Emundo__NEW" leaves an empty part
    if len(parts) < 3:
        return None
    idx = 0
    prod = []
    while idx < len(parts) and not RE_PACK.match(parts[idx]):
        prod.append(parts[idx]); idx += 1
    if idx >= len(parts):
        return _parse_without_pack(parts, cat) if cat else None
    if len(parts) < 4:
        return None
    packaging = parts[idx]; idx += 1
    langs = []
    while idx < len(parts) and RE_LANG.match(parts[idx]):
        langs.append(LANG_ALIASES.get(parts[idx], parts[idx])); idx += 1
    if not langs and cat:                        # older order: Product_LANG_Pack_...
        prod, langs = _trailing_langs(prod, cat)
        if not cat.product(' '.join(_without_category_tag(prod, cat))):   # a guess this loose is only trusted for a known product
            return None
    prod = _without_category_tag(prod, cat)
    if not prod or not langs:
        return None
    dims = None
    if idx < len(parts) and RE_DIMS.match(parts[idx]):
        dims = parts[idx]; idx += 1
    date, idx = take_date(parts, idx)
    deze = idx < len(parts) and parts[idx].lower() == 'deze'
    product = ' '.join(prod)
    prod_cfg = cat.product(product) if cat else None
    return {"product": prod_cfg["name"] if prod_cfg else product, "packaging": packaging,
            "languages": langs, "dimensions": dims, "date": date, "deze": deze}

def label_kind(extension: str, stem: str):
    """What a file is to the app: 'print' (a +2mm-bleed PDF), 'indd', 'idml', or None (ignored)."""
    ext = extension.lower()
    if ext == '.pdf':
        return 'print' if '2mm' in stem.lower() else None
    return {'.indd': 'indd', '.idml': 'idml'}.get(ext)

def label_entry(rel_path: str, filename: str, cat: Catalogue = None) -> dict:
    """The label-map record for one file (what /api/map serves and the UI lists)."""
    p = Path(filename)
    low = p.stem.lower()
    info = parse_stem(p.stem, cat) or {}
    return {
        "filename":   filename,
        "path":       rel_path,
        "extension":  p.suffix.lower(),
        "product":    info.get("product"),
        "packaging":  info.get("packaging"),
        "languages":  info.get("languages"),
        "dimensions": info.get("dimensions"),
        "date":       info.get("date"),
        "deze":       'deze' in low,
        "print_file": '2mm' in low,
        "sorted":     bool(info),
        "wip":        'WIP' in p.stem,
    }
