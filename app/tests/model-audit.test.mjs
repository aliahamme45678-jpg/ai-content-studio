import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelAudit, modelAuditRoute } from '../src/model-audit.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

test('model advice must quote actual text and can never replace an invented span',()=>{
  assert.throws(()=>parseModelAudit('{"issues":[{"skill":"dbs-ai-check","quote":"不存在的原句","explanation":"x","suggestion":"y"}]}','真正原稿',['dbs-ai-check']),/audit_quote_not/);
  assert.throws(()=>parseModelAudit('{"issues":[{"skill":"other","quote":"原稿","explanation":"x","suggestion":"y"}]}','真正原稿',['dbs-ai-check']),/invalid_audit/);
});

test('replacement is required and must differ from quote; empty string means delete',()=>{
  assert.throws(()=>parseModelAudit('{"issues":[{"skill":"dbs-ai-check","quote":"自己去工商局","explanation":"表述不完整。","suggestion":"补明适用主体。","replacement":"自己去工商局"}]}','自己去工商局办个个体户。',['dbs-ai-check']),/audit_replacement_identical_to_quote/);
  assert.throws(()=>parseModelAudit('{"issues":[{"skill":"dbs-ai-check","quote":"自己去工商局","explanation":"x","suggestion":"y"}]}','自己去工商局办个个体户。',['dbs-ai-check']),/invalid_audit_replacement/);
  const real=parseModelAudit('{"issues":[{"skill":"dbs-ai-check","quote":"自己去工商局","explanation":"表述不完整。","suggestion":"补明适用主体。","replacement":"到当地工商局办个个体户"}]}','自己去工商局办个个体户。',['dbs-ai-check']).issues[0];
  assert.equal(real.replacement,'到当地工商局办个个体户');
  const deletion=parseModelAudit('{"issues":[{"skill":"dbs-ai-check","quote":"在当今","explanation":"套话。","suggestion":"删除。","replacement":""}]}','在当今，保留后文。',['dbs-ai-check']).issues[0];
  assert.equal(deletion.replacement,'');
});

test('Skill-guided model audit stores real advice, keeps body intact, caches reports and blocks unknown retries',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'studio-audit-'));
  await mkdir(join(dir,'dbs-ai-check'));await writeFile(join(dir,'dbs-ai-check','SKILL.md'),'本地测试方法：只诊断不改稿。');
  let calls=0;let drop=false;let request;
  const fake=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;request=JSON.parse(text);calls++;if(drop){req.socket.destroy();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({summary:'删除套话即可。',issues:[{skill:'dbs-ai-check',severity:'低',quote:'在当今',explanation:'开头过于泛化。',suggestion:'直接进入具体主题。',replacement:''}]})}}]}));});
  await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));
  const saved={...process.env};
  Object.assign(process.env,{MODEL_CALLS_ENABLED:'true',LLM_BASE_URL:`http://127.0.0.1:${fake.address().port}`,LLM_API_KEY:'fixture',LLM_MODEL:'fixture',STUDIO_SKILL_ROOT:dir});
  const job={id:'j',title:'明确主题',body:'保留前文。在当今，保留后文。',format:'短帖',status:'草稿',templateSnapshot:{audits:['dbs-ai-check'],bindings:[]}};
  const db={jobs:[job],documents:[],templates:[],sources:[],taskRuns:[],auditRuns:[],auditIssues:[]};
  let response;
  const execute=()=>modelAuditRoute({req:{method:'POST'},res:{},url:new URL('http://localhost/api/studio/audits/model'),db,json:(_,status,data)=>{response={status,data};},body:async()=>({jobId:'j'}),saveDb:async()=>{}});
  try{
    await execute();assert.equal(response.status,200);assert.equal(response.data.auditRun.engine,'skill-guided-model');assert.equal(job.body,'保留前文。在当今，保留后文。');
    assert.match(request.messages[1].content,/本地测试方法/);assert.equal(response.data.issues[0].location.start,5);assert.equal(response.data.issues[0].replacement,'');
    await execute();assert.equal(response.data.reused,true);assert.equal(calls,1);
    job.body+='修改';
    const originalFetch=globalThis.fetch;
    globalThis.fetch=async()=>new Response('<!DOCTYPE html><title>Bad Gateway</title>',{status:502});
    try{await execute();assert.equal(response.data.error,'generation_outcome_unknown');assert.equal(db.taskRuns[0].httpFailure.status,502);assert.equal(db.taskRuns[0].error,'model_http_502');}finally{globalThis.fetch=originalFetch;}
    job.body+='连接前失败';globalThis.fetch=async()=>{throw Object.assign(new Error('fetch failed'),{cause:{code:'UND_ERR_CONNECT_TIMEOUT',message:'connection timed out'}});};
    try{await execute();assert.equal(db.taskRuns[0].state,'failed');assert.equal(db.taskRuns[0].errorCode,'UND_ERR_CONNECT_TIMEOUT');assert.equal(db.taskRuns[0].connectionFailure.code,'UND_ERR_CONNECT_TIMEOUT');}finally{globalThis.fetch=originalFetch;}
    job.body+='再次编辑';drop=true;await execute();assert.equal(response.data.error,'generation_outcome_unknown');assert.equal(calls,2);
    await execute();assert.equal(response.status,409);assert.equal(calls,2);
  }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);await new Promise(resolve=>fake.close(resolve));await rm(dir,{recursive:true,force:true});}
});
