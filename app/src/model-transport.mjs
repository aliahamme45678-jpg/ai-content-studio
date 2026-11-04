import {modelWireApi} from './model-profiles.mjs';

export function responseAsChat(payload){
 const text=payload.output?.filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text||'').join('')||payload.output_text||'';
 return {id:payload.id,model:payload.model,choices:[{message:{role:'assistant',content:text},finish_reason:payload.status==='incomplete'?'length':'stop'}],usage:payload.usage?{...payload.usage,prompt_tokens:payload.usage.input_tokens,completion_tokens:payload.usage.output_tokens}:undefined};
}
const modelQueues=new Map();
export async function modelFetch(url,options={}){
 const endpoint=String(url);if(!endpoint.endsWith('/chat/completions')||typeof options.body!=='string')return globalThis.fetch(url,options);
 const input=JSON.parse(options.body);if(modelWireApi(endpoint.slice(0,-'/chat/completions'.length),input.model)!=='responses')return globalThis.fetch(url,options);
 const key=endpoint+'\n'+new Headers(options.headers).get('authorization');const previous=modelQueues.get(key)||Promise.resolve();const work=previous.catch(()=>{}).then(()=>requestModel(url,options));const tail=work.then(()=>{},()=>{});modelQueues.set(key,tail);
 try{return await work;}finally{if(modelQueues.get(key)===tail)modelQueues.delete(key);}
}
async function requestModel(url,options={}){
 const endpoint=String(url);if(!endpoint.endsWith('/chat/completions')||typeof options.body!=='string')return globalThis.fetch(url,options);
 const input=JSON.parse(options.body);if(modelWireApi(endpoint.slice(0,-'/chat/completions'.length),input.model)!=='responses')return globalThis.fetch(url,options);
 const request={model:input.model,input:input.messages,store:false,stream:false,reasoning:{effort:'low'},max_output_tokens:input.max_tokens||input.max_completion_tokens||9000};
 const target=endpoint.replace(/\/chat\/completions$/,'/responses');const payloadOptions={...options,body:JSON.stringify(request)};let response=await globalThis.fetch(target,payloadOptions);
 if(response.status===429){let error;try{error=await response.clone().json();}catch{}if(error?.error?.code==='gateway_concurrency_limit'){await new Promise(resolve=>setTimeout(resolve,2000));response=await globalThis.fetch(target,payloadOptions);}}
 if(!response.ok)return response;
 const payload=await response.json();if(payload.status==='failed'||payload.error)return new Response(JSON.stringify({error:payload.error||{message:'Model response failed'}}),{status:422,headers:{'content-type':'application/json'}});
 return new Response(JSON.stringify(responseAsChat(payload)),{status:response.status,headers:{'content-type':'application/json','x-request-id':response.headers.get('x-request-id')||payload.id||''}});
}
