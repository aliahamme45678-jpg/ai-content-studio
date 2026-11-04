export function reuseCollectionTranscripts(task,tasks){
 const candidates=new Map();
 for(const previous of tasks){
  if(previous.id===task.id||previous.taskKind!=='douyin-collect')continue;
  for(const row of previous.rows||[]){const key=String(row.externalId||row.aweme_id||'');const text=String(row.transcript||row.content||'').trim();
   if(key&&text&&!candidates.has(key)&&!['unknown','failed'].includes(row.transcriptState))candidates.set(key,{row,taskId:previous.id,text});
  }
 }
 let reused=0;
 for(const row of task.rows||[]){if(String(row.transcript||row.content||'').trim())continue;const candidate=candidates.get(String(row.externalId||row.aweme_id||''));if(!candidate)continue;
  row.transcript=row.content=candidate.text;row.transcriptState='reused';row.transcriptSourceTaskId=candidate.taskId;reused++;
 }
 return {reused};
}
