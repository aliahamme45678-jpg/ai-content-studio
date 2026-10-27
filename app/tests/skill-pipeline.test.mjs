import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSkillPipeline } from '../src/skills-local.mjs';
test('runs configured skills in order and skips video skill for X',()=>{
 const report=runSkillPipeline({body:'一段足够长的正文，用于检查审核流程如何按照模板顺序逐个运行。',format:'短帖'},{audits:['dbs-content-value','dbs-script-flow','dbs-ai-check']});
 assert.deepEqual(report.runs.map(run=>run.skill),['dbs-content-value','dbs-script-flow','dbs-ai-check']);
 assert.equal(report.runs[1].state,'skipped');assert.equal(report.runs[2].state,'succeeded');
});
