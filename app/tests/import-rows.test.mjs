import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImportRows } from '../src/import-rows.mjs';
test('CSV preserves quoted commas, newlines and escaped quotes',()=>{
 const rows=parseImportRows({text:'\uFEFFtitle,transcript\r\n"工具,实践","第一行\n他说""你好"""\r\n'});
 assert.deepEqual(rows,[{title:'工具,实践',transcript:'第一行\n他说"你好"'}]);
});
test('JSONL and arrays normalize to records',()=>{
 assert.equal(parseImportRows({text:'{"title":"一"}\n{"title":"二"}'}).length,2);
 assert.equal(parseImportRows({rows:[{title:'一'}]}).length,1);
});
test('invalid and oversized imports fail instead of silently dropping rows',()=>{
 for(const input of [{text:''},{text:'a,a\n1,2'},{text:'a,b\n1'},{text:'a\n"unfinished'},{text:'{"a":'},{rows:[]},{rows:[null]},{rows:Array(1001).fill({title:'x'})}]) assert.throws(()=>parseImportRows(input),{statusCode:400});
});
