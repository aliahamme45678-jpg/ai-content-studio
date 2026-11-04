import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {libraryDocument} from '../src/library-membership.mjs';
import {assetCreateRoute} from '../src/asset-create.mjs';
test('collection cache stays outside the library until explicitly curated',()=>{
 const doc={id:'cached',source:'douyin-material-pipeline',content:'正文'};
 assert.equal(libraryDocument(doc),false);assert.equal(libraryDocument({...doc,assetCreated:true}),true);
 assert.equal(libraryDocument(doc,{knowledgeSets:[{documentIds:['cached']}]}),true);
 assert.equal(libraryDocument({id:'imported',source:'feishu-export'}),true);
});
test('explicit Markdown and Feishu creation produce source-owned libraries; repeated creation is deduplicated',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'studio-curation-'));const db={documents:[],sources:[],knowledgeSets:[]};let response;
 const ctx={req:{method:'POST'},res:{},url:new URL('http://localhost/api/studio/assets/create'),db,dataDir,saveDb:async()=>{},json:(_,status,data)=>response={status,data},body:async()=>({name:'案例集',kind:'markdown',fileName:'案例.md',text:'完整文案'})};
 try{
 await assetCreateRoute(ctx);assert.equal(response.status,201);assert.equal(db.documents.length,1);assert.equal(libraryDocument(db.documents[0]),true);assert.equal(db.documents[0].assetLibraryId,db.knowledgeSets[0].id);
 await assetCreateRoute(ctx);assert.equal(response.data.added,0);assert.equal(db.documents.length,1);await assetCreateRoute({...ctx,body:async()=>({name:'案例集',kind:'markdown',fileName:'案例.md',text:'更新后的文案'})});assert.equal(response.data.updated,1);assert.equal(db.documents.length,1);assert.equal(db.documents[0].content,'更新后的文案');
 const reader=async(args,{cwd})=>{const file=args[args.indexOf('--output')+1];await writeFile(join(cwd,file),JSON.stringify({record_id:'r1','标题':'飞书文案','原文 / 文案':'已同步正文','来源链接':'https://www.douyin.com/video/123'})+'\n');return {has_more:false};};
 const feishu={...ctx,body:async()=>({name:'飞书内容库',kind:'feishu',url:'https://test.feishu.cn/base/baseABC?table=tblABC'})};
 await assetCreateRoute(feishu,reader);assert.equal(response.status,201);await assetCreateRoute(feishu,reader);assert.equal(response.data.added,0);assert.equal(db.knowledgeSets.length,2);const imported=db.documents.find(d=>d.source==='feishu-export');assert.equal(imported.importName,'飞书内容库');assert.ok(db.knowledgeSets.find(k=>k.id===imported.assetLibraryId).documentIds.includes(imported.id));
 }finally{await rm(dataDir,{recursive:true,force:true});}
});
