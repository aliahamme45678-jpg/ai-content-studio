import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAuth } from '../src/auth.mjs';
import { createPasswordGate, defaultPasswordHash } from '../src/password-gate.mjs';

test('HTTP password gate protects pages, assets and APIs; login, CSRF, expiry and logout', async t => {
  let time = 100;
  const auth=createAuth('test-password',{now:()=>time,ttl:1000});
  const gate=createPasswordGate(auth,{now:()=>time,secureCookie:true});
  const server=createServer(async(req,res)=>{
    try {
      const handled=await gate(req,res,new URL(req.url,'http://localhost'),{
        body:async req=>{let raw='';for await(const part of req)raw+=part;return JSON.parse(raw)},
        json:(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))}
      });
      if(!handled){res.writeHead(200);res.end('private-content')}
    } catch(error){res.writeHead(500);res.end(error.message)}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close()});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,options={})=>fetch(base+path,{redirect:'manual',...options});
  const login=(token,headers={})=>request('/api/studio/auth/login',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({token})});
  for(const path of ['/','/index.html','/app.js','/../app/data/studio.json']) {
    const response=await request(path);assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/login');assert.equal(response.headers.get('cache-control'),'no-store');
  }
  assert.equal((await request('/api/studio/overview')).status,401);
  const page=await request('/login');assert.equal(page.status,200);assert.match(await page.text(),/type="password"/);
  assert.equal((await login('test-password',{origin:'https://other.example'})).status,403);
  assert.equal((await login('wrong')).status,401);
  const response=await login('test-password');assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Secure/);assert.doesNotMatch(cookie,/test-password/);
  const headers={cookie:cookie.split(';')[0]};
  assert.equal(await(await request('/',{headers})).text(),'private-content');
  assert.equal((await request('/api/studio/overview',{headers})).status,200);
  assert.equal((await request('/login',{headers})).status,303);
  await request('/api/studio/auth/logout',{method:'POST',headers});
  assert.equal((await request('/api/studio/overview',{headers})).status,401);
  const next=await login('test-password');time+=1001;
  assert.equal((await request('/',{headers:{cookie:next.headers.get('set-cookie').split(';')[0]}})).status,303);
  for(let i=0;i<6;i++)assert.equal((await login('wrong')).status,401);
  assert.equal((await login('test-password')).status,429);
  time+=60001;assert.equal((await login('test-password')).status,200);
});

test('default deployment password uses a verifier and cannot bypass through token headers',()=>{
  const auth=createAuth('',{passwordHash:defaultPasswordHash});
  assert.equal(auth.enabled,true);
  assert.equal(auth.authorized({headers:{}}),false);
  assert.equal(auth.login('wrong'),null);
  assert.equal(auth.login({}),null);
  assert.equal(auth.authorized({headers:{'x-studio-token':defaultPasswordHash}}),false);
  const override=createAuth('custom-password',{passwordHash:defaultPasswordHash});
  assert.ok(override.login('custom-password'));
});
