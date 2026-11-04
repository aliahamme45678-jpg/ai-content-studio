import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('clear writing detaches old job and revision context while preserving writing settings',async()=>{
 const source=await readFile(new URL('../public/writing-workbench.js',import.meta.url),'utf8');
 const memory=new Map([['studio-current-writer','old']]);let renders=0;
 const context=vm.createContext({clearTimeout:()=>{},state:{jobId:'old',view:'studio'},sessionStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},render:()=>renders++});
 vm.runInContext(source,context);
 vm.runInContext("fullWriter.jobId='old';fullWriter.options={materialIds:['old-material']};fullWriter.resultView='revision';fullWriter.recoveryDrafts={old:{output:'old-revision'}};resetWriterPage({draft:{jobId:'old',original:'old-input',output:'old-output',templateId:'chosen',knowledgeSetIds:['feishu'],stylePromptId:'soul',dirty:true}})",context);
 assert.equal(vm.runInContext('fullWriter.jobId',context),null);
 assert.equal(vm.runInContext('fullWriter.drafts.rewrite.output',context),'');
 assert.equal(vm.runInContext('fullWriter.drafts.rewrite.original',context),'');
 assert.equal(vm.runInContext('fullWriter.drafts.rewrite.templateId',context),'chosen');
 assert.equal(vm.runInContext('fullWriter.drafts.rewrite.knowledgeSetIds[0]',context),'feishu');
 assert.equal(vm.runInContext('Object.keys(fullWriter.options).length+Object.keys(fullWriter.recoveryDrafts).length',context),0);
 assert.equal(memory.has('studio-current-writer'),false);assert.equal(renders,1);
 const restored=JSON.parse(memory.get('studio-writer-drafts'));assert.equal(restored.jobId,null);assert.equal(restored.drafts.rewrite.output,'');
});

test('saving a new source creates a separate job and never reuses old body or material IDs',async()=>{
 const source=await readFile(new URL('../public/writing-workbench.js',import.meta.url),'utf8');const calls=[];
 const old={id:'old',originalBody:'old-original',body:'old-output',title:'old-title'};
 const draft={original:'new-original',title:'old-title',output:'old-output',templateId:'chosen',knowledgeSetIds:['feishu'],scope:'selected'};
 const context=vm.createContext({state:{jobId:'old',data:{jobs:[old],templates:[{id:'chosen',active:true}]}},sessionStorage:{getItem:()=>null,setItem(){}},writerStyleValues:()=>({}),api:async(path,options)=>{const input=JSON.parse(options.body);calls.push({path,input});return path.endsWith('/rewrite-jobs')?{id:'new',...input}:{id:'new',...input}}});
 vm.runInContext(source,context);context.inputDraft=draft;
 vm.runInContext("fullWriter.jobId='old';fullWriter.options={materialIds:['old-material']};fullWriterDraft=()=>inputDraft",context);
 await vm.runInContext('saveFullWriterInput(true)',context);
 assert.equal(calls[0].path,'/api/studio/rewrite-jobs');assert.equal(calls[0].input.original,'new-original');
 assert.equal(calls[0].input.title,'');assert.equal(calls[0].input.materialIds,undefined);
 assert.equal(calls[1].path,'/api/studio/writing/jobs/new');assert.equal(calls[1].input.body,'');
 assert.equal(old.body,'old-output');assert.equal(old.originalBody,'old-original');
});

test('refresh restores unsaved mode, original, output, persona and knowledge choices from this tab',async()=>{
  const source=await readFile(new URL('../public/writing-workbench.js',import.meta.url),'utf8');const memory=new Map();
  const sessionStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
  const first=vm.createContext({sessionStorage});vm.runInContext(source,first);
  vm.runInContext("fullWriter.mode='rewrite';fullWriter.drafts.rewrite={jobId:'j',dirty:true,title:'未保存选题',original:'未保存原稿',output:'未保存正文',soulPersona:'鲁迅风格',documentIds:['selected']};rememberWriterSession();",first);
  const restored=vm.createContext({sessionStorage});vm.runInContext(source,restored);
  assert.equal(vm.runInContext('fullWriter.drafts.rewrite.output',restored),'未保存正文');
  assert.equal(vm.runInContext('fullWriter.drafts.rewrite.original',restored),'未保存原稿');
  assert.equal(vm.runInContext('fullWriter.drafts.rewrite.soulPersona',restored),'鲁迅风格');
  assert.equal(vm.runInContext('fullWriter.drafts.rewrite.documentIds[0]',restored),'selected');
});

test('stale local drafts remain recoverable without replacing a newer server edit',async()=>{
  const source=await readFile(new URL('../public/writing-workbench.js',import.meta.url),'utf8');
  const context=vm.createContext({});vm.runInContext(source,context);
  vm.runInContext("fullWriter.drafts.rewrite={jobId:'j',baseBody:'旧正文',output:'未保存修改',dirty:true};protectChangedWriterBody({id:'j',body:'后台新正文'},fullWriter.drafts.rewrite);",context);
  assert.equal(vm.runInContext('fullWriter.drafts.rewrite.dirty',context),false);
  assert.equal(vm.runInContext("fullWriter.recoveryDrafts.j.output",context),'未保存修改');
  vm.runInContext("const fresh={jobId:'j',baseBody:'后台新正文',output:'新的未保存修改',dirty:true};protectChangedWriterBody({id:'j',body:'后台新正文'},fresh);",context);
  assert.equal(vm.runInContext('fresh.dirty',context),true);
});

test('new-content entry saves the dirty draft first and stays on it if saving fails',async()=>{
  const source=await readFile(new URL('../public/workflow.js',import.meta.url),'utf8');const calls=[];let failing=false;
  const context=vm.createContext({fullWriter:{busy:false},document:{querySelector:()=>({})},fullWriterDraft:()=>({dirty:true,title:'正在修改的选题',output:'正文'}),saveFullWriterInput:async()=>{calls.push('save');if(failing)throw new Error('保存失败');},openFullWriter:()=>calls.push('open'),toast:()=>calls.push('error')});
  vm.runInContext(source,context);await vm.runInContext('openWritingEntry()',context);assert.deepEqual(calls,['save','open']);
  calls.length=0;failing=true;await vm.runInContext('openWritingEntry()',context);assert.deepEqual(calls,['save','error']);assert.equal(context.fullWriter.busy,false);
});

test('switching legacy templates preserves their Chinese audit selections',async()=>{
  const shared=await readFile(new URL('../public/ui-components.js',import.meta.url),'utf8');const source=await readFile(new URL('../public/writing-workbench.js',import.meta.url),'utf8');const context=vm.createContext({});vm.runInContext(shared,context);vm.runInContext(source,context);
  assert.equal(vm.runInContext("writerAuditIds({audits:['口播流畅度','发布风险','AI 味检查']}).join(',')",context),'dbs-script-flow,dbs-content-risk-check,dbs-ai-check');
});

test('selecting collected material resumes its unfinished draft and preserves its source return context',async()=>{
  const source=await readFile(new URL('../public/writing-workbench.js',import.meta.url),'utf8');
  const state={data:{jobs:[{id:'cancelled',originalBody:'原稿',status:'已取消',sourceIds:['material']},{id:'draft',originalBody:'原稿',body:'已修改正文',status:'待审核',sourceIds:['material'],writingOrigin:{returnCollectionTaskId:'collection'}}]}};
  const context=vm.createContext({state,document:{querySelector:()=>null},render:()=>{}});
  vm.runInContext(source,context);
  vm.runInContext("openFullWriter({mode:'rewrite',materialIds:['material'],format:'视频口播'});",context);
  assert.equal(state.jobId,'draft');
  assert.equal(vm.runInContext('fullWriter.options.returnCollectionTaskId',context),'collection');
  assert.equal(state.data.jobs.length,2);
  assert.equal(state.data.jobs[1].body,'已修改正文');
  state.data.jobs[1].status='已定稿';
  vm.runInContext("openFullWriter({mode:'rewrite',materialIds:['material'],original:'新原稿'});",context);
  assert.equal(state.jobId,null);
  assert.equal(vm.runInContext('fullWriter.drafts.rewrite.original',context),'新原稿');
});

test('review entry runs the actual check rather than only scrolling, and refuses a duplicate while busy',async()=>{const source=await readFile(new URL('../public/writing-workbench.js',import.meta.url),'utf8');let calls=0;const draft={hidden:false},review={hidden:false},button={disabled:false,click:()=>calls++};const context=vm.createContext({document:{querySelectorAll:()=>[]},$:id=>({'#fw-draft-pane':draft,'#fw-review-pane':review,'#fw-audit':button})[id]});vm.runInContext(source,context);vm.runInContext('startWriterReview()',context);assert.equal(calls,1);assert.equal(draft.hidden,false,'checking keeps the middle draft visible');assert.equal(review.hidden,false);vm.runInContext('fullWriter.busy=true;startWriterReview()',context);assert.equal(calls,1);});
test('unchecked and timed-out writing reviews expose an actionable next step instead of only a disabled repair button',async()=>{const source=await readFile(new URL('../public/writing-workbench.js',import.meta.url),'utf8');const context=vm.createContext({state:{data:{taskRuns:[{id:'timeout',jobId:'j',taskKind:'model-audit',state:'unknown',error:'timeout'}]}},esc:value=>String(value??'')});vm.runInContext(source,context);assert.equal(vm.runInContext("writerRevisionPanel({id:'j',body:'文稿'},false,[])",context),'','the shared dock owns the next action without a duplicate button');assert.match(vm.runInContext("writerAuditFailure({id:'j'})",context),/模型检查超时/);assert.match(vm.runInContext("writerAuditFailure({id:'j'})",context),/data-resolve-run="timeout"/);});

test('写作提示词与灵魂二选一：选了灵魂就禁用写作提示词并写明原因',async()=>{
  const source=await readFile(new URL('../public/writing-style.js',import.meta.url),'utf8');
  const els={'#fw-soul':{value:'prompt:s1',selectedOptions:[{textContent:'墨鱼风格'}]},'#fw-template':{value:'t1',disabled:false,title:''},'#fw-template-note':{textContent:'视频口播 · v1'}};
  const context=vm.createContext({$:id=>els[id]||null,state:{data:{templates:[{id:'t1',kind:'视频口播',version:'v1'}]}},document:{querySelector:()=>null,querySelectorAll:()=>[]}});
  vm.runInContext(source,context);
  vm.runInContext('syncWritingMethodChoice()',context);
  assert.equal(els['#fw-template'].disabled,true,'选了灵魂后写作提示词不可选');
  assert.equal(els['#fw-soul'].disabled,false,'灵魂可选');
  assert.match(els['#fw-template-note'].textContent,/已由灵魂「墨鱼风格」主导/);
  els['#fw-soul'].value='';
  vm.runInContext('syncWritingMethodChoice()',context);
  assert.equal(els['#fw-template'].disabled,false,'取消灵魂后写作提示词恢复可选');
  assert.equal(els['#fw-soul'].disabled,true,'默认写作提示词模式下灵魂置灰');
  assert.equal(els['#fw-template-note'].textContent,'视频口播 · v1');
});

test('后台生成新版本后，本地未保存草稿不会盖住服务端正文',async()=>{
  const source=await readFile(new URL('../public/writing-workbench.js',import.meta.url),'utf8');
  const context=vm.createContext({fullWriter:{drafts:{rewrite:{}},recoveryDrafts:{}},sessionStorage:{getItem:()=>null,setItem(){}}});
  vm.runInContext(source,context);
  vm.runInContext("globalThis.cached={dirty:true,jobId:'j',baseBody:'',output:''};protectChangedWriterBody({id:'j',body:'服务端新正文'},globalThis.cached);",context);
  assert.equal(context.cached.dirty,false,'正文已变，缓存不再生效');
  assert.equal(context.cached.output,'');
  const fresh=vm.runInContext("({dirty:true,jobId:'j',baseBody:'当前正文',output:'我的修改'})",context);
  vm.runInContext("protectChangedWriterBody({id:'j',body:'当前正文'},globalThis.fresh)",context);
  assert.equal(fresh.dirty,true,'基于同一版正文的本地修改仍然保留');
});


test('writer does not restore a removed duration control from legacy session drafts',async()=>{
 const source=await readFile(new URL('../public/writing-style.js',import.meta.url),'utf8');
 const context=vm.createContext({$:()=>null});vm.runInContext(source,context);
 assert.equal(vm.runInContext("writerStyleValues({durationMode:''}).durationMode",context),'original');
 assert.equal(vm.runInContext("writerStyleValues({durationMode:'custom'}).durationMode",context),'original');
});

test('explicitly unchecking every library sends empty arrays instead of restoring template knowledge',async()=>{
 const source=await readFile(new URL('../public/writing-workbench.js',import.meta.url),'utf8');let sent;
 const job={id:'j',originalBody:'原文',body:'正文'};
 const ctx=vm.createContext({state:{data:{jobs:[job],templates:[{id:'t',active:true,knowledgeSetIds:['bound']}] }},sessionStorage:{getItem:()=>null,setItem(){}},writerStyleValues:()=>({}),api:async(_url,options)=>{sent=JSON.parse(options.body);return {...job,...sent}}});
 vm.runInContext(source,ctx);
 vm.runInContext("fullWriter.jobId='j';fullWriterDraft=()=>({original:'原文',title:'',output:'正文',templateId:'t',scope:'selected',knowledgeSetIds:[],documentIds:[]})",ctx);
 await vm.runInContext('saveFullWriterInput()',ctx);assert.deepEqual(sent.knowledgeSetIds,[]);assert.deepEqual(sent.documentIds,[]);
 vm.runInContext("fullWriterDraft=()=>({original:'原文',title:'',output:'正文',templateId:'t',scope:'template',knowledgeSetIds:[],documentIds:[]})",ctx);
 await vm.runInContext('saveFullWriterInput()',ctx);assert.equal(sent.knowledgeSetIds,null);assert.equal(sent.documentIds,null);
});

test('template-bound libraries display checked initially but stay unchecked after an explicit override',async()=>{
 const source=await readFile(new URL('../public/prompt-library.js',import.meta.url),'utf8');
 const ctx=vm.createContext({state:{data:{templates:[{id:'t',knowledgeSetIds:['bound']}],knowledgeSets:[{id:'bound',name:'飞书资料',documentIds:[]}],documents:[]}},libraryGroups:()=>[],esc:x=>x});vm.runInContext(source,ctx);
 assert.match(vm.runInContext("writerLibraryChoices({templateId:'t'})",ctx),/data-fw-set="bound" checked/);
 assert.doesNotMatch(vm.runInContext("writerLibraryChoices({templateId:'t',scope:'selected',knowledgeSetIds:[]})",ctx),/data-fw-set="bound" checked/);
});
