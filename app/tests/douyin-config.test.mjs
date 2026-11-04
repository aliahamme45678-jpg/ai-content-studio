import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectLoginState,douyinConfigRoute} from '../src/douyin-config.mjs';

test('login config validates actual JSON, expiry, keeps blank secrets and imports without exposing cookies',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'studio-login-'));const oldKey=process.env.DASHSCOPE_API_KEY,oldPath=process.env.DOUYIN_STATE_PATH;
  process.env.DASHSCOPE_API_KEY='keep-existing-key';delete process.env.DOUYIN_STATE_PATH;
  let status,result;const invoke=async(method,input)=>douyinConfigRoute({req:{method},res:{},url:new URL('http://local/api/studio/integrations/douyin/config'),dataDir:dir,json:(_r,s,v)=>{status=s;result=v;},body:async()=>input});
  const state=expires=>JSON.stringify({cookies:[{name:'sessionid',value:'cookie-private-value',domain:'.douyin.com',expires}],origins:[]});
  try{
    assert.equal((await inspectLoginState('')).state,'visitor');assert.equal((await inspectLoginState(dir)).state,'invalid');
    const expired=join(dir,'expired.json');await writeFile(expired,state(1));assert.equal((await inspectLoginState(expired)).state,'expired');
    await invoke('POST',{stateJson:'not JSON'});assert.equal(status,400);assert.equal(process.env.DOUYIN_STATE_PATH,undefined);
    await invoke('POST',{stateJson:state(-1),asrKey:''});assert.equal(status,200);assert.equal(result.login.state,'loaded');assert.equal(process.env.DASHSCOPE_API_KEY,'keep-existing-key');assert.match(await readFile(process.env.DOUYIN_STATE_PATH,'utf8'),/cookie-private-value/);assert.doesNotMatch(JSON.stringify(result),/cookie-private-value|keep-existing-key/);
    await invoke('GET');assert.equal(result.login.configured,true);assert.equal(result.asrKey,'keep-existing-key');assert.doesNotMatch(JSON.stringify(result),/cookie-private-value/);
    await invoke('POST',{clearState:true});assert.equal(result.login.state,'visitor');assert.equal(process.env.DOUYIN_STATE_PATH,'');
  }finally{if(oldKey===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=oldKey;if(oldPath===undefined)delete process.env.DOUYIN_STATE_PATH;else process.env.DOUYIN_STATE_PATH=oldPath;await rm(dir,{recursive:true,force:true});}
});
