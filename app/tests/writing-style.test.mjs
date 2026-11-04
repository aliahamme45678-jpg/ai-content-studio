import {test} from 'node:test';
import assert from 'node:assert/strict';
import {builtinSoul,soulNames,upstreamPrompt,styleConfig} from '../src/writing-style.mjs';
import {parseDistillation} from '../src/material-distill.mjs';
test('original Hermes soul rules stay distinct and invalid writing controls are rejected',()=>{
  for(const name of soulNames){const rules=builtinSoul(name);assert.match(rules,new RegExp('# '+name.replace('风格','人格灵魂')));assert.equal((rules.match(/# .*人格灵魂/g)||[]).length,1);}
  assert.match(upstreamPrompt('defaultSoulExtractPrompt'),/writing_rules/);
  assert.throws(()=>styleConfig({soulPersona:'fake'},{documents:[]}));assert.throws(()=>styleConfig({targetWordCount:5},{documents:[]}));
  const chosen=styleConfig({soulPersona:'鲁迅风格',soulProfileId:''},{documents:[]});assert.match(chosen.soulSnapshot,/冷幽默/);
  assert.equal(styleConfig({soulPersona:'',soulProfileId:''},{documents:[]},chosen).soulSnapshot,'');
});
test('distillation rejects invented evidence instead of saving an unsupported style',()=>{
  const report={prompt:'写清楚文案的方法。'.repeat(10),rules:[],soul:{soul_summary:'总结',writing_rules:{}},patterns:[{name:'开头',explanation:'说明',documentId:'d',quote:'不存在的原句'}]};
  assert.throws(()=>parseDistillation(JSON.stringify(report),[{id:'d',content:'真实素材'}]),/evidence/);
  const valid={...report,patterns:[{...report.patterns[0],quote:'真实素材'}]};
  const parsed=parseDistillation('先分析一下\n```json\n'+JSON.stringify(report)+'\n```\n最终结果\n'+JSON.stringify(valid),[{id:'d',content:'真实素材'}]);assert.equal(parsed.patterns[0].quote,'真实素材');
  const punctuation={...valid,patterns:[{...valid.patterns[0],quote:'这一段完整原句有十个字以上。'}]};const exact=parseDistillation(JSON.stringify(punctuation),[{id:'d',content:'这一段完整原句有十个字以上，后面继续。'}]);assert.equal(exact.patterns[0].quote,'这一段完整原句有十个字以上');assert.equal(exact.patterns[0].originalModelQuote,punctuation.patterns[0].quote);
});

test('同一份 DNA 同时来自灵魂提示词和蒸馏模板时只下发一次',async()=>{
 const {writingMethod}=await import('../src/writing-style.mjs');
 const prompt='墨鱼唯一写法：先用反常识判断压住预期，再拆三步动作，最后一句自嘲收尾。';
 const template={id:'tpl-soul',distillationRunId:'run-9',prompt,rules:['不得虚构经历']};
 const job={stylePromptId:'tpl-soul',styleDnaRunId:'run-9',stylePromptSnapshot:`${prompt}\n\n写作 DNA 分层规则：\n语言 DNA：短句为主，平均句长 21 字。`,templateSnapshot:template};
 const method=writingMethod(job);
 assert.equal(method.route,'dna');
 assert.equal(method.sameSource,true);
 assert.equal((method.dna.match(new RegExp(prompt,'g'))||[]).length,1,'同一段提示词不重复注入');
 assert.ok(method.removedDuplicates>=1||method.merge.some(item=>item.action==='dropped_duplicate'));
 assert.ok(method.dna.includes('平均句长 21 字'),'分层规则仍然保留');
 assert.deepEqual(method.dnaRules,['不得虚构经历'],'同一 DNA 模板的硬性规则继续生效');
});

test('同一蒸馏批次的不同模板按行合并去重，重复规则只保留一份',async()=>{
 const {writingMethod}=await import('../src/writing-style.mjs');
 const shared='规则B：每条结论后面必须跟一个可执行动作。';
 const snapshot=`写作 DNA：\n规则A：先给结果再解释。\n${shared}`;
 const template={id:'tpl-other',distillationRunId:'run-7',prompt:`蒸馏主提示词：\n${shared}\n规则C：结尾用一句反问收束。`,rules:[]};
 const method=writingMethod({stylePromptId:'s1',styleDnaRunId:'run-7',stylePromptSnapshot:snapshot,templateSnapshot:template});
 assert.equal(method.sameSource,true);
 assert.equal((method.dna.match(new RegExp(shared,'g'))||[]).length,1,'重复行被合并');
 assert.ok(method.dna.includes('规则A'));assert.ok(method.dna.includes('规则C'));
});

test('不同蒸馏来源的模板不再作为第二套完整方法注入',async()=>{
 const {writingMethod,writingStylePrompt}=await import('../src/writing-style.mjs');
 const template={id:'tpl-other',distillationRunId:'run-2',prompt:'另一套完全不同行业的写作方法：B_方法_不该出现',rules:['通用硬性规则']};
 const job={stylePromptId:'s1',styleDnaRunId:'run-1',stylePromptSnapshot:'墨鱼 DNA：A_唯一主方法',templateSnapshot:template};
 const method=writingMethod(job);
 assert.equal(method.route,'dna');
 assert.equal(method.sameSource,false);
 assert.equal(method.skippedTemplate,'different_distillation_source');
 assert.ok(!method.dna.includes('B_方法_不该出现'),'另一份 DNA 不进入主方法');
 const text=writingStylePrompt(job);
 assert.ok(text.includes('A_唯一主方法'));
 assert.ok(!text.includes('B_方法_不该出现'));
 assert.equal((text.match(/本次主写作方法/g)||[]).length,1,'只声明一套主写作方法');
});

test('DNA 里的禁止性规则被提到最前成为硬性禁忌，知识库相反写法不覆盖',async()=>{
 const {stylePromptOf}=await import('../src/writing-style.mjs');
 const preset={prompt:'主方法：先给判断再解释。',
  dnaReport:{language:'语言：短句为主。\n不得拟人化平台，不写“平台肯给流量”。',structure:'结构：按题材切换。\n不要一律编号步骤。',cognition:'认知：习惯系统归因。\n禁止编造数字。',visual:'不注入'}};
 const text=stylePromptOf(preset);
 const banIndex=text.indexOf('硬性禁忌');
 const dnaIndex=text.indexOf('写作 DNA 分层规则');
 assert.ok(banIndex>=0&&banIndex<dnaIndex,'硬性禁忌要在分层规则之前');
 assert.match(text,/不得拟人化平台/);
 assert.match(text,/禁止编造数字/);
 assert.ok(text.indexOf('不得拟人化平台')<text.indexOf('语言 DNA：'),'禁止性规则前置');
});
