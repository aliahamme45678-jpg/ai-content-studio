import {test} from 'node:test';
import assert from 'node:assert/strict';

test('empty legacy duration mode remains savable after the duration UI is removed',()=>{
 assert.equal(styleConfig({durationMode:''},{documents:[]}).durationMode,'original');
 assert.equal(styleConfig({},{documents:[]},{durationMode:''}).durationMode,'original');
 assert.equal(styleConfig({durationMode:'custom'},{documents:[]}).durationMode,'custom');
 assert.throws(()=>styleConfig({durationMode:'invalid'},{documents:[]}),/invalid_duration_mode/);
});
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {styleConfig,writingStylePrompt} from '../src/writing-style.mjs';
import {sectionRange} from '../src/section-range.mjs';
import {modelProfilesRoute,loadModelProfiles} from '../src/model-profiles.mjs';

test('automatic fields and direct prompt persist, enter the model context and invalidate unsupported values',()=>{
 const config=styleConfig({hookType:'AI自动识别',copyStyle:'AI自动识别',copyType:'AI自动识别',durationMode:'original',customPrompt:'用具体例子解释，短句口语'}, {documents:[]});
 const prompt=writingStylePrompt(config);assert.match(prompt,/短句口语/);assert.match(prompt,/先识别原稿/);assert.match(prompt,/目标时长基于原稿/);
 assert.throws(()=>styleConfig({durationMode:'invalid'},{documents:[]}),/invalid_duration/);
});
test('middle rewrite covers all middle paragraphs; external text stays byte-for-byte unchanged',()=>{
 const original='开场。\n\n中间第一段。\n\n中间第二段。\n\n结尾。';
 const r=sectionRange(original,'body');assert.equal(r.text,'中间第一段。\n\n中间第二段。');assert.equal(original.slice(0,r.start)+'新中段。'+original.slice(r.end),'开场。\n\n新中段。\n\n结尾。');
 assert.equal(sectionRange('第一句。第二句。第三句。','body').text,'第二句。');assert.throws(()=>sectionRange('只有一段','body'),/section_boundaries/);
});
test('custom API models survive restart, redact keys, reject invalid endpoints and cannot switch during paid runs',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'studio-models-'));const old={...process.env};let response;
 const ctx={req:{method:'POST'},res:{},url:new URL('http://localhost/api/studio/models/config'),dataDir,db:{taskRuns:[]},json:(_,status,value)=>{response={status,value};},body:async()=>({name:'测试',baseUrl:'https://gateway.example/v1',model:'custom-model',apiKey:'secret-test-key'})};
 try{await modelProfilesRoute(ctx);assert.equal(response.status,200);assert.doesNotMatch(JSON.stringify(response),/secret-test-key/);assert.equal(response.value.profiles[0].keyConfigured,true);
 process.env.LLM_MODEL='changed';await loadModelProfiles(dataDir);assert.equal(process.env.LLM_MODEL,'custom-model');
 await modelProfilesRoute({...ctx,body:async()=>({baseUrl:'file:///tmp/a'})});assert.equal(response.status,400);
 await modelProfilesRoute({...ctx,db:{taskRuns:[{state:'running',model:'active'}]}});assert.equal(response.status,409);
 }finally{for(const key of ['LLM_BASE_URL','LLM_API_KEY','LLM_MODEL','MODEL_CALLS_ENABLED']){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}await rm(dataDir,{recursive:true,force:true});}
});
