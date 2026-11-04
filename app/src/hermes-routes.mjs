import {generatedTitle} from './generation-output.mjs';
import {modelFetch as fetch} from './model-transport.mjs';
import {modelEnv} from './model-profiles.mjs';
import {recognizeWriting} from './writing-recognition.mjs';
import {sectionRange} from './section-range.mjs';
import { hermesStatus, hermesGenerate } from './integrations/hermes-client.mjs';
import { draftContext, auditConfigHash, hash, uid } from './workflow.mjs';
import { bodyHash, invalidateAudit } from './audit.mjs';

export async function hermesRoutes({req,res,url,db,json,body,saveDb}) {
  const match=url.pathname.match(/^\/api\/studio\/writing\/jobs\/([^/]+)\/(hermes-generate|hermes-section)$/);
  if(req.method!=='POST'||!match)return false;
  const job=db.jobs.find(j=>j.id===decodeURIComponent(match[1]));
  const respond=(status,value)=>{json(res,status,value);return true;};
  if(!job)return respond(404,{error:'job_not_found'});
  if(job.status==='已取消')return respond(409,{error:'job_cancelled'});
  if(process.env.MODEL_CALLS_ENABLED!=='true')return respond(409,{error:'model_calls_disabled'});
  const direct=match[2]==='hermes-section'&&job.writingEngine!=='hermes';
  const status=direct?{mode:modelEnv('writing').LLM_BASE_URL&&modelEnv('writing').LLM_API_KEY?'ready':'missing',model:modelEnv('writing').LLM_MODEL}:await hermesStatus();if(status.mode!=='ready')return respond(409,{error:'hermes_incomplete_configuration',missing:status.missing,detail:status.detail});
  const input=await body(req);job.writingInputTitle??=job.title;let context=draftContext(db,job);const initialContextUser=context.user;const before=String(job.body||'');
  const section=match[2]==='hermes-section';const target=input.section;
  if(section&&!['opening','body','ending'].includes(target))return respond(400,{error:'invalid_section'});
  if(section&&!before.trim())return respond(400,{error:'body_required'});
  const range=section?sectionRange(before,target):null;
  let system=section?context.system.replace('只输出严格 JSON：{"body":"至少80字符的完整正文","corePoint":"核心观点","needsVerification":[]}。','只输出指定段落的完整新正文。保留其他段落，不要输出全文。'):context.system;
  let user=context.user+(section?`\n全文（仅供理解）：${before}\n本次仅改写此段：${range.text}\n要求：${input.instruction||'保留原意，让表达更清楚。'}`:'');
  const inputHash=hash(JSON.stringify({jobId:job.id,mode:match[2],target,model:status.model,system,user}));
  const taskKind=section?`hermes-section:${target}`:'hermes-generate';
  const existing=db.taskRuns.find(r=>r.inputHash===inputHash&&['running','unknown'].includes(r.state));
  if(existing)return respond(409,{error:existing.state==='running'?'generation_in_progress':'generation_outcome_unknown',runId:existing.id});
  const cached=db.versions.find(v=>v.jobId===job.id&&v.inputHash===inputHash);
  if(cached){if(job.body!==cached.body){invalidateAudit(db,job.id);db.versions.unshift({...structuredClone(cached),id:uid('ver'),reason:'复用相同输入的 Hermes 稿',createdAt:new Date().toISOString()});job.body=cached.body;job.status='待审核';await saveDb(db);}return respond(200,{job,version:cached,reused:true});}
  const run={id:uid('run'),jobId:job.id,taskKind,state:'running',inputHash,startedAt:new Date().toISOString(),cost:null,awaitingResponse:true,attempts:1,model:status.model};
  db.taskRuns.unshift(run);await saveDb(db);
  const initialConfig=auditConfigHash(job);const initialBody=bodyHash(before);
  try{
    if(!section){context=await recognizeWriting({db,job,run,saveDb});system=context.system;user=context.user;}
    run.awaitingResponse=true;await saveDb(db);
    const result=await (direct?generateSection:hermesGenerate)({system,user,mode:section?'section':job.originalBody?'rewrite':'topic'});
    run.awaitingResponse=false;run.responses=[...(run.responses||[]),{raw:result.rawResponse,usage:result.usage,receivedAt:new Date().toISOString()}];
    if(job.status==='已取消'){run.state='cancelled';run.error='job_cancelled_response_not_applied';return respond(409,{error:'job_cancelled',runId:run.id});}
    if(bodyHash(job.body)!==initialBody||auditConfigHash(job)!==initialConfig||draftContext(db,job).user!==initialContextUser){run.state='conflict';run.generatedBody=result.body;return respond(409,{error:'draft_changed_during_generation',runId:run.id});}
    let next=result.body;if(section){next=before.slice(0,range.start)+result.body+before.slice(range.end);}
    const version={id:uid('ver'),jobId:job.id,body:next,inputHash,templateSnapshot:structuredClone(context.template),knowledgeSnapshot:context.knowledge,sourceSnapshot:context.refs,
      parentVersionId:db.versions.find(v=>v.jobId===job.id)?.id||null,reason:section?`Hermes 局部重构：${target}`:'Hermes 生成',model:result.model,transport:result.transport,usage:result.usage,rawResponse:result.rawResponse,createdAt:new Date().toISOString()};
    invalidateAudit(db,job.id);db.versions.unshift(version);job.body=next;if(!section)job.title=generatedTitle(result);version.title=job.title;job.status='待审核';job.updatedAt='刚刚';job.issues=0;run.state='succeeded';
    return respond(201,{job,version,run});
  }catch(error){run.state=(error.outcomeUnknown??run.awaitingResponse)?'unknown':'failed';run.error=error.message;if(error.rawResponse)run.responses=[...(run.responses||[]),{raw:error.rawResponse,receivedAt:new Date().toISOString()}];return respond(502,{error:run.state==='unknown'?'generation_outcome_unknown':'hermes_generation_failed',detail:run.error,runId:run.id});}
  finally{run.finishedAt=new Date().toISOString();await saveDb(db);}
}

async function generateSection(input){
 let response;
 try{response=await fetch(`${modelEnv('writing').LLM_BASE_URL.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${modelEnv('writing').LLM_API_KEY}`},body:JSON.stringify({model:modelEnv('writing').LLM_MODEL,messages:[{role:'system',content:input.system+'\n仅输出选定部分的新正文，不输出其他部分，不加标题或解释。'},{role:'user',content:input.user}],temperature:.3,max_tokens:5000}),signal:AbortSignal.timeout(180000)});}catch(error){error.outcomeUnknown=true;throw error;}
 if(!response.ok)throw Object.assign(new Error(`model_http_${response.status}`),{outcomeUnknown:response.status>=500});
 let payload;try{payload=await response.json();}catch(error){error.outcomeUnknown=true;throw error;}
 const raw=payload.choices?.[0]?.message?.content||'';let text=raw;
 try{const parsed=JSON.parse(raw);text=parsed.body||raw;}catch{}
 if(typeof text!=='string'||text.trim().length<2||payload.choices?.[0]?.finish_reason==='length')throw Object.assign(new Error('invalid_section_output'),{outcomeUnknown:false,rawResponse:raw});
 return {body:text.trim(),model:modelEnv('writing').LLM_MODEL,rawResponse:raw,usage:payload.usage,transport:'model-gateway'};
}
