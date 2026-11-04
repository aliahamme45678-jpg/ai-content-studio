import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reuseCollectionTranscripts} from '../src/reuse-collection-transcripts.mjs';
test('recollection reuses exact video text without changing new metrics or overwriting edits',()=>{
 const old={id:'old',taskKind:'douyin-collect',rows:[{aweme_id:'1',transcript:'known',digg_count:100},{aweme_id:'2',transcript:'old'},{aweme_id:'3',transcript:'unknown',transcriptState:'unknown'}]};
 const task={id:'new',rows:[{aweme_id:'1',digg_count:200},{aweme_id:'2',transcript:'edited'},{aweme_id:'3'},{aweme_id:'4'}]};
 assert.deepEqual(reuseCollectionTranscripts(task,[task,old]),{reused:1});
 assert.equal(task.rows[0].transcript,'known');assert.equal(task.rows[0].digg_count,200);assert.equal(task.rows[0].transcriptSourceTaskId,'old');assert.equal(task.rows[1].transcript,'edited');assert.equal(task.rows[2].transcript,undefined);assert.equal(task.rows[3].transcript,undefined);
 assert.deepEqual(reuseCollectionTranscripts(task,[old]),{reused:0});
});
