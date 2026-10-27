import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLocalSkills } from '../src/skills-local.mjs';

test('X content does not run video-only skill and detects local risk signals',()=>{
  const report=runLocalSkills({body:'在当今，保证赚钱的工具不存在。',format:'短帖'},{audits:['dbs-ai-check','dbs-script-flow','dbs-content-risk-check']});
  assert.equal(report.skills.includes('dbs-script-flow'),true);
  assert.ok(report.issues.some(issue=>issue.skill==='dbs-ai-check'));
  assert.ok(report.issues.some(issue=>issue.skill==='dbs-content-risk-check'));
  assert.equal(report.issues.some(issue=>issue.skill==='dbs-script-flow'),false);
});

test('video flow checks long spoken sentences and preserves evidence',()=>{
  const body='这是一段非常长的口播句子，它同时塞入了背景、问题、解决方案、工具说明、限制条件以及最后的行动建议，观众可能在中间就失去跟随的节奏和理解的能力。';
  const report=runLocalSkills({body,format:'视频口播'},{audits:['dbs-script-flow']});
  assert.equal(report.engine,'local-rules');assert.ok(report.issues.length);assert.equal(report.issues[0].evidence,'本地口播长度规则');
});
