import {readChatCompletion} from './model-stream.mjs';
import {modelFetch as fetch} from './model-transport.mjs';
import {modelEnv} from './model-profiles.mjs';
import { accountStats, analysisPrompt, parseVideoAnalysis, analysisVersion } from './account-analysis.mjs';
import { hash, uid, documentSource } from './workflow.mjs';
import { normalizeMaterial } from './materials.mjs';
import { restoreFeishuTranscripts } from './restore-feishu-transcripts.mjs';
import { sourceMutationBlocked } from './task-state.mjs';
import {parseStructuredOutput,structuredObjects} from './structured-output.mjs';

export function recoverVideoResults(responses,videos,existing=[]){
  const byId=new Map(existing.map(v=>[v.id,v]));
  for(const response of responses||[])for(const object of structuredObjects(response.raw))for(const item of Array.isArray(object.videos)?object.videos:[object]){
    const video=videos.find(v=>v.id===item.id);if(!video||byId.has(video.id))continue;
    try{byId.set(video.id,parseVideoAnalysis(JSON.stringify({videos:[item]}),[video])[0]);}catch{}
  }
  return [...byId.values()];
}

const fail=(message,statusCode=409)=>{throw Object.assign(new Error(message),{statusCode});};
export function accountProcessingProgress(db,task){
 const run=db.taskRuns.find(r=>r.jobId===task.id&&r.taskKind==='account-analysis');
 const completed=run?.videoResults?.length||run?.completedVideos||0,total=run?.totalVideos||task.rows?.length||0;
 const partial=run&&['failed','cancelled','partial'].includes(run.state)&&completed>0;
 return {analysisState:partial?'部分成功':run?.state==='succeeded'?'已完成':run?.state||(db.accountAnalyses?.some(r=>r.taskId===task.id)?'已完成':'未分析'),analysisCompleted:completed,analysisTotal:total,analysisSettings:run?.settings,analysisContext:run?.context||'',analysisError:run?.error||null};
}
export async function executeAccountAnalysis({db,run,task,stats,context,saveDb,fetcher=fetch}){
  const ask=async(system,user,maxTokens)=>{
    if(run.cancelRequested)throw Object.assign(new Error('analysis_stopped_by_user'),{cancelled:true});
    run.awaitingResponse=true;await saveDb(db);
    const deepseek=/deepseek/i.test(modelEnv('analysis').LLM_MODEL+' '+modelEnv('analysis').LLM_BASE_URL),stream=deepseek&&modelEnv('analysis').LLM_WIRE_API!=='responses';
    const response=await fetcher(`${modelEnv('analysis').LLM_BASE_URL.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${modelEnv('analysis').LLM_API_KEY}`},body:JSON.stringify({model:modelEnv('analysis').LLM_MODEL,messages:[{role:'system',content:system},{role:'user',content:user}],temperature:.2,max_tokens:deepseek?Math.max(maxTokens,16000):maxTokens,...(deepseek?{reasoning_effort:'low'}:{}),...(stream?{stream:true,stream_options:{include_usage:true}}:{})}),signal:AbortSignal.timeout(240000)});
    if(!response.ok){run.awaitingResponse=response.status>=500;run.httpFailure={status:response.status,requestId:response.headers.get('x-request-id')||response.headers.get('request-id')||null,receivedAt:new Date().toISOString()};try{const errorBody=await response.text();run.httpFailure.detail=errorBody.slice(0,8000);}catch{}await saveDb(db);throw new Error(`model_http_${response.status}`);}
    const payload=await readChatCompletion(response);run.awaitingResponse=false;const raw=payload.choices?.[0]?.message?.content;
    run.responses||=[];run.responses.push({raw,finishReason:payload.choices?.[0]?.finish_reason,usage:payload.usage||null,receivedAt:new Date().toISOString()});await saveDb(db);
    if(payload.choices?.[0]?.finish_reason==='length')throw Error('model_output_truncated');if(typeof raw!=='string')throw new Error('analysis_empty_response');return raw;
  };
  try{
    run.videoResults||=[];
    const done=new Set(run.videoResults.map(v=>v.id));const remaining=stats.videos.filter(v=>!done.has(v.id)&&(!run.targetVideoIds||run.targetVideoIds.includes(v.id)));
    const batchSize=2;
    const batches=Math.ceil(stats.videos.length/batchSize);run.totalBatches=batches+1;run.completedVideos=run.videoResults.length;run.completedBatches=Math.ceil(run.completedVideos/batchSize);
    for(let offset=0;offset<remaining.length;offset+=batchSize){
      const batch=remaining.slice(offset,offset+batchSize);const prompt=analysisPrompt(stats,batch,context,task.summary?.coverage);
      const raw=await ask(prompt.system,prompt.user,10000);
      let results;try{results=parseVideoAnalysis(raw,batch);}catch(error){run.videoResults=recoverVideoResults([{raw}],batch,run.videoResults);run.completedVideos=run.videoResults.length;await saveDb(db);const pending=batch.filter(v=>!run.videoResults.some(r=>r.id===v.id));if(!pending.length)continue;const correction=analysisPrompt(stats,pending,context,task.summary?.coverage);run.validationRepairs||=[];run.validationRepairs.push({videoIds:pending.map(v=>v.id),reason:error.message});const repaired=await ask(correction.system+' 上次完整响应未通过校验，本次只修正列出的未完成作品。evidence必须从本作品evidencePool选择evidenceId，不抄写或改写原句，不添加其他作品。',correction.user,10000);results=parseVideoAnalysis(repaired,pending);}
      run.videoResults.push(...results);run.completedVideos=run.videoResults.length;run.completedBatches=Math.ceil(run.completedVideos/batchSize);await saveDb(db);
    }
    if(run.targetVideoIds&&run.videoResults.length<stats.videos.length){run.state='partial';run.finishedAt=new Date().toISOString();return;}
    if(run.cancelRequested)throw Object.assign(new Error('analysis_stopped_by_user'),{cancelled:true});
    const system='你是给创作者自用的抖音账号研究顾问。给出直接、具体、可排序的判断，不写空话。结合逐条结果和统计对照，总结这个账号怎么起号、为什么部分作品比常态强、话题与热点、文案钩子、广告、疑似投流及引流。判断原因时给最可能解释、反证和置信度；不得把收藏点赞比当成投放证据，也不得虚构热点、历史粉丝和逐日流量。数据是当前累计快照，节点按发布日期。引用给定作品id，不得杜撰。只输出严格 JSON：{"overview":"直接结论","breakout":{"date":"给定日期或资料不足","videoIds":["id"],"reason":"最可能的转折手法","alternatives":"其他解释"},"patterns":[{"name":"可复用打法","explanation":"操作步骤与适用条件","videoIds":["id"]}],"advertising":"商业推广与投流倾向，给具体作品和置信度","funnels":"导流方式","nextSteps":["建议"]}。最多总结五条打法。全部解释合计不超过1200个中文字，不重复逐条报告，不输出推理过程。';
    const byId=new Map(stats.videos.map(v=>[v.id,v]));
    const representatives=new Set([...stats.videos.slice(0,20),...stats.videos.slice(-10),...[...stats.videos].sort((a,b)=>(b.diggCount||0)-(a.diggCount||0)).slice(0,35),...[...stats.videos].sort((a,b)=>(b.saveLikeRatio||0)-(a.saveLikeRatio||0)).slice(0,15)].map(v=>v.id));
    const aggregate={totalAnalyzed:run.videoResults.length,categories:Object.fromEntries(['起号作品','广告作品','异常爆款','选题优质','优质文案','普通文案'].map(tag=>[tag,run.videoResults.filter(r=>r.tags.includes(tag)).length]))};
    const user=JSON.stringify({task:'总结账号起号手法与可复用打法，用具体作品对照支持结论。全部作品已逐条分析；以下代表作品覆盖早期、后期、高互动与高收藏，配合全量统计归纳。',context,coverage:task.summary?.coverage||{complete:false,stopReason:'未记录末页证据'},baseline:stats.baseline,turningPoints:stats.turningPoints,timeline:stats.timeline,aggregate,limits:stats.limits,videos:run.videoResults.filter(r=>representatives.has(r.id)).map(r=>({id:r.id,tags:r.tags,topic:r.topic,hook:r.hook,technique:r.technique,reason:r.reason.slice(0,180),evidence:r.evidence.slice(0,1),promotion:r.promotion.slice(0,160),funnel:r.funnel.slice(0,100),date:byId.get(r.id)?.date,likes:byId.get(r.id)?.diggCount}))});
    const raw=await ask(system,user,5000);const summary=parseStructuredOutput(raw,value=>{if(typeof value.overview!=="string"||!value.breakout||!Array.isArray(value.patterns))throw new Error("analysis_invalid_summary");return value;});
    const valid=new Set(stats.videos.map(v=>v.id));
    if(typeof summary.overview!=='string'||!summary.breakout||typeof summary.breakout.reason!=='string'||!Array.isArray(summary.breakout.videoIds)||!Array.isArray(summary.patterns)||summary.patterns.length>8||!Array.isArray(summary.nextSteps))throw new Error('analysis_invalid_summary');
    for(const p of [summary.breakout,...summary.patterns])if(!Array.isArray(p.videoIds)||p.videoIds.some(id=>!valid.has(id)))throw new Error('analysis_summary_unknown_video');
    if(summary.breakout.date!=='资料不足'&&!stats.videos.some(v=>v.date===summary.breakout.date))throw new Error('analysis_summary_unknown_date');
    if(hash(JSON.stringify({rows:task.rows,settings:stats.settings}))!==stats.dataHash)throw new Error('collection_changed_during_analysis');
    const report={id:uid('account-report'),taskId:task.id,runId:run.id,inputHash:run.inputHash,dataHash:stats.dataHash,settings:stats.settings,context,summary,videos:run.videoResults,baseline:stats.baseline,createdAt:new Date().toISOString(),methodVersion:analysisVersion,model:run.model||modelEnv('analysis').LLM_MODEL};
    db.accountAnalyses.unshift(report);if(task.workflow?.step==='analysis'&&task.workflow.state==='paused'){task.workflow.steps.analysis={state:'succeeded',result:{reportId:report.id},completedAt:new Date().toISOString()};delete task.workflow.error;if(!task.workflow.options?.syncFeishu){task.workflow.state='succeeded';task.workflow.step='done';}}run.reportId=report.id;run.state='succeeded';run.completedBatches=run.totalBatches;run.finishedAt=new Date().toISOString();
  }catch(error){const code=error.cause?.code;const beforeConnection=['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','UND_ERR_CONNECT_TIMEOUT'].includes(code);run.state=error.cancelled?'cancelled':run.awaitingResponse&&!beforeConnection?'unknown':'failed';run.error=error.message;run.errorCode=code||null;run.finishedAt=new Date().toISOString();}
  finally{await saveDb(db);}
}

export async function accountAnalysisRoutes(ctx){
  const {req,res,url,db,json,body,saveDb,dataDir}=ctx;
  const respond=(status,value)=>{json(res,status,value);return true;};
  db.accountAnalyses||=[];
  const tasks=db.taskRuns.filter(r=>r.taskKind==='douyin-collect');
  if(req.method==='GET'&&url.pathname==='/api/studio/douyin/account-analysis'){
    const task=tasks.find(t=>t.id===url.searchParams.get('taskId'))||tasks[0];
    const report=task&&db.accountAnalyses.find(r=>r.taskId===task.id);const run=task&&db.taskRuns.find(r=>r.taskKind==='account-analysis'&&r.jobId===task.id);
    const stats=url.searchParams.get('view')!=='tasks'&&task?.rows?.length?accountStats(task.rows,run?.state!=='succeeded'&&run?.settings?run.settings:report?.settings):null;
    return respond(200,{tasks:tasks.map(t=>({id:t.id,purpose:t.request?.purpose||'collection',mode:t.request?.mode,dnaState:db.taskRuns.find(r=>r.jobId===t.id&&r.taskKind==='writing-dna')?.state,state:t.state,profile:t.request.urls[0],title:t.rows?.[0]?.author_name||t.rows?.[0]?.author||'博主主页',count:t.rows?.length||t.count||0,startedAt:t.startedAt,...accountProcessingProgress(db,t),logs:t.id===task?.id?(t.logs||''):'',error:t.error,coverage:t.summary?.coverage||null,workflow:t.workflow||null})),taskId:task?.id||null,stageTasks:db.taskRuns.filter(r=>r.jobId===task?.id&&['douyin-asr','douyin-comments','feishu-sync'].includes(r.taskKind)).map(r=>({id:r.id,taskKind:r.taskKind,state:r.state,videoId:r.videoId,logs:r.logs||'',error:r.error})),stats,report:url.searchParams.get('view')==='tasks'?null:report||null,stale:Boolean(report&&stats&&(report.dataHash!==stats.dataHash||report.methodVersion!==analysisVersion)),partialVideoResults:url.searchParams.get('view')==='tasks'?[]:run?.state!=='succeeded'&&run?.dataHash===stats?.dataHash?run?.videoResults||[]:[],run:run?{id:run.id,state:run.state,completedVideos:run.completedVideos||0,totalVideos:run.totalVideos,completedBatches:run.completedBatches||0,totalBatches:run.totalBatches,cancelRequested:Boolean(run.cancelRequested),resumedVideos:run.resumedVideos||0,context:run.context||'',error:run.error,errorCode:run.errorCode}:null,feishuReady:Boolean(db.integration?.feishu),transcriptionReady:Boolean(process.env.DASHSCOPE_API_KEY),modelReady:process.env.MODEL_CALLS_ENABLED==='true'&&Boolean(modelEnv('analysis').LLM_BASE_URL&&modelEnv('analysis').LLM_API_KEY&&modelEnv('analysis').LLM_MODEL)});
  }
  const materialMatch=url.pathname.match(/^\/api\/studio\/douyin\/tasks\/([^/]+)\/(transcript|prepare-writing)$/);
  const match=materialMatch||url.pathname.match(/^\/api\/studio\/douyin\/account-analysis\/([^/]+)\/(analyze|cancel|transcript|restore-feishu|export|prepare-writing)$/);
  if(!match)return false;const task=materialMatch?db.taskRuns.find(t=>t.id===match[1]&&t.taskKind==='douyin-collect'):tasks.find(t=>t.id===match[1]);if(!task)fail('account_collection_not_found',404);
  if(materialMatch&&(task.state!=='succeeded'||!task.rows?.length))fail('collection_result_unavailable');
  if(req.method==='POST'&&match[2]==='cancel'){
    const run=db.taskRuns.find(r=>r.taskKind==='account-analysis'&&r.jobId===task.id&&r.state==='running');if(!run)return respond(200,{state:'not_running'});
    run.cancelRequested=true;run.cancelRequestedAt=new Date().toISOString();await saveDb(db);return respond(202,{state:'stopping_after_current_request',runId:run.id});
  }
  if(req.method==='POST'&&match[2]==='restore-feishu'){
    if(task.state!=='succeeded'||!task.rows?.length)fail('collect_profile_before_restore');
    const result=await restoreFeishuTranscripts({db,task,dataDir});task.lastFeishuRestore={...result,at:new Date().toISOString()};await saveDb(db);return respond(200,result);
  }
  if(req.method==='POST'&&match[2]==='transcript'){
    if(db.taskRuns.some(r=>sourceMutationBlocked(r,task.id)))fail('stop_or_review_running_analysis_before_edit');
    const input=await body(req);const text=typeof input.text==='string'?input.text.trim():'';if(!text||text.length>100000)fail('transcript_must_be_1_to_100000_characters',400);
    if(db.taskRuns.some(r=>sourceMutationBlocked(r,task.id)))fail('stop_or_review_running_analysis_before_edit');
    const row=task.rows?.find(r=>String(r.externalId||r.aweme_id||'')===input.videoId||input.url&&r.url===input.url);if(!row)fail('video_not_found',404);
    const before=String(row.transcript||row.content||'');if(before===text)return respond(200,{saved:true,reused:true});
    task.transcriptVersions||=[];task.transcriptVersions.push({videoId:String(row.externalId||row.aweme_id||''),text:before,source:row.transcriptState||'original',changedAt:new Date().toISOString()});
    row.transcript=row.content=text;row.transcriptState='manual';row.transcriptEditedAt=new Date().toISOString();await saveDb(db);return respond(200,{saved:true,analysisNeedsRefresh:true});
  }
  if(req.method==='POST'&&match[2]==='prepare-writing'){
    const input=await body(req);const row=task.rows?.map(normalizeMaterial).find(v=>v.externalId===input.videoId||v.url===input.url);if(!row?.transcript?.trim())fail('transcript_required_before_writing');
    let doc=db.documents.find(d=>d.externalId&&d.externalId===row.externalId&&d.source==='douyin-material-pipeline');
    if(!doc){doc={id:uid('doc'),name:row.title,content:row.transcript,type:'写作案例库',factRole:'外部写作案例·不可作为本人经历',source:'douyin-material-pipeline',sourceTaskId:task.id,externalId:row.externalId,url:row.url,author:row.author,publishedAt:row.publishedAt,diggCount:row.diggCount,collectCount:row.collectCount,chunks:Math.max(1,Math.ceil(row.transcript.length/420)),version:1,tag:'采集作品选入',updatedAt:'刚刚'};db.documents.unshift(doc);db.sources.unshift({...documentSource(doc),origin:'douyin-import',status:'素材库'});}
    else if(doc.content!==row.transcript){db.documentVersions||=[];db.documentVersions.unshift({...structuredClone(doc),id:uid('doc-version'),documentId:doc.id});Object.assign(doc,{name:row.title,content:row.transcript,version:(doc.version||1)+1,chunks:Math.max(1,Math.ceil(row.transcript.length/420)),sourceTaskId:task.id,updatedAt:'刚刚'});const source=db.sources.find(s=>s.id===doc.id);if(source)Object.assign(source,documentSource(doc));}
    await saveDb(db);return respond(200,doc);
  }
  if(req.method==='GET'&&match[2]==='export'){
    const report=db.accountAnalyses.find(r=>r.taskId===task.id);if(!report)fail('account_analysis_not_ready');
    const stats=accountStats(task.rows,report.settings);if(stats.dataHash!==report.dataHash||report.methodVersion!==analysisVersion)fail('account_report_outdated_regenerate_first');
    const markdown=[`# 博主起号分析`,report.summary.overview,`\n## 起号转折\n${report.summary.breakout.date}\n${report.summary.breakout.reason}\n其他解释：${report.summary.breakout.alternatives}`,`\n## 可复用打法`,...report.summary.patterns.map(p=>`### ${p.name}\n${p.explanation}\n依据：${p.videoIds.map(id=>stats.videos.find(v=>v.id===id)?.url||id).join('、')}`),`\n## 商业与引流\n${report.summary.advertising}\n${report.summary.funnels}`,`\n## 作品明细`,...report.videos.map(v=>{const row=stats.videos.find(r=>r.id===v.id);return `### ${row?.date} ${row?.title}\n${row?.url}\n点赞：${row?.diggCount??'未知'} · 收藏：${row?.collectCount??'未知'} · 评论：${row?.commentCount??'未知'} · 转发：${row?.shareCount??'未知'}\n标签：${v.tags.join('、')}\n${v.reason}\n${v.evidence.map(e=>`> ${e.quote}\n${e.why}`).join('\n')}\n投流倾向：${v.promotion}\n引流：${v.funnel}`;}),`\n## 数据说明\n${stats.limits.join('\n')}`].join('\n\n');res.writeHead(200,{'content-type':'text/markdown; charset=utf-8','content-disposition':`attachment; filename="account-analysis-${task.id}.md"`});res.end(markdown);return true;
  }
  if(req.method!=='POST'||match[2]!=='analyze')return false;
  if(task.workflow?.state==='running'&&!ctx.awaitCompletion)fail('source_processing_in_progress');
  if(task.state!=='succeeded'||!task.rows?.length)fail('collect_profile_before_analysis');
  if(db.taskRuns.some(r=>r.jobId===task.id&&['douyin-asr','douyin-comments'].includes(r.taskKind)&&['running','unknown'].includes(r.state)))fail('finish_or_review_transcription_first');
  if(process.env.MODEL_CALLS_ENABLED!=='true'||!modelEnv('analysis').LLM_BASE_URL||!modelEnv('analysis').LLM_API_KEY)fail('model_not_configured');
  const input=await body(req);const stats=accountStats(task.rows,input.settings);const context=String(input.context||'').slice(0,6000);
  const inputHash=hash(JSON.stringify({dataHash:stats.dataHash,context,version:analysisVersion,model:modelEnv('analysis').LLM_MODEL,endpoint:modelEnv('analysis').LLM_BASE_URL}));
  const report=db.accountAnalyses.find(r=>r.inputHash===inputHash&&r.taskId===task.id);if(report)return respond(200,{reused:true,reportId:report.id});
  const active=db.taskRuns.find(r=>r.jobId===task.id&&r.taskKind==='account-analysis'&&['running','unknown'].includes(r.state));if(active)fail(active.state==='unknown'?'analysis_previous_response_needs_review':'account_analysis_in_progress');
  const previous=db.taskRuns.find(r=>r.jobId===task.id&&r.taskKind==='account-analysis'&&r.inputHash===inputHash&&['failed','cancelled','partial'].includes(r.state)&&r.videoResults?.length);
  const reusable=previous?recoverVideoResults(previous.responses,stats.videos,structuredClone(previous.videoResults)):[];
  if(input.videoIds!==undefined&&(!Array.isArray(input.videoIds)||input.videoIds.length!==1||input.videoIds.some(id=>typeof id!=='string'||!stats.videos.some(v=>v.id===id))))fail('analysis_invalid_video_selection',400);
  if(input.videoIds?.every(id=>reusable.some(v=>v.id===id)))fail('analysis_video_already_completed');
  const run={targetVideoIds:input.videoIds,id:uid('run'),taskKind:'account-analysis',jobId:task.id,inputHash,dataHash:stats.dataHash,model:modelEnv('analysis').LLM_MODEL,state:'running',startedAt:new Date().toISOString(),totalVideos:stats.videos.length,completedVideos:reusable.length,videoResults:reusable,resumedFrom:previous?.id||null,resumedVideos:reusable.length,awaitingResponse:false,settings:stats.settings,context};db.taskRuns.unshift(run);await saveDb(db);
  if(ctx.awaitCompletion){await executeAccountAnalysis({db,run,task,stats,context,saveDb});if(run.state!=='succeeded')fail(run.state==='unknown'?'analysis_previous_response_needs_review':run.error||'account_analysis_failed');return respond(200,{reportId:run.reportId,runId:run.id,state:run.state});}
  void executeAccountAnalysis({db,run,task,stats,context,saveDb}).catch(async error=>{if(run.state==='succeeded')return console.error('account analysis post-success save error:',error);run.state=run.awaitingResponse?'unknown':'failed';run.error=error.message;await saveDb(db);});
  return respond(202,{runId:run.id,state:'running',totalVideos:stats.videos.length});
}
