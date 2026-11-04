import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const script=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const context=vm.createContext({sessionStorage:{getItem:()=>null}});
vm.runInContext(script.slice(0,script.lastIndexOf('load().catch')),context);
const sources=[
  {id:'news',origin:'aihot-live',title:'AI news',source:'Official',category:'Tech',selected:false},
  {id:'selected',origin:'aihot-live',title:'Selected news',source:'Official',category:'Tech',selected:true,status:'已收藏'},
  {id:'material',origin:'douyin-import',title:'My script',source:'Douyin',selected:true,status:'已收藏'},
  {id:'feishu',origin:'feishu-import',title:'My script',source:'Feishu',selected:true,status:'已收藏'},
  {id:'draft',title:'My script',source:'Manual'},
  {id:'demo',origin:'aihot-live',title:'Demo',demo:true}
];
context.sources=sources;
const ids=filters=>Array.from(vm.runInContext(`intelligenceItems(sources,${JSON.stringify(filters||{})}).map(item=>item.id)`,context));

test('intelligence only includes live news and preserves shared material sources',()=>{
  const before=JSON.stringify(sources);
  assert.deepEqual(ids(),['news','selected']);
  assert.deepEqual(ids({tab:'favorites'}),['selected']);
  assert.deepEqual(ids({tab:'selected'}),['selected']);
  assert.equal(JSON.stringify(sources),before);
});

test('search and source/category filters cannot bring writing materials into intelligence',()=>{
  assert.deepEqual(ids({query:'My script'}),[]);
  assert.deepEqual(ids({source:'Douyin'}),[]);
  assert.deepEqual(ids({query:' selected ',source:'Official',category:'Tech',tab:'selected'}),['selected']);
  assert.deepEqual(ids({query:'AI news',tab:'favorites'}),[]);
});

test('initial rendering, tabs, search, and sidebar share the intelligence selector',async()=>{
  assert.match(script,/function intel\(\) \{\s+const items = intelligenceItems\(\)/);
  const workflow=await readFile(new URL('../public/workflow.js',import.meta.url),'utf8');
  assert.doesNotMatch(workflow,/intel-count/);
  assert.match(script,/applyIntel.onclick = refreshIntelligence/);
  assert.match(script,/setAttribute\('aria-selected',String\(tab===element\)\)/);
});
