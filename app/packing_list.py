"""The packing list exported from the shipment calculator, as a Word document.

Written directly as OOXML with the standard library, so the app needs nothing new installed.
The page works out every figure and sends them here as text (see packingListDoc in app.js): the
sums stay in one place, the calculator's, and this file only knows how the document is laid out.
Nothing company-specific belongs here, this repo is public: names and figures come in with the request.
"""
import io
import re
import struct
import zipfile
from datetime import datetime, timezone
from xml.sax.saxutils import escape

MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
_DRAW = ('xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
         'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
         'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"')
_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

_HEADING_COLOR, _HEADER_FILL = "234A58", "EDF2F4"
_COLUMNS = (3685, 4082, 2324)     # twips, the width between the page margins
_LOGO_HEIGHT_EMU = 468000         # 1.3 cm


def _run(text, size=18, bold=False, color=None):
    props = ("<w:b/>" if bold else "") + (f'<w:color w:val="{color}"/>' if color else "") + f'<w:sz w:val="{size}"/>'
    return f'<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{escape(str(text))}</w:t></w:r>'


def _para(run="", *, before=None, after=None, keep_next=False):
    spacing = "".join(f' w:{k}="{v}"' for k, v in (("before", before), ("after", after)) if v is not None)
    props = ("<w:keepNext/>" if keep_next else "") + (f"<w:spacing{spacing}/>" if spacing else "")
    return f"<w:p>{f'<w:pPr>{props}</w:pPr>' if props else ''}{run}</w:p>"


def _cell(text, width, *, bold=False, fill=None, keep_next=False):
    shading = f'<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>' if fill else ""
    run = _run(text, bold=bold) if text else ""
    return (f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{shading}</w:tcPr>'
            f"{_para(run, after=0, keep_next=keep_next)}</w:tc>")


def _table(head, rows):
    """A table a page break can't split: each row keeps with the next, so it moves over whole."""
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in _COLUMNS)
    margins = "".join(f'<w:{side} w:w="65" w:type="dxa"/>' for side in ("top", "left", "bottom", "right"))
    def row(cells, *, bold=False, fill=None, keep_next=True):
        tds = "".join(_cell(c, w, bold=bold, fill=fill, keep_next=keep_next) for c, w in zip(cells, _COLUMNS))
        return f"<w:tr><w:trPr><w:cantSplit/></w:trPr>{tds}</w:tr>"
    body = "".join(row(r, keep_next=i < len(rows) - 1) for i, r in enumerate(rows))
    return (f'<w:tbl><w:tblPr><w:tblW w:w="{sum(_COLUMNS)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>'
            f"<w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid>{grid}</w:tblGrid>"
            f"{row(head, bold=True, fill=_HEADER_FILL)}{body}</w:tbl>")


def _heading(text):
    return _para(_run(text, size=22, bold=True, color=_HEADING_COLOR), before=160, keep_next=True)


def _document(doc):
    parts = [_para(_run("PACKING LIST", size=38, bold=True, color=_HEADING_COLOR)),
             _para(_run(doc["customer"], size=24, bold=True)),
             _para()]
    for s in doc["sections"]:
        parts += [_heading(s["title"]),
                  _para(_run(s["meta"], bold=True), keep_next=True),
                  _table(("Product & packing", "Quantity / calculation", "Weight"), s["rows"])]
    parts += [_heading("TOTAL SHIPMENT"),
              _table(("Shipment component", "Quantity / calculation", "Weight"), doc["totals"]),
              # Kept together, so a signature never lands alone at the top of a page.
              _para(_run(f"Weights are approximate. Transport type: {doc['transport']}."), keep_next=True),
              *[_para(keep_next=True)] * 3,
              _para(_run("_" * 72), keep_next=True),
              _para(_run("Edita Galvanauskaitė, on behalf of UAB Nando / the Seller"), keep_next=True),
              _para(_run("Signature / stamp"))]
    section = ('<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/>'
               '<w:footerReference w:type="default" r:id="rIdFooter"/>'
               '<w:pgSz w:w="11906" w:h="16838"/>'
               '<w:pgMar w:top="1170" w:right="907" w:bottom="737" w:left="907" w:header="709" w:footer="249" w:gutter="0"/>'
               '<w:pgNumType w:start="1"/></w:sectPr>')
    return f'{_XML}<w:document {_W} {_R}><w:body>{"".join(parts)}{section}</w:body></w:document>'


def _png_size(png):
    return struct.unpack(">II", png[16:24])


def _header(logo_png):
    w, h = _png_size(logo_png)
    cy, cx = _LOGO_HEIGHT_EMU, _LOGO_HEIGHT_EMU * w // h
    picture = (f'<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr>'
               f'<pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
               f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
               f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>')
    drawing = (f'<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/>'
               f'<wp:docPr id="1" name="Logo" descr="Nando logo"/><wp:cNvGraphicFramePr/>'
               f'<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">{picture}'
               f'</a:graphicData></a:graphic></wp:inline></w:drawing>')
    return f'{_XML}<w:hdr {_W} {_R} {_DRAW}><w:p><w:pPr><w:spacing w:after="160"/></w:pPr><w:r>{drawing}</w:r></w:p></w:hdr>'


def _footer():
    size = '<w:rPr><w:sz w:val="24"/></w:rPr>'
    field = (f'<w:r>{size}<w:fldChar w:fldCharType="begin"/></w:r><w:r>{size}<w:instrText>PAGE</w:instrText></w:r>'
             f'<w:r>{size}<w:fldChar w:fldCharType="separate"/></w:r><w:r>{size}<w:t>1</w:t></w:r>'
             f'<w:r>{size}<w:fldChar w:fldCharType="end"/></w:r>')
    return f'{_XML}<w:ftr {_W}><w:p><w:pPr><w:jc w:val="right"/></w:pPr>{field}</w:p></w:ftr>'


_STYLES = (f'{_XML}<w:styles {_W}><w:docDefaults><w:rPrDefault><w:rPr>'
           '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="18"/>'
           '<w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>'
           '<w:pPrDefault><w:pPr><w:spacing w:after="40" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
           '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
           '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:semiHidden/>'
           '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>'
           '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>')

# Without the compatibility mode, Word opens the file saying it is in compatibility mode.
_SETTINGS = (f'{_XML}<w:settings {_W}><w:compat><w:compatSetting w:name="compatibilityMode" '
             'w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>')

_CONTENT_TYPES = (f'{_XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                  '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
                  + "".join(f'<Override PartName="/word/{part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/>'
                            for part, kind in (("document", "document.main"), ("styles", "styles"), ("settings", "settings"),
                                               ("header1", "header"), ("footer1", "footer")))
                  + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>')


def _rels(*items):
    return (f'{_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(f'<Relationship Id="{i}" Type="{t}" Target="{target}"/>' for i, t, target in items) + "</Relationships>")


def _core(doc):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return (f'{_XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            f'<dc:title>{escape("Packing list, " + str(doc["customer"]))}</dc:title><dc:creator>UAB Nando</dc:creator>'
            f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>'
            f'<dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified></cp:coreProperties>')


def build_docx(doc, logo_png):
    """The .docx bytes. doc: {customer, transport, sections: [{title, meta, rows}], totals}; rows are 3 strings each."""
    parts = {
        "[Content_Types].xml": _CONTENT_TYPES,
        "_rels/.rels": _rels(("rId1", f"{_REL}/officeDocument", "word/document.xml"),
                             ("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml")),
        "docProps/core.xml": _core(doc),
        "word/document.xml": _document(doc),
        "word/_rels/document.xml.rels": _rels(("rIdStyles", f"{_REL}/styles", "styles.xml"), ("rIdSettings", f"{_REL}/settings", "settings.xml"),
                                              ("rIdHeader", f"{_REL}/header", "header1.xml"), ("rIdFooter", f"{_REL}/footer", "footer1.xml")),
        "word/styles.xml": _STYLES,
        "word/settings.xml": _SETTINGS,
        "word/header1.xml": _header(logo_png),
        "word/_rels/header1.xml.rels": _rels(("rIdLogo", f"{_REL}/image", "media/logo.png")),
        "word/footer1.xml": _footer(),
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, text in parts.items():
            z.writestr(name, text)
        z.writestr("word/media/logo.png", logo_png)
    return buf.getvalue()


def file_name(customer):
    safe = re.sub(r'[\\/:*?"<>|\s]+', "_", str(customer)).strip("_.")
    return f"Packing_List_{safe}_{datetime.now():%Y-%m-%d}.docx"


# -- SKUs ------------------------------------------------------------------------------------------
# The shipping data has no SKUs, since one pack has a different SKU per market. They are printed on the
# labels, so that's where they're read from: "T0200M5-EN0", which some labels space as "P0600M1- 3E0".
_SKU = re.compile(r"\b([A-Z][O0-9]\d{3}[A-Z]\d{1,2})\s?[-‐-―]\s?([A-Z0-9]{2,5})\b")
# The part of a SKU that gives the pack size. A few labels print another pack's SKU, so it is checked against this.
_SIZE_CODES = {"250ml": "S2", "250g": "S2", "500ml": "S5", "500g": "S5", "1L": "M1", "1kg": "M1", "5L": "M5", "5kg": "M5", "20L": "L2"}
_read_skus = {}       # path -> (modified time, its SKUs): a label is only read again once it has changed


def _skus_on_label(path):
    import fitz  # PyMuPDF
    stamp = path.stat().st_mtime_ns
    known = _read_skus.get(path)
    if known and known[0] == stamp:
        return known[1]
    doc = fitz.open(str(path))
    try:
        text = "\n".join(page.get_text() for page in doc)
    finally:
        doc.close()
    skus = sorted({f"{code}-{market}" for code, market in _SKU.findall(text)})
    _read_skus[path] = (stamp, skus)
    return skus


def label_skus(files, resolve, labels, packaging):
    """The SKUs printed on a pack's labels, likeliest first: the right size, then English, then the newest.
    files: the entries of the label map. resolve: its relative path -> a Path, or None."""
    found = {}
    expected = _SIZE_CODES.get(packaging)
    for f in files:
        if f.get("extension") != ".pdf" or f.get("deze") or f.get("product") not in labels or f.get("packaging") != packaging:
            continue
        path = resolve(f.get("path", ""))
        if path is None:
            continue
        try:
            skus = _skus_on_label(path)
        except Exception:     # one unreadable label shouldn't cost the others
            continue
        date = f.get("date") or ""
        for sku in skus:
            entry = found.setdefault(sku, {"sku": sku, "product": f["product"], "languages": [], "date": "", "file": f.get("filename", ""),
                                           "sizeOk": expected is None or re.search(rf"[A-Z]\d{{4}}{expected}-", sku.replace("O", "0", 1)) is not None})
            entry["languages"] = sorted({*entry["languages"], *(f.get("languages") or [])})
            if date >= entry["date"]:
                entry.update(date=date, file=f.get("filename", ""), product=f["product"])

    def english(entry):
        return 0 if entry["languages"] == ["EN"] else 1 if "EN" in entry["languages"] else 2
    newest_first = sorted(found.values(), key=lambda e: e["date"], reverse=True)
    return sorted(newest_first, key=lambda e: (not e["sizeOk"], english(e)))
