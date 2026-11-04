import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sourceVideoId,restoreFeishuTranscripts} from '../src/restore-feishu-transcripts.mjs';

test('Feishu restore uses exact author and video IDs, preserves edits, rejects conflicting sources',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'studio-restore-'));
  const task={id:'task',rows:['1','2','3','4'].map(id=>({aweme_id:id,author_name:'作者',url:`https://www.douyin.com/video/${id}`}))};task.rows[1].content='手动校对';
  const db={integration:{feishu:{baseToken:'base',tableId:'table'}},taskRuns:[]};
  const record=(id,text,author='作者')=>({record_id:`rec-${id}`,作者:author,'原文 / 文案':text,来源链接:`[作品](https://www.iesdouyin.com/share/video/${id}/)`});
  let calls=0;
  const call=async(args,{cwd})=>{calls++;assert.match(args[args.indexOf('--filter-json')+1],/作者/);const records=calls===1?[record('1','飞书正文'),record('2','旧正文'),record('3','冲突一')]:[record('3','冲突二'),record('4','其他作者','同名外部')];await writeFile(join(cwd,args[args.indexOf('--output')+1]),records.map(JSON.stringify).join('\n'));return {has_more:calls===1,next_offset:3};};
  try{
    assert.equal(sourceVideoId('[链接](https://www.iesdouyin.com/share/video/123/)'),'123');assert.equal(sourceVideoId('https://evil.example/video/123'),null);
    const result=await restoreFeishuTranscripts({db,task,dataDir:dir,call});
    assert.deepEqual([result.restored,result.alreadyPresent,result.notMatched,result.ambiguous],[1,1,1,1]);assert.equal(task.rows[0].content,'飞书正文');assert.equal(task.rows[1].content,'手动校对');assert.equal(task.rows[2].content,undefined);assert.equal(task.rows[3].content,undefined);assert.equal(task.rows[0].transcriptSource.recordId,'rec-1');
    db.taskRuns.push({jobId:'task',taskKind:'douyin-asr',state:'unknown'});
    await assert.rejects(restoreFeishuTranscripts({db,task,dataDir:dir,call}),/stop_or_review/);assert.equal(calls,2);
  }finally{await rm(dir,{recursive:true,force:true});}
});
