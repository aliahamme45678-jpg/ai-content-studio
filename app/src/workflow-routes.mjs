import { createJob, writingConfig, documentSource, deriveAngles, knowledgeRoles, uid, hash, jobKnowledge, draftContext } from './workflow.mjs';
import { runReceipt } from './task-state.mjs';
import {materialDistillRoutes} from './material-distill.mjs';
import {parseGeneration} from './generation-output.mjs';
import {invalidateAudit} from './audit.mjs';
import {resumeFinalRepair} from './hook-writing.mjs';

// Shared routes for all source types. Returning false lets the existing router continue.
export async function workflowRoutes(ctx) {
  if(await materialDistillRoutes(ctx))return true;
  const { req, res, url, db, json, body, saveDb } = ctx;
  const path = url.pathname;
  const resumeRepair=path.match(/^\/api\/studio\/writing\/jobs\/([^/]+)\/resume-final-repair$/);
  if(req.method==='POST'&&resumeRepair){
    const job=db.jobs.find(j=>j.id===resumeRepair[1]);
    if(!job){json(res,404,{error:'job_not_found'});return true;}
    if(process.env.MODEL_CALLS_ENABLED!=='true'){json(res,409,{error:'model_calls_disabled'});return true;}
    const run=db.taskRuns.find(r=>r.jobId===job.id&&r.taskKind==='generate'&&['failed'].includes(r.state)&&r.hookPlan&&r.generatedBody);
    if(!run){const unknownRun=db.taskRuns.find(r=>r.jobId===job.id&&r.taskKind==='generate'&&r.state==='unknown'&&r.hookPlan&&r.generatedBody);json(res,409,unknownRun?{error:'generation_outcome_unknown',runId:unknownRun.id}:{error:'nothing_to_resume'});return true;}
    run.state='running';run.awaitingResponse=false;run.error=null;run.resumedAt=new Date().toISOString();delete run.finishedAt;await saveDb(db);
    try{
      const result=await resumeFinalRepair({db,job,run,saveDb});
      const context=draftContext(db,job);
      const version={hookSources:run.hookSources,hookPlan:run.hookPlan,hookValidation:run.hookValidation,id:uid('ver'),jobId:job.id,body:result.body,corePoint:result.corePoint||'',needsVerification:result.needsVerification||[],knowledgeSnapshot:context.knowledge,sourceSnapshot:context.refs,templateSnapshot:structuredClone(context.template),parentVersionId:db.versions.find(v=>v.jobId===job.id)?.id||null,reason:'黄金三秒校验修复续跑',inputHash:run.inputHash,model:run.model,usage:run.usage||null,rawResponse:[...(run.responses||[])].reverse().find(r=>r.phase==='repairing-final-validation')?.raw||null,createdAt:new Date().toISOString()};
      db.versions.unshift(version);job.body=version.body;job.status='待审核';job.issues=0;job.updatedAt='刚刚';job.hookPlanSnapshot=structuredClone(run.hookPlan);invalidateAudit(db,job.id);
      run.state='succeeded';run.finishedAt=new Date().toISOString();await saveDb(db);
      json(res,201,{job,version,resumed:true});return true;
    }catch(error){
      run.state=run.awaitingResponse?'unknown':'failed';run.finishedAt=new Date().toISOString();run.error=error instanceof Error?error.message:String(error);await saveDb(db);
      json(res,run.awaitingResponse||/^model_http_/.test(run.error)?502:422,{error:run.state==='unknown'?'generation_outcome_unknown':'generation_failed',detail:run.error,runId:run.id});return true;
    }
  }
  const recoverDraft=path.match(/^\/api\/studio\/writing\/jobs\/([^/]+)\/recover-output$/);
  if(req.method==='POST'&&recoverDraft){const job=db.jobs.find(j=>j.id===recoverDraft[1]);if(!job){json(res,404,{error:'job_not_found'});return true;}const run=db.taskRuns.find(r=>r.jobId===job.id&&['generate','hermes-generate','hermes-section','audit-revision'].includes(r.taskKind)&&['failed','succeeded','conflict'].includes(r.state)&&(r.responses?.length||r.generatedBody));if(!run){json(res,409,{error:'saved_model_response_required'});return true;}let parsed;if(run.generatedBody){parsed={body:run.generatedBody};}else{try{parsed=parseGeneration(run.responses.at(-1).raw);}catch(error){json(res,422,{error:'saved_response_not_recoverable',detail:error.message,runId:run.id});return true;}}if(job.body===parsed.body){json(res,200,{job,reused:true});return true;}const previous=db.versions.find(v=>v.jobId===job.id);if(job.body!==previous?.body){json(res,409,{error:'save_current_edits_before_recovery'});return true;}const version={...previous,...parsed,id:uid('ver'),jobId:job.id,reason:'恢复模型已返回的最终正文',parentVersionId:previous?.id||null,recoveredFromRunId:run.id,createdAt:new Date().toISOString()};db.versions.unshift(version);invalidateAudit(db,job.id);job.body=parsed.body;job.status='待审核';run.previousError=run.error;delete run.error;run.state='succeeded';run.recoveredFromSavedResponse=true;await saveDb(db);json(res,200,{job,version});return true;}
  const contextMatch=path.match(/^\/api\/studio\/writing\/jobs\/([^/]+)\/context$/);
  if(req.method==='GET'&&contextMatch){const job=db.jobs.find(j=>j.id===contextMatch[1]);if(!job){json(res,404,{error:'job_not_found'});return true;}const {draftContext}=await import('./workflow.mjs');const {dna,body,hook,craft,...context}=draftContext(db,job);json(res,200,{...context,route:context.route,hookRetrieval:{hit:hook.hit,mode:hook.mode,count:hook.items.length,reason:hook.reason||null},craftRetrieval:{count:craft.items.length,reason:craft.reason||null},knowledgeScope:{configured:body.scope.configured,reason:body.reason||null,documents:body.scope.documents.size},writingOrigin:job.writingOrigin||{}});return true;}
  const receipt=path.match(/^\/api\/studio\/task-runs\/([^/]+)\/receipt$/);
  if(req.method==='GET'&&receipt){const run=db.taskRuns.find(r=>r.id===receipt[1]);json(res,run?200:404,run?runReceipt(run):{error:'run_not_found'});return true;}
  const resolveRun=path.match(/^\/api\/studio\/task-runs\/([^/]+)\/resolve-unknown$/);
  if(req.method==='POST'&&resolveRun){
    const run=db.taskRuns.find(r=>r.id===resolveRun[1]);
    if(!run){json(res,404,{error:'run_not_found'});return true;}
    const input=await body(req);
    if(!(run.state==='unknown'||run.state==='partial'&&run.taskKind==='douyin-asr'&&run.summary?.unknown>0)||input.confirmedReviewed!==true){json(res,409,{error:'unknown_run_review_confirmation_required'});return true;}
    run.previousOutcome='unknown';run.state='failed';run.resolvedAt=new Date().toISOString();run.resolution='用户核对后明确允许再次提交，原始响应与费用未知记录保留';
    if(run.taskKind==='douyin-asr'){
      const parent=db.taskRuns.find(r=>r.id===run.jobId);
      for(const row of parent?.rows||[])if(row.transcriptState==='unknown')row.transcriptState='retry_authorized';
    }
    await saveDb(db);json(res,200,run);return true;
  }
  if (req.method === 'GET' && path === '/api/studio/knowledge-sets') {
    json(res, 200, db.knowledgeSets); return true;
  }
  if (req.method === 'POST' && path === '/api/studio/knowledge-sets') {
    const input = await body(req); const name = String(input.name || '').trim();
    if (!name || name.length > 100) { json(res, 400, { error: 'knowledge_set_name_required' }); return true; }
    const config = writingConfig({ documentIds: input.documentIds || [] }, db);
    const previous = input.id ? db.knowledgeSets.find(set => set.id === input.id) : null;
    if (input.id && !previous) { json(res, 404, { error: 'knowledge_set_not_found' }); return true; }
    if (db.knowledgeSets.some(set => set.name === name && set.id !== input.id)) { json(res, 409, { error: 'knowledge_set_name_exists' }); return true; }
    const next = { id: previous?.id || uid('knowledge'), name, documentIds: config.documentIds,
      version: (previous?.version || 0) + 1, updatedAt: new Date().toISOString() };
    if (previous) Object.assign(previous, next); else db.knowledgeSets.unshift(next);
    await saveDb(db); json(res, previous ? 200 : 201, next); return true;
  }
  if (req.method === 'POST' && ['/api/studio/materials/create-content', '/api/studio/writing/jobs', '/api/studio/manual-ideas', '/api/studio/rewrite-jobs'].includes(path)) {
    const input = await body(req);
    const entry = path.endsWith('rewrite-jobs') ? '参考改写' : path.includes('/materials/') ? '素材库' : input.sourceId || input.sourceIds?.length ? 'AIHOT 新闻' : '手动想法';
    if (entry === '参考改写' && !String(input.original || '').trim()) { json(res, 400, { error: 'original_required' }); return true; }
    if (entry === '素材库' && !input.materialIds?.length) { json(res, 400, { error: 'material_required' }); return true; }
    const job = createJob(db, { ...input, body: entry === '参考改写' ? input.original : input.body }, entry);
    if (entry === '参考改写') { job.originalBody = String(input.original); job.rewriteMode = input.mode || '轻改'; }
    db.jobs.unshift(job);
    if (job.body) db.versions.unshift({ id: uid('ver'), jobId: job.id, body: job.body, reason: entry === '参考改写' ? '导入原稿' : '用户原稿', createdAt: new Date().toISOString() });
    await saveDb(db); json(res, 201, job); return true;
  }
  if (req.method === 'POST' && path === '/api/studio/topics/derive') {
    const input = await body(req);
    const sources = input.sourceId ? db.sources.filter(s => s.id === input.sourceId) : [];
    if (input.sourceId && !sources.length) { json(res, 404, { error: 'source_not_found' }); return true; }
    const docs = (input.materialIds || []).map(id => db.documents.find(doc => doc.id === id));
    if (docs.some(doc => !doc)) { json(res, 404, { error: 'document_not_found' }); return true; }
    const refs = [...sources.map(s => structuredClone(s)), ...docs.map(documentSource)];
    const title = String(input.title || refs[0]?.title || '').trim();
    if (!title) { json(res, 400, { error: 'title_required' }); return true; }
    const key = hash(JSON.stringify({ title, refs }));
    const existing = db.topics.find(topic => topic.inputHash === key && topic.state !== '已归档');
    if (existing) { json(res, 200, existing); return true; }
    const topic = { id: uid('topic'), inputHash: key, sourceId: sources[0]?.id || null, materialIds: docs.map(d => d.id),
      sourceTitle: title, sourceSnapshot: refs, state: '待确定角度', engine: 'source-bound-suggestions',
      detail: '基于当前材料提出的编辑角度，尚未调用模型或核实新增事实。', createdAt: new Date().toISOString(),
      angles: deriveAngles(title, refs.map(ref => ref.summary || '').join('\n').slice(0, 800)) };
    db.topics.unshift(topic); await saveDb(db); json(res, 201, topic); return true;
  }
  if (req.method === 'POST' && path === '/api/studio/topics/select') {
    const input = await body(req); const topic = db.topics.find(t => t.id === input.topicId);
    const angle = topic?.angles.find(a => a.id === input.angleId);
    if (!topic || !angle) { json(res, 404, { error: !topic ? 'topic_not_found' : 'angle_not_found' }); return true; }
    const job = createJob(db, { ...input, title: angle.title }, '衍生选题');
    job.sourceSnapshot = structuredClone(topic.sourceSnapshot || db.sources.filter(s => s.id === topic.sourceId));
    job.sourceIds = job.sourceSnapshot.map(s => s.id); job.topicId = topic.id; job.angleId = angle.id; job.angle = structuredClone(angle);
    db.jobs.unshift(job); topic.state = '写作中'; topic.jobIds = [...(topic.jobIds || []), job.id];
    await saveDb(db); json(res, 201, job); return true;
  }
  if (req.method === 'GET' && path === '/api/studio/retrieve') {
    const job = db.jobs.find(j => j.id === url.searchParams.get('jobId'));
    if (!job) { json(res, 404, { error: 'job_not_found' }); return true; }
    const documents = jobKnowledge(db, job);
    json(res, 200, { documents, warning: documents.length ? null : '所选知识库没有可用片段；请确认正文和绑定范围。' }); return true;
  }
  const promotion = path.match(/^\/api\/studio\/publications\/([^/]+)\/knowledge$/);
  if (req.method === 'POST' && promotion) {
    const publication = db.publications.find(p => p.id === promotion[1]);
    if (!publication) { json(res, 404, { error: 'publication_not_found' }); return true; }
    const input = await body(req);
    if (input.confirmed !== true || !String(input.text || '').trim()) { json(res, 400, { error: 'confirmed_knowledge_text_required' }); return true; }
    const type = input.type || '蒸馏方法库';
    if (!knowledgeRoles.includes(type)) { json(res, 400, { error: 'invalid_knowledge_type' }); return true; }
    const content = String(input.text).trim(); const fingerprint = hash(`${publication.id}:${type}:${content}`);
    const existing = db.documents.find(doc => doc.hash === fingerprint);
    if (existing) { json(res, 200, { ...existing, reused: true }); return true; }
    const doc = { id: uid('doc'), name: input.name || `${publication.title} · 已确认经验`, type, content,
      hash: fingerprint, source: '用户确认复盘', sourceJobId: publication.jobId, sourcePublicationId: publication.id,
      sourceVersionId: publication.versionId || null, url: publication.url, version: 1,
      chunks: content.split(/\n\s*\n/).length, tag: '用户确认', confirmedAt: new Date().toISOString(),
      factRole: '用户确认的经验·仅限所述条件', updatedAt: '刚刚' };
    db.documents.unshift(doc); await saveDb(db); json(res, 201, doc); return true;
  }
  return false;
}
