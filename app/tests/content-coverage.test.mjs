import test from 'node:test';
import assert from 'node:assert/strict';
import {originalPoints,coverageReport,realCharCount} from '../src/content-coverage.mjs';
import {prepareHookWriting,finishHookWriting} from '../src/hook-writing.mjs';

const original='第一步先算清楚毛利，不要凭感觉定价。第二步只看一个品类的转化率，把 15% 作为及格线。第三步每场直播后复盘，记录停留时长和成交单数。另外把每条视频的开头三秒单独记下来，方便横向对比。每周固定一天只做数据整理，不拍新素材。所以新手缺的不是流量，是核对的顺序。';
const restored=original;
const lostDetail='第一步先算清楚毛利，不要凭感觉定价。第二步只看一个品类的转化率，把 15% 作为及格线。另外把每条视频的开头三秒单独记下来，方便横向对比。每周固定一天只做数据整理，不拍新素材。所以新手缺的不是流量，是核对的顺序。';
const lostFact='第一步先算清楚毛利，不要凭感觉定价。第三步每场直播后复盘，记录停留时长和成交单数。另外把每条视频的开头三秒单独记下来，方便横向对比。每周固定一天只做数据整理，不拍新素材。所以新手缺的不是流量，是核对的顺序。';

function fixture(generated,target){
 const db={documents:[],sources:[],knowledgeSets:[],taskRuns:[],templates:[],jobs:[]};
 const job={id:'j',targetWordCount:target,hookType:'扎心共情型',originalBody:original,topic:'',documentIds:[],knowledgeSetIds:[],templateSnapshot:{id:'tpl',prompt:'ONLY_REWRITE',rules:[]}};
 return {db,job,run:{id:'run',state:'running'},saveDb:async()=>{},env:{LLM_BASE_URL:'https://model.test/v1',LLM_API_KEY:'test',LLM_MODEL:'test'},generated};
}
function fetcher(ctx,calls,bodyForRepair){
 return async(_url,options)=>{
  JSON.parse(JSON.parse(options.body).messages[1].content);
  calls.push(ctx.run.phase);
  const value=ctx.run.phase==='validating-opening'
   ?{passed:true,hookType:'扎心共情型',checks:Object.fromEntries(['facts','type','continuity','copyType','style','originality'].map(key=>[key,true])),issues:[]}
   :{body:bodyForRepair,corePoint:'核对顺序',needsVerification:[]};
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
 };
}

test('原稿要点覆盖数字与操作步骤，关键事实缺失才算未通过',()=>{
 const points=originalPoints({originalBody:original});
 assert.ok(points.length>=3,'步骤句都进入要点清单');
 const soft=coverageReport(lostDetail,points);
 assert.equal(soft.ok,true,'只丢叙述细节时不直接判失败');
 assert.ok(soft.softMissing.some(item=>item.text.includes('复盘')),'丢掉的细节仍被记录');
 const hard=coverageReport(lostFact,points);
 assert.equal(hard.ok,false);
 assert.ok(hard.criticalMissing.some(item=>item.lostFacts.some(fact=>fact.startsWith('15'))),'金额/比例丢失被拦下');
 assert.equal(coverageReport(original,points).criticalCoverage,1,'原稿自身必然全通过');
 assert.equal(realCharCount(' 一 二 '),2);
});

test('改写丢失关键事实时先补回再校验，用户指定字数按 ±10% 判定',async()=>{
 const target=realCharCount(restored);
 const ctx=fixture(lostFact,target);const calls=[];ctx.fetcher=fetcher(ctx,calls,restored);
 const prepared=await prepareHookWriting(ctx);
 const result=await finishHookWriting(ctx,prepared,{body:lostFact,corePoint:'',needsVerification:[]});
 assert.ok(calls.includes('restoring-original-points'),'先走原稿要点补回阶段');
 assert.ok(calls.indexOf('restoring-original-points')<calls.indexOf('validating-opening'),'补回发生在校验之前');
 assert.equal(ctx.run.coverageRestore.before.critical<1,true);
 assert.equal(ctx.run.coverageRestore.after.critical,1,'补回后关键事实齐全');
 assert.equal(result.body,restored);
 assert.equal(ctx.run.hookValidation.coverageIssues.length,0);
 const range=ctx.run.hookValidation.lengthAdjudication.allowedRange;
 assert.deepEqual(range,[Math.round(target*.9),Math.round(target*1.1)],'用户指定字数按 ±10% 判定');
});

test('补不回来时不假装通过，标记人工确认并保留缺失事实',async()=>{
 const target=realCharCount(lostFact);
 const ctx=fixture(lostFact,target);const calls=[];ctx.fetcher=fetcher(ctx,calls,lostFact);
 const prepared=await prepareHookWriting(ctx);
 await finishHookWriting(ctx,prepared,{body:lostFact,corePoint:'',needsVerification:[]});
 assert.ok(calls.includes('repairing-final-validation'),'校验不通过会再修一次');
 assert.equal(ctx.run.hookValidation.finalPassed,false);
 assert.equal(ctx.run.hookValidation.needsHumanReview,true);
 assert.ok(ctx.run.coverage.criticalMissing.length>0,'缺失事实保留在回执里');
 assert.ok(ctx.run.coverage.criticalMissing.every(item=>item.lostFacts.length>0));
});
