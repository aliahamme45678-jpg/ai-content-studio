import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('news, selected knowledge, imported material and rewriting share an auditable content lifecycle', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'studio-workflow-'));
  let latest;let latestBodyRequest;let newsTitle='公开资讯原始标题';let calls=0;
  const generated='这篇文案基于用户选择的产品资料，明确说明信息来源和适用条件。外部作者的经历只能用来研究表达结构，不能变成用户本人的经历。改写时保留原意，并让每个判断对应已有依据。'.repeat(2);
  const fake=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url.startsWith('/api/v1/items'))return res.end(JSON.stringify({items:[{id:'fixture',title:newsTitle,summary:'公开资料中的摘要证据',source:{name:'本地情报夹具'},links:{original:'https://example.org/news'},publishedAt:'2026-10-28'}]}));
    let text='';for await(const chunk of req)text+=chunk;latest=JSON.parse(text);calls++;if(String(latest.messages?.[0]?.content||'').includes('黄金三秒类型：'))latestBodyRequest=latest;
    if(latest.messages[0].content.includes('素材写法提炼器')){const docs=JSON.parse(latest.messages[1].content).documents;return res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({soul:{soul_summary:'先给结论，短句推进',writing_rules:{sentence_style:'短句'}},prompt:'学习所选资料表达，围绕 {{topic}} 写作，先给结论，使用具体动作展开。原稿改写保留事实，不使用同行经历代替本人经历。sentinel-distilled-style',rules:['不虚构'],patterns:[{name:'具体表达',explanation:'当前样本的表达规则',documentId:docs[0].id,quote:docs[0].content.slice(0,8)}]})}}]}));}
    if(latest.messages[0].content.includes('成稿校验员'))return res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({passed:true,hookType:'结果反差型',checks:{facts:true,type:true,continuity:true,style:true,originality:true},issues:[]})}}]}));
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({body:generated,corePoint:'资料分层',needsVerification:[]})}}]}));
  });
  await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));
  const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const server=spawn(process.execPath,['src/server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',STUDIO_DATA_DIR:dir,STUDIO_TOKEN:'',STUDIO_PASSWORD_GATE:'off',AIHOT_BASE_URL:'',AIHOT_DATABASE_URL:'none',MODEL_CALLS_ENABLED:'true',LLM_BASE_URL:`http://127.0.0.1:${fake.address().port}`,LLM_API_KEY:'local-fixture',LLM_MODEL:'fixture',HERMES_SERVICE_URL:'',HERMES_API_URL:''},stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`server exited ${code}`)));});
    const api=async(path,input,method=input===undefined?'GET':'POST')=>{const response=await fetch(`http://127.0.0.1:${port}/api/studio${path}`,{method,headers:{'content-type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)});return {status:response.status,data:await response.json()};};
    const importDoc=async(name,text,type='事实库')=>{const p=await api('/imports/preview',{name,text,type});assert.equal(p.status,201);const result=await api('/imports/commit',{previewId:p.data.id});assert.equal(result.status,201);return result.data;};
    const product=await importDoc('爆单符.md','选中资料 sentinel-product-815：产品只使用本地测试提供的资料。');
    await importDoc('其他项目.md','无关且不可跨项目使用 sentinel-forbidden-916。');
    const rule=await importDoc('个人规则.md','不要虚构本人体验 sentinel-rule-417。','规则与记忆库');
    const set=await api('/knowledge-sets',{name:'爆单符产品知识库',documentIds:[product.id,rule.id]});assert.equal(set.status,201);
    assert.equal((await api('/knowledge-sets',{name:'无效资料',documentIds:['not-found']})).status,400);
    const template=await api('/templates',{name:'产品事实模板',kind:'短帖',prompt:'主题={{topic}}，平台={{platform}}，请使用本次事实。',rules:['不得虚构个人经历'],bindings:['事实库'],audits:['dbs-ai-check']});
    const created=await api('/rewrite-jobs',{title:'店铺工具介绍',original:'原文案 sentinel-original-318：保留这一句的原意。',templateId:template.data.id,knowledgeSetIds:[set.data.id],auditSkills:['dbs-ai-check'],writingOrigin:{returnCollectionTaskId:'source-task',format:'视频口播',unexpected:'drop'}});
    assert.equal(created.status,201);const job=created.data;
    assert.deepEqual(job.writingOrigin,{returnCollectionTaskId:'source-task',format:'视频口播'});
    const savedOrigin=await api(`/writing/jobs/${job.id}`,{writingInstruction:'保留步骤'},'PATCH');
    assert.deepEqual(savedOrigin.data.writingOrigin,job.writingOrigin);
    const emptyTitle=await api('/rewrite-jobs',{title:'',original:'正文不应成为标题',templateId:template.data.id});assert.equal(emptyTitle.status,201);assert.equal(emptyTitle.data.title,'');
    await api(`/writing/jobs/${emptyTitle.data.id}`,{title:'临时标题'},'PATCH');
    await api(`/writing/jobs/${emptyTitle.data.id}`,{title:'',topic:'独立保存的选题'},'PATCH');
    const persistedBlankTitle=JSON.parse(await readFile(join(dir,'studio.json'),'utf8')).jobs.find(j=>j.id===emptyTitle.data.id);assert.equal(persistedBlankTitle.title,'');assert.equal(persistedBlankTitle.topic,'独立保存的选题');
    const retrieved=await api(`/retrieve?jobId=${job.id}`);
    assert.deepEqual(new Set(retrieved.data.documents.map(d=>d.documentId)),new Set([product.id,rule.id]));
    const result=await api(`/writing/jobs/${job.id}/generate`,{});assert.equal(result.status,201);
    const request=JSON.stringify(latest);assert.match(request,/sentinel-product-815/);assert.match(request,/sentinel-rule-417/);assert.match(request,/sentinel-original-318/);assert.doesNotMatch(request,/sentinel-forbidden-916/);assert.match(request,/主题=店铺工具介绍/);
    assert.equal(result.data.version.knowledgeSnapshot.length,2);
    assert.equal((await api(`/writing/jobs/${job.id}/generate`,{})).data.reused,true);assert.equal(calls,1);
    const editedInput=await api(`/writing/jobs/${job.id}`,{originalBody:'更新原稿 sentinel-updated-original-419',writingInstruction:'先讲步骤 sentinel-instruction-520',creationMode:'rewrite'},'PATCH');
    assert.equal(editedInput.data.originalBody,'更新原稿 sentinel-updated-original-419');
    assert.equal(editedInput.data.writingInstruction,'先讲步骤 sentinel-instruction-520');
    assert.equal((await api(`/writing/jobs/${job.id}/generate`,{})).status,201);
    assert.equal(calls,2);assert.match(JSON.stringify(latest),/sentinel-updated-original-419/);assert.match(JSON.stringify(latest),/sentinel-instruction-520/);assert.doesNotMatch(JSON.stringify(latest),/sentinel-original-318/);
    assert.equal((await api(`/jobs/${job.id}/status`,{status:'已定稿'},'PATCH')).status,409);
    assert.equal((await api('/publications',{jobId:job.id,url:'https://example.org/post'})).status,409);
    await api(`/writing/jobs/${job.id}`,{durationSeconds:null},'PATCH');
    await api('/audits',{jobId:job.id});
    const beforeNoop=(await api('/jobs')).data.find(j=>j.id===job.id);
    await api(`/writing/jobs/${job.id}`,{durationSeconds:'',body:beforeNoop.body,templateId:template.data.id},'PATCH');
    assert.equal((await api('/jobs')).data.find(j=>j.id===job.id).status,beforeNoop.status,'saving an unchanged blank duration preserves the audit');
    assert.equal((await api('/writing/finalize',{jobId:job.id})).status,200);
    // A clean body audit cannot be reused after its writing or evidence settings change.
    for(const change of [{title:'修改选题后必须复查'},{writingInstruction:'更换读者定位'},{originalBody:'换一份原稿'},{hook:'先说明结论'},{documentIds:[product.id],knowledgeSetIds:[]}]){
      await api(`/writing/jobs/${job.id}`,change,'PATCH');
      assert.equal((await api('/writing/finalize',{jobId:job.id})).status,409);
      await api('/audits',{jobId:job.id});assert.equal((await api('/writing/finalize',{jobId:job.id})).status,200);
    }
    await api(`/writing/jobs/${job.id}`,{auditEngine:'model'},'PATCH');await api('/audits',{jobId:job.id});
    assert.equal((await api('/writing/finalize',{jobId:job.id})).data.error,'selected_model_audit_required');
    await api(`/writing/jobs/${job.id}`,{auditEngine:'local'},'PATCH');await api('/audits',{jobId:job.id});await api('/writing/finalize',{jobId:job.id});
    const pub=await api('/publications',{jobId:job.id,url:'https://example.org/post',body:'伪造提交正文'});assert.equal(pub.status,201);assert.equal(pub.data.body,generated);
    assert.equal((await api('/publications',{jobId:job.id,url:'https://example.org/post'})).data.reused,true);
    assert.equal((await api(`/publications/${pub.data.id}/metrics`,{likes:-2})).status,400);
    assert.equal((await api(`/publications/${pub.data.id}/knowledge`,{text:'未经确认的机器推测'})).status,400);
    const learned=await api(`/publications/${pub.data.id}/knowledge`,{text:'经用户确认的有条件写作经验。',confirmed:true});assert.equal(learned.status,201);assert.equal(learned.data.sourceJobId,job.id);
    await api(`/writing/jobs/${job.id}`,{body:'重新编辑后的稿件'},'PATCH');assert.equal((await api('/writing/finalize',{jobId:job.id})).status,409);
    await api(`/writing/jobs/${job.id}`,{documentIds:[],knowledgeSetIds:[]},'PATCH');assert.equal((await api(`/retrieve?jobId=${job.id}`)).data.documents.length,0);
    await api(`/writing/jobs/${job.id}`,{documentIds:null,knowledgeSetIds:null},'PATCH');
    const overview=await api('/overview');assert.ok(!Object.hasOwn(overview.data.jobs.find(j=>j.id===job.id),'documentIds'));

    // Feishu mapping is supplied on confirmation, as the actual UI does.
    const fp=await api('/feishu/preview',{text:JSON.stringify([{标题:'同行案例',正文:'同行案例原文 sentinel-feishu。',作者:'外部作者'}]),mapping:{}});
    assert.equal((await api('/feishu/commit',{previewId:fp.data.id,mapping:{title:'标题',content:'正文',author:'作者'}})).status,201);
    const docs=(await api('/overview')).data.documents;const external=docs.find(d=>d.source==='feishu-export');assert.equal(external.author,'外部作者');
    const materialJob=await api('/materials/create-content',{materialIds:[external.id,product.id],templateId:template.data.id});assert.equal(materialJob.status,201);assert.equal(materialJob.data.sourceSnapshot.length,2);assert.equal(materialJob.data.body,'');
    const video=await api('/imports/douyin/preview',{rows:[{aweme_id:'video-1',title:'作品标题',author_name:'视频作者',publish_time:'2026-10-28',digg_count:12,collect_count:7,comment_count:4,content:'完整外部转写稿',play_count:null}]});assert.equal(video.status,201);
    const committed=await api('/imports/douyin/commit',{previewId:video.data.id});assert.equal(committed.status,201);
    const videoDoc=(await api('/douyin/workspace')).data.documents[0];assert.equal(videoDoc.author,'视频作者');assert.equal(videoDoc.collectCount,7);assert.equal(videoDoc.type,'写作案例库');assert.equal(videoDoc.externalId,'video-1');
    const dup=await api('/imports/douyin/preview',{rows:[{aweme_id:'video-1',title:'换标题',content:'同作品跨批次应去重'}]});const enriched=await api('/imports/douyin/commit',{previewId:dup.data.id});assert.equal(enriched.data.count,0);assert.equal(enriched.data.updated,1);const newVideoDoc=(await api('/douyin/workspace')).data.documents[0];assert.equal(newVideoDoc.id,videoDoc.id);assert.equal(newVideoDoc.version,2);
    await api('/integrations/aihot/config',{baseUrl:`http://127.0.0.1:${fake.address().port}`,syncMode:'all'});assert.equal((await api('/integrations/aihot/sync',{})).status,200);
    const source=(await api('/overview')).data.sources.find(s=>s.origin==='aihot-live');
    const direct=await api('/writing/jobs',{sourceId:source.id,templateId:template.data.id});assert.equal(direct.data.body,'');assert.equal(direct.data.sourceSnapshot[0].title,newsTitle);
    const topic=await api('/topics/derive',{sourceId:source.id});assert.ok(topic.data.angles.every(a=>a.title.includes(newsTitle)));assert.equal(topic.data.engine,'source-bound-suggestions');
    newsTitle='上游已改变的标题';await api('/integrations/aihot/sync',{});
    const selected=await api('/topics/select',{topicId:topic.data.id,angleId:topic.data.angles[0].id,templateId:template.data.id});assert.equal(selected.data.sourceSnapshot[0].title,'公开资讯原始标题');assert.equal(selected.data.body,'');
    const metricRefresh=await api('/imports/douyin/preview',{rows:[{aweme_id:'video-1',digg_count:99,play_count:456}]});
    assert.equal((await api('/imports/douyin/commit',{previewId:metricRefresh.data.id})).data.updated,1);
    const missingMetrics=await api('/imports/douyin/preview',{rows:[{aweme_id:'video-1',collect_count:20}]});await api('/imports/douyin/commit',{previewId:missingMetrics.data.id});
    const refreshed=(await api('/overview')).data.documents.find(d=>d.id===videoDoc.id);assert.equal(refreshed.diggCount,99);assert.equal(refreshed.collectCount,20);assert.equal(refreshed.playCount,456);assert.equal(refreshed.playCountKnown,true);assert.equal(refreshed.content,'同作品跨批次应去重');assert.equal(refreshed.name,'换标题');assert.notEqual(refreshed.transcriptState,'missing');
    const distilled=await api('/materials/distill',{documentIds:[external.id],requirements:'用短句解释步骤'});assert.equal(distilled.status,200);assert.equal(distilled.data.state,'succeeded');
    const callsBefore=calls;assert.equal((await api('/materials/distill',{documentIds:[external.id],requirements:'用短句解释步骤'})).data.id,distilled.data.id);assert.equal(calls,callsBefore);
    const saved=await api('/materials/distill/save',{runId:distilled.data.id,name:'提炼出的口播模板'});assert.equal(saved.status,201);
    const revised=await api('/templates',{id:saved.data.template.id,name:'修改过的真实模板',prompt:saved.data.template.prompt});
    assert.equal(revised.data.distillationRunId,saved.data.template.distillationRunId);assert.equal(revised.data.soulProfileId,saved.data.template.soulProfileId);assert.deepEqual(revised.data.documentIds,saved.data.template.documentIds);
    assert.equal((await api('/templates',{id:'missing-template',name:'不应创建'})).status,404);
    assert.equal((await api('/materials/distill/save',{runId:distilled.data.id})).data.template.id,saved.data.template.id);
    for(const rewrite of [false,true]){
      const styled=await api(rewrite?'/rewrite-jobs':'/writing/jobs',{title:'如何写工具说明',...(rewrite?{original:'原稿原意 sentinel-rewrite-facts'}:{}),templateId:revised.data.id});assert.equal(styled.status,201);
      assert.equal(styled.data.documentIds,undefined);
      assert.ok(styled.data.sourceIds.includes(external.id));assert.deepEqual(styled.data.materialIds,[]);
      assert.equal((await api(`/writing/jobs/${styled.data.id}/generate`,{})).status,201);
      assert.match(latest.messages[0].content,/sentinel-distilled-style/);assert.match(latest.messages[0].content,/先给结论，短句推进/);assert.match(latest.messages[1].content,/sentinel-feishu/);
      if(rewrite)assert.match(latest.messages[1].content,/sentinel-rewrite-facts/);
      const patch=await api(`/writing/jobs/${styled.data.id}`,{soulPersona:'鲁迅风格',soulProfileId:'',hookType:'结果反差型',copyStyle:'冷静拆解型',copyType:'实战型',targetWordCount:900},'PATCH');assert.equal(patch.status,200);
      assert.equal((await api(`/writing/jobs/${styled.data.id}/generate`,{})).status,201);assert.match(latestBodyRequest.messages[0].content,/# 鲁迅人格灵魂/);assert.doesNotMatch(latestBodyRequest.messages[0].content,/# 余华人格灵魂/);assert.match(latestBodyRequest.messages[0].content,/黄金三秒类型：结果反差型/);
      const engine=await api(`/writing/jobs/${styled.data.id}`,{writingEngine:'hermes',documentIds:[],knowledgeSetIds:[]},'PATCH');assert.equal(engine.data.writingEngine,'hermes');
      const emptyContext=await api(`/writing/jobs/${styled.data.id}/context`);assert.equal(emptyContext.data.knowledge.length,0);assert.equal(emptyContext.data.refs.length,0);
      assert.equal((await api(`/writing/jobs/${styled.data.id}`,{writingEngine:'fake'},'PATCH')).status,400);
    }
    const persisted=JSON.parse(await readFile(join(dir,'studio.json'),'utf8'));assert.ok(persisted.versions.some(v=>v.jobId===job.id&&v.templateSnapshot?.id===template.data.id));assert.ok(persisted.documents.some(d=>d.id===saved.data.guide.id&&d.evidence.length===1));
  }finally{
    server.kill();if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));
    await new Promise(resolve=>fake.close(resolve));await rm(dir,{recursive:true,force:true});
  }
});
