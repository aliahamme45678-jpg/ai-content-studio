import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('generation retries bad output once, reuses good cache and preserves draft on failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-generation-'));
  let calls = 0; let rejectOutput = false; let dropConnection = false; let releaseResponse; let responseStarted;
  let holdResponse = false;
  let latestRequest;
  const body = '本地测试的完整草稿只使用已给定的资料，不包含虚构的个人体验。这次验证关心的是正文保存、重试次数和缓存复用，而不是向远程模型提交私人内容。'.repeat(3);
  const fake = createServer(async (req, res) => {
    let requestText = ''; for await (const chunk of req) requestText += chunk;
    latestRequest = JSON.parse(requestText);
    calls += 1;
    if (holdResponse) { responseStarted?.(); await new Promise(resolve => { releaseResponse = resolve; }); }
    if (dropConnection) { req.socket.destroy(); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{message:{content: rejectOutput || calls === 1 ? '{"body":"..."}' : '示例 {"body":"..."}\n' + JSON.stringify({body,corePoint:'测试',needsVerification:[]}) + '\n解释'}}], usage: {total_tokens: 123} }));
  });
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['src/server.mjs'], {cwd:new URL('..', import.meta.url), env:{...process.env, PORT:String(port), HOST:'127.0.0.1', STUDIO_TOKEN:'', STUDIO_DATA_DIR:dir, MODEL_CALLS_ENABLED:'true', LLM_BASE_URL:`http://127.0.0.1:${fake.address().port}`, LLM_API_KEY:'local-fixture', LLM_MODEL:'fixture'}, stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', code => reject(new Error(`server exited ${code}`))); });
    const api = async (path, data) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {method:data?'POST':'GET', headers:{'content-type':'application/json'},body:data?JSON.stringify(data):undefined});
      return {status:response.status, data:await response.json()};
    };
    const created = await api('/api/studio/manual-ideas', {title:'本地生成回归',body:'原始正文保留'});
    const preview = await api('/api/studio/imports/preview', {name:'本地生成指南.md',type:'事实库',text:'本地生成回归需要保留原文依据。'});
    const imported = await api('/api/studio/imports/commit', {previewId:preview.data.id});
    const repeatedImport=await api('/api/studio/imports/commit',{previewId:preview.data.id});
    assert.equal(repeatedImport.data.id,imported.data.id);assert.equal(repeatedImport.data.reused,true);
    const duplicatePreview=await api('/api/studio/imports/preview',{name:'不同名称.md',type:'事实库',text:'本地生成回归需要保留原文依据。'});
    assert.equal((await api('/api/studio/imports/commit',{previewId:duplicatePreview.data.id})).status,409);
    const videoPreview=await api('/api/studio/imports/douyin/preview',{text:'{"title":"导入样例","transcript":"逐字稿内容","play_count":0}'});
    assert.equal(videoPreview.data.unknownPlayCount,1);
    const videoCommit=await api('/api/studio/imports/douyin/commit',{previewId:videoPreview.data.id});
    assert.equal(videoCommit.data.count,1);
    const repeatVideo=await api('/api/studio/imports/douyin/commit',{previewId:videoPreview.data.id});
    assert.equal(repeatVideo.data.reused,true);assert.equal(repeatVideo.data.count,1);
    const workspace=await api('/api/studio/douyin/workspace');
    assert.equal(workspace.data.documents.length,1);
    assert.equal(workspace.data.capabilities.skills,'planning_only');
    const materialJob=await api('/api/studio/douyin/create-content',{documentId:workspace.data.documents[0].id,templateId:'tpl-news'});
    assert.equal(materialJob.data.entry,'抖音素材库');assert.equal(materialJob.data.body,'');
    assert.equal((await api('/api/studio/douyin/plans',{format:'X 短帖',skills:['dbs-script-flow']})).status,400);
    assert.equal((await api('/api/studio/douyin/plans',{format:'视频口播',skills:['dbs-script-flow','dbs-ai-check']})).status,201);
    const plan=await api('/api/studio/douyin/plans',{format:'X 短帖',skills:['dbs-content-value','dbs-ai-check']});
    const linked=await api('/api/studio/douyin/create-content',{documentId:workspace.data.documents[0].id,templateId:'tpl-news',planId:plan.data.id});
    assert.equal(linked.data.pipelinePlanSnapshot.id,plan.data.id);
    assert.equal(linked.data.skillExecutionState,'尚未执行');
    assert.deepEqual(linked.data.pipelinePlanSnapshot.skills,['dbs-content-value','dbs-ai-check']);
    const path = `/api/studio/writing/jobs/${created.data.id}/generate`;
    const first = await api(path, {});
    assert.equal(first.status,201); assert.equal(first.data.version.body,body); assert.equal(calls,2);
    assert.match(latestRequest.messages[1].content,/本地生成回归需要保留原文依据/);
    assert.equal(first.data.version.knowledgeSnapshot[0].documentId,imported.data.id);
    const second = await api(path, {});
    assert.equal(second.data.reused,true); assert.equal(calls,2);
    rejectOutput = true;
    const another = await api('/api/studio/manual-ideas',{title:'失败保护',body:'不能覆盖的原稿'});
    const failed = await api(`/api/studio/writing/jobs/${another.data.id}/generate`,{});
    assert.equal(failed.status,502); assert.equal(calls,4);
    const db = JSON.parse(await readFile(join(dir,'studio.json'),'utf8'));
    assert.equal(db.jobs.find(job=>job.id===another.data.id).body,'不能覆盖的原稿');
    assert.equal(db.versions.filter(version=>version.jobId===another.data.id).length,0);
    assert.equal(db.taskRuns[0].state,'failed'); assert.equal(db.taskRuns[0].cost,null);
    assert.equal(db.taskRuns[0].responses.length,2);
    dropConnection = true;
    const uncertain = await api('/api/studio/manual-ideas',{title:'未知响应保护',body:'必须保留的原稿'});
    const uncertainPath = `/api/studio/writing/jobs/${uncertain.data.id}/generate`;
    const unknown = await api(uncertainPath,{});
    assert.equal(unknown.data.error,'generation_outcome_unknown');
    const blockedRetry = await api(uncertainPath,{});
    assert.equal(blockedRetry.status,409); assert.equal(calls,5);
    dropConnection = false; rejectOutput = false; holdResponse = true;
    const concurrent = await api('/api/studio/manual-ideas',{title:'并发保存保护',body:'原稿'});
    const started = new Promise(resolve=>{ responseStarted = resolve; });
    const generating = api(`/api/studio/writing/jobs/${concurrent.data.id}/generate`,{});
    await started;
    const createdDuringGeneration = await api('/api/studio/manual-ideas',{title:'生成期间创建的内容',body:'需要保留'});
    const cancelled = await fetch(`http://127.0.0.1:${port}/api/studio/jobs/${concurrent.data.id}/status`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status:'已取消'})});
    assert.equal(cancelled.status,200);
    releaseResponse();
    assert.equal((await generating).data.error,'job_cancelled');
    const concurrentDb = JSON.parse(await readFile(join(dir,'studio.json'),'utf8'));
    assert.ok(concurrentDb.jobs.find(job=>job.id===createdDuringGeneration.data.id));
    assert.equal(concurrentDb.jobs.find(job=>job.id===concurrent.data.id).body,'原稿');
    assert.equal(concurrentDb.taskRuns.find(run=>run.jobId===concurrent.data.id && run.taskKind==='generate').state,'cancelled');
    const draft=await api('/api/studio/manual-ideas',{title:'审核闭环',body:'保留前文。总而言之这是结论。保留后文。'});
    assert.equal((await api('/api/studio/writing/finalize',{jobId:draft.data.id})).status,409);
    const audit=await api('/api/studio/audits',{jobId:draft.data.id});
    assert.equal(audit.data.auditRun.engine,'local-rules');assert.equal(audit.data.issues.length,1);
    const issue=audit.data.issues[0];
    const edited=await fetch(`http://127.0.0.1:${port}/api/studio/audit-issues/${issue.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({action:'rewrite'})});
    assert.equal((await edited.json()).job.body,'保留前文。这是结论。保留后文。');
    assert.equal((await api('/api/studio/writing/finalize',{jobId:draft.data.id})).status,409);
    await api('/api/studio/audits',{jobId:draft.data.id});
    assert.equal((await api('/api/studio/writing/finalize',{jobId:draft.data.id})).status,200);
  } finally {
    if (child.exitCode === null) { child.kill(); await new Promise(resolve=>child.once('exit',resolve)); }
    await new Promise(resolve=>fake.close(resolve));
    await rm(dir,{recursive:true,force:true});
  }
});

test('restart marks interrupted requests unknown without resending', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-restart-'));
  const data = {sources:[],documents:[],templates:[],jobs:[],publications:[],taskRuns:[
    {id:'sent',taskKind:'generate',state:'running',awaitingResponse:true},
    {id:'unsent',taskKind:'generate',state:'running',awaitingResponse:false}
  ]};
  await writeFile(join(dir,'studio.json'),JSON.stringify(data),'utf8');
  const child = spawn(process.execPath,['src/server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',STUDIO_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  // Initialization is lazy, so use an explicit free port for the request.
  try {
    await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject)});
    child.kill(); await new Promise(resolve=>child.once('exit',resolve));
    const portServer=createServer(); await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));
    const port=portServer.address().port; await new Promise(resolve=>portServer.close(resolve));
    const server=spawn(process.execPath,['src/server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',STUDIO_TOKEN:'',STUDIO_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
    try {
      await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject)});
      const response=await fetch(`http://127.0.0.1:${port}/api/studio/overview`); assert.equal(response.status,200);
      const saved=JSON.parse(await readFile(join(dir,'studio.json'),'utf8'));
      assert.equal(saved.taskRuns.find(run=>run.id==='sent').state,'unknown');
      assert.equal(saved.taskRuns.find(run=>run.id==='unsent').state,'failed');
      assert.equal(saved.taskRuns.length,2);
    } finally {server.kill();await new Promise(resolve=>server.once('exit',resolve));}
  } finally {
    if(child.exitCode===null && !child.killed){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
    await rm(dir,{recursive:true,force:true});
  }
});
