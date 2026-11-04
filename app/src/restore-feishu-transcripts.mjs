import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { uid } from './workflow.mjs';
import { runLark } from './feishu-sync.mjs';
import { sourceMutationBlocked } from './task-state.mjs';

export function sourceVideoId(value){
  for(const match of String(value||'').matchAll(/https?:\/\/[^\s\]\[()<>"']+/g)){
    try{const url=new URL(match[0]);if(!['www.douyin.com','douyin.com','v.douyin.com','www.iesdouyin.com','iesdouyin.com'].includes(url.hostname))continue;const id=url.pathname.match(/\/(?:video|slides|note)\/(\d+)/)?.[1]||url.searchParams.get('modal_id');if(id&&/^\d+$/.test(id))return id;}catch{}
  }
  return null;
}

export async function restoreFeishuTranscripts({db,task,dataDir,call=runLark}){
  const target=db.integration?.feishu;if(!target)throw Object.assign(new Error('feishu_target_not_configured'),{statusCode:409});
  const author=task.rows.find(r=>r.author_name||r.author)?.author_name||task.rows.find(r=>r.author)?.author;
  if(!author)throw Object.assign(new Error('account_author_missing'),{statusCode:409});
  const busy=()=>db.taskRuns.some(r=>sourceMutationBlocked(r,task.id));
  if(busy())throw Object.assign(new Error('stop_or_review_running_analysis_before_edit'),{statusCode:409});
  await mkdir(join(dataDir,'feishu-restore'),{recursive:true});let offset=0;const records=[];
  for(let page=0;page<50;page++){
    const file=`feishu-restore/${uid('source')}.ndjson`;
    const args=['base','+record-list','--base-token',target.baseToken,'--table-id',target.tableId,'--filter-json',JSON.stringify({logic:'and',conditions:[['作者','==',author]]}),'--field-id','作者','--field-id','标题','--field-id','来源链接','--field-id','原文 / 文案','--format','ndjson','--output',file,'--offset',String(offset),'--as','user'];
    const manifest=await call(args,{cwd:dataDir});
    records.push(...(await readFile(join(dataDir,file),'utf8')).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)));
    if(!manifest.has_more)break;
    if(!Number.isInteger(manifest.next_offset)||manifest.next_offset<=offset||page===49)throw new Error('feishu_restore_incomplete_pagination');offset=manifest.next_offset;
  }
  const byId=new Map(),ambiguous=new Set();
  for(const record of records){if(record['作者']!==author||!String(record['原文 / 文案']||'').trim())continue;const id=sourceVideoId(record['来源链接']);if(!id)continue;const prior=byId.get(id);if(prior&&String(prior['原文 / 文案']).trim()!==String(record['原文 / 文案']).trim())ambiguous.add(id);else byId.set(id,record);}
  if(busy())throw Object.assign(new Error('stop_or_review_running_analysis_before_edit'),{statusCode:409});
  let restored=0,alreadyPresent=0,notMatched=0,ambiguousCount=0;
  for(const row of task.rows){if(String(row.transcript||row.content||'').trim()){alreadyPresent++;continue;}const id=String(row.externalId||row.aweme_id||sourceVideoId(row.url)||'');if(ambiguous.has(id)){ambiguousCount++;continue;}const record=byId.get(id);if(!record){notMatched++;continue;}row.transcript=row.content=String(record['原文 / 文案']).trim();row.transcriptState='feishu-restored';row.transcriptSource={recordId:record.record_id,baseToken:target.baseToken,tableId:target.tableId,restoredAt:new Date().toISOString()};restored++;}
  return {author,sourceRecords:records.length,restored,alreadyPresent,notMatched,ambiguous:ambiguousCount};
}
