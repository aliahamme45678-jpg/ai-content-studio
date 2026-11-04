import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
import {collectionRequest} from '../src/collection-request.mjs';import {generatedTitle,parseGeneration} from '../src/generation-output.mjs';
const script=await readFile(new URL('../public/ui-components.js',import.meta.url),'utf8');
test('collection ranges apply to account analysis and distillation; zero maximum is retained',()=>{
 for(const purpose of ['account-analysis','writing-dna']){const result=collectionRequest({mode:'profile',urls:'https://www.douyin.com/user/test',purpose,collectAll:true,filters:{minDigg:0,maxDigg:0,minCollect:3,maxCollect:100}});assert.equal(result.filters.maxDigg,0);assert.equal(result.filters.maxCollect,100);assert.equal(result.collectAll,true);}
 for(const filters of [{maxDigg:-1},{minDigg:100,maxDigg:99},{maxComment:Infinity}])assert.throws(()=>collectionRequest({mode:'links',urls:'https://v.douyin.com/test/',filters}));
 assert.equal(collectionRequest({mode:'links',urls:'https://v.douyin.com/test/',filters:{maxDigg:''}}).filters.maxDigg,undefined);
});
test('similarity uses upstream Hermes algorithm and ignores punctuation without claiming semantic equivalence',()=>{
 const context=vm.createContext({});vm.runInContext(script,context);
 assert.equal(vm.runInContext("writerTextSimilarity('相同的完整文案内容','相同的完整文案内容')",context),100);
 assert.equal(vm.runInContext("writerTextSimilarity('测试，文案！','测试文案')",context),100);
 assert.equal(vm.runInContext("writerTextSimilarity('这是原始写作内容','完全不同的结果')",context),0);
 assert.equal(vm.runInContext("writerTextSimilarity('','新稿')",context),null);
});
test('model titles survive parsing; missing titles get a bounded fallback instead of an entire article',()=>{
 const body='口播内容保留真实事实，先讲核心问题，再展开具体的操作步骤。'.repeat(6);const result=parseGeneration(JSON.stringify({title:'店铺有流量却没订单',body}));assert.equal(generatedTitle(result),'店铺有流量却没订单');assert.ok(generatedTitle({body:'没有标点的长文'.repeat(40)}).length<=30);
});
