import test from 'node:test';
import assert from 'node:assert/strict';
import {executePrecisionDna,precisionParts,parsePrecisionArticle,parsePrecisionLayer,parseReplicaReview,sourceCitation,dnaOutputOptions,synthesisGroups} from '../src/writing-dna-engine.mjs';
import {dnaExportFiles,dnaZip} from '../src/writing-dna-files.mjs';
import {writingDnaContext} from '../src/writing-dna-context.mjs';
import {createHash} from 'node:crypto';
import {writingDnaRoutes} from '../src/writing-dna.mjs';

const sentence='先把目标说清楚，再用具体例子核对理解。';
const hash=value=>createHash('sha256').update(value).digest('hex');
test('oversized synthesis converges without discarding reports, rules or counterexamples',()=>{
 const outputs=Array.from({length:5},(_,i)=>({content:'完整报告'+i+'。'.repeat(400),rules:[{statement:'规则'+i,scope:'完整边界',supports:[{articleId:String(i),quote:'引文'.repeat(1000),start:0,end:2000}],counterexamples:[{articleId:String(i),quote:'反例'.repeat(1000),start:2000,end:4000}]}],propositions:[]}));
 const before=JSON.stringify(outputs),groups=synthesisGroups(outputs,3000);assert.ok(groups.length<outputs.length);assert.equal(groups.flat().length,5);assert.equal(JSON.stringify(outputs),before);
 for(const [i,record] of groups.flat().entries()){assert.equal(record.content,outputs[i].content);assert.equal(record.rules[0].statement,outputs[i].rules[0].statement);assert.equal(record.rules[0].supports[0].sourceRef,JSON.stringify([String(i),0,2000]));assert.equal(record.rules[0].counterexamples[0].sourceRef,JSON.stringify([String(i),2000,4000]));assert.equal(record.rules[0].supports[0].quote,undefined);}
 const huge=Array.from({length:4},(_,i)=>({content:String(i).repeat(5000),rules:[]}));assert.equal(synthesisGroups(huge,100).length,2);
 const small=[{content:'一'},{content:'二'}];assert.deepEqual(synthesisGroups(small),[small]);
});
test('synthesis reserves visible output and known truncation receives a larger budget without changing analysis checkpoints',()=>{
 const env={LLM_MODEL:'deepseek-flash',LLM_BASE_URL:'http://fixture'};
 assert.deepEqual(dnaOutputOptions(env,'layer:language:0:1',14000),{max_tokens:24000,thinking:{type:'enabled'},reasoning_effort:'low'});
 assert.equal(dnaOutputOptions(env,'layer:language:0:1',14000,[{phaseKey:'layer:language:0:1',finishReason:'length'}]).max_tokens,32000);
 assert.equal(dnaOutputOptions(env,'article:0:1',12000).max_tokens,12000);
 assert.equal(dnaOutputOptions(env,'layer:language:0:1:repair',16000).thinking.type,'disabled');
 assert.deepEqual(dnaOutputOptions({LLM_MODEL:'fixture'},'layer:language:0:1',14000),{max_tokens:14000});
});
test('known truncated synthesis resumes after cached articles without repeating their model calls',async()=>{
 const f=precisionFixture(3);f.options.env.LLM_MODEL='deepseek-flash';let failed=false;
 await assert.rejects(executePrecisionDna({...f.options,fetchModel:async(url,request)=>{const input=JSON.parse(JSON.parse(request.body).messages[1].content);if(input.phase==='layer'&&!failed){failed=true;return Response.json({choices:[{message:{content:'{"content":"unfinished'},finish_reason:'length'}]});}return f.model(url,request);}}),/model_output_truncated/);
 assert.equal(f.calls.filter(c=>c.phase==='article').length,3);assert.equal(f.db.taskRuns[0].state,'failed');let resumedBudget;
 const run=await executePrecisionDna({...f.options,fetchModel:async(url,request)=>{resumedBudget??=JSON.parse(request.body).max_tokens;return f.model(url,request);}});
 assert.equal(resumedBudget,32000);assert.equal(f.calls.filter(c=>c.phase==='article').length,3);assert.equal(run.state,'succeeded');
});
export function precisionFixture(count=20){
 const corpus=Array.from({length:count},(_,i)=>({id:String(i),title:'完整文章'+i,date:'2026-11-01',author:'测试作者',transcriptState:'manual',content:sentence.repeat(12)+`第${i}篇独立收尾。`}));
 const task={id:'collect',summary:{coverage:{complete:true}}},db={taskRuns:[]},calls=[];
 const options={db,task,corpus,method:'本机方法测试，不调用真实模型。',spec:'v4-test',sourceHash:'fixture-'+count,stats:{articles:count},env:{LLM_MODEL:'fixture',LLM_API_KEY:'fixture',LLM_BASE_URL:'http://model.test'},uid:prefix=>prefix+'-'+db.taskRuns.length,hash,saveDb:async()=>{},analyzePos:async()=>({tool:'fixture',nouns:[['目标',count*12]],verbs:[['核对',count*12]],adverbs:[]})};
 const model=async(_url,request)=>{
  const input=JSON.parse(JSON.parse(request.body).messages[1].content);calls.push(input);let result;
  if(input.phase==='article'){
   const d=input.document,quote=d.content.slice(0,12),node={quote,role:'说明当前环节的职责'};
   result={metadata:{article_type:'类型'+(Number(d.id)%3),topic_tags:['任务'],hook_type:'问题',structure_pattern:'问题到例子',source_types:['观察']},structure:{opening:node,turns:[],body:[node],ending:{quote:d.content.slice(-12),role:'回扣处境'}},patterns:[{articleId:d.id,quote,rule:'先判断目标，再给对照例子'}],languageObservations:'第二人称，短判断与长解释交替。',topicLogic:'用具体问题切入，不推断发布时间。',materialStrategy:'依靠可见步骤，不假托权威。',cognitiveFrame:'用可核对的结果定义问题。'};
  }else if(input.phase==='layer'){
   const supports=corpus.slice(0,2).map(d=>({articleId:d.id,quote:d.content.slice(0,12)}));
   result={content:(input.layer+'：根据原文与脚本统计提炼可执行规则；适用当前体裁，不替换用户事实。\n').repeat(18),rules:[{statement:'以具体结果界定问题',scope:'任务解释题材；不是所有题材的固定教程',supports,counterexamples:[]}],types:[0,1,2].filter(i=>corpus[i]).map(i=>({name:'类型'+i,articleIds:[String(i)]})),propositions:[1,2,3].map(i=>({statement:'核心命题'+i,supports}))};
  }else if(input.phase==='integration')result={prompt:'# Writing-DNA\n'+('原文事实不能搬运，用户指令优先。按体裁决定组织方式，语言用短判断与具体说明交替。').repeat(20)};
  else if(input.phase==='replica')result={body:sentence.repeat(18)};
  else if(input.phase==='replica-review')result={scores:{language:8,structure:8,topic:8,materials:8,cognition:8},factualIntegrity:true,findings:[{replicaQuote:sentence,reference:{articleId:corpus[0].id,quote:sentence},reason:'句式相近，但这里只是模型辅助检查。'}],limitations:['尚未经过人工验收']};
  else throw Error('Unexpected phase '+input.phase);
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]}));
 };
 return {options,corpus,task,db,calls,model};
}

test('every article is read independently; five artifacts, grounded rules and a real blind-write check are produced',async()=>{
 const f=precisionFixture();const run=await executePrecisionDna({...f.options,fetchModel:f.model});
 assert.equal(run.state,'succeeded');assert.equal(run.articles.length,20);assert.equal(f.calls.filter(c=>c.phase==='article').length,20);
 assert.equal(f.calls.length,26);assert.equal(run.quality.metadataCoverage,1);assert.equal(run.validation.score,8);
 assert.equal(run.quality.verdict,'text-checks-passed');assert.equal(run.quality.humanVerified,false);assert.equal(run.quality.visualVerified,false);
 const blind=f.calls.find(c=>c.phase==='replica');assert.equal(blind.examples,undefined);assert.equal(blind.documents,undefined);
 assert.equal(f.calls.find(c=>c.phase==='replica-review').examples.length,5);
 assert.ok(run.articles.every(a=>a.structure.body.length&&a.structure.ending.quote));
 const files=dnaExportFiles(run);assert.equal(files.filter(f=>f.name.startsWith('raw/')).length,20);assert.equal(files.filter(f=>f.name.endsWith('.md')&&!f.name.startsWith('raw/')).length,5);
 const zip=dnaZip(files);assert.equal(zip.readUInt32LE(0),0x04034b50);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
 assert.equal(zip.readUInt16LE(zip.length-12),files.length);
});

test('unknown requests are never retried automatically; explicit resolution resumes only the unfinished phase',async()=>{
 const f=precisionFixture(3);let count=0;
 await assert.rejects(executePrecisionDna({...f.options,fetchModel:async(url,options)=>{count++;const input=JSON.parse(JSON.parse(options.body).messages[1].content);return input.phase==='replica-review'?new Response('timeout',{status:524}):f.model(url,options)}}),/524/);
 const prior=f.db.taskRuns[0];assert.equal(prior.state,'unknown');const before=count;
 await assert.rejects(executePrecisionDna({...f.options,fetchModel:async()=>{count++;throw Error('must not retry')}}),/结果未知/);assert.equal(count,before);
 prior.state='failed';let retried=0;
 const run=await executePrecisionDna({...f.options,fetchModel:async(...args)=>{retried++;return f.model(...args)}});
 assert.equal(retried,1);assert.equal(run.state,'succeeded');assert.equal(run.quality.verdict,'provisional');
});

test('long article parts cover every character and keep article boundaries',()=>{
 const corpus=[{id:'a',content:'甲'.repeat(25001)},{id:'b',content:'乙'.repeat(700)}];const parts=precisionParts(corpus);
 assert.equal(parts.filter(p=>p.id==='a').map(p=>p.content).join(''),corpus[0].content);
 assert.equal(parts.length,4);assert.equal(parts[2].totalParts,3);assert.equal(parts[3].start,0);
});

test('fabricated quotations and ungrounded review scores fail instead of claiming completion',async()=>{
 const f=precisionFixture(1),doc=precisionParts(f.corpus)[0];
 let article;
 await f.model('',{body:JSON.stringify({messages:[{}, {content:JSON.stringify({phase:'article',document:doc})}]})}).then(r=>r.json()).then(r=>{article=JSON.parse(r.choices[0].message.content)});
 article.structure.body[0].quote='原文不存在';assert.throws(()=>parsePrecisionArticle(JSON.stringify(article),doc),/quote_not_in_source/);
 assert.throws(()=>parsePrecisionLayer(JSON.stringify({content:'证据'.repeat(160),rules:[{statement:'规则',scope:'边界',supports:[{articleId:'0',quote:'虚构证据'}]}]}),f.corpus,'language'),/evidence_not_in_source/);
 assert.throws(()=>parseReplicaReview(JSON.stringify({scores:{language:9,structure:9,topic:9,materials:9,cognition:9},factualIntegrity:true,findings:[],limitations:[]}),sentence,f.corpus),/missing_evidence/);
});

test('five writing references retain full originals rather than silently truncating long articles',()=>{
 const corpus=Array.from({length:5},(_,i)=>({id:String(i),title:'任务',content:'甲'.repeat(11000)}));
 const run={id:'dna',taskKind:'writing-dna',state:'succeeded',corpus,method:{url:'source'},result:{language:'完整规则'},batches:[{metadata:corpus.map(d=>({id:d.id,article_type:'短评',topic_tags:['任务']}))}]};
 const context=writingDnaContext({taskRuns:[run],templates:[]},{styleDnaRunId:'dna',topic:'任务'});
 assert.equal(context.examples.length,5);assert.ok(context.examples.every(e=>e.content.length===11000));
});

test('layer evidence IDs resolve to stored original text, not model-retyped quotations',()=>{
 const corpus=[{id:'a',content:sentence}],pool=[{evidenceId:'E0',articleId:'a',quote:sentence}];
 const raw=JSON.stringify({content:'有证据的可执行规则。'.repeat(40),rules:[{statement:'先说清目标',scope:'任务解释',supports:[{evidenceId:'E0'}]}]});
 assert.equal(parsePrecisionLayer(raw,corpus,'language',pool).rules[0].supports[0].quote,sentence);
 assert.throws(()=>parsePrecisionLayer(raw,corpus,'language',[]),/id_unknown/);
});

test('saved soul preserves long layered artifacts and export serves independent Markdown files',async()=>{
 const f=precisionFixture(3);const run=await executePrecisionDna({...f.options,fetchModel:f.model});
 f.task.taskKind='douyin-collect';f.task.request={purpose:'writing-dna'};f.db.taskRuns.push(f.task);f.db.templates=[];
 run.result.language+='不可丢失的后半段。'.repeat(600);
 let status,value,headers,archive;
 const ctx={db:f.db,req:{method:'POST'},res:{writeHead:(code,h)=>{status=code;headers=h},end:bytes=>archive=bytes},url:new URL('http://test/api/studio/writing-dna/collect/save'),body:async()=>({name:'完整灵魂'}),saveDb:async()=>{},json:(_,code,data)=>{status=code;value=data}};
 await writingDnaRoutes(ctx);assert.equal(status,201);assert.equal(value.template.dnaReport.language,run.result.language);assert.ok(value.template.dnaReport.language.length>4000);
 ctx.req.method='GET';ctx.url=new URL('http://test/api/studio/writing-dna/collect/export');await writingDnaRoutes(ctx);
 assert.equal(status,200);assert.equal(headers['content-type'],'application/zip');assert.equal(archive.readUInt32LE(0),0x04034b50);
});

test('new-version restart reuses collected text and refuses unresolved paid requests',async()=>{
 const task={id:'old',taskKind:'douyin-collect',request:{purpose:'writing-dna'},rows:[{content:sentence}]};
 const db={taskRuns:[task],templates:[]};let status,started;
 const ctx={db,req:{method:'POST'},res:{},url:new URL('http://test/api/studio/writing-dna/old/restart'),body:async()=>({confirmModel:true}),saveDb:async()=>{},json:(_,code)=>status=code,startFlow:t=>{started=t}};
 await writingDnaRoutes(ctx);assert.equal(status,202);assert.equal(started,task);assert.equal(task.workflow.options.transcribe,false);assert.equal(task.workflow.options.saveLibrary,false);assert.equal(task.workflow.options.distill,true);
 db.taskRuns.unshift({id:'pending',jobId:'old',taskKind:'writing-dna',state:'unknown'});started=null;await writingDnaRoutes(ctx);assert.equal(status,409);assert.equal(started,null);
});

test('a received but oversized integration gets exactly one targeted correction without repeating article analysis',async()=>{
 const f=precisionFixture(3);let integrationCalls=0;
 const model=async(url,options)=>{
  const input=JSON.parse(JSON.parse(options.body).messages[1].content);
  if(input.phase==='integration'&&++integrationCalls===1)return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({prompt:'超长的整合文档。'.repeat(700)})},finish_reason:'stop'}]}));
  return f.model(url,options);
 };
 const run=await executePrecisionDna({...f.options,fetchModel:model});
 assert.equal(integrationCalls,2);assert.equal(run.state,'succeeded');assert.equal(f.calls.filter(c=>c.phase==='article').length,3);assert.equal(run.checkpoints['integration-compact'].corrected,true);assert.ok(run.result.prompt.length<=4000);
});


test('citation recovery only restores a tiny particle from a unique actual source span',()=>{
 const actual='当然他们吃完流量不属于道德正确的人，刘量属于对规则看得最清醒的人。';
 const quoted=actual.replace('对规则','规则');assert.equal(sourceCitation(quoted,actual).quote,actual);
 const negated='这是很长的一段来源文字，这件事情不应该归因为数据变化，需要继续核对事实。';
 assert.equal(sourceCitation(negated.replace('不应该','应该'),negated),null);
 assert.equal(sourceCitation(quoted,actual+'\n'+actual),null);
});
