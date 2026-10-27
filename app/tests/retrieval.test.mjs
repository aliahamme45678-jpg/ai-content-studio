import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieveKnowledge, sourceSnapshot } from '../src/retrieval.mjs';
const db = {documents:[
  {id:'fact',name:'Agent开发',type:'事实库',content:'Agent开发通过测试验证功能。\n\n无关材料。',version:2},
  {id:'case',name:'Agent开发',type:'写作案例库',content:'案例只用于表达参考。'},
  {id:'empty',name:'Agent开发',type:'事实库'},
],sources:[{id:'news',title:'变更后的新闻'}]};
test('retrieval respects bindings, ignores empty documents and returns paragraph provenance',()=>{
  const result=retrieveKnowledge(db,'Agent开发',['事实库']);
  assert.ok(result.length); assert.ok(result.every(item=>item.documentId==='fact'));
  assert.equal(result[0].version,2); assert.equal(result[0].locator,'段落 1');
  assert.equal(retrieveKnowledge(db,'完全无匹配', ['事实库']).length,0);
  assert.equal(retrieveKnowledge(db,'Agent开发', []).length,0);
});
test('news snapshots remain independent of subsequent syncs',()=>{
  assert.equal(sourceSnapshot({sourceSnapshot:{id:'news',title:'原始新闻'}},db)[0].title,'原始新闻');
});
