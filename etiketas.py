#!/usr/bin/env python3
"""
Etiketas -- Label Manager
Run with:  python etiketas.py
Opens at:  http://localhost:7842
"""

import ctypes, html, io, json, mimetypes, os, re, shutil, socket, stat, sys, threading, time, webbrowser, subprocess, zipfile
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
LOG_FILE   = BASE_DIR / "etiketas.log"
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
STATIC_DIR = BASE_DIR / "static"
LABELS_DIR = Path.home() / "Documents" / "Etiketas"
QR_DIR          = BASE_DIR / "qrcodes"
TEMPLATE_DIR    = BASE_DIR / "templates"
TRANSLATIONS_DIR = BASE_DIR / "translations"
ICONS_DIR       = BASE_DIR / "icons"
LOGO_THUMB_DIR = LABELS_DIR / ".cache" / "logo_thumbs"
FILE_THUMB_DIR = LABELS_DIR / ".cache" / "file_thumbs"
MAP_FILE     = LABELS_DIR / "labels_map.json"
CFG_FILE     = LABELS_DIR / "app_config.json"
COLORS_FILE  = LABELS_DIR / "colors_config.json"
ICON_ASSIGN_FILE = LABELS_DIR / "icon_assignments.json"
HISTORY_FILE = LABELS_DIR / "creation_history.json"
DEFAULT_CFG_FILE = BASE_DIR / "default_config.json"
PORT       = 7842


# ── JSON helpers ───────────────────────────────────────────────────────────────
def load_json(p, fallback=None):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception:
        return fallback

def save_json(p, data):
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    Path(p).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def append_history(entry):
    history = load_json(HISTORY_FILE, [])
    history.insert(0, entry)
    if len(history) > 200:
        history = history[:200]
    save_json(HISTORY_FILE, history)

def _norm_name(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())

def get_icon_assignments(products: list) -> dict:
    """Live product -> [icon id] map (LABELS_DIR/icon_assignments.json).
    Seeded once from icons/icons.json's products[].icons (matched to the
    current product list by normalized name/alias, best-effort -- names
    don't line up exactly, e.g. "Biotero" vs. "BioTero") so a fresh install
    starts with the catalogue's own trait mapping instead of empty."""
    assignments = load_json(ICON_ASSIGN_FILE, None)
    if assignments is not None:
        return assignments
    library = load_json(ICONS_DIR / "icons.json", {})
    by_norm = {}
    for lib_prod in library.get("products", []):
        icons = lib_prod.get("icons", [])
        for nm in [lib_prod.get("name", "")] + lib_prod.get("aliases", []):
            if nm:
                by_norm[_norm_name(nm)] = icons
    assignments = {p["name"]: by_norm.get(_norm_name(p["name"]), []) for p in products}
    save_json(ICON_ASSIGN_FILE, assignments)
    return assignments

# ── Sync status (best-effort: is LABELS_DIR a link into a synced folder?) ──────
def _onedrive_running():
    if os.name != "nt":
        return False
    try:
        r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq OneDrive.exe"],
                            capture_output=True, text=True, timeout=5, creationflags=_NO_WINDOW)
        return "OneDrive.exe" in r.stdout
    except Exception:
        return False

def get_sync_status():
    """Best-effort read of whether LABELS_DIR is a reparse point (junction/symlink)
    into what looks like a OneDrive-synced folder, and whether OneDrive is running.
    This can't see live upload/download progress -- Windows doesn't expose that
    without deep Cloud Filter API/COM integration -- so it only reports the coarse,
    reliably-detectable states: missing, not linked, broken link, or linked."""
    try:
        st = os.lstat(LABELS_DIR)
    except OSError:
        return {"state": "missing", "path": str(LABELS_DIR), "target": None,
                "onedrive_running": _onedrive_running()}

    is_link = bool(st.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT) if os.name == "nt" else os.path.islink(LABELS_DIR)
    if not is_link:
        return {"state": "not_linked", "path": str(LABELS_DIR), "target": None,
                "onedrive_running": _onedrive_running()}

    try:
        target = os.readlink(LABELS_DIR)
    except OSError:
        target = None
    target_path  = Path(target) if target else None
    onedrive_running = _onedrive_running()

    if not target_path or not target_path.exists():
        return {"state": "broken", "path": str(LABELS_DIR), "target": str(target_path) if target_path else None,
                "onedrive_running": onedrive_running}

    looks_like_onedrive = "onedrive" in str(target_path).lower()
    return {
        "state": "active" if onedrive_running else "onedrive_not_running",
        "path": str(LABELS_DIR),
        "target": str(target_path),
        "onedrive_running": onedrive_running,
        "looks_like_onedrive": looks_like_onedrive,
    }

# ── Filename parser ────────────────────────────────────────────────────────────
RE_PACK = re.compile(r'^\d+(\.\d+)?(kg|g|l|ml)(x\d+)?$', re.I)
RE_LANG = re.compile(r'^[A-Z]{2}$')
RE_DIMS = re.compile(r'^\d+x\d+$', re.I)
RE_YEAR = re.compile(r'^(19|20)\d{2}$')
RE_MON  = re.compile(r'^(0[1-9]|1[0-2])$')
RE_BLEED= re.compile(r'\+2mm', re.I)
RE_PACK_AMT = re.compile(r'^(\d+(?:\.\d+)?)(kg|g|l|ml)', re.I)
RE_DIMS_MM  = re.compile(r'^(\d+x\d+)(?:mm)?$', re.I)
RE_NLANG    = re.compile(r'^(\d+)LANG$', re.I)
RE_BOX_MULT = re.compile(r'^(\d+(?:\.\d+)?)(kg|g|l|ml)x(\d+)$', re.I)
RE_TMPL     = re.compile(r'^(MO|PAM|CE)(_PH)?_TEMPLATE_', re.I)

def parse_stem(stem):
    clean = RE_BLEED.sub('', stem)
    clean = re.sub(r'_NEW_', '_', clean, flags=re.I)
    clean = re.sub(r'_NEW$', '',  clean, flags=re.I)
    clean = re.sub(r'^NEW_', '',  clean, flags=re.I)
    clean = clean.strip('_+ ')
    parts = clean.split('_')
    if len(parts) < 4:
        return None
    idx = 0
    prod = []
    while idx < len(parts) and not RE_PACK.match(parts[idx]):
        prod.append(parts[idx]); idx += 1
    if not prod or idx >= len(parts):
        return None
    product   = ' '.join(prod)
    packaging = parts[idx]; idx += 1
    langs = []
    while idx < len(parts) and RE_LANG.match(parts[idx]):
        langs.append(parts[idx]); idx += 1
    if not langs:
        return None
    dims = None
    if idx < len(parts) and RE_DIMS.match(parts[idx]):
        dims = parts[idx]; idx += 1
    date = None
    if idx < len(parts) and RE_YEAR.match(parts[idx]):
        yr = parts[idx]; idx += 1
        if idx < len(parts) and RE_MON.match(parts[idx]):
            date = f"{yr}-{parts[idx]}"; idx += 1
        else:
            date = yr
    deze = False
    if idx < len(parts) and parts[idx].lower() == 'deze':
        deze = True
    return {"product":product,"packaging":packaging,"languages":langs,
            "dimensions":dims,"date":date,"deze":deze,
            "label_type":"box_label" if deze else "packaging_label"}

def parse_template_stem(stem):
    """Parse ~/template naming: {CAT}_TEMPLATE_{size}_{N}LANG_{dims}_{YY}_{MM}[_BOX]"""
    m = RE_TMPL.match(stem)
    if not m:
        return None
    category = m.group(1).upper()
    acidic   = m.group(2) is not None  # True when _PH_ present (e.g. PAM_PH_TEMPLATE_)
    rest = stem[m.end():]
    deze = rest.upper().endswith('_BOX')
    if deze:
        rest = rest[:-4]
    parts = rest.split('_')
    lang_idx = next((i for i, p in enumerate(parts) if RE_NLANG.match(p)), None)
    if lang_idx is None:
        return None
    packaging  = '_'.join(parts[:lang_idx]) or None  # empty = general/universal box template
    lang_count = int(RE_NLANG.match(parts[lang_idx]).group(1))
    idx = lang_idx + 1
    dims = None
    if idx < len(parts):
        dm = RE_DIMS_MM.match(parts[idx])
        if dm:
            dims = dm.group(1); idx += 1
    date = None
    if idx < len(parts) and RE_YEAR.match(parts[idx]):
        yr = parts[idx]; idx += 1
        if idx < len(parts) and RE_MON.match(parts[idx]):
            date = f"{yr}-{parts[idx]}"
        else:
            date = yr
    return {"category": category, "acidic": acidic, "packaging": packaging,
            "lang_count": lang_count, "dimensions": dims, "date": date, "deze": deze}


def _norm_packaging(p: str) -> str:
    """Normalise packaging to kg/L so 250g==0.25kg, 500ml==0.5L, etc."""
    if not p:
        return ''
    m = RE_PACK_AMT.match(p.strip())
    if not m:
        return p.lower().strip()
    amt, unit = float(m.group(1)), m.group(2).lower()
    if unit == 'g':
        return f"{amt/1000:g}kg"
    if unit == 'ml':
        return f"{amt/1000:g}l"
    return f"{amt:g}{unit}"

def scan_templates():
    """Scan ~/template for IDML files using the template naming convention."""
    templates = []
    if not TEMPLATE_DIR.exists():
        return templates
    for root, dirs, fnames in os.walk(TEMPLATE_DIR):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for fname in fnames:
            if fname.startswith('.') or Path(fname).suffix.lower() != '.idml':
                continue
            info = parse_template_stem(Path(fname).stem)
            if not info:
                continue
            full = Path(root) / fname
            templates.append({
                "filename":   fname,
                "path":       str(full),
                "file_type":  "box_label" if info["deze"] else "packaging_label",
                "extension":  ".idml",
                "product":    None,
                "packaging":  info["packaging"],
                "lang_count": info["lang_count"],
                "languages":  None,
                "dimensions": info["dimensions"],
                "date":       info["date"],
                "deze":       info["deze"],
                "acidic":     info["acidic"],
                "print_file": False,
                "category":   info["category"],
                "is_template": True,
                "sorted":     True,
                "wip":        False,
            })
    return templates

# ── Template scoring ───────────────────────────────────────────────────────────
def score_template_detail(entry, target, products):
    """Returns (score, reasons) where reasons=[{text,type}]. type: match/warn/info."""
    reasons = []
    if entry.get("extension") not in (".indd", ".idml"): return -1, []
    if entry.get("print_file"):           return -1, []
    if entry.get("deze") != target.get("deze", False): return -1, []
    is_box = target.get("deze", False)
    if not is_box and entry.get("acidic", False) != target.get("acidic", False):
        return -1, []
    if not is_box and entry.get("dimensions") != target.get("dimensions"):
        return -1, []
    # For labels: reject if template packaging explicitly doesn't match (e.g. 5kg template ≠ 0.25kg request)
    if not is_box and entry.get("packaging") and target.get("packaging") and _norm_packaging(entry["packaging"]) != _norm_packaging(target["packaging"]):
        return -1, []
    s = 0
    # Templates store lang_count directly; regular files use len(languages)
    e_langs = entry.get("lang_count") or len(entry.get("languages") or [])
    t_langs = target.get("lang_count", 0)
    if e_langs == t_langs:
        s += 50
        reasons.append({"text": str(e_langs) + "-language layout matches", "type": "match"})
    else:
        reasons.append({"text": "Layout: " + str(e_langs) + " vs " + str(t_langs) + " langs", "type": "warn"})
    if entry.get("product") and entry.get("product") == target.get("product"):
        s += 25
        reasons.append({"text": "Same product", "type": "match"})
    elif entry.get("is_template"):
        reasons.append({"text": "Generic template", "type": "info"})
    else:
        reasons.append({"text": "Product: " + str(entry.get("product")), "type": "info"})
    if is_box:
        if entry.get("is_template") and not entry.get("packaging"):
            # Universal box template -- pack count gets swapped in at creation time,
            # so it outranks a same-size legacy template when both exist.
            s += 15
            reasons.append({"text": "Universal box template", "type": "match"})
        elif target.get("packaging") and entry.get("packaging") == target.get("packaging"):
            s += 10
            reasons.append({"text": "Qty matches: " + str(entry.get("packaging")), "type": "match"})
        elif target.get("packaging"):
            reasons.append({"text": "Qty: " + str(entry.get("packaging")), "type": "info"})
    else:
        s += 10
        reasons.append({"text": "Size: " + str(entry.get("dimensions")), "type": "match"})
    # Templates carry category directly; regular files look it up from products list
    e_cat = entry.get("category") or next((p["category"] for p in products if p["name"] == entry.get("product")), None)
    if e_cat and e_cat == target.get("category"):
        s += 5
        reasons.append({"text": "Category: " + str(e_cat), "type": "match"})
    if "has_barcode" in target and entry.get("has_barcode") == target["has_barcode"]:
        s += 3
        reasons.append({"text": "Barcode layout matches", "type": "match"})
    # Template library priority: +100 when lang count AND category are a complete match
    if entry.get("is_template") and e_langs == t_langs and e_cat == target.get("category"):
        s += 100
        reasons.append({"text": "Template library — priority", "type": "match"})
    return (s if s > 0 else -1), reasons

def find_templates(files, target, products, n=3):
    """Return up to n best-scored templates as [(file, score, reasons), ...].
    Always merges ~/template entries (priority over regular files on complete match)."""
    lib_templates = scan_templates()
    non_wip = [f for f in files if "WIP" not in f.get("filename", "")]
    pool = lib_templates + (non_wip if non_wip else files)
    scored = []
    for f in pool:
        s, r = score_template_detail(f, target, products)
        if s > 0:
            scored.append((f, s, r))
    scored.sort(key=lambda x: -x[1])
    return scored[:n]

def find_template(files, target, products):
    results = find_templates(files, target, products, 1)
    return (results[0][0], results[0][1]) if results else (None, 0)

# ── Directory scanner ──────────────────────────────────────────────────────────
def scan_labels():
    files = []
    if not LABELS_DIR.exists():
        return files
    for root, dirs, fnames in os.walk(LABELS_DIR):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d.lower() not in ('qrcodes', 'template')]
        for fname in fnames:
            if fname.startswith('.'): continue
            ext  = Path(fname).suffix.lower()
            stem = Path(fname).stem
            is_pdf  = ext == '.pdf' and '2mm' in stem.lower()
            is_indd = ext == '.indd'
            is_idml = ext == '.idml'
            if not is_indd and not is_pdf and not is_idml: continue
            full = Path(root) / fname
            rel  = str(full.relative_to(LABELS_DIR))
            info = parse_stem(stem)
            is_wip = 'WIP' in stem
            files.append({
                "filename":  fname,
                "path":      rel,
                "file_type": ("box_label" if info and info["deze"] else "packaging_label") if info else "unknown",
                "extension": ext,
                "product":   info["product"]    if info else None,
                "packaging": info["packaging"]  if info else None,
                "languages": info["languages"]  if info else None,
                "dimensions":info["dimensions"] if info else None,
                "date":      info["date"]        if info else None,
                "deze":      'deze' in stem.lower(),
                "print_file":stem.lower().__contains__('2mm'),
                "sorted":    info is not None,
                "wip":       is_wip,
            })
    return files

# ── Brand color application ────────────────────────────────────────────────────

# ICC-based sRGB → CMYK transform (Coated FOGRA39, relative colorimetric).
# Built once at import time; falls back to None if Pillow/lcms2 is unavailable.
_ICC_TRANSFORM = None
def _get_icc_transform():
    global _ICC_TRANSFORM
    if _ICC_TRANSFORM is not None:
        return _ICC_TRANSFORM
    try:
        from PIL import ImageCms
        import os
        _PROFILE_DIRS = [
            r"C:\Windows\System32\spool\drivers\color",
            r"C:\Program Files\Common Files\Adobe\Color\Profiles\Recommended",
            r"C:\Program Files\Common Files\Adobe\Color\Profiles",
            r"C:\Program Files (x86)\Common Files\Adobe\Color\Profiles\Recommended",
            r"C:\Program Files (x86)\Common Files\Adobe\Color\Profiles",
        ]
        srgb_path  = next((os.path.join(d, f) for d in _PROFILE_DIRS
                           for f in ("sRGB Color Space Profile.icm", "sRGB.icc")
                           if os.path.exists(os.path.join(d, f))), None)
        fogra_path = next((os.path.join(d, "CoatedFOGRA39.icc") for d in _PROFILE_DIRS
                           if os.path.exists(os.path.join(d, "CoatedFOGRA39.icc"))), None)
        if srgb_path and fogra_path:
            _ICC_TRANSFORM = ImageCms.buildTransform(
                srgb_path, fogra_path, "RGB", "CMYK",
                renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
            )
    except Exception:
        pass
    return _ICC_TRANSFORM

def _hex_to_cmyk(hex_color: str):
    """Convert sRGB hex to CMYK using the Coated FOGRA39 ICC profile (the same
    profile InDesign uses by default for European print work).  This ensures
    the values round-trip correctly when InDesign converts the swatch back to
    RGB.  Falls back to a naive mathematical conversion if the ICC
    profiles are not available on the system."""
    h = hex_color.lstrip('#')
    r_int, g_int, b_int = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)

    transform = _get_icc_transform()
    if transform is not None:
        try:
            from PIL import Image, ImageCms
            img  = Image.new("RGB", (1, 1), (r_int, g_int, b_int))
            cmyk = ImageCms.applyTransform(img, transform).getpixel((0, 0))
            return tuple(round(v / 255 * 100, 2) for v in cmyk)
        except Exception:
            pass

    # Fallback: naive complement on gamma-encoded sRGB (no ICC profile available).
    # Do NOT linearize first — removing gamma before complementing crushes midtones
    # and dumps excess ink (especially K) into colors that shouldn't have any.
    r, g, b = r_int / 255.0, g_int / 255.0, b_int / 255.0
    c_raw, m_raw, y_raw = 1.0 - r, 1.0 - g, 1.0 - b
    k = min(c_raw, m_raw, y_raw)
    if k >= 1.0:
        return 0.0, 0.0, 0.0, 100.0
    d = 1.0 - k
    return (round((c_raw - k) / d * 100, 2),
            round((m_raw - k) / d * 100, 2),
            round((y_raw - k) / d * 100, 2),
            round(k * 100, 2))

def _update_graphic_xml(xml_text: str, colors: list) -> str:
    """Replace ColorValue/Space for Brand1–Brand6 swatches in Graphic.xml content."""
    def make_replacer(c, m, y, k):
        def replacer(match):
            s = match.group(0)
            s = re.sub(r'\bColorValue="[^"]*"', f'ColorValue="{c} {m} {y} {k}"', s)
            s = re.sub(r'\bSpace="[^"]*"', 'Space="CMYK"', s)
            return s
        return replacer
    for i, hex_color in enumerate(colors[:6], 1):
        try:
            c, m, y, k = _hex_to_cmyk(hex_color)
        except Exception:
            continue
        xml_text = re.sub(
            r'<Color\b[^>]*\bName="Brand' + str(i) + r'"[^>]*/?>',
            make_replacer(c, m, y, k),
            xml_text,
        )
    return xml_text

def apply_brand_colors(idml_path: Path, colors: list) -> bool:
    """Rewrite Brand1–Brand6 swatches in an IDML file in-place. Returns True on success."""
    if not colors or not idml_path.exists():
        return False
    buf = io.BytesIO()
    try:
        with zipfile.ZipFile(str(idml_path), 'r') as zin:
            with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    data = zin.read(item.filename)
                    if item.filename == 'Resources/Graphic.xml':
                        data = _update_graphic_xml(data.decode('utf-8'), colors).encode('utf-8')
                    zout.writestr(item, data)
    except Exception:
        return False
    idml_path.write_bytes(buf.getvalue())
    return True

# ── Language translation ────────────────────────────────────────────────────────
_FIELD_KEYS = ['composition', 'carriers', 'form', 'usage', 'preparation', 'storage']

def _replace_story_contents(xml_text, replacements):
    """Replace non-whitespace <Content> values in order with replacements list.
    Extra content nodes beyond len(replacements) are cleared."""
    idx = [0]
    def repl(m):
        if m.group(1).strip():
            val = html.escape(replacements[idx[0]]) if idx[0] < len(replacements) else ''
            idx[0] += 1
            return f'<Content>{val}</Content>'
        return m.group(0)
    return re.sub(r'<Content>(.*?)</Content>', repl, xml_text, flags=re.DOTALL)

def _get_story_replacements(story_title, trans):
    """Return ordered replacement strings for a story given its StoryTitle."""
    if story_title.endswith('_HEADER'):
        header = trans.get('lang1', {}).get('header', '')
        if ' | ' in header:
            prefix, subtitle = header.split(' | ', 1)
            return [prefix + ' | ', subtitle]
        return [header, '']
    if story_title.endswith('_BOX_SECTION'):
        return [
            trans.get('box_section', {}).get('header', ''),
            trans.get('storage', {}).get('label', ''),
            trans.get('storage', {}).get('value', ''),
            trans.get('origin', {}).get('label', ''),
            trans.get('origin', {}).get('value', ''),
        ]
    for key in _FIELD_KEYS:
        if story_title.upper().endswith(f'_FIELD_{key.upper()}'):
            f = trans.get(key, {})
            return [f.get('label', ''), f.get('value', '')]
    for n in range(1, 5):
        if story_title.endswith(f'_BULLET{n}'):
            return [trans.get('lang1', {}).get(f'bullet{n}', '')]
    if story_title.endswith('_MORE_INFO'):
        return [trans.get('more_info', {}).get('label', '')]
    if story_title.endswith('_FOOTER_SKU_BLOCK'):
        f = trans.get('footer', {})
        return [
            f.get('sku_label', ''), '',  # SKU value is left blank -- not sourced from translations
            f.get('mfg_date_label', ''),
            f.get('batch_label', ''),
            f.get('exp_date_label', ''), f.get('exp_date_value', ''),
        ]
    if story_title.endswith('_FOOTER_PRODUCER_BLOCK'):
        f = trans.get('footer', {})
        return [
            f.get('manufacturer_label', ''),
            f.get('manufacturer_company', ''),
            f.get('manufacturer_address1', ''),
            f.get('manufacturer_address2', ''),
            f.get('manufacturer_phone', ''),
            f.get('manufacturer_email', ''),
            f.get('manufacturer_website', ''),
        ]
    if story_title.endswith('_BOX_DATES'):
        f = trans.get('footer', {})
        return [f.get('mfg_date_label', ''), f.get('batch_label', '')]
    return None

# Current templates hold SKU/mfg-date/batch/shelf-life in one shared
# "SHARED_SKU" story (label text baked in once, not per language slot) --
# the older per-language FOOTER_*/LANG{n}_FOOTER_* story names this module
# used to target don't exist in any current template, so that path was a
# silent no-op. Manufacturing date and batch number are stamped on later at
# the print line, so only their *labels* live in the template -- there is
# deliberately no value to write for those two. SKU code and shelf life ARE
# set at creation time -- SKU from the wizard (per label/batch), shelf life
# from the translation file (per product).
#
# InDesign frequently splits one logical run of text into several <Content>
# runs when formatting changes mid-run, so the number of runs per field
# varies between templates (a bare label may be 1 run; a label with a
# placeholder value after it may be 2-3). Rather than assume a fixed layout,
# this locates the mfg-date/batch-label runs by text and infers the
# SKU-value and shelf-life-value run spans around them.
_MFG_LABEL_MARKERS   = ['pagaminimo data', 'date of manufacture', 'manufacturing date']
_BATCH_LABEL_MARKERS = ['partijos numeris', 'batch number', 'batch no']
_SHELF_LABEL_MARKERS = ['galiojimo laikas', 'shelf life', 'best before', 'expiry']

def _find_run_index(contents, markers):
    for i, c in enumerate(contents):
        low = c.lower()
        if any(mk in low for mk in markers):
            return i
    return None

def _fill_shared_sku_xml(xml_text, sku_value, shelf_value):
    """Return updated XML for a SHARED_SKU story, or None if its structure
    wasn't recognized (left untouched rather than guessed at)."""
    contents = re.findall(r'<Content>(.*?)</Content>', xml_text, re.DOTALL)
    if not contents:
        return None
    mfg_i = _find_run_index(contents, _MFG_LABEL_MARKERS)
    if mfg_i is None or mfg_i + 1 >= len(contents):
        return None
    batch_i = mfg_i + 1
    if not any(mk in contents[batch_i].lower() for mk in _BATCH_LABEL_MARKERS):
        return None
    shelf_label_i = batch_i + 1
    has_shelf_label = shelf_label_i < len(contents) and any(
        mk in contents[shelf_label_i].lower() for mk in _SHELF_LABEL_MARKERS)

    new_contents = list(contents)
    # SKU value lives in run(s) between the SKU label (run 0) and the
    # mfg-date label -- blank any separator runs, put the value in the last.
    if sku_value and mfg_i >= 2:
        for i in range(1, mfg_i):
            new_contents[i] = ''
        new_contents[mfg_i - 1] = sku_value
    # Shelf-life value lives in run(s) after the shelf-life label.
    if shelf_value and has_shelf_label and shelf_label_i + 1 < len(contents):
        for i in range(shelf_label_i + 1, len(contents)):
            new_contents[i] = ''
        new_contents[-1] = shelf_value

    if new_contents == contents:
        return None
    idx = [0]
    def repl(m):
        val = html.escape(new_contents[idx[0]])
        idx[0] += 1
        return f'<Content>{val}</Content>'
    return re.sub(r'<Content>(.*?)</Content>', repl, xml_text, flags=re.DOTALL)

def apply_footer_content(idml_path: Path, translations: list, footer_values: dict = None) -> bool:
    """Fill the SHARED_SKU story's SKU-code and shelf-life values.
    translations: list of translation dicts (may contain None for skipped slots).
    footer_values: dict from the wizard, keyed 'sku' (and, currently unused,
    'ufi'/'manufacturer_value'). SKU comes from here rather than the
    translation file -- the same translation can be reused across different
    markets/production batches, each with its own SKU, so SKU belongs to the
    label being created, not the shared translated text. Shelf life is the
    opposite: it's a property of the product/translation, not the batch, so
    it's still sourced from the translation file, first non-blank one wins
    across the selected languages.
    """
    sku_value = (footer_values or {}).get('sku', '')
    shelf_value = next((t.get('footer', {}).get('exp_date_value', '')
                         for t in translations if t and t.get('footer', {}).get('exp_date_value')), '')
    if not sku_value and not shelf_value:
        return True  # nothing to write -- not an error

    buf = io.BytesIO()
    touched = False
    try:
        with zipfile.ZipFile(str(idml_path), 'r') as zin:
            with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    data = zin.read(item.filename)
                    if item.filename.startswith('Stories/'):
                        xml = data.decode('utf-8')
                        m = re.search(r'StoryTitle="([^"]+)"', xml)
                        if m and m.group(1) == 'SHARED_SKU':
                            new_xml = _fill_shared_sku_xml(xml, sku_value, shelf_value)
                            if new_xml is not None:
                                xml = new_xml
                                touched = True
                        data = xml.encode('utf-8')
                    zout.writestr(item, data)
    except Exception:
        return False
    if touched:
        idml_path.write_bytes(buf.getvalue())
    return True

def apply_lang_translation(idml_path: Path, slot: int, trans: dict) -> bool:
    """Replace LANG{slot}_* story contents in an IDML file with translated text."""
    prefix = f'LANG{slot}_'
    buf = io.BytesIO()
    try:
        with zipfile.ZipFile(str(idml_path), 'r') as zin:
            with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    data = zin.read(item.filename)
                    if item.filename.startswith('Stories/'):
                        xml = data.decode('utf-8')
                        m = re.search(r'StoryTitle="([^"]+)"', xml)
                        if m and m.group(1).startswith(prefix):
                            texts = _get_story_replacements(m.group(1), trans)
                            if texts is not None:
                                xml = _replace_story_contents(xml, texts)
                        data = xml.encode('utf-8')
                    zout.writestr(item, data)
    except Exception:
        return False
    idml_path.write_bytes(buf.getvalue())
    return True

def _format_box_weight_text(box_mult: str) -> str:
    """Turn a boxMultiplier code like '1kgx10' into display text '1 kg x 10'."""
    m = RE_BOX_MULT.match(box_mult or '')
    if not m:
        return box_mult or ''
    amount, unit, count = m.groups()
    return f"{amount} {unit} x {count}"

def apply_box_weight_text(idml_path: Path, box_mult: str) -> bool:
    """Set the SHARED_WEIGHT story's text to this box's pack size and count.
    Not language-specific -- applied once per box file regardless of language slots."""
    weight_text = _format_box_weight_text(box_mult)
    buf = io.BytesIO()
    try:
        with zipfile.ZipFile(str(idml_path), 'r') as zin:
            with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    data = zin.read(item.filename)
                    if item.filename.startswith('Stories/'):
                        xml = data.decode('utf-8')
                        m = re.search(r'StoryTitle="([^"]+)"', xml)
                        if m and m.group(1) == 'SHARED_WEIGHT':
                            xml = _replace_story_contents(xml, [weight_text])
                        data = xml.encode('utf-8')
                    zout.writestr(item, data)
    except Exception:
        return False
    idml_path.write_bytes(buf.getvalue())
    return True

def get_translations_dir(cfg: dict = None) -> Path:
    """Live translations folder -- cfg['translationsDir'] if the user has set
    one (Settings -> Paths), else the app's own bundled "translations" folder."""
    if cfg is None:
        cfg = load_json(CFG_FILE, load_json(DEFAULT_CFG_FILE, {}))
    override = cfg.get("translationsDir")
    return Path(override) if override else TRANSLATIONS_DIR

def list_translations(translations_dir: Path = None):
    files = []
    translations_dir = translations_dir or TRANSLATIONS_DIR
    if not translations_dir.exists():
        return files
    for f in sorted(translations_dir.rglob("*.json")):
        try:
            meta = load_json(f, {}).get('meta', {})
            files.append({
                "filename": f.name,
                "path":     str(f),
                "code":     meta.get('code', f.stem),
                "name":     meta.get('name', f.stem),
                "flag":     meta.get('flag', ''),
                "product":  meta.get('product', None),
                # Set by Etiketas+ when it authors a file. Missing/unknown status is
                # treated as draft -- conservative, since completeness is unverified.
                "status":   meta.get('status') or 'draft',
            })
        except Exception:
            files.append({"filename": f.name, "path": str(f), "code": f.stem, "name": f.stem, "flag": "", "product": None, "status": "draft"})
    return files

# ── Label creation ─────────────────────────────────────────────────────────────
def create_label(product, languages, packaging_size, config, label_template_path=None, box_template_path=None, lang_files=None, footer_values=None, skip_label=False, skip_box=False):
    prods    = config.get("products", [])
    prod_cfg = next((p for p in prods if p["name"]==product), None)
    if not prod_cfg:
        raise ValueError(f"Product not found: {product}")

    category = prod_cfg["category"]
    acidic   = prod_cfg.get("acidic", False)
    unit     = prod_cfg.get("unit", "L" if category == "PAM" else "kg")
    if category == "PAM":
        dim_key = "PAM_acidic" if acidic else "PAM_normal"
    elif category == "CE":
        dim_key = "CE_solid" if unit == "kg" else "CE"
    elif category == "MO":
        dim_key = "MO_liquid" if unit == "L" else "MO"
    else:
        dim_key = "MO"
    dims     = config["dimensions"].get(dim_key, {}).get(packaging_size)
    if not dims:
        raise ValueError(f"No dimensions for {dim_key}/{packaging_size}")

    box_mult  = config.get("boxMultipliers", {}).get(packaging_size, packaging_size)
    map_data  = load_json(MAP_FILE, {"files": []})
    all_files = map_data.get("files", [])

    # Resolve templates before computing names (templates may be absolute-path entries)
    all_pool = all_files + scan_templates()
    if skip_label:
        label_tmpl, label_score = None, 0
    elif label_template_path:
        label_tmpl  = next((f for f in all_pool if f.get("path") == label_template_path), None)
        label_score = 0
    else:
        label_tmpl, label_score = find_template(all_files,
            {"product":product,"category":category,"dimensions":dims,
             "lang_count":len(languages),"deze":False,"packaging":packaging_size,
             "acidic":acidic}, prods)

    if skip_box:
        box_tmpl, box_score = None, 0
    elif box_template_path:
        box_tmpl  = next((f for f in all_pool if f.get("path") == box_template_path), None)
        box_score = 0
    else:
        box_tmpl, box_score = find_template(all_files,
            {"product":product,"category":category,"dimensions":"180x180",
             "lang_count":len(languages),"deze":True,"packaging":box_mult}, prods)

    lang_str   = "_".join(languages)
    now        = datetime.now()
    date_str   = f"{now.year}_{now.month:02d}"
    label_ext  = label_tmpl.get("extension", ".idml") if label_tmpl else ".idml"
    box_ext    = box_tmpl.get("extension",   ".idml") if box_tmpl   else ".idml"
    label_name = f"{product}_{packaging_size}_{lang_str}_{dims}_{date_str}_WIP{label_ext}"
    box_name   = f"{product}_{box_mult}_{lang_str}_180x180_{date_str}_deze_WIP{box_ext}"

    lang_folder = ",".join(languages)
    label_dir = LABELS_DIR / category / product / lang_folder / packaging_size
    box_dir   = LABELS_DIR / category / product / lang_folder / "Box"

    results     = []
    new_entries = []

    prod_colors = load_json(COLORS_FILE, {}).get(product, [])
    qr_path     = find_qr_for_product(product)
    logo_path   = find_logo_for_product(product)
    icon_lib    = {ic["id"]: ic for ic in load_json(ICONS_DIR / "icons.json", {}).get("icons", [])}
    trait_icons = [ICONS_DIR / icon_lib[i]["svg"]
                   for i in get_icon_assignments(prods).get(product, [])
                   if i in icon_lib and (ICONS_DIR / icon_lib[i]["svg"]).is_file()]
    # Pre-load translation data for each slot (None = skip)
    translations = []
    for lf in (lang_files or []):
        translations.append(load_json(lf) if lf else None)

    def make_file(tmpl, dest_dir, dest_name, apply_qr=False, apply_weight=False):
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / dest_name
        if dest_path.exists():
            raise FileExistsError(f"File already exists: {dest_path}")
        ops = {"colors": None, "qr": None, "logo": None, "translations": []}
        if tmpl:
            src_p = tmpl.get("path", "")
            src   = Path(src_p) if Path(src_p).is_absolute() else LABELS_DIR / src_p
            shutil.copy2(src, dest_path)
            if dest_path.suffix.lower() == '.idml':
                if prod_colors:
                    ops["colors"] = apply_brand_colors(dest_path, prod_colors)
                if apply_qr and qr_path and tmpl.get("is_template"):
                    ops["qr"] = patch_qr_in_idml(dest_path, qr_path)
                if logo_path:
                    ops["logo"] = patch_logo_in_idml(dest_path, logo_path)
                if apply_weight:
                    ops["weight"] = apply_box_weight_text(dest_path, box_mult)
                for slot_idx, trans in enumerate(translations):
                    if trans:
                        ok = apply_lang_translation(dest_path, slot_idx + 1, trans)
                        ops["translations"].append(ok)
                    else:
                        ops["translations"].append(None)  # skipped
                if apply_qr:  # label only (apply_qr=True for label) -- SKU/shelf-life
                    # come from the translation file, so this should run regardless
                    # of whether the wizard's (now-legacy) SKU/UFI fields were used.
                    ops["footer"] = apply_footer_content(dest_path, translations, footer_values)
                    ops["icons"]  = apply_trait_icons(dest_path, trait_icons)
        else:
            dest_path.write_bytes(b"")
        return dest_path, ops

    if not skip_label:
        label_path, label_ops = make_file(label_tmpl, label_dir, label_name, apply_qr=True)
        results.append({
            "type":      "packaging_label",
            "path":      str(label_path),
            "rel_path":  str(label_path.relative_to(LABELS_DIR)),
            "filename":  label_name,
            "template":  label_tmpl["filename"] if label_tmpl else None,
            "score":     label_score,
            "ops":       label_ops,
        })
        new_entries.append({
            "filename":  label_name,
            "path":      str(label_path.relative_to(LABELS_DIR)),
            "file_type": "packaging_label",
            "extension": label_ext,
            "product":   product,
            "packaging": packaging_size,
            "languages": languages,
            "dimensions":dims,
            "date":      date_str.replace("_","-"),
            "deze":      False,
            "print_file":False,
            "sorted":    True,
            "wip":       True,
        })

    if not skip_box:
        box_path, box_ops = make_file(box_tmpl, box_dir, box_name, apply_qr=False, apply_weight=True)
        results.append({
            "type":      "box_label",
            "path":      str(box_path),
            "rel_path":  str(box_path.relative_to(LABELS_DIR)),
            "filename":  box_name,
            "template":  box_tmpl["filename"] if box_tmpl else None,
            "score":     box_score,
            "ops":       box_ops,
        })
        new_entries.append({
            "filename":  box_name,
            "path":      str(box_path.relative_to(LABELS_DIR)),
            "file_type": "box_label",
            "extension": box_ext,
            "product":   product,
            "packaging": box_mult,
            "languages": languages,
            "dimensions":"180x180",
            "date":      date_str.replace("_","-"),
            "deze":      True,
            "print_file":False,
            "sorted":    True,
            "wip":       True,
        })

    # Update map
    idx_map = {f["filename"]: f for f in all_files}
    for e in new_entries:
        idx_map[e["filename"]] = e
    map_data["files"]     = sorted(idx_map.values(), key=lambda x: x["path"])
    map_data["generated"] = datetime.now().isoformat()
    save_json(MAP_FILE, map_data)

    append_history({
        "timestamp":    datetime.now().isoformat(),
        "product":      product,
        "languages":    languages,
        "packagingSize": packaging_size,
        "files": [
            {"type": r["type"], "filename": r["filename"], "path": r["path"]}
            for r in results
        ],
    })

    return {"results": results}

# ── QR code helpers ────────────────────────────────────────────────────────────
def find_qr_for_product(product_name):
    """Find *_QR.png in QR_DIR matching product_name (fuzzy, case/space insensitive)."""
    if not QR_DIR.exists():
        return None
    def norm(s):
        return re.sub(r'[^a-z0-9]', '', s.lower())
    prod_n = norm(product_name)
    for c in sorted(QR_DIR.glob("*_QR.png")):
        name_part = re.sub(r'_qr$', '', c.stem.lower())
        if re.sub(r'[^a-z0-9]', '', name_part) == prod_n:
            return c
    return None

def find_logo_for_product(product_name):
    """Find {name}_LOGO.* in logos dir (case/space insensitive)."""
    logos_dir = BASE_DIR / "logos"
    if not logos_dir.exists():
        return None
    def norm(s): return re.sub(r'[^a-z0-9]', '', s.lower())
    target = norm(product_name) + "logo"
    for f in sorted(logos_dir.iterdir()):
        if f.is_file() and norm(f.stem) == target:
            return f
    return None

def _trim_to_content(img):
    """Crop away transparent/white padding so a logo's real ink bounds fill the frame."""
    from PIL import Image, ImageChops
    bbox = img.split()[-1].getbbox()  # alpha-channel bbox — trims true transparency
    if bbox and (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) < 0.98 * img.width * img.height:
        return img.crop(bbox)
    # Page had an opaque (e.g. white) background instead of transparency — trim near-white margins.
    rgb = img.convert('RGB')
    diff = ImageChops.difference(rgb, Image.new('RGB', rgb.size, (255, 255, 255)))
    bbox = diff.getbbox()
    return img.crop(bbox) if bbox else img

def render_logo_thumbnail(pdf_path: Path, size: int = 240) -> bytes:
    """Rasterize page 1 of a logo PDF into a transparent PNG thumbnail, cropped to its ink."""
    import fitz  # PyMuPDF
    from PIL import Image
    doc = fitz.open(str(pdf_path))
    try:
        page = doc.load_page(0)
        dim  = max(page.rect.width, page.rect.height, 1)
        # Floor of 4x gives small logos a crisp render to crop/downsample from,
        # but oversized artboards (e.g. a die-line page mistakenly used as the
        # logo source) must not be rendered at 4x too -- MuPDF refuses to
        # rasterize a pixmap past its internal size limit ("Overly large image").
        zoom = min(max(4.0, size / dim), 3000 / dim)
        pix  = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=True)
        img  = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)
        img  = _trim_to_content(img)
        img.thumbnail((size, size), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue()
    finally:
        doc.close()

def get_logo_thumbnail(product_name: str):
    """Return cached PNG bytes for a product's logo, rendering + caching on first request."""
    logo_path = find_logo_for_product(product_name)
    if not logo_path:
        return None
    slug  = re.sub(r'[^a-zA-Z0-9]+', '_', product_name).strip('_')
    cache_file = LOGO_THUMB_DIR / f"{slug}_{int(logo_path.stat().st_mtime)}.png"
    if cache_file.exists():
        return cache_file.read_bytes()
    try:
        data = render_logo_thumbnail(logo_path)
    except Exception:
        return None
    LOGO_THUMB_DIR.mkdir(parents=True, exist_ok=True)
    for stale in LOGO_THUMB_DIR.glob(f"{slug}_*.png"):
        try: stale.unlink()
        except Exception: pass
    cache_file.write_bytes(data)
    return data

# ── File preview + metadata (Browse Files) ──────────────────────────────────────
# PDFs are rasterized. IDML/INDD can't be rendered without InDesign itself
# (PyMuPDF opens an IDML but reports 0 pages), so for those the preview is the
# thumbnail InDesign embeds in the file's XMP metadata, as of its last save.
_PREVIEW_EXTS = ('.pdf', '.idml', '.indd')

def _resolve_label_path(rel_path: str, exts=_PREVIEW_EXTS):
    """Validate a client-supplied path as an in-bounds file under LABELS_DIR with
    one of the given extensions. Returns the resolved Path, or None."""
    if not rel_path or Path(rel_path).suffix.lower() not in exts:
        return None
    full = (LABELS_DIR / rel_path).resolve()
    try:
        full.relative_to(LABELS_DIR.resolve())
    except ValueError:
        return None  # outside LABELS_DIR -- reject
    if not full.is_file():
        return None
    return full

_XMP_IMG_OPEN, _XMP_IMG_CLOSE = b"<xmpGImg:image>", b"</xmpGImg:image>"
_B64_RUN = re.compile(rb"(?:[A-Za-z0-9+/=\r\n ]|&#x[0-9A-Fa-f]+;)+")

def _xmp_images(buf: bytes) -> list:
    """Decode the xmpGImg thumbnails in an XMP text buffer, preferring the
    per-page ones (xmpTPg:PageNumber). An INDD can store one image body in
    several separate extents with binary junk between them, so after the opening
    tag this follows the long base64 runs in file order up to the closing tag.
    Every image must then decode completely or it is dropped -- a damaged read
    can never produce a broken preview -- and page thumbnails are only returned
    as an unbroken run from page 1, so a missing page can't shift the numbering."""
    import base64
    from PIL import Image
    pages, others, pos = {}, [], 0
    while True:
        i = buf.find(_XMP_IMG_OPEN, pos)
        if i < 0:
            break
        j = pos = i + len(_XMP_IMG_OPEN)
        parts = []
        for k, m in enumerate(_B64_RUN.finditer(buf, j, j + 600_000)):
            run, last = m.group(0), buf.startswith(_XMP_IMG_CLOSE, m.end())
            if k == 0 and m.start() != j:
                break                          # body must start right after the tag
            if k > 0 and len(run) < 200 and not last:
                continue                       # junk between extents
            parts.append(run)
            if last:
                break
        else:
            parts = []                         # never reached the closing tag
        b64 = re.sub(rb"[^A-Za-z0-9+/]", b"", re.sub(rb"&#x[0-9A-Fa-f]+;", b"", b"".join(parts)))
        if not b64:
            continue
        try:
            data = base64.b64decode(b64 + b"=" * (-len(b64) % 4))
            Image.open(io.BytesIO(data)).load()
        except Exception:
            continue
        num = re.findall(rb"<xmpTPg:PageNumber>(\d+)<", buf[max(0, i - 500):i])
        if num:
            pages.setdefault(int(num[-1]), data)
        else:
            others.append(data)
    if pages:
        run, n = [], 1
        while n in pages:
            run.append(pages[n])
            n += 1
        return run
    return others

def _indd_previews(data: bytes) -> list:
    """INDD is stored in 4096-byte pages whose last 144 bytes aren't payload,
    and every save appends a fresh XMP packet without erasing the old ones. So:
    drop the page tails, then use the page thumbnails of the packet(s) with the
    newest xmp:ModifyDate. The newest packet is often the one whose pages end up
    scattered and unreadable, but an older packet with the *same* ModifyDate is
    the same save (InDesign writes the metadata more than once per save), so
    that is an equally current preview. A packet from an earlier save never is
    used: no preview is better than an out-of-date one."""
    flat = b"".join(data[o:o + 3952] for o in range(0, len(data), 4096))
    begins = [m.start() for m in re.finditer(rb"<\?xpacket begin", flat)]
    packets = []
    for n, b in enumerate(begins):
        seg = flat[b:begins[n + 1] if n + 1 < len(begins) else len(flat)]
        mod = re.search(rb"<xmp:ModifyDate>([^<]*)</xmp:ModifyDate>", seg)
        packets.append((mod.group(1) if mod else b"", b, seg))
    if not packets:
        return []
    newest = max(p[0] for p in packets)
    for date, _, seg in sorted(packets, key=lambda p: p[1], reverse=True):
        if date == newest:
            imgs = _xmp_images(seg)
            if imgs:
                return imgs
    return []

_preview_cache = {}   # (path, mtime_ns) -> [jpeg bytes]

def embedded_previews(full: Path) -> list:
    """Page thumbnails InDesign embedded in an IDML/INDD file (JPEG bytes)."""
    key = (str(full), full.stat().st_mtime_ns)
    if key in _preview_cache:
        return _preview_cache[key]
    try:
        if full.suffix.lower() == '.idml':
            with zipfile.ZipFile(full) as z:
                previews = _xmp_images(z.read("META-INF/metadata.xml"))
        else:
            previews = _indd_previews(full.read_bytes())
    except Exception:
        previews = []
    if len(_preview_cache) >= 64:
        _preview_cache.pop(next(iter(_preview_cache)))
    _preview_cache[key] = previews
    return previews

def _idml_color_settings(full: Path) -> dict:
    """The document's CMYK/RGB working profiles, from designmap.xml."""
    with zipfile.ZipFile(full) as z:
        head = z.read("designmap.xml").decode("utf-8", "replace")
    doc = re.search(r"<Document\b[^>]*>", head)
    attrs = doc.group(0) if doc else ""
    get = lambda a: (re.search(rf'\b{a}="([^"]*)"', attrs) or [None, None])[1]
    return {"cmyk": get("CMYKProfile"), "rgb": get("RGBProfile")}

def _icc_space(p: bytes):
    if len(p) < 132 or p[36:40] != b"acsp":
        return None
    sig = p[16:20].decode("latin1").strip()
    return {"GRAY": "Gray"}.get(sig, sig)

def _icc_description(p: bytes):
    """Human-readable profile name from an ICC profile's 'desc' tag (v2 or v4)."""
    count = int.from_bytes(p[128:132], "big")
    for i in range(min(count, 64)):
        e = 132 + 12 * i
        if p[e:e + 4] != b"desc":
            continue
        off, size = int.from_bytes(p[e + 4:e + 8], "big"), int.from_bytes(p[e + 8:e + 12], "big")
        tag = p[off:off + size]
        if tag[:4] == b"desc":
            n = int.from_bytes(tag[8:12], "big")
            return tag[12:12 + n].split(b"\0")[0].decode("latin1").strip() or None
        if tag[:4] == b"mluc":
            ln, o = int.from_bytes(tag[20:24], "big"), int.from_bytes(tag[24:28], "big")
            return tag[o:o + ln].decode("utf-16-be", "replace").strip() or None
    return None

def _pdf_color_info(doc) -> dict:
    """Embedded ICC profiles and the output intent (if any) found in the PDF."""
    profiles, seen_refs, intent = [], set(), None
    for x in range(1, doc.xref_length()):
        try:
            obj = doc.xref_object(x)
        except Exception:
            continue
        for ref in re.findall(r"/ICCBased\s+(\d+)\s+0\s+R", obj):
            if ref in seen_refs:
                continue
            seen_refs.add(ref)
            try:
                prof = doc.xref_stream(int(ref))
            except Exception:
                continue
            space = _icc_space(prof)
            entry = {"space": space, "name": _icc_description(prof)} if space else None
            if entry and entry not in profiles:
                profiles.append(entry)
        if "/OutputConditionIdentifier" in obj and intent is None:
            m = re.search(r"/OutputConditionIdentifier\s*\(((?:\\.|[^\\)])*)\)", obj)
            intent = m.group(1) if m else None
    return {"profiles": profiles, "output_intent": intent}

def _pdf_size_mm(doc) -> list:
    """First page's size in mm as the PDF defines it (bleed included, if any)."""
    r = doc.load_page(0).rect
    return [round(r.width / 72 * 25.4, 1), round(r.height / 72 * 25.4, 1)]

def get_file_info(rel_path: str):
    """Metadata for the Browse Files preview panel, or None for a bad path.
    Deliberately no author and no filesystem/XMP dates: authors aren't recorded
    in these files, and dates inherited from templates or reset by OneDrive
    sync would mislead. 'rev' is only a cache-busting token for thumbnails."""
    full = _resolve_label_path(rel_path)
    if full is None:
        return None
    ext, st = full.suffix.lower(), full.stat()
    info = {"kind": ext[1:], "size_bytes": st.st_size, "rev": int(st.st_mtime), "page_count": 0}
    try:
        if ext == '.pdf':
            import fitz  # PyMuPDF
            doc = fitz.open(str(full))
            try:
                info["page_count"] = doc.page_count
                if doc.page_count:
                    info["size_mm"] = _pdf_size_mm(doc)
                info["color"] = _pdf_color_info(doc)
            finally:
                doc.close()
        else:
            info["page_count"] = len(embedded_previews(full))
            if ext == '.idml':
                info["color"] = _idml_color_settings(full)
    except Exception:
        pass
    return info

def render_file_thumbnail(pdf_path: Path, page: int = 0, size: int = 320) -> bytes:
    """Rasterize one page of a print PDF into a preview PNG, full page (no
    ink-crop -- unlike a logo, the whole page *is* the label's content)."""
    import fitz  # PyMuPDF
    from PIL import Image
    doc = fitz.open(str(pdf_path))
    try:
        idx  = max(0, min(page, doc.page_count - 1))
        pg   = doc.load_page(idx)
        dim  = max(pg.rect.width, pg.rect.height, 1)
        zoom = min(max(2.0, size / dim), 3000 / dim)  # same oversized-page guard as logos
        pix  = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        img  = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        img.thumbnail((size, size), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue()
    finally:
        doc.close()

def get_file_thumbnail(rel_path: str, page: int = 0):
    """(bytes, mime) for one page preview of a PDF (rendered, cached on disk),
    or of an IDML/INDD (InDesign's embedded thumbnail). None for anything that
    isn't a real, in-bounds file with a preview (also guards path traversal)."""
    full = _resolve_label_path(rel_path)
    if full is None:
        return None
    if full.suffix.lower() != '.pdf':
        previews = embedded_previews(full)
        return (previews[page], "image/jpeg") if 0 <= page < len(previews) else None
    slug  = re.sub(r'[^a-zA-Z0-9]+', '_', rel_path).strip('_')
    mtime = int(full.stat().st_mtime)
    cache_file = FILE_THUMB_DIR / f"{slug}_{mtime}_p{page}.png"
    if cache_file.exists():
        return cache_file.read_bytes(), "image/png"
    try:
        data = render_file_thumbnail(full, page=page)
    except Exception:
        return None
    FILE_THUMB_DIR.mkdir(parents=True, exist_ok=True)
    # Only purge pages cached under a stale (pre-regeneration) mtime -- pages
    # already cached under the current mtime must survive so a multi-page
    # preview doesn't evict itself one page at a time as each page loads.
    for stale in FILE_THUMB_DIR.glob(f"{slug}_*.png"):
        if f"{slug}_{mtime}_" not in stale.name:
            try: stale.unlink()
            except Exception: pass
    cache_file.write_bytes(data)
    return data, "image/png"

def patch_logo_in_idml(idml_path, logo_path) -> bool:
    """Replace logo LinkResourceURI (_LOGO) in an IDML file in-place. Returns True on success."""
    logo_uri  = Path(logo_path).as_uri()
    idml_path = Path(idml_path)
    try:
        entries, order = {}, []
        with zipfile.ZipFile(io.BytesIO(idml_path.read_bytes()), 'r') as zin:
            for info in zin.infolist():
                entries[info.filename] = (info, zin.read(info.filename))
                order.append(info.filename)
        patched = False
        for name in order:
            info, data = entries[name]
            if not name.endswith('.xml'):
                continue
            text = data.decode('utf-8', errors='replace')
            if '_logo' not in text.lower():
                continue
            new_text = re.sub(
                r'LinkResourceURI="[^"]*_LOGO\.[^"]*"',
                f'LinkResourceURI="{logo_uri}"',
                text, flags=re.IGNORECASE,
            )
            if new_text != text:
                entries[name] = (info, new_text.encode('utf-8'))
                patched = True
        if not patched:
            return False
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as zout:
            for name in order:
                info, data = entries[name]
                ctype = zipfile.ZIP_STORED if name == 'mimetype' else zipfile.ZIP_DEFLATED
                zi = zipfile.ZipInfo(name)
                zi.date_time = info.date_time
                zout.writestr(zi, data, compress_type=ctype)
        idml_path.write_bytes(out.getvalue())
        return True
    except Exception:
        return False

_TRAIT_SLOT_RE = re.compile(r'TRAIT_SLOT_(\d+)\.svg', re.IGNORECASE)
_TRAIT_URI_RE  = re.compile(r'(?<=")file:[^"]*?TRAIT_SLOT_\d+\.svg(?=")', re.IGNORECASE)

def _fill_trait_slots_xml(text: str, icon_uris: list):
    """Relink TRAIT_SLOT_n graphic frames to icon_uris[n-1] and delete the
    frames beyond len(icon_uris). Returns (new_text, slot_count)."""
    blocks, pos = [], 0
    while True:
        s = text.find('<Rectangle', pos)
        if s == -1:
            break
        e = text.find('</Rectangle>', s)
        if e == -1:
            break
        e += len('</Rectangle>')
        m = _TRAIT_SLOT_RE.search(text, s, e)
        if m and text[s + len('<Rectangle')] in ' \t\r\n>':
            blocks.append((s, e, int(m.group(1))))
        pos = e
    if not blocks:
        return text, 0
    # Slots live in an InDesign Flex container (right-anchored row); the same
    # container is dropped entirely if every slot ends up empty.
    first_s = blocks[0][0]
    fo_start = text.rfind('<FlexObject', 0, first_s)
    last_e = blocks[-1][1]
    fo_close = text.find('</FlexObject>', last_e)
    only_slots = (
        fo_start != -1 and fo_close != -1
        and text.count('<Rectangle', fo_start, fo_close) == len(blocks)
        and text.count('<FlexObject', fo_start, fo_close) == 1
    )
    for s, e, n in reversed(blocks):
        if n <= len(icon_uris):
            uri = icon_uris[n - 1]
            text = text[:s] + _TRAIT_URI_RE.sub(lambda _m: uri, text[s:e]) + text[e:]
        else:
            ls = s
            while ls > 0 and text[ls - 1] in ' \t':
                ls -= 1
            le = e
            if text.startswith('\r\n', le):
                le += 2
            elif text.startswith('\n', le):
                le += 1
            text = text[:ls] + text[le:]
    if only_slots and not icon_uris:
        # fo_start is before every deletion above, so it is still valid here.
        fo_close = text.find('</FlexObject>', fo_start)
        ls = fo_start
        while ls > 0 and text[ls - 1] in ' \t':
            ls -= 1
        le = fo_close + len('</FlexObject>')
        if text.startswith('\r\n', le):
            le += 2
        elif text.startswith('\n', le):
            le += 1
        text = text[:ls] + text[le:]
    return text, len(blocks)

def apply_trait_icons(idml_path, icon_paths: list):
    """Fill a template's TRAIT_SLOT_1..N icon frames with a product's trait
    icons (SVG files, in display order) by relinking each slot's graphic, the
    same way the logo/QR are swapped. Unused slots are removed.
    Returns None when the template has no TRAIT_SLOT frames (older templates),
    True on success, False on failure or if there are more icons than slots."""
    idml_path = Path(idml_path)
    icon_uris = [Path(p).as_uri() for p in icon_paths]
    try:
        entries, order = {}, []
        with zipfile.ZipFile(io.BytesIO(idml_path.read_bytes()), 'r') as zin:
            for info in zin.infolist():
                entries[info.filename] = (info, zin.read(info.filename))
                order.append(info.filename)
        total_slots, changed = 0, False
        for name in order:
            info, data = entries[name]
            if not name.endswith('.xml') or b'TRAIT_SLOT_' not in data:
                continue
            text = data.decode('utf-8')
            new_text, slots = _fill_trait_slots_xml(text, icon_uris)
            if slots:
                total_slots += slots
                entries[name] = (info, new_text.encode('utf-8'))
                changed = True
        if not changed:
            return None
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as zout:
            for name in order:
                info, data = entries[name]
                ctype = zipfile.ZIP_STORED if name == 'mimetype' else zipfile.ZIP_DEFLATED
                zi = zipfile.ZipInfo(name)
                zi.date_time = info.date_time
                zout.writestr(zi, data, compress_type=ctype)
        idml_path.write_bytes(out.getvalue())
        return len(icon_uris) <= total_slots
    except Exception:
        return False

def patch_qr_in_idml(idml_path, qr_path):
    """Replace QR code LinkResourceURI in an IDML (ZIP+XML) file. No InDesign needed."""
    qr_uri    = Path(qr_path).as_uri()
    idml_path = Path(idml_path)
    try:
        entries, order = {}, []
        with zipfile.ZipFile(io.BytesIO(idml_path.read_bytes()), 'r') as zin:
            for info in zin.infolist():
                entries[info.filename] = (info, zin.read(info.filename))
                order.append(info.filename)
        patched = False
        for name in order:
            info, data = entries[name]
            if not name.endswith('.xml'):
                continue
            text = data.decode('utf-8', errors='replace')
            if '_qr' not in text.lower():
                continue
            new_text = re.sub(
                r'LinkResourceURI="[^"]*_QR[^"]*\.png"',
                f'LinkResourceURI="{qr_uri}"',
                text, flags=re.IGNORECASE,
            )
            if new_text != text:
                entries[name] = (info, new_text.encode('utf-8'))
                patched = True
        if not patched:
            return False
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as zout:
            for name in order:
                info, data = entries[name]
                ctype = zipfile.ZIP_STORED if name == 'mimetype' else zipfile.ZIP_DEFLATED
                zi = zipfile.ZipInfo(name)
                zi.date_time = info.date_time
                zout.writestr(zi, data, compress_type=ctype)
        idml_path.write_bytes(out.getvalue())
        return True
    except Exception:
        return False

def apply_qr_via_indesign(indd_path, qr_path):
    """Relink QR image in INDD via a running InDesign instance (Windows, no extra deps)."""
    if os.name != 'nt':
        return False
    import tempfile
    indd_uri = Path(indd_path).as_uri().replace("'", "%27")
    qr_uri   = Path(qr_path).as_uri().replace("'", "%27")
    jsx = (
        "var d=null,qf=File('" + qr_uri + "'),df=File('" + indd_uri + "');"
        "for(var i=0;i<app.documents.length;i++){"
        "try{if(app.documents[i].fullName.absoluteURI===df.absoluteURI)"
        "{d=app.documents[i];break;}}catch(e){}}"
        "if(!d)d=app.open(df);"
        "var ok=false;"
        "for(var i=0;i<d.links.length;i++){var l=d.links[i];"
        "if(l.name.toLowerCase().indexOf('_qr')!==-1){l.relink(qf);l.update();ok=true;}}"
        "if(ok)d.save();ok;"
    )
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsx', delete=False, encoding='utf-8') as jf:
            jf.write(jsx)
            jsx_tmp = jf.name
        jsx_escaped = jsx_tmp.replace('\\', '\\\\')
        vbs = (
            'On Error Resume Next\n'
            'Dim oApp\n'
            'Set oApp = GetObject(, "InDesign.Application")\n'
            'If Err.Number <> 0 Then WScript.Quit 1\n'
            'Err.Clear\n'
            f'oApp.DoScript "{jsx_escaped}", 1246458691\n'
            'If Err.Number <> 0 Then WScript.Quit 2\n'
            'WScript.Quit 0\n'
        )
        with tempfile.NamedTemporaryFile(mode='w', suffix='.vbs', delete=False, encoding='utf-8') as vf:
            vf.write(vbs)
            vbs_tmp = vf.name
        result = subprocess.run(['cscript', '//NoLogo', vbs_tmp], capture_output=True, timeout=30, creationflags=_NO_WINDOW)
        return result.returncode == 0
    except Exception:
        return False
    finally:
        for p in (locals().get('jsx_tmp'), locals().get('vbs_tmp')):
            if p:
                try: os.unlink(p)
                except: pass

# ── Open file/folder in OS ─────────────────────────────────────────────────────
def open_path(p):
    if os.name == "nt":
        if Path(p).is_dir():
            subprocess.Popen(['explorer', str(p)])
        else:
            ctypes.windll.shell32.ShellExecuteW(0, "open", str(p), None, None, 1)
    elif os.uname().sysname == "Darwin":
        subprocess.Popen(["open", str(p)])
    else:
        subprocess.Popen(["xdg-open", str(p)])

def reveal_path(p):
    if os.name == "nt":
        # ShellExecuteW activates and brings the window to the foreground
        ctypes.windll.shell32.ShellExecuteW(
            0, None, "explorer.exe", f'/select,"{p}"', None, 1
        )
    elif os.uname().sysname == "Darwin":
        subprocess.Popen(["open", "-R", str(p)])
    else:
        subprocess.Popen(["xdg-open", str(Path(p).parent)])

def trash_path(p):
    """Move a file to the system Recycle Bin / Trash (non-destructive delete)."""
    path = Path(p)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {p}")
    if os.name == "nt":
        # Use VB FileSystem via PowerShell — always available on Windows
        ps_cmd = (
            "Add-Type -AssemblyName Microsoft.VisualBasic; "
            f"[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile("
            f"'{str(path)}', 'OnlyErrorDialogs', 'SendToRecycleBin')"
        )
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_cmd],
            capture_output=True, text=True, creationflags=_NO_WINDOW
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "Trash failed")
    elif os.uname().sysname == "Darwin":
        subprocess.run(["osascript", "-e",
            f'tell app "Finder" to delete POSIX file "{path}"'], check=True)
    else:
        # freedesktop trash-cli fallback
        subprocess.run(["gio", "trash", str(path)], check=True)

# ── HTTP handler ───────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # silence request logs

    def serve_static(self, file_path, content_type):
        try:
            data = Path(file_path).read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", len(data))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers(); self.wfile.write(data)
        except (FileNotFoundError, IsADirectoryError):
            self.send_response(404); self.end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/_shutdown":
            # Internal: a newer instance is asking this one to step aside.
            self.send_response(200); self.send_header("Content-Length", "2"); self.end_headers()
            self.wfile.write(b"ok")
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return

        if path in ("/", "/index.html"):
            self.serve_static(STATIC_DIR / "index.html", "text/html; charset=utf-8"); return

        if path in ("/Nando-ico.png", "/Nando-white.png"):
            self.serve_static(BASE_DIR / path[1:], "image/png"); return

        if path.startswith("/static/"):
            rel  = path[len("/static/"):]
            mime = mimetypes.guess_type(rel)[0] or "application/octet-stream"
            self.serve_static(STATIC_DIR / rel, mime); return

        if path.startswith("/icons/"):
            rel  = path[len("/icons/"):]
            full = (ICONS_DIR / rel).resolve()
            try:
                full.relative_to(ICONS_DIR.resolve())
            except ValueError:
                self.send_response(404); self.end_headers(); return
            mime = mimetypes.guess_type(rel)[0] or "application/octet-stream"
            self.serve_static(full, mime); return

        if path == "/api/config":
            cfg = load_json(CFG_FILE)
            if not cfg:
                cfg = load_json(DEFAULT_CFG_FILE, {})
                save_json(CFG_FILE, cfg)
            else:
                # Merge any new products/languages/dimensions/sizes from default that are missing in saved cfg
                default = load_json(DEFAULT_CFG_FILE, {})
                default_prod_map = {p["name"]: p for p in default.get("products", [])}
                saved_names = {p["name"] for p in cfg.get("products", [])}
                new_prods = [p for p in default.get("products", []) if p["name"] not in saved_names]
                if new_prods:
                    cfg["products"] = cfg.get("products", []) + new_prods
                # Sync category/acidic for existing products if they differ from default
                for p in cfg.get("products", []):
                    dp = default_prod_map.get(p["name"])
                    if dp:
                        if p.get("category") != dp.get("category"):
                            p["category"] = dp["category"]
                        if p.get("acidic") != dp.get("acidic"):
                            p["acidic"] = dp["acidic"]
                saved_lang_codes = {l["code"] for l in cfg.get("languages", [])}
                new_langs = [l for l in default.get("languages", []) if l["code"] not in saved_lang_codes]
                if new_langs:
                    cfg["languages"] = cfg.get("languages", []) + new_langs
                for key in ("dimensions", "packagingSizes", "boxMultipliers"):
                    for k, v in default.get(key, {}).items():
                        if k not in cfg.get(key, {}):
                            cfg.setdefault(key, {})[k] = v
            self.send_json(cfg)

        elif path == "/api/map":
            m = load_json(MAP_FILE, {"generated": None, "files": []})
            self.send_json(m)

        elif path == "/api/scan":
            old_map   = load_json(MAP_FILE, {"files": []})
            old_added = {f["path"]: f.get("added_at") for f in old_map.get("files", [])}
            LABELS_DIR.mkdir(parents=True, exist_ok=True)
            files = scan_labels()
            for f in files:
                at = old_added.get(f["path"])
                if at:
                    f["added_at"] = at
            map_data = {"generated": datetime.now().isoformat(), "files": files}
            save_json(MAP_FILE, map_data)
            self.send_json(map_data)

        elif path == "/api/pick_dir":
            try:
                import tkinter as tk
                from tkinter import filedialog
                root_tk = tk.Tk(); root_tk.withdraw()
                root_tk.attributes('-topmost', True)
                selected = filedialog.askdirectory(title="Select folder to read")
                root_tk.destroy()
                self.send_json({"ok": True, "path": selected or None})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})

        elif path == "/api/labels_dir":
            self.send_json({"path": str(LABELS_DIR)})

        elif path == "/api/sync_status":
            self.send_json(get_sync_status())

        elif path == "/api/qrcodes":
            files = []
            if QR_DIR.exists():
                files = [
                    {"name": f.name, "stem": f.stem, "path": str(f)}
                    for f in sorted(QR_DIR.glob("*.png"))
                ]
            self.send_json({"files": files, "dir": str(QR_DIR)})

        elif path == "/api/templates":
            t = scan_templates()
            self.send_json({"templates": t, "count": len(t)})

        elif path == "/api/history":
            self.send_json({"history": load_json(HISTORY_FILE, [])})

        elif path == "/api/colors":
            colors = load_json(COLORS_FILE, {})
            cfg = load_json(CFG_FILE, load_json(DEFAULT_CFG_FILE, {}))
            defaults = {p["name"]: ["#808080"] * 6 for p in cfg.get("products", [])}
            self.send_json({"colors": {**defaults, **colors}})

        elif path == "/api/icons":
            self.send_json(load_json(ICONS_DIR / "icons.json", {"icons": [], "products": []}))

        elif path == "/api/icon_assignments":
            cfg = load_json(CFG_FILE, load_json(DEFAULT_CFG_FILE, {}))
            self.send_json({"assignments": get_icon_assignments(cfg.get("products", []))})

        elif path == "/api/assets_check":
            cfg      = load_json(CFG_FILE, load_json(DEFAULT_CFG_FILE, {}))
            products = cfg.get("products", [])
            logos_dir = BASE_DIR / "logos"
            def norm(s): return re.sub(r'[^a-z0-9]', '', s.lower())
            result = {}
            for p in products:
                name = p["name"]
                has_qr   = find_qr_for_product(name) is not None
                has_logo = False
                if logos_dir.exists():
                    target = norm(name) + "logo"
                    for f in logos_dir.iterdir():
                        if norm(f.stem) == target:
                            has_logo = True
                            break
                result[name] = {"qr": has_qr, "logo": has_logo}
            self.send_json(result)

        elif path == "/api/logo_thumb":
            qs      = parse_qs(urlparse(self.path).query)
            product = (qs.get("product") or [None])[0]
            data    = get_logo_thumbnail(product) if product else None
            if data is None:
                self.send_response(404); self.end_headers(); return
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=604800")
            self.end_headers()
            self.wfile.write(data)

        elif path == "/api/file_thumb":
            qs   = parse_qs(urlparse(self.path).query)
            rel  = (qs.get("path") or [None])[0]
            try:
                page = int((qs.get("page") or ["0"])[0])
            except ValueError:
                page = 0
            result = get_file_thumbnail(rel, page) if rel else None
            if result is None:
                self.send_response(404); self.end_headers(); return
            data, mime = result
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=604800")
            self.end_headers()
            self.wfile.write(data)

        elif path == "/api/file_info":
            qs   = parse_qs(urlparse(self.path).query)
            rel  = (qs.get("path") or [None])[0]
            info = get_file_info(rel) if rel else None
            if info is None:
                self.send_response(404); self.end_headers(); return
            self.send_json(info)

        elif path == "/api/translations":
            self.send_json({"files": list_translations(get_translations_dir())})

        elif path == "/api/resource_dirs":
            self.send_json({
                "logos":        str(BASE_DIR / "logos"),
                "qrcodes":      str(QR_DIR),
                "templates":    str(TEMPLATE_DIR),
                "translations": str(get_translations_dir()),
            })

        elif path == "/api/config/default":
            self.send_json(load_json(DEFAULT_CFG_FILE, load_json(DEFAULT_CFG_FILE, {})))

        elif path == "/api/export":
            cfg    = load_json(CFG_FILE, load_json(DEFAULT_CFG_FILE, {}))
            colors = load_json(COLORS_FILE, {})
            icon_assignments = get_icon_assignments(cfg.get("products", []))
            payload = json.dumps({"config": cfg, "colors": colors, "icon_assignments": icon_assignments}, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Disposition", 'attachment; filename="etiketas_export.json"')
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        path   = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        body   = json.loads(self.rfile.read(length)) if length else {}

        if path == "/api/config/save":
            save_json(CFG_FILE, body)
            self.send_json({"ok": True})

        elif path == "/api/find_template":
            cfg      = load_json(CFG_FILE, load_json(DEFAULT_CFG_FILE, {}))
            product  = body.get("product")
            languages= body.get("languages", [])
            size     = body.get("packagingSize")
            prods    = cfg.get("products", [])
            prod_cfg = next((p for p in prods if p["name"]==product), None)
            if not prod_cfg:
                self.send_json({"labels":[],"boxes":[],"dimensions":None}); return
            category = prod_cfg["category"]
            acidic   = prod_cfg.get("acidic",False)
            unit     = prod_cfg.get("unit","L" if category=="PAM" else "kg")
            if category == "PAM":
                dim_key = "PAM_acidic" if acidic else "PAM_normal"
            elif category == "CE":
                dim_key = "CE_solid" if unit=="kg" else "CE"
            elif category == "MO":
                dim_key = "MO_liquid" if unit=="L" else "MO"
            else:
                dim_key = "MO"
            dims     = cfg["dimensions"].get(dim_key,{}).get(size)
            map_data = load_json(MAP_FILE, {"files":[]})
            files    = map_data.get("files",[])
            box_mult = cfg.get("boxMultipliers", {}).get(size, size)
            label_results = find_templates(files,{"product":product,"category":category,"dimensions":dims,"lang_count":len(languages),"deze":False,"packaging":size,"acidic":acidic},prods)
            box_results   = find_templates(files,{"product":product,"category":category,"dimensions":"180x180","lang_count":len(languages),"deze":True,"packaging":box_mult},prods)
            self.send_json({
                "labels": [{"file":f,"score":s,"reasons":r} for f,s,r in label_results],
                "boxes":  [{"file":f,"score":s,"reasons":r} for f,s,r in box_results],
                "dimensions": dims,
            })

        elif path == "/api/create":
            try:
                cfg    = load_json(CFG_FILE, load_json(DEFAULT_CFG_FILE, {}))
                fv = body.get("footerValues")
                result = create_label(body["product"], body["languages"], body["packagingSize"], cfg,
                                      label_template_path=body.get("labelTemplatePath"),
                                      box_template_path=body.get("boxTemplatePath"),
                                      lang_files=body.get("langFiles"),
                                      footer_values=fv if fv else None,
                                      skip_label=body.get("skipLabel", False),
                                      skip_box=body.get("skipBox", False))
                self.send_json({"success":True,**result})
            except Exception as e:
                self.send_json({"success":False,"error":str(e)})

        elif path == "/api/open":
            try:
                p = body.get("path","")
                if p and not Path(p).is_absolute():
                    p = str(LABELS_DIR / p)
                open_path(p)
                self.send_json({"ok":True})
            except Exception as e:
                self.send_json({"ok":False,"error":str(e)})

        elif path == "/api/reveal":
            try:
                p = body.get("path","")
                if p and not Path(p).is_absolute():
                    p = str(LABELS_DIR / p)
                reveal_path(p)
                self.send_json({"ok":True})
            except Exception as e:
                self.send_json({"ok":False,"error":str(e)})

        elif path == "/api/trash":
            try:
                p = body.get("path", "")
                if p and not Path(p).is_absolute():
                    p = str(LABELS_DIR / p)
                trash_path(p)
                # Remove from map if present
                map_data = load_json(MAP_FILE, {"files": []})
                map_data["files"] = [f for f in map_data.get("files", []) if f.get("path") != p]
                save_json(MAP_FILE, map_data)
                self.send_json({"ok": True})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})

        elif path == "/api/colors/save":
            save_json(COLORS_FILE, body)
            self.send_json({"ok": True})

        elif path == "/api/icon_assignments/save":
            save_json(ICON_ASSIGN_FILE, body)
            self.send_json({"ok": True})

        elif path == "/api/config/reset":
            default = load_json(DEFAULT_CFG_FILE, load_json(DEFAULT_CFG_FILE, {}))
            save_json(CFG_FILE, default)
            self.send_json({"ok": True, "config": default})

        elif path == "/api/config/sync_products":
            default = load_json(DEFAULT_CFG_FILE, {})
            current = load_json(CFG_FILE, load_json(DEFAULT_CFG_FILE, {}))
            current_names = {p["name"] for p in current.get("products", [])}
            added = []
            for p in default.get("products", []):
                if p["name"] not in current_names:
                    current["products"].append(p)
                    added.append(p["name"])
            # Also apply any name/category corrections for existing entries
            updated = []
            default_map = {p["name"]: p for p in default.get("products", [])}
            for p in current.get("products", []):
                if p["name"] in default_map:
                    canonical = default_map[p["name"]]
                    if p.get("category") != canonical.get("category") or p.get("acidic") != canonical.get("acidic"):
                        p["category"] = canonical["category"]
                        p["acidic"]   = canonical["acidic"]
                        updated.append(p["name"])
            save_json(CFG_FILE, current)
            self.send_json({"ok": True, "config": current, "added": added, "updated": updated})

        elif path == "/api/apply_qr":
            try:
                indd_path = body.get("indd_path", "")
                qr_path   = body.get("qr_path", "")
                if not indd_path or not qr_path:
                    self.send_json({"ok": False, "error": "Missing paths"}); return
                if not Path(indd_path).is_absolute():
                    indd_path = str(LABELS_DIR / indd_path)
                ok = apply_qr_via_indesign(indd_path, qr_path)
                self.send_json({"ok": ok, "error": None if ok else "InDesign not running or relinking failed"})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})

        elif path == "/api/ingest":
            try:
                src_path = body.get("path", "")
                if not src_path or not Path(src_path).exists():
                    self.send_json({"ok": False, "error": "Invalid or missing path"}); return
                import sys as _sys
                if str(BASE_DIR) not in _sys.path:
                    _sys.path.insert(0, str(BASE_DIR))
                import organizer
                LABELS_DIR.mkdir(parents=True, exist_ok=True)
                _cfg = load_json(CFG_FILE, load_json(DEFAULT_CFG_FILE, {}))
                result = organizer.ingest(Path(src_path), LABELS_DIR, products=_cfg.get("products", []))
                if result["entries"] and not result["dry_run"]:
                    map_data = load_json(MAP_FILE, {"files": []})
                    idx = {f["path"]: f for f in map_data.get("files", [])}
                    for e in result["entries"]:
                        idx[e["path"]] = e
                    map_data["files"]     = sorted(idx.values(), key=lambda x: x["path"])
                    map_data["generated"] = datetime.now().isoformat()
                    save_json(MAP_FILE, map_data)
                self.send_json({
                    "ok":     True,
                    "copied": len(result["entries"]),
                    "skipped":result["skipped"],
                    "errors": len(result["errors"]),
                    "files":  result["entries"],
                })
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})

        else:
            self.send_response(404); self.end_headers()


# ── Single instance / windowless support ──────────────────────────────────────
def _redirect_output_if_windowless():
    """Under pythonw.exe there is no console: sys.stdout/stderr are None and any
    print() would crash. Send them to a fresh log file instead (truncated each
    launch so it never grows without bound)."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    try:
        f = open(LOG_FILE, "w", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = f
    except Exception:
        sys.stdout = sys.stderr = io.StringIO()

def _port_in_use(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.3)
    try:
        return s.connect_ex(("127.0.0.1", port)) == 0
    except OSError:
        return False
    finally:
        s.close()

def _pids_listening_on(port):
    try:
        out = subprocess.run(["netstat", "-a", "-n", "-o", "-p", "TCP"],
                             capture_output=True, text=True, creationflags=_NO_WINDOW).stdout
    except Exception:
        return set()
    pids = set()
    for line in out.splitlines():
        p = line.split()
        if len(p) >= 5 and p[0].upper() == "TCP" and p[1].endswith(f":{port}") and p[3].upper() == "LISTENING":
            if p[4].isdigit() and p[4] != "0" and int(p[4]) != os.getpid():
                pids.add(p[4])
    return pids

def _take_over_port(port):
    """The newest launch always wins: ask any running instance to quit, then
    force-kill it if it won't let go of the port."""
    if not _port_in_use(port):
        return
    print(f"Another instance holds port {port} -- taking over.")
    try:
        import urllib.request
        urllib.request.urlopen(f"http://127.0.0.1:{port}/api/_shutdown", timeout=2).read()
    except Exception:
        pass
    for _ in range(25):
        if not _port_in_use(port):
            return
        time.sleep(0.12)
    for pid in _pids_listening_on(port):
        subprocess.run(["taskkill", "/F", "/PID", pid], capture_output=True, creationflags=_NO_WINDOW)
    for _ in range(25):
        if not _port_in_use(port):
            return
        time.sleep(0.12)

# ── Server startup ─────────────────────────────────────────────────────────────
class _QuietHTTPServer(ThreadingMixIn, HTTPServer):
    # A plain HTTPServer handles one request at a time; a page that fires off
    # a burst of concurrent requests (e.g. 20 trait-icon <img> loads at once)
    # leaves the later ones queued behind the earlier ones and some time out.
    # request_queue_size is also bumped from socketserver's default of 5 --
    # too small a listen() backlog drops/resets connection attempts that
    # arrive before the accept loop has caught up, which threading alone
    # doesn't fix since the backlog is a kernel-level limit, not a Python one.
    daemon_threads = True
    request_queue_size = 128
    def handle_error(self, request, client_address):
        et = sys.exc_info()[0]
        if et and issubclass(et, ConnectionError):
            return  # client hung up mid-response -- normal, not a bug worth a traceback
        super().handle_error(request, client_address)

def start():
    _redirect_output_if_windowless()
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    LABELS_DIR.mkdir(parents=True, exist_ok=True)
    _take_over_port(PORT)
    server = _QuietHTTPServer(("127.0.0.1", PORT), Handler)
    url    = f"http://localhost:{PORT}"
    print("Etiketas - Label Manager")
    print(f"  Running at {url}")
    print(f"  Labels dir: {LABELS_DIR}")
    print(f"  Press Ctrl+C to stop\n")
    t = threading.Timer(0.8, lambda: webbrowser.open(url)); t.daemon = True; t.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")

if __name__ == "__main__":
    start()
