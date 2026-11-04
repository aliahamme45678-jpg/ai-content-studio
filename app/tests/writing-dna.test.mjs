import test from 'node:test';
import assert from 'node:assert/strict';
import {executeDna,dnaBatches,parseDnaBatch,writingDnaRoutes} from '../src/writing-dna.mjs';
import {writingDnaContext} from '../src/writing-dna-context.mjs';
import {collectionRequest} from '../src/collection-request.mjs';
import {collectionFlowOptions,executeCollectionFlow} from '../src/collection-flow.mjs';
import {styleConfig} from '../src/writing-style.mjs';

const text='先检查你的商品信息，再谈流量。没有订单时，先核对选品、价格和履约。别拿忙碌代替判断。';
const report={prompt:'Writing-DNA.md\n你是一名面向经营者的实操型作者，用第二人称指出处境，用短判断收束，复用写法但不搬运原作者事实、案例与数据。'+'写作时先给具体动作，再解释原因与条件，遇到分支用如果就，结尾回扣问题。'.repeat(16),language:'语言DNA：平均句长 28.4 字，短句占 32.1%，长句占 18.7%，段均 2.3 句，小标题平均 9 字，拉丁字符占 1.2%，破折号:括号 = 0:4，高频词前 20：商品×12、流量×9、订单×7。句式骨架：先问后答；先否定再给做法；编号推进；短判断收束；用“你”指代处境。标点以逗号句号为主，少用问号。'.repeat(5),structure:'【类型：操作教程】入口→步骤→注意事项→检查项，300–800 字，适用后台教学，失效于纯观点题材。【类型：经营诊断】症状→指标→分支→动作，400–900 字，适用不出单排查，失效于宏观趋势。【类型：认知纠偏】旧做法→原理→案例→边界，500–1000 字，适用误区纠正，失效于纯工具介绍。'.repeat(4),cognition:'核心命题1：流量按规则分配，可被拆解和抢占。核心命题2：执行与批量重复优于灵感。核心命题3：先自然流验证再放大。选题只写中间态，不写开店注册和宏观趋势。素材为后台菜单、同行观察与操作阈值。边界：只借认知框架，不搬作者案例。'.repeat(4),visual:'没有视频画面资料，不能推断视觉风格；只分析文本排版：长段落口播痕迹明显，空行承担停顿，步骤靠编号导航，几乎无小标题、引用、图注和加粗层级。'.repeat(2)};
function fixture(count=100){const task={id:'collection',taskKind:'douyin-collect',request:{purpose:'writing-dna',mode:'profile'},rows:Array.from({length:count},(_,i)=>({externalId:String(i),title:'商品信息'+i,author:'博主',publishedAt:'2026-01-01',transcript:text.repeat(5)})),summary:{coverage:{complete:true}}};return {task,db:{taskRuns:[task],templates:[],documents:[]}};}
const model=async(_url,options)=>{
 const user=JSON.parse(JSON.parse(options.body).messages[1].content);let value;
 if(user.phase==='article'){
  const d=user.document,quote=d.content.slice(0,20),node={quote,role:'先给判断，再展开证据'};
  value={metadata:{article_type:'实战',topic_tags:['商品信息'],hook_type:'问题',structure_pattern:'问题到步骤',source_types:['观察']},structure:{opening:node,turns:[],body:[node],ending:{quote:d.content.slice(-20),role:'收束'}},languageObservations:'短句交替，以动作解释判断。',topicLogic:'在具体问题中切入。',materialStrategy:'用可核对的观察。',cognitiveFrame:'先定义判断标准。',patterns:[{articleId:d.id,quote,rule:'先判断再举例'}]};
 }else if(user.phase==='layer'){
  const supports=user.records.flatMap(r=>r.patterns||r.rules?.flatMap(x=>x.supports)||[]).slice(0,2).map(p=>({articleId:p.articleId,quote:p.quote}));
  value={content:report[user.layer],rules:[{statement:'以具体例子解释判断',scope:'当前样本，其他体裁需验证',supports,counterexamples:[]}],types:[{name:'实战',articleIds:[supports[0].articleId]}],propositions:[1,2,3].map(n=>({statement:'核心命题'+n,supports}))};
 }else if(user.phase==='integration')value={prompt:report.prompt};
 else if(user.phase==='replica')value={body:text.repeat(10)};
 else if(user.phase==='replica-review')value={scores:{language:8,structure:8,topic:8,materials:8,cognition:8},factualIntegrity:true,findings:[{replicaQuote:text,reference:{articleId:user.examples[0].id,quote:user.examples[0].content.slice(0,20)},reason:'有相近的句式与论证节奏'}],limitations:['模型辅助检查，非人工验收']};
 else throw Error('unexpected phase');
 return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
};

test('DNA batches preserve every character, including a long single transcript',()=>{const docs=[{id:'long',content:'甲'.repeat(35000)},{id:'short',content:'乙'.repeat(2000)}];const all=dnaBatches(docs).flat();assert.equal(all.filter(d=>d.id==='long').map(d=>d.content).join(''),docs[0].content);assert.equal(all.filter(d=>d.id==='short').map(d=>d.content).join(''),docs[1].content);assert.ok(all.every(d=>d.content.length<=14000));});

test('DNA refuses invented evidence and incomplete metadata',()=>{const docs=[{id:'1',part:1,content:text}];assert.throws(()=>parseDnaBatch(JSON.stringify({metadata:[],patterns:[{id:'1',quote:'假的'}],findings:'观察'}),docs),/metadata_incomplete/);assert.throws(()=>parseDnaBatch(JSON.stringify({metadata:[{id:'1',part:1,article_type:'实战',topic_tags:[],hook_type:'问题',structure_pattern:'步骤',source_types:[]}],patterns:[{id:'1',quote:'完全不存在的引用'}],findings:'观察'}),docs),/evidence_not_in_source/);});

test('DNA stitches a prematurely closed JSON object whose patterns dangle outside, without relaxing validation',()=>{
 const docs=[{id:'1',part:1,content:text}];
 const main=JSON.stringify({metadata:[{id:'1',part:1,article_type:'实战',topic_tags:[],hook_type:'问题',structure_pattern:'步骤',source_types:[]}],findings:'先问题再步骤，短句口播，以动作收束。'.repeat(3)});
 const dangling=JSON.stringify({id:'1',quote:text.slice(0,10),rule:'先给动作'});
 const value=parseDnaBatch(main+'\\n'+dangling,docs);
 assert.equal(value.parseRepaired,'stitched_top_level_fragments');
 assert.equal(value.patterns.length,1);
 assert.equal(value.metadata.length,1);
 // 拼接只修包装：越界 metadata 仍被丢弃，缺 part 仍报错，幻觉引文仍被拒
 const splitBadMeta=JSON.stringify({metadata:[{id:'1',part:1,article_type:'实战',topic_tags:[],hook_type:'问题',structure_pattern:'步骤',source_types:[]},{id:'2',part:2,article_type:'x',topic_tags:[],hook_type:'x',structure_pattern:'x',source_types:[]}],findings:'观察'.repeat(30)});
 assert.equal(parseDnaBatch(splitBadMeta+'\\n'+dangling,docs).metadata.length,1);
 const splitHallucinated=JSON.stringify({id:'1',quote:'完全不存在的引用',rule:'r'});
 assert.throws(()=>parseDnaBatch(main+'\\n'+splitHallucinated,docs),/evidence_not_in_source/);
});

test('100 videos distill all transcripts, save a style prompt, and writing reads all artifacts plus five full originals',async()=>{
 const previous={...process.env};Object.assign(process.env,{MODEL_CALLS_ENABLED:'true',LLM_API_KEY:'test',LLM_BASE_URL:'https://model.test/v1',LLM_MODEL:'test'});
 try{const {db,task}=fixture();const run=await executeDna({db,task,saveDb:async()=>{},fetchModel:model});assert.equal(run.state,'succeeded');assert.equal(run.corpus.length,100);assert.equal(run.batches.flatMap(b=>b.metadata).length,100);assert.equal(db.documents.length,0,'distillation does not turn collected videos into library assets');let response;const ctx={req:{method:'POST'},res:{},url:new URL('http://test/api/studio/writing-dna/collection/save'),db,body:async()=>({name:'博主写作风格'}),saveDb:async()=>{},json:(_,status,data)=>{response={status,data};}};await writingDnaRoutes(ctx);assert.equal(response.status,201);assert.equal(db.templates[0].promptCategory,'style');await writingDnaRoutes(ctx);assert.equal(db.templates.length,1);const config=styleConfig({stylePromptId:db.templates[0].id},db);assert.equal(config.styleDnaRunId,run.id);const context=writingDnaContext(db,{...config,topic:'商品信息'});assert.deepEqual(context.artifacts,run.result);assert.equal(context.examples.length,5);assert.equal(context.examples[0].content,text.repeat(5));}finally{for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});

test('unknown final request stops retries; after explicit resolution completed batches are reused',async()=>{
 const previous={...process.env};Object.assign(process.env,{MODEL_CALLS_ENABLED:'true',LLM_API_KEY:'test',LLM_BASE_URL:'https://model.test/v1',LLM_MODEL:'test'});
 try{const {db,task}=fixture(25);let calls=0;const broken=async(url,options)=>{calls++;const u=JSON.parse(JSON.parse(options.body).messages[1].content);return u.phase!=='replica-review'?model(url,options):new Response('provider timeout',{status:522});};await assert.rejects(executeDna({db,task,saveDb:async()=>{},fetchModel:broken}),/522/);const prior=db.taskRuns[0];assert.equal(prior.state,'unknown');const completed=prior.batches.length;const before=calls;await assert.rejects(executeDna({db,task,saveDb:async()=>{},fetchModel:broken}),/结果未知/);assert.equal(calls,before);prior.state='failed';let retried=0;const run=await executeDna({db,task,saveDb:async()=>{},fetchModel:async(...args)=>{retried++;return model(...args);}});assert.equal(run.state,'succeeded');assert.equal(retried,1);assert.equal(run.batches.length,completed);}finally{for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});

test('one start chains collection transcription and DNA without importing assets or account analysis',async()=>{
 const request=collectionRequest({mode:'profile',urls:'https://www.douyin.com/user/test',purpose:'writing-dna',collectAll:true});assert.equal(request.purpose,'writing-dna');assert.equal(request.collectAll,true);
 const options=collectionFlowOptions({transcribe:true,saveLibrary:false,syncFeishu:false,distill:true,confirmPaid:true,confirmModel:true},{asr:true,distill:true});const task={id:'collect',rows:[{externalId:'one'}],workflow:{state:'running',options}};const events=[];await executeCollectionFlow({db:{taskRuns:[],documents:[]},task,saveDb:async()=>{},transcribe:async()=>{events.push('asr');task.rows[0].transcript=text;return {state:'succeeded'};},distill:async()=>{events.push('dna');return {id:'dna'};},saveMaterial:()=>assert.fail('must not create assets'),analyze:()=>assert.fail('must not run account analysis')});assert.deepEqual(events,['asr','dna']);assert.equal(task.workflow.state,'succeeded');
});

test('DNA entry accepts shared video text or a full-history profile with one automatic action',async()=>{
 const vm=await import('node:vm');const {readFile}=await import('node:fs/promises');const context=vm.createContext({URL,collectionPasteUrls:text=>(text.match(/https?:\/\/[^\s]+/g)||[]).join('\n')});vm.runInContext(await readFile(new URL('../public/writing-dna.js',import.meta.url),'utf8'),context);const profile=vm.runInContext("writingDnaInput('https://www.douyin.com/user/example')",context);assert.equal(profile.collectAll,true);assert.equal(profile.workflow.distill,true);assert.equal(profile.workflow.saveLibrary,false);const videos=vm.runInContext("writingDnaInput('分享视频 https://v.douyin.com/example/ 复制链接')",context);assert.equal(videos.mode,'links');assert.equal(videos.urls,'https://v.douyin.com/example/');assert.throws(()=>vm.runInContext("writingDnaInput('https://www.douyin.com/user/example https://v.douyin.com/video')",context),/单独输入/);
});

test('custom text import keeps pasted content and multiple files and skips collection, ASR and library creation',async()=>{
 const {dnaTextRows}=await import('../src/writing-dna.mjs');const rows=dnaTextRows({text:'手动粘贴的真实文案',documents:[{name:'文案一.md',text:'第一篇完整正文'},{name:'文案二.txt',text:'第二篇完整正文'}]});assert.equal(rows.length,3);assert.equal(rows[1].sourceFile,'文案一.md');assert.equal(rows[2].transcript,'第二篇完整正文');assert.throws(()=>dnaTextRows({documents:[{name:'空文件.md',text:''}]}),/正文/);
 const previous={...process.env};Object.assign(process.env,{MODEL_CALLS_ENABLED:'true',LLM_API_KEY:'test',LLM_BASE_URL:'https://model.test/v1',LLM_MODEL:'test'});
 try{const db={taskRuns:[],documents:[],templates:[]};let response,finished;await writingDnaRoutes({req:{method:'POST'},res:{},url:new URL('http://test/api/studio/writing-dna/import'),db,body:async()=>({text,documents:[{name:'真实文案.md',text:text.repeat(2)}],confirmModel:true}),saveDb:async()=>{},json:(_,status,data)=>{response={status,data};},startFlow:task=>{finished=executeCollectionFlow({db,task,saveDb:async()=>{},transcribe:()=>assert.fail('must not transcribe'),saveMaterial:()=>assert.fail('must not create assets'),distill:()=>executeDna({db,task,saveDb:async()=>{},fetchModel:model})});}});await finished;assert.equal(response.status,202);assert.equal(response.data.request.mode,'text');assert.equal(response.data.rows.length,2);assert.equal(response.data.workflow.state,'succeeded');assert.equal(db.documents.length,0);assert.equal(db.taskRuns.find(r=>r.taskKind==='writing-dna').corpus.length,2);}finally{for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});

test('one txt file is split into articles so page count and per-article metadata stay honest',async()=>{
 const {dnaTextRows,splitTextArticles}=await import('../src/writing-dna.mjs');
 const a='一'.repeat(300),b='二'.repeat(300),c='三'.repeat(300);
 const rows=dnaTextRows({documents:[{name:'合集.txt',text:[a,b,c].join('\n\n\n')}]});
 assert.equal(rows.length,3);
 assert.deepEqual(rows.map(row=>row.transcript),[a,b,c]);
 assert.deepEqual(rows.map(row=>row.externalId),['text-0-1','text-0-2','text-0-3']);
 assert.match(rows[0].title,/第1篇/);
 assert.equal(rows.reduce((sum,row)=>sum+row.transcript.length,0),900);
 // 单篇内部只有一个空行分段，不能误拆
 assert.deepEqual(splitTextArticles(`${'甲'.repeat(300)}\n\n${'乙'.repeat(300)}`),[`${'甲'.repeat(300)}\n\n${'乙'.repeat(300)}`]);
 // 文件末尾的短尾巴并入上一篇，不丢内容
 const tail=splitTextArticles([`${'丙'.repeat(600)}`,`${'丁'.repeat(600)}`,'完'].join('\n\n\n'));
 assert.equal(tail.length,2);assert.ok(tail[1].endsWith('完'));
 // Markdown 标题优先按标题分篇
 assert.equal(splitTextArticles(`## 一\n${'戊'.repeat(200)}\n\n## 二\n${'己'.repeat(200)}`).length,2);
});

test('URL-encoded raw transcript collections use ordinary blank separators without losing text',async()=>{
 const {dnaTextRows}=await import('../src/writing-dna.mjs');
 const parts=Array.from({length:72},(_,i)=>`第${i+1}篇独立文案。`+'这是同一篇文案的完整正文。'.repeat(25));
 const rows=dnaTextRows({documents:[{name:encodeURIComponent('跨境出海运营站_原始文案.txt'),text:parts.join('\n\n')}]});
 assert.equal(rows.length,72);assert.equal(rows[0].sourceFile,'跨境出海运营站_原始文案.txt');
 assert.equal(rows.map(r=>r.content).join('\n\n'),parts.join('\n\n'));
 assert.ok(rows.every(r=>r.articleCount===72));
 const essay='第一段。'+'甲'.repeat(200)+'\n\n第二段。'+'乙'.repeat(200);
 assert.equal(dnaTextRows({documents:[{name:'普通文章.txt',text:essay}]}).length,1,'ordinary paragraph breaks are not automatically treated as different articles');
});

test('a dropped connection is not silently retried; explicit resolution resumes saved phases',async()=>{
 const previous={...process.env};Object.assign(process.env,{MODEL_CALLS_ENABLED:'true',LLM_API_KEY:'test',LLM_BASE_URL:'https://model.test/v1',LLM_MODEL:'test'});
 try{const {db,task}=fixture(3);let calls=0;
  await assert.rejects(executeDna({db,task,saveDb:async()=>{},fetchModel:async()=>{calls++;throw new TypeError('fetch failed');}}),/fetch failed/);
  assert.equal(calls,1);assert.equal(db.taskRuns[0].state,'unknown');
  await assert.rejects(executeDna({db,task,saveDb:async()=>{},fetchModel:model}),/结果未知/);
  db.taskRuns[0].state='failed';const run=await executeDna({db,task,saveDb:async()=>{},fetchModel:model});assert.equal(run.state,'succeeded');assert.equal(run.articles.length,3);
 }finally{for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});

test('legacy batch receipts do not bypass the new per-article precision workflow',async()=>{
 const {dnaCorpus,dnaSourceHash}=await import('../src/writing-dna.mjs');const previous={...process.env};Object.assign(process.env,{MODEL_CALLS_ENABLED:'true',LLM_API_KEY:'test',LLM_BASE_URL:'https://model.test/v1',LLM_MODEL:'test'});
 try{const {db,task}=fixture(3);const corpus=dnaCorpus(task);const batch=dnaBatches(corpus)[0];const saved={metadata:batch.map(d=>({id:d.id,part:d.part,article_type:'教程',topic_tags:[],hook_type:'问题',structure_pattern:'步骤',source_types:[]})),findings:'根据三篇正文总结出的短句与步骤化表达。',patterns:[{id:batch[0].id,quote:batch[0].content.slice(0,10),rule:'问题切入'},{id:batch[1].id,quote:'不存在的人工修正引用',rule:'不能采用'}]};db.taskRuns.unshift({id:'legacy',taskKind:'writing-dna',jobId:task.id,sourceHash:dnaSourceHash(corpus),batchSize:6000,state:'failed',error:'dna_evidence_not_in_source',batches:[],responses:[{raw:JSON.stringify(saved),finishReason:'stop'}]});let calls=0;const run=await executeDna({db,task,saveDb:async()=>{},fetchModel:async(url,options)=>{calls++;assert.equal(JSON.parse(JSON.parse(options.body).messages[1].content).documents,undefined);return model(url,options);}});assert.equal(calls,9);assert.equal(run.state,'succeeded');assert.equal(run.articles.length,3);assert.equal(run.batches[0].patterns.length,1);}finally{for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});

test('distillation history lists uploaded tasks with result state so finished jobs stay findable',async()=>{
 const db={taskRuns:[
  {id:'text-distill-ok',taskKind:'douyin-collect',state:'succeeded',startedAt:'2026-11-03T13:42:35.952Z',finishedAt:'2026-11-03T13:42:35.952Z',request:{purpose:'writing-dna',mode:'text'},rows:[{title:'森桢出海电商_原始文案.txt',author:'自定义文案'}],workflow:{state:'succeeded'}},
  {id:'dna-ok',taskKind:'writing-dna',jobId:'text-distill-ok',state:'succeeded',startedAt:'2026-11-03T13:42:36.000Z',completedBatches:9,totalBatches:9,result:{prompt:'灵魂提示词'}},
  {id:'text-distill-bad',taskKind:'douyin-collect',state:'failed',startedAt:'2026-11-03T13:00:00.000Z',request:{purpose:'writing-dna',mode:'text'},rows:[{title:'失败文案.txt'}],workflow:{state:'failed'}},
  {id:'dna-bad',taskKind:'writing-dna',jobId:'text-distill-bad',state:'failed',error:'invalid_dna_batch',completedBatches:8,totalBatches:9},
  {id:'collect-other',taskKind:'douyin-collect',state:'succeeded',startedAt:'2026-11-03T12:00:00.000Z',request:{purpose:'account-analysis',mode:'profile'},rows:[{title:'某博主'}],workflow:{state:'succeeded'}},
 ]};
 let response;
 await writingDnaRoutes({req:{method:'GET'},res:{},url:new URL('http://test/api/studio/writing-dna/history'),db,body:async()=>({}),saveDb:async()=>{},json:(_,status,data)=>{response={status,data};}});
 assert.equal(response.status,200);
 const items=response.data.items;
 assert.equal(items.length,2,'only distillation tasks, collection tasks stay out');
 assert.deepEqual(items.map(item=>item.id),['text-distill-ok','text-distill-bad']);
 assert.equal(items[0].title,'森桢出海电商_原始文案.txt');
 assert.equal(items[0].dnaState,'succeeded');
 assert.equal(items[0].hasResult,true);
 assert.equal(items[0].completedBatches,9);
 assert.equal(items[1].dnaState,'failed');
 assert.equal(items[1].hasResult,false);
 assert.equal(items[1].error,'invalid_dna_batch');
});

test('saving a distillation keeps the layered report on the template, and writing reads it too',async()=>{
 const {stylePromptOf}=await import('../src/writing-style.mjs');
 const db={taskRuns:[],templates:[]};
 const task={id:'t-layer',taskKind:'douyin-collect',request:{purpose:'writing-dna'},rows:[{title:'博主'}],count:1};
 const run={id:'dna-layer',taskKind:'writing-dna',jobId:'t-layer',state:'succeeded',corpus:[{id:'a'},{id:'b'},{id:'c'}],result:{prompt:'语气口语，短句为主，先给结论再解释原因，避免形容词堆叠，每段只讲一件事，结尾给一个可以立刻执行的动作。',language:'多用短句，一句一件事。',structure:'结论先行 → 证据 → 反例 → 行动指令。',cognition:'选题从平台规则变化切入，用实测数据做证据。',visual:'未提供视频画面，仅分析文本排版。'}};
 db.taskRuns.push(task,run);let out;
 await writingDnaRoutes({req:{method:'POST'},res:{},url:new URL('http://test/api/studio/writing-dna/t-layer/save'),db,body:async()=>({name:'博主 · 写作风格'}),saveDb:async()=>{},json:(_,code,data)=>{out={code,data};}});
 assert.equal(out.code,201);
 const saved=out.data.template;assert.equal(saved.name,'博主 · 写作风格');
 assert.equal(saved.dnaReport.structure,'结论先行 → 证据 → 反例 → 行动指令。');assert.equal(saved.dnaReport.articles,3);assert.equal(saved.dnaReport.sourceRunId,'dna-layer');
 const composed=stylePromptOf(saved);
 assert.match(composed,/结构模板/);assert.match(composed,/结论先行/);assert.match(composed,/语言 DNA/);assert.match(composed,/选题、素材与认知/);
 assert.match(composed,/未提供视频画面/);
 assert.equal(stylePromptOf({prompt:'纯提示词模板'}),'纯提示词模板');
});

test('a soul template deleted from the library can be saved again from the same distillation',async()=>{
 const db={taskRuns:[],templates:[]};
 const task={id:'t-del',taskKind:'douyin-collect',request:{purpose:'writing-dna'},rows:[{title:'博主'}],count:1};
 const run={id:'dna-del',taskKind:'writing-dna',jobId:'t-del',state:'succeeded',corpus:[{id:'a'},{id:'b'}],result:{prompt:'语气口语，短句为主，先给结论再解释原因，最后给出可执行步骤，结尾留一个反问引导评论。',language:'短句，一句一件事。',structure:'结论先行。',cognition:'用实测数据做证据。',visual:'未提供画面。'}};
 db.taskRuns.push(task,run);
 const call=async(method,path,payload)=>{let r;await writingDnaRoutes({req:{method},res:{},url:new URL('http://test'+path),db,body:async()=>payload||{},saveDb:async()=>{},json:(_,code,data)=>{r={code,data};}});return r;};
 let out=await call('POST','/api/studio/writing-dna/t-del/save',{name:'博主 · 写作风格'});
 assert.equal(out.code,201);const tplId=out.data.templateId;
 const tpl=db.templates.find(t=>t.id===tplId);tpl.active=false;tpl.deletedAt=new Date().toISOString();
 assert.equal((await call('GET','/api/studio/writing-dna/t-del')).data.run.templateActive,false);
 out=await call('POST','/api/studio/writing-dna/t-del/save',{name:'博主 · 风格 v2',prompt:'语气口语，短句为主，先给结论再解释原因，最后给出可执行步骤，并保留口语节奏与停顿感。'});
 assert.equal(out.code,200);assert.equal(out.data.restored,true);assert.equal(out.data.templateId,tplId);
 assert.equal(db.templates.length,1);assert.equal(tpl.active,true);assert.equal(tpl.deletedAt,undefined);
 assert.equal(tpl.name,'博主 · 风格 v2');assert.match(tpl.prompt,/口语节奏/);assert.equal(tpl.dnaReport.articles,2);
 assert.equal((await call('GET','/api/studio/writing-dna/t-del')).data.run.templateActive,true);
 out=await call('POST','/api/studio/writing-dna/t-del/save',{name:'博主 · 风格 v2'});
 assert.equal(out.data.reused,true);assert.equal(db.templates.length,1);
});

test('DNA 不规定讲什么：prompt 混入行业运营策略会被退回',async()=>{
 const {parseDnaReport}=await import('../src/writing-dna.mjs');
 const report={
  prompt:('你是写作DNA编辑器。先自然流验证，再投流或达人。用短句推进，解释因果时先给判断再给依据。').repeat(15),
  language:('使用短句，平均句长21字，短句占比30%，长句占比5%，高频词为流量与商品。').repeat(25),
  structure:('【类型：教程】环节：问题→步骤→收束，适用实操讲解，字数800—1500，失效条件是题材变软。\n').repeat(15),
  cognition:('核心命题1：先验证再放大，再给依据。\n核心命题2：规则可拆解，先系统归因。\n核心命题3：执行优于灵感，用动作收束。').repeat(12),
  visual:('没有视频画面资料，不能推断视觉风格；仅就文本排版看长段落口播痕迹明显，空行承担停顿，步骤靠编号导航。').repeat(3)
 };
 assert.throws(()=>parseDnaReport(JSON.stringify(report)),/dna_prompt_contains_domain_tactics/,'业务运营策略不得进入写作规则');
 const clean={...report,prompt:('你是写作DNA编辑器。用短句推进，解释因果时先给判断再给依据，换任何题材都这样讲。').repeat(30)};
 assert.doesNotThrow(()=>parseDnaReport(JSON.stringify(clean)),'纯表达规则可以通过');
});

test('单篇样本在质量报告里标 provisional，不再默认是稳定风格',async()=>{
 const {dnaQuality}=await import('../src/writing-dna.mjs');
 const run={corpus:[{id:'1'}],batches:[{metadata:[{id:'1'}]}],result:{language:'x'.repeat(600),structure:'x'.repeat(600),cognition:'x'.repeat(500),prompt:'x'.repeat(700)}};
 assert.equal(dnaQuality(run).provisional,true);
 assert.equal(dnaQuality({...run,corpus:Array.from({length:20},(_,i)=>({id:String(i)}))}).provisional,false);
});
