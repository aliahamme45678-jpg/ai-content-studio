import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readImportFile } from '../src/file-import.mjs';
const exec=promisify(execFile);

test('Word and Excel uploads parse actual ZIP contents rather than binary text',async()=>{
  const {stdout}=await exec(process.env.STUDIO_PYTHON||'python',['-c',`import io,zipfile,base64,json
def pack(name,text):
 b=io.BytesIO()
 with zipfile.ZipFile(b,'w') as z:z.writestr(name,text)
 return base64.b64encode(b.getvalue()).decode()
print(json.dumps([pack('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word material</w:t></w:r></w:p></w:body></w:document>'),pack('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1" t="inlineStr"><is><t>title</t></is></c><c r="B1" t="inlineStr"><is><t>content</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>Excel material</t></is></c><c r="B2" t="inlineStr"><is><t>Original body</t></is></c></row></sheetData></worksheet>')]))`]);
  const [docx,xlsx]=JSON.parse(stdout);
  assert.equal((await readImportFile({name:'test.docx',base64:docx})).text,'Word material');
  const sheet=await readImportFile({name:'test.xlsx',base64:xlsx});assert.equal(sheet.rows[0].title,'Excel material');assert.equal(sheet.rows[0].content,'Original body');
  await assert.rejects(readImportFile({name:'test.docx',base64:Buffer.from('not a Word document').toString('base64')}),/file_parse_failed/);
});
