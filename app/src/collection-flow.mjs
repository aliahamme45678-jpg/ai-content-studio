import {accountStats} from './account-analysis.mjs';
import {normalizeMaterial} from './materials.mjs';
export function collectionFlowOptions(input,capabilities){
  if(input==null)return null;
  const fail=message=>{throw Object.assign(new Error(message),{statusCode:400});};
  if(typeof input!=='object'||Array.isArray(input))fail('invalid_collection_workflow');
  for(const key of ['transcribe','saveLibrary','syncFeishu'])if(typeof input[key]!=='boolean')fail('invalid_collection_workflow');
  if(input.analyze!==undefined&&typeof input.analyze!=='boolean')fail('invalid_collection_workflow');
  if(input.analyze&&(!capabilities.account||!capabilities.model))fail('account_analysis_model_required');
  if(input.analyze&&input.confirmModel!==true)fail('analysis_cost_confirmation_required');
  if(input.distill!==undefined&&typeof input.distill!=='boolean')fail('invalid_collection_workflow');
  if(input.distill&&(!capabilities.distill||input.confirmModel!==true))fail('distillation_model_required');
  const analysisSettings=input.analyze?accountStats([],input.analysisSettings||{}).settings:null;
  if(input.transcribe&&!capabilities.asr)fail('asr_not_configured');
  if(input.transcribe&&input.confirmPaid!==true)fail('asr_cost_confirmation_required');
  if(input.syncFeishu&&(!capabilities.feishu||input.feishuTableId!==capabilities.feishu.tableId))fail('feishu_target_changed');
  return {...(input.distill?{distill:true,confirmModel:true}:{}),...(input.analyze?{analyze:true,confirmModel:true,analysisSettings,analysisContext:String(input.analysisContext||'').slice(0,6000)}:{}),transcribe:input.transcribe,saveLibrary:input.saveLibrary,syncFeishu:input.syncFeishu,confirmPaid:input.confirmPaid===true,feishuTableId:input.syncFeishu?capabilities.feishu.tableId:null,feishuBaseToken:input.syncFeishu?capabilities.feishu.baseToken:null};
}

// This runs on the server and persists each checkpoint independently of the page.
export async function executeCollectionFlow({db,task,saveDb,transcribe,saveMaterial,sync,analyze,distill}){
  const flow=task.workflow,options=flow.options;flow.steps||={};delete flow.error;
  const step=async(name,work)=>{if(flow.steps[name]?.state==='succeeded')return;flow.step=name;flow.steps[name]={state:'running'};await saveDb(db);const result=await work();flow.steps[name]={state:'succeeded',completedAt:new Date().toISOString(),result};await saveDb(db);};
  try{
    if(db.taskRuns.some(r=>r.jobId===task.id&&['douyin-asr','douyin-comments','feishu-sync','account-analysis','writing-dna'].includes(r.taskKind)&&(['running','unknown'].includes(r.state)||r.taskKind==='douyin-asr'&&r.state==='partial'&&r.summary?.unknown>0)))throw new Error('已有处理任务进行中或回执未确认，请先处理该任务。');
    if(options.transcribe)await step('transcribe',async()=>{
      for(const row of task.rows){
        if(String(row.transcript||row.content||'').trim())continue;
        const id=normalizeMaterial(row).externalId;if(!id)continue;
        const doc=db.documents?.find(d=>d.source==='douyin-material-pipeline'&&String(d.externalId)===id&&d.content?.trim());
        const prior=doc?null:db.taskRuns.filter(t=>t.id!==task.id&&t.taskKind==='douyin-collect'&&t.state==='succeeded').flatMap(t=>t.rows||[]).find(r=>normalizeMaterial(r).externalId===id&&String(r.transcript||r.content||'').trim());
        if(doc||prior){row.transcript=row.content=doc?.content||prior.transcript||prior.content;row.transcriptState='reused';row.transcriptReusedFrom=doc?.id||id;}
      }
      await saveDb(db);

      if(!task.rows.some(r=>!String(r.transcript||r.content||'').trim()))return {reused:task.rows.length};
      const result=await transcribe();if(result.state!=='succeeded')throw new Error('部分语音转写失败或回执不明确，请处理后继续；成功的正文已保留。');return {runId:result.id};
    });
    if(options.saveLibrary)await step('library',async()=>{const ids=[];for(const row of task.rows)if(String(row.transcript||row.content||'').trim())ids.push((await saveMaterial(row)).id);return {documentIds:ids,withoutText:task.rows.length-ids.length};});
    if(options.distill)await step('distill',async()=>{const result=await distill();return {runId:result.id};});
    if(options.analyze)await step('analysis',async()=>{const result=await analyze({settings:options.analysisSettings,context:options.analysisContext});if(!result.reportId)throw new Error('分析尚未完成，请处理运行记录后继续。');return {reportId:result.reportId};});
    if(options.syncFeishu)await step('feishu',async()=>{
      if((db.integration?.feishu?.tableId!==options.feishuTableId||db.integration?.feishu?.baseToken!==options.feishuBaseToken))throw new Error('飞书目标已改变，请重新确认目标后启动新任务。');
      if(!task.rows.some(r=>String(r.transcript||r.content||'').trim()))throw new Error('没有可同步的正文，请补充文字后继续。');
      const run=await sync();return {runId:run.id,written:run.recordIds?.length||0};
    });
    flow.state='succeeded';flow.step='done';delete flow.error;
  }catch(error){flow.state='paused';flow.error=error.message;if(flow.steps[flow.step]?.state==='running')flow.steps[flow.step].state='paused';}
  finally{await saveDb(db);}
}
