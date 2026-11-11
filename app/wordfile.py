"""What every Word document the app exports shares: the package, the styles, the logo header and the page numbers.

Written directly as OOXML with the standard library, so the app needs nothing new installed. Each document
(packing_list.py, proforma.py) lays out its own body with these pieces and hands it to package().
"""
import io
import re
import struct
import zipfile
from datetime import datetime, timezone
from xml.sax.saxutils import escape

MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
_DRAW = ('xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
         'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
         'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"')
XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

HEADING_COLOR, HEADER_FILL = "234A58", "EDF2F4"
TEXT_WIDTH = 10092                # twips between the page margins of SECTION
_LOGO_HEIGHT_EMU = 468000         # 1.3 cm

# A4, with the logo in the header and the page number in the footer.
SECTION = ('<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/>'
           '<w:footerReference w:type="default" r:id="rIdFooter"/>'
           '<w:pgSz w:w="11906" w:h="16838"/>'
           '<w:pgMar w:top="1170" w:right="907" w:bottom="737" w:left="907" w:header="709" w:footer="249" w:gutter="0"/>'
           '<w:pgNumType w:start="1"/></w:sectPr>')

# Characters XML 1.0 can't hold. Pasted text sometimes carries one, and Word would refuse the whole file.
_NOT_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def run(text, size=18, bold=False, color=None, underline=False):
    """A run of text. A line break in it is kept as one."""
    props = (("<w:b/>" if bold else "") + (f'<w:color w:val="{color}"/>' if color else "") + f'<w:sz w:val="{size}"/>'
             + ('<w:u w:val="single"/>' if underline else ""))
    lines = _NOT_XML.sub("", str(text)).split("\n")
    body = "<w:br/>".join(f'<w:t xml:space="preserve">{escape(line)}</w:t>' for line in lines)
    return f"<w:r><w:rPr>{props}</w:rPr>{body}</w:r>"


def para(run="", *, before=None, after=None, keep_next=False, align=None, indent=None):
    """A paragraph. indent: (left, hanging) in twips, with a tab stop where the hanging part ends."""
    spacing = "".join(f' w:{k}="{v}"' for k, v in (("before", before), ("after", after)) if v is not None)
    props = (("<w:keepNext/>" if keep_next else "")
             + (f'<w:tabs><w:tab w:val="left" w:pos="{indent[0]}"/></w:tabs>' if indent else "")
             + (f"<w:spacing{spacing}/>" if spacing else "")
             + (f'<w:ind w:left="{indent[0]}" w:hanging="{indent[1]}"/>' if indent else "")
             + (f'<w:jc w:val="{align}"/>' if align else ""))
    return f"<w:p>{f'<w:pPr>{props}</w:pPr>' if props else ''}{run}</w:p>"


TAB = "<w:r><w:tab/></w:r>"


def lines(top=None, left=None, bottom=None, right=None, inside_h=None, inside_v=None):
    """Borders for a table or a cell, each a thickness in eighths of a point. Written in the order Word requires."""
    sides = (("top", top), ("left", left), ("bottom", bottom), ("right", right), ("insideH", inside_h), ("insideV", inside_v))
    return "".join(f'<w:{side} w:val="single" w:sz="{size}" w:space="0" w:color="auto"/>' for side, size in sides if size)


def cell(content, width, *, span=1, fill=None, borders=None):
    """A table cell holding paragraphs, `width` twips wide across `span` columns of the table's grid."""
    props = (f'<w:tcW w:w="{width}" w:type="dxa"/>' + (f'<w:gridSpan w:val="{span}"/>' if span > 1 else "")
             + (f"<w:tcBorders>{borders}</w:tcBorders>" if borders else "")
             + (f'<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>' if fill else ""))
    return f"<w:tc><w:tcPr>{props}</w:tcPr>{content}</w:tc>"


def row(cells, *, header=False):
    """A table row a page break can't split. A header row is repeated on each page the table runs onto."""
    return f'<w:tr><w:trPr><w:cantSplit/>{"<w:tblHeader/>" if header else ""}</w:trPr>{"".join(cells)}</w:tr>'


def table(columns, rows, *, borders=None):
    """A table of fixed column widths (twips). Without borders it has none: the default table style draws no lines."""
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in columns)
    margins = "".join(f'<w:{side} w:w="65" w:type="dxa"/>' for side in ("top", "left", "bottom", "right"))
    return (f'<w:tbl><w:tblPr><w:tblW w:w="{sum(columns)}" w:type="dxa"/>'
            + (f"<w:tblBorders>{borders}</w:tblBorders>" if borders else "")
            + f'<w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr>'
            f'<w:tblGrid>{grid}</w:tblGrid>{"".join(rows)}</w:tbl>')


def document(body):
    return f'{XML}<w:document {W} {R}><w:body>{body}{SECTION}</w:body></w:document>'


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
    return f'{XML}<w:hdr {W} {R} {_DRAW}><w:p><w:pPr><w:spacing w:after="160"/></w:pPr><w:r>{drawing}</w:r></w:p></w:hdr>'


def _footer():
    size = '<w:rPr><w:sz w:val="24"/></w:rPr>'
    field = (f'<w:r>{size}<w:fldChar w:fldCharType="begin"/></w:r><w:r>{size}<w:instrText>PAGE</w:instrText></w:r>'
             f'<w:r>{size}<w:fldChar w:fldCharType="separate"/></w:r><w:r>{size}<w:t>1</w:t></w:r>'
             f'<w:r>{size}<w:fldChar w:fldCharType="end"/></w:r>')
    return f'{XML}<w:ftr {W}><w:p><w:pPr><w:jc w:val="right"/></w:pPr>{field}</w:p></w:ftr>'


_STYLES = (f'{XML}<w:styles {W}><w:docDefaults><w:rPrDefault><w:rPr>'
           '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="18"/>'
           '<w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>'
           '<w:pPrDefault><w:pPr><w:spacing w:after="40" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
           '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
           '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:semiHidden/>'
           '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>'
           '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>')

# Without the compatibility mode, Word opens the file saying it is in compatibility mode.
_SETTINGS = (f'{XML}<w:settings {W}><w:compat><w:compatSetting w:name="compatibilityMode" '
             'w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>')

_CONTENT_TYPES = (f'{XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                  '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
                  + "".join(f'<Override PartName="/word/{part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/>'
                            for part, kind in (("document", "document.main"), ("styles", "styles"), ("settings", "settings"),
                                               ("header1", "header"), ("footer1", "footer")))
                  + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>')


def _rels(*items):
    return (f'{XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(f'<Relationship Id="{i}" Type="{t}" Target="{target}"/>' for i, t, target in items) + "</Relationships>")


def _core(title):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return (f'{XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            f'<dc:title>{escape(_NOT_XML.sub("", title))}</dc:title><dc:creator>UAB Nando</dc:creator>'
            f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>'
            f'<dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified></cp:coreProperties>')


def package(document_xml, logo_png, title):
    """The .docx bytes: the document made with document(), with the logo header and page-number footer."""
    parts = {
        "[Content_Types].xml": _CONTENT_TYPES,
        "_rels/.rels": _rels(("rId1", f"{_REL}/officeDocument", "word/document.xml"),
                             ("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml")),
        "docProps/core.xml": _core(title),
        "word/document.xml": document_xml,
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


def safe_name(text):
    """Text as part of a file name: what Windows doesn't allow, and spaces, become underscores."""
    return re.sub(r'[\\/:*?"<>|\s]+', "_", str(text)).strip("_.")
