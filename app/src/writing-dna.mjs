import {executePrecisionDna,PRECISION_DNA_SPEC} from './writing-dna-engine.mjs';
import {dnaExportFiles,dnaZip} from './writing-dna-files.mjs';
import {fileURLToPath} from 'node:url';
import {modelFetch as fetch} from './model-transport.mjs';
import {readFileSync} from 'node:fs';
import {hash,uid} from './workflow.mjs';
import {modelEnv} from './model-profiles.mjs';
import {normalizeMaterial} from './materials.mjs';
import {parseStructuredOutput} from './structured-output.mjs';

export const dnaMethodSource='https://github.com/larashero3-dotcom/writing-dna-skill';
// 蒸馏规格版本：方法或产物规格一变，旧结果就不能再当作同一份结论复用
export const DNA_SPEC_VERSION=PRECISION_DNA_SPEC;
const method=readFileSync(new URL('../prompts/writing-dna-method.md',import.meta.url),'utf8');
export function dnaCorpus(task){return (task.rows||[]).map((row,index)=>{const v=normalizeMaterial(row);return {id:String(v.externalId||index),title:v.title,date:v.publishedAt,author:v.author,url:v.url,transcriptState:v.transcriptState,content:String(row.transcript||row.content||'').trim()};}).filter(v=>v.content);}
// 自动转写稿的标点/分段是工具产物，不是作者指纹：蒸馏与写作都必须能区分来源
export const autoTranscript=v=>/^(auto|asr|whisper|machine)/i.test(String(v||''));
// 语料 + 方法 + 规格三者任一变化，都不应命中旧结论
export function dnaSourceHash(corpus){return hash(JSON.stringify({corpus,method:hash(method),spec:DNA_SPEC_VERSION}));}
export function dnaBatches(corpus,max=6000){
 const batches=[];let batch=[],size=0;
 for(const doc of corpus)for(let offset=0;offset<doc.content.length;offset+=max){const part={...doc,part:offset/max+1,content:doc.content.slice(offset,offset+max)};if(batch.length&&(size+part.content.length>max||batch.length>=8)){batches.push(batch);batch=[];size=0;}batch.push(part);size+=part.content.length;}
 if(batch.length)batches.push(batch);return batches;
}
export function dnaStats(corpus){const text=corpus.map(d=>d.content).join('\n');const corpusCharCount=text.length,sentences=text.split(/[。！？!?\n]+/).map(s=>s.trim()).filter(Boolean);const words=new Map();for(const doc of corpus)for(const {segment,isWordLike} of new Intl.Segmenter('zh',{granularity:'word'}).segment(doc.content)){if(isWordLike&&segment.length>1)words.set(segment,(words.get(segment)||0)+1);}
 // 段落与小标题：skill 要求「段落平均句数 / 小标题平均字数」，不能只给句长
 const paragraphs=text.split(/\n+/).map(v=>v.trim()).filter(Boolean);
 const headings=paragraphs.filter(line=>/^#{1,6}\s/.test(line)||(line.length<=20&&!/[。！？，；：]$/.test(line)));
 const latin=(text.match(/[A-Za-z]/g)||[]).length;
 const stats={articles:corpus.length,characters:corpusCharCount,averageSentenceLength:sentences.length?+(sentences.reduce((s,v)=>s+v.length,0)/sentences.length).toFixed(1):0,shortSentenceRatio:sentences.length?+(sentences.filter(s=>s.length<=15).length/sentences.length).toFixed(3):0,longSentenceRatio:sentences.length?+(sentences.filter(s=>s.length>=50).length/sentences.length).toFixed(3):0,paragraphs:paragraphs.length,averageParagraphSentences:paragraphs.length?+(sentences.length/paragraphs.length).toFixed(2):0,averageHeadingChars:headings.length?+(headings.reduce((s,v)=>s+v.replace(/^#{1,6}\s*/,'').length,0)/headings.length).toFixed(1):0,headingRatio:paragraphs.length?+(headings.length/paragraphs.length).toFixed(3):0,latinCharRatio:corpusCharCount?+(latin/corpusCharCount).toFixed(3):0,dashVsParen:`${text.split('——').length-1}:${text.split('（').length-1}`,punctuation:Object.fromEntries(['，','。','！','？','：','；','——','（','“'].map(p=>[p,text.split(p).length-1])),frequentWords:[...words].sort((a,b)=>b[1]-a[1]).slice(0,100),transcriptStates:[...new Set(corpus.map(d=>d.transcriptState||'unknown'))]};
 // 数字必须能进产物，否则「词频表」只剩形容词
 stats.factSheet=`全文 ${stats.characters} 字 / ${stats.articles} 篇；平均句长 ${stats.averageSentenceLength} 字；短句占 ${(stats.shortSentenceRatio*100).toFixed(1)}%；长句占 ${(stats.longSentenceRatio*100).toFixed(1)}%；段落 ${stats.paragraphs} 个，段均 ${stats.averageParagraphSentences} 句；疑似小标题 ${headings.length} 个，平均 ${stats.averageHeadingChars} 字（占比 ${(stats.headingRatio*100).toFixed(1)}%）；拉丁字符占 ${(stats.latinCharRatio*100).toFixed(1)}%；破折号:括号 = ${stats.dashVsParen}；词频前 20：${stats.frequentWords.slice(0,20).map(([w,n])=>w+'×'+n).join('、')}`;
 return stats;}
const isPatternItem=v=>v&&typeof v==='object'&&!Array.isArray(v)&&typeof v.quote==='string'&&typeof v.rule==='string';
const isMetadataItem=v=>v&&typeof v==='object'&&!Array.isArray(v)&&!isPatternItem(v)&&['article_type','hook_type','structure_pattern'].some(k=>k in v);
export function stitchDnaFragments(candidates){
 const objects=candidates.filter(v=>v&&typeof v==='object'&&!Array.isArray(v));
 const patternItems=objects.filter(isPatternItem),metadataItems=objects.filter(isMetadataItem);
 if(!patternItems.length&&!metadataItems.length)return null;
 const merged={};
 for(const v of objects.filter(o=>!isPatternItem(o)&&!isMetadataItem(o)))for(const [k,val] of Object.entries(v)){if(Array.isArray(merged[k])&&Array.isArray(val))merged[k]=[...merged[k],...val];else if(!(k in merged))merged[k]=val;}
 if(metadataItems.length)merged.metadata=[...(Array.isArray(merged.metadata)?merged.metadata:[]),...metadataItems];
 if(patternItems.length)merged.patterns=[...(Array.isArray(merged.patterns)?merged.patterns:[]),...patternItems];
 return merged;
}
export function parseDnaBatch(raw,docs){return parseStructuredOutput(raw,value=>{
 if(!Array.isArray(value.metadata)||!Array.isArray(value.patterns)||!value.patterns.length||typeof value.findings!=='string'||value.findings.length>9000)throw Error('invalid_dna_batch');
 const sameRef=(a,b)=>String(a.id)===String(b.id)&&Number(a.part)===Number(b.part);
 value.metadata=value.metadata.filter(m=>docs.some(d=>sameRef(d,m)));
 if(docs.some(d=>!value.metadata.some(m=>sameRef(m,d))))throw Error('dna_metadata_incomplete');
 if(value.metadata.some(m=>['article_type','hook_type','structure_pattern'].some(k=>typeof m[k]!=='string')||!Array.isArray(m.topic_tags)||!Array.isArray(m.source_types)))throw Error('invalid_dna_metadata');
 const valid=p=>typeof p.rule==='string'&&typeof p.quote==='string'&&p.quote.length>=2&&docs.some(d=>d.id===p.id&&d.content.includes(p.quote));
 const rejected=value.patterns.filter(p=>!valid(p));value.patterns=value.patterns.filter(valid);if(!value.patterns.length)throw Error('dna_evidence_not_in_source');if(rejected.length)value.rejectedPatterns=rejected.map(p=>({...p,reason:'未在对应原文找到，已排除，不作为写法证据'}));
 return value;
},stitchDnaFragments);}
export function parseDnaReport(raw){return parseStructuredOutput(raw,v=>{
 // 分层产物是写作时的实际输入，不能压成 200 字摘要：给下限，并要求结构/命题/统计可核对
 const size={language:[500,12000],structure:[500,12000],cognition:[400,12000],visual:[120,12000],prompt:[600,4000]};
 for(const key of ['prompt','language','structure','cognition','visual']){if(typeof v[key]!=='string')throw Error('invalid_dna_report');const len=v[key].trim().length;if(len<size[key][0]||len>size[key][1])throw Error('dna_report_size_'+key);}
 if((v.structure.match(/【[^】]*类型[^】]*】/g)||[]).length<3)throw Error('dna_structure_needs_3_types');
 if((v.cognition.match(/核心命题\s*[1-9１-９一二三四五]/g)||[]).length<3)throw Error('dna_cognition_needs_3_propositions');
 if((v.language.match(/\d+(?:\.\d+)?\s*[%％字]|平均句长|短句|长句/g)||[]).length<3)throw Error('dna_language_needs_stats');
 // DNA 只描述表达/组织/思维习惯；prompt 里混入行业运营策略（投放顺序、平台动作）会在换话题时全面失灵
 if(/投流|直通车|达人合作|铺货|提报|自然流|上架商品|开店|选品/.test(String(v.prompt)))throw Error('dna_prompt_contains_domain_tactics');
 return v;},candidates=>{const merged={};for(const v of candidates.reverse())if(v&&typeof v==='object'&&!Array.isArray(v))for(const [k,val] of Object.entries(v))if(!(k in merged))merged[k]=val;return Object.keys(merged).length?merged:null;});}
export function dnaQuality(run){
 const result=run.result||{},metadata=(run.batches||[]).flatMap(b=>b.metadata||[]);
 const covered=new Set(metadata.map(m=>String(m.id)));
 const articles=run.corpus?.length||0;
 return {articles,batches:run.batches?.length||0,metadataCoverage:run.corpus?.length?+(covered.size/run.corpus.length).toFixed(3):0,structureTypes:(String(result.structure||'').match(/【[^】]*类型[^】]*】/g)||[]).length,propositions:(String(result.cognition||'').match(/核心命题\s*[1-9１-９一二三四五]/g)||[]).length,languageChars:String(result.language||'').length,structureChars:String(result.structure||'').length,cognitionChars:String(result.cognition||'').length,promptChars:String(result.prompt||'').length,autoTranscriptArticles:(run.corpus||[]).filter(d=>autoTranscript(d.transcriptState)).length,provisional:articles<20,checkedAt:new Date().toISOString()};
}

export async function executeDna({db,task,saveDb,fetchModel=fetch,dataDir=fileURLToPath(new URL('../data/',import.meta.url)),analyzePos}){
 const corpus=dnaCorpus(task);if(!corpus.length)throw Error('没有完整正文，请先完成语音转写。');
 const env=modelEnv('distill');if(env.MODEL_CALLS_ENABLED!=='true'||!env.LLM_BASE_URL||!env.LLM_API_KEY||!env.LLM_MODEL)throw Error('请先配置素材提炼用途的模型 API。');
 if(new Set(corpus.map(d=>d.id)).size!==corpus.length)throw Error('语料ID重复，请修正来源后再蒸馏。');
 return executePrecisionDna({db,task,saveDb,fetchModel,corpus,method,spec:DNA_SPEC_VERSION,sourceHash:dnaSourceHash(corpus),stats:dnaStats(corpus),env,uid,hash,dataDir,analyzePos});
}

// 一个 txt／md 里常装几十篇文案：按标题或「两个及以上空行」切篇，避免整份文件被当成 1 篇
const articleSeparator=/\n[ \t]*\n[ \t]*\n+/;
function articleTitle(body,index,fallback){
 const first=(body.split('\n').map(line=>line.replace(/^#{1,6}[ \t]*/,'').trim()).find(Boolean)||'').trim();
 const head=first.length>26?first.slice(0,26)+'…':first;
 return `${head||fallback||'文案'}（第${index+1}篇）`;
}
export function splitTextArticles(text,{collection=false}={}){
 const raw=String(text||'').replace(/\r\n?/g,'\n');
 if(!raw.trim())return [];
 if(collection){const separated=raw.split(/\n[ \t]*\n+/).map(part=>part.trim()).filter(Boolean);if(separated.length>=2&&separated.every(part=>part.length>=80))return separated;}
 const headings=raw.split(/(?=^#{1,3}[ \t]+\S)/m).map(part=>part.trim()).filter(Boolean);
 if(headings.length>=2&&headings.filter(part=>part.length>=80).length>=Math.ceil(headings.length*.6))return headings;
 const pieces=raw.split(articleSeparator).map(part=>part.trim()).filter(Boolean),blocks=[];
 for(const piece of pieces){if(piece.length<20&&blocks.length)blocks[blocks.length-1]+='\n\n'+piece;else blocks.push(piece);}
 const substantial=blocks.filter(block=>block.length>=120).length;
 if(blocks.length>=3&&substantial>=Math.ceil(blocks.length*.6))return blocks;
 if(blocks.length===2&&blocks.every(block=>block.length>=500))return blocks;
 return [raw.trim()];
}
export function dnaTextRows(input){
 const documents=Array.isArray(input.documents)?[...input.documents]:[];
 if(typeof input.text==='string'&&input.text.trim())documents.unshift({name:'自定义文案',text:input.text});
 if(!documents.length||documents.length>200)throw Object.assign(Error('请粘贴文案或上传1—200份 Markdown／TXT 文件。'),{statusCode:400});
 let total=0;const rows=[];
 documents.forEach((doc,index)=>{
  const text=typeof doc.text==='string'?doc.text.trim():'';
  if(!text||text.length>200000)throw Object.assign(Error('每篇文案需有正文，且不超过20万字。'),{statusCode:400});
  let name=String(doc.name||'文案'+(index+1));for(let pass=0;pass<2;pass++){try{const decoded=decodeURIComponent(name);if(decoded===name)break;name=decoded;}catch{break;}}
  const collection=doc.splitMode==='collection'||/(?:原始文案|原始素材|文案合集|文案集合|raw[-_ ]?corpus|transcripts)/i.test(name);
  const articles=splitTextArticles(text,{collection}),single=articles.length===1;
  articles.forEach((body,position)=>{
   total+=body.length;if(total>1000000)throw Object.assign(Error('本次文案总量不能超过100万字。'),{statusCode:400});
   rows.push({externalId:`text-${index}${single?'':'-'+(position+1)}`,title:String(single?name:articleTitle(body,position,name.replace(/\.(md|markdown|txt)$/i,''))).slice(0,200),author:'自定义文案',transcript:body,content:body,transcriptState:'user-provided',sourceFile:name,articleIndex:single?null:position+1,articleCount:articles.length});
  });
 });
 if(rows.length>500)throw Object.assign(Error('识别出的文案超过500篇，请拆分文件后再上传。'),{statusCode:400});
 return rows;
}
export async function writingDnaRoutes({req,res,url,db,json,body,saveDb,startFlow}){
 if(req.method==='POST'&&url.pathname==='/api/studio/writing-dna/import'){
  const input=await body(req);const rows=dnaTextRows(input);const env=modelEnv('distill');if(input.confirmModel!==true||env.MODEL_CALLS_ENABLED!=='true'||!env.LLM_BASE_URL||!env.LLM_API_KEY)throw Object.assign(Error('请先配置蒸馏模型，并通过开始蒸馏启动任务。'),{statusCode:409});
  const now=new Date().toISOString();const task={id:uid('text-distill'),taskKind:'douyin-collect',state:'succeeded',startedAt:now,finishedAt:now,request:{purpose:'writing-dna',mode:'text',urls:[],source:'user-upload'},count:rows.length,rows,logs:`已导入 ${rows.length} 篇文案${Array.isArray(input.documents)&&input.documents.length?`（来自 ${input.documents.length} 个文件，已按空行／标题自动分篇）`:''}，直接蒸馏；不调用采集或语音转写。`,summary:{total:rows.length,coverage:{complete:true,source:'user-upload'}},workflow:{state:'running',step:'imported',options:{transcribe:false,saveLibrary:false,syncFeishu:false,distill:true,confirmModel:true},steps:{}}};db.taskRuns.unshift(task);await saveDb(db);json(res,202,task);if(startFlow)void startFlow(task);return true;
 }
 if(req.method==='POST'&&url.pathname==='/api/studio/writing-dna/split-preview'){
  const input=await body(req);const rows=dnaTextRows(input);
  json(res,200,{count:rows.length,files:Array.isArray(input.documents)?input.documents.length:0,articles:rows.slice(0,80).map(row=>({id:row.externalId,title:row.title,chars:row.transcript.length})),truncated:rows.length>80});return true;
 }
 if(req.method==='GET'&&url.pathname==='/api/studio/writing-dna/history'){
  const items=db.taskRuns.filter(r=>r.taskKind==='douyin-collect'&&r.request?.purpose==='writing-dna').slice(0,50).map(t=>{
   const run=db.taskRuns.find(r=>r.jobId===t.id&&r.taskKind==='writing-dna');const first=t.rows?.[0]||{};
   return {id:t.id,title:String(first.title||first.author||'文案蒸馏').slice(0,120),mode:t.request?.mode||'text',count:t.rows?.length||t.count||0,state:t.state,dnaState:run?.state||t.workflow?.state||'pending',startedAt:t.startedAt,finishedAt:t.finishedAt||run?.finishedAt||null,hasResult:Boolean(run?.result?.prompt),completedBatches:run?.completedBatches||0,totalBatches:run?.totalBatches||run?.batches?.length||0,error:run?.error||t.error||null};
  });
  json(res,200,{items});return true;
 }
 const match=url.pathname.match(/^\/api\/studio\/writing-dna\/([^/]+)(\/save|\/export|\/restart)?$/);if(!match)return false;
 const task=db.taskRuns.find(r=>r.id===match[1]&&r.taskKind==='douyin-collect'&&r.request?.purpose==='writing-dna');const run=task&&db.taskRuns.find(r=>r.jobId===task.id&&r.taskKind==='writing-dna');
 if(!task){json(res,404,{error:'distillation_task_not_found'});return true;}
 if(req.method==='POST'&&match[2]==='/restart'){
  const input=await body(req);if(input.confirmModel!==true){json(res,400,{error:'distillation_confirmation_required'});return true;}
  if(db.taskRuns.some(r=>r.jobId===task.id&&['writing-dna','douyin-asr'].includes(r.taskKind)&&['running','unknown'].includes(r.state))){json(res,409,{error:'distillation_request_unresolved'});return true;}
  if(!dnaCorpus(task).length){json(res,400,{error:'distillation_corpus_required'});return true;}
  if(!startFlow){json(res,503,{error:'distillation_runner_unavailable'});return true;}
  if(task.request?.mode==='text'){
   const originals=task.originalImportedRows||task.rows;
   const rows=dnaTextRows({documents:originals.map(row=>({name:row.sourceFile||row.title||'文案.txt',text:row.transcript||row.content||''}))});
   if(rows.length>task.rows.length||rows.some((row,i)=>row.sourceFile!==task.rows[i]?.sourceFile)){
    task.originalImportedRows||=structuredClone(task.rows);task.rows=rows;task.count=rows.length;
    task.originalImportLog||=task.logs||'';task.logs=`已识别 ${rows.length} 篇文案，逐篇精读；保留旧运行回执，不重复采集或转写。`;
    task.summary={...task.summary,total:rows.length};
   }
  }
  task.workflow={state:'running',step:'distill',options:{transcribe:false,saveLibrary:false,syncFeishu:false,distill:true,confirmModel:true},steps:{}};
  await saveDb(db);json(res,202,{id:task.id,state:'running'});void startFlow(task);return true;
 }
 if(req.method==='GET'&&match[2]==='/export'){if(run?.state!=='succeeded'){json(res,409,{error:'distillation_not_complete'});return true;}const archive=dnaZip(dnaExportFiles(run));res.writeHead(200,{'content-type':'application/zip','content-disposition':'attachment; filename=writing-dna.zip','cache-control':'no-store'});res.end(archive);return true;}
 if(req.method==='GET'&&!match[2]){const stages=db.taskRuns.filter(r=>r.jobId===task.id&&r.taskKind==='douyin-asr').map(r=>({id:r.id,taskKind:r.taskKind,state:r.state,logs:r.logs||'',error:r.error}));if(url.searchParams.get('view')==='progress'){const {rows,...summary}=task;json(res,200,{task:{...summary,count:rows?.length||task.count||0},run:run?{id:run.id,state:run.state,error:run.error,logs:run.logs,completedBatches:run.completedBatches,totalBatches:run.totalBatches,progress:run.progress,streamProgress:run.streamProgress}:null,stages});}else{const savedTemplate=run?.templateId?db.templates.find(t=>t.id===run.templateId):null;json(res,200,{task,run:run?{...run,templateActive:!!savedTemplate?.active}:null,stages});}return true;}
 if(req.method!=='POST'||match[2]!=='/save')return false;
 if(run?.state!=='succeeded'){json(res,409,{error:'distillation_not_complete'});return true;}
 const input=await body(req);const name=String(input.name||'').trim(),prompt=String(input.prompt??run.result.prompt).trim();if(!name||name.length>120||prompt.length<40||prompt.length>30000){json(res,400,{error:'template_name_and_prompt_required'});return true;}
 // 分层子内容（语言DNA／结构模板／选题素材认知／视觉范围）随模板一起保存，写作时参与提示词
 const sections=['language','structure','cognition','visual'].reduce((acc,key)=>{const value=String(run.result?.[key]||'').trim();if(value)acc[key]=value;return acc;},{});
 const dnaReport=Object.keys(sections).length?{...sections,articles:run.corpus?.length||0,sourceRunId:run.id,specVersion:run.specVersion||'legacy',quality:run.quality||dnaQuality(run),savedAt:new Date().toISOString()}:null;
 const existing=run.templateId?db.templates.find(t=>t.id===run.templateId):null;
 // 模板仍在用：直接复用；曾被删除（软删 active=false）：恢复并覆盖内容，保持历史关联
 if(existing?.active){if(dnaReport){existing.dnaReport=dnaReport;existing.prompt=prompt;existing.name=name;await saveDb(db);}json(res,200,{templateId:existing.id,template:existing,reused:true});return true;}
 if(existing&&!existing.active){existing.active=true;delete existing.deletedAt;existing.name=name;existing.prompt=prompt;if(dnaReport)existing.dnaReport=dnaReport;await saveDb(db);json(res,200,{templateId:existing.id,template:existing,restored:true});return true;}
 const template={id:uid('tpl'),name,prompt,promptCategory:'style',promptOnly:true,active:true,version:'v1',kind:'视频口播',rules:[],audits:['dbs-ai-check'],documentIds:[],knowledgeSetIds:[],distillationRunId:run.id,createdAt:new Date().toISOString(),...(dnaReport?{dnaReport}:{})};db.templates.unshift(template);run.templateId=template.id;await saveDb(db);json(res,201,{templateId:template.id,template});return true;
}
