import {translateIntelligence} from './intelligence-translation.mjs';
import {atomicReplace} from './atomic-replace.mjs';
import {intelligenceDatabaseUrl,syncIntelligence} from './intelligence-sync.mjs';
import {collectionPython} from './collection-python.mjs';
import {modelFetch as fetch} from './model-transport.mjs';
import {prepareHookWriting,finishHookWriting} from './hook-writing.mjs';
import {executeDna,writingDnaRoutes} from './writing-dna.mjs';
import {assetManageRoute} from './asset-manage.mjs';
import {promptLibraryRoute} from './prompt-library.mjs';
import {intelligenceModelRoute} from './intelligence-model.mjs';
import {modelEnv} from './model-profiles.mjs';
import {assetCreateRoute} from './asset-create.mjs';
import {libraryDocument} from './library-membership.mjs';
import { recognizeWriting } from './writing-recognition.mjs';
import { ensureDefaultModelProfile,loadModelProfiles,modelProfilesRoute } from './model-profiles.mjs';
import { reuseCollectionTranscripts } from './reuse-collection-transcripts.mjs';
import { StringDecoder } from 'node:string_decoder';
import { douyinLoginRoute } from './douyin-login.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { parseGeneration, validateGeneration, generatedTitle } from './generation-output.mjs';
import { retrieveKnowledge, sourceSnapshot } from './retrieval.mjs';
import { inspectDraft, bodyHash, invalidateAudit, mergeAuditIssues } from './audit.mjs';
import { parseImportRows } from './import-rows.mjs';
import { hermesCapability, hermesHealth, hermesStatus, saveHermesConfig } from './integrations/hermes-client.mjs';
import { runSkillPipeline, SKILL_LICENSE } from './skills-local.mjs';
import { createAuth, sameOriginRequest } from './auth.mjs';
import { createPasswordGate, defaultPasswordHash } from './password-gate.mjs';
import { spawn } from 'node:child_process';
import { collectionRequest } from './collection-request.mjs';
import postgres from 'postgres';
import { modelAuditRoute } from './model-audit.mjs';
import { executeCollectionFlow,collectionFlowOptions } from './collection-flow.mjs';
import { auditRevisionRoute } from './audit-revision.mjs';
import { hermesRoutes } from './hermes-routes.mjs';
import { workflowRoutes } from './workflow-routes.mjs';
import { draftContext, jobKnowledge, writingConfig, auditConfigHash, documentSource } from './workflow.mjs';
import { normalizeMaterial } from './materials.mjs';
import { readImportFile } from './file-import.mjs';
import { feishuSyncRoute } from './feishu-sync.mjs';
import { douyinConfigRoute } from './douyin-config.mjs';
import { modelServiceStatus } from './task-state.mjs';
import { accountAnalysisRoutes } from './account-analysis-routes.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, '..', 'public');
const dataDir = process.env.STUDIO_DATA_DIR || join(root, '..', 'data');
const dataFile = join(dataDir, 'studio.json');
const port = Number(process.env.PORT || 4310);
const host = process.env.HOST || '127.0.0.1';
const studioToken = process.env.STUDIO_PASSWORD || process.env.STUDIO_TOKEN || '';
// 自动化/测试可显式关闭密码门控：STUDIO_PASSWORD_GATE=off；不设置时行为不变
const passwordGateOff=['off','none','disabled'].includes(String(process.env.STUDIO_PASSWORD_GATE||'').toLowerCase());
const auth = createAuth(studioToken, { passwordHash: passwordGateOff ? '' : defaultPasswordHash });
const passwordGate = createPasswordGate(auth, { secureCookie: process.env.STUDIO_SECURE_COOKIE === 'true' });
let aihotBaseUrl = (process.env.AIHOT_BASE_URL || '').replace(/\/$/, '');
let aihotDbUrl = process.env.AIHOT_DATABASE_URL || '';
const hermesConfigFile = join(dataDir, 'hermes.env');
const collectionProcesses = new Map();
function stopCollection(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>child.kill());
  else child.kill();
}

const seed = {
  sources: [
    { id: 'aihot-001', title: 'AI 编程 Agent 正在改变小团队的软件交付方式', source: 'AIHOT · 行业资讯', publishedAt: '2026-10-26 09:20', summary: '多个开发团队开始把 Agent 放进需求拆解、代码生成与测试回归环节。真正的变化不只是写得更快，而是团队协作边界正在重新划分。', url: 'https://example.com/aihot/001', status: '未使用' },
    { id: 'aihot-002', title: '开源模型工具链开始从单点能力走向工作流', source: 'AIHOT · 趋势主题', publishedAt: '2026-10-25 16:40', summary: '模型、检索、评测和部署工具逐步组合成可复用的生产链路，内容团队也开始拥有自己的模型工作台。', url: 'https://example.com/aihot/002', status: '已收藏' },
    { id: 'asset-001', title: '作者蒸馏：AI 工具观点短帖结构', source: '本地蒸馏资料', publishedAt: '2026-10-24', summary: '先给结论，再交代具体场景，用一个可验证的例子收束，不把外部作者经历写成自己的经历。', url: 'file://distill/ai-opinion.md', status: '知识库' }
  ],
  documents: [
    { id: 'doc-001', name: 'AI工具观点短帖-蒸馏指南.md', type: '蒸馏方法库', chunks: 12, updatedAt: '今天 10:12', source: '本地导入', tag: '已确认' },
    { id: 'doc-002', name: '个人事实白名单.md', type: '规则与记忆库', chunks: 8, updatedAt: '昨天 18:30', source: '本地导入', tag: '硬性规则' },
    { id: 'doc-003', name: 'AIHOT 情报快照 · 2026-10-26', type: '事实库', chunks: 24, updatedAt: '今天 09:45', source: 'AIHOT 适配器', tag: '可核验' }
  ],
  templates: [
    { id: 'tpl-news', name: 'X · AI 新闻速评', platform: 'X', kind: '短帖', version: 'v1.3', active: true, bindings: ['事实库', '规则与记忆库'], audits: ['发布风险', 'AI 味检查'] },
    { id: 'tpl-opinion', name: 'X · AI 工具观点短帖', platform: 'X', kind: '短帖', version: 'v2.1', active: true, bindings: ['事实库', '蒸馏方法库'], audits: ['共鸣检查', '发布风险'] },
    { id: 'tpl-thread', name: 'X Thread · 观点展开', platform: 'X', kind: 'Thread', version: 'v1.0', active: false, bindings: ['事实库', '写作案例库'], audits: ['结构检查', '发布风险'] }
  ],
  jobs: [
    { id: 'job-001', title: 'AI 编程 Agent 为什么改变小团队开发', entry: 'AIHOT 新闻', template: 'X · AI 新闻速评', status: '待审核', updatedAt: '刚刚', body: 'AI 编程 Agent 真正改变的，可能不是“写代码更快”。\n\n它把需求拆解、实现、测试之间的等待时间压缩了。对小团队来说，变化在于：一个人可以更早看到完整方案，也更早暴露错误。\n\n但这不等于可以跳过判断。Agent 越强，越需要人把问题定义清楚。', sourceIds: ['aihot-001'], issues: 2 },
    { id: 'job-002', title: '从模型工具到内容工作流', entry: '手动想法', template: 'X Thread · 观点展开', status: '草稿', updatedAt: '昨天', body: '', sourceIds: [], issues: 0 }
  ],
  publications: [],
  versions: [],
  importPreviews: []
};

let databaseReady;
let pendingWrite = Promise.resolve();
function loadDb() {
  databaseReady ||= initializeDb();
  return databaseReady;
}
async function initializeDb() {
  await mkdir(dataDir, { recursive: true });
  aihotDbUrl=await intelligenceDatabaseUrl(root,aihotDbUrl);
  await ensureDefaultModelProfile(dataDir);await loadModelProfiles(dataDir);
  const collectionConfig=join(dataDir,'douyin.env');if(existsSync(collectionConfig)){for(const line of (await readFile(collectionConfig,'utf8')).split(/\r?\n/)){const match=line.match(/^(DASHSCOPE_API_KEY|DOUYIN_STATE_PATH)=(.*)$/);if(match&&!process.env[match[1]])process.env[match[1]]=match[2];}}
  if (!existsSync(dataFile)) await writeFile(dataFile, JSON.stringify({...seed,sources:[],documents:[],jobs:[]}, null, 2), 'utf8');
  const db = JSON.parse(await readFile(dataFile, 'utf8'));
  db.versions ||= [];
  db.documentVersions ||= [];
  db.importPreviews ||= [];
  db.topics ||= [];
  db.knowledgeSets ||= [];
  for(const source of db.sources)if(['aihot-001','aihot-002','asset-001'].includes(source.id))source.demo=true;
  for(const doc of db.documents)if(['doc-001','doc-002','doc-003'].includes(doc.id)&&!doc.content){doc.demo=true;doc.chunks=0;doc.tag='演示记录·无正文';}
  for(const job of db.jobs){if(['job-001','job-002'].includes(job.id)){job.demo=true;job.hidden=true;}if(/^[?\ufffd\s]+$/.test(job.title||'')){job.hidden=true;job.hiddenReason='旧任务标题乱码，保留在全部历史中';}}
  for(const doc of db.documents){if(doc.type==='抖音素材库')doc.type='写作案例库';}
  db.publications ||= [];
  db.auditIssues ||= [];
  db.auditRuns ||= [];
  db.taskRuns ||= [];
  for(const run of db.taskRuns){const coverage=run.summary?.coverage;if(coverage?.complete&&coverage.error&&coverage.stopReason==='collection_interrupted'){coverage.complete=false;coverage.correctedReason='interruption_prevents_full_history_confirmation';}}
  db.pipelinePlans ||= [];
  db.feishuMappings ||= [];
  for(const task of db.taskRuns)if(task.workflow?.state==='running'){task.workflow.state='paused';task.workflow.error='服务重启，流程已暂停；请核对任务后继续。';}
  for(const run of db.taskRuns)if(run.taskKind==='feishu-sync'&&run.state==='running'){run.state='unknown';run.error='process_restarted_feishu_receipt_needs_review';run.finishedAt=new Date().toISOString();}
  for(const run of db.taskRuns) if(run.taskKind==='douyin-collect' && run.state==='running'){run.state='failed';run.error='process_restarted_collection_interrupted';run.finishedAt=new Date().toISOString();}
  for(const run of db.taskRuns){if(['douyin-asr','douyin-comments'].includes(run.taskKind)&&run.state==='running'){run.state=run.taskKind==='douyin-asr'?'unknown':'failed';run.error='process_restarted_stage_interrupted';run.finishedAt=new Date().toISOString();}}
  for (const run of db.taskRuns) {
    if (!(run.taskKind === 'generate' || run.taskKind === 'model-audit' || run.taskKind === 'audit-revision' || run.taskKind === 'material-distill' || run.taskKind === 'writing-dna' || run.taskKind === 'account-analysis' || run.taskKind.startsWith('hermes-')) || run.state !== 'running') continue;
    run.state = run.awaitingResponse ? 'unknown' : 'failed';
    run.error = run.awaitingResponse ? 'process_restarted_response_unknown' : 'process_restarted_before_completion';
    run.finishedAt = new Date().toISOString();
  }
  if (!db.templates.some(item => item.kind === '视频口播')) {
    db.templates.push({ id: 'tpl-script', name: '抖音/视频号 · AI 工具口播', platform: '抖音/视频号', kind: '视频口播', version: 'v1.0', active: true, bindings: ['事实库', '蒸馏方法库', '规则与记忆库'], audits: ['口播流畅度', '发布风险', 'AI 味检查'], reviewMode: '自动建议后人工确认', maxRevisionRounds: 1, prompt: '', rules: ['不得虚构个人经历', '数据必须可核验'] });
    await saveDb(db);
  }
  // 过时技能名迁移：'事实核验' 无对应现行技能（系统明确不做外部事实核验），统一改为发布风险
  for (const item of db.templates) if (Array.isArray(item.audits) && item.audits.includes('事实核验')) item.audits = item.audits.map(a => a === '事实核验' ? '发布风险' : a);
  db.integration ||= { aihot: { connected: Boolean(aihotBaseUrl), lastSyncAt: null, lastError: null, mode: aihotBaseUrl ? 'configured' : 'demo' } };
  db.integration.aihot ||= { connected: Boolean(aihotBaseUrl), lastSyncAt: null, lastError: null, mode: aihotBaseUrl ? 'configured' : 'demo' };
  db.integration.aihot.syncMode ||= 'selected';
  db.integration.aihot.syncHistory ||= [];
  if (!aihotBaseUrl && db.integration.aihot.endpoint) aihotBaseUrl = db.integration.aihot.endpoint;
  await saveDb(db);
  return db;
}
function saveDb(db) {
  const snapshot = JSON.stringify(db, null, 2);
  const write = pendingWrite.catch(() => {}).then(async () => {
    const staging = `${dataFile}.pending`;
    await writeFile(staging, snapshot, 'utf8');
    await atomicReplace(staging, dataFile);
  });
  pendingWrite = write;
  return write;
}
function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req) {
  // 逐块拼字符串会把跨块的多字节 UTF-8 汉字解码成 U+FFFD（静默损坏正文），必须收齐 Buffer 一次解码
  const chunks = [];let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 8 * 1024 * 1024) throw Object.assign(new Error('request_too_large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch (error) { throw Object.assign(new Error('invalid_json_body'), { statusCode: 400, cause: error }); }
}
function id(prefix) { return `${prefix}-${randomUUID()}`; }
function authorized(req) {
  return auth.authorized(req);
}
const routes = {
  '/api/studio/overview': async db => ({ sources: db.sources.filter(s=>!s.demo), documents: db.documents.filter(d=>libraryDocument(d,db)),soulProfiles:db.documents.filter(d=>d.soulProfile), templates: db.templates, jobs: db.jobs, publications: db.publications, versions: db.versions, topics: db.topics, knowledgeSets: db.knowledgeSets.filter(s=>!s.deletedAt), auditIssues: db.auditIssues, auditRuns: db.auditRuns, taskRuns: db.taskRuns, integration: db.integration }),
  '/api/studio/sources': async db => db.sources,
  '/api/studio/documents': async db => db.documents.filter(d=>libraryDocument(d,db)),
  '/api/studio/templates': async db => db.templates,
  '/api/studio/jobs': async db => db.jobs,
  '/api/studio/publications': async db => db.publications
};

async function startCollectionStage(db,run,stage){
      const stageRun={id:id('run'),jobId:run.id,taskKind:`douyin-${stage}`,state:'running',startedAt:new Date().toISOString(),cost:stage==='asr'?null:0,logs:''};
      const taskDir=join(dataDir,'collections',run.id);const stageDir=join(taskDir,stageRun.id);await mkdir(stageDir,{recursive:true});
      await writeFile(join(taskDir,'result.json'),JSON.stringify(run.rows),'utf8');db.taskRuns.unshift(stageRun);await saveDb(db);
      const child=spawn(await collectionPython(dataDir),['-I','-u',join(root,'process-douyin.py'),taskDir,stageDir,stage],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
      collectionProcesses.set(stageRun.id,child);
      const timer=setTimeout(()=>{stageRun.error='stage_timeout';stopCollection(child);},Math.max(10*60*1000,run.rows.length*180000));timer.unref();
      const stdoutDecoder=new StringDecoder('utf8'),stderrDecoder=new StringDecoder('utf8');const log=(chunk,decoder)=>{stageRun.logs=(stageRun.logs+decoder.write(chunk)).slice(-20000);saveDb(db).catch(console.error);};child.stdout.on('data',chunk=>log(chunk,stdoutDecoder));child.stderr.on('data',chunk=>log(chunk,stderrDecoder));
      child.on('error',error=>{stageRun.error=error.message;});
      const done=new Promise(resolve=>child.on('close',async code=>{clearTimeout(timer);collectionProcesses.delete(stageRun.id);try{
        const result=JSON.parse(await readFile(join(stageDir,'result.json'),'utf8'));run.rows=result;
        stageRun.summary=JSON.parse(await readFile(join(stageDir,'summary.json'),'utf8'));
        stageRun.state=code===0?(stageRun.summary.failed||stageRun.summary.unknown?'partial':'succeeded'):(stage==='asr'?'unknown':'failed');
        await writeFile(join(taskDir,'result.json'),JSON.stringify(result),'utf8');
      }catch(error){stageRun.state=stage==='asr'?'unknown':'failed';stageRun.error=stageRun.error||error.message;}
      stageRun.finishedAt=new Date().toISOString();await saveDb(db).catch(console.error);resolve(stageRun);}));

return {stageRun,done};
}

async function runCollectionFlow(db,task){
  const invoke=async(route,path,input,extra={})=>{let result,status;await route({req:{method:'POST'},res:{},url:new URL(path,'http://localhost'),db,json:(_,code,value)=>{status=code;result=value;},body:async()=>input,saveDb,dataDir,...extra});if(status>=400)throw new Error(result.error);return result;};
  await executeCollectionFlow({db,task,saveDb,distill:()=>executeDna({db,task,saveDb}),transcribe:async()=>{const {done}=await startCollectionStage(db,task,'asr');return await done;},saveMaterial:row=>invoke(accountAnalysisRoutes,`/api/studio/douyin/tasks/${task.id}/prepare-writing`,{videoId:String(row.externalId||row.aweme_id||''),url:row.url}),sync:()=>invoke(feishuSyncRoute,`/api/studio/douyin/tasks/${task.id}/feishu`,{confirmed:true}),analyze:input=>invoke(accountAnalysisRoutes,`/api/studio/douyin/account-analysis/${task.id}/analyze`,input,{awaitCompletion:true})});
}
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (await passwordGate(req, res, url, { body, json })) return;
  const db = await loadDb();
  if (url.pathname.startsWith('/api/')) {
    if (!sameOriginRequest(req)) return json(res,403,{error:'cross_origin_request_denied'});
    if (!authorized(req)) return json(res, 401, { error: 'studio_auth_required' });
    if(await writingDnaRoutes({req,res,url,db,json,body,saveDb,startFlow:task=>runCollectionFlow(db,task)}))return;
    if(await assetManageRoute({req,res,url,db,json,body,saveDb}))return;
    if(await promptLibraryRoute({req,res,url,db,json,body,saveDb}))return;
    if(await intelligenceModelRoute({req,res,url,db,json,saveDb}))return;
    if (await workflowRoutes({ req, res, url, db, json, body, saveDb })) return;
    if (await feishuSyncRoute({ req, res, url, db, json, body, saveDb, dataDir })) return;
    if (await accountAnalysisRoutes({ req, res, url, db, json, body, saveDb, dataDir })) return;
    if (await hermesRoutes({ req, res, url, db, json, body, saveDb })) return;
    if (await modelAuditRoute({ req, res, url, db, json, body, saveDb })) return;
    if (await auditRevisionRoute({ req, res, url, db, json, body, saveDb })) return;
    if(req.method==='GET' && url.pathname==='/api/studio/integrations/hermes/status')return json(res,200,await hermesStatus());
    if(req.method==='GET' && url.pathname==='/api/studio/integrations/hermes/capability')return json(res,200,await hermesCapability());
    if(req.method==='POST' && url.pathname==='/api/studio/integrations/hermes/health')return json(res,200,await hermesHealth());
    if(req.method==='POST' && url.pathname==='/api/studio/integrations/hermes/config'){
      const input=await body(req);const endpoint=String(input.apiUrl||'').trim();const model=String(input.model||'').trim();const key=String(input.apiKey||'').trim();const memoryRoot=String(input.memoryRoot||'').trim();const materialPath=String(input.materialPath||'').trim();
      if(endpoint && !/^https?:\/\/[^\s]+$/i.test(endpoint))return json(res,400,{error:'invalid_hermes_api_url'});
      saveHermesConfig(input);
      const status=await hermesStatus(); return json(res,200,{saved:true,...status});
    }
    if (req.method==='GET' && url.pathname==='/api/studio/auth/status') return json(res,200,{authenticated:true,mode:auth.enabled?'session':'local'});
    if (req.method === 'GET' && routes[url.pathname]) return json(res, 200, await routes[url.pathname](db));
    if (req.method==='GET' && url.pathname==='/api/studio/douyin/workspace') {
      return json(res,200,{
        documents:db.documents.filter(doc=>doc.source==='douyin-material-pipeline'),
        batches:db.importPreviews.filter(item=>item.type==='douyin-material').map(item=>({id:item.id,taskId:item.taskId||null,count:item.count,unknownPlayCount:item.unknownPlayCount,state:item.state,createdAt:item.createdAt,commitResult:item.commitResult || null})),
        plans:db.pipelinePlans,feishu:db.integration?.feishu||null,tasks:db.taskRuns.filter(run=>run.taskKind==='douyin-collect'),stageTasks:db.taskRuns.filter(run=>['douyin-asr','douyin-comments','feishu-sync'].includes(run.taskKind)),
        capabilities:{import:'ready',collection:'adapter_ready',transcription:process.env.DASHSCOPE_API_KEY?'configured':'not_configured',comments:'adapter_ready',feishu:db.integration?.feishu?'configured':'not_configured',skills:'model_guided_review'},
      });
    }
    if(req.method==='POST'&&url.pathname==='/api/studio/documents/classify'){
      const input=await body(req);if(!['同行业文案','跨行业文案'].includes(input.industryScope)||!Array.isArray(input.ids)||input.ids.length>500||input.ids.some(id=>!db.documents.some(d=>d.id===id)))return json(res,400,{error:'invalid_document_classification'});
      for(const doc of db.documents)if(input.ids.includes(doc.id))doc.industryScope=input.industryScope;
      await saveDb(db);return json(res,200,{saved:true,count:input.ids.length});
    }
    if(await assetCreateRoute({req,res,url,db,json,body,saveDb,dataDir}))return;
    if(await modelProfilesRoute({req,res,url,json,body,dataDir,db}))return;
    if(await douyinLoginRoute({req,res,url,json,dataDir,root}))return;
    if(await douyinConfigRoute({req,res,url,json,body,dataDir}))return;
    if(req.method==='GET' && url.pathname==='/api/studio/feishu/status') return json(res,200,{enabled:Boolean(db.integration?.feishu),mode:db.integration?.feishu?'manual-cli-sync':'export-import-only',target:db.integration?.feishu||null,mappings:db.feishuMappings});
    if(req.method==='POST' && url.pathname==='/api/studio/feishu/preview') {
      const input=await readImportFile(await body(req));const rows=parseImportRows(input);const fields=[...new Set(rows.flatMap(row=>Object.keys(row)))];const mapping=input.mapping||{};const required=['title','content'];const missing=required.filter(key=>!mapping[key]||!fields.includes(mapping[key]));const preview={id:id('feishu-import'),type:'feishu-export',rows,fields,mapping,state:'待确认',missing,createdAt:new Date().toISOString(),permission:'仅本地研究，不自动回写飞书'};db.importPreviews.unshift(preview);await saveDb(db);return json(res,201,{id:preview.id,rows:rows.length,fields,missing,permission:preview.permission});
    }
    if(req.method==='POST' && url.pathname==='/api/studio/feishu/commit') {
      const input=await body(req);const preview=db.importPreviews.find(item=>item.id===input.previewId&&item.type==='feishu-export');if(!preview)return json(res,404,{error:'feishu_preview_not_found'});if(input.mapping){preview.mapping=input.mapping;preview.missing=['title','content'].filter(key=>!input.mapping[key]||!preview.fields.includes(input.mapping[key]));}if(preview.missing.length)return json(res,409,{error:'feishu_mapping_incomplete',missing:preview.missing});if(preview.committed)return json(res,200,{...preview.committed,reused:true});const mapping=preview.mapping;let importUrl='';if(input.importUrl){try{const link=new URL(input.importUrl);if(link.protocol!=='https:'||!/(^|\.)(feishu\.cn|larksuite\.com)$/.test(link.hostname)||link.username||link.password)throw new Error();importUrl=link.href;}catch{return json(res,400,{error:'invalid_feishu_source_url'});}}const docs=preview.rows.map(row=>({id:id('doc'),importSource:preview.id,importUrl,importName:input.importName||'飞书导入',name:String(row[mapping.title]||'未命名飞书素材'),type:input.docType||'写作案例库',content:String(row[mapping.content]||''),author:mapping.author?String(row[mapping.author]||''):null,url:mapping.url?String(row[mapping.url]||''):null,publishedAt:mapping.publishedAt?String(row[mapping.publishedAt]||''):null,source:'feishu-export',sourceKind:'external-material',factRole:input.docType==='事实库'?'外部事实·需核验':'参考资料·不可作为本人经历',licenseScope:input.licenseScope||'内部研究，不自动发布',version:1,chunks:Math.max(1,Math.ceil(String(row[mapping.content]||'').length/420)),updatedAt:'刚刚',tag:'本地导入·待确认'}));db.documents.unshift(...docs);db.sources.unshift(...docs.map(doc=>({id:doc.id,documentId:doc.id,role:doc.factRole,title:doc.name,source:'feishu-export',summary:doc.content.slice(0,180),content:doc.content,url:doc.url||`file://feishu/${encodeURIComponent(doc.name)}`,status:'素材库',origin:'feishu-import',licenseScope:doc.licenseScope,factRole:doc.factRole})));preview.committed={count:docs.length,unknownLicense:!input.licenseScope,factRole:docs[0]?.factRole};preview.state='已入库';await saveDb(db);return json(res,201,preview.committed);
    }
    if(req.method==='POST' && url.pathname==='/api/studio/douyin/collect') {
      const collectionInput=await body(req);const request=collectionRequest(collectionInput);
      request.workflow=collectionFlowOptions(collectionInput.workflow,{distill:process.env.MODEL_CALLS_ENABLED==='true'&&Boolean(modelEnv('distill').LLM_API_KEY&&modelEnv('distill').LLM_BASE_URL&&modelEnv('distill').LLM_MODEL),asr:Boolean(process.env.DASHSCOPE_API_KEY),feishu:db.integration?.feishu,account:request.mode==='profile',model:process.env.MODEL_CALLS_ENABLED==='true'&&Boolean(modelEnv('writing').LLM_BASE_URL&&modelEnv('writing').LLM_API_KEY&&modelEnv('writing').LLM_MODEL)});
      if(db.taskRuns.some(run=>run.taskKind==='douyin-collect' && run.state==='running'))return json(res,409,{error:'collection_in_progress'});
      const pythonExecutable=await collectionPython(dataDir);
      const run={pythonExecutable,id:id('collect'),taskKind:'douyin-collect',state:'running',startedAt:new Date().toISOString(),request,logs:'',cost:0,filters:request.filters,fields:request.fields};
      const output=join(dataDir,'collections',run.id);await mkdir(output,{recursive:true});await writeFile(join(output,'request.json'),JSON.stringify(request),'utf8');db.taskRuns.unshift(run);await saveDb(db);
      const child=spawn(pythonExecutable,['-I','-u',join(root,'collect-douyin.py'),output],{shell:false,windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',DOUYIN_NO_STATE:'1',DOUYIN_BROWSER:'chromium'}});
      collectionProcesses.set(run.id,child);
      const stdoutDecoder=new StringDecoder('utf8'),stderrDecoder=new StringDecoder('utf8');const log=(chunk,decoder)=>{run.logs=(run.logs+decoder.write(chunk)).slice(-20000);saveDb(db).catch(console.error);};child.stdout.on('data',chunk=>log(chunk,stdoutDecoder));child.stderr.on('data',chunk=>log(chunk,stderrDecoder));
      child.on('error',error=>{if(run.state!=='cancelled'){run.state='failed';run.error=error.message;}run.finishedAt=new Date().toISOString();saveDb(db).catch(console.error);});
      const timeout=setTimeout(()=>{run.error='collection_timeout';stopCollection(child);},request.collectAll?70*60*1000:Math.max(10*60*1000,request.urls.length*90000));timeout.unref();
      child.on('close',async code=>{clearTimeout(timeout);collectionProcesses.delete(run.id);try{if(run.state==='cancelled')return;if(code!==0)throw new Error(run.error||`collector_exit_${code}`);const rows=JSON.parse(await readFile(join(output,'result.json'),'utf8'));if(!Array.isArray(rows))throw new Error('invalid_collection_result');run.summary=JSON.parse(await readFile(join(output,'summary.json'),'utf8'));run.rows=rows;run.summary.reusedTranscripts=reuseCollectionTranscripts(run,db.taskRuns).reused;run.count=rows.length;run.state='succeeded';if(request.workflow)run.workflow={state:'running',step:'collected',options:request.workflow,steps:{}};}catch(error){run.state='failed';run.error=error.message;}finally{run.finishedAt=new Date().toISOString();await saveDb(db).catch(console.error);}if(run.workflow?.state==='running')void runCollectionFlow(db,run).catch(err=>console.error('collection flow error:',err));});
      return json(res,202,run);
    }
    if(req.method==='POST'&&/^\/api\/studio\/douyin\/tasks\/[^/]+\/reuse-transcripts$/.test(url.pathname)){
      const task=db.taskRuns.find(r=>r.id===url.pathname.split('/')[5]&&r.taskKind==='douyin-collect');
      if(!task||task.state!=='succeeded')return json(res,409,{error:'collection_result_unavailable'});
      if(task.workflow?.state==='running'||db.taskRuns.some(r=>r.jobId===task.id&&r.state==='running'))return json(res,409,{error:'source_processing_in_progress'});
      const result=reuseCollectionTranscripts(task,db.taskRuns);await saveDb(db);return json(res,200,result);
    }
    if(req.method==='POST'&&/^\/api\/studio\/douyin\/tasks\/[^/]+\/workflow-start$/.test(url.pathname)){
      const task=db.taskRuns.find(r=>r.id===url.pathname.split('/')[5]&&r.taskKind==='douyin-collect');if(task?.state!=='succeeded'||!task.rows?.length)return json(res,409,{error:'collection_result_unavailable'});
      if(task.workflow?.state==='running')return json(res,409,{error:'source_processing_in_progress'});
      const input=await body(req);const options=collectionFlowOptions(input.workflow,{distill:process.env.MODEL_CALLS_ENABLED==='true'&&Boolean(modelEnv('distill').LLM_API_KEY&&modelEnv('distill').LLM_BASE_URL&&modelEnv('distill').LLM_MODEL),asr:Boolean(process.env.DASHSCOPE_API_KEY),feishu:db.integration?.feishu,account:task.request?.mode==='profile',model:process.env.MODEL_CALLS_ENABLED==='true'&&Boolean(modelEnv('writing').LLM_BASE_URL&&modelEnv('writing').LLM_API_KEY&&modelEnv('writing').LLM_MODEL)});
      if(!options)return json(res,400,{error:'invalid_collection_workflow'});
      task.workflowHistory||=[];if(task.workflow)task.workflowHistory.unshift(structuredClone(task.workflow));task.workflow={state:'running',step:'collected',options,steps:{}};await saveDb(db);void runCollectionFlow(db,task);return json(res,202,task);
    }
    if(req.method==='POST'&&/^\/api\/studio\/douyin\/tasks\/[^/]+\/workflow-resume$/.test(url.pathname)){
      const task=db.taskRuns.find(r=>r.id===url.pathname.split('/')[5]&&r.taskKind==='douyin-collect');if(!task?.workflow||task.state!=='succeeded')return json(res,409,{error:'collection_result_unavailable'});
      if(task.workflow.state!=='paused')return json(res,409,{error:'workflow_not_paused'});
      task.workflow.state='running';await saveDb(db);void runCollectionFlow(db,task);return json(res,202,task);
    }
    if(req.method==='GET' && url.pathname==='/api/studio/douyin/tasks')return json(res,200,{tasks:db.taskRuns.filter(run=>run.taskKind==='douyin-collect'),stageTasks:db.taskRuns.filter(run=>['douyin-asr','douyin-comments','feishu-sync'].includes(run.taskKind))});
    if(req.method==='GET' && url.pathname.match(/^\/api\/studio\/douyin\/tasks\/[^/]+$/)){
      const run=db.taskRuns.find(item=>item.id===url.pathname.split('/')[5]&&item.taskKind==='douyin-collect');return run?json(res,200,run):json(res,404,{error:'collection_task_not_found'});
    }
    if(req.method==='POST' && url.pathname.match(/^\/api\/studio\/douyin\/tasks\/[^/]+\/(asr|comments|normalize)$/)){
      const run=db.taskRuns.find(item=>item.id===url.pathname.split('/')[5]&&item.taskKind==='douyin-collect');const stage=url.pathname.split('/').pop();if(!run)return json(res,404,{error:'collection_task_not_found'});if(run.state!=='succeeded')return json(res,409,{error:'collection_not_succeeded',state:run.state});
      if(db.taskRuns.some(item=>item.jobId===run.id&&['account-analysis','writing-dna','douyin-asr','douyin-comments'].includes(item.taskKind)&&item.state==='running'))return json(res,409,{error:'source_processing_in_progress'});
      if(run.workflow?.state==='running')return json(res,409,{error:'source_processing_in_progress'});
      if(stage==='normalize'){run.rows=run.rows.map(normalizeMaterial);await saveDb(db);return json(res,200,{state:'succeeded',count:run.rows.length,detail:'字段归一化已完成'});}
      if(db.taskRuns.some(item=>item.jobId===run.id&&item.taskKind==='account-analysis'&&item.state==='running'))return json(res,409,{error:'stop_account_analysis_before_processing'});
      if(db.taskRuns.some(item=>item.jobId===run.id && ['douyin-asr','douyin-comments'].includes(item.taskKind) && ['running','unknown'].includes(item.state)))return json(res,409,{error:'stage_running_or_outcome_unknown'});
      if(stage==='asr'&&!process.env.DASHSCOPE_API_KEY)return json(res,409,{error:'asr_not_configured',detail:'请先配置 DASHSCOPE_API_KEY；作品数据已保留。'});
      const input=await body(req);
      if(stage==='asr'&&input.confirmPaid!==true)return json(res,409,{error:'asr_cost_confirmation_required'});
      if(db.taskRuns.some(item=>item.jobId===run.id&&(['account-analysis','writing-dna','douyin-asr','douyin-comments'].includes(item.taskKind)&&item.state==='running'||['douyin-asr','douyin-comments'].includes(item.taskKind)&&item.state==='unknown')))return json(res,409,{error:'source_processing_in_progress'});
      const {stageRun}=await startCollectionStage(db,run,stage);
      return json(res,202,stageRun);
    }
    if(req.method==='POST' && url.pathname.match(/^\/api\/studio\/douyin\/tasks\/[^/]+\/cancel$/)) {
      const run=db.taskRuns.find(item=>item.id===url.pathname.split('/')[5] && item.taskKind==='douyin-collect');
      if(!run)return json(res,404,{error:'collection_task_not_found'});
      if(run.state==='cancelled')return json(res,200,run);
      if(run.state!=='running')return json(res,409,{error:'collection_already_finished'});
      run.state='cancelled';run.error='cancelled_by_user';run.finishedAt=new Date().toISOString();await saveDb(db);
      stopCollection(collectionProcesses.get(run.id));return json(res,200,run);
    }
    if(req.method==='GET' && url.pathname.match(/^\/api\/studio\/douyin\/batches\/[^/]+$/)) {
      const batch=db.importPreviews.find(item=>item.id===url.pathname.split('/')[5] && item.type==='douyin-material');
      return batch?json(res,200,batch):json(res,404,{error:'batch_not_found'});
    }
    if(req.method==='GET' && url.pathname.match(/^\/api\/studio\/douyin\/(batches|tasks)\/[^/]+\/export$/)) {
      const taskExport=url.pathname.split('/')[4]==='tasks';
      const task=taskExport?db.taskRuns.find(item=>item.id===url.pathname.split('/')[5]&&item.taskKind==='douyin-collect'):null;
      if(taskExport&&(!task||task.state!=='succeeded'||!task.rows?.length))return json(res,409,{error:'collection_result_unavailable'});
      if(taskExport&&db.taskRuns.some(run=>run.jobId===task.id&&run.state==='running'&&['douyin-asr','douyin-comments'].includes(run.taskKind)))return json(res,409,{error:'processing_stage_in_progress'});
      const taskRows=task?.rows.map(normalizeMaterial);
      const batch=task?{id:task.id,rows:taskRows,count:taskRows.length,unknownPlayCount:taskRows.filter(r=>!r.playCountKnown).length,state:'采集结果',fields:task.request?.collectAll?undefined:task.fields}:db.importPreviews.find(item=>item.id===url.pathname.split('/')[5] && item.type==='douyin-material'); if(!batch)return json(res,404,{error:'batch_not_found'});
      const requestedFormat=url.searchParams.get('format');const format=['json','csv'].includes(requestedFormat)?requestedFormat:'markdown';
      if(format==='csv'){const quote=value=>'"'+String(value??'').replace(/^([=+@-])/g,"'$1").replaceAll('"','""')+'"';const csv=[['标题','作者','原链接','发布时间','正文','点赞数','收藏数','评论数','转发数','播放量'],...batch.rows.map(row=>[row.title,row.author,row.url,row.publishedAt,row.transcript,row.diggCount,row.collectCount,row.commentCount,row.shareCount,row.playCountKnown?row.playCount:'未知'])].map(row=>row.map(quote).join(',')).join('\r\n');res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="douyin-${batch.id}.csv"`});return res.end('\ufeff'+csv);}
      if(format==='json'){res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="douyin-${batch.id}.json"`});return res.end(JSON.stringify(batch.rows.map(row=>batch.fields?Object.fromEntries(Object.entries(row).filter(([key])=>['row','externalId','playCountKnown'].includes(key)||batch.fields.includes(key))):row),null,2));}
      const markdown=[`# 抖音素材批次 ${batch.id}`,``, `- 条数：${batch.count}`,`- 播放量未知：${batch.unknownPlayCount}`,`- 导入状态：${batch.state}`,`- 导出时间：${new Date().toISOString()}`,``,`> 播放量缺失按未知处理，不将点赞折算为播放量。`,``,...batch.rows.map(row=>[`## ${row.row}. ${row.title}`,``,`- 作者：${row.author||'未知'}`,`- 原链接：${row.url||'缺失'}`,`- 发布时间：${row.publishedAt||'未知'}`,`- 点赞：${row.diggCount??'未知'}`,`- 播放量：${row.playCountKnown?row.playCount:'未知'}`,``,`${row.transcript||'（缺少转写正文）'}`,``].join('\n'))].join('\n');
      res.writeHead(200,{'content-type':'text/markdown; charset=utf-8','content-disposition':`attachment; filename="douyin-${batch.id}.md"`});return res.end(markdown);
    }
    if(req.method==='POST' && url.pathname.match(/^\/api\/studio\/douyin\/tasks\/[^/]+\/preview$/)) {
      const run=db.taskRuns.find(item=>item.id===url.pathname.split('/')[5] && item.taskKind==='douyin-collect');
      if(!run)return json(res,404,{error:'collection_task_not_found'});
      if(run.state!=='succeeded' || !Array.isArray(run.rows) || !run.rows.length)return json(res,409,{error:'collection_result_unavailable',state:run.state,errorDetail:run.error||null});
      if(db.taskRuns.some(task=>task.jobId===run.id&&task.state==='running'&&task.taskKind.startsWith('douyin-')))return json(res,409,{error:'processing_stage_in_progress'});
      const preview={id:id('douyin-import'),type:'douyin-material',rows:run.rows.map(normalizeMaterial),taskId:run.id,fields:run.fields,state:'待确认',createdAt:new Date().toISOString()};
      preview.count=preview.rows.length;preview.unknownPlayCount=preview.rows.filter(row=>!row.playCountKnown).length;db.importPreviews.unshift(preview);await saveDb(db);return json(res,201,{id:preview.id,count:preview.count,unknownPlayCount:preview.unknownPlayCount});
    }
    if(req.method==='POST' && url.pathname==='/api/studio/douyin/plans') {
      const input=await body(req);const allowed=['dbs-content-value','dbs-script-flow','dbs-ai-check','dbs-resonate','dbs-content-risk-check','dbs-title-cover-intro','dbs-spread'];
      const skills=Array.isArray(input.skills)?input.skills:[];
      if(!['X 短帖','X Thread','视频口播'].includes(input.format) || skills.some(skill=>!allowed.includes(skill))) return json(res,400,{error:'invalid_pipeline_plan'});
      if(input.format!=='视频口播' && skills.some(skill=>['dbs-script-flow','dbs-title-cover-intro'].includes(skill))) return json(res,400,{error:'video_skill_requires_video_format'});
      const plan={id:id('plan'),name:String(input.name||'素材创作方案').slice(0,100),format:input.format,skills:[...new Set(skills)],state:'已保存·尚未执行 Skill',createdAt:new Date().toISOString()};
      db.pipelinePlans.unshift(plan);await saveDb(db);return json(res,201,plan);
    }
    if(req.method==='POST' && url.pathname==='/api/studio/douyin/create-content') {
      const input=await body(req);const doc=db.documents.find(item=>item.id===input.documentId && item.source==='douyin-material-pipeline');
      if(!doc) return json(res,404,{error:'document_not_found'});
      if(!doc.content?.trim()) return json(res,409,{error:'transcript_required'});
      const template=db.templates.find(item=>item.id===input.templateId && item.active);if(!template)return json(res,400,{error:'active_template_required'});
      const plan=input.planId?db.pipelinePlans.find(item=>item.id===input.planId):null;
      if(input.planId && !plan)return json(res,400,{error:'pipeline_plan_not_found'});
      const targetFormat=template.kind==='短帖'?'X 短帖':template.kind==='Thread'?'X Thread':template.kind;
      if(plan && plan.format!==targetFormat)return json(res,400,{error:'plan_template_format_mismatch'});
      const source={id:doc.id,title:doc.name,source:doc.source,summary:doc.content,url:doc.url,author:doc.author,role:'外部写作案例·不是本人经历'};
      const job={id:id('job'),title:doc.name,entry:'抖音素材库',template:template.name,templateVersionId:template.id,templateSnapshot:structuredClone(template),platform:template.platform,format:template.kind,sourceIds:[doc.id],sourceSnapshot:source,body:'',status:'草稿',issues:0,updatedAt:'刚刚',createdAt:new Date().toISOString()};
      job.pipelinePlanSnapshot=plan?structuredClone(plan):null;
      if(plan&&!db.integration?.auditConfig)job.auditSkills=plan.skills.filter(skill=>skill!=='dbs-spread');
      job.skillExecutionState=plan?'尚未执行':'未选择方案';
      db.jobs.unshift(job);await saveDb(db);return json(res,201,job);
    }
    if (req.method === 'GET' && url.pathname === '/api/studio/search') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      if (q.length < 2) return json(res, 200, { query: q, sources: [], documents: [], jobs: [] });
      const match = item => [item.title, item.name, item.summary, item.source, item.content, item.body].filter(Boolean).join(' ').toLowerCase().includes(q);
      const documents = db.documents.filter(match).slice(0, 30); const groups = { facts: documents.filter(item => item.type === '事实库'), examples: documents.filter(item => item.type === '写作案例库'), methods: documents.filter(item => item.type === '蒸馏方法库'), rules: documents.filter(item => item.type === '规则与记忆库') };
      return json(res, 200, { query: q, sources: db.sources.filter(match).slice(0, 30), documents, groups, jobs: db.jobs.filter(match).slice(0, 30) });
    }
    if (req.method === 'GET' && url.pathname.match(/^\/api\/studio\/sources\/[^/]+$/)) {
      const source = db.sources.find(item => item.id === decodeURIComponent(url.pathname.split('/')[4]));
      return source ? json(res, 200, source) : json(res, 404, { error: 'source_not_found' });
    }
    if (req.method === 'GET' && url.pathname.match(/^\/api\/studio\/documents\/[^/]+$/)) {
      const document = db.documents.find(item => item.id === decodeURIComponent(url.pathname.split('/')[4]));
      return document ? json(res, 200, document) : json(res, 404, { error: 'document_not_found' });
    }
    if (req.method === 'GET' && url.pathname.match(/^\/api\/studio\/jobs\/[^/]+\/versions$/)) {
      const jobId = decodeURIComponent(url.pathname.split('/')[4]);
      const job = db.jobs.find(item => item.id === jobId); if (!job) return json(res, 404, { error: 'job_not_found' });
      return json(res, 200, { job, versions: db.versions.filter(item => item.jobId === jobId) });
    }
    if (req.method === 'GET' && url.pathname === '/api/studio/integrations/aihot/status') return json(res, 200, db.integration.aihot);
    if (req.method === 'GET' && url.pathname === '/api/studio/runtime/status') {
      return json(res, 200, {
        node: process.version,
        host,
        port,
        model: modelEnv('writing').LLM_MODEL || '未配置',
        modelService:modelServiceStatus(db),
        modelCallsEnabled: process.env.MODEL_CALLS_ENABLED === 'true',
        collectionEnabled: process.env.COLLECT_ENABLED === 'true',
        feishuPushEnabled: process.env.FEISHU_CONTENT_PUSH_ENABLED === 'true',
        autoPublishEnabled: false,
        database: Boolean(process.env.AIHOT_DATABASE_URL),
        aihot: db.integration.aihot,
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/studio/runtime/task-summary') {
      const summary = { content: { total: db.jobs.length, active: db.jobs.filter(item => !['已发布', '已取消'].includes(item.status)).length, cancelled: db.jobs.filter(item => item.status === '已取消').length }, audits: { pending: db.auditIssues.filter(item => item.status === '待处理').length, runs: db.auditRuns.length }, aiHot: null };
      if (aihotDbUrl) { const sql = postgres(aihotDbUrl, { max: 1, connect_timeout: 3, idle_timeout: 2 }); try { const [row] = await sql`SELECT count(*) FILTER (WHERE processing_state = 'new')::int AS pending, count(*) FILTER (WHERE processing_state = 'failed')::int AS failed, count(*) FILTER (WHERE processing_state = 'blocked')::int AS blocked, count(*) FILTER (WHERE processing_state = 'analyzed')::int AS analyzed, (SELECT count(*)::int FROM publications) AS public_items, (SELECT count(*)::int FROM publications WHERE selected) AS selected_items FROM articles`; summary.aiHot = row; } finally { await sql.end({ timeout: 1 }); } }
      return json(res, 200, summary);
    }
    if (req.method === 'GET' && url.pathname === '/api/studio/runtime/checklist') {
      const live = db.integration.aihot.mode === 'live';
      return json(res, 200, { items: [
        { id: 'source-live', label: 'AIHOT 真实情报接入', state: live ? 'passed' : 'pending', detail: live ? `${db.integration.aihot.count || 0} 条已同步` : '等待真实 AIHOT 地址' },
        { id: 'asset-import', label: '素材预检与确认入库', state: db.documents.length ? 'passed' : 'pending', detail: `${db.documents.length} 份文档` },
        { id: 'direct-write', label: '情报直接生成 X', state: db.jobs.some(item => item.entry === 'AIHOT 新闻') ? 'passed' : 'pending', detail: '无需先创建选题卡' },
        { id: 'topic-branch', label: '多角度选题生成', state: db.topics.length ? 'passed' : 'pending', detail: `${db.topics.length} 张选题卡` },
        { id: 'audit-diff', label: '审核与局部 Diff', state: db.auditRuns.length && db.versions.length ? 'passed' : 'pending', detail: `${db.auditRuns.length} 次审核 · ${db.versions.length} 个版本` },
        { id: 'publication-retro', label: '定稿、发布与复盘', state: db.publications.length ? 'passed' : 'pending', detail: `${db.publications.length} 条发布记录` },
        { id: 'private-boundary', label: '私有数据边界', state: 'passed', detail: '工作台 API 与 AIHOT 公开层分离' },
      ] });
    }
    if (req.method === 'GET' && url.pathname === '/api/studio/runtime/dependencies') {
      const hermes=await hermesStatus();
      return json(res,200,{dependencies:[
        {id:'aihot',name:'AIHOT 情报引擎',state:db.integration.aihot.mode,detail:`公开 API ${db.integration.aihot.endpoint || '未配置'} · 缓存 ${db.integration.aihot.count||0} 条`},
        {id:'hermes',name:'Hermes 文案引擎',state:hermes.mode,detail:hermes.detail,model:hermes.model||null},
        {id:'douyin',name:'抖音素材流水线',state:'adapter_ready',detail:'任务适配器已接通；ASR/评论按配置阶段执行'},
        {id:'dbskill',name:'dbskill',state:'local_compatibility',detail:'本地快检 + Skill 文档辅助模型诊断；未执行原工具分支'},
        {id:'feishu',name:'飞书',state:db.integration?.feishu?'configured':'export_only',detail:db.integration?.feishu?'已连接内容蒸馏表；确认后手动同步，按来源去重':'支持文件交接；等待指定同步目标'},
      ],boundaries:{autoPublish:false,feishuWrite:Boolean(db.integration?.feishu),unknownReceiptAutoRetry:false}});
    }
    if (req.method === 'GET' && url.pathname.match(/^\/api\/studio\/jobs\/[^/]+\/runs$/)) {
      const jobId = decodeURIComponent(url.pathname.split('/')[4]); return json(res, 200, db.taskRuns.filter(item => item.jobId === jobId));
    }
    if (req.method === 'GET' && url.pathname === '/api/studio/integrations/aihot/diagnostics') {
      if (!aihotDbUrl) return json(res, 200, { available: false, detail: '本机诊断数据库连接未配置' });
      const sql = postgres(aihotDbUrl, { max: 1, connect_timeout: 3, idle_timeout: 2 });
      try {
        const [row] = await sql`SELECT (SELECT count(*)::int FROM articles) AS collected, (SELECT count(*)::int FROM articles WHERE processing_state = 'new') AS pending_review, (SELECT count(*)::int FROM articles WHERE processing_state = 'failed') AS failed, (SELECT count(*)::int FROM articles WHERE body_status = 'ok') AS body_ready, (SELECT count(*)::int FROM publications) AS public_items, (SELECT count(*)::int FROM publications WHERE selected) AS selected_items`;
        return json(res, 200, { available: true, ...row, publicApi: `${aihotBaseUrl}/api/v1/items` });
      } finally { await sql.end({ timeout: 1 }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/studio/integrations/aihot/config') {
      const input = await body(req); const baseUrl = String(input.baseUrl || '').trim().replace(/\/$/, '');
      if (baseUrl && !/^https?:\/\/[^\s/]+(?::\d+)?$/i.test(baseUrl)) return json(res, 400, { error: 'invalid_aihot_base_url' });
      aihotBaseUrl = baseUrl; db.integration.aihot = { ...db.integration.aihot, connected: false, mode: baseUrl ? 'configured' : 'demo', endpoint: baseUrl || null, lastError: null, syncMode: input.syncMode === 'all' ? 'all' : input.syncMode === 'selected' ? 'selected' : db.integration.aihot.syncMode }; await saveDb(db); return json(res, 200, db.integration.aihot);
    }
    if (req.method === 'POST' && url.pathname === '/api/studio/integrations/aihot/sync') {
      if (!aihotBaseUrl) return json(res, 409, { error: 'aihot_base_url_not_configured', integration: db.integration.aihot });
      const input = await body(req); const syncMode = input.mode === 'all' ? 'all' : input.mode === 'selected' ? 'selected' : db.integration.aihot.syncMode;
      try{const result=await syncIntelligence({db,baseUrl:aihotBaseUrl,databaseUrl:aihotDbUrl,saveDb,mode:syncMode,window:input.window==='24h'?'24h':'7d'});void translateIntelligence({db,saveDb}).catch(error=>console.error('Intelligence translation:',error.message));return json(res,200,result);}catch(error){return json(res,502,{error:'aihot_sync_failed',detail:error.message});}
    }
    if (req.method === 'POST' && url.pathname.match(/^\/api\/studio\/sources\/[^/]+\/favorite$/)) {
      const source = db.sources.find(item => item.id === url.pathname.split('/')[4]);
      if (!source) return json(res, 404, { error: 'source_not_found' });
      source.status = source.status === '已收藏' ? '未使用' : '已收藏';
      if(source.status==='已收藏' && !db.documents.some(doc=>doc.sourceId===source.id)){db.documents.unshift({id:id('doc'),name:source.title,type:source.origin==='aihot-live'?'事实库':'写作案例库',content:source.content||source.summary,source:source.source,sourceId:source.id,url:source.url,publishedAt:source.publishedAt,version:1,chunks:1,updatedAt:'刚刚',tag:'已收藏·待核验',factRole:'外部资料·需核验'});} source.updatedAt = new Date().toISOString(); await saveDb(db); return json(res, 200, source);
    }
    if (req.method === 'POST' && url.pathname.match(/^\/api\/studio\/writing\/jobs\/[^/]+\/generate$/)) {
      const job = db.jobs.find(item => item.id === decodeURIComponent(url.pathname.split('/')[5])); if (!job) return json(res, 404, { error: 'job_not_found' });
      if (job.status === '已取消') return json(res, 409, { error: 'job_cancelled' });
      if (process.env.MODEL_CALLS_ENABLED !== 'true') return json(res, 409, { error: 'model_calls_disabled' });
      job.writingInputTitle??=job.title;
      const prompt = draftContext(db, job);
      let knowledgeSnapshot = prompt.knowledge;
      let { template, system, user } = prompt;
      const initialBodyHash = bodyHash(job.body);
      const initialConfigHash = auditConfigHash(job);
      const inputHash = createHash('sha256').update(JSON.stringify({ jobId: job.id, templateId: template.id, model: modelEnv('writing').LLM_MODEL, endpoint:modelEnv('writing').LLM_BASE_URL, system, user })).digest('hex');
      const cached = db.versions.find(item => { if (item.jobId !== job.id || item.inputHash !== inputHash) return false; try { validateGeneration(item); return true; } catch { return false; } }); if (cached) {if(job.body!==cached.body){invalidateAudit(db,job.id);db.versions.unshift({...structuredClone(cached),id:id('ver'),parentVersionId:db.versions.find(v=>v.jobId===job.id)?.id||null,reason:'复用相同输入的已生成稿',createdAt:new Date().toISOString()});job.body=cached.body;job.status='待审核';job.updatedAt='刚刚';await saveDb(db);}return json(res, 200, { job, version: cached, reused: true });}
      const unresolved = db.taskRuns.find(item => item.taskKind === 'generate' && item.inputHash === inputHash && ['running', 'unknown'].includes(item.state));
      if (unresolved) return json(res, 409, { error: unresolved.state === 'running' ? 'generation_in_progress' : 'generation_outcome_unknown', runId: unresolved.id });
      const started = new Date().toISOString(); const run = { id: id('run'), jobId: job.id, taskKind: 'generate', state: 'running', startedAt: started, cost: null, inputHash, model: modelEnv('writing').LLM_MODEL, attempts: 0 }; db.taskRuns.unshift(run); await saveDb(db);
      try {
        const base = String(modelEnv('writing').LLM_BASE_URL || '').replace(/\/$/, ''); const key = modelEnv('writing').LLM_API_KEY || ''; const model = modelEnv('writing').LLM_MODEL || 'gemini-3-flash';
        if (!base || !key) throw new Error('model_not_configured');
        // 本次创作只解析一份 Writing DNA：初稿与后续文风一致性阶段共用
        run.writingDna={used:Boolean(prompt.dna),runId:job.styleDnaRunId||job.templateSnapshot?.distillationRunId||null,scope:prompt.dna?.scope||null,examples:prompt.dna?.examples?.length||0,stages:['draft']};
        const resolved=await recognizeWriting({db,job,run,saveDb,dna:prompt.dna});system=resolved.system;user=resolved.user;knowledgeSnapshot=resolved.knowledge;
        // 黄金三秒类型只是参数；开头参考与正文素材都检索自本次所选知识库
        const hookPrepared=await prepareHookWriting({db,job,run,saveDb});if(hookPrepared){run.phase='composing-body';await saveDb(db);}
        let parsed; let generatedBody = ''; let lastError = '';
        // 推理模型会先用 completion 额度思考：给低推理档位，并在截断/空回执时逐级放大预算
        const baseTokens=Math.min(10000,Math.max(4096,Number(job.targetWordCount||700)*3+2048,String(job.originalBody||'').length*3+2048));
        const bodyBudgets=[baseTokens,Math.min(24000,Math.max(baseTokens*2,8000))];
        const lowEffort=/deepseek/i.test(String(base))?{reasoning_effort:'low'}:{};
        for (let attempt = 0; attempt < bodyBudgets.length; attempt += 1) {
          const repair = attempt ? '\n上一次输出不合格。现在只输出严格 JSON，body 必须是真实完整正文，至少 80 个字符，绝不能是省略号、占位符或解释文字。' : '';
          run.attempts = attempt + 1; run.awaitingResponse = true; await saveDb(db);
          const response = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user + repair }], temperature: attempt ? 0.1 : 0.35, max_tokens: bodyBudgets[attempt], ...lowEffort }), signal: AbortSignal.timeout(180000) });
          if(!response.ok){run.awaitingResponse=response.status>=500;run.httpFailure={status:response.status,requestId:response.headers.get('x-request-id')||null,detail:(await response.text()).slice(0,4000)};throw new Error(`model_http_${response.status}`);}
          const payload = await response.json(); run.awaitingResponse=false; const raw = payload.choices?.[0]?.message?.content || '';
          run.attempts = attempt + 1; run.cost = null; run.usage = payload.usage || null;
          run.responses ||= []; run.responses.push({ phase:'body',raw, finishReason:payload.choices?.[0]?.finish_reason, usage: payload.usage || null, receivedAt: new Date().toISOString() });
          await saveDb(db);
          if(payload.choices?.[0]?.finish_reason==='length'||!String(raw||'').trim()){
           lastError=payload.choices?.[0]?.finish_reason==='length'?'model_output_truncated':'model_empty_output';
           run.bodyBudget=[...(run.bodyBudget||[]),{attempt:attempt+1,maxTokens:bodyBudgets[attempt],finishReason:payload.choices?.[0]?.finish_reason||null,reasoningTokens:payload.usage?.completion_tokens_details?.reasoning_tokens??null,at:new Date().toISOString()}];
           await saveDb(db);continue;
          }
          try { parsed = parseGeneration(raw); generatedBody = parsed.body; break; } catch (error) { parsed = undefined; lastError = error instanceof Error ? error.message : String(error); }
        }
        if (!parsed) throw new Error(lastError || 'model_output_quality_too_low');
        const draftTitle=parsed.title;
        parsed=await finishHookWriting({db,job,run,saveDb,dataDir,dna:prompt.dna},hookPrepared,parsed);generatedBody=parsed.body;
        if (job.status === '已取消') {
          run.state = 'cancelled'; run.finishedAt = new Date().toISOString(); run.error = 'job_cancelled_response_not_applied';
          await saveDb(db); return json(res, 409, { error: 'job_cancelled', runId: run.id });
        }
        if (bodyHash(job.body) !== initialBodyHash || auditConfigHash(job) !== initialConfigHash || draftContext(db,job).user !== prompt.user || draftContext(db,job).system !== prompt.system) {
          run.state='conflict';run.finishedAt=new Date().toISOString();run.generatedBody=generatedBody;await saveDb(db);return json(res,409,{error:'draft_changed_during_generation',runId:run.id});
        }
        invalidateAudit(db, job.id);
        const version = { hookSources:run.hookRetrieval||null,hookPlan:run.hookPlan,hookValidation:run.hookValidation,writingDna:run.writingDna||null,coverage:run.coverage||null,writingKnowledge:run.writingKnowledge||null,id: id('ver'), jobId: job.id, body: generatedBody, corePoint: parsed.corePoint || '', needsVerification: parsed.needsVerification || [], knowledgeSnapshot, sourceSnapshot: prompt.refs, templateSnapshot: structuredClone(template), parentVersionId: db.versions.find(v=>v.jobId===job.id)?.id || null, reason: 'Gemini 生成', inputHash, model, usage: run.usage || null, rawResponse: [...(run.responses||[])].reverse().find(r=>r.phase==='body'||!r.phase)?.raw || null, createdAt: new Date().toISOString() }; db.versions.unshift(version); job.title=generatedTitle({...parsed,title:parsed.title||draftTitle});version.title=job.title; job.body = version.body; job.status = '待审核'; job.issues = run.hookValidation?.needsHumanReview?(run.hookValidation.reviewIssues||[]).length:0; if(run.hookValidation?.needsHumanReview){job.needsHumanReview=true;job.autoCheckNote=run.hookValidation.reviewNote;job.autoCheckIssues=(run.hookValidation.reviewIssues||[]).slice(0,6);}else{delete job.needsHumanReview;delete job.autoCheckNote;delete job.autoCheckIssues;} job.updatedAt = '刚刚'; run.state = 'succeeded'; run.finishedAt = new Date().toISOString(); run.model = model; await saveDb(db); return json(res, 201, { job, version, reused: false });
      } catch (error) { run.state = run.awaitingResponse ? 'unknown' : 'failed'; run.finishedAt = new Date().toISOString(); run.error = error instanceof Error ? error.message : String(error); await saveDb(db); return json(res, run.awaitingResponse||/^model_http_/.test(run.error)?502:422, { error: run.state === 'unknown' ? 'generation_outcome_unknown' : 'generation_failed', detail: run.error, runId: run.id }); }
    }
    if (req.method === 'PATCH' && url.pathname.match(/^\/api\/studio\/writing\/jobs\/[^/]+$/)) {
      const job = db.jobs.find(item => item.id === decodeURIComponent(url.pathname.split('/')[5]));
      if (!job) return json(res, 404, { error: 'job_not_found' });
      const input = await body(req); const template = db.templates.find(item => item.id === input.templateId && item.active);
      if(input.templateId && !template)return json(res,400,{error:'active_template_required'});
      const config=writingConfig(input,db,job);
      if(input.durationSeconds!==undefined&&input.durationSeconds!==null&&input.durationSeconds!==''&&(!Number.isFinite(Number(input.durationSeconds))||Number(input.durationSeconds)<15||Number(input.durationSeconds)>600))return json(res,400,{error:'duration_must_be_15_to_600_seconds'});
      if(input.durationSeconds!==undefined)input.durationSeconds=input.durationSeconds===null||input.durationSeconds===''?null:Number(input.durationSeconds);
      const changed = JSON.stringify(config)!==JSON.stringify(writingConfig({},db,job)) || Boolean(template&&JSON.stringify(template)!==JSON.stringify(job.templateSnapshot)) || ['body','title','hook','durationSeconds','originalBody','writingInstruction','creationMode'].some(key=>input[key]!==undefined&&input[key]!==job[key]);
      if(input.creationMode!==undefined&&!['rewrite','topic'].includes(input.creationMode))return json(res,400,{error:'invalid_creation_mode'});
      Object.assign(job,config);
      if(changed){invalidateAudit(db,job.id);job.status='待审核';job.updatedAt='刚刚';}
      if (typeof input.body==='string' && input.body!==job.body) db.versions.unshift({id:id('ver'),jobId:job.id,body:input.body,parentVersionId:db.versions.find(v=>v.jobId===job.id)?.id||null,reason:'用户编辑',createdAt:new Date().toISOString()});
      if (template) { job.template = template.name; job.templateVersionId = template.id; job.templateSnapshot = JSON.parse(JSON.stringify(template)); job.platform = template.platform; job.format = template.kind; job.updatedAt = '刚刚'; }
      if (typeof input.title === 'string') {if(input.title.trim()!==job.title)job.writingInputTitle=input.title.trim();job.title = input.title.trim();}
      if(typeof input.topic==='string')job.topic=input.topic;
      if (typeof input.hook === 'string') job.hook = input.hook;
      if (input.durationSeconds !== undefined) job.durationSeconds = input.durationSeconds === null || input.durationSeconds === '' ? null : Number(input.durationSeconds);
      if (typeof input.scriptStatus === 'string' && ['未拍摄','已拍摄','已发布'].includes(input.scriptStatus)) job.scriptStatus = input.scriptStatus;
      if (typeof input.body === 'string') job.body = input.body;
      for(const key of ['originalBody','writingInstruction','creationMode'])if(typeof input[key]==='string')job[key]=input[key];
      if (template || Object.hasOwn(input,'title') || Object.hasOwn(input,'topic') || input.hook !== undefined || input.durationSeconds !== undefined || input.scriptStatus || input.body !== undefined) { job.updatedAt = '刚刚'; await saveDb(db); }
      if(changed || Object.keys(config).length)await saveDb(db);
      return json(res, 200, job);
    }
    if (req.method === 'PATCH' && url.pathname.match(/^\/api\/studio\/jobs\/[^/]+\/status$/)) {
      const job = db.jobs.find(item => item.id === decodeURIComponent(url.pathname.split('/')[4])); if (!job) return json(res, 404, { error: 'job_not_found' });
      const input = await body(req); const allowed = ['草稿', '待审核', '待人工确认', '已定稿', '已发布', '已取消', '失败'];
      if(['已定稿','已发布'].includes(input.status))return json(res,409,{error:'use_finalize_or_publication_workflow'});
      if (!allowed.includes(input.status)) return json(res, 400, { error: 'invalid_job_status' });
      if (['已发布', '已定稿'].includes(job.status) && input.status === '已取消') return json(res, 409, { error: 'published_job_cannot_cancel' });
      const previousStatus = job.status; job.status = input.status; job.statusReason = input.reason || null; job.updatedAt = '刚刚'; db.taskRuns.unshift({ id: id('run'), jobId: job.id, taskKind: 'status-change', state: input.status === '失败' ? 'failed' : input.status === '已取消' ? 'cancelled' : 'succeeded', previousStatus, nextStatus: input.status, reason: input.reason || null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), cost: 0 }); await saveDb(db); return json(res, 200, job);
    }
    if (req.method === 'PATCH' && url.pathname.match(/^\/api\/studio\/jobs\/[^/]+\/archive$/)) {
      const job = db.jobs.find(item => item.id === decodeURIComponent(url.pathname.split('/')[4])); if (!job) return json(res,404,{error:'job_not_found'});
      job.archived = true; job.updatedAt = '刚刚'; await saveDb(db); return json(res,200,job);
    }
    if (req.method === 'PATCH' && url.pathname.match(/^\/api\/studio\/jobs\/[^/]+\/restore-visibility$/)) {
      const job = db.jobs.find(item => item.id === decodeURIComponent(url.pathname.split('/')[4])); if (!job) return json(res,404,{error:'job_not_found'});
      job.archived = false; job.hidden = false; job.updatedAt = '刚刚'; await saveDb(db); return json(res,200,job);
    }
    if (req.method === 'PATCH' && url.pathname.match(/^\/api\/studio\/jobs\/[^/]+\/visibility$/)) {
      const job = db.jobs.find(item => item.id === decodeURIComponent(url.pathname.split('/')[4])); if (!job) return json(res,404,{error:'job_not_found'});
      const input=await body(req); if(!['visible','hidden'].includes(input.visibility))return json(res,400,{error:'invalid_job_visibility'}); job.hidden=input.visibility==='hidden';job.updatedAt='刚刚';await saveDb(db);return json(res,200,job);
    }
    if (req.method === 'POST' && url.pathname === '/api/studio/writing/versions') {
      const input = await body(req); const job = db.jobs.find(item => item.id === input.jobId);
      if (!job) return json(res, 404, { error: 'job_not_found' });
      const version = { id: id('ver'), jobId: job.id, body: String(input.body || ''), parentVersionId: db.versions.find(item=>item.jobId===job.id)?.id || null, reason: input.reason || '用户编辑', createdAt: new Date().toISOString() };
      if (job.body !== version.body) invalidateAudit(db,job.id);
      job.body = version.body; job.status = '待审核'; job.issues = 0; job.updatedAt = '刚刚'; db.versions.unshift(version); await saveDb(db); return json(res, 201, version);
    }
    if (req.method === 'POST' && url.pathname === '/api/studio/writing/finalize') {
      const input = await body(req); const job = db.jobs.find(item => item.id === input.jobId);
      if (!job) return json(res, 404, { error: 'job_not_found' });
      if (job.status === '已取消') return json(res,409,{error:'job_cancelled'});
      if (input.body !== undefined && input.body !== job.body) return json(res,409,{error:'save_and_audit_before_finalize'});
      if (inspectDraft(job.body).some(item=>item.blocking)) return json(res,409,{error:'blocking_audit_issues'});
      const lastAudit=db.auditRuns.find(item=>item.jobId===job.id);
      if (!lastAudit || lastAudit.state!=='completed' || lastAudit.bodyHash!==bodyHash(job.body) || lastAudit.configHash!==auditConfigHash(job)) return json(res,409,{error:'audit_required_for_current_body'});
      if(job.auditEngine==='model'&&lastAudit.engine!=='skill-guided-model')return json(res,409,{error:'selected_model_audit_required'});
      if (db.auditIssues.some(item=>item.jobId===job.id && item.blocking && item.status!=='已归档' && item.status!=='已接受')) return json(res,409,{error:'blocking_audit_issues'});
      if (db.auditIssues.some(item=>item.jobId===job.id && item.status==='待处理'))return json(res,409,{error:'resolve_audit_issues_before_finalize'});
      if (db.auditIssues.some(item=>item.jobId===job.id && item.status==='待重新验证')) return json(res,409,{error:'audit_requires_revalidation'});
      const template = job.templateSnapshot || db.templates.find(item => item.id === job.templateVersionId) || {};
      const rules = template.rules || [];
      const hardViolations = rules.filter(rule => rule.includes('不得虚构个人经历') && /我曾|我亲自|我的经历/.test(String(input.body || job.body)));
      if (hardViolations.length) return json(res, 409, { error: 'hard_rule_blocked', rules: hardViolations });
      if (typeof input.body === 'string' && input.body !== job.body) {
        db.versions.unshift({ id: id('ver'), jobId: job.id, body: input.body, parentVersionId: null, reason: '定稿确认', createdAt: new Date().toISOString() });
        job.body = input.body;
      }
      job.status = '已定稿'; job.updatedAt = '刚刚'; await saveDb(db); return json(res, 200, job);
    }
    if (req.method === 'POST' && url.pathname.match(/^\/api\/studio\/jobs\/[^/]+\/restore$/)) {
      const job = db.jobs.find(item => item.id === decodeURIComponent(url.pathname.split('/')[4])); if (!job) return json(res, 404, { error: 'job_not_found' });
      const input = await body(req); const version = db.versions.find(item => item.id === input.versionId && item.jobId === job.id); if (!version) return json(res, 404, { error: 'version_not_found' });
      invalidateAudit(db,job.id);db.versions.unshift({ id: id('ver'), jobId: job.id, body: version.body, parentVersionId: version.id, reason: '恢复历史版本', createdAt: new Date().toISOString() }); job.body = version.body; job.status = '待审核'; job.issues = 0; job.updatedAt = '刚刚'; await saveDb(db); return json(res, 200, job);
    }
    if (req.method === 'POST' && url.pathname === '/api/studio/imports/preview') {
      const input = await readImportFile(await body(req)); const text = String(input.text || '').trim();
      const hash = createHash('sha256').update(text, 'utf8').digest('hex');
      const extension = String(input.name || '').split('.').pop()?.toLowerCase() || 'txt';
      const supported = ['md', 'txt', 'docx', 'csv', 'xlsx', 'json', 'jsonl'];
      const preview = { id: id('import'), name: input.name || '未命名素材', type: input.type || '写作案例库', extension, supported: supported.includes(extension), text, hash, duplicate: db.documents.some(item => item.hash === hash || item.name === (input.name || '未命名素材')), chunks: text ? Math.max(1, Math.ceil(text.length / 420)) : 0, state: '待确认', createdAt: new Date().toISOString() };
      if (!text) return json(res, 400, { error: 'empty_document' });
      if(!preview.supported)return json(res,400,{error:'unsupported_file_type'});
      db.importPreviews.unshift(preview); await saveDb(db); return json(res, 201, { ...preview, warnings: [...(text ? [] : ['正文为空']), ...(!preview.supported ? [`暂不支持 .${extension} 的浏览器直读，请转换为 Markdown/TXT 后再导入`] : [])] });
    }
    if (req.method === 'POST' && url.pathname === '/api/studio/imports/douyin/preview') {
      const input = await readImportFile(await body(req)); const rows = parseImportRows(input);
      const normalized = rows.map(normalizeMaterial);
      const preview = { id: id('douyin-import'), type: 'douyin-material', rows: normalized, count: normalized.length, unknownPlayCount: normalized.filter(row => !row.playCountKnown).length, state: '待确认', createdAt: new Date().toISOString() };
      db.importPreviews.unshift(preview); await saveDb(db); return json(res, 201, { id: preview.id, count: preview.count, unknownPlayCount: preview.unknownPlayCount, warnings: preview.unknownPlayCount ? ['抖音播放量缺失或不可验证，已按未知处理，不会用点赞折算成播放量。'] : [] });
    }
    if (req.method === 'POST' && url.pathname === '/api/studio/imports/douyin/commit') {
      const input = await body(req); const preview = db.importPreviews.find(item => item.id === input.previewId && item.type === 'douyin-material'); if (!preview) return json(res, 404, { error: 'douyin_preview_not_found' });
      if (preview.commitResult) return json(res,200,{...preview.commitResult,reused:true});
      const documents = preview.rows.map(row => ({ id: id('doc'), name: row.title, type: '写作案例库', factRole:'外部写作案例·不可作为本人经历', licenseScope:'内部研究，不自动发布', assetCreated:true,batchId:preview.id, externalId:row.externalId, collectCount:row.collectCount, commentCount:row.commentCount, shareCount:row.shareCount, comments:row.comments, transcriptState:row.transcriptState, content: row.transcript, source: 'douyin-material-pipeline', author: row.author, url: row.url, publishedAt: row.publishedAt, diggCount: row.diggCount, playCount: row.playCountKnown ? row.playCount : null, playCountKnown: row.playCountKnown, chunks: row.transcript ? Math.max(1, Math.ceil(row.transcript.length / 420)) : 0, version: 1, updatedAt: '刚刚', tag: row.playCountKnown ? '已导入' : '播放量未知' }));
      const existingDocs=new Map(db.documents.filter(doc=>doc.source==='douyin-material-pipeline').map(doc=>[doc.externalId?`douyin:${doc.externalId}`:doc.importHash,doc]));
      let updated=0;let duplicates=0;
      for(let index=documents.length-1;index>=0;index-=1){
        const doc=documents[index];doc.importHash=createHash('sha256').update(JSON.stringify([doc.url,doc.name,doc.content])).digest('hex');
        const key=doc.externalId?`douyin:${doc.externalId}`:doc.importHash;const existing=existingDocs.get(key);
        if(existing){
          const hasNewContent=Boolean(doc.content)&&doc.content!==existing.content;
          const hasNewComments=doc.comments?.length>0&&JSON.stringify(doc.comments)!==JSON.stringify(existing.comments||[]);
          const hasNewMetrics=['author','url','publishedAt','diggCount','collectCount','commentCount','shareCount','playCount'].some(key=>doc[key]!==null&&doc[key]!==undefined&&doc[key]!==''&&doc[key]!==existing[key]);
          if(hasNewContent||hasNewComments||hasNewMetrics){
            db.documentVersions.unshift({...structuredClone(existing),documentId:existing.id,snapshotId:id('docver'),savedAt:new Date().toISOString()});
            const next={...doc,id:existing.id,version:(existing.version||1)+1,content:hasNewContent?doc.content:existing.content,comments:hasNewComments?doc.comments:existing.comments};
            if(preview.rows[index].titleKnown===false)next.name=existing.name;
            if(!hasNewContent)next.transcriptState=existing.transcriptState;
            for(const field of ['author','url','publishedAt','diggCount','collectCount','commentCount','shareCount','playCount'])if(next[field]===null||next[field]===undefined||next[field]==='')next[field]=existing[field]??next[field];
            next.playCountKnown=Number.isFinite(next.playCount);
            next.importHash=createHash('sha256').update(JSON.stringify([next.url,next.name,next.content])).digest('hex');
            Object.assign(existing,next);updated++;
            const source=db.sources.find(source=>source.id===existing.id||source.documentId===existing.id);if(source)Object.assign(source,documentSource(existing));
          }else duplicates++;
          documents.splice(index,1);
        }else existingDocs.set(key,doc);
      }
      preview.commitResult={count:documents.length,updated,duplicates,unknownPlayCount:documents.filter(doc=>!doc.playCountKnown).length};
      db.documents.unshift(...documents); db.sources.unshift(...documents.map(doc => ({ id: doc.id, documentId:doc.id, role:doc.factRole, title: doc.name, source: 'douyin-material-pipeline', publishedAt: doc.publishedAt || '刚刚', summary: doc.content.slice(0, 180), content: doc.content, url: doc.url || `file://douyin/${encodeURIComponent(doc.name)}`, status: '素材库', origin: 'douyin-import', playCount: doc.playCount, playCountKnown: doc.playCountKnown }))); preview.state = '已入库'; db.taskRuns.unshift({ id: id('run'), taskKind: 'douyin-import', state: 'succeeded', startedAt: preview.createdAt, finishedAt: new Date().toISOString(), cost: 0, count: documents.length, unknownPlayCount: documents.filter(doc => !doc.playCountKnown).length }); await saveDb(db); return json(res, 201, preview.commitResult);
    }
    if (req.method === 'POST' && url.pathname === '/api/studio/imports/commit') {
      const input = await body(req); const preview = db.importPreviews.find(item => item.id === input.previewId);
      if (!preview) return json(res, 404, { error: 'preview_not_found' });
      if (preview.documentId) return json(res,200,{...db.documents.find(doc=>doc.id===preview.documentId),reused:true});
      if (['douyin-material','feishu-export'].includes(preview.type)) return json(res,400,{error:'wrong_import_commit_endpoint'});
      if (db.documents.some(doc=>doc.hash===preview.hash)) return json(res,409,{error:'duplicate_document'});
      if (db.documents.some(doc=>doc.name===preview.name) && !input.allowDuplicate) return json(res, 409, { error: 'duplicate_document', preview });
      const previousVersions = db.documents.filter(item => item.name === preview.name || item.hash === preview.hash); const document = { id: id('doc'), name: preview.name, type: preview.type, content: preview.text, hash: preview.hash, chunks: preview.chunks, version: previousVersions.length + 1, updatedAt: '刚刚', source: '本地导入', tag: previousVersions.length ? `新版本 v${previousVersions.length + 1}` : 'AI 提取·未确认' };
      preview.documentId=document.id;
      db.documents.unshift(document); db.sources.unshift({ id: document.id, documentId:document.id, role:document.type==='事实库'?'外部事实·需核验':'参考资料·不可作为本人经历', title: preview.name, source: '本地导入', publishedAt: '刚刚', summary: preview.text.slice(0, 180), content: preview.text, hash: preview.hash, url: `file://imports/${encodeURIComponent(preview.name)}`, status: '知识库' }); preview.state = '已入库'; await saveDb(db); return json(res, 201, document);
    }
    if (req.method === 'POST' && url.pathname === '/api/studio/templates') {
      const input = await body(req); const previous = input.id ? db.templates.find(item => item.id === input.id) : null;
      if(input.id&&!previous)return json(res,404,{error:'template_not_found'});
      const reviewMode = input.reviewMode ?? previous?.reviewMode ?? '手动';
      const maxRevisionRounds = Number(input.maxRevisionRounds ?? previous?.maxRevisionRounds ?? 1);
      if (!['手动','自动建议后人工确认'].includes(reviewMode) || !Number.isInteger(maxRevisionRounds) || maxRevisionRounds < 1 || maxRevisionRounds > 3) return json(res,400,{error:'invalid_audit_configuration'});
      const nextVersion = previous ? Number(String(previous.version || 'v0').replace(/^v/, '')) + 1 : 1;
      const scopedConfig=writingConfig(input,db,previous||{});
      const template = { ...Object.fromEntries(['distillationRunId','writingOrigin'].filter(key=>previous?.[key]!==undefined).map(key=>[key,structuredClone(previous[key])])),...scopedConfig, id: id('tpl'), name: input.name || previous?.name || '未命名模板', platform: input.platform || previous?.platform || 'X', kind: input.kind || previous?.kind || '短帖', version: `v${nextVersion}`, active: input.active !== false, bindings: input.bindings || previous?.bindings || ['事实库'], audits: input.audits || previous?.audits || ['dbs-ai-check'], prompt: input.prompt ?? previous?.prompt ?? '', rules: input.rules ?? previous?.rules ?? [], previousVersionId: previous?.id || null, createdAt: new Date().toISOString() };
      if (previous) previous.active = false;
      template.reviewMode = reviewMode; template.maxRevisionRounds = maxRevisionRounds;
      db.templates.unshift(template); await saveDb(db); return json(res, 201, template);
    }
    if (req.method === 'POST' && url.pathname === '/api/studio/audits') {
      const input = await body(req); const job = db.jobs.find(item => item.id === input.jobId); if (!job) return json(res, 404, { error: 'job_not_found' });
      if(job.status==='已取消')return json(res,409,{error:'job_cancelled'});
      db.auditIssues.filter(item => item.jobId === job.id && ['待处理', '待重新验证'].includes(item.status)).forEach(item => { item.status = '已归档'; });
      const template=job.templateSnapshot||db.templates.find(item=>item.id===job.templateVersionId)||{};
      if(db.integration?.auditConfig)job.auditSkills=[...db.integration.auditConfig.skills];
      const report=runSkillPipeline(job,{...template,audits:job.auditSkills??template.audits}); const issues=mergeAuditIssues([...inspectDraft(job.body),...report.issues]).map(item=>({...item,id:id('issue'),jobId:job.id,bodyHash:bodyHash(job.body),status:'待处理'}));
      db.auditIssues.push(...issues);
      const auditRun = { id: id('audit'), jobId: job.id, skills:[...new Set([...report.skills,'local-placeholder-check','local-empty-check'])],skillRuns:report.runs,engine:'local-rules',license:SKILL_LICENSE,bodyHash:bodyHash(job.body),configHash:auditConfigHash(job),state:report.runs.some(run=>run.state==='failed')?'failed':'completed',createdAt:new Date().toISOString(),issueIds:issues.map(item=>item.id),rawReport:structuredClone(issues) }; db.auditRuns.unshift(auditRun); db.taskRuns.unshift({id:id('run'),jobId:job.id,taskKind:'audit',state:auditRun.state==='completed'?'succeeded':'failed',startedAt:auditRun.createdAt,finishedAt:auditRun.createdAt,cost:0,inputHash:auditRun.bodyHash}); job.status='待人工确认';job.issues=issues.length;job.skillExecutionState='已执行本地快检（非原 Skill 执行）';job.updatedAt='刚刚';await saveDb(db);return json(res,200,{job,issues,auditRun});
    }
    if (req.method === 'PATCH' && url.pathname.match(/^\/api\/studio\/audit-issues\/[^/]+$/)) {
      const issue = db.auditIssues.find(item => item.id === url.pathname.split('/')[4]); if (!issue) return json(res, 404, { error: 'issue_not_found' });
      const input = await body(req); const job = db.jobs.find(item => item.id === issue.jobId);
      if (issue.blocking && input.action==='ignore') return json(res,409,{error:'blocking_issue_cannot_ignore'});
      if (!['rewrite','ignore'].includes(input.action)) return json(res,400,{error:'invalid_audit_action'});
      if (!job || issue.status!=='待处理' || issue.bodyHash!==bodyHash(job.body)) return json(res,409,{error:'audit_issue_stale'});
      if (input.action==='rewrite') {
        const location=issue.location;
        if (!location || !issue.quote || job.body.slice(location.start,location.end)!==issue.quote) return json(res,409,{error:'quoted_span_not_found'});
        const replacement=input.replacement ?? issue.replacement;
        if (typeof replacement!=='string') return json(res,400,{error:'replacement_required'});
        const nextBody=job.body.slice(0,location.start)+replacement+job.body.slice(location.end);
        db.versions.unshift({id:id('ver'),jobId:job.id,body:nextBody,parentVersionId:db.versions.find(item=>item.jobId===job.id)?.id || null,reason:`接受审核建议 ${issue.skill}`,createdAt:new Date().toISOString()});
        invalidateAudit(db,job.id);job.body=nextBody;job.status='待重新验证';
      }
      issue.status = input.action === 'ignore' ? '已忽略' : input.action === 'rewrite' ? '已接受' : '待重新验证'; issue.updatedAt = new Date().toISOString(); if (job) { job.issues = db.auditIssues.filter(item => item.jobId === job.id && item.status === '待处理').length; job.updatedAt = '刚刚'; } await saveDb(db); return json(res, 200, { issue, job });
    }
    if (req.method === 'POST' && url.pathname === '/api/studio/publications') {
      const input=await body(req);const job=db.jobs.find(item=>item.id===input.jobId);
      if(!job)return json(res,404,{error:'job_not_found'});
      if(!['已定稿','已发布'].includes(job.status))return json(res,409,{error:'finalize_before_publication'});
      let publicationUrl;try{publicationUrl=new URL(input.url);if(!['https:','http:'].includes(publicationUrl.protocol))throw new Error();}catch{return json(res,400,{error:'valid_publication_url_required'});}
      const prior=db.publications.find(item=>item.jobId===job.id&&item.url===publicationUrl.href);if(prior)return json(res,200,{...prior,reused:true});
      const publication={id:id('pub'),jobId:job.id,title:job.title,platform:job.platform,url:publicationUrl.href,publishedAt:input.publishedAt||new Date().toISOString(),body:job.body,versionId:db.versions.find(v=>v.jobId===job.id)?.id||null,sourceSnapshot:sourceSnapshot(job,db),createdAt:new Date().toISOString()};db.publications.unshift(publication);job.status='已发布';job.updatedAt='刚刚';
      await saveDb(db); return json(res, 201, publication);
    }
    if (req.method === 'POST' && url.pathname.match(/^\/api\/studio\/publications\/[^/]+\/metrics$/)) {
      const publication = db.publications.find(item => item.id === url.pathname.split('/')[4]); if (!publication) return json(res, 404, { error: 'publication_not_found' });
      const values=await body(req);const metrics={};for(const key of ['impressions','likes','replies','reposts','bookmarks','follows','dms','leads']){if(values[key]===undefined)continue;if(values[key]===null||values[key]===''){metrics[key]=null;continue;}const n=Number(values[key]);if(!Number.isFinite(n)||n<0)return json(res,400,{error:'invalid_metric',field:key});metrics[key]=n;}
      publication.metrics = { ...(publication.metrics || {}), ...metrics, observedAt: new Date().toISOString() }; await saveDb(db); return json(res, 200, publication);
    }
    if (req.method === 'POST' && url.pathname.match(/^\/api\/studio\/publications\/[^/]+\/retrospective$/)) {
      const publication = db.publications.find(item => item.id === url.pathname.split('/')[4]); if (!publication) return json(res, 404, { error: 'publication_not_found' });
      const input = await body(req); publication.retrospective = { facts: String(input.facts || ''), inferences: String(input.inferences || ''), validation: String(input.validation || ''), updatedAt: new Date().toISOString() }; await saveDb(db); return json(res, 200, publication);
    }
    return json(res, 404, { error: 'not_found' });
  }
  const safePath = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^([.][.][/\\])+/, '');
  const file = join(publicDir, safePath); if (!file.startsWith(publicDir)) return json(res, 403, { error: 'forbidden' });
  try { const content = await readFile(file); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' }; res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control':'no-store' }); res.end(content); } catch { json(res, 404, { error: 'not_found' }); }
}

createServer((req, res) => handle(req, res).catch(error => { console.error(error); json(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'internal_error' }); })).listen(port, host, () => console.log(`AI Content Studio: http://localhost:${port}`));

async function refreshIntelligenceCache(){try{const db=await loadDb();if(!aihotBaseUrl)return;await syncIntelligence({db,baseUrl:aihotBaseUrl,databaseUrl:aihotDbUrl,saveDb});void translateIntelligence({db,saveDb}).catch(error=>console.error('Intelligence translation:',error.message));}catch(error){console.error('Intelligence refresh:',error.message);}}
setTimeout(refreshIntelligenceCache,3000).unref();setInterval(refreshIntelligenceCache,5*60*1000).unref();
