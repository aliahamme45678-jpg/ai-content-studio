import test from 'node:test';import assert from 'node:assert/strict';
import {retryVideoRow,mergeVideoRetryRows,videoRetryRoute,retryVideoSource} from '../src/video-retry.mjs';
test('retry targets one failed video and preserves successful sibling transcripts and metadata',async()=>{
 const good={aweme_id:'good',content:'保留正文',digg_count:123},bad={aweme_id:'bad',url:'https://www.douyin.com/video/bad',transcriptState:'failed'};const task={id:'t',taskKind:'douyin-collect',state:'succeeded',rows:[good,bad]};
 assert.equal(retryVideoRow(task,'bad'),bad);assert.throws(()=>retryVideoRow(task,'good'),/already_transcribed/);assert.throws(()=>retryVideoRow(task,'missing'),/not_found/);
 const merged=mergeVideoRetryRows(task.rows,[{...bad,content:'新转写',transcriptState:'succeeded'}],'bad');assert.equal(merged.length,2);assert.equal(merged[0],good);assert.equal(merged[1].content,'新转写');
 let selected,status;await videoRetryRoute({req:{method:'POST'},res:{},url:new URL('http://local/api/studio/douyin/tasks/t/videos/bad/retry'),db:{taskRuns:[task]},json:(_,code)=>status=code,body:async()=>({confirmPaid:true}),asrReady:true,startStage:async(db,t,stage,selection)=>{selected=selection;return {stageRun:{id:'retry',state:'running'}};}});assert.equal(status,202);assert.deepEqual(selected,{videoId:'bad',refreshSource:true,sourceUrl:'https://www.douyin.com/video/bad'});assert.equal(good.content,'保留正文');
 bad.transcriptState='unknown';assert.throws(()=>retryVideoRow(task,'bad'),/outcome_unknown/);
});
test('retry refuses duplicate active processing before starting a paid stage',async()=>{
 let calls=0;const task={id:'t',taskKind:'douyin-collect',rows:[{externalId:'v',url:'https://www.douyin.com/video/v'}]};
 const ctx={req:{method:'POST'},res:{},url:new URL('http://local/api/studio/douyin/tasks/t/videos/v/retry'),db:{taskRuns:[task,{jobId:'t',state:'running'}]},body:async()=>({confirmPaid:true}),asrReady:true,startStage:async()=>{calls++;}};
 await assert.rejects(videoRetryRoute(ctx),/source_processing/);assert.equal(calls,0);
});

test('official share links and existing IDs resolve to canonical video pages without accepting arbitrary hosts',()=>{
 const id='7571098075491982281',expected='https://www.douyin.com/video/'+id;
 assert.equal(retryVideoSource({aweme_id:id,url:'https://www.iesdouyin.com/share/video/'+id+'/?region=CN'}),expected);
 assert.equal(retryVideoSource({url:'https://www.iesdouyin.com/share/video/'+id+'/'}),expected);
 assert.equal(retryVideoSource({aweme_id:id}),expected);
 assert.equal(retryVideoSource({url:'https://v.douyin.com/abc/'}),'https://v.douyin.com/abc/');
 assert.throws(()=>retryVideoSource({url:'https://douyin.com.evil.example/video/123'}),/video_source_url_required/);
 assert.throws(()=>retryVideoSource({url:'file:///local'}),/video_source_url_required/);
});
