import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeneration, validateGeneration } from '../src/generation-output.mjs';
const draft = '这是一篇完整的测试草稿，用于验证生成后的正文没有丢失，也没有把占位符当成可用的写作结果。'.repeat(3);
test('rejects placeholders, short drafts and invalid field types', () => {
  for (const body of ['...', '暂无内容', '短稿', '至少 80 个字符的完整可编辑正文', '?'.repeat(90)]) assert.throws(() => validateGeneration({ body }));
  assert.throws(() => validateGeneration({ body: draft, needsVerification: 'none' }));
});
test('extracts real draft after example JSON, fences and trailing explanation', () => {
  const input = '思考 {"body":"..."}\n```json\n' + JSON.stringify({body: draft + ' 引用包含 {括号} 和 "引号"。', corePoint:'测试', needsVerification:[]}) + '\n```\n结束说明';
  assert.equal(parseGeneration(input).body, draft + ' 引用包含 {括号} 和 "引号"。');
});
test('rejects malformed and truncated objects', () => {
  assert.throws(() => parseGeneration('{"body":"unfinished'));
  assert.throws(() => parseGeneration('{"body": ...}'));
});
