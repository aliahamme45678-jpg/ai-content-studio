import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {responseAsChat,modelFetch} from '../src/model-transport.mjs';
import {loadModelProfiles} from '../src/model-profiles.mjs';

test('Responses reads assistant text and preserves incomplete status without exposing reasoning',()=>{
 const parsed=responseAsChat({status:'completed',output:[{type:'reasoning',summary:[{text:'Internal reasoning'}]},{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}],usage:{input_tokens:10,output_tokens:5}});
 assert.equal(parsed.choices[0].message.content,'{"ok":true}');assert.equal(parsed.usage.prompt_tokens,10);assert.equal(responseAsChat({status:'incomplete',output:[]}).choices[0].finish_reason,'length');
});

test('configured Responses requests use the proper endpoint, disable storage and keep Chat profiles independent',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'spx-wire-'));const native=globalThis.fetch;const previous={...process.env};
 try{await writeFile(join(dir,'model-profiles.json'),JSON.stringify({activeId:'gpt',assignments:{},profiles:[{id:'gpt',name:'GPT',model:'gpt-6.1-sol',baseUrl:'https://model.test/v1',apiKey:'test',wireApi:'responses'},{id:'gemini',name:'Gemini',model:'gemini-test',baseUrl:'https://model.test/v1',apiKey:'test',wireApi:'chat'}]}));await loadModelProfiles(dir);const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({status:'completed',model:'gpt-6.1-sol',output:[{type:'message',content:[{type:'output_text',text:'OK'}]}]}));};const response=await modelFetch('https://model.test/v1/chat/completions',{method:'POST',body:JSON.stringify({model:'gpt-6.1-sol',messages:[{role:'user',content:'Hello'}],max_tokens:500})});assert.equal(calls[0].url,'https://model.test/v1/responses');assert.equal(calls[0].body.store,false);assert.equal(calls[0].body.max_output_tokens,500);assert.equal((await response.json()).choices[0].message.content,'OK');await modelFetch('https://model.test/v1/chat/completions',{method:'POST',body:JSON.stringify({model:'gemini-test',messages:[]})});assert.equal(calls[1].url,'https://model.test/v1/chat/completions');}
 finally{globalThis.fetch=native;for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);await rm(dir,{recursive:true,force:true});}
});

test('same-key model requests are serialized so concurrent writing and distillation do not trigger the provider limit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'spx-queue-'));const native=globalThis.fetch;const previous={...process.env};let active=0,maximum=0;
 try{await writeFile(join(dir,'model-profiles.json'),JSON.stringify({profiles:[{id:'x',model:'gpt-6.1-sol',baseUrl:'https://queue.test/v1',apiKey:'test',wireApi:'responses'}]}));await loadModelProfiles(dir);globalThis.fetch=async()=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,10));active--;return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'OK'}]}]}));};const options={method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({model:'gpt-6.1-sol',messages:[]})};await Promise.all([modelFetch('https://queue.test/v1/chat/completions',options),modelFetch('https://queue.test/v1/chat/completions',options)]);assert.equal(maximum,1);}finally{globalThis.fetch=native;for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);await rm(dir,{recursive:true,force:true});}
});
