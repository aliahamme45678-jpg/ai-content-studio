import test from 'node:test';
import assert from 'node:assert/strict';
import {craftKnowledge,craftProfile,detectHookMechanism} from '../src/knowledge-plan.mjs';
import {draftContext} from '../src/workflow.mjs';

const long=(head,body)=>head+(body+'。').repeat(6);
const docs=[
 {id:'p1',name:'TikTok 选品切口：从退货率反推爆款',type:'写作案例库',author:'同行A',publishedAt:'2026-02-01',
  content:long('我做了三年跨境，发现选品先看退货率。','第一步，把退货率超过 15% 的品全部下架。\n第二步，只留复购率高的三个品，集中测素材。\n第三步，每场直播后复盘，记录停留和成交。\n所以选品不是找爆款，是找能反复卖的品。觉得有用点个关注，评论区留666领取选品表')},
 {id:'p2',name:'TikTok 曝光有订单零的排查顺序',type:'写作案例库',author:'同行B',publishedAt:'2026-01-20',
  content:long('你以为问题在流量，其实问题在承接，这个判断我踩过坑。','先看商品详情页有没有回答买家最关心的问题。\n再看价格和履约信息是否打消疑虑。\n最后看视频承诺和详情页是否一致。\n这三步核对完，再决定要不要加预算')},
 {id:'p3',name:'红烧肉的三十种做法合集',type:'写作案例库',publishedAt:'2025-12-01',
  content:long('今天教你做红烧肉，先焯水再炒糖色。','小火慢炖四十分钟，收汁前加冰糖上色。\n出锅前撒葱花，配米饭最好吃')},
];
const db={documents:docs,sources:[],knowledgeSets:[{id:'set-p',documentIds:['p1','p2']}],templates:[]};
const template={id:'tpl',prompt:'按写作 Prompt 写',rules:[]};

test('知识库同时提供同行写法：切口、爆点机制、正文架构、节奏与结尾',()=>{
 const craft=craftKnowledge(db,{title:'TikTok 店铺没有订单',topic:'TikTok店铺没有订单',templateSnapshot:template,documentIds:['p1','p2'],hookType:'扎心共情型'});
 assert.ok(craft.items.length>=2,'同行案例被读成写法参考');
 const first=craft.items.find(item=>item.documentId==='p1');
 assert.ok(first.skeleton.length>=2,'给出正文推进骨架');
 assert.equal(typeof first.rhythm.averageSentenceLength,'number');
 assert.ok(first.rhythm.shortSentenceRatio>=0&&first.rhythm.shortSentenceRatio<=1);
 assert.ok(first.ending.length>0,'给出结尾片段');
 assert.ok(first.cta,'识别出结尾的转化动作');
 assert.ok(first.angle.length>0);
});

test('写法参考同样只读本次所选知识库，未选择时完全不检索',()=>{
 const scoped=craftKnowledge(db,{title:'TikTok 选品',templateSnapshot:template,documentIds:['p2']});
 assert.deepEqual([...new Set(scoped.items.map(item=>item.documentId))],['p2']);
 const none=craftKnowledge(db,{title:'TikTok 选品',templateSnapshot:{...template,bindings:[]},documentIds:undefined,knowledgeSetIds:undefined});
 assert.equal(none.items.length,0);
 assert.equal(none.reason,'no_knowledge_configured');
 assert.equal(none.configured,false);
});

test('爆点机制按六类关键词归纳，不搬用原句',()=>{
 assert.equal(detectHookMechanism('你以为问题在流量，其实问题在承接'),'扎心共情型');
 assert.equal(detectHookMechanism('没想到结果反过来了，销量反而掉了三成'),'结果反差型');
 const profile=craftProfile(docs[0],3);
 assert.ok(profile.skeleton.every(line=>line.length<=49),'骨架只保留短句，不整段搬运');
});

test('写作上下文把内容素材与同行写法分开声明，并按主写作方法决定采纳方式',()=>{
 const job={title:'TikTok 店铺没有订单',topic:'TikTok店铺没有订单',templateSnapshot:template,documentIds:['p1','p2'],hookType:'扎心共情型',copyType:'实战型'};
 const custom=draftContext(db,job);
 assert.match(custom.system,/同行写法（选题切口、爆点机制、正文架构、论证方式、节奏、结尾与转化方式）/);
 assert.match(custom.system,/由用户所选写作 Prompt决定/);
 assert.ok(custom.craft.items.length>=2);
 assert.match(custom.user,/同行写法参考（craftKnowledge/);
 const payload=JSON.parse(custom.user.slice(custom.user.indexOf('{',custom.user.indexOf('以下 JSON'))));
 assert.ok(payload.craft.count>=2);

 const withSoul=draftContext(db,{...job,stylePromptId:'s1',stylePromptSnapshot:'墨鱼 DNA：短句推进'});
 assert.equal(withSoul.route,'dna');
 assert.match(withSoul.system,/由写作 DNA决定/);
 assert.ok(withSoul.craft.items.length>=2,'选了灵魂同样能学同行写法');
});
