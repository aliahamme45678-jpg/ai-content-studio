import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, sameOriginRequest } from '../src/auth.mjs';
test('random sessions expire and logout revokes replay',()=>{
 let time=100;const auth=createAuth('private-test-token',{now:()=>time,ttl:1000});
 assert.equal(auth.authorized({headers:{}}),false);assert.equal(auth.login('wrong'),null);
 const id=auth.login('private-test-token');assert.notEqual(id,'private-test-token');
 const req={headers:{cookie:`studio_session=${id}`}};assert.equal(auth.authorized(req),true);
 auth.logout(req);assert.equal(auth.authorized(req),false);
 const next=auth.login('private-test-token');time=1100;
 assert.equal(auth.authorized({headers:{cookie:`studio_session=${next}`}}),false);
 assert.equal(auth.authorized({headers:{cookie:'studio_token=private-test-token'}}),false);
});
test('cross-origin browser requests rejected including unauthenticated local mode',()=>{
 assert.equal(sameOriginRequest({headers:{host:'localhost:4310',origin:'http://localhost:4310'}}),true);
 assert.equal(sameOriginRequest({headers:{host:'localhost:4310',origin:'https://evil.example'}}),false);
 assert.equal(sameOriginRequest({headers:{host:'localhost:4310','sec-fetch-site':'cross-site'}}),false);
 assert.equal(sameOriginRequest({headers:{host:'localhost:4310'}}),true);
});
