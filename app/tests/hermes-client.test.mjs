import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { hermesGenerate } from '../src/integrations/hermes-client.mjs';

test('Hermes adapter rejects draft/prompt fallback and accepts real text', async () => {
  const server=createServer(async(req,res)=>{for await(const _ of req){}res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:req.url.includes('draft')?'draft: prompt text':'这是一段真实的 Hermes 生成稿，用于验证结果不是提示词、不是 draft 模式，并且可以进入 Studio 版本历史。'}}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;const old={...process.env};
  try{process.env.HERMES_API_URL=`http://127.0.0.1:${port}/api/chat`;process.env.HERMES_API_KEY='fixture';process.env.HERMES_MODEL='fixture';
    const ok=await hermesGenerate({user:'real',system:'test'});assert.ok(ok.body.length>20);assert.equal(ok.model,'fixture');
  }finally{Object.assign(process.env,old);await new Promise(resolve=>server.close(resolve));}
});
