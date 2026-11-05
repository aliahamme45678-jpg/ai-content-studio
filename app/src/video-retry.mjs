import {normalizeMaterial} from './materials.mjs';
const fail=(message,statusCode=409)=>{throw Object.assign(Error(message),{statusCode});};
export function retryVideoSource(row){
 const material=normalizeMaterial(row);
 if(/^\d{10,25}$/.test(material.externalId))return 'https://www.douyin.com/video/'+material.externalId;
 let url;try{url=new URL(material.url.trim());}catch{fail('video_source_url_required',400);}
 if(url.protocol!=='https:'||url.username||url.password||url.port||!['douyin.com','www.douyin.com','v.douyin.com','iesdouyin.com','www.iesdouyin.com'].includes(url.hostname))fail('video_source_url_required',400);
 const id=url.pathname.match(/\/(?:share\/)?video\/(\d{10,25})(?:\/|$)/)?.[1];
 if(id)return 'https://www.douyin.com/video/'+id;
 if(url.hostname!=='v.douyin.com'&&!/^\/video\/[^/]+\/?$/.test(url.pathname))fail('video_source_url_required',400);
 return url.href;
}
export function retryVideoRow(task,videoId){
 const row=task.rows?.find((r,i)=>normalizeMaterial(r,i).externalId===videoId);if(!row)fail('video_not_found',404);
 if(row.transcript||row.content)fail('video_already_transcribed');
 if(row.transcriptState==='unknown')fail('video_retry_outcome_unknown');
 retryVideoSource(row);
 return row;
}
export function mergeVideoRetryRows(rows,results,videoId){
 const result=results.find(r=>normalizeMaterial(r).externalId===videoId);if(!result)fail('video_retry_result_missing');
 return rows.map(r=>normalizeMaterial(r).externalId===videoId?{...r,...result}:r);
}
export async function videoRetryRoute({req,res,url,db,json,body,saveDb,startStage,asrReady}){
 const match=url.pathname.match(/^\/api\/studio\/douyin\/tasks\/([^/]+)\/videos\/([^/]+)\/retry$/);if(req.method!=='POST'||!match)return false;
 const task=db.taskRuns.find(t=>t.id===match[1]&&t.taskKind==='douyin-collect');if(!task)fail('collection_task_not_found',404);
 const videoId=decodeURIComponent(match[2]),row=retryVideoRow(task,videoId);const input=await body(req);
 if(input.confirmPaid!==true)fail('asr_cost_confirmation_required');if(!asrReady)fail('asr_not_configured');
 if(task.state==='running'||task.workflow?.state==='running'||db.taskRuns.some(r=>r.jobId===task.id&&['running','unknown'].includes(r.state)))fail('source_processing_in_progress');
 const {stageRun}=await startStage(db,task,'asr',{videoId,refreshSource:true,sourceUrl:retryVideoSource(row)});json(res,202,stageRun);return true;
}
