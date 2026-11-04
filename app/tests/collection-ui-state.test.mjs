import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {collectionRequest} from '../src/collection-request.mjs';

test('pasted Douyin share text becomes validated links without hiding other HTTP destinations',async()=>{
  const source=await readFile(new URL('../public/collection-workbench.js',import.meta.url),'utf8');const context=vm.createContext({});vm.runInContext(source,context);
  const urls=vm.runInContext("collectionPasteUrls('8.46 复制此链接，打开抖音 https://v.douyin.com/hMszxDKW2lU/ 直接观看视频！')",context);
  assert.deepEqual(collectionRequest({mode:'links',urls}).urls,['https://v.douyin.com/hMszxDKW2lU/']);
  assert.throws(()=>collectionRequest({mode:'links',urls:vm.runInContext("collectionPasteUrls('分享 https://v.douyin.com/abc/ https://evil.example/')",context)}),{statusCode:400});
});
test('collection stage counts distinguish confirmed Feishu writes from planned writes and reused transcripts',async()=>{
  const source=await readFile(new URL('../public/collection-workbench.js',import.meta.url),'utf8');const context=vm.createContext({});vm.runInContext(source,context);
  assert.match(vm.runInContext("collectionStageSummary({taskKind:'feishu-sync',summary:{create:20},recordIds:['confirmed-one']})",context),/已写入 1 条/);
  assert.match(vm.runInContext("collectionStageSummary({taskKind:'feishu-sync',summary:{create:20},recordIds:[]})",context),/已写入 0 条/);
  assert.match(vm.runInContext("collectionStageSummary({taskKind:'douyin-asr',summary:{succeeded:14,skipped:1,failed:0}})",context),/新转写 14 · 复用已有 1 · 失败 0/);
});
