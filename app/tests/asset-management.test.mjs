import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {assetManageRoute} from '../src/asset-manage.mjs';import {assetCreateRoute} from '../src/asset-create.mjs';import {libraryDocument} from '../src/library-membership.mjs';import {promptLibraryRoute} from '../src/prompt-library.mjs';
test('knowledge editing, grouped trash, restore and reupload preserve one library and its content',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'spx-lifecycle-'));const db={documents:[],sources:[],knowledgeSets:[],templates:[],taskRuns:[],jobs:[]};let response;
 const ctx={req:{method:'POST'},res:{},url:new URL('http://test/api/studio/assets/create'),db,dataDir,saveDb:async()=>{},json:(_,status,data)=>{response={status,data};},body:async()=>({name:'Case library',kind:'markdown',fileName:'test.md',text:'Real content'})};
 try{await assetCreateRoute(ctx);const doc=db.documents[0],set=db.knowledgeSets[0];const manage=async(input)=>assetManageRoute({...ctx,url:new URL('http://test/api/studio/assets/manage'),body:async()=>({ids:[doc.id],...input})});
 await manage({action:'save',name:'Renamed library',content:'Edited real content'});assert.equal(doc.content,'Edited real content');assert.equal(set.name,'Renamed library');assert.equal(db.sources[0].content,doc.content);assert.equal(db.documentVersions.length,1);
 await manage({action:'delete'});assert.equal(libraryDocument(doc,db),false);assert.ok(set.deletedAt);await assetManageRoute({...ctx,req:{method:'GET'},url:new URL('http://test/api/studio/assets/trash')});assert.deepEqual(response.data[0].ids,[doc.id]);
 await manage({action:'restore'});assert.equal(libraryDocument(doc,db),true);assert.equal(set.deletedAt,undefined);
 await manage({action:'delete'});await assetCreateRoute(ctx);assert.equal(db.documents.length,1);assert.equal(doc.assetDeleted,false);assert.equal(doc.content,'Real content');assert.equal(set.deletedAt,undefined);
 }finally{await rm(dataDir,{recursive:true,force:true});}
});
test('prompt delete and restore preserve the saved prompt and old snapshots',async()=>{
 const db={templates:[{id:'p',name:'Prompt',prompt:'Keep exact instructions',active:true}]};const ctx={req:{method:'POST'},res:{},db,saveDb:async()=>{},json:(_,status)=>assert.equal(status,200)};
 await promptLibraryRoute({...ctx,url:new URL('http://test/api/studio/prompt-library/p/delete')});assert.equal(db.templates[0].active,false);assert.ok(db.templates[0].deletedAt);await promptLibraryRoute({...ctx,url:new URL('http://test/api/studio/prompt-library/p/restore')});assert.equal(db.templates[0].active,true);assert.equal(db.templates[0].prompt,'Keep exact instructions');
});

test('completed Feishu imports hide legacy preview duplicates without deleting historical references',()=>{
 const old={id:'legacy',source:'feishu-export',content:'Same original content'};
 const full={id:'full',source:'feishu-export',content:old.content,assetCreated:true,importSource:'feishu:base:table'};
 const db={documents:[old,full],knowledgeSets:[]};
 assert.equal(libraryDocument(old,db),false);assert.equal(libraryDocument(full,db),true);
 full.assetDeleted=true;assert.equal(libraryDocument(old,db),true);assert.equal(old.id,'legacy');
});

test('Feishu creation follows every page and preserves empty titles',async()=>{
 const {writeFile}=await import('node:fs/promises');const dataDir=await mkdtemp(join(tmpdir(),'spx-feishu-pages-'));const db={documents:[],sources:[],knowledgeSets:[]};let response;const offsets=[];
 const call=async(args)=>{const offset=Number(args[args.indexOf('--offset')+1]);offsets.push(offset);assert.equal(args[args.indexOf('--limit')+1],'500');const rows=offset===0?[{record_id:'one','标题':'','原文 / 文案':'First complete article'}]:[{record_id:'two','标题':'Second','原文 / 文案':'Second complete article'}];await writeFile(join(dataDir,args[args.indexOf('--output')+1]),rows.map(r=>JSON.stringify(r)).join('\n'));return offset===0?{has_more:true,next_offset:500}:{has_more:false};};
 try{await assetCreateRoute({req:{method:'POST'},res:{},url:new URL('http://test/api/studio/assets/create'),db,dataDir,body:async()=>({name:'Feishu',kind:'feishu',url:'https://test.feishu.cn/base/base123?table=table123'}),saveDb:async()=>{},json:(_,status,data)=>{response={status,data};}},call);assert.deepEqual(offsets,[0,500]);assert.equal(response.data.count,2);assert.equal(db.documents[0].name,'');assert.equal(response.status,201);}finally{await rm(dataDir,{recursive:true,force:true});}
});
