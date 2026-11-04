import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

test('native Hermes bridge uses upstream engine with one request and preserves selected Studio context', {skip:!existsSync(new URL('../../opensource/hermes-copywriting-engine/server.js',import.meta.url))},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'studio-hermes-native-'));let calls=0;let prompt;
  const fake=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const input=JSON.parse(text);calls++;prompt=input.messages[1].content;res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Native Hermes fixture returns complete writing content with selected knowledge and the user template.'}}]}));});
  await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const child=spawn(process.execPath,['src/run-hermes.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),HERMES_DATA_DIR:dir,HERMES_API_URL:`http://127.0.0.1:${fake.address().port}/chat/completions`,HERMES_API_KEY:'fixture',HERMES_MODEL:'fixture',MEMORY_ROOT:dir,MATERIAL_PATH:join(dir,'materials.txt')},stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(new Error(`Hermes exited ${code}`)));});
    const config=await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();assert.equal(config.studioBridge,true);
    const response=await fetch(`http://127.0.0.1:${port}/api/studio-copywriting`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({system:'User template sentinel-template.',user:'Selected knowledge sentinel-knowledge.'})});
    const result=await response.json();assert.equal(response.status,200);assert.equal(result.mode,'hermes');assert.equal(calls,1);assert.match(prompt,/sentinel-template/);assert.match(prompt,/sentinel-knowledge/);
  }finally{child.kill();if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));await new Promise(resolve=>fake.close(resolve));await rm(dir,{recursive:true,force:true});}
});
