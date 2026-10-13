#!/usr/bin/env python3
"""
Etiketas -- Label Manager
Run with:  python app/etiketas.py   (or double-click Etiketas.vbs / Start_Etiketas.bat)
Opens at:  http://127.0.0.1:7842
"""

import ctypes, html, io, json, mimetypes, os, re, shutil, socket, stat, sys, threading, time, webbrowser, subprocess, zipfile
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

import organizer
from labelnames import Catalogue, label_entry, label_kind, norm_name, pack_amount, take_date

# ── Paths ──────────────────────────────────────────────────────────────────────
# Project layout: this file lives in app/ (code, default config, the web UI in app/static/);
# the files the app works with -- icons, logos, QR codes, IDML templates -- are in assets/.
APP_DIR    = Path(__file__).parent
BASE_DIR   = APP_DIR.parent
ASSETS_DIR = BASE_DIR / "assets"
LOG_FILE   = APP_DIR / "etiketas.log"
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
STATIC_DIR = APP_DIR / "static"
LABELS_DIR = Path.home() / "Documents" / "Etiketas"
QR_DIR          = ASSETS_DIR / "qrcodes"
LOGO_DIR        = ASSETS_DIR / "logos"
TEMPLATE_DIR    = ASSETS_DIR / "templates"
TRANSLATIONS_DIR = BASE_DIR / "translations"
ICONS_DIR       = ASSETS_DIR / "icons"
LOGO_THUMB_DIR = LABELS_DIR / ".cache" / "logo_thumbs"
FILE_THUMB_DIR = LABELS_DIR / ".cache" / "file_thumbs"
MAP_FILE     = LABELS_DIR / "labels_map.json"
CFG_FILE     = LABELS_DIR / "app_config.json"
COLORS_FILE  = LABELS_DIR / "colors_config.json"
ICON_ASSIGN_FILE = LABELS_DIR / "icon_assignments.json"
HISTORY_FILE = LABELS_DIR / "creation_history.json"
DEFAULT_CFG_FILE = APP_DIR / "default_config.json"
PORT       = 7842


# ── JSON helpers ───────────────────────────────────────────────────────────────
def load_json(p, fallback=None):
    """Parsed JSON, or `fallback` if the file is missing or unreadable. A file that
    is momentarily locked (a writer swapping it in, OneDrive syncing it) is retried
    briefly first, so a transient failure isn't mistaken for "no data"."""
    p = Path(p)
    for attempt in range(4):
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return fallback
        except (PermissionError, json.JSONDecodeError):
            time.sleep(0.03 * (attempt + 1))
        except Exception:
            return fallback
    return fallback

def save_json(p, data):
    """Write JSON atomically (temp file, then rename over the target): a crash --
    or the single-instance takeover force-killing this process -- mid-write can
    then never leave a truncated config behind."""
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2)
    tmp = p.with_name(f"{p.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        for attempt in range(8):
            try:
                tmp.write_text(text, encoding="utf-8")
                os.replace(tmp, p)
                return
            except PermissionError:   # a reader / OneDrive / antivirus has a file open right now
                time.sleep(0.03 * (attempt + 1))
        # Still locked after ~1s: write in place rather than lose the save. Readers
        # retry a half-written file (see load_json), so this is safe, just not atomic.
        p.write_text(text, encoding="utf-8")
    finally:
        tmp.unlink(missing_ok=True)

def load_config():
    """The live config, or the bundled default if none has been saved yet."""
    cfg = load_json(CFG_FILE)
    return cfg if cfg is not None else load_json(DEFAULT_CFG_FILE, {})

def append_history(entry):
    history = load_json(HISTORY_FILE, None)
    if history is None:
        if HISTORY_FILE.exists():   # unreadable, not absent: don't replace 200 entries with 1
            return
        history = []
    history.insert(0, entry)
    save_json(HISTORY_FILE, history[:200])

def update_map(change):
    """Read-modify-write labels_map.json. If the map exists but can't be read it is
    left alone (a Rescan rebuilds it) rather than overwritten with a partial one."""
    data = load_json(MAP_FILE, None)
    if data is None:
        if MAP_FILE.exists():
            return
        data = {"files": []}
    change(data)
    save_json(MAP_FILE, data)

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
                by_norm[norm_name(nm)] = icons
    assignments = {p["name"]: by_norm.get(norm_name(p["name"]), []) for p in products}
    if not ICON_ASSIGN_FILE.exists():   # never overwrite a file that merely failed to read
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
    running = _onedrive_running()
    def status(state, target=None, **extra):
        return {"state": state, "path": str(LABELS_DIR), "target": str(target) if target else None,
                "onedrive_running": running, **extra}

    try:
        st = os.lstat(LABELS_DIR)
    except OSError:
        return status("missing")
    is_link = bool(st.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT) if os.name == "nt" else os.path.islink(LABELS_DIR)
    if not is_link:
        return status("not_linked")

    try:
        target = Path(os.readlink(LABELS_DIR))
    except OSError:
        target = None
    if not target or not target.exists():
        return status("broken", target)
    return status("active" if running else "onedrive_not_running", target,
                  looks_like_onedrive="onedrive" in str(target).lower())

# ── Template filenames ─────────────────────────────────────────────────────────
# Label filenames are parsed by labelnames.py (shared with organizer.py); only the
# template naming is specific to this module:
#   {MO|PAM|CE}[_PH]_TEMPLATE_{size}_{N}LANG_{WxH}[mm]_{YYYY}_{MM}[_BOX]
RE_DIMS_MM  = re.compile(r'^(\d+x\d+)(?:mm)?$', re.I)
RE_NLANG    = re.compile(r'^(\d+)LANG$', re.I)
RE_BOX_MULT = re.compile(r'^(\d+(?:\.\d+)?)(kg|g|l|ml)x(\d+)$', re.I)
RE_TMPL     = re.compile(r'^(MO|PAM|CE)(_PH)?_TEMPLATE_', re.I)

def parse_template_stem(stem):
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
    date, _ = take_date(parts, idx)
    return {"category": category, "acidic": acidic, "packaging": packaging,
            "lang_count": lang_count, "dimensions": dims, "date": date, "deze": deze}

def _norm_packaging(p: str) -> str:
    """Normalise packaging to kg/L so 250g==0.25kg, 500ml==0.5L, etc."""
    if not p:
        return ''
    amount = pack_amount(p)
    if not amount:
        return p.lower().strip()
    amt, unit = amount
    if unit == 'g':
        return f"{amt/1000:g}kg"
    if unit == 'ml':
        return f"{amt/1000:g}l"
    return f"{amt:g}{unit}"

def dim_key_for(prod_cfg: dict) -> str:
    """Which table of config['dimensions'] a product's label sizes come from."""
    category = prod_cfg["category"]
    unit = prod_cfg.get("unit", "L" if category == "PAM" else "kg")
    if category == "PAM":
        return "PAM_acidic" if prod_cfg.get("acidic", False) else "PAM_normal"
    if category == "CE":
        return "CE_solid" if unit == "kg" else "CE"
    return "MO_liquid" if (category == "MO" and unit == "L") else "MO"

def scan_templates():
    """The IDML templates in TEMPLATE_DIR that follow the template naming convention."""
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
            templates.append({
                "filename":   fname,
                "path":       str(Path(root) / fname),
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
    # Template library priority: +100 when lang count AND category are a complete match
    if entry.get("is_template") and e_langs == t_langs and e_cat == target.get("category"):
        s += 100
        reasons.append({"text": "Template library — priority", "type": "match"})
    return (s if s > 0 else -1), reasons

def find_templates(files, target, products, n=3):
    """Return up to n best-scored templates as [(file, score, reasons), ...].
    Always merges the template library (priority over regular files on complete match)."""
    non_wip = [f for f in files if "WIP" not in f.get("filename", "")]
    pool = scan_templates() + (non_wip or files)
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
def make_catalogue(cfg):
    """What the filename parser checks names against: the configured products and languages,
    and which pack size a label size means for a product (None unless it is unambiguous)."""
    def pack_for_dims(prod_cfg, wxh):
        table = cfg.get("dimensions", {}).get(dim_key_for(prod_cfg), {})
        packs = [pack for pack, dims in table.items() if dims.lower() == wxh]
        return packs[0] if len(packs) == 1 else None
    return Catalogue(cfg.get("products", []), cfg.get("languages", []), pack_for_dims)

def scan_labels():
    """Every label file (InDesign, IDML, +bleed print PDF) under LABELS_DIR, as map entries."""
    files = []
    if not LABELS_DIR.exists():
        return files
    cat = make_catalogue(merged_config())
    for root, dirs, fnames in os.walk(LABELS_DIR):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d.lower() not in ('qrcodes', 'template')]
        for fname in fnames:
            p = Path(fname)
            if fname.startswith('.') or not label_kind(p.suffix, p.stem):
                continue
            files.append(label_entry(str((Path(root) / fname).relative_to(LABELS_DIR)), fname, cat))
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

# ── IDML editing ───────────────────────────────────────────────────────────────
class IdmlPackage:
    """An IDML (a zip of XML parts) held in memory. Creating a label applies a
    dozen small edits (colours, QR, logo, translations, footer, icons); doing
    them all against one of these means the file is read once and written once.
    Parts that were not edited are written back byte-for-byte."""

    def __init__(self, path):
        self.path = Path(path)
        with zipfile.ZipFile(self.path) as z:
            self._infos = z.infolist()
            self._raw = {i.filename: z.read(i.filename) for i in self._infos}
        self._text = {}        # part name -> decoded text (cache; also holds edits)
        self._changed = set()
        self._titles = None

    def parts(self, prefix="", suffix=""):
        return [i.filename for i in self._infos
                if i.filename.startswith(prefix) and i.filename.endswith(suffix)]

    def text(self, name):
        if name not in self._text:
            self._text[name] = self._raw[name].decode("utf-8", errors="replace")
        return self._text[name]

    def set_text(self, name, text):
        if text != self.text(name):
            self._text[name] = text
            self._changed.add(name)

    def stories(self):
        """[(part name, StoryTitle)] -- the title is how templates label the text
        frames the app fills (LANG1_HEADER, SHARED_SKU, ...)."""
        if self._titles is None:
            self._titles = []
            for name in self.parts("Stories/"):
                m = re.search(r'StoryTitle="([^"]+)"', self.text(name))
                if m:
                    self._titles.append((name, m.group(1)))
        return self._titles

    def attempt(self, edit, *args):
        """Run one edit step. If it raises, the package is rolled back to how it
        was before the step and False is returned."""
        text, changed = dict(self._text), set(self._changed)
        try:
            return edit(self, *args)
        except Exception:
            self._text, self._changed = text, changed
            return False

    def save(self):
        """Write the package back (original part order and compression), only if something changed."""
        if not self._changed:
            return
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
            for info in self._infos:
                name = info.filename
                zout.writestr(info, self._text[name].encode("utf-8") if name in self._changed else self._raw[name])
        self.path.write_bytes(buf.getvalue())
        self._changed.clear()

def _cut_block(text, start, end):
    """Remove text[start:end] along with its indentation and trailing newline."""
    while start > 0 and text[start - 1] in ' \t':
        start -= 1
    if text.startswith('\r\n', end):
        end += 2
    elif text.startswith('\n', end):
        end += 1
    return text[:start] + text[end:]

# -- Brand colours -------------------------------------------------------------
def apply_brand_colors(pkg, colors):
    """Rewrite the Brand1-Brand6 swatches."""
    if not colors:
        return False
    if 'Resources/Graphic.xml' in pkg.parts():
        pkg.set_text('Resources/Graphic.xml', _update_graphic_xml(pkg.text('Resources/Graphic.xml'), colors))
    return True

# -- Linked graphics (logo, QR) --------------------------------------------------
_LOGO_LINK_RE = re.compile(r'LinkResourceURI="[^"]*_LOGO\.[^"]*"', re.I)
_QR_LINK_RE   = re.compile(r'LinkResourceURI="[^"]*_QR[^"]*\.png"', re.I)

def _relink(pkg, marker, link_re, path):
    """Point every placed graphic whose link matches link_re at `path`. False if none matched."""
    repl = f'LinkResourceURI="{Path(path).as_uri()}"'
    patched = False
    for name in pkg.parts(suffix='.xml'):
        text = pkg.text(name)
        if marker not in text.lower():
            continue
        new = link_re.sub(lambda _m: repl, text)
        if new != text:
            pkg.set_text(name, new)
            patched = True
    return patched

def patch_logo_in_idml(pkg, logo_path):
    return _relink(pkg, '_logo', _LOGO_LINK_RE, logo_path)

def patch_qr_in_idml(pkg, qr_path):
    return _relink(pkg, '_qr', _QR_LINK_RE, qr_path)

# -- Text frames -----------------------------------------------------------------
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

def apply_lang_translation(pkg, slot, trans):
    """Replace the LANG{slot}_* stories' contents with translated text."""
    prefix = f'LANG{slot}_'
    for name, title in pkg.stories():
        if title.startswith(prefix):
            texts = _get_story_replacements(title, trans)
            if texts is not None:
                pkg.set_text(name, _replace_story_contents(pkg.text(name), texts))
    return True

def _format_box_weight_text(box_mult: str) -> str:
    """Turn a boxMultiplier code like '1kgx10' into display text '1 kg x 10'."""
    m = RE_BOX_MULT.match(box_mult or '')
    if not m:
        return box_mult or ''
    amount, unit, count = m.groups()
    return f"{amount} {unit} x {count}"

def apply_box_weight_text(pkg, box_mult):
    """Set the SHARED_WEIGHT story to this box's pack size and count. Not
    language-specific -- applied once per box file regardless of language slots."""
    weight_text = _format_box_weight_text(box_mult)
    for name, title in pkg.stories():
        if title == 'SHARED_WEIGHT':
            pkg.set_text(name, _replace_story_contents(pkg.text(name), [weight_text]))
    return True

# Most current templates hold SKU/mfg-date/batch/shelf-life in one shared
# "SHARED_SKU" story (label text baked in once, not per language slot); a few
# still carry the older per-language footer stories (LANG{n}_FOOTER_SKU_BLOCK /
# _FOOTER_PRODUCER_BLOCK), which _get_story_replacements fills from the
# translation file. This fills the shared one. Manufacturing date and batch
# number are stamped on later at the print line, so only their *labels* live
# in the template -- there is deliberately no value to write for those two.
# SKU code and shelf life ARE set at creation time -- SKU from the wizard (per
# label/batch), shelf life from the translation file (per product).
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

def apply_footer_content(pkg, translations, footer_values=None):
    """Fill the SHARED_SKU story's SKU-code and shelf-life values.
    translations: list of translation dicts (may contain None for skipped slots).
    footer_values: dict from the wizard, keyed 'sku'. SKU comes from here rather
    than the translation file -- the same translation can be reused across
    different markets/production batches, each with its own SKU, so SKU belongs
    to the label being created, not the shared translated text. Shelf life is the
    opposite: it's a property of the product/translation, not the batch, so it's
    still sourced from the translation file, first non-blank one wins across the
    selected languages."""
    sku_value = (footer_values or {}).get('sku', '')
    shelf_value = next((t.get('footer', {}).get('exp_date_value', '')
                         for t in translations if t and t.get('footer', {}).get('exp_date_value')), '')
    if not sku_value and not shelf_value:
        return True  # nothing to write -- not an error
    for name, title in pkg.stories():
        if title == 'SHARED_SKU':
            new_xml = _fill_shared_sku_xml(pkg.text(name), sku_value, shelf_value)
            if new_xml is not None:
                pkg.set_text(name, new_xml)
    return True

# -- Trait icons -----------------------------------------------------------------
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
    fo_start = text.rfind('<FlexObject', 0, blocks[0][0])
    fo_close = text.find('</FlexObject>', blocks[-1][1])
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
            text = _cut_block(text, s, e)
    if only_slots and not icon_uris:
        # fo_start is before every deletion above, so it is still valid here.
        fo_close = text.find('</FlexObject>', fo_start)
        text = _cut_block(text, fo_start, fo_close + len('</FlexObject>'))
    return text, len(blocks)

def apply_trait_icons(pkg, icon_paths):
    """Fill a template's TRAIT_SLOT_1..N icon frames with a product's trait
    icons (SVG files, in display order) by relinking each slot's graphic, the
    same way the logo/QR are swapped. Unused slots are removed.
    Returns None when the template has no TRAIT_SLOT frames (older templates),
    True on success, False if there are more icons than slots."""
    icon_uris = [Path(p).as_uri() for p in icon_paths]
    total_slots = 0
    for name in pkg.parts(suffix='.xml'):
        text = pkg.text(name)
        if 'TRAIT_SLOT_' not in text:
            continue
        new_text, slots = _fill_trait_slots_xml(text, icon_uris)
        if slots:
            total_slots += slots
            pkg.set_text(name, new_text)
    if not total_slots:
        return None
    return len(icon_uris) <= total_slots

# -- Applying everything to one new file -------------------------------------------
def fill_idml(path, *, is_label, is_template, colors, qr_path, logo_path, box_mult,
              translations, footer_values, trait_icons):
    """Apply every edit a new label (is_label) or box file needs, with one read
    and one write of the IDML. Returns what the UI shows per step:
    True = done, False = failed, None = not applicable."""
    ops = {"colors": None, "qr": None, "logo": None, "translations": []}
    try:
        pkg = IdmlPackage(path)
    except Exception:          # unreadable template: every step that would have run fails
        pkg = None
    run = pkg.attempt if pkg else (lambda *_: False)
    if colors:
        ops["colors"] = run(apply_brand_colors, colors)
    if is_label and qr_path and is_template:
        ops["qr"] = run(patch_qr_in_idml, qr_path)
    if logo_path:
        ops["logo"] = run(patch_logo_in_idml, logo_path)
    if not is_label:
        ops["weight"] = run(apply_box_weight_text, box_mult)
    for slot, trans in enumerate(translations, 1):
        ops["translations"].append(run(apply_lang_translation, slot, trans) if trans else None)
    if is_label:
        ops["footer"] = run(apply_footer_content, translations, footer_values)
        ops["icons"]  = run(apply_trait_icons, trait_icons)
    if pkg:
        pkg.save()
    return ops

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
def _pick_template(explicit_path, skip, all_pool, files, target, prods):
    """(template entry or None, score) for one of the two files a label request creates."""
    if skip:
        return None, 0
    if explicit_path:
        return next((f for f in all_pool if f.get("path") == explicit_path), None), 0
    return find_template(files, target, prods)

def create_label(product, languages, packaging_size, config, label_template_path=None, box_template_path=None, lang_files=None, footer_values=None, skip_label=False, skip_box=False):
    prods    = config.get("products", [])
    prod_cfg = next((p for p in prods if p["name"]==product), None)
    if not prod_cfg:
        raise ValueError(f"Product not found: {product}")

    category = prod_cfg["category"]
    acidic   = prod_cfg.get("acidic", False)
    dim_key  = dim_key_for(prod_cfg)
    dims     = config["dimensions"].get(dim_key, {}).get(packaging_size)
    if not dims:
        raise ValueError(f"No dimensions for {dim_key}/{packaging_size}")

    box_mult  = config.get("boxMultipliers", {}).get(packaging_size, packaging_size)
    map_data  = load_json(MAP_FILE, {"files": []})
    all_files = map_data.get("files", [])

    # Resolve templates before computing names (templates may be absolute-path entries)
    all_pool = all_files + scan_templates()
    label_tmpl, label_score = _pick_template(label_template_path, skip_label, all_pool, all_files,
        {"product":product,"category":category,"dimensions":dims,
         "lang_count":len(languages),"deze":False,"packaging":packaging_size,
         "acidic":acidic}, prods)
    box_tmpl, box_score = _pick_template(box_template_path, skip_box, all_pool, all_files,
        {"product":product,"category":category,"dimensions":"180x180",
         "lang_count":len(languages),"deze":True,"packaging":box_mult}, prods)

    lang_str   = "_".join(languages)
    now        = datetime.now()
    date_str   = f"{now.year}_{now.month:02d}"
    ext_of     = lambda tmpl: tmpl.get("extension", ".idml") if tmpl else ".idml"
    lang_folder = ",".join(languages)

    prod_colors = load_json(COLORS_FILE, {}).get(product, [])
    qr_path     = find_qr_for_product(product)
    logo_path   = find_logo_for_product(product)
    icon_lib    = {ic["id"]: ic for ic in load_json(ICONS_DIR / "icons.json", {}).get("icons", [])}
    trait_icons = [ICONS_DIR / icon_lib[i]["svg"]
                   for i in get_icon_assignments(prods).get(product, [])
                   if i in icon_lib and (ICONS_DIR / icon_lib[i]["svg"]).is_file()]
    # Pre-load translation data for each slot (None = skip)
    translations = [load_json(lf) if lf else None for lf in (lang_files or [])]

    def make_file(tmpl, dest_dir, dest_name, is_label):
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / dest_name
        if dest_path.exists():
            raise FileExistsError(f"File already exists: {dest_path}")
        if not tmpl:
            dest_path.write_bytes(b"")
            return dest_path, {"colors": None, "qr": None, "logo": None, "translations": []}
        src_p = tmpl.get("path", "")
        shutil.copy2(src_p if Path(src_p).is_absolute() else LABELS_DIR / src_p, dest_path)
        if dest_path.suffix.lower() != '.idml':
            return dest_path, {"colors": None, "qr": None, "logo": None, "translations": []}
        return dest_path, fill_idml(dest_path, is_label=is_label, is_template=bool(tmpl.get("is_template")),
                                    colors=prod_colors, qr_path=qr_path, logo_path=logo_path, box_mult=box_mult,
                                    translations=translations, footer_values=footer_values, trait_icons=trait_icons)

    # The packaging label (sized from the product) and its box label (always 180x180).
    specs = []
    if not skip_label:
        specs.append(dict(type="packaging_label", tmpl=label_tmpl, score=label_score, is_label=True,
                          name=f"{product}_{packaging_size}_{lang_str}_{dims}_{date_str}_WIP{ext_of(label_tmpl)}",
                          dir=LABELS_DIR / category / product / lang_folder / packaging_size,
                          packaging=packaging_size, dims=dims))
    if not skip_box:
        specs.append(dict(type="box_label", tmpl=box_tmpl, score=box_score, is_label=False,
                          name=f"{product}_{box_mult}_{lang_str}_180x180_{date_str}_deze_WIP{ext_of(box_tmpl)}",
                          dir=LABELS_DIR / category / product / lang_folder / "Box",
                          packaging=box_mult, dims="180x180"))

    results, new_entries = [], []
    for s in specs:
        path, ops = make_file(s["tmpl"], s["dir"], s["name"], s["is_label"])
        rel = str(path.relative_to(LABELS_DIR))
        results.append({
            "type":     s["type"],
            "path":     str(path),
            "rel_path": rel,
            "filename": s["name"],
            "template": s["tmpl"]["filename"] if s["tmpl"] else None,
            "score":    s["score"],
            "ops":      ops,
        })
        new_entries.append({
            "filename":  s["name"],
            "path":      rel,
            "extension": ext_of(s["tmpl"]),
            "product":   product,
            "packaging": s["packaging"],
            "languages": languages,
            "dimensions":s["dims"],
            "date":      date_str.replace("_","-"),
            "deze":      not s["is_label"],
            "print_file":False,
            "sorted":    True,
            "wip":       True,
        })

    def add_new(map_data):
        by_path = {f["path"]: f for f in map_data.get("files", [])}
        by_path.update({e["path"]: e for e in new_entries})
        map_data["files"]     = sorted(by_path.values(), key=lambda x: x["path"])
        map_data["generated"] = datetime.now().isoformat()
    update_map(add_new)

    append_history({
        "timestamp":    datetime.now().isoformat(),
        "product":      product,
        "languages":    languages,
        "packagingSize": packaging_size,
        "files": [{"type": r["type"], "filename": r["filename"], "path": r["path"]} for r in results],
    })

    return {"results": results}

# ── Product assets: QR codes, logos, thumbnails ────────────────────────────────
def _first_by_key(files, key):
    index = {}
    for f in files:
        index.setdefault(key(f), f)
    return index

def _qr_index() -> dict:
    """norm_name(product) -> its {product}_QR.png in QR_DIR."""
    if not QR_DIR.exists():
        return {}
    return _first_by_key(sorted(QR_DIR.glob("*_QR.png")),
                         lambda f: norm_name(re.sub(r'_qr$', '', f.stem, flags=re.I)))

def _logo_index() -> dict:
    """norm_name(file stem) -> the logo file ({product}_LOGO.*) in LOGO_DIR."""
    if not LOGO_DIR.exists():
        return {}
    return _first_by_key((f for f in sorted(LOGO_DIR.iterdir()) if f.is_file()),
                         lambda f: norm_name(f.stem))

def find_qr_for_product(product_name):
    """The {product}_QR.png in QR_DIR (case/space insensitive), or None."""
    return _qr_index().get(norm_name(product_name))

def find_logo_for_product(product_name):
    """The {product}_LOGO.* in LOGO_DIR (case/space insensitive), or None."""
    return _logo_index().get(norm_name(product_name) + "logo")

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

def _render_pdf_png(pdf_path, page, size, min_zoom, alpha) -> bytes:
    """Rasterize one PDF page to a PNG fitting size x size. A zoom floor keeps
    small pages crisp to downsample from; the 3000px cap keeps oversized
    artboards (e.g. a die-line page mistakenly used as a logo source) under
    MuPDF's pixmap limit ("Overly large image"). With alpha, the result is a
    transparent PNG cropped to its ink -- that's the logo case; without, it's
    the whole page, which *is* the label's content."""
    import fitz  # PyMuPDF
    from PIL import Image
    doc = fitz.open(str(pdf_path))
    try:
        if not 0 <= page < doc.page_count:
            raise IndexError(f"page {page} of {doc.page_count}")
        pg   = doc.load_page(page)
        dim  = max(pg.rect.width, pg.rect.height, 1)
        zoom = min(max(min_zoom, size / dim), 3000 / dim)
        pix  = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=alpha)
        img  = Image.frombytes("RGBA" if alpha else "RGB", (pix.width, pix.height), pix.samples)
    finally:
        doc.close()
    if alpha:
        img = _trim_to_content(img)
    img.thumbnail((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()

def _slug(s: str) -> str:
    return re.sub(r'[^a-zA-Z0-9]+', '_', s).strip('_')

def _cached_png(cache_dir: Path, slug: str, source: Path, variant: str, render):
    """PNG bytes cached on disk as {slug}_{source mtime}[_{variant}].png; render()
    produces them on a miss (None if it fails). Cached images made from an
    older version of the same source file are purged, but other variants of the
    current version (e.g. the other pages of a PDF) are kept."""
    mtime = str(int(source.stat().st_mtime))
    cache_file = cache_dir / (f"{slug}_{mtime}" + (f"_{variant}" if variant else "") + ".png")
    if cache_file.exists():
        return cache_file.read_bytes()
    try:
        data = render()
    except Exception:
        return None
    cache_dir.mkdir(parents=True, exist_ok=True)
    older = re.compile(re.escape(slug) + r"_(\d+)(?:_p\d+)?\.png")
    for f in cache_dir.glob(f"{slug}_*.png"):
        m = older.fullmatch(f.name)
        if m and m.group(1) != mtime:
            f.unlink(missing_ok=True)
    cache_file.write_bytes(data)
    return data

def get_logo_thumbnail(product_name: str):
    """Cached PNG bytes of a product's logo (PDF), or None."""
    logo = find_logo_for_product(product_name)
    if not logo:
        return None
    return _cached_png(LOGO_THUMB_DIR, _slug(product_name), logo, "",
                       lambda: _render_pdf_png(logo, 0, 240, 4.0, True))

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
    data = _cached_png(FILE_THUMB_DIR, _slug(rel_path), full, f"p{page}",
                       lambda: _render_pdf_png(full, page, 320, 2.0, False))
    return (data, "image/png") if data else None

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

# ── Config merging ─────────────────────────────────────────────────────────────
def sync_products(cfg, default):
    """Add the products the default config has and cfg lacks, and bring existing
    ones' category/acidic in line with the default. Returns (added, updated) names."""
    default_by_name = {p["name"]: p for p in default.get("products", [])}
    have = {p["name"] for p in cfg.get("products", [])}
    added = []
    for p in default.get("products", []):
        if p["name"] not in have:
            cfg.setdefault("products", []).append(p)
            added.append(p["name"])
    updated = []
    for p in cfg.get("products", []):
        canonical = default_by_name.get(p["name"])
        if canonical and (p.get("category") != canonical.get("category") or p.get("acidic") != canonical.get("acidic")):
            p["category"], p["acidic"] = canonical["category"], canonical["acidic"]
            updated.append(p["name"])
    return added, updated

def merged_config():
    """The live config, completed with anything new in the bundled default (new
    products, languages, sizes). Not written back -- saving does that."""
    cfg = load_json(CFG_FILE)
    default = load_json(DEFAULT_CFG_FILE, {})
    if not cfg:
        if cfg is not None or not CFG_FILE.exists():   # first run -- but never because a read failed
            save_json(CFG_FILE, default)
        return default
    sync_products(cfg, default)
    have_langs = {l["code"] for l in cfg.get("languages", [])}
    new_langs = [l for l in default.get("languages", []) if l["code"] not in have_langs]
    if new_langs:
        cfg["languages"] = cfg.get("languages", []) + new_langs
    for key in ("dimensions", "packagingSizes", "boxMultipliers"):
        for k, v in default.get(key, {}).items():
            if k not in cfg.get(key, {}):
                cfg.setdefault(key, {})[k] = v
    return cfg

# ── HTTP handler ───────────────────────────────────────────────────────────────
# Reached via 127.0.0.1, not "localhost": browsers try the IPv6 address first,
# the server only listens on IPv4, and on Windows a refused ::1 connection takes
# seconds to fail -- measured at ~160 ms extra per request versus ~5 ms.
_LOCAL_HOSTS = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
_WRITE_LOCK = threading.Lock()   # the server is threaded; serialize anything that writes files

def _abs_label_path(p):
    """Client-supplied paths are relative to LABELS_DIR unless already absolute."""
    return str(LABELS_DIR / p) if p and not Path(p).is_absolute() else p

def _ok_json(fn):
    """POST handler -> {"ok": True, **returned} on success, {"ok": False, "error": ...} on any exception."""
    def wrapper(self, body):
        try:
            self.send_json({"ok": True, **(fn(self, body) or {})})
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)})
    return wrapper

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"   # keep-alive: _send gives every response a Content-Length
    timeout = 60                    # free the thread of a connection the browser abandoned

    def log_message(self, fmt, *args):
        pass  # silence request logs

    # -- responses ------------------------------------------------------------------
    def _send(self, status=200, body=b"", ctype=None, headers=None):
        self.send_response(status)
        if ctype:
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def send_json(self, data, status=200):
        self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def send_404(self):
        self._send(404)

    def send_file(self, path, mime, cache="no-cache"):
        """Serve a file with an ETag, so an unchanged one costs a 304, not a re-download."""
        path = Path(path)
        try:
            st = path.stat()
            if not path.is_file():
                return self.send_404()
            etag = f'"{st.st_mtime_ns:x}-{st.st_size:x}"'
            if self.headers.get("If-None-Match") == etag:
                self.send_response(304)
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", cache)
                return self.end_headers()
            self._send(200, path.read_bytes(), mime, {"ETag": etag, "Cache-Control": cache})
        except OSError:
            self.send_404()

    def send_under(self, base, rel):
        """Serve base/rel, refusing anything that resolves outside base."""
        try:
            full = (base / unquote(rel)).resolve()
            full.relative_to(base.resolve())
        except (ValueError, OSError):
            return self.send_404()
        self.send_file(full, mimetypes.guess_type(full.name)[0] or "application/octet-stream")

    def send_image(self, data, mime):
        """A generated image (thumbnail); the URL changes when its source does, so cache hard."""
        self._send(200, data, mime, {"Cache-Control": "public, max-age=604800"})

    # -- request checks -----------------------------------------------------------------
    def _local_request(self):
        """False for requests that look like they come from a web page on another
        origin (the app is only ever used from its own page) or via a rebinding
        hostname. Without this, any website open in the browser could call the API."""
        origin = self.headers.get("Origin")
        return (self.headers.get("Host", "") in _LOCAL_HOSTS
                and (origin is None or urlparse(origin).netloc in _LOCAL_HOSTS))

    def _arg(self, name, default=None):
        return (self.query.get(name) or [default])[0]

    # -- GET ----------------------------------------------------------------------------
    def do_GET(self):
        url = urlparse(self.path)
        path, self.query = url.path, parse_qs(url.query)
        if not self._local_request():
            return self._send(403)

        if path == "/api/_shutdown":
            # Internal: a newer instance is asking this one to step aside.
            self._send(200, b"ok")
            threading.Thread(target=self.server.shutdown, daemon=True).start()
        elif path in ("/", "/index.html"):
            if self.headers.get("Host", "").startswith("localhost"):
                self._send(302, headers={"Location": f"http://127.0.0.1:{PORT}/"})
            else:
                self.send_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
        elif path.startswith("/static/"):
            self.send_under(STATIC_DIR, path[len("/static/"):])
        elif path.startswith("/icons/"):
            self.send_under(ICONS_DIR, path[len("/icons/"):])
        elif path in self.GET_ROUTES:
            getattr(self, self.GET_ROUTES[path])()
        else:
            self.send_404()

    GET_ROUTES = {
        "/api/config":          "api_config",
        "/api/map":             "api_map",
        "/api/scan":            "api_scan",
        "/api/pick_dir":        "api_pick_dir",
        "/api/labels_dir":      "api_labels_dir",
        "/api/resource_dirs":   "api_resource_dirs",
        "/api/sync_status":     "api_sync_status",
        "/api/templates":       "api_templates",
        "/api/translations":    "api_translations",
        "/api/history":         "api_history",
        "/api/colors":          "api_colors",
        "/api/icons":           "api_icons",
        "/api/icon_assignments":"api_icon_assignments",
        "/api/assets_check":    "api_assets_check",
        "/api/logo_thumb":      "api_logo_thumb",
        "/api/file_thumb":      "api_file_thumb",
        "/api/file_info":       "api_file_info",
        "/api/export":          "api_export",
    }

    def api_config(self):
        self.send_json(merged_config())

    def api_map(self):
        self.send_json(load_json(MAP_FILE, {"generated": None, "files": []}))

    def api_scan(self):
        with _WRITE_LOCK:
            LABELS_DIR.mkdir(parents=True, exist_ok=True)
            map_data = {"generated": datetime.now().isoformat(), "files": scan_labels()}
            save_json(MAP_FILE, map_data)
        self.send_json(map_data)

    def api_pick_dir(self):
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

    def api_labels_dir(self):
        self.send_json({"path": str(LABELS_DIR)})

    def api_resource_dirs(self):
        self.send_json({
            "labels":       str(LABELS_DIR),
            "logos":        str(LOGO_DIR),
            "qrcodes":      str(QR_DIR),
            "templates":    str(TEMPLATE_DIR),
            "translations": str(get_translations_dir()),
        })

    def api_sync_status(self):
        self.send_json(get_sync_status())

    def api_templates(self):
        t = scan_templates()
        self.send_json({"templates": t, "count": len(t)})

    def api_translations(self):
        self.send_json({"files": list_translations(get_translations_dir())})

    def api_history(self):
        self.send_json({"history": load_json(HISTORY_FILE, [])})

    def api_colors(self):
        defaults = {p["name"]: ["#808080"] * 6 for p in load_config().get("products", [])}
        self.send_json({"colors": {**defaults, **load_json(COLORS_FILE, {})}})

    def api_icons(self):
        self.send_json(load_json(ICONS_DIR / "icons.json", {"icons": [], "products": []}))

    def api_icon_assignments(self):
        self.send_json({"assignments": get_icon_assignments(load_config().get("products", []))})

    def api_assets_check(self):
        qr, logos = _qr_index(), _logo_index()
        self.send_json({
            p["name"]: {"qr": norm_name(p["name"]) in qr, "logo": norm_name(p["name"]) + "logo" in logos}
            for p in load_config().get("products", [])
        })

    def api_logo_thumb(self):
        product = self._arg("product")
        data = get_logo_thumbnail(product) if product else None
        if data:
            self.send_image(data, "image/png")
        else:
            self.send_404()

    def api_file_thumb(self):
        rel = self._arg("path")
        try:
            page = int(self._arg("page", "0"))
        except ValueError:
            page = 0
        result = get_file_thumbnail(rel, page) if rel else None
        if result:
            self.send_image(*result)
        else:
            self.send_404()

    def api_file_info(self):
        rel = self._arg("path")
        info = get_file_info(rel) if rel else None
        if info is not None:
            self.send_json(info)
        else:
            self.send_404()

    def api_export(self):
        cfg = load_config()
        payload = json.dumps({"config": cfg, "colors": load_json(COLORS_FILE, {}),
                              "icon_assignments": get_icon_assignments(cfg.get("products", []))},
                             ensure_ascii=False, indent=2).encode("utf-8")
        self._send(200, payload, "application/json",
                   {"Content-Disposition": 'attachment; filename="etiketas_export.json"'})

    # -- POST ---------------------------------------------------------------------------
    def do_POST(self):
        path = urlparse(self.path).path
        if not self._local_request():
            return self._send(403)
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length)) if length else {}
        except ValueError:
            return self._send(400)
        handler = self.POST_ROUTES.get(path)
        if handler is None:
            return self.send_404()
        with _WRITE_LOCK:
            getattr(self, handler)(body)

    POST_ROUTES = {
        "/api/config/save":          "api_config_save",
        "/api/config/reset":         "api_config_reset",
        "/api/config/sync_products": "api_sync_products",
        "/api/colors/save":          "api_colors_save",
        "/api/icon_assignments/save":"api_icon_assignments_save",
        "/api/find_template":        "api_find_template",
        "/api/create":               "api_create",
        "/api/open":                 "api_open",
        "/api/reveal":               "api_reveal",
        "/api/trash":                "api_trash",
        "/api/ingest":               "api_ingest",
    }

    @_ok_json
    def api_config_save(self, body):
        save_json(CFG_FILE, body)

    @_ok_json
    def api_config_reset(self, body):
        default = load_json(DEFAULT_CFG_FILE, {})
        save_json(CFG_FILE, default)
        return {"config": default}

    @_ok_json
    def api_sync_products(self, body):
        current = load_config()
        added, updated = sync_products(current, load_json(DEFAULT_CFG_FILE, {}))
        save_json(CFG_FILE, current)
        return {"config": current, "added": added, "updated": updated}

    @_ok_json
    def api_colors_save(self, body):
        save_json(COLORS_FILE, body)

    @_ok_json
    def api_icon_assignments_save(self, body):
        save_json(ICON_ASSIGN_FILE, body)

    def api_find_template(self, body):
        cfg      = load_config()
        product  = body.get("product")
        languages= body.get("languages", [])
        size     = body.get("packagingSize")
        prods    = cfg.get("products", [])
        prod_cfg = next((p for p in prods if p["name"]==product), None)
        if not prod_cfg:
            return self.send_json({"labels":[],"boxes":[],"dimensions":None})
        category = prod_cfg["category"]
        dims     = cfg["dimensions"].get(dim_key_for(prod_cfg),{}).get(size)
        files    = load_json(MAP_FILE, {"files":[]}).get("files",[])
        box_mult = cfg.get("boxMultipliers", {}).get(size, size)
        label_results = find_templates(files,{"product":product,"category":category,"dimensions":dims,"lang_count":len(languages),"deze":False,"packaging":size,"acidic":prod_cfg.get("acidic",False)},prods)
        box_results   = find_templates(files,{"product":product,"category":category,"dimensions":"180x180","lang_count":len(languages),"deze":True,"packaging":box_mult},prods)
        self.send_json({
            "labels": [{"file":f,"score":s,"reasons":r} for f,s,r in label_results],
            "boxes":  [{"file":f,"score":s,"reasons":r} for f,s,r in box_results],
            "dimensions": dims,
        })

    def api_create(self, body):
        try:
            result = create_label(body["product"], body["languages"], body["packagingSize"], load_config(),
                                  label_template_path=body.get("labelTemplatePath"),
                                  box_template_path=body.get("boxTemplatePath"),
                                  lang_files=body.get("langFiles"),
                                  footer_values=body.get("footerValues") or None,
                                  skip_label=body.get("skipLabel", False),
                                  skip_box=body.get("skipBox", False))
            self.send_json({"success":True,**result})
        except Exception as e:
            self.send_json({"success":False,"error":str(e)})

    @_ok_json
    def api_open(self, body):
        open_path(_abs_label_path(body.get("path","")))

    @_ok_json
    def api_reveal(self, body):
        reveal_path(_abs_label_path(body.get("path","")))

    @_ok_json
    def api_trash(self, body):
        p = _abs_label_path(body.get("path", ""))
        try:
            rel = str(Path(p).resolve().relative_to(LABELS_DIR.resolve()))
        except (ValueError, OSError):
            raise ValueError("Only files inside the labels folder can be deleted")
        trash_path(p)
        def drop(map_data):
            map_data["files"] = [f for f in map_data.get("files", []) if f.get("path") != rel]
        update_map(drop)

    @_ok_json
    def api_ingest(self, body):
        src_path = body.get("path", "")
        if not src_path or not Path(src_path).exists():
            raise ValueError("Invalid or missing path")
        LABELS_DIR.mkdir(parents=True, exist_ok=True)
        result = organizer.ingest(Path(src_path), LABELS_DIR, cat=make_catalogue(merged_config()))
        if result["entries"] and not result["dry_run"]:
            def add_ingested(map_data):
                by_path = {f["path"]: f for f in map_data.get("files", [])}
                by_path.update({e["path"]: e for e in result["entries"]})
                map_data["files"]     = sorted(by_path.values(), key=lambda x: x["path"])
                map_data["generated"] = datetime.now().isoformat()
            update_map(add_ingested)
        return {"copied": len(result["entries"]), "skipped": result["skipped"],
                "errors": len(result["errors"]), "files": result["entries"]}


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
    url    = f"http://127.0.0.1:{PORT}"
    print("Etiketas - Label Manager")
    print(f"  Running at {url}")
    print(f"  Labels dir: {LABELS_DIR}")
    print("  Press Ctrl+C to stop\n")
    t = threading.Timer(0.8, lambda: webbrowser.open(url)); t.daemon = True; t.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")

if __name__ == "__main__":
    start()
