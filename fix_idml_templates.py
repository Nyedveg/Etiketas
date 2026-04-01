#!/usr/bin/env python3
"""Fix issues in two IDML template files."""

import sys
import re
import zipfile
import io
import os

sys.stdout.reconfigure(encoding='utf-8')

TEMPLATES_DIR = r"C:\Users\DanieliusNiedzviegas\OneDrive - Nando, UAB\Documents\GitHub\Etiketas\templates"

TEMPLATE_1 = os.path.join(TEMPLATES_DIR, "MO_TEMPLATE_1kg_1LANG_140x160_2026_03.idml")
TEMPLATE_2 = os.path.join(TEMPLATES_DIR, "MO_TEMPLATE_1kgx10_1LANG_180x180_2026_03_BOX.idml")

FOOTER_STORIES = [
    ("d00", "FOOTER_SKU_LABEL",      "SKU code"),
    ("d01", "FOOTER_SKU_VALUE",       "[SKU]"),
    ("d02", "FOOTER_UFI_LABEL",       "UFI"),
    ("d03", "FOOTER_UFI_VALUE",       "[UFI]"),
    ("d04", "FOOTER_MFG_DATE_LABEL",  "Manufacturing date"),
    ("d05", "FOOTER_MFG_DATE_VALUE",  "[MFG DATE]"),
    ("d06", "FOOTER_BATCH_LABEL",     "Batch no."),
    ("d07", "FOOTER_BATCH_VALUE",     "[BATCH]"),
    ("d08", "FOOTER_EXP_DATE_LABEL",  "Best before"),
    ("d09", "FOOTER_EXP_DATE_VALUE",  "[EXP DATE]"),
]

STORY_TEMPLATE = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
\t<Story Self="uSTORY_ID" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="STORY_TITLE" AppliedNamedGrid="n">
\t\t<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrame" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>
\t\t<InCopyExportOption IncludeGraphicProxies="true" IncludeAllResources="false"/>
\t\t<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
\t\t\t<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" PointSize="9" AppliedFont="Roboto" FontStyle="Regular">
\t\t\t\t<Content>PLACEHOLDER_TEXT</Content>
\t\t\t</CharacterStyleRange>
\t\t</ParagraphStyleRange>
\t</Story>
</idPkg:Story>'''


def read_zip(path):
    """Read all files from a ZIP into a dict {name: bytes}."""
    files = {}
    with zipfile.ZipFile(path, 'r') as zf:
        for name in zf.namelist():
            files[name] = zf.read(name)
    return files


def write_zip(path, files):
    """Write files dict back to ZIP."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    with open(path, 'wb') as f:
        f.write(buf.getvalue())


def fix_remove_uaa(content_str):
    """Remove 'uaa' from StoryList attribute and remove idPkg:Story ref for uaa.
    Idempotent: safe to run multiple times."""
    # Remove from StoryList: handles space before or after
    # Use word boundary to avoid matching 'uaab' etc.
    content_str = re.sub(r'\buaa\b', '', content_str)
    # Clean up extra spaces in StoryList (multiple spaces -> single space, strip ends)
    content_str = re.sub(r'StoryList="([^"]*)"',
                         lambda m: 'StoryList="' + re.sub(r'\s+', ' ', m.group(1)).strip() + '"',
                         content_str)
    # Remove idPkg:Story line for uaa
    content_str = re.sub(r'[ \t]*<idPkg:Story\s+src="Stories/Story_uaa\.xml"\s*/>\r?\n?', '', content_str)
    return content_str


def fix_autosizing(content_str):
    """Add AutoSizingType="HeightOnly" to TextFramePreference tags that have
    AutoSizingReferencePoint but not AutoSizingType. Idempotent."""
    def replacer(m):
        tag = m.group(0)
        if 'AutoSizingType=' in tag:
            return tag  # Already has it
        tag = tag.replace('AutoSizingReferencePoint=', 'AutoSizingType="HeightOnly" AutoSizingReferencePoint=')
        return tag

    pattern = r'<TextFramePreference\b[^>]*AutoSizingReferencePoint=[^>]*/>'
    result = re.sub(pattern, replacer, content_str, flags=re.DOTALL)
    return result


def add_footer_stories(files):
    """Add 10 FOOTER_* story XML files to the files dict. Idempotent."""
    added = 0
    for story_id, story_title, placeholder in FOOTER_STORIES:
        filename = f"Stories/Story_{story_id}.xml"
        if filename not in files:
            xml = (STORY_TEMPLATE
                   .replace('STORY_ID', story_id)
                   .replace('STORY_TITLE', story_title)
                   .replace('PLACEHOLDER_TEXT', placeholder))
            files[filename] = xml.encode('utf-8')
            print(f"  Added story file: {filename} ({story_title})")
            added += 1
        else:
            print(f"  Already exists: {filename}")
    return files, added


def fix_designmap_add_footer(content_str):
    """Add footer story IDs to StoryList and add idPkg:Story elements. Idempotent."""
    # Add IDs to StoryList only if not already there
    sl_match = re.search(r'StoryList="([^"]*)"', content_str)
    if sl_match:
        current_ids = sl_match.group(1).split()
        ids_to_add = [sid for sid, _, _ in FOOTER_STORIES if sid not in current_ids]
        if ids_to_add:
            new_sl = sl_match.group(1).rstrip() + ' ' + ' '.join(ids_to_add)
            content_str = content_str[:sl_match.start(1)] + new_sl + content_str[sl_match.end(1):]
            print(f"  Added to StoryList: {' '.join(ids_to_add)}")
        else:
            print(f"  All footer IDs already in StoryList")

    # Find existing idPkg:Story refs for footer stories
    existing_refs = set(re.findall(r'<idPkg:Story\s+src="Stories/Story_(\w+)\.xml"\s*/>', content_str))

    # Determine which story elements need adding
    stories_to_add = [(sid, title) for sid, title, _ in FOOTER_STORIES if sid not in existing_refs]

    if stories_to_add:
        # Find position of last idPkg:Story element
        last_match = None
        for m in re.finditer(r'<idPkg:Story\b[^>]*/>', content_str):
            last_match = m

        if last_match:
            new_story_lines = '\n'.join(
                f'\t<idPkg:Story src="Stories/Story_{sid}.xml" />'
                for sid, _ in stories_to_add
            )
            insert_pos = last_match.end()
            content_str = content_str[:insert_pos] + '\n' + new_story_lines + content_str[insert_pos:]
            print(f"  Added {len(stories_to_add)} idPkg:Story elements")
        else:
            print("  WARNING: Could not find existing idPkg:Story lines to insert after!")
    else:
        print(f"  All footer idPkg:Story elements already present")

    return content_str


def fix_shared_sku_story(files):
    """Fix SHARED_SKU story: replace non-whitespace Content text with [SKU]."""
    for name, data in files.items():
        if name.startswith('Stories/') and name.endswith('.xml'):
            content_str = data.decode('utf-8')
            if 'StoryTitle="SHARED_SKU"' in content_str:
                print(f"  Found SHARED_SKU story in: {name}")
                replacement_list = ['[SKU]']
                replacement_index = [0]

                def content_replacer(m):
                    text = m.group(1)
                    if text.strip():  # non-whitespace
                        if replacement_index[0] < len(replacement_list):
                            new_text = replacement_list[replacement_index[0]]
                            replacement_index[0] += 1
                            print(f"    Replacing Content '{text}' -> '{new_text}'")
                            return f'<Content>{new_text}</Content>'
                        else:
                            print(f"    Clearing extra Content '{text}'")
                            return '<Content></Content>'
                    return m.group(0)

                new_content = re.sub(r'<Content>(.*?)</Content>', content_replacer, content_str, flags=re.DOTALL)
                files[name] = new_content.encode('utf-8')
                return files

    print("  WARNING: SHARED_SKU story not found!")
    return files


# ============================================================
# PROCESS TEMPLATE 1
# ============================================================
print("=" * 60)
print("Processing Template 1: MO_TEMPLATE_1kg_1LANG_140x160_2026_03.idml")
print("=" * 60)

files1 = read_zip(TEMPLATE_1)
print(f"Loaded {len(files1)} files from ZIP")

# Fix 1: Remove uaa from designmap.xml
print("\n--- Fix 1: Remove uaa from designmap.xml ---")
dm = files1['designmap.xml'].decode('utf-8')
sl_before = re.search(r'StoryList="([^"]*)"', dm)
print(f"  StoryList before: {sl_before.group(1)[:120] if sl_before else 'NOT FOUND'}")
print(f"  'uaa' in StoryList: {'uaa' in (sl_before.group(1) if sl_before else '')}")
print(f"  'Story_uaa.xml' ref present: {'Story_uaa.xml' in dm}")
dm = fix_remove_uaa(dm)
sl_after = re.search(r'StoryList="([^"]*)"', dm)
print(f"  StoryList after:  {sl_after.group(1)[:120] if sl_after else 'NOT FOUND'}")
print(f"  'uaa' remaining: {'uaa' in dm}")
files1['designmap.xml'] = dm.encode('utf-8')

# Fix 2: AutoSizingType in Spread files
print("\n--- Fix 2: Add AutoSizingType to Spread files ---")
spread_files = sorted(n for n in files1 if n.startswith('Spreads/'))
print(f"  Found {len(spread_files)} spread file(s)")
total_fixed = 0
for sf in spread_files:
    content = files1[sf].decode('utf-8')
    needs_fix = sum(1 for m in re.finditer(r'<TextFramePreference\b[^>]*AutoSizingReferencePoint=[^>]*/>', content, re.DOTALL)
                    if 'AutoSizingType=' not in m.group(0))
    new_content = fix_autosizing(content)
    if new_content != content:
        print(f"  Fixed {needs_fix} TextFramePreference(s) in {sf}")
        total_fixed += needs_fix
        files1[sf] = new_content.encode('utf-8')
    else:
        if needs_fix > 0:
            print(f"  WARNING: {needs_fix} still need fixing in {sf} but content unchanged!")
        else:
            print(f"  No changes needed in {sf} (0 unfixed TextFramePreferences)")
print(f"  Total TextFramePreferences fixed: {total_fixed}")

# Fix 3: Add footer stories
print("\n--- Fix 3: Add FOOTER_* stories ---")
files1, added_count = add_footer_stories(files1)
dm = files1['designmap.xml'].decode('utf-8')
dm = fix_designmap_add_footer(dm)
files1['designmap.xml'] = dm.encode('utf-8')

# Write Template 1
write_zip(TEMPLATE_1, files1)
print(f"\nWrote updated Template 1 to: {TEMPLATE_1}")

# ============================================================
# VERIFY TEMPLATE 1
# ============================================================
print("\n--- Verification: Template 1 ---")
v1 = read_zip(TEMPLATE_1)
dm_v = v1['designmap.xml'].decode('utf-8')
sl_v = re.search(r'StoryList="([^"]*)"', dm_v)
sl_ids = sl_v.group(1).split() if sl_v else []
print(f"  'uaa' in StoryList: {'uaa' in sl_ids}")
print(f"  'Story_uaa.xml' in designmap: {'Story_uaa.xml' in dm_v}")
print(f"  All 10 footer IDs in StoryList: {all(sid in sl_ids for sid, _, _ in FOOTER_STORIES)}")
missing_files = []
for sid, title, _ in FOOTER_STORIES:
    fname = f"Stories/Story_{sid}.xml"
    if fname not in v1:
        missing_files.append(fname)
    else:
        c = v1[fname].decode('utf-8')
        if f'StoryTitle="{title}"' not in c:
            print(f"  WARNING: {fname} has wrong title!")
print(f"  Missing story files: {missing_files if missing_files else 'none'}")
# Check idPkg:Story refs
refs = set(re.findall(r'<idPkg:Story\s+src="Stories/Story_(\w+)\.xml"\s*/>', dm_v))
missing_refs = [sid for sid, _, _ in FOOTER_STORIES if sid not in refs]
print(f"  Missing idPkg:Story refs: {missing_refs if missing_refs else 'none'}")
# Check AutoSizingType in spreads
for sf in sorted(n for n in v1 if n.startswith('Spreads/')):
    content = v1[sf].decode('utf-8')
    bad = sum(1 for m in re.finditer(r'<TextFramePreference\b[^>]*AutoSizingReferencePoint=[^>]*/>', content, re.DOTALL)
              if 'AutoSizingType=' not in m.group(0))
    print(f"  {sf}: TextFramePreferences without AutoSizingType: {bad}")


# ============================================================
# PROCESS TEMPLATE 2
# ============================================================
print("\n" + "=" * 60)
print("Processing Template 2: MO_TEMPLATE_1kgx10_1LANG_180x180_2026_03_BOX.idml")
print("=" * 60)

files2 = read_zip(TEMPLATE_2)
print(f"Loaded {len(files2)} files from ZIP")

# Fix 1: Remove uaa from designmap.xml
print("\n--- Fix 1: Remove uaa from designmap.xml ---")
dm2 = files2['designmap.xml'].decode('utf-8')
sl2_before = re.search(r'StoryList="([^"]*)"', dm2)
print(f"  StoryList before: {sl2_before.group(1)[:120] if sl2_before else 'NOT FOUND'}")
print(f"  'uaa' in StoryList: {'uaa' in (sl2_before.group(1) if sl2_before else '')}")
print(f"  'Story_uaa.xml' ref present: {'Story_uaa.xml' in dm2}")
dm2 = fix_remove_uaa(dm2)
sl2_after = re.search(r'StoryList="([^"]*)"', dm2)
print(f"  StoryList after:  {sl2_after.group(1)[:120] if sl2_after else 'NOT FOUND'}")
print(f"  'uaa' remaining: {'uaa' in dm2}")
files2['designmap.xml'] = dm2.encode('utf-8')

# Fix 2: AutoSizingType in Spread files
print("\n--- Fix 2: Add AutoSizingType to Spread files ---")
spread_files2 = sorted(n for n in files2 if n.startswith('Spreads/'))
print(f"  Found {len(spread_files2)} spread file(s)")
total_fixed2 = 0
for sf in spread_files2:
    content = files2[sf].decode('utf-8')
    needs_fix = sum(1 for m in re.finditer(r'<TextFramePreference\b[^>]*AutoSizingReferencePoint=[^>]*/>', content, re.DOTALL)
                    if 'AutoSizingType=' not in m.group(0))
    new_content = fix_autosizing(content)
    if new_content != content:
        print(f"  Fixed {needs_fix} TextFramePreference(s) in {sf}")
        total_fixed2 += needs_fix
        files2[sf] = new_content.encode('utf-8')
    else:
        print(f"  No changes needed in {sf} (0 unfixed TextFramePreferences)")
print(f"  Total TextFramePreferences fixed: {total_fixed2}")

# Fix 3: Fix SHARED_SKU story
print("\n--- Fix 3: Fix SHARED_SKU story ---")
files2 = fix_shared_sku_story(files2)

# Write Template 2
write_zip(TEMPLATE_2, files2)
print(f"\nWrote updated Template 2 to: {TEMPLATE_2}")

# ============================================================
# VERIFY TEMPLATE 2
# ============================================================
print("\n--- Verification: Template 2 ---")
v2 = read_zip(TEMPLATE_2)
dm_v2 = v2['designmap.xml'].decode('utf-8')
sl_v2 = re.search(r'StoryList="([^"]*)"', dm_v2)
sl2_ids = sl_v2.group(1).split() if sl_v2 else []
print(f"  'uaa' in StoryList: {'uaa' in sl2_ids}")
print(f"  'Story_uaa.xml' in designmap: {'Story_uaa.xml' in dm_v2}")
# Check SHARED_SKU
for name, data in sorted(v2.items()):
    if name.startswith('Stories/') and name.endswith('.xml'):
        c = data.decode('utf-8')
        if 'StoryTitle="SHARED_SKU"' in c:
            contents = re.findall(r'<Content>(.*?)</Content>', c, re.DOTALL)
            non_empty = [x for x in contents if x.strip()]
            print(f"  SHARED_SKU story ({name}) non-empty Content values: {non_empty}")
            print(f"  SHARED_SKU fix correct: {non_empty == ['[SKU]']}")
# Check AutoSizingType in spreads
for sf in sorted(n for n in v2 if n.startswith('Spreads/')):
    content = v2[sf].decode('utf-8')
    bad = sum(1 for m in re.finditer(r'<TextFramePreference\b[^>]*AutoSizingReferencePoint=[^>]*/>', content, re.DOTALL)
              if 'AutoSizingType=' not in m.group(0))
    print(f"  {sf}: TextFramePreferences without AutoSizingType: {bad}")

print("\nAll done!")
