import test from 'node:test';
import assert from 'node:assert/strict';
import {readChatCompletion} from '../src/model-stream.mjs';
const event=v=>'data: '+JSON.stringify(v)+'\r\n\r\n';
const part=(delta,finish=null)=>({id:'reply',model:'deepseek-flash',choices:[{index:0,delta,finish_reason:finish}]});
test('stream reconstructs UTF8 across byte boundaries, ignores reasoning and reads usage-only tail',async()=>{
 const data=new TextEncoder().encode(': heartbeat\r\n\r\n'+event(part({reasoning_content:'internal'}))+event(part({content:'{"文案":"'}))+event(part({content:'真实内容"}'}))+event(part({},'stop'))+event({choices:[],usage:{completion_tokens:12}})+'data: [DONE]\r\n\r\n');let i=0;
 const response=new Response(new ReadableStream({pull(c){if(i<data.length)c.enqueue(data.slice(i,i+=1));else c.close();}}),{headers:{'content-type':'text/event-stream','x-request-id':'request'}});let progress;
 const result=await readChatCompletion(response,{onProgress:async p=>progress=p});assert.equal(result.choices[0].message.content,'{"文案":"真实内容"}');assert.equal(result.choices[0].finish_reason,'stop');assert.equal(result.usage.completion_tokens,12);assert.equal(progress.reasoningCharacters,8);assert.equal(progress.requestId,'request');
});
test('disconnect retains partial text and cannot masquerade as a completed report',async()=>{
 let n=0;const response=new Response(new ReadableStream({pull(c){if(n++===0)c.enqueue(new TextEncoder().encode(event(part({content:'unfinished'}))));else c.error(new TypeError('terminated'));}}),{headers:{'content-type':'text/event-stream'}});
 await assert.rejects(readChatCompletion(response),e=>e.message==='terminated'&&e.modelPartial.choices[0].message.content==='unfinished'&&e.modelPartial.choices[0].finish_reason===null);
 await assert.rejects(readChatCompletion(new Response(event(part({content:'partial'}))+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})),/missing_finish/);
});
test('completed response and truncated response retain explicit terminal reasons without requiring usage',async()=>{
 for(const finish of ['stop','length']){const r=await readChatCompletion(new Response(event(part({content:'text'}))+event(part({},finish)),{headers:{'content-type':'text/event-stream'}}));assert.equal(r.choices[0].finish_reason,finish);}
 const original={choices:[{message:{content:'normal JSON'},finish_reason:'stop'}]};assert.deepEqual(await readChatCompletion(Response.json(original)),original);
});
