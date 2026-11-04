import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {douyinLoginRoute} from '../src/douyin-login.mjs';

test('reading state survives replacement: expanded details, page position, log position; focused fields defer updates',async()=>{
 const source=await readFile(new URL('../public/collection-workbench.js',import.meta.url),'utf8');
 let draws=0;
 const oldDetails={dataset:{readingKey:'options'},open:true},newDetails={dataset:{readingKey:'options'},open:false};
 const page={scrollTop:900,scrollLeft:0,isConnected:true};
 const log={dataset:{logFor:'task'},scrollTop:55,scrollLeft:0,isConnected:true};
 let replaced=false;
 const node={contains:()=>false,querySelectorAll:()=>[replaced?newDetails:oldDetails],querySelector:()=>log};
 const doc={scrollingElement:page,querySelectorAll:()=>[log],activeElement:null};
 const context=vm.createContext({document:doc,CSS:{escape:x=>x}});vm.runInContext(source,context);
 context.node=node;context.draw=()=>{draws++;replaced=true;page.scrollTop=0;log.scrollTop=0;};
 assert.equal(vm.runInContext('preserveCollectionReading(node,draw)',context),true);
 assert.equal(draws,1);assert.equal(newDetails.open,true);assert.equal(page.scrollTop,900);assert.equal(log.scrollTop,55);
 doc.activeElement={matches:()=>true};node.contains=()=>true;
 assert.equal(vm.runInContext('preserveCollectionReading(node,draw)',context),false);assert.equal(draws,1);
});

test('login gate remains visible with partial results and stage receipts',async()=>{
 const context=vm.createContext({esc:x=>String(x??''),collectionStateLabel:x=>x});
 vm.runInContext(await readFile(new URL('../public/collection-workbench.js',import.meta.url),'utf8'),context);
 const html=vm.runInContext("collectionProgressLog({id:'task',state:'succeeded',count:10,coverage:{complete:false,error:'platform_login_required'},workflow:{state:'paused',step:'transcribe'}},[{taskKind:'douyin-asr',state:'partial',logs:'9 completed, 1 unknown'}])",context);
 assert.match(html,/data-douyin-login/);assert.match(html,/10 条/);assert.match(html,/9 completed, 1 unknown/);assert.match(html,/data-log-for/);
});

test('QR login starts one process, accepts only a validated state file and never returns credentials',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'studio-login-'));
 const previous={key:process.env.DASHSCOPE_API_KEY,path:process.env.DOUYIN_STATE_PATH};
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
 let calls=0,response;
 const ctx={req:{method:'POST'},res:{},url:new URL('http://localhost/api/studio/douyin/login'),json:(_,status,data)=>{response={status,data:{...data}};},dataDir,root:join(dataDir,'src'),launch:()=>{calls++;return child;}};
 try{
  process.env.DASHSCOPE_API_KEY='private-test-key';
  await douyinLoginRoute(ctx);await douyinLoginRoute(ctx);assert.equal(calls,1);assert.equal(response.data.state,'waiting');
  await writeFile(join(dataDir,'douyin-scan-state.json'),JSON.stringify({cookies:[{name:'sessionid',value:'private-cookie',domain:'.douyin.com',expires:-1}],origins:[]}));
  await Promise.all(child.listeners('close').map(fn=>fn(0)));
  await douyinLoginRoute({...ctx,req:{method:'GET'}});
  assert.equal(response.data.state,'succeeded');assert.doesNotMatch(JSON.stringify(response),/private-cookie|private-test-key/);
  assert.equal(process.env.DOUYIN_STATE_PATH,join(dataDir,'douyin-scan-state.json'));
 }finally{for(const [key,value] of [['DASHSCOPE_API_KEY',previous.key],['DOUYIN_STATE_PATH',previous.path]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(dataDir,{recursive:true,force:true});}
});
