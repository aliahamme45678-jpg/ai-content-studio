import test from 'node:test';import assert from 'node:assert/strict';
import {promptLibraryRoute} from '../src/prompt-library.mjs';import {createJob,draftContext} from '../src/workflow.mjs';
const db=()=>({templates:[],documents:[{id:'d',name:'Knowledge',content:'Knowledge fact and technique '.repeat(20),type:'写作案例库',assetCreated:true}],knowledgeSets:[],sources:[],jobs:[],auditIssues:[],taskRuns:[],integration:{auditConfig:{skills:['dbs-ai-check']}}});
async function call(database,path,input){let result,status;await promptLibraryRoute({req:{method:'POST'},res:{},url:new URL('http://local'+path),db:database,body:async()=>input,json:(_,s,r)=>{status=s;result=r;},saveDb:async()=>{}});return {status,result};}
test('prompt-only libraries compose writing and style prompts with knowledge selected only by writer',async()=>{
 const d=db();const writing=(await call(d,'/api/studio/prompt-library',{name:'Pzii',prompt:'PZII writing specification',category:'writing',documentIds:['d'],audits:['dbs-resonate']})).result;
 const style=(await call(d,'/api/studio/prompt-library',{name:'Lu Xun',prompt:'LUXUN style only',category:'style'})).result;
 assert.equal(writing.documentIds,undefined);assert.equal(writing.audits,undefined);
 const job=createJob(d,{templateId:writing.id,title:'New draft',stylePromptId:style.id,documentIds:['d'],knowledgeSetIds:[]});assert.deepEqual(job.auditSkills,['dbs-ai-check']);const context=draftContext(d,job);assert.equal(context.system.includes('PZII writing specification'),false,'选灵魂后不再叠加写作模板的完整写法');assert.ok(context.system.includes('LUXUN style only'));assert.ok(context.knowledge.some(k=>k.documentId==='d'));
 const next=(await call(d,'/api/studio/prompt-library',{id:style.id,name:'Changed',prompt:'NEW STYLE',category:'style'})).result;assert.equal(style.active,false);assert.ok(draftContext(d,job).system.includes('LUXUN style only'));assert.ok(!draftContext(d,job).system.includes('NEW STYLE'));
 const topic=(await call(d,'/api/studio/prompt-library',{name:'Topic',prompt:'TOPIC rules',category:'topic'})).result;assert.ok(draftContext(d,createJob(d,{templateId:topic.id,title:'',topic:'My subject',documentIds:[],knowledgeSetIds:[]})).system.includes('TOPIC rules'));
 assert.equal((await call(d,'/api/studio/prompt-library',{name:'Empty',prompt:'',category:'writing'})).status,400);assert.ok(next.id);
});
test('global review settings invalidate unfinished review state and reject unsupported skills',async()=>{
 const d=db();d.jobs=[{id:'j',status:'待人工确认',auditSkills:['dbs-resonate']}];d.auditIssues=[{jobId:'j',status:'待处理'}];assert.equal((await call(d,'/api/studio/audit-config',{skills:['fake']})).status,400);
 assert.equal((await call(d,'/api/studio/audit-config',{skills:['dbs-ai-check','dbs-content-risk-check']})).status,200);assert.deepEqual(d.jobs[0].auditSkills,['dbs-ai-check','dbs-content-risk-check']);assert.equal(d.jobs[0].status,'草稿');assert.equal(d.auditIssues[0].status,'待重新验证');
 d.taskRuns=[{state:'running',taskKind:'model-audit'}];assert.equal((await call(d,'/api/studio/audit-config',{skills:[]})).status,409);
});

test('写作模板可以绑定知识库（含飞书素材库），写作时按模板自动读取且编辑不丢绑定',async()=>{
 const d=db();
 d.documents.push({id:'doc-f',name:'飞书案例',content:'飞书案例：先给结果，再拆步骤，最后收束。'.repeat(30),type:'写作案例库',assetCreated:true,importSource:'feishu:base:tbl'});
 d.knowledgeSets=[{id:'set-feishu',name:'飞书内容库',sourceKind:'feishu',sourceKey:'feishu:base:tbl',documentIds:['doc-f']}];
 const created=(await call(d,'/api/studio/prompt-library',{name:'绑定飞书',prompt:'BIND writing specification',category:'writing',knowledgeSetIds:['set-feishu']})).result;
 assert.deepEqual(created.knowledgeSetIds,['set-feishu'],'模板保存时保留知识库绑定');
 const job=createJob(d,{templateId:created.id,title:'飞书案例'});
 const context=draftContext(d,job);
 assert.ok(context.knowledge.some(item=>item.documentId==='doc-f'),'没有手动选库时自动读模板绑定的飞书库');
 const edited=(await call(d,'/api/studio/prompt-library',{id:created.id,name:'绑定飞书',prompt:'BIND writing specification v2',category:'writing'})).result;
 assert.deepEqual(edited.knowledgeSetIds,['set-feishu'],'编辑生成新版本时不丢绑定');
 assert.equal((await call(d,'/api/studio/prompt-library',{name:'坏绑定',prompt:'X',category:'writing',knowledgeSetIds:['missing']})).status,400);
 assert.equal((await call(d,'/api/studio/prompt-library',{name:'坏类型',prompt:'X',category:'writing',knowledgeSetIds:'set-feishu'})).status,400);
});
