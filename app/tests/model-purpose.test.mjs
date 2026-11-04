import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {modelProfilesRoute,modelEnv,loadModelProfiles} from '../src/model-profiles.mjs';
import {intelligenceModelRoute} from '../src/intelligence-model.mjs';
test('purpose assignments persist independently and actual intelligence calls use their own endpoint and key',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'spx-models-'));const db={taskRuns:[],sources:[{id:'news',title:'Test fact',summary:'source material'}]};const original={...process.env};
 const call=async input=>{let status,result;await modelProfilesRoute({req:{method:input?'POST':'GET'},res:{},url:new URL('http://local/api/studio/models/config'),json:(_,s,r)=>{status=s;result=r;},body:async()=>input,dataDir,db});return {status,result};};
 try{process.env.LLM_MODEL='default';
 const a=(await call({name:'Writer',model:'writer',baseUrl:'https://writer.example/v1',apiKey:'secret-writer',saveOnly:true,purposes:['writing','audit']})).result;
 const b=(await call({name:'Research',model:'research',baseUrl:'https://research.example/v1',apiKey:'secret-research',saveOnly:true,purposes:['intelligence']})).result;
 assert.equal(modelEnv('writing').LLM_MODEL,'writer');assert.equal(modelEnv('audit').LLM_MODEL,'writer');assert.equal(modelEnv('intelligence').LLM_MODEL,'research');assert.equal(process.env.LLM_MODEL,'default');assert.ok(!JSON.stringify(b).includes('secret-research'));
 await loadModelProfiles(dataDir);assert.equal(modelEnv('intelligence').LLM_MODEL,'research');
 let out;await intelligenceModelRoute({req:{method:'POST'},res:{},url:new URL('http://local/api/studio/sources/news/analyze'),db,json:(_,s,r)=>{assert.equal(s,200);out=r;},saveDb:async()=>{}},async(url,options)=>{assert.equal(url,'https://research.example/v1/chat/completions');assert.equal(options.headers.authorization,'Bearer secret-research');assert.equal(JSON.parse(options.body).model,'research');return {ok:true,json:async()=>({choices:[{message:{content:'Verified summary'}}]})};});assert.equal(out.text,'Verified summary');
 assert.equal((await call({assignments:{writing:'missing'}})).status,400);assert.equal(modelEnv('writing').LLM_MODEL,'writer');
 await call({id:a.savedId,name:'Writer',model:'writer2',baseUrl:'https://writer.example/v1',saveOnly:true,purposes:['writing']});assert.equal(modelEnv('writing').LLM_MODEL,'writer2');assert.equal(modelEnv('writing').LLM_API_KEY,'secret-writer');assert.equal(modelEnv('audit').LLM_MODEL,'default');
 }finally{await rm(dataDir,{recursive:true,force:true});for(const key of ['LLM_MODEL','LLM_BASE_URL','LLM_API_KEY','MODEL_CALLS_ENABLED'])if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}
});
