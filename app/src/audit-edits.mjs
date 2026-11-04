import {parseStructuredOutput} from './structured-output.mjs';

const fail=code=>{throw Error(code)};
export function auditEditGroups(text,issues){
 const patches=issues.map(issue=>{
  const start=Number.isInteger(issue.location?.start)?issue.location.start:text.indexOf(issue.quote);
  if(start<0||text.slice(start,start+issue.quote.length)!==issue.quote)fail('revision_review_changed');
  return {id:issue.id,start,end:start+issue.quote.length,quote:issue.quote,replacement:issue.replacement,reason:issue.explanation,suggestion:issue.suggestion};
 }).sort((a,b)=>a.start-b.start||b.end-a.end);
 const groups=[];
 for(const patch of patches){let group=groups.at(-1);if(!group||patch.start>=group.end){group={id:'g'+groups.length,start:patch.start,end:patch.end,issues:[]};groups.push(group);}group.end=Math.max(group.end,patch.end);group.issues.push(patch);}
 return groups.map(group=>({...group,original:text.slice(group.start,group.end),...(group.issues.length===1&&typeof group.issues[0].replacement==='string'?{replacement:group.issues[0].replacement}:{})}));
}
export function applyAuditEdits(text,groups){
 let body=text;for(const group of [...groups].reverse()){if(typeof group.replacement!=='string'||group.replacement.length>20000)fail('revision_edits_incomplete');body=body.slice(0,group.start)+group.replacement+body.slice(group.end);}return body;
}
export function parseAuditEdits(raw,text,groups){
 return parseStructuredOutput(raw,value=>{
  const pending=groups.filter(group=>typeof group.replacement!=='string');
  if(Array.isArray(value.edits)){
   if(value.edits.length!==pending.length||new Set(value.edits.map(e=>e.groupId)).size!==pending.length)fail('revision_edits_incomplete');
   for(const edit of value.edits)if(!pending.some(g=>g.id===edit.groupId)||typeof edit.replacement!=='string'||edit.replacement.length>20000)fail('revision_edits_incomplete');
   const completed=groups.map(group=>({...group,replacement:group.replacement??value.edits.find(e=>e.groupId===group.id)?.replacement}));
   return {body:applyAuditEdits(text,completed),corePoint:String(value.corePoint||'仅修改已勾选的原句'),needsVerification:Array.isArray(value.needsVerification)?value.needsVerification:[],edits:completed};
  }
  // Accept legacy single-span replies only when all text outside that selected span is byte-for-byte unchanged.
  if(typeof value.body==='string'&&groups.length===1){const group=groups[0],prefix=text.slice(0,group.start),suffix=text.slice(group.end);if(value.body.startsWith(prefix)&&value.body.endsWith(suffix)&&value.body.length>=prefix.length+suffix.length){const replacement=value.body.slice(prefix.length,suffix.length?-suffix.length:undefined);return {...value,body:applyAuditEdits(text,[{...group,replacement}]),edits:[{...group,replacement}]};}}
  fail('revision_outside_selected_issues');
 });
}
