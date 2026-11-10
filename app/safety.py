"""Puts a product's CLP safety information on a label: its pictograms, UFI and signal word.

A template holds its pictograms as vector groups, and the size they have there is the size they get:
the right symbols go in at exactly those positions, measured, then checked against the CLP minimum for
the pack. Each symbol is a linked PDF on one 100 x 100 pt artboard with its diamond's tips on the edges,
so nothing about swapping one for another can change its size.
"""
import math
import re
from pathlib import Path
import xml.etree.ElementTree as ET

from labelnames import LANG_ALIASES, pack_base, parse_pack
from pdfpage import MM_PER_PT
import stories

GHS_CODES = [f"GHS0{n}" for n in range(1, 10)]

# CLP Annex V, and the same words for the markets outside the EU the labels go to. Keyed by ISO language code.
SIGNAL_WORDS = {
    "LT": ("Pavojinga", "Atsargiai"), "LV": ("Bīstami", "Uzmanību"), "ET": ("Ettevaatust", "Hoiatus"), "EN": ("Danger", "Warning"),
    "DE": ("Gefahr", "Achtung"), "PL": ("Niebezpieczeństwo", "Uwaga"), "CS": ("Nebezpečí", "Varování"), "SK": ("Nebezpečenstvo", "Pozor"),
    "HU": ("Veszély", "Figyelem"), "RO": ("Pericol", "Atenție"), "BG": ("Опасно", "Внимание"), "SL": ("Nevarno", "Pozor"),
    "ES": ("Peligro", "Atención"), "IT": ("Pericolo", "Attenzione"), "PT": ("Perigo", "Atenção"), "EL": ("Κίνδυνος", "Προσοχή"),
    "FR": ("Danger", "Attention"), "NL": ("Gevaar", "Waarschuwing"), "HR": ("Opasnost", "Upozorenje"), "DA": ("Fare", "Advarsel"),
    "FI": ("Vaara", "Varoitus"), "SV": ("Fara", "Varning"), "GA": ("Contúirt", "Aire"), "MT": ("Periklu", "Attenzjoni"),
    "UK": ("Небезпечно", "Обережно"), "MK": ("Опасност", "Предупредување"), "AZ": ("Təhlükə", "Diqqət"),
}
_SIGNAL_WORDS_UPPER = {w.upper() for pair in SIGNAL_WORDS.values() for w in pair}

# ── Size on the label ─────────────────────────────────────────────────────────
def size_rule(litres):
    """(smallest allowed, size to reach if possible) for a pictogram's edge in mm: CLP Annex I, Table 1.3.
    The edge is the side of the diamond, not the square around it."""
    if litres <= 3:
        return 10, 16
    if litres <= 50:
        return 23, 23
    if litres <= 500:
        return 32, 32
    return 46, 46

def capacity_litres(size):
    """A pack as the app names it ("5L", "250ml", "1kg", "1kgx10") in litres, with a box counted whole. None if it can't tell."""
    pack = parse_pack(size)
    if not pack:
        return None
    return pack_base(pack)[0] * (pack.count or 1)

# ── Finding the pictograms in a template ──────────────────────────────────────

def _mat(s):
    return [float(v) for v in s.split()] if s else [1, 0, 0, 1, 0, 0]

def _then(a, b):
    """Matrix a, then b."""
    return [a[0]*b[0] + a[1]*b[2], a[0]*b[1] + a[1]*b[3], a[2]*b[0] + a[3]*b[2], a[2]*b[1] + a[3]*b[3],
            a[4]*b[0] + a[5]*b[2] + b[4], a[4]*b[1] + a[5]*b[3] + b[5]]

def _apply(m, p):
    return m[0]*p[0] + m[2]*p[1] + m[4], m[1]*p[0] + m[3]*p[1] + m[5]

def _tag(el):
    return el.tag.rsplit("}", 1)[-1]

def _red_swatches(pkg):
    """The swatches a template's pictogram frames can be in: anything close to pure 0/100/100/0."""
    found = {"Color/CLP Red"}
    if "Resources/Graphic.xml" in pkg.parts():
        for tag in re.findall(r"<Color [^>]*>", pkg.text("Resources/Graphic.xml")):
            self_id = re.search(r'Self="([^"]*)"', tag)
            value = re.search(r'ColorValue="([^"]*)"', tag)
            space = re.search(r'Space="([^"]*)"', tag)
            if not (self_id and value and space and space.group(1) == "CMYK"):
                continue
            c, m, y, k = [float(v) for v in value.group(1).split()]
            if c < 10 and k < 10 and m > 85 and y > 85:
                found.add(self_id.group(1))
    return found

def _red_diamonds(el, transform, reds):
    """The red diamonds anywhere under el, as (corner points, side), in the space `transform` leads to. A frame
    can be a red diamond under a white one, or one compound path holding both diamonds: the larger is the outside."""
    found = []
    for child in el:
        kind = _tag(child)
        if kind == "Group":
            found += _red_diamonds(child, _then(_mat(child.get("ItemTransform")), transform), reds)
        elif kind in ("Polygon", "Rectangle") and child.get("FillColor") in reds:
            m = _then(_mat(child.get("ItemTransform")), transform)
            best = None
            for path in child.iter():
                if _tag(path) != "GeometryPathType":
                    continue
                pts = [_apply(m, [float(v) for v in a.get("Anchor").split()]) for a in path.iter() if _tag(a) == "PathPointType"]
                if len(pts) != 4:
                    continue
                sides = [math.dist(pts[i], pts[(i + 1) % 4]) for i in range(4)]
                tilted = abs(pts[0][0] - pts[1][0]) > 1 and abs(pts[0][1] - pts[1][1]) > 1
                if max(sides) - min(sides) < 1 and tilted and (best is None or sides[0] > best[1]):
                    best = (pts, sides[0])
            if best:
                found.append(best)
    return found

def find_pictograms(spread_xml, reds):
    """Every pictogram group in a spread: where it is, how big, whether it is on a page. A spare parked on the pasteboard isn't."""
    root = ET.fromstring(spread_xml)
    groups, pages = [], []
    def walk(el, parent):
        for c in el:
            t = _tag(c)
            if t == "Spread":
                walk(c, _then(_mat(c.get("ItemTransform")), parent))
            elif t == "Page":
                top, left, bottom, right = [float(v) for v in c.get("GeometricBounds").split()]
                m = _then(_mat(c.get("ItemTransform")), parent)
                a, b = _apply(m, (left, top)), _apply(m, (right, bottom))
                pages.append((min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])))
            elif t == "Group":
                diamonds = _red_diamonds(c, _mat(c.get("ItemTransform")), reds)
                if len(diamonds) > 1:       # a group of several pictograms: each is found inside it
                    walk(c, _then(_mat(c.get("ItemTransform")), parent))
                elif diamonds:
                    pts, _ = diamonds[0]
                    true_pts = [_apply(parent, p) for p in pts]
                    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                    groups.append({"self": c.get("Self"), "layer": c.get("ItemLayer") or "", "box": (min(xs), min(ys), max(xs), max(ys)),
                                   "centre": ((min(p[0] for p in true_pts) + max(p[0] for p in true_pts)) / 2,
                                              (min(p[1] for p in true_pts) + max(p[1] for p in true_pts)) / 2),
                                   "edgeMm": math.dist(true_pts[0], true_pts[1]) * MM_PER_PT})
    walk(root, [1, 0, 0, 1, 0, 0])
    for g in groups:
        g["onPage"] = any(x0 <= g["centre"][0] <= x1 and y0 <= g["centre"][1] <= y1 for x0, y0, x1, y1 in pages)
    return groups

def _group_span(text, self_id):
    start = text.find(f'<Group Self="{self_id}"')
    if start < 0:
        return None
    depth = 0
    for m in re.compile(r"<Group\b|</Group>").finditer(text, start):
        depth += 1 if m.group(0) == "<Group" else -1
        if depth == 0:
            return start, m.end()
    return None

def _frame_xml(uid, layer, box, code, uri):
    x0, y0, x1, y1 = box
    scale = (x1 - x0) / 100
    corner = lambda x, y: f'<PathPointType Anchor="{x:.6f} {y:.6f}" LeftDirection="{x:.6f} {y:.6f}" RightDirection="{x:.6f} {y:.6f}" />'
    return (f'<Rectangle Self="{uid}" ContentType="GraphicType" StoryTitle="$ID/" ItemLayer="{layer}" Locked="false" FillColor="Swatch/None" '
            f'StrokeColor="Swatch/None" StrokeWeight="0" AppliedObjectStyle="ObjectStyle/$ID/[None]" Visible="true" Name="CLP_{code}" ItemTransform="1 0 0 1 0 0">'
            f'<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>{corner(x0, y0)}{corner(x0, y1)}{corner(x1, y1)}{corner(x1, y0)}</PathPointArray></GeometryPathType></PathGeometry></Properties>'
            f'<FrameFittingOption AutoFit="false" />'
            f'<PDF Self="{uid}a" ImageTypeName="$ID/Adobe Portable Document Format (PDF)" AppliedObjectStyle="ObjectStyle/$ID/[None]" ItemTransform="{scale:.8f} 0 0 {scale:.8f} {x0:.6f} {y0:.6f}" Visible="true" Name="$ID/">'
            f'<Properties><GraphicBounds Left="0" Top="0" Right="100" Bottom="100" /></Properties>'
            f'<PDFAttribute PageNumber="1" PDFCrop="CropMedia" TransparentBackground="true" />'
            f'<Link Self="{uid}b" AssetURL="$ID/" AssetID="$ID/" LinkResourceURI="{uri}" LinkResourceFormat="$ID/Adobe Portable Document Format (PDF)" StoredState="Normal" LinkClassID="35906" LinkClientID="257" LinkResourceModified="false" LinkObjectModified="false" ShowInUI="true" CanEmbed="true" CanUnembed="true" CanPackage="true" ImportPolicy="NoAutoImport" ExportPolicy="NoAutoExport" />'
            f'</PDF></Rectangle>')

def _positions(on_page, count):
    """Where `count` pictograms go, nearest the signal word and UFI first: the bottom row, from the right.
    Three fit a template with room for two by nesting the third above the gap, as the templates with three do."""
    same_row = lambda a, b: abs(a[1] - b[1]) < 6
    bottom = max(g["box"][1] for g in on_page)
    slots = sorted(on_page, key=lambda g: (0 if bottom - g["box"][1] < 6 else 1, -g["box"][1] if bottom - g["box"][1] >= 6 else 0, -g["box"][0]))
    boxes = [g["box"] for g in slots]
    in_a_row = all(same_row(b, boxes[0]) for b in boxes)
    if count == 1 and len(boxes) >= 3 and not in_a_row and same_row(boxes[0], boxes[1]):
        boxes = boxes[2:]       # the signal word sits in the notch under the top one, so one symbol alone goes there and stays centred above it
    elif count == 3 and len(boxes) == 2 and in_a_row:
        a, b = boxes
        height = a[3] - a[1]
        boxes = [a, b, ((a[0] + b[0]) / 2, a[1] - height / 2, (a[2] + b[2]) / 2, a[3] - height / 2)]
    return boxes[:count]

def place_pictograms(pkg, codes, ghs_dir):
    """Replace a template's pictogram groups with these symbols, keeping the groups' size. None if it has no such groups."""
    reds = _red_swatches(pkg)
    result = None
    for part in pkg.parts("Spreads/", ".xml"):
        text = pkg.text(part)
        if not any(r in text for r in reds):
            continue
        groups = find_pictograms(text, reds)
        if not groups:
            continue
        on_page = [g for g in groups if g["onPage"]] or groups
        boxes = _positions(on_page, len(codes))
        spans = sorted(((*_group_span(text, g["self"]), g) for g in groups if _group_span(text, g["self"])), key=lambda s: s[0], reverse=True)
        frames = "".join(_frame_xml(f"uclp{i}", on_page[0]["layer"], box, code, (Path(ghs_dir) / f"{code}.pdf").as_uri())
                         for i, (box, code) in enumerate(zip(boxes, codes)))
        first_start = min(s[0] for s in spans)
        for start, end, _g in spans:
            text = text[:start] + (frames if start == first_start else "") + text[end:]
        pkg.set_text(part, text)
        edges = [g["edgeMm"] for g in on_page]
        result = {"placed": list(codes)[:len(boxes)], "room": 3 if len(on_page) == 2 else len(on_page), "edgeMm": round(min(edges), 2)}
    return result

# ── The text beside them ──────────────────────────────────────────────────────
_UFI_RUN = re.compile(r"UFI:?\s*[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}\s*")

def set_ufi(pkg, ufi):
    """Every "UFI: ..." on the label says this product's, or goes if it has none: a template's own must never stay. True if there was one."""
    found = False
    for part in pkg.parts("Stories/"):
        text = pkg.text(part)
        if "UFI" in text and _UFI_RUN.search(text):
            pkg.set_text(part, _UFI_RUN.sub(f"UFI: {ufi}" if ufi else "", text))
            found = True
    return found

def signal_text(word, languages):
    """The signal word in each of a label's languages, once each. English where a language has no entry."""
    if word not in ("Danger", "Warning"):
        return ""
    index = ("Danger", "Warning").index(word)
    return " / ".join(dict.fromkeys(SIGNAL_WORDS.get(LANG_ALIASES.get(code, code), SIGNAL_WORDS["EN"])[index] for code in languages))

def set_signal_word(pkg, word, languages):
    """The story that holds nothing but signal words says this product's. True if there is one."""
    found = False
    for part in pkg.parts("Stories/"):
        xml = pkg.text(part)
        runs = "".join(stories.contents(xml)).strip()
        words = [w.strip() for w in runs.split("/")] if runs else []
        if words and all(w.upper() in _SIGNAL_WORDS_UPPER for w in words):
            pkg.set_text(part, stories.set_first_run(xml, signal_text(word, languages).upper()))
            found = True
    return found

def apply_to_label(pkg, record, languages, pack, ghs_dir):
    """Put a product's safety information on a new label or box file. What the template doesn't have room for is
    reported, not dropped in silence. None when the template shows no safety information at all."""
    rec = record or {}
    codes = [c for c in GHS_CODES if c in (rec.get("pictograms") or [])]
    placed = place_pictograms(pkg, codes, ghs_dir)
    has_ufi = set_ufi(pkg, (rec.get("ufi") or "").strip())
    has_word = set_signal_word(pkg, rec.get("signalWord") or "", languages)
    if placed is None and not has_ufi and not has_word:
        return None if not codes else {"ok": False, "noFrames": True, "pictograms": codes}
    out = {"pictograms": codes, "ufi": rec.get("ufi") or "", "signalWord": rec.get("signalWord") or "", "noRecord": not record}
    litres = capacity_litres(pack)
    if placed is None:
        out["noFrames"] = bool(codes)
    else:
        out.update(placed)
        out["tooMany"] = len(placed["placed"]) < len(codes)
        if litres is not None and codes:
            least, ideal = size_rule(litres)
            out.update(minMm=least, idealMm=ideal, tooSmall=placed["edgeMm"] < least, belowIdeal=least <= placed["edgeMm"] < ideal)
    out["ok"] = not (out["noRecord"] or out.get("noFrames") or out.get("tooMany") or out.get("tooSmall"))
    return out
