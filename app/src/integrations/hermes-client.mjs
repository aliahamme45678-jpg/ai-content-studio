import { existsSync } from 'node:fs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
function readLocalConfig() {
  const primary=path.join(process.env.STUDIO_DATA_DIR || path.resolve(import.meta.dirname,'../../data'),'hermes.env');
  const file=existsSync(primary)?primary:path.resolve(import.meta.dirname,'../../.runtime-data/hermes.env');
  if(!existsSync(file))return {};
  return Object.fromEntries(readFileSync(file,'utf8').split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>{const index=line.indexOf('=');return index<0?[line,'']:[line.slice(0,index),line.slice(index+1)];}));
}
function config() {
  const localConfig=readLocalConfig();
  return { serviceUrl:process.env.HERMES_SERVICE_URL || localConfig.HERMES_SERVICE_URL || '', baseUrl: String(process.env.HERMES_API_URL || localConfig.HERMES_API_URL || '').replace(/\/[^/]*$/, ''), endpoint: process.env.HERMES_API_URL || localConfig.HERMES_API_URL || '', key: process.env.HERMES_API_KEY || localConfig.HERMES_API_KEY || '', model: process.env.HERMES_MODEL || localConfig.HERMES_MODEL || '', memoryRoot: process.env.MEMORY_ROOT || localConfig.MEMORY_ROOT || '', materialPath: process.env.MATERIAL_PATH || localConfig.MATERIAL_PATH || '' };
}
export async function hermesStatus() {
  const cfg=config();
  if(cfg.serviceUrl){try{const r=await fetch(`${cfg.serviceUrl.replace(/\/$/,'')}/api/config`,{signal:AbortSignal.timeout(2000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);const value=await r.json();return {configured:true,connected:true,mode:value.hermesConfigured&&value.studioBridge?'ready':'incomplete',transport:'native-service',endpoint:cfg.serviceUrl,serviceUrl:cfg.serviceUrl,model:value.model,detail:value.studioBridge?'Hermes 原生写作引擎；使用 Studio 所选模板与知识库':'请使用项目 run-hermes.mjs 启动原生服务',missing:value.hermesConfigured&&value.studioBridge?[]:['Hermes Studio bridge / model']};}catch(error){return {configured:true,connected:false,mode:'unreachable',transport:'native-service',endpoint:cfg.serviceUrl,detail:error.message,missing:['Hermes service']};}}
  if(!cfg.endpoint)return {configured:false,connected:false,mode:'not_configured',detail:'HERMES_API_URL 未配置'};
  const memoryRoot=cfg.memoryRoot;const materialPath=cfg.materialPath;
  const memoryReady=Boolean(memoryRoot)&&existsSync(memoryRoot);const materialReady=Boolean(materialPath)&&existsSync(materialPath);const ready=Boolean(cfg.key&&cfg.model&&memoryReady&&materialReady);
  return {configured:true,connected:false,mode:ready?'ready':'incomplete',endpoint:cfg.endpoint,transport:'model-gateway',model:cfg.model,hasKey:Boolean(cfg.key),memoryConfigured:memoryReady,materialConfigured:materialReady,memoryRootConfigured:Boolean(memoryRoot),materialPathConfigured:Boolean(materialPath),missing:[!cfg.key?'HERMES_API_KEY':null,!cfg.model?'HERMES_MODEL':null,!memoryReady?'MEMORY_ROOT':null,!materialReady?'MATERIAL_PATH':null].filter(Boolean),detail:ready?'配置完整，首次生成时检查服务连通性':'配置不完整，缺少本地素材或记忆路径'};
}
export async function hermesGenerate(input) {
  const cfg=config();
  const native=Boolean(cfg.serviceUrl);if(!native&&(!cfg.endpoint||!cfg.key||!cfg.model))throw new Error('hermes_not_configured');
  const endpoint=native?`${cfg.serviceUrl.replace(/\/$/,'')}/api/studio-copywriting`:cfg.endpoint;
  const headers={'content-type':'application/json'};if(!native)headers.authorization=`Bearer ${cfg.key}`;
  const request=native?{system:input.system,user:input.user,mode:input.mode||'topic'}:{model:cfg.model,messages:[{role:'system',content:input.system||'只输出完整正文，不输出提示词。'},{role:'user',content:input.user}],temperature:input.temperature??0.3,max_tokens:input.maxTokens??2000};
  let payload;
  try{
    const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(request),signal:AbortSignal.timeout(input.timeoutMs??250000)});
    payload=await response.json();if(!response.ok)throw Object.assign(new Error(`hermes_http_${response.status}`),{outcomeUnknown:response.status>=500});
  }catch(error){if(error.outcomeUnknown===undefined)error.outcomeUnknown=true;throw error;}
  let content=payload.choices?.[0]?.message?.content||payload.final_copy_text||payload.output||payload.text||'';
  const raw=content;let generatedTitle;
  try{const object=JSON.parse(content.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));if(typeof object.body==='string')content=object.body;if(typeof object.title==='string')generatedTitle=object.title;}catch{}
  if(payload.mode==='draft'||!content||/^(?:\s*prompt|提示词|draft:|mode:\s*draft|素材不足)/i.test(content)||content.length<20)throw Object.assign(new Error('hermes_output_not_a_generated_draft'),{outcomeUnknown:false,rawResponse:raw});
  return {title:generatedTitle,body:content,model:payload.model||cfg.model||'hermes-native',usage:payload.usage||null,rawResponse:raw,transport:native?'native-service':'model-gateway'};
}

export async function hermesHealth() {
  const cfg = config();
  const status = await hermesStatus();
  if(cfg.serviceUrl)return {...status,health:status.connected?'ok':'unreachable',service:'Hermes native',healthError:status.connected?null:status.detail};
  if (!cfg.endpoint) return { ...status, connected: false, health: 'not_configured' };
  const origin = cfg.endpoint.replace(/\/v1\/chat\/completions\/?$/i, '').replace(/\/chat\/completions\/?$/i, '');
  const candidates = [`${origin}/api/config`, `${origin}/health`, `${origin}/api/health`];
  let lastError = null;
  for (const url of candidates) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) { lastError = `HTTP ${response.status}`; continue; }
      const body = await response.json().catch(() => ({}));
      return { ...status, connected: true, health: 'ok', healthUrl: url, service: body.service || body.name || 'Hermes' };
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
  }
  return { ...status, connected: false, health: 'unreachable', healthError: lastError || 'health endpoint unavailable' };
}

export async function hermesCapability() {
  const status=await hermesStatus();
  return { ...status, modes:[
    {id:'topic-copywriting',label:'话题生文',ready:status.mode==='ready',requires:['HERMES_API_URL','HERMES_API_KEY','HERMES_MODEL','MATERIAL_PATH','MEMORY_ROOT']},
    {id:'rewrite',label:'原稿改写',ready:status.mode==='ready',requires:['HERMES_API_URL','HERMES_API_KEY','HERMES_MODEL','MATERIAL_PATH','MEMORY_ROOT']},
    {id:'section',label:'局部重构',ready:status.mode==='ready',requires:['HERMES_API_URL','HERMES_API_KEY','HERMES_MODEL']},
  ]};
}

export function saveHermesConfig(input){
  const existing=readLocalConfig();
  const mapping={apiUrl:'HERMES_API_URL',apiKey:'HERMES_API_KEY',model:'HERMES_MODEL',memoryRoot:'MEMORY_ROOT',materialPath:'MATERIAL_PATH',serviceUrl:'HERMES_SERVICE_URL'};
  for(const [key,env] of Object.entries(mapping)){if(input[key]===undefined||String(input[key]).trim()==='')continue;const value=String(input[key]).trim();if(/[\r\n]/.test(value))throw Object.assign(new Error('invalid_config_newline'),{statusCode:400});existing[env]=value;}
  if(existing.HERMES_SERVICE_URL){const url=new URL(existing.HERMES_SERVICE_URL);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||!['http:','https:'].includes(url.protocol))throw Object.assign(new Error('hermes_service_must_be_local'),{statusCode:400});}
  const dir=process.env.STUDIO_DATA_DIR||path.resolve(import.meta.dirname,'../../data');mkdirSync(dir,{recursive:true});
  writeFileSync(path.join(dir,'hermes.env'),Object.entries(existing).map(([key,value])=>`${key}=${value}`).join('\n')+'\n','utf8');
}
