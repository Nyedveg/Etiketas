"""The packing list exported from the shipment calculator, as a Word document.

The page works out every figure and sends them here as text (see packingListDoc in app.js): the
sums stay in one place, the calculator's, and this file only knows how the document is laid out.
What every exported document shares, the package, logo and styles, is in wordfile.py.
Nothing company-specific belongs here, this repo is public: names and figures come in with the request.
"""
from datetime import datetime

import wordfile as w

_COLUMNS = (3685, 4082, 2324)     # twips, the width between the page margins


def _cell(text, width, *, bold=False, fill=None, keep_next=False):
    return w.cell(w.para(w.run(text, bold=bold) if text else "", after=0, keep_next=keep_next), width, fill=fill)


def _table(head, rows):
    """A table a page break can't split: each row keeps with the next, so it moves over whole."""
    def row(cells, *, bold=False, fill=None, keep_next=True):
        return w.row(_cell(c, width, bold=bold, fill=fill, keep_next=keep_next) for c, width in zip(cells, _COLUMNS))
    body = [row(r, keep_next=i < len(rows) - 1) for i, r in enumerate(rows)]
    return w.table(_COLUMNS, [row(head, bold=True, fill=w.HEADER_FILL), *body])


def _heading(text):
    return w.para(w.run(text, size=22, bold=True, color=w.HEADING_COLOR), before=160, keep_next=True)


def _document(doc):
    parts = [w.para(w.run("PACKING LIST", size=38, bold=True, color=w.HEADING_COLOR)),
             w.para(w.run(doc["customer"], size=24, bold=True)),
             w.para()]
    for s in doc["sections"]:
        parts += [_heading(s["title"]),
                  w.para(w.run(s["meta"], bold=True), keep_next=True),
                  _table(("Product & packing", "Quantity / calculation", "Weight"), s["rows"])]
    parts += [_heading("TOTAL SHIPMENT"),
              _table(("Shipment component", "Quantity / calculation", "Weight"), doc["totals"]),
              # Kept together, so a signature never lands alone at the top of a page.
              w.para(w.run(f"Weights are approximate. Transport type: {doc['transport']}."), keep_next=True),
              *[w.para(keep_next=True)] * 3,
              w.para(w.run("_" * 72), keep_next=True),
              w.para(w.run("Edita Galvanauskaitė, on behalf of UAB Nando / the Seller"), keep_next=True),
              w.para(w.run("Signature / stamp"))]
    return w.document("".join(parts))


def build_docx(doc, logo_png):
    """The .docx bytes. doc: {customer, transport, sections: [{title, meta, rows}], totals}; rows are 3 strings each."""
    return w.package(_document(doc), logo_png, "Packing list, " + str(doc["customer"]))


def file_name(doc):
    return f"Packing_List_{w.safe_name(doc['customer'])}_{datetime.now():%Y-%m-%d}.docx"
