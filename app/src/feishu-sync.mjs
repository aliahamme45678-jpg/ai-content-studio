import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { uid, hash } from './workflow.mjs';
import { normalizeMaterial } from './materials.mjs';

const binary=process.env.STUDIO_LARK_BINARY||join(process.env.APPDATA||'', 'npm/node_modules/@larksuite/cli/bin/lark-cli.exe');
const fail=(message,statusCode=409)=>{throw Object.assign(new Error(message),{statusCode});};
export function runLark(args,{cwd,write=false}={}){
  if(!existsSync(binary))fail('lark_cli_not_installed');
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{cwd,shell:false,windowsHide:true,env:{...process.env,LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'}});let out='',err='';
    const timeout=setTimeout(()=>{child.kill();reject(Object.assign(new Error(write?'feishu_write_outcome_unknown':'feishu_read_timeout'),{unknown:write}));},90000);timeout.unref();
    child.stdout.on('data',b=>{out+=b.toString('utf8');if(out.length>4000000)child.kill();});child.stderr.on('data',b=>{err+=b.toString('utf8');});
    child.on('error',e=>{clearTimeout(timeout);reject(e);});
    child.on('close',code=>{clearTimeout(timeout);let result;try{result=JSON.parse(out||err);}catch{return reject(Object.assign(new Error(write?'feishu_write_outcome_unknown':'feishu_invalid_response'),{unknown:write}));}
      if(code!==0||result.ok===false)return reject(Object.assign(new Error(result.error?.message||'feishu_request_failed'),{unknown:write&&code!==10&&result.error?.type!=='authorization'&&result.error?.type!=='validation'}));
      resolve(result.data||result);
    });
  });
}

export function sourceKey(value){try{const link=String(value||'').match(/https?:\/\/[^\s\]\[()<>"']+/)?.[0];if(!link)return '';const url=new URL(link);const douyin=['www.douyin.com','douyin.com','www.iesdouyin.com','iesdouyin.com'].includes(url.hostname);const video=douyin&&(url.pathname.match(/\/(?:video|slides|note)\/(\d+)/)?.[1]||url.searchParams.get('modal_id'));return video&&/^\d+$/.test(video)?`video:${video}`:`${url.hostname}${url.pathname}`;}catch{return '';}}
export function toFeishuRecord(row){
  const record={'标题':row.title,'原文 / 文案':row.transcript,'来源链接':row.url,'平台':['抖音']};
  if(row.author)record['作者']=row.author;
  for(const [field,key] of [['点赞数','diggCount'],['收藏数','collectCount'],['评论数','commentCount'],['转发数','shareCount']])if(typeof row[key]==='number'&&Number.isFinite(row[key]))record[field]=row[key];
  record['字数']=row.transcript.length;return record;
}

export async function feishuSyncRoute(ctx,call=runLark){
  const {req,res,url,db,json,body,saveDb,dataDir}=ctx;
  const respond=(status,data)=>{json(res,status,data);return true;};
  const configured=db.integration?.feishu;
  if(req.method==='GET'&&url.pathname==='/api/studio/integrations/feishu/status')return respond(200,{configured:Boolean(configured),available:existsSync(binary),target:configured||null});
  if(req.method==='POST'&&url.pathname==='/api/studio/integrations/feishu/connect'){
    const input=await body(req);let target;try{target=new URL(input.url);}catch{fail('invalid_feishu_base_url',400);}
    if(target.protocol!=='https:'||!target.hostname.endsWith('.feishu.cn')||!/^\/base\/[A-Za-z0-9]+\/?$/.test(target.pathname))fail('invalid_feishu_base_url',400);
    const baseToken=target.pathname.split('/')[2];const tableId=String(input.tableId||'');if(!/^tbl[A-Za-z0-9]+$/.test(tableId))fail('feishu_table_required',400);
    const tables=await call(['base','+table-list','--base-token',baseToken,'--as','user'],{cwd:dataDir});const table=tables.tables?.find(t=>t.id===tableId);if(!table)fail('feishu_table_not_found');
    const schema=await call(['base','+field-list','--base-token',baseToken,'--table-id',tableId,'--as','user'],{cwd:dataDir});
    for(const name of ['标题','原文 / 文案','来源链接'])if(!schema.fields?.some(f=>f.name===name&&f.type==='text'))fail('feishu_required_text_field_missing');
    const fields=schema.fields.filter(f=>['text','number','select'].includes(f.type)).map(f=>({name:f.name,type:f.type,options:f.options?.map(o=>o.name)}));
    db.integration||={};db.integration.feishu={baseToken,tableId,tableName:table.name,url:`${target.origin}/base/${baseToken}?table=${tableId}`,fields,connectedAt:new Date().toISOString()};
    await saveDb(db);return respond(200,{configured:true,target:db.integration.feishu});
  }
  const match=url.pathname.match(/^\/api\/studio\/douyin\/tasks\/([^/]+)\/feishu(?:-(preview))?$/);
  if(!match||!(req.method==='POST'&&!match[2]||req.method==='GET'&&match[2]))return false;
  if(!configured)fail('feishu_target_not_configured');
  const task=db.taskRuns.find(r=>r.id===match[1]&&r.taskKind==='douyin-collect');if(!task||task.state!=='succeeded')fail('collection_result_unavailable');
  if(db.taskRuns.some(r=>r.jobId===task.id&&r.taskKind!=='feishu-sync'&&['running','unknown'].includes(r.state)))fail('processing_stage_in_progress');
  const rows=task.rows.map(normalizeMaterial);const eligible=rows.filter(r=>r.transcript?.trim()&&sourceKey(r.url));
  if(!eligible.length)fail('transcript_and_source_required_before_sync');
  const unresolved=db.taskRuns.find(r=>r.taskKind==='feishu-sync'&&r.jobId===task.id&&['running','unknown'].includes(r.state));
  if(unresolved)fail(unresolved.state==='unknown'?'feishu_previous_write_needs_review':'feishu_sync_in_progress');
  const key=hash(JSON.stringify({target:configured.tableId,base:configured.baseToken,rows:eligible}));
  const prior=db.taskRuns.find(r=>r.taskKind==='feishu-sync'&&r.inputHash===key);
  if(prior?.state==='succeeded')return respond(200,{...prior,reused:true});
  if(prior&&['running','unknown'].includes(prior.state))fail(prior.state==='unknown'?'feishu_previous_write_needs_review':'feishu_sync_in_progress');
  await mkdir(join(dataDir,'feishu-sync'),{recursive:true});
  const file=`feishu-sync/links-${uid('read')}.ndjson`;
  const manifest=await call(['base','+record-list','--base-token',configured.baseToken,'--table-id',configured.tableId,'--field-id','来源链接','--format','ndjson','--output',file,'--as','user'],{cwd:dataDir});
  if(manifest.has_more)fail('feishu_table_exceeds_safe_dedup_limit');
  const known=new Set((await readFile(join(dataDir,file),'utf8')).trim().split('\n').filter(Boolean).map(l=>sourceKey(JSON.parse(l)['来源链接'])).filter(Boolean));
  const selected=eligible.filter(r=>{const k=sourceKey(r.url);if(known.has(k))return false;known.add(k);return true;});
  const summary={inputHash:key,target:configured.url,tableName:configured.tableName,total:rows.length,ready:eligible.length,create:selected.length,skipExisting:eligible.length-selected.length,skipWithoutText:rows.length-eligible.length};
  if(match[2])return respond(200,summary);
  const input=await body(req);if(input.confirmed!==true)fail('confirm_feishu_sync_first',400);
  if(input.inputHash&&input.inputHash!==key)fail('collection_changed_review_sync_again');
  const run={id:uid('run'),jobId:task.id,taskKind:'feishu-sync',state:'running',inputHash:key,summary,recordIds:[],startedAt:new Date().toISOString()};db.taskRuns.unshift(run);await saveDb(db);
  try{
    for(let i=0;i<selected.length;i+=100){
      const create_records=selected.slice(i,i+100).map(row=>Object.fromEntries(Object.entries(toFeishuRecord(row)).filter(([name,value])=>configured.fields.some(f=>f.name===name&&(name!=='平台'||f.options?.includes('抖音'))))));
      run.awaitingResponse=true;await saveDb(db);
      const result=await call(['base','+record-batch-create','--base-token',configured.baseToken,'--table-id',configured.tableId,'--json',JSON.stringify({create_records}),'--as','user'],{cwd:dataDir,write:true});
      if(!Array.isArray(result.record_id_list)||result.record_id_list.length!==create_records.length)throw Object.assign(new Error('feishu_write_receipt_incomplete'),{unknown:true});
      run.recordIds.push(...result.record_id_list);run.awaitingResponse=false;await saveDb(db);
    }
    run.state='succeeded';run.finishedAt=new Date().toISOString();await saveDb(db);return respond(200,run);
  }catch(error){run.state=error.unknown?'unknown':'failed';run.error=error.message;run.finishedAt=new Date().toISOString();await saveDb(db);return respond(502,{error:run.state==='unknown'?'feishu_write_outcome_unknown':'feishu_sync_failed',detail:error.message,runId:run.id});}
}
