import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
function readLocalConfig() {
  const file = path.resolve(import.meta.dirname, '../../.runtime-data/hermes.env');
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).filter(line=>line && !line.startsWith('#')).map(line=>{const index=line.indexOf('=');return index<0?[line,'']:[line.slice(0,index),line.slice(index+1)];}));
}
function config() {
  const localConfig=readLocalConfig();
  return { baseUrl: String(process.env.HERMES_API_URL || localConfig.HERMES_API_URL || '').replace(/\/[^/]*$/, ''), endpoint: process.env.HERMES_API_URL || localConfig.HERMES_API_URL || '', key: process.env.HERMES_API_KEY || localConfig.HERMES_API_KEY || '', model: process.env.HERMES_MODEL || localConfig.HERMES_MODEL || '', memoryRoot: process.env.MEMORY_ROOT || localConfig.MEMORY_ROOT || '', materialPath: process.env.MATERIAL_PATH || localConfig.MATERIAL_PATH || '' };
}
export async function hermesStatus() {
  const cfg=config();
  if(!cfg.endpoint)return {configured:false,connected:false,mode:'not_configured',detail:'HERMES_API_URL 未配置'};
  const memoryRoot=process.env.MEMORY_ROOT||'';const materialPath=process.env.MATERIAL_PATH||'';
  const memoryReady=Boolean(memoryRoot)&&existsSync(memoryRoot);const materialReady=Boolean(materialPath)&&existsSync(materialPath);const ready=Boolean(cfg.key&&cfg.model&&memoryReady&&materialReady);
  return {configured:true,connected:false,mode:ready?'ready':'incomplete',endpoint:cfg.endpoint.replace(/\/[^/]*$/,'/…'),model:cfg.model,hasKey:Boolean(cfg.key),memoryConfigured:memoryReady,materialConfigured:materialReady,memoryRootConfigured:Boolean(memoryRoot),materialPathConfigured:Boolean(materialPath),missing:[!cfg.key?'HERMES_API_KEY':null,!cfg.model?'HERMES_MODEL':null,!memoryReady?'MEMORY_ROOT':null,!materialReady?'MATERIAL_PATH':null].filter(Boolean),detail:ready?'配置完整，首次生成时检查服务连通性':'配置不完整，缺少本地素材或记忆路径'};
}
export async function hermesGenerate(input) {
  const cfg=config(); if(!cfg.endpoint||!cfg.key||!cfg.model)throw new Error('hermes_not_configured');
  const response=await fetch(cfg.endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${cfg.key}`},body:JSON.stringify({model:cfg.model,messages:[{role:'system',content:input.system||'只输出完整正文，不输出提示词。'},{role:'user',content:input.user}],temperature:input.temperature??0.3,max_tokens:input.maxTokens??2000}),signal:AbortSignal.timeout(input.timeoutMs??120000)});
  const payload=await response.json();if(!response.ok)throw new Error(`hermes_http_${response.status}`);
  const content=payload.choices?.[0]?.message?.content||payload.final_copy_text||payload.text||'';
  if(!content||/^(?:\s*prompt|提示词|draft:|mode:\s*draft)/i.test(content)||content.length<20)throw new Error('hermes_output_not_a_generated_draft');
  return {body:content,model:cfg.model,usage:payload.usage||null};
}

export async function hermesHealth() {
  const cfg = config();
  const status = await hermesStatus();
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
