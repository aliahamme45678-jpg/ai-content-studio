// Consume Chat SSE incrementally so long reasoning requests don't wait for one
// buffered response. A broken stream never becomes a successful completion.
export async function readChatCompletion(response,{onProgress=async()=>{}}={}){
 if(!response.headers.get('content-type')?.includes('text/event-stream'))return response.json();
 let buffer='',raw='',finishReason=null,usage=null,id=null,model=null,done=false,bytes=0,reasoningCharacters=0;
 const snapshot=()=>({id,model,choices:[{message:{role:'assistant',content:raw},finish_reason:finishReason}],usage});
 const event=async block=>{
  const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
  if(!data)return;if(data.trim()==='[DONE]'){done=true;return;}
  const item=JSON.parse(data);if(item.error)throw Error('model_stream_error');
  id=item.id||id;model=item.model||model;usage=item.usage||usage;
  const choice=item.choices?.find(c=>(c.index??0)===0);
  if(typeof choice?.delta?.content==='string')raw+=choice.delta.content;
  if(typeof choice?.delta?.reasoning_content==='string')reasoningCharacters+=choice.delta.reasoning_content.length;
  if(choice?.finish_reason)finishReason=choice.finish_reason;
  if(raw.length>8000000)throw Error('model_stream_too_large');
  await onProgress({characters:raw.length,reasoningCharacters,bytes,requestId:response.headers.get('x-request-id')||id,receivedAt:new Date().toISOString()});
 };
 try{
  const decoder=new TextDecoder();for await(const chunk of response.body){bytes+=chunk.byteLength;buffer+=decoder.decode(chunk,{stream:true});let match;
   while((match=/\r?\n\r?\n/.exec(buffer))){const block=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);await event(block);}
   if(buffer.length>2000000)throw Error('model_stream_event_too_large');
  }
  buffer+=decoder.decode();if(buffer.trim())await event(buffer);
  if(!finishReason)throw Error(done?'model_stream_missing_finish':'model_stream_interrupted');
  return snapshot();
 }catch(error){
  // A terminal finish event establishes a complete answer even if the usage-only
  // tail disconnects. Otherwise preserve partial text for diagnosis, never use it.
  if(finishReason&&error.message==='terminated')return {...snapshot(),transportWarning:'usage_tail_disconnected'};
  error.modelPartial={...snapshot(),bytes,reasoningCharacters,requestId:response.headers.get('x-request-id')||id};throw error;
 }
}
