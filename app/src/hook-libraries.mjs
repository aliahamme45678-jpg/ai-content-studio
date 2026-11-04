import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {runLark} from './feishu-sync.mjs';
export const defaultHookUrl='https://hcngrs2jw5fb.feishu.cn/base/IjbBblKh0amzztsiExVc1PqInfd?table=tblHnYTy58LoJEEw&view=vew2bAcuTZ';
const digest=s=>createHash('sha256').update(String(s)).digest('hex');
const fail=(message,statusCode=422)=>{throw Object.assign(new Error(message),{statusCode});};
export function ensureHookLibraries(db){db.hookLibraries||=[{id:'hook-default-feishu',name:'黄金三秒开头库',kind:'feishu',url:defaultHookUrl,status:'unread',entries:[],createdAt:new Date().toISOString()}];}
export function publicHookLibraries(db){return (db.hookLibraries||[]).filter(x=>!x.deletedAt).map(({entries,markdown,...x})=>({...x,count:entries?.length||0}));}
export function hookLink(value){let url;try{url=new URL(value);}catch{}const base=url?.pathname.match(/^\/base\/([A-Za-z0-9]+)\/?$/)?.[1],table=url?.searchParams.get('table'),view=url?.searchParams.get('view');if(!base||!table||!/^tbl[A-Za-z0-9]+$/.test(table)||view&&!/^vew[A-Za-z0-9]+$/.test(view)||url.protocol!=='https:'||!/(^|\.)(feishu\.cn|larksuite\.com)$/.test(url.hostname)||url.username||url.password||url.port)fail('invalid_feishu_link',400);return {base,table,view,url:url.href};}
export function cellText(value){if(value==null)return '';if(typeof value==='string'||typeof value==='number')return String(value);if(Array.isArray(value))return value.map(cellText).filter(Boolean).join('\n');if(typeof value==='object')return value.text!==undefined?cellText(value.text):value.name!==undefined?cellText(value.name):value.value!==undefined?cellText(value.value):JSON.stringify(value);return String(value);}
export function hookEntries(rows){return rows.map((row,index)=>{
 const fields=row.fields||Object.fromEntries(Object.entries(row).filter(([k])=>k!=='record_id'));const texts=Object.entries(fields).map(([key,value])=>[key,cellText(value)]).filter(([,v])=>v.trim());
 const priority=['典型原句','开头原文','开头示例','开头文案','黄金三秒','原文','正文','文案','opening','content','text'];let selected;
 for(const name of priority){selected=texts.find(([key])=>key===name);if(selected)break;}
 selected||=texts.filter(([k])=>/示例|例句|开头文本|original|example/i.test(k)).sort((a,b)=>b[1].length-a[1].length)[0];selected||=texts.filter(([k])=>!/id$|record_id/i.test(k)).sort((a,b)=>b[1].length-a[1].length)[0];
 return {id:String(row.record_id||'row-'+index),text:selected?.[1]||JSON.stringify(fields),type:texts.filter(([k])=>/类型|分类|开头机制|type|category/i.test(k)).map(([,v])=>v).join(' · '),fields};
});}
export function markdownHooks(text){if(typeof text!=='string'||!text.trim()||text.length>200000)fail('invalid_markdown_file',400);let heading='',parts=[],blocks=[];const flush=()=>{if(parts.length){blocks.push({heading,text:parts.join('\n')});parts=[];}};for(const line of text.split(/\r?\n/)){if(/^#{1,6}\s/.test(line)){flush();heading=line.replace(/^#+\s*/, '');}parts.push(line);}flush();if(!blocks.length)blocks=[{heading:'',text}];return blocks.map((b,i)=>({id:'md-'+digest(i+'\n'+b.text).slice(0,18),text:b.text,type:b.heading,fields:{标题:b.heading,原始内容:b.text}}));}
export async function refreshHookLibrary({db,library,saveDb,dataDir,call=runLark}){
 try{
  let entries;
  if(library.kind==='markdown')entries=markdownHooks(library.markdown);
  else{
   const {base,table,view}=hookLink(library.url);const schema=await call(['base','+field-list','--base-token',base,'--table-id',table,'--as','user'],{cwd:dataDir});const fields=schema.fields||[];if(!fields.length)fail('feishu_table_no_fields');await mkdir(join(dataDir,'hook-imports'),{recursive:true});let rows=[],offset=0;
   for(let page=0;page<100;page++){
    const output='hook-imports/'+randomUUID()+'.ndjson';const result=await call(['base','+record-list','--base-token',base,'--table-id',table,...(view?['--view-id',view]:[]),...fields.flatMap(f=>['--field-id',f.id||f.name]),'--format','ndjson','--output',output,'--limit','500','--offset',String(offset),'--as','user'],{cwd:dataDir});const pageRows=(await readFile(join(dataDir,output),'utf8')).split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s));rows.push(...pageRows);if(!result.has_more)break;if(!Number.isInteger(result.next_offset)||result.next_offset<=offset||page===99)fail('feishu_pagination_incomplete');offset=result.next_offset;
   }
   entries=hookEntries(rows);
  }
  if(!entries.length)fail('hook_library_empty');Object.assign(library,{entries,status:'ready',lastReadAt:new Date().toISOString(),contentHash:digest(JSON.stringify(entries))});delete library.error;await saveDb(db);return entries;
 }catch(error){library.status='error';library.error=error.message;await saveDb(db);throw Object.assign(new Error('黄金三秒库「'+library.name+'」读取失败：'+error.message),{statusCode:422});}
}
export async function hookLibraryRoutes({req,res,url,db,json,body,saveDb,dataDir},call=runLark){
 if(!url.pathname.startsWith('/api/studio/hook-libraries'))return false;ensureHookLibraries(db);
 const match=url.pathname.match(/^\/api\/studio\/hook-libraries(?:\/([^/]+)(?:\/(refresh|delete))?)?$/);if(!match)return false;const id=match[1],action=match[2];const library=id&&db.hookLibraries.find(x=>x.id===id&&!x.deletedAt);
 if(id&&!library){json(res,404,{error:'hook_library_not_found',detail:'黄金三秒素材库不存在或已删除。'});return true;}
 if(req.method==='GET'){json(res,200,id?library:publicHookLibraries(db));return true;}
 if(req.method!=='POST')return false;
 if(id&&action!=='refresh'&&db.taskRuns?.some(r=>r.state==='running'&&r.taskKind==='generate'&&db.jobs?.some(j=>j.id===r.jobId&&j.hookLibraryIds?.includes(id))))fail('hook_library_in_use',409);
 if(action==='delete'){library.deletedAt=new Date().toISOString();await saveDb(db);json(res,200,{deleted:true});return true;}
 if(action==='refresh'){await refreshHookLibrary({db,library,saveDb,dataDir,call});json(res,200,publicHookLibraries(db).find(x=>x.id===id));return true;}
 const input=await body(req);const name=String(input.name||'').trim(),kind=input.kind;if(!name||name.length>120||!['feishu','markdown'].includes(kind))fail('hook_library_name_and_kind_required',400);const next={...library,id:library?.id||'hook-'+randomUUID(),name,kind,createdAt:library?.createdAt||new Date().toISOString()};if(kind==='feishu'){next.url=hookLink(input.url).url;delete next.markdown;}else{next.markdown=input.text??(library?.kind==='markdown'?library.markdown:'');markdownHooks(next.markdown);next.fileName=input.fileName||library?.fileName||'素材.md';delete next.url;}
 await refreshHookLibrary({db,library:next,saveDb:async()=>{},dataDir,call});if(library)Object.assign(library,next);else db.hookLibraries.push(next);await saveDb(db);json(res,library?200:201,publicHookLibraries(db).find(x=>x.id===next.id));return true;
}
