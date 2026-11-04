import test from 'node:test';
import assert from 'node:assert/strict';
import {draftContext,auditConfigHash} from '../src/workflow.mjs';

const skill='写作 DNA：先说结果再解释，短句推进，多用第二人称反问。';
const customPrompt='写作模板：先给结论，再列三条可执行动作，最后一句收束。';
const docs=[
 {id:'d1',name:'TikTok 店铺出单拆解',type:'写作案例库',content:'上架三十天没出单，问题不在流量，在选品和人群对不上。'},
 {id:'d2',name:'TikTok 广告投放复盘',type:'写作案例库',content:'同样预算，投放结构不同，成交差了三倍。'},
];
const dnaRun={id:'dna-1',taskKind:'writing-dna',state:'succeeded',method:{url:'https://example.org/skill'},result:{language:'短句'},corpus:[{id:'c1',title:'TikTok 出单拆解',content:'先说结果，再解释原因。',date:'2026-01-01'}],batches:[{metadata:[{id:'c1',article_type:'教程',topic_tags:['出单']}]}]};
const db={documents:docs,sources:[],knowledgeSets:[{id:'set-d2',documentIds:['d2']}],templates:[],taskRuns:[dnaRun]};
const base={id:'j',title:'TikTok店铺曝光没有订单',topic:'TikTok店铺曝光没有订单',templateSnapshot:{id:'tpl',prompt:customPrompt,rules:['不得虚构个人经历']},sourceSnapshot:[],copyType:'实战型'};
const cases=[
 {name:'A 无灵魂无知识库',job:{...base,documentIds:[],hookType:'扎心共情型'},route:'custom',knowledge:0,dna:false},
 {name:'B 无灵魂有知识库',job:{...base,documentIds:['d1'],hookType:'扎心共情型'},route:'custom',knowledge:1,dna:false},
 {name:'C 有灵魂无知识库',job:{...base,documentIds:[],hookType:'扎心共情型',stylePromptId:'s1',styleDnaRunId:'dna-1',stylePromptSnapshot:skill},route:'dna',knowledge:0,dna:true},
 {name:'D 有灵魂有知识库',job:{...base,documentIds:['d1'],hookType:'扎心共情型',stylePromptId:'s1',styleDnaRunId:'dna-1',stylePromptSnapshot:skill},route:'dna',knowledge:1,dna:true},
];

for(const item of cases){
 test(`${item.name}: only one main writing method is injected`,()=>{
  for(const mode of ['rewrite','topic']){
   const job={...item.job,...(mode==='rewrite'?{originalBody:'原稿：店铺有曝光没有订单，先别加预算。'}:{originalBody:''})};
   const context=draftContext(db,job);
   assert.equal(context.route,item.route);
   assert.equal(context.knowledge.length>=item.knowledge,true);
   assert.equal(Boolean(context.dna),item.dna);
   if(item.route==='custom'){
    assert.match(context.system,/本次主写作方法：用户所选写作 Prompt/);
    assert.ok(context.system.includes(customPrompt),'自定义写作 Prompt 完整进入主指令');
    assert.doesNotMatch(context.system,/本次主写作方法：所选写作 DNA/);
   }else{
    assert.match(context.system,/本次主写作方法：所选写作 DNA/);
    assert.ok(context.system.includes(skill),'写作 DNA 完整进入主指令');
    assert.ok(!context.system.includes(customPrompt),'选灵魂后不再叠加另一套完整写作方法');
    assert.match(context.system,/硬性规则|质量检查/,'通用任务规则与质量检查仍在');
   }
   assert.match(context.system,/黄金三秒类型：扎心共情型/,'用户参数不被覆盖');
   assert.match(context.system,/文案类型：实战型/);
   if(item.knowledge===0)assert.match(context.user,/正文素材检索（knowledge）与黄金三秒类型无关/);
   if(mode==='rewrite')assert.match(context.user,/模式：原稿改写/);
   else assert.match(context.user,/模式：根据选题生成新稿/);
  }
 });
}

test('knowledge selection is independent from the soul and never auto-loads a default library',()=>{
 const none=draftContext(db,{...base,documentIds:[],hookType:'悬念好奇型'});
 assert.equal(none.knowledge.length,0,'未选择知识库时不做检索');
 assert.equal(none.hook.hit,false);
 assert.equal(none.hook.reason,'no_knowledge_selected');
 const set=draftContext(db,{...base,documentIds:undefined,knowledgeSetIds:['set-d2'],hookType:'悬念好奇型'});
 assert.deepEqual([...new Set(set.knowledge.map(item=>item.documentId))],['d2'],'只读取本次所选知识集');
 const other=draftContext(db,{...base,documentIds:['d1'],hookType:'悬念好奇型'});
 assert.deepEqual([...new Set(other.knowledge.map(item=>item.documentId))],['d1']);
});

test('clearing the soul and the knowledge base takes effect on the next task instead of inheriting the previous one',()=>{
 const previous={...base,documentIds:['d1'],stylePromptId:'s1',styleDnaRunId:'dna-1',stylePromptSnapshot:skill};
 const cleared={...base,documentIds:[],stylePromptId:''};
 assert.equal(draftContext(db,previous).route,'dna');
 const next=draftContext(db,cleared);
 assert.equal(next.route,'custom','清空灵魂后回到自定义写作 Prompt');
 assert.equal(next.knowledge.length,0,'清空知识库后不再检索');
 assert.notEqual(auditConfigHash(previous),auditConfigHash(cleared),'配置变化会让审计与缓存重新计算');
 assert.notEqual(auditConfigHash({...base,documentIds:[]}),auditConfigHash({...base,documentIds:['d1']}));
});
