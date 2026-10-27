import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectDraft, bodyHash, invalidateAudit } from '../src/audit.mjs';
test('checks actual text and supplies exact positions for local edits',()=>{
 const body='保留第一句。总而言之这是结论。保留最后一句。';
 const [issue]=inspectDraft(body);assert.equal(issue.quote,'总而言之');
 const edited=body.slice(0,issue.location.start)+issue.replacement+body.slice(issue.location.end);
 assert.equal(edited,'保留第一句。这是结论。保留最后一句。');
 assert.equal(inspectDraft(edited).length,0);
 assert.equal(inspectDraft('需要待核实的数据。')[0].blocking,true);
 assert.equal(inspectDraft('')[0].blocking,true);
});
test('editing invalidates prior decisions and hashes change',()=>{
 const db={auditIssues:[{jobId:'a',status:'已忽略'},{jobId:'b',status:'待处理'}]};
 invalidateAudit(db,'a');assert.equal(db.auditIssues[0].status,'待重新验证');assert.equal(db.auditIssues[1].status,'待处理');
 assert.notEqual(bodyHash('a'),bodyHash('b'));
});
