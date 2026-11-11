"""The pro forma made on the Pro forma page (a prepayment sales invoice), as a Word document.

Laid out like the company's pro forma workbook. The page works out every figure and sends them here as text
(see proformaDoc in app.js), so the sums stay in one place and this file only knows the layout. The seller's
details come in with the request, from this PC: nothing company-specific belongs here, this repo is public.
"""
import wordfile as w

_HALF = w.TEXT_WIDTH // 2
_HEAD = ("No.", "Description", "SKU", "Packaging", "UOM", "Quantity", "Price/unit", "Total, EUR")
_COLUMNS = (480, 2700, 1400, 1150, 620, 980, 1150, 1612)     # twips, adding up to the text width
_ALIGN = ("center", None, None, "center", "center", "center", "right", "right")
_TERMS = (1700, 1700)             # "Payment terms:", then the terms lined up after it, however many lines they take
_PAYMENT_NOTE = ("When making the payment, please include the Prepayment Sales Invoice No. in the payment reference "
                 "or memo field. Please choose OUR option for the payment.")


def _block(title, lines, *, bold=False):
    """A heading, if any, then one paragraph a line. A line with nothing after its label is left out."""
    head = w.para(w.run(title, bold=True), after=60) if title else ""
    return head + "".join(w.para(w.run(text, bold=bold)) for text in lines if text)


def _labelled(label, value):
    return f"{label} {value}" if value else ""


def _term(label, value):
    return w.para(w.run(label, bold=True) + w.TAB + w.run(value), indent=_TERMS, after=80)


def _parties(doc):
    s, c = doc["seller"], doc["customer"]
    seller = _block("Pardavėjas / Seller:", [s["name"], _labelled("Registration No:", s["registration"]),
                                             _labelled("VAT reg. No.", s["vat"]), _labelled("Address:", s["address"]),
                                             _labelled("Phone No.:", s.get("phone"))])
    customer = _block("Pirkėjas / Customer:", [_labelled("Company name:", c["name"]), _labelled("Registration No:", c["registration"]),
                                               _labelled("VAT reg.:", c["vat"]), _labelled("Address:", c["address"]),
                                               _labelled("Invoice payment recipient's e-mail address:", c["email"])])
    bank = w.para(after=0) + _block(None, [s["bank"], _labelled("IBAN:", s["iban"]), _labelled("SWIFT:", s["swift"])], bold=True)
    terms = w.para(after=0) + _term("Payment terms:", doc["payment"]) + _term("Terms of delivery:", doc["delivery"])
    other = w.TEXT_WIDTH - _HALF
    return w.table((_HALF, other), [w.row([w.cell(seller, _HALF), w.cell(customer, other)]),
                                    w.row([w.cell(bank, _HALF), w.cell(terms, other)])])


def _cell(text, column, *, bold=False, fill=None, span=1, align=None):
    width = sum(_COLUMNS[column:column + span])
    return w.cell(w.para(w.run(text, bold=bold), before=40, after=40, align=align or _ALIGN[column]), width, span=span, fill=fill)


def _items(doc):
    """The lines, between the country of origin and the totals. Its heading repeats on each page it runs onto."""
    rows = [w.row([_cell(h, i, bold=True, fill=w.HEADER_FILL) for i, h in enumerate(_HEAD)], header=True),
            w.row([_cell(f"Country of origin: {doc['origin']}", 0, bold=True, span=len(_COLUMNS), align="left")])]
    rows += [w.row([_cell(text, i) for i, text in enumerate(line)]) for line in doc["lines"]]
    last, rate = len(_COLUMNS) - 1, doc["vatRate"]
    # Tax free, VAT is shown as nothing, with a note why. Otherwise the total before it comes first.
    totals = ([("Total without VAT", doc["net"], False)] if rate else []) + [
        (f"VAT {rate} %" + ("" if rate else " *"), doc["vat"], False), ("Total amount to pay", doc["total"], True)]
    for label, value, bold in totals:
        rows.append(w.row([_cell(label, 0, bold=True, span=last, align="right"), _cell(value, last, bold=bold)]))
    return w.table(_COLUMNS, rows, borders=w.lines(top=8, left=8, bottom=8, right=8, inside_h=4, inside_v=4))


def _document(doc):
    parts = [w.para(w.run(f"PREPAYMENT SALES INVOICE No. {doc['number']}", size=24, bold=True, color=w.HEADING_COLOR), align="center", after=0),
             w.para(w.run(doc["date"], size=22, bold=True), align="center", after=360),
             _parties(doc),
             w.para(after=200),
             _items(doc),
             w.para(w.run("*  Tax free according to LT VAT LAW article 17" if not doc["vatRate"] else "", size=14), before=60),
             w.para(w.run("Issued by:", bold=True, underline=True) + w.run(f"  {doc['issuedBy']}"), before=360),
             w.para(w.run(_PAYMENT_NOTE, bold=True), before=480)]
    return w.document("".join(parts))


def build_docx(doc, logo_png):
    """The .docx bytes. doc: {number, date, issuedBy, origin, payment, delivery, vatRate (a number), net, vat, total,
    seller: {name, registration, vat, address, phone, bank, iban, swift}, customer: {name, registration, vat, address, email},
    lines: [[no, description, sku, packaging, uom, quantity, price, total]]}, every value as the document shows it."""
    return w.package(_document(doc), logo_png, f"Prepayment sales invoice {doc['number']}")


def file_name(doc):
    """Named after its number: VPA-20261111-01.docx."""
    return f"{w.safe_name(doc['number']) or 'Proforma'}.docx"
