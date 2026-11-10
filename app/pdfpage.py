"""Opening PDFs and drawing their pages, in one place: the thumbnails and logos (etiketas.py) and the
mockups (mockups.py) both draw pages through page_image. PyMuPDF and Pillow are imported when a page is
drawn, so importing this module costs nothing."""

MM_PER_PT = 25.4 / 72       # PDF and IDML measure in points


def pymupdf():
    """The PyMuPDF module, under its newer name or the older one."""
    try:
        import pymupdf as module
    except ImportError:      # older PyMuPDF
        import fitz as module
    return module


def page_image(pdf, page_no, frame, alpha=False):
    """One page of a PDF as a Pillow image. frame(page) says what to draw: (clip rectangle, or None for the
    whole page; zoom, where 1 is 72 dpi). With alpha, the image keeps the page's transparency."""
    from PIL import Image
    fitz = pymupdf()
    doc = fitz.open(str(pdf))
    try:
        if not 0 <= page_no < doc.page_count:
            raise IndexError(f"page {page_no} of {doc.page_count}")
        page = doc.load_page(page_no)
        clip, zoom = frame(page)
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip, alpha=alpha)
        return Image.frombytes("RGBA" if alpha else "RGB", (pix.width, pix.height), pix.samples)
    finally:
        doc.close()
