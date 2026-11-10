"""The text of an IDML story: its <Content> runs, in the order InDesign split them. Every edit to a label's
text goes through edit_contents, so all of them read and escape the runs the same way."""
import html
import re

_CONTENT = re.compile(r"<Content>(.*?)</Content>", re.S)


def contents(xml):
    """The text of each run, as it stands in the XML."""
    return _CONTENT.findall(xml)


def edit_contents(xml, edit):
    """Each run through edit(index, text): a string replaces the run's text (escaped here), None keeps it."""
    index = [0]

    def repl(m):
        new = edit(index[0], m.group(1))
        index[0] += 1
        return m.group(0) if new is None else f"<Content>{html.escape(new)}</Content>"
    return _CONTENT.sub(repl, xml)


def fill_runs(xml, values):
    """The runs with text take values in order, and those beyond them are emptied. Runs of only whitespace
    stay as they are: they are the spaces between a label and its value."""
    filled = [0]

    def edit(_, text):
        if not text.strip():
            return None
        value = values[filled[0]] if filled[0] < len(values) else ""
        filled[0] += 1
        return value
    return edit_contents(xml, edit)


def set_first_run(xml, text):
    """The text in the story's first run, and its other runs with text emptied."""
    return edit_contents(xml, lambda i, old: text if i == 0 else ("" if old.strip() else None))
