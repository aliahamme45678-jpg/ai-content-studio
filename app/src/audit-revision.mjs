import {auditEditGroups,applyAuditEdits,parseAuditEdits} from './audit-edits.mjs';
import {modelFetch as fetch} from './model-transport.mjs';
import {modelEnv} from './model-profiles.mjs';
import {draftContext,auditConfigHash,hash,uid} from './workflow.mjs';
import {bodyHash,invalidateAudit} from './audit.mjs';
import {parseGeneration,validateGeneration} from './generation-output.mjs';

const fail=(message,statusCode=409)=>{throw Object.assign(new Error(message),{statusCode});};
const contextHash=context=>hash(JSON.stringify({system:context.system,user:context.user}));

export async function auditRevisionRoute({req,res,url,db,json,body,saveDb,fetcher=fetch}){
  const match=url.pathname.match(/^\/api\/studio\/writing\/jobs\/([^/]+)\/audit-revision(?:\/(apply))?$/);
  if(req.method!=='POST'||!match)return false;
  const respond=(status,value)=>{json(res,status,value);return true;};
  const job=db.jobs.find(j=>j.id===match[1]);if(!job)fail('job_not_found',404);
  if(job.status==='已取消')fail('job_cancelled');
  const input=await body(req);
  if(match[2]==='apply'){
    const run=db.taskRuns.find(r=>r.id===input.runId&&r.jobId===job.id&&r.taskKind==='audit-revision');
    if(!run||run.state!=='succeeded'||!run.result)fail('revision_candidate_required');
    if(run.appliedVersionId){const version=db.versions.find(v=>v.id===run.appliedVersionId);if(version?.body===job.body)return respond(200,{job,version,reused:true});fail('revision_already_applied');}
    if(bodyHash(job.body)!==run.bodyHash||auditConfigHash(job)!==run.configHash||contextHash(draftContext(db,job))!==run.contextHash)fail('revision_draft_changed');
    const audit=db.auditRuns.find(a=>a.jobId===job.id);
    if(audit?.id!==run.auditRunId||run.issueIds.some(id=>!db.auditIssues.some(i=>i.id===id&&i.status==='待处理')))fail('revision_review_changed');
    const parsed=validateGeneration({...run.result,body:input.body??run.result.body});
    if(parsed.body===job.body)fail('revision_has_no_changes',422);
    let parent=db.versions.find(v=>v.jobId===job.id);
    if(parent?.body!==job.body){parent={id:uid('ver'),jobId:job.id,body:job.body,reason:'AI 修改前保存',createdAt:new Date().toISOString()};db.versions.unshift(parent);}
    const version={...parsed,id:uid('ver'),jobId:job.id,parentVersionId:parent.id,reason:'按审核意见 AI 修改',revisionRunId:run.id,auditRunId:run.auditRunId,issueIds:[...run.issueIds],model:run.model,createdAt:new Date().toISOString()};
    db.versions.unshift(version);invalidateAudit(db,job.id);job.body=version.body;job.status='待重新验证';job.updatedAt='刚刚';job.issues=0;
    run.appliedVersionId=version.id;run.appliedAt=new Date().toISOString();await saveDb(db);
    return respond(200,{job,version,reused:false,requiresAudit:true});
  }
  if(process.env.MODEL_CALLS_ENABLED!=='true')fail('model_calls_disabled');
  if(!modelEnv('audit').LLM_BASE_URL||!modelEnv('audit').LLM_API_KEY)fail('model_not_configured');
  const audit=db.auditRuns.find(a=>a.jobId===job.id),text=String(job.body||''),configHash=auditConfigHash(job);
  if(!audit||audit.state!=='completed'||audit.bodyHash!==bodyHash(text)||audit.configHash!==configHash)fail('audit_required_for_current_body');
  if(!Array.isArray(input.issueIds)||!input.issueIds.length||input.issueIds.length>40||input.issueIds.some(id=>typeof id!=='string'))fail('select_revision_issues',400);
  const issueIds=[...new Set(input.issueIds)].sort();
  let issues=issueIds.map(id=>db.auditIssues.find(i=>i.id===id&&i.jobId===job.id&&audit.issueIds.includes(id)&&i.status==='待处理'&&i.bodyHash===bodyHash(text)));
  if(issues.some(i=>!i||!i.quote||!text.includes(i.quote)))fail('revision_review_changed');
  if(input.edits!==undefined){
    if(!Array.isArray(input.edits)||input.edits.length>40||input.edits.some(e=>!e||!issueIds.includes(e.issueId)||typeof e.replacement!=='string'||e.replacement.length>20000)||new Set(input.edits.map(e=>e.issueId)).size!==input.edits.length)fail('invalid_revision_edits',400);
    const edits=new Map(input.edits.map(e=>[e.issueId,e.replacement]));issues=issues.map(issue=>edits.has(issue.id)?{...issue,replacement:edits.get(issue.id)}:issue);
  }
  const groups=auditEditGroups(text,issues);
  const context=draftContext(db,job),promptHash=contextHash(context);
  const inputHash=hash(JSON.stringify({jobId:job.id,text,configHash,promptHash,auditRunId:audit.id,issues,model:modelEnv('audit').LLM_MODEL,endpoint:modelEnv('audit').LLM_BASE_URL}));
  const active=db.taskRuns.find(r=>r.jobId===job.id&&r.taskKind==='audit-revision'&&(r.state==='running'||r.inputHash===inputHash&&r.state==='unknown'));
  if(active)return respond(409,{error:active.state==='unknown'?'generation_outcome_unknown':'generation_in_progress',runId:active.id});
  const cached=db.taskRuns.find(r=>r.taskKind==='audit-revision'&&r.inputHash===inputHash&&r.state==='succeeded'&&!r.appliedVersionId);
  if(cached)return respond(200,{run:cached,reused:true});
  const run={id:uid('run'),jobId:job.id,taskKind:'audit-revision',state:'running',inputHash,bodyHash:bodyHash(text),baseBody:text,configHash,contextHash:promptHash,auditRunId:audit.id,issueIds,issueSnapshot:structuredClone(issues),model:modelEnv('audit').LLM_MODEL,cost:null,awaitingResponse:false,startedAt:new Date().toISOString()};
  db.taskRuns.unshift(run);await saveDb(db);
  try{
    const pending=groups.filter(group=>typeof group.replacement!=='string');
    if(!pending.length){
      run.executionMode='approved-audit-edits';run.cost=0;run.result=validateGeneration({body:applyAuditEdits(text,groups),corePoint:'按勾选的审核建议应用替换文字；未选中的内容保持原样。',needsVerification:[]});
    }else{
      const system=context.system+'\n本次用户已明确接受 selectedIssues 中的修改意见；只合并待处理原句中的重叠修改，或为缺少替换文字的选中原句写最小替换。不要输出全文，不得修改未选中的内容。用户在意见框里编辑的 replacement 优先于通用文风约束。仅输出严格 JSON：{"edits":[{"groupId":"原分组ID","replacement":"这一组原句的修改稿，可为空表示删除"}],"corePoint":"改动说明","needsVerification":[]}。edits 必须逐一覆盖 groups，只处理这些局部片段，不加新事实。';
      const user=JSON.stringify({task:'只修改已选中原句，正文其他部分由系统原样保留',groups:pending.map(g=>({groupId:g.id,original:g.original,selectedIssues:g.issues})),writingContext:context.user});
      run.awaitingResponse=true;await saveDb(db);
      const env=modelEnv('audit');
      const response=await fetcher(`${env.LLM_BASE_URL.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${env.LLM_API_KEY}`},body:JSON.stringify({model:env.LLM_MODEL,messages:[{role:'system',content:system},{role:'user',content:user}],temperature:.15,...(/deepseek/i.test(String(env.LLM_BASE_URL))?{reasoning_effort:'low'}:{}),max_tokens:Math.min(12000,Math.max(5000,pending.reduce((n,g)=>n+g.original.length,0)*3+1800))}),signal:AbortSignal.timeout(180000)});
      if(!response.ok){run.awaitingResponse=response.status>=500;run.httpFailure={status:response.status,requestId:response.headers.get('x-request-id')||null,detail:(await response.text()).slice(0,4000)};throw new Error(`model_http_${response.status}`);}
      const payload=await response.json();run.awaitingResponse=false;
      run.responses=[{raw:payload.choices?.[0]?.message?.content||'',finishReason:payload.choices?.[0]?.finish_reason,usage:payload.usage||null,receivedAt:new Date().toISOString()}];await saveDb(db);
      if(run.responses[0].finishReason==='length')throw new Error('model_output_truncated');
      run.result=validateGeneration(parseAuditEdits(run.responses[0].raw,text,groups));run.executionMode='selected-spans-only';
    }
    run.editGroups=groups.map(g=>({id:g.id,start:g.start,end:g.end,issueIds:g.issues.map(i=>i.id)}));
    if(run.result.body===text)throw new Error('revision_has_no_changes');
    if(job.status==='已取消'||bodyHash(job.body)!==run.bodyHash||auditConfigHash(job)!==configHash||contextHash(draftContext(db,job))!==promptHash){run.state='conflict';return respond(409,{error:'revision_draft_changed',runId:run.id});}
    run.state='succeeded';return respond(201,{run,reused:false});
  }catch(error){run.state=run.awaitingResponse?'unknown':'failed';run.error=error.message;return respond(run.awaitingResponse||/^model_http_/.test(run.error)?502:422,{error:run.state==='unknown'?'generation_outcome_unknown':'audit_revision_failed',detail:run.error,runId:run.id});}
  finally{run.finishedAt=new Date().toISOString();await saveDb(db);}
}
