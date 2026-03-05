#!/usr/bin/env python3
"""
Etiketas -- Label Manager
Run with:  python etiketas.py
Opens at:  http://localhost:7842
"""

import ctypes, json, mimetypes, os, re, shutil, threading, webbrowser, subprocess
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
HOME       = Path.home()
LABELS_DIR = HOME / "labels"
QR_DIR     = HOME / "qrcodes"
MAP_FILE   = LABELS_DIR / "labels_map.json"
CFG_FILE   = LABELS_DIR / "app_config.json"
DEFAULT_CFG_FILE = LABELS_DIR / "default_config.json"
PORT       = 7842

# ── Default config ─────────────────────────────────────────────────────────────
DEFAULT_CONFIG = {
    "products": [
        {"name":"BioBreak",           "category":"MO",  "acidic":False,"enabled":True},
        {"name":"Biotero",            "category":"MO",  "acidic":False,"enabled":True},
        {"name":"Bio 5",              "category":"MO",  "acidic":False,"enabled":True},
        {"name":"BioStart",           "category":"MO",  "acidic":False,"enabled":True},
        {"name":"BioNPK Powder S",    "category":"MO",  "acidic":False,"enabled":True},
        {"name":"BioNPK Powder S 500","category":"MO",  "acidic":False,"enabled":True},
        {"name":"BioSpektrum WG",     "category":"MO",  "acidic":False,"enabled":True},
        {"name":"BioN",               "category":"MO",  "acidic":False,"enabled":True},
        {"name":"Enzyme Power",       "category":"MO",  "acidic":False,"enabled":True},
        {"name":"Periplus",           "category":"PAM", "acidic":False,"enabled":True},
        {"name":"Opti Oil",           "category":"PAM", "acidic":False,"enabled":True},
        {"name":"Foamex Basic",       "category":"PAM", "acidic":False,"enabled":True},
        {"name":"Periterra",          "category":"PAM", "acidic":False,"enabled":True},
        {"name":"pH Antibor Plus",    "category":"PAM", "acidic":True, "enabled":True},
        {"name":"Spread Oil",         "category":"PAM", "acidic":False,"enabled":True},
        {"name":"Smart Contact",      "category":"PAM", "acidic":False,"enabled":True},
        {"name":"Lignum",             "category":"PAM", "acidic":False,"enabled":True},
        {"name":"Silano",             "category":"PAM", "acidic":False,"enabled":True},
        {"name":"Foamex ULTRA",       "category":"PAM", "acidic":False,"enabled":True},
        {"name":"pH Water Power",     "category":"PAM", "acidic":True, "enabled":True},
        {"name":"pH Smart",           "category":"PAM", "acidic":True, "enabled":True},
        {"name":"Agriwet",            "category":"PAM", "acidic":False,"enabled":True},
        {"name":"Foamex Green",       "category":"PAM", "acidic":False,"enabled":True},
        {"name":"Perifolis",          "category":"PAM", "acidic":False,"enabled":True},
        {"name":"Foamex",             "category":"PAM", "acidic":False,"enabled":True},
        {"name":"Targetum",           "category":"PAM", "acidic":False,"enabled":True},
        {"name":"Emundo",             "category":"PAM", "acidic":False,"enabled":True},
        {"name":"Periplus Leaf",      "category":"PAM", "acidic":False,"enabled":True},
    ],
    "languages": [
        {"code":"LT","name":"Lithuanian", "flag":"🇱🇹","enabled":True},
        {"code":"LV","name":"Latvian",     "flag":"🇱🇻","enabled":True},
        {"code":"EE","name":"Estonian",    "flag":"🇪🇪","enabled":True},
        {"code":"EN","name":"English",     "flag":"🇬🇧","enabled":True},
        {"code":"DE","name":"German",      "flag":"🇩🇪","enabled":True},
        {"code":"PL","name":"Polish",      "flag":"🇵🇱","enabled":True},
        {"code":"CZ","name":"Czech",       "flag":"🇨🇿","enabled":True},
        {"code":"SK","name":"Slovakian",   "flag":"🇸🇰","enabled":True},
        {"code":"HU","name":"Hungarian",   "flag":"🇭🇺","enabled":True},
        {"code":"RO","name":"Romanian",    "flag":"🇷🇴","enabled":True},
        {"code":"BG","name":"Bulgarian",   "flag":"🇧🇬","enabled":True},
        {"code":"SL","name":"Slovenian",   "flag":"🇸🇮","enabled":True},
        {"code":"ES","name":"Spanish",     "flag":"🇪🇸","enabled":True},
        {"code":"IT","name":"Italian",     "flag":"🇮🇹","enabled":True},
        {"code":"PT","name":"Portuguese",  "flag":"🇵🇹","enabled":True},
        {"code":"GR","name":"Greek",       "flag":"🇬🇷","enabled":True},
        {"code":"UA","name":"Ukrainian",   "flag":"🇺🇦","enabled":True},
        {"code":"MK","name":"Macedonian",  "flag":"🇲🇰","enabled":True},
    ],
    "packagingSizes": {
        "PAM_normal": ["1L","5L","20L"],
        "PAM_acidic": ["1L","5L","20L"],
        "MO":         ["0.25kg","1kg","5kg"],
    },
    "dimensions": {
        "PAM_normal": {"1L":"255x140","5L":"150x141","20L":"180x200"},
        "PAM_acidic": {"1L":"255x140","5L":"140x117","20L":"170x200"},
        "MO":         {"0.25kg":"100x120","1kg":"140x160","5kg":"180x180"},
    },
    "boxMultipliers": {
        "1kg":"1kgx10","5kg":"5kgx2","0.5kg":"0.5kgx20",
        "0.25kg":"0.25kgx40","1L":"1Lx12","5L":"5Lx4","20L":"20Lx1",
    },
}

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

# ── Template scoring ───────────────────────────────────────────────────────────
def score_template_detail(entry, target, products):
    """Returns (score, reasons) where reasons=[{text,type}]. type: match/warn/info."""
    reasons = []
    if entry.get("extension") != ".indd": return -1, []
    if entry.get("print_file"):           return -1, []
    if entry.get("deze") != target.get("deze", False): return -1, []
    is_box = target.get("deze", False)
    if not is_box and entry.get("dimensions") != target.get("dimensions"):
        return -1, []
    s = 0
    e_langs = len(entry.get("languages") or [])
    t_langs = target.get("lang_count", 0)
    if e_langs == t_langs:
        s += 50
        reasons.append({"text": str(e_langs) + "-language layout matches", "type": "match"})
    else:
        reasons.append({"text": "Layout: " + str(e_langs) + " vs " + str(t_langs) + " langs", "type": "warn"})
    if entry.get("product") == target.get("product"):
        s += 25
        reasons.append({"text": "Same product", "type": "match"})
    else:
        reasons.append({"text": "Product: " + str(entry.get("product")), "type": "info"})
    if is_box:
        if target.get("packaging") and entry.get("packaging") == target.get("packaging"):
            s += 10
            reasons.append({"text": "Qty matches: " + str(entry.get("packaging")), "type": "match"})
        elif target.get("packaging"):
            reasons.append({"text": "Qty: " + str(entry.get("packaging")), "type": "info"})
    else:
        reasons.append({"text": "Size: " + str(entry.get("dimensions")), "type": "info"})
    e_cat = next((p["category"] for p in products if p["name"] == entry.get("product")), None)
    if e_cat and e_cat == target.get("category"):
        s += 5
        reasons.append({"text": "Category: " + str(e_cat), "type": "match"})
    if "has_barcode" in target and entry.get("has_barcode") == target["has_barcode"]:
        s += 3
        reasons.append({"text": "Barcode layout matches", "type": "match"})
    return (s if s > 0 else -1), reasons

def find_templates(files, target, products, n=3):
    """Return up to n best-scored templates as [(file, score, reasons), ...]."""
    pool = [f for f in files if "WIP" not in f.get("filename", "")]
    if not pool:
        pool = files
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
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for fname in fnames:
            if fname.startswith('.'): continue
            ext  = Path(fname).suffix.lower()
            stem = Path(fname).stem
            is_pdf  = ext == '.pdf' and '2mm' in stem.lower()
            is_indd = ext == '.indd'
            if not is_indd and not is_pdf: continue
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

# ── Label creation ─────────────────────────────────────────────────────────────
def create_label(product, languages, packaging_size, config, label_template_path=None, box_template_path=None):
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

    lang_str = "_".join(languages)
    now      = datetime.now()
    date_str = f"{now.year}_{now.month:02d}"
    box_mult = config.get("boxMultipliers", {}).get(packaging_size, packaging_size)

    label_name = f"{product}_{packaging_size}_{lang_str}_{dims}_{date_str}_WIP.indd"
    box_name   = f"{product}_{box_mult}_{lang_str}_180x180_{date_str}_deze_WIP.indd"

    prod_dir  = product.replace(" ", "_")
    label_dir = LABELS_DIR / prod_dir / lang_str / packaging_size
    box_dir   = LABELS_DIR / prod_dir / lang_str / "Dėžė"

    map_data = load_json(MAP_FILE, {"files": []})
    all_files = map_data.get("files", [])

    if label_template_path:
        label_tmpl = next((f for f in all_files if f.get("path")==label_template_path), None)
        label_score = 0
    else:
        label_tmpl, label_score = find_template(all_files,
            {"product":product,"category":category,"dimensions":dims,
             "lang_count":len(languages),"deze":False}, prods)
    if box_template_path:
        box_tmpl = next((f for f in all_files if f.get("path")==box_template_path), None)
        box_score = 0
    else:
        box_tmpl, box_score = find_template(all_files,
            {"product":product,"category":category,"dimensions":"180x180",
             "lang_count":len(languages),"deze":True,"packaging":box_mult}, prods)

    results     = []
    new_entries = []

    def copy_file(tmpl, dest_dir, dest_name):
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / dest_name
        if dest_path.exists():
            raise FileExistsError(f"File already exists: {dest_path}")
        if tmpl:
            src_p = tmpl.get("path", "")
            src = Path(src_p) if Path(src_p).is_absolute() else LABELS_DIR / src_p
            shutil.copy2(src, dest_path)
        else:
            dest_path.write_bytes(b"")  # empty placeholder
        return dest_path

    label_path = copy_file(label_tmpl, label_dir, label_name)
    results.append({
        "type":      "packaging_label",
        "path":      str(label_path),
        "rel_path":  str(label_path.relative_to(LABELS_DIR)),
        "filename":  label_name,
        "template":  label_tmpl["filename"] if label_tmpl else None,
        "score":     label_score,
    })
    new_entries.append({
        "filename":  label_name,
        "path":      str(label_path.relative_to(LABELS_DIR)),
        "file_type": "packaging_label",
        "extension": ".indd",
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

    box_path = copy_file(box_tmpl, box_dir, box_name)
    results.append({
        "type":      "box_label",
        "path":      str(box_path),
        "rel_path":  str(box_path.relative_to(LABELS_DIR)),
        "filename":  box_name,
        "template":  box_tmpl["filename"] if box_tmpl else None,
        "score":     box_score,
    })
    new_entries.append({
        "filename":  box_name,
        "path":      str(box_path.relative_to(LABELS_DIR)),
        "file_type": "box_label",
        "extension": ".indd",
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

# ── Open file/folder in OS ─────────────────────────────────────────────────────
def open_path(p):
    if os.name == "nt":
        os.startfile(str(p))
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
                cfg = DEFAULT_CONFIG
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

        elif path == "/api/config/default":
            self.send_json(load_json(DEFAULT_CFG_FILE, DEFAULT_CONFIG))

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
            cfg      = load_json(CFG_FILE, DEFAULT_CONFIG)
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
            label_results = find_templates(files,{"product":product,"category":category,"dimensions":dims,"lang_count":len(languages),"deze":False},prods)
            box_results   = find_templates(files,{"product":product,"category":category,"dimensions":"180x180","lang_count":len(languages),"deze":True,"packaging":box_mult},prods)
            self.send_json({
                "labels": [{"file":f,"score":s,"reasons":r} for f,s,r in label_results],
                "boxes":  [{"file":f,"score":s,"reasons":r} for f,s,r in box_results],
                "dimensions": dims,
            })

        elif path == "/api/create":
            try:
                cfg    = load_json(CFG_FILE, DEFAULT_CONFIG)
                result = create_label(body["product"], body["languages"], body["packagingSize"], cfg,
                                      label_template_path=body.get("labelTemplatePath"),
                                      box_template_path=body.get("boxTemplatePath"))
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

        elif path == "/api/config/reset":
            default = load_json(DEFAULT_CFG_FILE, DEFAULT_CONFIG)
            save_json(CFG_FILE, default)
            self.send_json({"ok": True, "config": default})

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
                result = organizer.ingest(Path(src_path), LABELS_DIR)
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
    if not DEFAULT_CFG_FILE.exists():
        save_json(DEFAULT_CFG_FILE, DEFAULT_CONFIG)
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
