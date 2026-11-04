import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('persisted automatic collection resumes on the server and saves writing-ready material without per-stage requests',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'studio-autoflow-'));
 const seed={sources:[],documents:[],templates:[],jobs:[],taskRuns:[{id:'c',taskKind:'douyin-collect',state:'succeeded',request:{mode:'profile',purpose:'account-analysis',urls:['https://www.douyin.com/user/fixture']},rows:[{aweme_id:'12345',title:'自动流程验收',content:'已有的完整语音正文',url:'https://www.douyin.com/video/12345'}],workflow:{state:'running',step:'collected',options:{transcribe:true,saveLibrary:true,syncFeishu:false},steps:{}}}]};await writeFile(join(dir,'studio.json'),JSON.stringify(seed));
 let modelCalls=0;const fake=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);modelCalls++;const system=request.messages[0].content;let result;
 if(system.includes('抖音账号起号研究员')){const input=JSON.parse(request.messages[1].content);result={videos:input.videos.map(v=>({id:v.id,tags:['普通文案'],topic:'素材整理',hook:'直接表达',technique:'步骤讲述',reason:'测试样本',promotion:'没有线索',funnel:'没有线索',hotspot:'未知',evidence:[{quote:v.title,why:'提供选题'}]}))};}
 else result={overview:'自动流程测试报告',breakout:{date:'资料不足',videoIds:['12345'],reason:'样本不足',alternatives:'未知'},patterns:[],nextSteps:[]};res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));});await new Promise(r=>fake.listen(0,'127.0.0.1',r));
 const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const child=spawn(process.execPath,['src/server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',STUDIO_DATA_DIR:dir,STUDIO_TOKEN:'',STUDIO_PASSWORD_GATE:'off',AIHOT_DATABASE_URL:'',DASHSCOPE_API_KEY:'',MODEL_CALLS_ENABLED:'true',LLM_BASE_URL:`http://127.0.0.1:${fake.address().port}`,LLM_API_KEY:'fixture',LLM_MODEL:'fixture'},stdio:['ignore','pipe','pipe']});
 try{await new Promise((r,j)=>{child.stdout.once('data',r);child.once('error',j);child.once('exit',code=>j(new Error('exit '+code)));});
 const api=async(path,post=false)=>{const res=await fetch(`http://127.0.0.1:${port}/api/studio${path}`,{method:post?'POST':'GET',headers:{'content-type':'application/json'},...(post?{body:JSON.stringify(typeof post==='object'?post:{})}:{})});return {status:res.status,data:await res.json()};};
 assert.equal((await api('/douyin/tasks/c')).data.workflow.state,'paused');assert.equal((await api('/douyin/tasks/c/workflow-resume',true)).status,202);
 let task;for(let i=0;i<100;i++){task=(await api('/douyin/tasks/c')).data;if(task.workflow.state!=='running')break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(task.workflow.state,'succeeded');assert.equal(task.workflow.steps.transcribe.result.reused,1);assert.equal(task.workflow.steps.library.result.documentIds.length,1);assert.equal((await api('/overview')).data.documents.length,0,'automatic collection output is not a curated library asset');assert.equal(JSON.parse(await readFile(join(dir,'studio.json'),'utf8')).documents[0].content,'已有的完整语音正文');assert.equal((await api('/douyin/tasks/c/workflow-resume',true)).status,409);
 const options={transcribe:false,saveLibrary:true,syncFeishu:false,analyze:true,confirmModel:true,analysisContext:'找转折'};
 assert.equal((await api('/douyin/tasks/c/workflow-start',{workflow:options})).status,202);
 for(let i=0;i<100;i++){task=(await api('/douyin/tasks/c')).data;if(task.workflow.state!=='running')break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(task.workflow.state,'succeeded');assert.ok(task.workflow.steps.analysis.result.reportId);assert.equal(modelCalls,2);
 const account=(await api('/douyin/account-analysis?taskId=c')).data;assert.equal(account.tasks[0].workflow.state,'succeeded');assert.equal(account.report.summary.overview,'自动流程测试报告');assert.equal(account.report.videos.length,1);const list=(await api('/douyin/account-analysis?view=tasks')).data;assert.equal(list.report,null);assert.equal(list.stats,null);assert.deepEqual(list.partialVideoResults,[]);assert.equal(list.tasks[0].analysisState,'已完成');
 assert.equal((await api('/douyin/tasks/c/workflow-start',{workflow:options})).status,202);
 for(let i=0;i<100;i++){task=(await api('/douyin/tasks/c')).data;if(task.workflow.state!=='running')break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(task.workflow.state,'succeeded');assert.equal(modelCalls,2,'reusing the same report never repeats paid analysis');
 }finally{child.kill();await new Promise(r=>child.once('close',r));await new Promise(r=>fake.close(r));await rm(dir,{recursive:true,force:true});}
});
