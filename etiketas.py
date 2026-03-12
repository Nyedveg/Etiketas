#!/usr/bin/env python3
"""
Etiketas -- Label Manager
Run with:  python etiketas.py
Opens at:  http://localhost:7842
"""

import ctypes, html, io, json, mimetypes, os, re, shutil, threading, webbrowser, subprocess, zipfile
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
LABELS_DIR = Path.home() / "Documents" / "Etiketas"
QR_DIR          = BASE_DIR / "qrcodes"
TEMPLATE_DIR    = BASE_DIR / "templates"
TRANSLATIONS_DIR = BASE_DIR / "translations"
MAP_FILE   = LABELS_DIR / "labels_map.json"
CFG_FILE     = LABELS_DIR / "app_config.json"
COLORS_FILE  = LABELS_DIR / "colors_config.json"
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

# ── Filename parser ────────────────────────────────────────────────────────────
RE_PACK = re.compile(r'^\d+(\.\d+)?(kg|g|l|ml)(x\d+)?$', re.I)
RE_LANG = re.compile(r'^[A-Z]{2}$')
RE_DIMS = re.compile(r'^\d+x\d+$', re.I)
RE_YEAR = re.compile(r'^(19|20)\d{2}$')
RE_MON  = re.compile(r'^(0[1-9]|1[0-2])$')
RE_BLEED= re.compile(r'\+2mm', re.I)
RE_PACK_AMT = re.compile(r'^(\d+(?:\.\d+)?)(kg|g|l|ml)', re.I)
RE_NLANG    = re.compile(r'^(\d+)LANG$', re.I)
RE_TMPL     = re.compile(r'^(MO|PAM)_TEMPLATE_', re.I)

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
    rest = stem[m.end():]
    deze = rest.upper().endswith('_BOX')
    if deze:
        rest = rest[:-4]
    parts = rest.split('_')
    lang_idx = next((i for i, p in enumerate(parts) if RE_NLANG.match(p)), None)
    if lang_idx is None or lang_idx < 1:
        return None
    packaging  = '_'.join(parts[:lang_idx])
    lang_count = int(RE_NLANG.match(parts[lang_idx]).group(1))
    idx = lang_idx + 1
    dims = None
    if idx < len(parts) and RE_DIMS.match(parts[idx]):
        dims = parts[idx]; idx += 1
    date = None
    if idx < len(parts) and RE_YEAR.match(parts[idx]):
        yr = parts[idx]; idx += 1
        if idx < len(parts) and RE_MON.match(parts[idx]):
            date = f"{yr}-{parts[idx]}"
        else:
            date = yr
    return {"category": category, "packaging": packaging, "lang_count": lang_count,
            "dimensions": dims, "date": date, "deze": deze}

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
    if not is_box and entry.get("dimensions") != target.get("dimensions"):
        return -1, []
    # For labels: reject if template packaging explicitly doesn't match (e.g. 5kg template ≠ 0.25kg request)
    if not is_box and entry.get("packaging") and target.get("packaging") and entry.get("packaging") != target.get("packaging"):
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
        if target.get("packaging") and entry.get("packaging") == target.get("packaging"):
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
def _hex_to_rgb(hex_color: str):
    h = hex_color.lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)

def _update_graphic_xml(xml_text: str, colors: list) -> str:
    """Replace ColorValue/Space for Brand1–Brand6 swatches in Graphic.xml content."""
    def make_replacer(r, g, b):
        def replacer(m):
            s = m.group(0)
            s = re.sub(r'\bColorValue="[^"]*"', f'ColorValue="{r} {g} {b}"', s)
            s = re.sub(r'\bSpace="[^"]*"', 'Space="RGB"', s)
            return s
        return replacer
    for i, hex_color in enumerate(colors[:6], 1):
        try:
            r, g, b = _hex_to_rgb(hex_color)
        except Exception:
            continue
        xml_text = re.sub(
            r'<Color\b[^>]*\bName="Brand' + str(i) + r'"[^>]*/?>',
            make_replacer(r, g, b),
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
    return None

def apply_footer_content(idml_path: Path, translations: list, footer_values: dict) -> bool:
    """Write combined footer labels (joined across translations) and user values to FOOTER_* stories.
    translations: list of translation dicts (may contain None for skipped slots).
    footer_values: dict with keys sku, mfg_date, batch, exp_date, manufacturer_value.
    """
    def combined_label(section_key, field_key):
        parts = []
        for t in translations:
            if t:
                v = t.get(section_key, {}).get(field_key, '')
                if v:
                    parts.append(v)
        return ' / '.join(parts)

    story_content = {
        'FOOTER_SKU_LABEL':          [combined_label('footer', 'sku_label')],
        'FOOTER_SKU_VALUE':          [footer_values.get('sku', '')],
        'FOOTER_MFG_DATE_LABEL':     [combined_label('footer', 'mfg_date_label')],
        'FOOTER_MFG_DATE_VALUE':     [''],
        'FOOTER_BATCH_LABEL':        [combined_label('footer', 'batch_label')],
        'FOOTER_BATCH_VALUE':        [''],
        'FOOTER_EXP_DATE_LABEL':     [combined_label('footer', 'exp_date_label')],
        'FOOTER_EXP_DATE_VALUE':     [combined_label('footer', 'exp_date_value')],
        'FOOTER_MANUFACTURER_LABEL': [combined_label('footer', 'manufacturer_label')],
        'FOOTER_MANUFACTURER_VALUE': [footer_values.get('manufacturer_value', '')],
    }

    buf = io.BytesIO()
    try:
        with zipfile.ZipFile(str(idml_path), 'r') as zin:
            with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    data = zin.read(item.filename)
                    if item.filename.startswith('Stories/'):
                        xml = data.decode('utf-8')
                        m = re.search(r'StoryTitle="([^"]+)"', xml)
                        if m and m.group(1) in story_content:
                            xml = _replace_story_contents(xml, story_content[m.group(1)])
                        data = xml.encode('utf-8')
                    zout.writestr(item, data)
    except Exception:
        return False
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

def list_translations():
    files = []
    if not TRANSLATIONS_DIR.exists():
        return files
    for f in sorted(TRANSLATIONS_DIR.rglob("*.json")):
        try:
            meta = load_json(f, {}).get('meta', {})
            files.append({
                "filename": f.name,
                "path":     str(f),
                "code":     meta.get('code', f.stem),
                "name":     meta.get('name', f.stem),
                "flag":     meta.get('flag', ''),
                "product":  meta.get('product', None),
            })
        except Exception:
            files.append({"filename": f.name, "path": str(f), "code": f.stem, "name": f.stem, "flag": ""})
    return files

# ── Label creation ─────────────────────────────────────────────────────────────
def create_label(product, languages, packaging_size, config, label_template_path=None, box_template_path=None, lang_files=None, footer_values=None):
    prods    = config.get("products", [])
    prod_cfg = next((p for p in prods if p["name"]==product), None)
    if not prod_cfg:
        raise ValueError(f"Product not found: {product}")

    category = prod_cfg["category"]
    acidic   = prod_cfg.get("acidic", False)
    dim_key  = ("PAM_acidic" if acidic else "PAM_normal") if category=="PAM" else "MO"
    dims     = config["dimensions"].get(dim_key, {}).get(packaging_size)
    if not dims:
        raise ValueError(f"No dimensions for {dim_key}/{packaging_size}")

    box_mult  = config.get("boxMultipliers", {}).get(packaging_size, packaging_size)
    map_data  = load_json(MAP_FILE, {"files": []})
    all_files = map_data.get("files", [])

    # Resolve templates before computing names (templates may be absolute-path entries)
    all_pool = all_files + scan_templates()
    if label_template_path:
        label_tmpl  = next((f for f in all_pool if f.get("path") == label_template_path), None)
        label_score = 0
    else:
        label_tmpl, label_score = find_template(all_files,
            {"product":product,"category":category,"dimensions":dims,
             "lang_count":len(languages),"deze":False,"packaging":packaging_size}, prods)
    if box_template_path:
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
    # Pre-load translation data for each slot (None = skip)
    translations = []
    for lf in (lang_files or []):
        translations.append(load_json(lf) if lf else None)

    def make_file(tmpl, dest_dir, dest_name, apply_qr=False):
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
                for slot_idx, trans in enumerate(translations):
                    if trans:
                        ok = apply_lang_translation(dest_path, slot_idx + 1, trans)
                        ops["translations"].append(ok)
                    else:
                        ops["translations"].append(None)  # skipped
                if apply_qr and footer_values:  # label only (apply_qr=True for label)
                    ops["footer"] = apply_footer_content(dest_path, translations, footer_values)
        else:
            dest_path.write_bytes(b"")
        return dest_path, ops

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

    box_path, box_ops = make_file(box_tmpl, box_dir, box_name, apply_qr=False)
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
        result = subprocess.run(['cscript', '//NoLogo', vbs_tmp], capture_output=True, timeout=30)
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

        if path in ("/", "/index.html"):
            self.serve_static(STATIC_DIR / "index.html", "text/html; charset=utf-8"); return

        if path in ("/Nando-ico.png", "/Nando-white.png"):
            self.serve_static(BASE_DIR / path[1:], "image/png"); return

        if path.startswith("/static/"):
            rel  = path[len("/static/"):]
            mime = mimetypes.guess_type(rel)[0] or "application/octet-stream"
            self.serve_static(STATIC_DIR / rel, mime); return

        if path == "/api/config":
            cfg = load_json(CFG_FILE)
            if not cfg:
                cfg = load_json(DEFAULT_CFG_FILE, {})
                save_json(CFG_FILE, cfg)
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

        elif path == "/api/colors":
            colors = load_json(COLORS_FILE, {})
            cfg = load_json(CFG_FILE, load_json(DEFAULT_CFG_FILE, {}))
            defaults = {p["name"]: ["#808080"] * 6 for p in cfg.get("products", [])}
            self.send_json({"colors": {**defaults, **colors}})

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

        elif path == "/api/translations":
            self.send_json({"files": list_translations()})

        elif path == "/api/resource_dirs":
            self.send_json({
                "logos":     str(BASE_DIR / "logos"),
                "qrcodes":   str(QR_DIR),
                "templates": str(TEMPLATE_DIR),
            })

        elif path == "/api/config/default":
            self.send_json(load_json(DEFAULT_CFG_FILE, load_json(DEFAULT_CFG_FILE, {})))

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
            dim_key  = ("PAM_acidic" if acidic else "PAM_normal") if category=="PAM" else "MO"
            dims     = cfg["dimensions"].get(dim_key,{}).get(size)
            map_data = load_json(MAP_FILE, {"files":[]})
            files    = map_data.get("files",[])
            box_mult = cfg.get("boxMultipliers", {}).get(size, size)
            label_results = find_templates(files,{"product":product,"category":category,"dimensions":dims,"lang_count":len(languages),"deze":False,"packaging":size},prods)
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
                                      footer_values=fv if fv else None)
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

        elif path == "/api/colors/save":
            save_json(COLORS_FILE, body)
            self.send_json({"ok": True})

        elif path == "/api/config/reset":
            default = load_json(DEFAULT_CFG_FILE, load_json(DEFAULT_CFG_FILE, {}))
            save_json(CFG_FILE, default)
            self.send_json({"ok": True, "config": default})

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


# ── Server startup ─────────────────────────────────────────────────────────────
def start():
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    LABELS_DIR.mkdir(parents=True, exist_ok=True)
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    url    = f"http://localhost:{PORT}"
    print("Etiketas - Label Manager")
    print(f"  Running at {url}")
    print(f"  Labels dir: {LABELS_DIR}")
    print(f"  Press Ctrl+C to stop\n")
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")

if __name__ == "__main__":
    start()
