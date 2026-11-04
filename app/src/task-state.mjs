// A finished/unknown model request no longer writes source material. Its retry
// remains blocked separately; unrelated manual work must stay available.
export function sourceMutationBlocked(run,taskId){
  if(run.jobId!==taskId)return false;
  if(['account-analysis','writing-dna'].includes(run.taskKind))return run.state==='running';
  return ['douyin-asr','douyin-comments'].includes(run.taskKind)&&['running','unknown'].includes(run.state);
}

export function modelServiceStatus(db,env=process.env){
  const configured=Boolean(env.LLM_BASE_URL&&env.LLM_API_KEY&&env.LLM_MODEL);
  if(!configured)return {state:'not_configured',configured:false,detail:'尚未配置完整模型服务'};
  if(env.MODEL_CALLS_ENABLED!=='true')return {state:'disabled',configured:true,detail:'模型调用已关闭'};
  const latest=(db.taskRuns||[]).find(r=>['generate','model-audit','audit-revision','account-analysis'].includes(r.taskKind)&&(!r.model||r.model===env.LLM_MODEL));
  if(!latest)return {state:'unverified',configured:true,detail:'已配置，尚无实际调用结果'};
  const base={configured:true,lastRunId:latest.id,lastState:latest.state,lastAt:latest.finishedAt||latest.startedAt,lastError:latest.error||null};
  if(latest.state==='running')return {...base,state:'running',detail:'请求进行中，尚未收到完整结果'};
  if(latest.state==='succeeded')return {...base,state:'responded',detail:'最近一次调用成功；不代表下一次必然成功'};
  if(latest.state==='unknown')return {...base,state:'outcome_unknown',detail:'最近调用没有完整回执，模型服务尚未验证恢复'};
  return {...base,state:'degraded',detail:'最近调用未成功；已有资料仍可查看和编辑'};
}

export function runReceipt(run,env=process.env){
  const redact=value=>{
    let text=String(value||'').slice(0,100000);
    for(const key of [env.LLM_API_KEY,env.HERMES_API_KEY,env.DASHSCOPE_API_KEY,env.STUDIO_TOKEN].filter(Boolean))text=text.split(key).join('[已隐藏凭证]');
    return text;
  };
  return {id:run.id,taskKind:run.taskKind,state:run.state,model:run.model||null,startedAt:run.startedAt,finishedAt:run.finishedAt||null,error:redact(run.error),httpFailure:run.httpFailure?{...run.httpFailure,detail:redact(run.httpFailure.detail)}:null,
    completedVideos:run.completedVideos||0,totalVideos:run.totalVideos||0,
    responses:(run.responses||[]).map(r=>({receivedAt:r.receivedAt,usage:r.usage||null,raw:redact(r.raw)})),
    billingConfirmed:false,detail:'这里仅展示本机收到的回执，不能据此确认服务商实际计费。允许重试不会自动提交请求。'};
}
