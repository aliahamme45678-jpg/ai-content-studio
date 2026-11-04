import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountStats, analysisPrompt, parseVideoAnalysis } from '../src/account-analysis.mjs';
import { executeAccountAnalysis, accountAnalysisRoutes, recoverVideoResults } from '../src/account-analysis-routes.mjs';

const rows=Array.from({length:10},(_,i)=>({aweme_id:String(100+i),title:i===7?'推荐产品，主页领取 #工具':'一个实用选题 #工具',create_time:Date.parse(`2026-11-${String(i+1).padStart(2,'0')}T12:00:00+08:00`)/1000,digg_count:i===7?20000:1000,collect_count:i===7?100:500,comment_count:20,share_count:10,content:'先整理真实产品资料，再讲具体步骤，不用空泛承诺。',url:`https://www.douyin.com/video/${100+i}`}));
const answer=v=>({id:v.id,tags:v.anomaly?['异常爆款','广告作品']:['普通文案'],topic:'工具使用',hook:'具体方法开头',technique:'步骤讲解',reason:'与普通作品相比互动明显变化，但仍需区分推广与选题作用。',evidence:[{quote:v.title,why:'标题直接呈现话题和推广线索'}],promotion:'商业推广倾向，实际投流未知',funnel:v.funnels.join('、')||'未发现',hotspot:'未提供外部热点证据',confidence:'中'});

test('truncated paid responses recover only complete independently validated video results',()=>{
  const stats=accountStats(rows);const first=answer(stats.videos[0]);const bad={...answer(stats.videos[1]),evidence:[{quote:'不存在的引文',why:'捏造'}]};
  const raw='{"videos":['+JSON.stringify(first)+','+JSON.stringify(bad)+',{"id":"truncated';
  const recovered=recoverVideoResults([{raw}],stats.videos);assert.deepEqual(recovered.map(v=>v.id),[first.id]);
  assert.equal(recoverVideoResults([{raw}],stats.videos,recovered).length,1);
});

test('account baseline, chronological breakout and ratio clues retain unknown data honestly',()=>{
  const stats=accountStats([...rows].reverse());assert.equal(stats.baseline.medianLikes,1000);assert.equal(stats.baseline.anomalies,1);assert.equal(stats.videos[0].date,'2026-11-01');assert.equal(stats.baseline.firstBreakoutId,'107');
  const spike=stats.videos.find(v=>v.id==='107');assert.equal(spike.medianMultiple,20);assert.equal(spike.saveLikeRatio,.005);assert.deepEqual(spike.funnels,['主页']);assert.match(spike.paidSignal,/待核验/);
  assert.equal(stats.turningPoints[0].previous.count,7);assert.equal(stats.turningPoints[0].following.count,3);assert.equal(stats.turningPoints[0].previous.medianLikes,1000);assert.equal(stats.turningPoints[0].following.medianLikes,1000);assert.match(stats.turningPoints[0].pattern,/单条突出/);
  const unknown=accountStats([{title:'无数据',aweme_id:'missing'}]);assert.equal(unknown.baseline.medianLikes,null);assert.equal(unknown.videos[0].saveLikeRatio,null);assert.equal(unknown.videos[0].anomaly,false);
  assert.throws(()=>accountStats(rows,{spikeMultiple:1}));
});

test('stopping keeps completed batch and resuming skips already analyzed videos',async()=>{
  const oldBase=process.env.LLM_BASE_URL;process.env.LLM_BASE_URL='http://local-fixture';
  const stats=accountStats(rows),task={id:'account-task',rows},db={accountAnalyses:[]},run={id:'stopped',state:'running'};let calls=0;
  try{
    await executeAccountAnalysis({db,run,task,stats,context:'',saveDb:async()=>{},fetcher:async(_url,options)=>{calls++;run.cancelRequested=true;const input=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(input.videos.length,2);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({videos:input.videos.map(v=>answer(stats.videos.find(row=>row.id===v.id)))})}}]}));}});
    assert.equal(run.state,'cancelled');assert.equal(run.completedVideos,2);assert.equal(calls,1);assert.equal(db.accountAnalyses.length,0);
    const resumed={id:'resumed',state:'running',videoResults:structuredClone(run.videoResults)};
    await executeAccountAnalysis({db,run:resumed,task,stats,context:'',saveDb:async()=>{},fetcher:async(_url,options)=>{calls++;const input=JSON.parse(JSON.parse(options.body).messages[1].content);if(!input.aggregate){assert.equal(input.videos.length,2);assert.ok(input.videos.every(v=>!run.videoResults.some(done=>done.id===v.id)));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({videos:input.videos.map(v=>answer(stats.videos.find(row=>row.id===v.id)))})}}]}));}assert.equal(input.aggregate.totalAnalyzed,10);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({overview:'续跑汇总',breakout:{date:'资料不足',reason:'样本不足',videoIds:[]},patterns:[],nextSteps:[]})}}]}));}});
    assert.equal(resumed.state,'succeeded');assert.equal(calls,6);assert.equal(db.accountAnalyses[0].videos.length,10);
  }finally{if(oldBase===undefined)delete process.env.LLM_BASE_URL;else process.env.LLM_BASE_URL=oldBase;}
});

test('manual transcript edits stay available after model failure and block active writers',async()=>{
  const task={id:'task',taskKind:'douyin-collect',request:{mode:'profile',urls:['https://www.douyin.com/user/test']},rows:[{aweme_id:'1',content:'旧正文'}]};const db={taskRuns:[task]};let status,result,saves=0;
  const ctx={req:{method:'POST'},res:{},url:new URL('http://local/api/studio/douyin/account-analysis/task/transcript'),db,json:(_res,s,r)=>{status=s;result=r;},body:async()=>({videoId:'1',text:'校对后的正文'}),saveDb:async()=>{saves++;}};
  await accountAnalysisRoutes(ctx);assert.equal(status,200);assert.equal(result.analysisNeedsRefresh,true);assert.equal(task.rows[0].content,'校对后的正文');assert.equal(task.transcriptVersions[0].text,'旧正文');assert.equal(saves,1);
  await accountAnalysisRoutes(ctx);assert.equal(result.reused,true);assert.equal(task.transcriptVersions.length,1);
  db.taskRuns.push({jobId:'task',taskKind:'account-analysis',state:'unknown'});await accountAnalysisRoutes(ctx);assert.equal(result.reused,true);
  db.taskRuns.push({jobId:'task',taskKind:'account-analysis',state:'running'});await assert.rejects(accountAnalysisRoutes(ctx),/stop_or_review/);
});

test('single-video collection supports manual copy and idempotent writing handoff without ASR or account analysis',async()=>{
  const task={id:'single',taskKind:'douyin-collect',state:'succeeded',request:{mode:'links',urls:['https://www.douyin.com/video/123']},rows:[{aweme_id:'123',title:'真实来源标题',url:'https://www.douyin.com/video/123',author_name:'作者'}]};
  const db={taskRuns:[task],documents:[],sources:[],documentVersions:[]};let result,status;
  const call=async(action,input)=>{await accountAnalysisRoutes({req:{method:'POST'},res:{},url:new URL(`http://local/api/studio/douyin/tasks/single/${action}`),db,json:(_r,s,v)=>{status=s;result=v;},body:async()=>input,saveDb:async()=>{}});return result;};
  await assert.rejects(call('prepare-writing',{videoId:'123'}),/transcript_required/);
  await call('transcript',{videoId:'123',text:'用户已有的完整转写正文'});assert.equal(status,200);
  const first=await call('prepare-writing',{videoId:'123'});assert.equal(first.content,'用户已有的完整转写正文');assert.equal(first.sourceTaskId,'single');assert.equal(db.documents.length,1);
  const second=await call('prepare-writing',{videoId:'123'});assert.equal(second.id,first.id);assert.equal(db.documents.length,1);
  await call('transcript',{videoId:'123',text:'校对后的完整转写正文'});await call('prepare-writing',{videoId:'123'});assert.equal(db.documents[0].version,2);assert.equal(db.documentVersions[0].content,'用户已有的完整转写正文');
  task.state='running';await assert.rejects(call('transcript',{videoId:'123',text:'不应覆盖'}),/collection_result_unavailable/);
});

test('AI classifications require exact evidence, real IDs, verified anomalies and transcripts',()=>{
  const stats=accountStats(rows),v=stats.videos[0],item=answer(v);
  assert.equal(parseVideoAnalysis(JSON.stringify({videos:[item]}),[v]).length,1);
  assert.throws(()=>parseVideoAnalysis(JSON.stringify({videos:[{...item,evidence:[{quote:'捏造的原句',why:'x'}]}]}),[v]),/invented_quote/);
  assert.throws(()=>parseVideoAnalysis(JSON.stringify({videos:[{...item,id:'fabricated'}]}),[v]),/unknown_or_duplicate/);
  assert.throws(()=>parseVideoAnalysis(JSON.stringify({videos:[{...item,tags:['异常爆款']}]}),[v]),/unverified_anomaly/);
  assert.throws(()=>parseVideoAnalysis(JSON.stringify({videos:[item]}),[{...v,transcript:''}]),/requires_transcript/);
  assert.match(analysisPrompt(stats,[v]).system,/不能单独判定投流/);
});

test('account analysis persists full video classifications and grounded summary, preserving unknown model outcomes',async()=>{
  const oldBase=process.env.LLM_BASE_URL;process.env.LLM_BASE_URL='http://local-fixture';
  const stats=accountStats(rows),task={id:'account-task',rows},db={accountAnalyses:[]},run={id:'analysis',inputHash:'fixture',state:'running'};
  const fetcher=async(_url,options)=>{const request=JSON.parse(options.body);const input=JSON.parse(request.messages[1].content);const output=input.videos[0]?.transcript!==undefined?{videos:input.videos.map(v=>answer(stats.videos.find(s=>s.id===v.id)))}:{overview:'账号通过工具选题和具体步骤获得互动，个别推广作品异常突出。',breakout:{date:'2026-11-08',videoIds:['107'],reason:'推广标题与互动跃升共现',alternatives:'分发、投放或外部传播也可能影响'},patterns:[{name:'具体步骤',explanation:'围绕一个问题讲操作，再引导查看主页',videoIds:['107']}],advertising:'异常作品带推广线索',funnels:'主页',nextSteps:['对比同题材作品']};return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}));};
  try{
    await executeAccountAnalysis({db,run,task,stats,context:'工具行业',saveDb:async()=>{},fetcher});assert.equal(run.state,'succeeded');assert.equal(db.accountAnalyses[0].videos.length,10);assert.equal(db.accountAnalyses[0].summary.breakout.date,'2026-11-08');
    const unknown={id:'unknown',state:'running'};await executeAccountAnalysis({db,run:unknown,task,stats,context:'',saveDb:async()=>{},fetcher:async()=>{throw new Error('network lost');}});assert.equal(unknown.state,'unknown');assert.equal(db.accountAnalyses.length,1);
    const upstreamFailure={id:'gateway-error',state:'running'};await executeAccountAnalysis({db,run:upstreamFailure,task,stats,context:'',saveDb:async()=>{},fetcher:async()=>new Response('{"error":"upstream unavailable"}',{status:502,headers:{'x-request-id':'fixture-request'}})});assert.equal(upstreamFailure.state,'unknown');assert.equal(upstreamFailure.httpFailure.status,502);assert.equal(upstreamFailure.httpFailure.requestId,'fixture-request');assert.match(upstreamFailure.httpFailure.detail,/upstream unavailable/);
    const unreachable={id:'unreachable',state:'running'};await executeAccountAnalysis({db,run:unreachable,task,stats,context:'',saveDb:async()=>{},fetcher:async()=>{throw new TypeError('fetch failed',{cause:Object.assign(new Error('connect refused'),{code:'ECONNREFUSED'})});}});assert.equal(unreachable.state,'failed');assert.equal(unreachable.errorCode,'ECONNREFUSED');
  }finally{if(oldBase===undefined)delete process.env.LLM_BASE_URL;else process.env.LLM_BASE_URL=oldBase;}
});
