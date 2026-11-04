import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
let cachedStore={profiles:[],assignments:{}};
export const modelPurposes=['writing','intelligence','audit','analysis','distill'];
export function modelEnv(purpose='writing'){const assigned=cachedStore.assignments?.[purpose];const profileId=assigned===''?null:(assigned||cachedStore.activeId);const p=profileId?cachedStore.profiles.find(p=>p.id===profileId):null;return p?{...process.env,LLM_BASE_URL:p.baseUrl,LLM_API_KEY:p.apiKey,LLM_MODEL:p.model,LLM_WIRE_API:p.wireApi||'chat'}:process.env;}
export async function loadModelProfiles(dataDir){
 try{const store=JSON.parse(await readFile(join(dataDir,'model-profiles.json'),'utf8'));const active=store.profiles.find(p=>p.id===store.activeId);if(active)activate(active);store.assignments||={};cachedStore=store;return store;}catch(error){if(error.code!=='ENOENT')throw error;cachedStore={activeId:null,profiles:[],assignments:{}};return cachedStore;}
}
function activate(p){Object.assign(process.env,{LLM_BASE_URL:p.baseUrl,LLM_API_KEY:p.apiKey,LLM_MODEL:p.model,MODEL_CALLS_ENABLED:'true',LLM_WIRE_API:p.wireApi||'chat'});}
export async function modelProfilesRoute({req,res,url,json,body,dataDir,db}){
 if(url.pathname!=='/api/studio/models/config')return false;
 const store=await loadModelProfiles(dataDir);
 const publicStore=()=>({...store,profiles:store.profiles.map(({apiKey,...p})=>({...p,keyConfigured:Boolean(apiKey)})),currentModel:process.env.LLM_MODEL||'',currentBaseUrl:process.env.LLM_BASE_URL||''});
 if(req.method==='GET'){json(res,200,publicStore());return true;}
 if(req.method!=='POST')return false;
 if(db.taskRuns.some(r=>r.state==='running'&&(r.model||r.awaitingResponse))){json(res,409,{error:'model_configuration_busy'});return true;}
 const input=await body(req);let profile;if(input.purposes&&(!Array.isArray(input.purposes)||input.purposes.some(p=>!modelPurposes.includes(p)))){json(res,400,{error:'invalid_model_assignment'});return true;}
 if(input.assignments){
 if(Object.keys(input.assignments).some(k=>!modelPurposes.includes(k))||Object.values(input.assignments).some(id=>id!==''&&!store.profiles.some(p=>p.id===id))){json(res,400,{error:'invalid_model_assignment'});return true;}
 store.assignments={...store.assignments,...input.assignments};
 }else if(input.activateId){profile=store.profiles.find(p=>p.id===input.activateId);if(!profile){json(res,404,{error:'model_profile_not_found'});return true;}}
 else{
  let endpoint;try{endpoint=new URL(input.baseUrl);}catch{}
  if(!endpoint||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!(endpoint.protocol==='https:'||endpoint.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))){json(res,400,{error:'invalid_model_endpoint'});return true;}
  const old=store.profiles.find(p=>p.id===input.id);
  profile={id:old?.id||randomUUID(),name:String(input.name||'').trim(),model:String(input.model||'').trim(),baseUrl:endpoint.href.replace(/\/$/,''),apiKey:input.apiKey||old?.apiKey||'',wireApi:input.wireApi||old?.wireApi||'chat'};
  if(!['chat','responses'].includes(profile.wireApi)){json(res,400,{error:'invalid_model_wire_api'});return true;}
  if(!profile.name||!profile.model||!profile.apiKey||[profile.name,profile.model,profile.apiKey].some(v=>typeof v!=='string'||/[\r\n]/.test(v)||v.length>4096)){json(res,400,{error:'model_name_endpoint_key_required'});return true;}
  store.profiles=store.profiles.filter(p=>p.id!==profile.id);store.profiles.push(profile);
 }
 if(profile&&input.purposes){for(const purpose of modelPurposes){if(input.purposes.includes(purpose))store.assignments[purpose]=profile.id;else if(store.assignments[purpose]===profile.id)store.assignments[purpose]='';}}
 if(profile){process.env.MODEL_CALLS_ENABLED='true';if(input.purpose&&modelPurposes.includes(input.purpose))store.assignments[input.purpose]=profile.id;else if(!input.saveOnly)store.activeId=profile.id;}cachedStore=store;const file=join(dataDir,'model-profiles.json');await writeFile(file+'.tmp',JSON.stringify(store),'utf8');await rename(file+'.tmp',file);if(profile&&!input.purpose&&!input.saveOnly)activate(profile);
 json(res,200,{...publicStore(),savedId:profile?.id});return true;
}
export async function ensureDefaultModelProfile(dataDir){
 const store=await loadModelProfiles(dataDir);if(store.profiles.length||!process.env.LLM_BASE_URL||!process.env.LLM_API_KEY||!process.env.LLM_MODEL)return;
 const profile={id:randomUUID(),name:'现有 API',model:process.env.LLM_MODEL,baseUrl:process.env.LLM_BASE_URL.replace(/\/$/,''),apiKey:process.env.LLM_API_KEY};store.profiles.push(profile);store.activeId=profile.id;const file=join(dataDir,'model-profiles.json');await writeFile(file+'.tmp',JSON.stringify(store),'utf8');await rename(file+'.tmp',file);cachedStore=store;
}

export function modelWireApi(baseUrl,model){const profile=cachedStore.profiles.find(p=>p.baseUrl.replace(/\/$/,'')===baseUrl.replace(/\/$/,'')&&p.model===model);return profile?.wireApi||((process.env.LLM_BASE_URL||'').replace(/\/$/,'')===baseUrl.replace(/\/$/,'')&&process.env.LLM_MODEL===model?process.env.LLM_WIRE_API:'chat')||'chat';}
