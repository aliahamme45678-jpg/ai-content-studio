import test from 'node:test';
import assert from 'node:assert/strict';
import {hookKnowledge,bodyKnowledge,knowledgeScope,hookEcho} from '../src/knowledge-plan.mjs';
import {draftContext} from '../src/workflow.mjs';
import {prepareHookWriting} from '../src/hook-writing.mjs';
import {hookTypes as planHookTypes} from '../src/knowledge-plan.mjs';
import {hookTypes as styleHookTypes} from '../src/writing-style.mjs';

const docs=[
 {id:'a',name:'TikTok 上架三十天没出单',type:'写作案例库',content:'你每天给店铺上架商品，曝光也有，订单就是零。这不是你不努力，是你一直在做无效动作。'},
 {id:'b',name:'TikTok 选品数据复盘',type:'写作案例库',content:'我们测了 30 个品，只有 2 个出单，曝光 12 万，成交 0。数据不好看，但问题很清楚：选品和人群对不上。'},
 {id:'c',name:'红烧肉的家常做法',type:'写作案例库',content:'今天教你做红烧肉，先焯水再炒糖色，小火慢炖四十分钟。'},
 {id:'d',name:'TikTok 反差开头样本',type:'写作案例库',hookType:'结果反差型',content:'结果出乎意料：同样的品，换了个开头，播放量从 800 掉到 80。'},
];
const db={documents:docs,sources:[],knowledgeSets:[],templates:[]};
const template={id:'tpl',prompt:'按写作 Prompt 写',rules:[]};
const baseJob={id:'j',title:'TikTok 店铺曝光有订单零',topic:'TikTok店铺曝光没有订单',templateSnapshot:template,documentIds:['a','b','c','d'],copyType:'实战型',copyStyle:'口语成交型',sourceSnapshot:[]};

test('body retrieval ignores the hook type, hook retrieval uses the same library with its own query',()=>{
 const one=bodyKnowledge(db,{...baseJob,hookType:'数据直击型'}).items.map(item=>item.chunkId);
 const two=bodyKnowledge(db,{...baseJob,hookType:'扎心共情型'}).items.map(item=>item.chunkId);
 assert.deepEqual(one,two,'正文素材不因开头类型被收窄或替换');
 const dataHook=hookKnowledge(db,{...baseJob,hookType:'数据直击型'});
 const heartHook=hookKnowledge(db,{...baseJob,hookType:'扎心共情型'});
 assert.equal(dataHook.hit,true);
 assert.equal(dataHook.items[0].documentId,'b','数据直击型优先命中带数据的开头');
 assert.ok(heartHook.items.length,'扎心共情型也能在同一库内找到开头');
 assert.ok(heartHook.items.every(item=>item.opening.length<=160),'只取开头片段而不是整篇');
 assert.ok(!dataHook.items.some(item=>item.documentId==='c'),'不相关主题的开头不进候选');
});

test('a knowledge base with its own type label is preferred over semantic guessing',()=>{
 const hook=hookKnowledge(db,{...baseJob,hookType:'结果反差型'});
 assert.equal(hook.mode,'label');
 assert.equal(hook.items[0].documentId,'d');
 assert.equal(hook.items[0].labelMatch,true);
});

test('no selected knowledge means no retrieval at all, and a miss is recorded instead of faked',()=>{
 const empty=bodyKnowledge(db,{...baseJob,documentIds:undefined,knowledgeSetIds:undefined,templateSnapshot:{...template,bindings:[]}});
 assert.equal(empty.items.length,0);
 const hook=hookKnowledge(db,{...baseJob,documentIds:undefined,templateSnapshot:{...template,bindings:[]},hookType:'悬念好奇型'});
 assert.equal(hook.mode,'none');assert.equal(hook.hit,false);assert.equal(hook.reason,'no_knowledge_selected');
 const miss=hookKnowledge(db,{...baseJob,topic:'量子计算芯片制程',title:'量子计算芯片制程',hookType:'悬念好奇型'});
 assert.equal(miss.hit,false);assert.equal(miss.fallback,'writing_prompt_mechanism');assert.equal(miss.reason,'no_matching_opening');
});

test('selected knowledge set is the only scope, and excluded sources stay out',()=>{
 const scoped={...db,knowledgeSets:[{id:'set-1',documentIds:['a']}]};
 assert.deepEqual([...knowledgeScope(scoped,{...baseJob,documentIds:undefined,knowledgeSetIds:['set-1']}).documents],['a']);
 assert.equal(bodyKnowledge(scoped,{...baseJob,documentIds:undefined,knowledgeSetIds:['set-1']}).items.every(item=>item.documentId==='a'),true);
 const excluded=bodyKnowledge(db,{...baseJob,excludedSourceIds:['a']}).items.map(item=>item.documentId);
 assert.equal(excluded.includes('a'),false);
});

test('copying a retrieved opening is detected instead of being treated as a mechanism',()=>{
 const hook=hookKnowledge(db,{...baseJob,hookType:'数据直击型'});
 const copied='我们测了 30 个品，只有 2 个出单，曝光 12 万，成交 0。后来我才明白问题在哪。';
 assert.ok(hookEcho(copied,hook.items),'连续照抄知识库开头会被识别');
 assert.equal(hookEcho('换个说法讲同一个问题：上架很多，曝光有一点，订单一直是零。',hook.items),null);
});

test('the writing context separates the two retrievals and states the priority order',()=>{
 const job={...baseJob,hookType:'数据直击型'};
 const {system,user}=draftContext(db,job);
 assert.match(system,/写作优先级/);
 assert.match(system,/用户本次手动选择：黄金三秒类型与文案类型必须执行/);
 assert.match(system,/黄金三秒类型：数据直击型/);
 assert.match(system,/文案类型：实战型/);
 assert.match(user,/开头参考（hookKnowledge/);
 assert.match(user,/正文素材检索（knowledge）与黄金三秒类型无关/);
 const payload=JSON.parse(user.slice(user.indexOf('{',user.indexOf('以下 JSON'))));
 assert.equal(payload.hookType,'数据直击型');
 assert.equal(payload.knowledgeScope.configured,true);
 assert.ok(payload.knowledge.length,'正文素材仍然检索');
 assert.equal(payload.hookSelection,undefined,'旧的独立开头库选择块已不存在');
});

test('one parsed Writing DNA is reused, and the route follows the soul selection',async()=>{
 const dna={scope:'多篇语料写法',examples:[{id:'1',content:'示例'}],artifacts:{language:'短句'}};
 const plain=draftContext(db,{...baseJob,hookType:'数据直击型'},{dna});
 assert.equal(plain.dna,dna,'传入的同一份 DNA 被直接复用');
 assert.equal(plain.route,'custom','没有灵魂时走用户写作 Prompt');
 assert.match(plain.system,/本次主写作方法：用户所选写作 Prompt/);
 const withSoul=draftContext(db,{...baseJob,hookType:'数据直击型',stylePromptId:'s1',stylePromptSnapshot:'短句反问，先给结论'},{dna});
 assert.equal(withSoul.route,'dna');
 assert.match(withSoul.system,/本次主写作方法：所选写作 DNA/);
 assert.doesNotMatch(withSoul.system,/本次主写作方法：用户所选写作 Prompt/);
 const run={id:'run',state:'running'};
 const prepared=await prepareHookWriting({db,job:{...baseJob,hookType:'数据直击型'},run,saveDb:async()=>{}});
 assert.equal(prepared.plan.type,'数据直击型');
 assert.equal(run.hookRetrieval.hit,true);
 assert.ok(run.hookRetrieval.count>0);
 assert.equal(run.hookRetrieval.type,'数据直击型');
 assert.ok(run.hookPlan.source.documentId,'命中时记录来源用于追溯');
});

test('an automatically identified hook type is retrieved and validated as that type',async()=>{
 const run={id:'run',state:'running',recognition:{hookType:'结果反差型'}};
 const prepared=await prepareHookWriting({db,job:{...baseJob,hookType:'AI自动识别'},run,saveDb:async()=>{}});
 assert.equal(prepared.plan.type,'结果反差型','校验和检索都按识别出的实际类型');
 assert.equal(run.hookRetrieval.requestedType,'AI自动识别');
 assert.equal(run.hookRetrieval.mode,'label');
});

test('switching souls changes the injected writing DNA while keeping the user choices on top',()=>{
 const a=draftContext(db,{...baseJob,hookType:'扎心共情型',stylePromptId:'s1',stylePromptSnapshot:'墨鱼风格：多用反问和短句'}).system;
 const b=draftContext(db,{...baseJob,hookType:'扎心共情型',stylePromptId:'s2',stylePromptSnapshot:'冷静拆解：多用数据和分点'}).system;
 assert.match(a,/墨鱼风格/);assert.match(b,/冷静拆解/);assert.notEqual(a,b);
 assert.match(a,/黄金三秒类型：扎心共情型/);assert.match(b,/黄金三秒类型：扎心共情型/);
 assert.ok(a.indexOf('写作优先级')<a.indexOf('墨鱼风格'),'优先级声明排在写作 DNA 之前');
});

test('黄金三秒类型只维护一份：检索机制表与写作校验清单完全一致',()=>{
 assert.deepEqual(planHookTypes,styleHookTypes,'两处类型清单必须同序同值');
 assert.ok(styleHookTypes.includes('信息差型')&&styleHookTypes.includes('方法论承诺型'));
 assert.equal(new Set(styleHookTypes).size,styleHookTypes.length,'没有重复类型');
});
