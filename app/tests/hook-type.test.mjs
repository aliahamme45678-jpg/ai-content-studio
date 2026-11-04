import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareHookWriting,finishHookWriting,resumeFinalRepair,isLengthIssue} from '../src/hook-writing.mjs';
import {writingConfig,auditConfigHash,draftContext} from '../src/workflow.mjs';
import {hookTypes} from '../src/writing-style.mjs';

const body='为什么你的TikTok店铺有曝光，却还是没有订单？先别急着加预算。先看商品介绍是否回答了买家关心的问题，再检查价格与履约信息，最后看详情页是否兑现了视频里的承诺。把每一步实际核对清楚，再判断问题出在哪里，不要凭印象改来改去。';
const types=hookTypes;
test('opening overlap is not removed as a mistaken length complaint',()=>{
 assert.equal(isLengthIssue('开头与原稿连续12字重合，需要重写首句。'),false);
 assert.equal(isLengthIssue('正文只有350字，未达到目标500字。'),true);
});
test('an opening-only rejection rewrites the opening and preserves the rest of the draft',async()=>{
 const ctx=fixture();let validations=0;const phases=[];
 const fresh='曝光一直涨，订单却停在原地，先把转化环节逐个查明白。';
 ctx.fetcher=async(_url,options)=>{
  phases.push(ctx.run.phase);let value;
  if(ctx.run.phase==='validating-opening'){
   const passed=++validations>1;value={passed,hookType:ctx.job.hookType,checks:{facts:true,type:passed,continuity:true,style:true,originality:passed,copyType:true},issues:passed?[]:['开头与原稿连续12字重合，需要重新改写首句。']};
  }else if(ctx.run.phase==='repairing-opening')value={opening:fresh};
  else throw Error('Unexpected repair phase');
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
 };
 const prepared=await prepareHookWriting(ctx);const result=await finishHookWriting(ctx,prepared,{body,corePoint:'',needsVerification:[]});
 assert.equal(result.body,fresh+body.slice(body.indexOf('？')+1));
 assert.deepEqual(phases,['validating-opening','repairing-opening','validating-opening']);
 assert.equal(ctx.run.openingRepair.bodyPreserved,true);assert.equal(ctx.run.hookValidation.finalPassed,true);
});
function fixture(mode='rewrite'){
 const db={documents:[],sources:[],knowledgeSets:[],taskRuns:[],templates:[],jobs:[]};
 const job={id:'j',targetWordCount:body.length,hookType:'悬念好奇型',originalBody:mode==='rewrite'?body:'',topic:mode==='topic'?'TikTok店铺有曝光却不出单':'',documentIds:[],knowledgeSetIds:[],templateSnapshot:{prompt:mode==='rewrite'?'改写规范ONLY_REWRITE':'话题规范ONLY_TOPIC',rules:[]}};
 const run={id:'run',state:'running'};
 return {db,job,run,saveDb:async()=>{},env:{LLM_BASE_URL:'https://model.test/v1',LLM_API_KEY:'test',LLM_MODEL:'test'}};
}
function fetcher(ctx,calls){
 return async(_url,options)=>{
  const messages=JSON.parse(options.body).messages;const input=JSON.parse(messages[1].content);
  calls.push({phase:ctx.run.phase,system:messages[0].content,input});
  const value=ctx.run.phase==='validating-opening'
   ?{passed:true,hookType:ctx.job.hookType,checks:Object.fromEntries(['facts','type','continuity','style','originality'].map(k=>[k,true])),issues:[]}
   :{body,corePoint:'核对转化环节',needsVerification:[]};
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
 };
}

test('hook type is a plain parameter: no library read and no extra model call before writing',async()=>{
 const ctx=fixture();const calls=[];
 ctx.fetcher=async(...args)=>{calls.push(args);throw Error('must not call model');};
 const prepared=await prepareHookWriting(ctx);
 assert.equal(prepared.plan.type,'悬念好奇型','user-selected type is carried through');
 assert.equal(prepared.plan.mode,'rewrite');
 assert.equal(prepared.plan.opening,'','no pre-generated opening');
 assert.equal(prepared.plan.source,null,'no library source');
 assert.equal(calls.length,0,'no model call and no knowledge retrieval');
 assert.equal(ctx.db.hookLibraries,undefined,'no hook library is required');
});

test('the unified writing context carries the chosen type and only the selected knowledge, not a hook library',()=>{
 const ctx=fixture();
 const {system,user}=draftContext(ctx.db,ctx.job);
 assert.match(system,/黄金三秒类型：悬念好奇型/,'type reaches the unified writing prompt');
 const payload=JSON.parse(user.slice(user.indexOf('{',user.indexOf('以下 JSON'))));
 assert.equal(payload.hookType,'悬念好奇型');
 assert.equal(payload.hookSelection,undefined,'old hook selection block is gone');
 assert.equal(payload.sources.length,0,'only user-selected knowledge is read (empty here)');
});

test('every configured hook type passes through unchanged and unknown labels fall back to AI auto',async()=>{
 assert.ok(types.length>=15,'知识库新增类型已并入统一清单');
 const ctx=fixture();
 for(const type of types){ctx.job.hookType=type;assert.equal((await prepareHookWriting(ctx)).plan.type,type,'类型原样透传：'+type);}
 ctx.job.hookType='AI自动识别';assert.equal((await prepareHookWriting(ctx)).plan.type,'AI自动识别');
 ctx.job.hookType='';assert.equal(await prepareHookWriting(ctx),null,'no selected type keeps the legacy non-hook flow');
});

test('legacy jobs carrying hookLibraryIds stay readable but no longer trigger library lookup or config validation',async()=>{
 const ctx=fixture();ctx.job.hookLibraryIds=['removed-library'];
 const prepared=await prepareHookWriting(ctx);
 assert.equal(prepared.plan.type,'悬念好奇型');
 assert.equal(writingConfig({},ctx.db,ctx.job).hookLibraryIds,undefined,'legacy field is dropped from new config');
 assert.doesNotThrow(()=>writingConfig({hookLibraryIds:['removed-library']},ctx.db));
 assert.equal(auditConfigHash(ctx.job),auditConfigHash({...ctx.job,hookLibraryIds:['x']}),'legacy library field no longer changes audit config');
 assert.notEqual(auditConfigHash(ctx.job),auditConfigHash({...ctx.job,hookType:'结果反差型'}),'type still invalidates the audit');
});

test('final validation checks the type and continuity without requiring a library mechanism, and repair resumes from the saved plan',async()=>{
 const ctx=fixture();const calls=[];ctx.fetcher=fetcher(ctx,calls);
 const prepared=await prepareHookWriting(ctx);
 const result=await finishHookWriting(ctx,prepared,{body,corePoint:'',needsVerification:[]});
 assert.deepEqual(calls.map(call=>call.phase),['validating-opening']);
 assert.equal(ctx.run.hookValidation.checks.sourceMechanism,undefined,'library-only check is no longer asked');
 assert.equal(result.body,body);
 assert.equal(ctx.run.hookValidation.finalPassed,true);
 const resumed=await resumeFinalRepair(ctx);
 assert.equal(resumed.body,body,'resume still works with the type-only plan');
});
