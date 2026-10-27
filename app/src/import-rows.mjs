function invalid(message) { return Object.assign(new Error(message), { statusCode: 400 }); }
export function parseCsv(text) {
  const records = []; let record = []; let field = ''; let quoted = false; let closed = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') { if (text[index + 1] === '"') { field += '"'; index += 1; } else { quoted = false; closed = true; } }
      else field += char;
      continue;
    }
    if (char === '"') { if (field || closed) throw invalid('invalid_csv_quote'); quoted = true; }
    else if (char === ',') { record.push(field); field = ''; closed = false; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      record.push(field); if (record.some(value => value.trim())) records.push(record);
      record = []; field = ''; closed = false;
    } else { if (closed && char.trim()) throw invalid('invalid_csv_after_quote'); if (!closed) field += char; }
  }
  if (quoted) throw invalid('unclosed_csv_quote');
  record.push(field); if (record.some(value => value.trim())) records.push(record);
  if (!records.length) throw invalid('empty_import');
  const headers = records.shift().map(value => value.trim());
  if (headers.some(value => !value) || new Set(headers).size !== headers.length) throw invalid('invalid_csv_headers');
  return records.map((values,index) => {
    if (values.length !== headers.length) throw invalid(`csv_column_mismatch_row_${index+2}`);
    return Object.fromEntries(headers.map((key,column) => [key,values[column]]));
  });
}
export function parseImportRows(input) {
  let rows = input.rows;
  if (rows === undefined) {
    const text = String(input.text || '').replace(/^\uFEFF/, '').trim();
    if (!text) throw invalid('empty_import');
    try {
      rows = text.startsWith('[') ? JSON.parse(text) : text.startsWith('{') ? text.split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line)) : parseCsv(text);
    } catch (error) { if (error.statusCode) throw error; throw invalid('invalid_import_json'); }
  }
  if (!Array.isArray(rows) || !rows.length) throw invalid('import_rows_required');
  if (rows.length > 1000) throw invalid('import_limit_1000_rows');
  if (rows.some(row=>!row || typeof row!=='object' || Array.isArray(row))) throw invalid('invalid_import_row');
  return rows;
}
