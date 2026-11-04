import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceMutationBlocked,modelServiceStatus,runReceipt} from '../src/task-state.mjs';
import {workflowRoutes} from '../src/workflow-routes.mjs';

test('only active source writers block manual work; unknown paid retry remains a separate decision',()=>{
  const r={jobId:'task',taskKind:'account-analysis',state:'unknown'};
  assert.equal(sourceMutationBlocked(r,'task'),false);assert.equal(sourceMutationBlocked({...r,state:'running'},'task'),true);
  assert.equal(sourceMutationBlocked({...r,taskKind:'douyin-asr'},'task'),true);assert.equal(sourceMutationBlocked({...r,taskKind:'douyin-asr'},'other'),false);
});
test('configured model does not imply successful generation and obsolete model successes cannot hide current failures',()=>{
  const env={LLM_MODEL:'current',LLM_API_KEY:'key',LLM_BASE_URL:'http://model',MODEL_CALLS_ENABLED:'true'};
  assert.equal(modelServiceStatus({taskRuns:[]},env).state,'unverified');
  assert.equal(modelServiceStatus({taskRuns:[{id:'old',model:'old',taskKind:'generate',state:'succeeded'}]},env).state,'unverified');
  assert.equal(modelServiceStatus({taskRuns:[{id:'err',model:'current',taskKind:'account-analysis',state:'unknown',error:'model_http_502'}]},env).state,'outcome_unknown');
  assert.equal(modelServiceStatus({taskRuns:[]},{...env,MODEL_CALLS_ENABLED:'false'}).state,'disabled');
});
test('receipt route exposes local evidence without credentials or triggering a retry',async()=>{
  const run={id:'run',state:'unknown',taskKind:'account-analysis',httpFailure:{status:502,detail:'key=private-key'},responses:[{raw:'private-key raw output'}]};
  const receipt=runReceipt(run,{LLM_API_KEY:'private-key'});assert.doesNotMatch(JSON.stringify(receipt),/private-key/);assert.equal(receipt.billingConfirmed,false);
  let status,response,saves=0;const ctx={req:{method:'GET'},res:{},url:new URL('http://local/api/studio/task-runs/run/receipt'),db:{taskRuns:[run]},json:(_r,s,v)=>{status=s;response=v;},saveDb:async()=>{saves++;}};
  await workflowRoutes(ctx);assert.equal(status,200);assert.equal(response.httpFailure.status,502);assert.equal(run.state,'unknown');assert.equal(saves,0);
});
