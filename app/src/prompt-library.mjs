import {uid,auditSkills} from './workflow.mjs';
import {invalidateAudit} from './audit.mjs';
export const promptCategories=['writing','style','other','topic'];
export async function promptLibraryRoute({req,res,url,db,json,body,saveDb}){
 const change=url.pathname.match(/^\/api\/studio\/prompt-library\/([^/]+)\/(delete|restore)$/);
 if(req.method==='POST'&&change){const t=db.templates.find(t=>t.id===change[1]);if(!t){json(res,404,{error:'template_not_found'});return true;}t.active=change[2]==='restore';if(t.active)delete t.deletedAt;else t.deletedAt=new Date().toISOString();await saveDb(db);json(res,200,{success:true});return true;}
 if(req.method==='POST'&&url.pathname==='/api/studio/prompt-library'){
 const input=await body(req);const name=String(input.name||'').trim(),prompt=String(input.prompt||'').trim();if(!name||name.length>120||!prompt||prompt.length>30000||!promptCategories.includes(input.category)){json(res,400,{error:'prompt_name_and_content_required'});return true;}
 const previous=input.id&&db.templates.find(t=>t.id===input.id);if(input.id&&!previous){json(res,404,{error:'template_not_found'});return true;}
 // 模板可绑定知识库（飞书素材库、Markdown 素材库都存为 knowledgeSets）；未传则沿用上一版，编辑不丢绑定
 const rawSets=input.knowledgeSetIds;
 if(rawSets!==undefined&&(!Array.isArray(rawSets)||rawSets.length>200||rawSets.some(id=>typeof id!=='string'))){json(res,400,{error:'invalid_knowledge_set_ids'});return true;}
 const knowledgeSetIds=rawSets===undefined?(previous?.knowledgeSetIds||[]):[...new Set(rawSets)];
 if(knowledgeSetIds.some(id=>!db.knowledgeSets?.some(set=>set.id===id&&!set.deletedAt))){json(res,400,{error:'knowledge_set_not_found'});return true;}
 const template={id:uid('tpl'),name,prompt,promptCategory:input.category,promptOnly:true,active:true,platform:input.category==='other'?'X':'通用',kind:previous?.kind||'视频口播',version:'v'+((Number(String(previous?.version||'v0').slice(1))||0)+1),previousVersionId:previous?.id||null,...(input.category==='style'&&previous?.distillationRunId?{distillationRunId:previous.distillationRunId}:{}),createdAt:new Date().toISOString(),rules:[],bindings:previous?.bindings??[],knowledgeSetIds};if(previous)previous.active=false;db.templates.unshift(template);await saveDb(db);json(res,201,template);return true;
 }
 if(url.pathname!=='/api/studio/audit-config')return false;
 const current=db.integration?.auditConfig||{skills:['dbs-ai-check','dbs-content-risk-check']};
 if(req.method==='GET'){json(res,200,current);return true;}
 if(req.method!=='POST')return false;const input=await body(req);if(!Array.isArray(input.skills)||input.skills.some(s=>!auditSkills.includes(s)||s==='dbs-spread')){json(res,400,{error:'invalid_audit_skill'});return true;}
 if(db.taskRuns.some(r=>r.state==='running'&&['model-audit','audit-revision'].includes(r.taskKind))){json(res,409,{error:'audit_in_progress'});return true;}
 const skills=[...new Set(input.skills)];db.integration||={};db.integration.auditConfig={skills};for(const job of db.jobs){if(['已发布','已取消','已定稿'].includes(job.status))continue;job.auditSkills=skills;job.auditEngine='model';invalidateAudit(db,job.id);if(['待人工确认','已审核'].includes(job.status))job.status='草稿';}await saveDb(db);json(res,200,db.integration.auditConfig);return true;
}
