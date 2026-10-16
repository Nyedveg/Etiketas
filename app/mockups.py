"""Label mockups: a label's print PDF shown on a photo of its package.

Photos live in assets/mockups, trimmed to squares (the mockup is the whole picture);
assets/mockups/mockups.json says which photo a label goes on (by category, acidic "pH"
products, and pack size) and how:

  wrap   wrapped round a cylinder -- the bottles. This is the bottle_mockup.py helper script's method,
         calibrated once to the white 1 L bottle photo and scaled here to the resolution used.
         The body is lengthened or shortened to fit the label, so the same photo gives the 1 L
         and the 0.25 L bottle.
  panel  a label on a flat or soft surface -- canisters and pouches. It is fitted into the
         four-cornered 'area' through a perspective transform, so it follows a face that is
         turned from the camera, and can bow with the package's curves; the photo's shading goes
         over it in Multiply and its highlights in Screen. On the foil pouch a displacement map
         bends it with the folds, and it is printed on slightly off-white paper.

Only numpy and Pillow are needed (plus PyMuPDF, which the app already uses).
"""
import io
import json
import math
from fnmatch import fnmatchcase
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

try:
    import pymupdf
except ImportError:          # older PyMuPDF
    import fitz as pymupdf

# ---- which photo ---------------------------------------------------------------------------
def pack_key(packaging):
    """'1l', '5l', '250ml', '5kg', '250g' ... -- the pack part of a photo's name, or None."""
    import re
    m = re.match(r'^(\d+(?:[.,]\d+)?)(kg|g|l|ml)$', (packaging or '').strip().lower())
    if not m:
        return None
    n, unit = float(m.group(1).replace(',', '.')), m.group(2)
    if unit in ('l', 'ml'):
        litres = n / 1000 if unit == 'ml' else n
        return f'{litres * 1000:g}ml' if litres < 1 else f'{litres:g}l'
    grams = n * 1000 if unit == 'kg' else n
    return f'{grams:g}g' if grams < 1000 else f'{grams / 1000:g}kg'

def _read_config(mockup_dir: Path) -> dict:
    return json.loads((mockup_dir / 'mockups.json').read_text(encoding='utf-8'))

def load_config(mockup_dir: Path) -> dict:
    """mockups.json's photos, keyed by lower-case photo name (e.g. 'pam_ph')."""
    return {k.lower(): v for k, v in _read_config(mockup_dir).get('photos', {}).items()}

def choose(mockup_dir: Path, category, acidic, packaging):
    """(name, settings) of the photo for a label, or (None, reason): the entry for exactly this
    pack (PAM_5l), else the category's template if its 'packs' cover it (MO, for every g/kg pack)
    -- and failing both, the same for the category named in 'same_as' (MO liquids come in the
    same bottles and canisters as PAM)."""
    cfg = _read_config(mockup_dir)
    photos = {k.lower(): v for k, v in cfg.get('photos', {}).items()}
    def usable(entry):
        return entry and (mockup_dir / entry['photo']).is_file()
    key = pack_key(packaging)
    if not category or not key:
        return None, 'The label’s product or pack size isn’t known, so there is no picture to put it on.'
    pH = '_pH' if acidic else ''
    same_as = {k.lower(): v for k, v in cfg.get('same_as', {}).items()}
    cat, seen = category, set()
    while cat and cat.lower() not in seen:
        seen.add(cat.lower())
        entry = photos.get(f"{cat}{pH}_{key}".lower())
        if usable(entry):
            return f"{cat}{pH}_{key}", entry
        template = photos.get(f"{cat}{pH}".lower())
        if usable(template) and any(fnmatchcase(key, pat.lower()) for pat in template.get('packs', [])):
            return f"{cat}{pH}", template
        cat = same_as.get(cat.lower())
    return None, f'There is no mockup picture for {category}{pH}_{key} yet.'

# ---- the label artwork ------------------------------------------------------------------------
def bleed_mm(w_mm, h_mm, dims, filename):
    """Bleed per side when a PDF has no TrimBox: judged from the page size against the size in
    the filename (the '+2mm' in a name isn't always true)."""
    if dims:
        try:
            dw, dh = (float(v) for v in dims.lower().split('x'))
        except ValueError:
            dw = dh = None
        if dw:
            if abs(w_mm - dw) <= 1 and abs(h_mm - dh) <= 1:
                return 0.0
            if abs(w_mm - dw - 4) <= 1 and abs(h_mm - dh - 4) <= 1:
                return 2.0
    return 2.0 if '2mm' in filename.lower() else 0.0

def label_info(pdf: Path, dims):
    """[(width mm, height mm), ...] of each page's trimmed label."""
    doc = pymupdf.open(str(pdf))
    try:
        return [_trim(doc[i], dims, pdf.name)[1:] for i in range(doc.page_count)]
    finally:
        doc.close()

def _trim(page, dims, filename):
    """(clip rect, width mm, height mm): the TrimBox when InDesign wrote one, otherwise the page
    minus its bleed."""
    r = page.rect
    tb = page.trimbox & r
    if tb.is_valid and not tb.is_empty and (r.width - tb.width > 1 or r.height - tb.height > 1):
        clip = tb
    else:
        b = bleed_mm(r.width / 72 * 25.4, r.height / 72 * 25.4, dims, filename) / 25.4 * 72
        clip = pymupdf.Rect(r.x0 + b, r.y0 + b, r.x1 - b, r.y1 - b)
    return clip, clip.width / 72 * 25.4, clip.height / 72 * 25.4

def render_label(pdf: Path, page_no: int, dims, width_px: int):
    """(RGB image, width mm, height mm) of one page's trimmed label, `width_px` wide."""
    doc = pymupdf.open(str(pdf))
    try:
        page = doc[page_no]
        clip, w_mm, h_mm = _trim(page, dims, pdf.name)
        zoom = max(0.5, min(width_px, 8000) / clip.width)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, alpha=False)
        return Image.frombytes('RGB', (pix.width, pix.height), pix.samples), w_mm, h_mm
    finally:
        doc.close()

# ---- small numpy stand-ins for scipy -------------------------------------------------------------
def _blur1d(a, sigma, axis):
    r = max(1, int(math.ceil(3 * sigma)))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    a = np.moveaxis(np.asarray(a, np.float32), axis, 0)
    pad = np.pad(a, [(r, r)] + [(0, 0)] * (a.ndim - 1), mode='edge')
    out = np.zeros_like(a)
    for i, w in enumerate(k):
        out += w * pad[i:i + a.shape[0]]
    return np.moveaxis(out, 0, axis)

def _blur_rgb(a, radius):
    """Gaussian blur of a float 0..255 RGB array (via Pillow)."""
    im = Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(radius)), np.float32)

def _blur_gray(a, radius):
    """Gaussian blur of a float 0..255 grey array (via Pillow: fast at any radius)."""
    im = Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8), 'L')
    return np.asarray(im.filter(ImageFilter.GaussianBlur(radius)), np.float32)

# ---- wrap (bottles) -------------------------------------------------------------------------------
# bottle_mockup.py's calibration of the white bottle photo, measured with the photo at 2576 px wide.
# PAM_1l.jpg is that photo (4938 px wide) trimmed to a 3292 px square from x = 804.
_CAL_WIDTH, _SRC_WIDTH, _TRIM_X0, _TRIM_SIDE = 2576, 4938, 804, 3292
_CAL = dict(CX=1278.0, R=190.0, TOP=(698.0, 31.0, -2.0), BOT=(1365.5, 46.0, 1.0), TOP_OFFSET=2.0,
            BOT_OFFSET=-1.0, LABEL_PX_1L=680.0, BOTTLE_TOP=404.0, BOTTLE_BOTTOM=1504.0, CUT_ROW=950.0)
_V_OVER_H = 1.0378                    # vertical / horizontal px-per-mm on this photo
_WRAP_FILL = 1100 / 1400              # bottle height as a share of the square crop

def _calibration(side):
    """The calibration for the trimmed photo at `side` px; 'k' is its px per calibration px."""
    k = side / _TRIM_SIDE * _SRC_WIDTH / _CAL_WIDTH
    c = {n: (tuple(v * k for v in val) if isinstance(val, tuple) else val * k) for n, val in _CAL.items()}
    c['CX'] = (_CAL['CX'] * _SRC_WIDTH / _CAL_WIDTH - _TRIM_X0) * side / _TRIM_SIDE
    c['k'] = k
    return c

def _curve(p, u):
    yl, b, t = p
    return yl + b * np.sqrt(np.clip(1 - u * u, 0, 1)) + t * u

_CACHE = {}

def _fingerprint(path: Path):
    """Identifies a photo by its content, so identical copies (MO_1kg / MO_5kg ...) share one cache entry."""
    import hashlib
    with open(path, 'rb') as f:
        head = f.read(1 << 20)
    return (path.stat().st_size, hashlib.sha1(head).hexdigest())

def _cached(key, make):
    """Decoded photos are big (50-70 MB each): keep only the few most recently used."""
    if key in _CACHE:
        _CACHE[key] = _CACHE.pop(key)              # most recent last
    else:
        while len(_CACHE) >= 4:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[key] = make()
    return _CACHE[key]

def _photo(path: Path, width=None) -> Image.Image:
    """A decoded RGB photo, optionally scaled down to `width`."""
    def make():
        im = Image.open(path).convert('RGB')
        if width and width < im.width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        return im
    return _cached(('photo', _fingerprint(path), width), make)

def wrap_mockup(photo_path: Path, pdf: Path, page_no: int, dims, view: str, out_size: int) -> Image.Image:
    work_n = min(out_size * 2, 3000)                          # supersampled work image
    full_w = Image.open(photo_path).width
    native = _calibration(full_w)
    need = (native['BOTTLE_BOTTOM'] - native['BOTTLE_TOP']) / _WRAP_FILL          # crop size at full resolution
    # a smaller copy of the photo is enough when the picture is small (the calibration scales with it)
    scale = min(1.0, work_n / need)
    photo = _photo(photo_path, int(full_w * scale) if scale < 0.98 else None)
    cal = _calibration(photo.width)
    CX, R = cal['CX'], cal['R']
    # the bottle body, lengthened or shortened so the label fits (from the label's proportions)
    doc_w_mm_h = label_info(pdf, dims)[page_no]
    w_mm, h_mm = doc_w_mm_h
    px_per_mm = 2 * np.pi * R / w_mm
    d = int(round(cal['LABEL_PX_1L'] - h_mm * px_per_mm * _V_OVER_H))
    xl, xr = int(max(0, CX - photo.height)), int(min(photo.width, CX + photo.height))
    a = np.asarray(photo)[:, xl:xr]
    CX -= xl
    cut = int(round(cal['CUT_ROW']))
    if d > 0:
        a = np.concatenate([a[:cut], a[cut + d:]], 0)
    elif d < 0:
        a = np.concatenate([a[:cut], np.repeat(a[cut:cut + 1], -d, axis=0), a[cut:]], 0)
    base = Image.fromarray(a)
    shift = d

    bot = (cal['BOT'][0] - shift, cal['BOT'][1], cal['BOT'][2])
    top_p = cal['TOP']
    bottle_h = (cal['BOTTLE_BOTTOM'] - shift) - cal['BOTTLE_TOP']
    s_crop = int(min(round(bottle_h / _WRAP_FILL), base.height, base.width))
    cy = (cal['BOTTLE_TOP'] + cal['BOTTLE_BOTTOM'] - shift) / 2
    x0 = int(round(CX - s_crop / 2))
    y0 = int(np.clip(round(cy - s_crop / 2), 0, base.height - s_crop))
    sb = s_crop / work_n
    work = np.array(base.crop((x0, y0, x0 + s_crop, y0 + s_crop)).resize((work_n, work_n), Image.LANCZOS))   # uint8

    # label resolution: enough for the visible half of the bottle at the work size
    label_w_px = int(2 * np.pi * R / sb * 1.15)
    label, w_mm, h_mm = render_label(pdf, page_no, dims, label_w_px)
    lab = np.asarray(label)
    LH, LW = lab.shape[:2]
    front_mm = 0.2625 * w_mm + (w_mm / 2 if view == 'back' else 0)

    wx_l = max(int((CX - R - 6 - x0) / sb), 0); wx_r = min(int((CX + R + 6 - x0) / sb) + 1, work_n)
    wy_t = max(int((top_p[0] - 4 - y0) / sb), 0); wy_b = min(int((bot[0] + bot[1] + 4 - y0) / sb) + 1, work_n)
    wxs = np.arange(wx_l, wx_r); wys = np.arange(wy_t, wy_b)
    bx = x0 + (wxs + 0.5) * sb - 0.5
    by = y0 + (wys + 0.5) * sb - 0.5

    # horizontal: exact box average of the label columns that land in each output column
    def x_to_label(e):
        u = np.clip((e - CX) / R, -1, 1)
        mm = (front_mm + np.arcsin(u) * w_mm / (2 * np.pi)) % w_mm
        return mm * (LW / w_mm)
    a_e = x_to_label(bx - 0.5 * sb); b_e = x_to_label(bx + 0.5 * sb)
    b_e = np.where(b_e < a_e, b_e + LW, b_e)               # interval crosses the label's join
    b_e = np.maximum(b_e, a_e + 0.25)
    def split(pos):                                          # a position past the join wraps round
        turns = np.floor(pos / LW); q = pos - turns * LW
        i = np.clip(np.floor(q).astype(int), 0, LW - 1)
        return i, (q - i).astype(np.float32), turns.astype(np.float32)
    (ia, fa, ta), (ib, fb, tb) = split(a_e), split(b_e)
    width = (b_e - a_e).astype(np.float32)
    strip = np.empty((LH, len(wxs), 3), np.float32)
    for c in range(3):
        cs = np.zeros((LH, LW + 1), np.int32)                # exact running sums of each label row
        np.cumsum(lab[:, :, c], 1, dtype=np.int32, out=cs[:, 1:])
        total = cs[:, -1:].astype(np.float32)
        def at(i, f, turns):
            lo = cs[:, i]
            return (lo + (cs[:, i + 1] - lo) * f) + total * turns
        strip[:, :, c] = (at(ib, fb, tb) - at(ia, fa, ta)) / width
    strip = _blur1d(strip, 0.8, 0)

    # vertical: follow the bottle's elliptical top / bottom lines
    U = np.clip((bx - CX) / R, -0.9995, 0.9995)
    top = _curve(top_p, U) + cal['TOP_OFFSET']
    btm = _curve(bot, U) + cal['BOT_OFFSET']
    frac = (by[:, None] - top[None, :]) / (btm - top)[None, :]
    v = np.clip(frac * LH - 0.5, 0, LH - 1)
    i0 = np.floor(v).astype(int); i1 = np.minimum(i0 + 1, LH - 1); f = (v - i0)[:, :, None]
    cols = np.broadcast_to(np.arange(len(wxs))[None, :], v.shape)
    comp = strip[i0, cols] * (1 - f) + strip[i1, cols] * f

    # lighting from the photo, plus a faint gloss
    region = work[wy_t:wy_b, wx_l:wx_r].astype(np.float32)
    shade = _blur_rgb(region, 3) / 255.0
    out = comp * shade
    sheen = np.clip((shade.mean(2) - 0.90) / 0.10, 0, 1)[:, :, None] * 0.10
    out = out + sheen * (255.0 - out)

    # masks: inside the bottle's silhouette and inside the label band (soft edges)
    rows = np.clip(np.round(by).astype(int), 0, base.height - 1)
    r0 = int(rows.min())
    gray = np.asarray(base.crop((0, r0, base.width, int(rows.max()) + 1)).convert('L'))[rows - r0]
    dark = gray < 250
    found = dark.any(1)
    left = np.where(found, dark.argmax(1) + 0.5, CX - R)
    right = np.where(found, dark.shape[1] - 1 - dark[:, ::-1].argmax(1) + 0.5, CX + R)
    k_sigma = 40 * cal['k']
    left = _blur1d(left, k_sigma, 0); right = _blur1d(right, k_sigma, 0)
    sil = np.clip(np.minimum(bx[None, :] - left[:, None], right[:, None] - bx[None, :]) + 0.5, 0, 1)
    band = np.clip(np.minimum(frac, 1 - frac) * (btm - top)[None, :] / sb + 0.5, 0, 1)
    alpha = (sil * band)[:, :, None]
    work[wy_t:wy_b, wx_l:wx_r] = np.clip(region * (1 - alpha) + out * alpha + 0.5, 0, 255).astype(np.uint8)
    return Image.fromarray(work).resize((out_size, out_size), Image.LANCZOS)

# ---- panel (canisters, pouches) ---------------------------------------------------------------------
def _homography(src, dst):
    """The 3x3 perspective transform taking the four `src` points to the four `dst` points."""
    A, b = [], []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return np.append(np.linalg.solve(np.array(A, float), np.array(b, float)), 1.0).reshape(3, 3)

def _project(H, x, y):
    w = H[2, 0] * x + H[2, 1] * y + H[2, 2]
    return (H[0, 0] * x + H[0, 1] * y + H[0, 2]) / w, (H[1, 0] * x + H[1, 1] * y + H[1, 2]) / w

def _bilinear(img, x, y):
    """A float (h, w, 3) image sampled at the positions x, y (px, pixel centres at +0.5)."""
    h, w = img.shape[:2]
    x = np.clip(x - 0.5, 0, w - 1); y = np.clip(y - 0.5, 0, h - 1)
    x0 = np.minimum(x.astype(np.int32), w - 2); y0 = np.minimum(y.astype(np.int32), h - 2)
    fx = (x - x0)[..., None].astype(np.float32); fy = (y - y0)[..., None].astype(np.float32)
    top = img[y0, x0] + (img[y0, x0 + 1] - img[y0, x0]) * fx
    bottom = img[y0 + 1, x0] + (img[y0 + 1, x0 + 1] - img[y0 + 1, x0]) * fx
    return top + (bottom - top) * fy

def panel_mockup(photo_path: Path, entry: dict, pdf: Path, page_no: int, dims, out_size: int) -> Image.Image:
    side = Image.open(photo_path).width
    work = min(side, out_size * 2)                          # supersampled, then reduced to out_size
    photo = _photo(photo_path, work if work < side else None)
    k = photo.width / side

    # the area as a plane `ratio` wide and 1 high, and the perspective that puts it on the photo
    quad = np.array(entry['area'], float) * k               # top-left, top-right, bottom-right, bottom-left
    tl, tr, br, bl = quad
    ratio = entry.get('area_ratio') or float((np.hypot(*(tr - tl)) + np.hypot(*(br - bl)))
                                             / (np.hypot(*(bl - tl)) + np.hypot(*(br - tr))))
    H = _homography([(0, 0), (ratio, 0), (ratio, 1), (0, 1)], quad)
    to_plane = np.linalg.inv(H)

    # the label in that plane: fitted inside the inset, keeping its proportions, centred
    w_mm, h_mm = label_info(pdf, dims)[page_no]
    m = entry.get('inset', 0.0)
    fit = min((ratio - 2 * m) / w_mm, (1 - 2 * m) / h_mm)
    lw, lh = w_mm * fit, h_mm * fit
    u0, v0 = (ratio - lw) / 2, (1 - lh) / 2
    corners = np.array([_project(H, u, v) for u, v in ((u0, v0), (u0 + lw, v0), (u0 + lw, v0 + lh), (u0, v0 + lh))])
    shown_w = float(max(np.hypot(*(corners[1] - corners[0])), np.hypot(*(corners[2] - corners[3]))))
    label, _, _ = render_label(pdf, page_no, dims, int(shown_w * 1.1) + 2)
    lab = np.asarray(label, np.float32)
    LH, LW = lab.shape[:2]

    disp, curve = entry.get('displace'), entry.get('curve')
    pad = 2 + (int(math.ceil(max(disp) * photo.width)) if disp else 0) + (int(math.ceil(max(map(abs, curve)) * k)) if curve else 0)
    x0 = max(int(corners[:, 0].min()) - pad, 0); x1 = min(int(math.ceil(corners[:, 0].max())) + pad, photo.width)
    y0 = max(int(corners[:, 1].min()) - pad, 0); y1 = min(int(math.ceil(corners[:, 1].max())) + pad, photo.height)
    base = np.array(photo)                                   # uint8, writable
    region = base[y0:y1, x0:x1].astype(np.float32)
    lum = region @ np.array([0.299, 0.587, 0.114], np.float32)
    shade = _blur_gray(lum, max(0.6, entry.get('detail', 0.006) * shown_w))
    if entry.get('flatten'):
        # only the surface's own creases and crumples, measured against the foil round them -- not the
        # light falling across it, which would put a dark band through the label
        shade = 255 * shade / np.maximum(_blur_gray(lum, entry['flatten'] * shown_w), 1.0)

    ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float32) + 0.5
    if disp:
        # displacement map: the surface's folds (its light and shade, less the overall lighting) push the
        # label about, so it bends with them -- a well smoothed copy, so lettering curves instead of wobbling.
        # Scaled to its own range: 'displace' is the largest shift.
        folds = _blur_gray(lum, 0.035 * shown_w) - _blur_gray(lum, 0.25 * shown_w)
        folds = np.clip(folds / max(float(np.percentile(np.abs(folds), 99)), 1.0), -1, 1)
        xs = xs + folds * (disp[0] * photo.width)
        ys = ys + folds * (disp[1] * photo.width)
    u, v = _project(to_plane, xs, ys)
    if curve:
        # the area's top and bottom lines bow by `curve` px at the middle (a parabola across its width);
        # the label's edges, and everything between them, follow
        sag = (curve[0] + (curve[1] - curve[0]) * np.clip(v, 0, 1)) * k * (1 - np.clip(2 * u / ratio - 1, -1, 1) ** 2)
        u, v = _project(to_plane, xs, ys - sag)
    X, Y = (u - u0) / lw * 2 - 1, (v - v0) / lh * 2 - 1      # -1..1 across the label
    bulge = entry.get('bulge', 0.0)
    if bulge:
        # on a puffed-up surface the label's corners turn away and draw in, so its edges bow out a little
        sx, sy = X, Y
        for _ in range(4):
            f = 1 - bulge * (sx * sx + sy * sy) / 2
            sx, sy = X / f, Y / f
        X, Y = sx, sy
    lx, ly = (X + 1) / 2 * LW, (Y + 1) / 2 * LH
    edge = np.minimum(np.minimum(lx, LW - lx), np.minimum(ly, LH - ly)) * (shown_w / LW)
    alpha = np.clip(edge + 0.5, 0, 1)[..., None]            # soft one-pixel edge
    colour = _bilinear(lab, lx, ly) * np.array(entry.get('paper', (1, 1, 1)), np.float32)   # paper: off-white

    # blend modes: the photo's shading over the label in Multiply, its highlights in Screen. Both are
    # measured against the label's typical lighting, so a blue canister shades the label without tinting it.
    inside = alpha[..., 0] > 0.5
    ref = max(float(np.percentile(shade[inside], 80)) if inside.any() else 255.0, 1.0)
    layer = np.clip(1 - (1 - shade / ref) * entry.get('contrast', 1.0), 0, 1)     # the shading layer, after Levels
    multiply = 1 - entry.get('shadows', 0.5) * (1 - layer)
    if entry.get('falloff'):                                 # less light where the surface turns away
        multiply = multiply * (1 - entry['falloff'] * np.clip((X * X + Y * Y) / 2, 0, 1))
    top = 255.0 * 1.25 if entry.get('flatten') else 255.0  # brightest highlight, on the same scale as `shade`
    screen = entry.get('highlights', 0.25) * np.clip((shade - ref) / max(top - ref, 1.0), 0, 1)
    out = colour * multiply[..., None]
    out = 255 - (255 - out) * (1 - screen[..., None])
    base[y0:y1, x0:x1] = np.clip(region * (1 - alpha) + out * alpha + 0.5, 0, 255).astype(np.uint8)
    return Image.fromarray(base).resize((out_size, out_size), Image.LANCZOS)

# ---- entry point ----------------------------------------------------------------------------------
def views_for(entry, pages):
    """Which sides can be shown: a wrap label has a back; a flat one only if the PDF has a 2nd page."""
    return ['front', 'back'] if entry['kind'] == 'wrap' or pages >= 2 else ['front']

def render(mockup_dir: Path, entry: dict, pdf: Path, dims, view: str, out_size: int, fmt: str = 'PNG') -> bytes:
    """The mockup as image bytes ('PNG' for files, 'JPEG' for quick previews)."""
    if entry['kind'] == 'wrap':
        img = wrap_mockup(mockup_dir / entry['photo'], pdf, 0, dims, view, out_size)
    else:
        img = panel_mockup(mockup_dir / entry['photo'], entry, pdf, 1 if view == 'back' else 0, dims, out_size)
    buf = io.BytesIO()
    img.save(buf, fmt, **({'quality': 90} if fmt == 'JPEG' else {}))
    return buf.getvalue()
