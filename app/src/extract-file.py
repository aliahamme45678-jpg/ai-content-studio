"""Read DOCX/XLSX content without running macros, formulas or embedded objects."""
import base64
import io
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
data = json.load(sys.stdin)
raw = base64.b64decode(data['base64'], validate=True)
with zipfile.ZipFile(io.BytesIO(raw)) as archive:
    if sum(item.file_size for item in archive.infolist()) > 20 * 1024 * 1024:
        raise ValueError('document_expanded_size_limit')
    def xml(name):
        payload = archive.read(name)
        if b'<!DOCTYPE' in payload or b'<!ENTITY' in payload:
            raise ValueError('document_entities_not_supported')
        return ET.fromstring(payload)
    if data['extension'] == 'docx':
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        paragraphs = [''.join(p.itertext()) for p in []]
        paragraphs = [''.join(node.text or '' for node in p.findall('.//w:t', ns)) for p in xml('word/document.xml').findall('.//w:p', ns)]
        result = {'text': '\n\n'.join(p for p in paragraphs if p.strip())}
    else:
        ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = [''.join(t.text or '' for t in item.findall('.//s:t', ns)) for item in xml('xl/sharedStrings.xml').findall('s:si', ns)]
        sections, records = [], []
        for name in sorted(n for n in archive.namelist() if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')):
            rows = []
            for row in xml(name).findall('.//s:sheetData/s:row', ns):
                values = {}
                for cell in row.findall('s:c', ns):
                    col = ''.join(c for c in cell.attrib.get('r', '') if c.isalpha())
                    value = cell.find('s:v', ns)
                    value = value.text or '' if value is not None else ''
                    if cell.attrib.get('t') == 's': value = shared[int(value)]
                    elif cell.attrib.get('t') == 'inlineStr': value = ''.join(t.text or '' for t in cell.findall('.//s:t', ns))
                    values[col] = value
                if any(values.values()): rows.append(values)
            if not rows: continue
            columns = list(rows[0])
            headers = [rows[0][key] for key in columns]
            sections.append('\n'.join('\t'.join(row.get(key, '') for key in columns) for row in rows))
            if len(set(headers)) == len(headers) and all(headers):
                records.extend(dict(zip(headers, [row.get(key, '') for key in columns])) for row in rows[1:])
        result = {'text': '\n\n'.join(sections), 'rows': records}
print(json.dumps(result, ensure_ascii=False))
