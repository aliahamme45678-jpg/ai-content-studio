import { test } from 'node:test';
test('single-record save sends only the selected video and reads the current schema without creating fields',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'spx-one-feishu-'));let payload,schemas=0;
 const target={baseToken:'base',tableId:'tbl1',url:'https://example.feishu.cn/base/base',fields:[]};
 const rows=[{aweme_id:'1',title:'第一条',url:'https://www.douyin.com/video/1',content:'第一条正文'},{aweme_id:'2',title:'第二条',url:'https://www.douyin.com/video/2',content:'第二条正文'}];const db={integration:{feishu:target},taskRuns:[{id:'t',taskKind:'douyin-collect',state:'succeeded',rows}]};
 try{await feishuSyncRoute({req:{method:'POST'},res:{},url:new URL('http://local/api/studio/douyin/tasks/t/feishu'),db,dataDir,body:async()=>({confirmed:true,videoIds:['2']}),saveDb:async()=>{},json:(_,status,r)=>{assert.equal(status,200);assert.equal(r.summary.total,1);}},async args=>{if(args.includes('+table-list'))return {tables:[{id:'tblTopics',name:'选题列表'}]};if(args.includes('+field-list')){schemas++;assert.ok(args.includes('tblTopics'));return {fields:[{name:'原视频标题'},{name:'视频文案'},{name:'来源链接'}]};}if(args.includes('+record-list')){await writeFile(join(dataDir,args[args.indexOf('--output')+1]),'');return {has_more:false};}assert.ok(args.includes('+record-batch-create'));payload=JSON.parse(args[args.indexOf('--json')+1]);return {record_id_list:['one']};});assert.equal(schemas,1);assert.equal(payload.create_records.length,1);assert.equal(payload.create_records[0]['原视频标题'],'第二条');assert.equal(rows[0].content,'第一条正文');}finally{await rm(dataDir,{recursive:true,force:true});}
});
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { feishuSyncRoute, sourceKey, toFeishuRecord } from '../src/feishu-sync.mjs';

test('Feishu mapping keeps source text and metrics without inventing analysis',()=>{
  assert.equal(sourceKey('https://www.douyin.com/video/123?x=1'),sourceKey('https://www.douyin.com/video/123?x=2'));
  assert.equal(sourceKey('[原视频](https://www.iesdouyin.com/share/video/123/?tracking=old)'),sourceKey('https://www.douyin.com/video/123'));
  assert.notEqual(sourceKey('https://example.org/video/123'),sourceKey('https://www.douyin.com/video/123'));
  const record=toFeishuRecord({title:'标题',url:'https://www.douyin.com/video/123',transcript:'实际转写',author:'作者',diggCount:4});
  assert.equal(record['原文 / 文案'],'实际转写');assert.equal(record['点赞数'],4);assert.equal(record['字数'],4);assert.ok(!Object.hasOwn(record,'核心观点'));
});

test('Feishu sync previews, deduplicates known sources, requires confirmation and blocks unknown retries',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'studio-feishu-'));
  const target={baseToken:'base123',tableId:'tbl123',tableName:'内容蒸馏',url:'https://example.feishu.cn/base/base123',fields:[{name:'标题'},{name:'原文 / 文案'},{name:'来源链接'},{name:'平台',options:['抖音']},{name:'作者'},{name:'字数'}]};
  const rows=[{title:'已有',url:'https://www.douyin.com/video/123',content:'旧稿'},{title:'新稿',url:'https://www.douyin.com/video/456',content:'真实新转写'},{title:'没文字',url:'https://www.douyin.com/video/789'}];
  const db={integration:{feishu:target},taskRuns:[{id:'task1',taskKind:'douyin-collect',state:'succeeded',rows}]};
  let writes=0,unknown=false,last;const call=async(args)=>{
    if(args.includes('+record-list')){await writeFile(join(dataDir,args[args.indexOf('--output')+1]),JSON.stringify({record_id:'recOld','来源链接':'https://www.douyin.com/video/123?old=1'})+'\n');return {has_more:false};}
    writes++;last=JSON.parse(args[args.indexOf('--json')+1]);if(unknown)throw Object.assign(new Error('timeout'),{unknown:true});return {record_id_list:['recNew']};
  };
  let response;const request=async(method,suffix,input={})=>{await feishuSyncRoute({req:{method},res:{},url:new URL(`http://local/api/studio/douyin/tasks/task1/${suffix}`),db,dataDir,json:(_r,status,data)=>response={status,data},body:async()=>input,saveDb:async()=>{}},call);return response;};
  try{
    const preview=await request('GET','feishu-preview');assert.equal(preview.data.create,1);assert.equal(preview.data.skipExisting,1);assert.equal(preview.data.skipWithoutText,1);assert.equal(writes,0);
    await assert.rejects(request('POST','feishu',{}),/confirm_feishu_sync_first/);assert.equal(writes,0);
    const result=await request('POST','feishu',{confirmed:true,inputHash:preview.data.inputHash});assert.equal(result.data.state,'succeeded');assert.equal(writes,1);assert.equal(last.create_records[0]['原文 / 文案'],'真实新转写');
    assert.equal((await request('POST','feishu',{confirmed:true})).data.reused,true);assert.equal(writes,1);
    rows[1].content='修改后新稿';unknown=true;const failed=await request('POST','feishu',{confirmed:true});assert.equal(failed.data.error,'feishu_write_outcome_unknown');assert.equal(db.taskRuns[0].state,'unknown');
    await assert.rejects(request('POST','feishu',{confirmed:true}),/feishu_previous_write_needs_review/);assert.equal(writes,2);
  }finally{await rm(dataDir,{recursive:true,force:true});}
});
