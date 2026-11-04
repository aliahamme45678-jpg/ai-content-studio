import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recognizeWriting} from '../src/writing-recognition.mjs';
import {hookTypes} from '../src/writing-style.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('AI recognition retrieves within the chosen knowledge boundary before composing the writing context',async()=>{
 const db={sources:[],knowledgeSets:[],templates:[],documents:[{id:'allowed',name:'反差钩子',type:'写作案例库',content:'反差钩子：先给结果，再解释机制。'},{id:'excluded',name:'反差钩子',type:'写作案例库',content:'不应读取'}]};
 const job={title:'测试文案',originalBody:'这是需要改写的原稿',templateSnapshot:{bindings:['写作案例库'],prompt:'按资料写'},sourceSnapshot:[],documentIds:['allowed'],hookType:'AI自动识别'};
 const run={};const old=process.env.LLM_BASE_URL;process.env.LLM_BASE_URL='https://example.test/v1';
 try{const context=await recognizeWriting({db,job,run,saveDb:async()=>{},fetcher:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({hookType:'结果反差型',copyStyle:'口语',copyType:'实战',searchQuery:'反差钩子'})}}]})})});assert.equal(run.recognition.hookType,'结果反差型');assert.equal(context.knowledge.length,1);assert.equal(context.knowledge[0].documentId,'allowed');assert.match(context.system,/结果反差型/);assert.equal(run.responses[0].phase,'recognition');assert.equal(run.phase,'generating');}finally{if(old===undefined)delete process.env.LLM_BASE_URL;else process.env.LLM_BASE_URL=old;}
});
test('a reasoning-only empty reply is retried with a larger budget instead of crashing inside JSON.parse',async()=>{
 const db={sources:[],knowledgeSets:[],templates:[],documents:[]};
 const job={title:'测试文案',originalBody:'这是需要改写的原稿',templateSnapshot:{bindings:[],prompt:''},sourceSnapshot:[],hookType:'AI自动识别',copyStyle:'AI自动识别',copyType:'AI自动识别'};
 const run={};const old=process.env.LLM_BASE_URL;process.env.LLM_BASE_URL='https://api.deepseek.com/v1';
 const bodies=[];let calls=0;
 try{const context=await recognizeWriting({db,job,run,saveDb:async()=>{},fetcher:async(url,options)=>{calls++;bodies.push(JSON.parse(options.body));const empty=calls===1;return {ok:true,json:async()=>({choices:[{message:{content:empty?'':JSON.stringify({hookType:'结果反差型',copyStyle:'口语',copyType:'实战',searchQuery:'反差'})},finish_reason:empty?'length':'stop'}],usage:{completion_tokens:700,completion_tokens_details:{reasoning_tokens:700}}})};}});
  assert.deepEqual(bodies.map(body=>body.max_tokens),[2000,4000]);assert.equal(bodies[0].reasoning_effort,'low');
  assert.equal(run.recognition.hookType,'结果反差型');assert.equal(run.emptyRecognition.reasoningTokens,700);
  assert.equal(run.responses.length,2);assert.ok(run.responses[1].retryOfEmptyOutput);assert.equal(run.awaitingResponse,false);assert.ok(context.system);
 }finally{if(old===undefined)delete process.env.LLM_BASE_URL;else process.env.LLM_BASE_URL=old;}
});
test('two empty replies report model_empty_output instead of an unexpected end of JSON input',async()=>{
 const db={sources:[],knowledgeSets:[],templates:[],documents:[]};
 const job={title:'测试文案',originalBody:'原稿',templateSnapshot:{bindings:[],prompt:''},sourceSnapshot:[],hookType:'AI自动识别'};
 const run={};const old=process.env.LLM_BASE_URL;process.env.LLM_BASE_URL='https://api.deepseek.com/v1';
 try{await assert.rejects(recognizeWriting({db,job,run,saveDb:async()=>{},fetcher:async()=>({ok:true,json:async()=>({choices:[{message:{content:''},finish_reason:'length'}],usage:{completion_tokens:700,completion_tokens_details:{reasoning_tokens:700}}})})}),/model_empty_output/);
  assert.equal(run.awaitingResponse,false);assert.equal(run.responses.length,2);
 }finally{if(old===undefined)delete process.env.LLM_BASE_URL;else process.env.LLM_BASE_URL=old;}
});
test('library groups Feishu and Markdown containers rather than a flat article list',async()=>{
 const ctx=vm.createContext({});vm.runInContext(await readFile(new URL('../public/library-groups.js',import.meta.url),'utf8'),ctx);
 const groups=vm.runInContext("libraryGroups([{id:'a',source:'feishu-export',name:'文章A'},{id:'b',source:'feishu-export',name:'文章B'},{id:'m',name:'规则.md',content:'正文'}])",ctx);
 assert.equal(groups.length,2);assert.equal(groups[0].docs.length,2);assert.equal(groups[1].kind,'Markdown 文件');
});

test('an array of keywords and an over-long style description are normalised instead of failing the run',async()=>{
 const db={sources:[],knowledgeSets:[],templates:[],documents:[]};
 const job={title:'测试文案',originalBody:'原稿内容',templateSnapshot:{bindings:[],prompt:''},sourceSnapshot:[],hookType:'AI自动识别',copyStyle:'AI自动识别',copyType:'AI自动识别'};
 const run={};const old=process.env.LLM_BASE_URL;process.env.LLM_BASE_URL='https://api.deepseek.com/v1';
 const longStyle='强口语化、'.repeat(40);
 try{const context=await recognizeWriting({db,job,run,saveDb:async()=>{},fetcher:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({hookType:['时间承诺','避坑警示'],copyStyle:longStyle,copyType:'教程',searchQuery:['口播文案','钩子设计','选品方法论']})},finish_reason:'stop'}]})})});
  assert.equal(run.recognition.searchQuery,'口播文案、钩子设计、选品方法论');
  assert.equal(run.recognition.rawHookType,'时间承诺、避坑警示','数组先归一成顿号串，再作为原始名保留');
  assert.equal(run.recognition.hookType,'AI自动识别','不在清单内且原稿无机制可判，回落为自动识别');
  assert.equal(run.recognition.copyStyle.length,150);
  assert.ok(context.system);
 }finally{if(old===undefined)delete process.env.LLM_BASE_URL;else process.env.LLM_BASE_URL=old;}
});

test('模型自造的类型名会被归一到合法清单，不再带着无法检索的类型往下走',async()=>{
 const db={sources:[],knowledgeSets:[],templates:[],documents:[]};
 const job={title:'测试',originalBody:'你以为问题在流量，其实问题在承接。',templateSnapshot:{bindings:[],prompt:''},sourceSnapshot:[],hookType:'AI自动识别'};
 const run={};const old=process.env.LLM_BASE_URL;process.env.LLM_BASE_URL='https://example.test/v1';
 try{
  await recognizeWriting({db,job,run,saveDb:async()=>{},fetcher:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({hookType:'痛点提问+权威揭秘',copyStyle:'口语',copyType:'实战',searchQuery:'开场'})}}]})})});
  assert.ok(hookTypes.includes(run.recognition.hookType),'归一结果必须在合法清单内');
  assert.equal(run.recognition.rawHookType,'痛点提问+权威揭秘','原始自造名保留便于追溯');
  assert.equal(run.recognition.hookType,'扎心共情型','无同名类型时按原稿开头机制兜底');
 }finally{if(old===undefined)delete process.env.LLM_BASE_URL;else process.env.LLM_BASE_URL=old;}
});
