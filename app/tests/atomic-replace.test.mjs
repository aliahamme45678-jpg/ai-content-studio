import test from 'node:test';
import assert from 'node:assert/strict';
import {atomicReplace} from '../src/atomic-replace.mjs';
test('temporary Windows destination lock retries only atomic replacement',async()=>{
 let calls=0;const waits=[];await atomicReplace('pending','target',{move:async(a,b)=>{assert.equal(a,'pending');assert.equal(b,'target');if(++calls<3)throw Object.assign(Error('locked'),{code:'EPERM'});},pause:async ms=>waits.push(ms)});assert.equal(calls,3);assert.deepEqual(waits,[25,50]);
});
test('unrecoverable errors and persistent locks propagate without deleting files',async()=>{
 let calls=0;await assert.rejects(atomicReplace('a','b',{move:async()=>{calls++;throw Object.assign(Error('missing'),{code:'ENOENT'});},pause:async()=>{}}),/missing/);assert.equal(calls,1);
 calls=0;await assert.rejects(atomicReplace('a','b',{move:async()=>{calls++;throw Object.assign(Error('locked'),{code:'EBUSY'});},pause:async()=>{}}),/locked/);assert.equal(calls,8);
});
