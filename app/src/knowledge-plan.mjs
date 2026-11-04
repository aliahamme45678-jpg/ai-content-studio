import {retrieveKnowledge,sourceSnapshot} from './retrieval.mjs';
import {libraryDocument} from './library-membership.mjs';

// 六类开头只用于检索扩展与命中记录，不会改写用户已保存的写作 Prompt
export const hookTypeMechanisms={
  '扎心共情型':{mechanism:'先说出对方正在承受的具体损失和情绪，再给判断',terms:['难受','心疼','委屈','熬','不甘','坚持','你以为','没人告诉','其实你','白干']},
  '结果反差型':{mechanism:'先给与预期相反的结果，再交代落差和原因',terms:['结果','没想到','反而','居然','翻车','亏','一开始以为','最后']},
  '命令指令型':{mechanism:'用明确动作指令开场，先给可执行的第一步',terms:['别再','不要','立刻','马上','先做','第一步','记住','停']},
  '悬念好奇型':{mechanism:'抛出一个未解释的信息缺口，让人想看下去',terms:['为什么','你知道','有一个','没人','直到','答案','秘密','关键']},
  '数据直击型':{mechanism:'用可核验的数字或量级制造冲击',terms:['万','单','曝光','销量','倍','数据','%','成交']},
  '身份立场型':{mechanism:'先亮身份或立场，用立场筛选受众',terms:['我是','做过','操盘','老板','卖家','新手','如果你也','干了']},
  // 知识库新增分类：机制描述用于写作提示，terms 只用于开头检索扩展与命中判定
  '反常识冲击型':{mechanism:'先给一个与常识相反的判断，制造认知冲突，再给依据',terms:['反常识','其实不是','恰恰相反','都搞错了','真相是','并不是','颠覆']},
  '信息差型':{mechanism:'点出多数人不知道的信息缺口，用信息不对称抬升价值',terms:['信息差','没人告诉你','内行','圈内','少数人','冷知识','内幕','不知道']},
  '低门槛承诺型':{mechanism:'把行动门槛压到最低，承诺一个最小可执行动作',terms:['零基础','小白','不用','只要','一部手机','每天十分钟','门槛','第一次']},
  '利益承诺/利益钩子型':{mechanism:'直接承诺具体收益或省钱结果，把好处放在第一句',terms:['省钱','多赚','白拿','免费领','立省','收益','回报','划算']},
  '归因反转型':{mechanism:'把大众习惯的归因翻转成真正原因',terms:['真正原因','根源','不是你的问题','错不在','背锅','其实是因为','问题出在']},
  '游戏段位感型':{mechanism:'用段位、等级或梯队给读者定位，制造升级驱动',terms:['段位','青铜','王者','梯队','等级','新手村','排行榜','上分']},
  '权威背书型':{mechanism:'引用官方规则、报告或大厂做法建立可信度',terms:['官方','报告','白皮书','大厂','平台规则','行业标准','数据表明','权威']},
  '现象佐证型':{mechanism:'用普遍现象或群体行为佐证判断',terms:['你会发现','越来越多人','到处都是','一搜全是','普遍','现象','大家都在']},
  '方法论承诺型':{mechanism:'承诺一套可复用的方法、公式或步骤框架',terms:['方法论','公式','框架','三步','套路','模板','一套','拆解']}
};
export const hookTypes=Object.keys(hookTypeMechanisms);

// 知识范围：任务显式选择 > 模板绑定；两者都没有才算“没有选择知识库”
export function knowledgeScope(db,job){
  const template=job.templateSnapshot||db.templates?.find(t=>t.id===job.templateVersionId)||{};
  const jobDocs=Array.isArray(job.documentIds)?job.documentIds:null;
  const jobSets=Array.isArray(job.knowledgeSetIds)?job.knowledgeSetIds:null;
  const explicit=jobDocs!==null||jobSets!==null;
  const documents=new Set(jobDocs||[]);
  const addSet=setId=>{for(const id of db.knowledgeSets?.find(s=>s.id===setId)?.documentIds||[])documents.add(id);};
  for(const setId of jobSets||[])addSet(setId);
  let roles=[];
  if(!explicit){
    for(const id of template.documentIds||[])documents.add(id);
    for(const setId of template.knowledgeSetIds||[])addSet(setId);
    roles=Array.isArray(template.bindings)?template.bindings:[];
  }
  const configured=documents.size>0||roles.length>0||Boolean(explicit&&((jobDocs?.length||0)+(jobSets?.length||0)));
  return {documents,roles,explicit,configured};
}

function scopedDb(db,scope,excluded){
  const documents=db.documents.filter(doc=>{
    if(excluded.has(doc.id)||excluded.has(doc.sourceId))return false;
    if(!scope.documents.size&&!scope.roles.length)return false;
    if(scope.documents.size)return scope.documents.has(doc.id);
    return scope.roles.includes(doc.type)&&libraryDocument(doc,db);
  });
  return {...db,documents};
}

const termsOf=text=>{const out=new Set();const value=String(text||'').toLowerCase();
  for(const word of value.match(/[a-z0-9][a-z0-9_-]+/g)||[])out.add(word);
  for(const run of value.match(/[\u3400-\u9fff]+/g)||[])for(let i=0;i<run.length-1;i++)out.add(run.slice(i,i+2));
  return [...out];};

// 正文素材检索：与黄金三秒类型无关，不因开头类型收窄素材范围
export function bodyKnowledge(db,job){
  const scope=knowledgeScope(db,job);
  if(!scope.configured)return {items:[],scope,reason:'no_knowledge_configured'};
  const template=job.templateSnapshot||db.templates?.find(t=>t.id===job.templateVersionId)||{};
  const query=[job.title,job.topic,job.angle?.title,job.originalBody,job.customPrompt,job.automaticSearchQuery,
    ...(['hookType','copyStyle','copyType'].some(k=>job[k]==='AI自动识别')?['黄金三秒 开头 钩子 文案风格 结构 结尾 写作方法']:[]),
    ...sourceSnapshot(job,db).map(s=>s.title)].filter(Boolean).join('\n');
  const items=retrieveKnowledge(scopedDb(db,scope,new Set(job.excludedSourceIds||[])),query,
    scope.documents.size||scope.explicit?['事实库','写作案例库','蒸馏方法库','规则与记忆库']:(scope.roles.length?scope.roles:['事实库','写作案例库','蒸馏方法库','规则与记忆库']),
    {includeRules:true,includeSelected:scope.documents.size>0});
  return {items,scope,reason:items.length?'':'no_relevant_material'};
}

function typeTags(doc){
  const raw=[doc.hookType,doc.hookTypes,doc.tags,doc.tag,doc.category,doc.labels,doc['开头类型'],doc['类型']];
  return raw.flatMap(value=>Array.isArray(value)?value:String(value??'').split(/[,，、/|·]/)).map(v=>String(v).trim()).filter(Boolean);
}
const openingOf=text=>{
  const clean=String(text||'').replace(/\s+/g,' ').trim();if(!clean)return '';
  let out='';for(const part of clean.split(/(?<=[。！？!?])/)){if(out.length+part.length>140)break;out+=part;}
  return (out||clean).slice(0,160);
};
export const normalizeCompare=text=>String(text||'').replace(/[\s，。！？、；：""''「」『』（）()《》【】…—\-,.!?;:"'()\[\]]/g,'');
// 跳过示例开头的连续 18 字，说明是把知识库原句搬过来了，而不是提炼机制
export function hookEcho(body,items){
  const target=normalizeCompare(String(body||'').slice(0,260));if(!target)return null;
  for(const item of items||[]){const source=normalizeCompare(item.opening);if(source.length<18)continue;
    for(let i=0;i+18<=target.length;i++){const piece=target.slice(i,i+18);if(source.includes(piece))return {documentId:item.documentId,quote:piece};}}
  return null;
}

// 同行写法参考：知识库不只提供行业内容，也提供可学习的选题切口、爆点机制、正文架构、论证节奏与结尾方式
const sentenceList=text=>String(text||'').replace(/\s+/g,' ').split(/(?<=[。！？!?])/).map(item=>item.trim()).filter(Boolean);
const paragraphList=text=>String(text||'').split(/\n+/).map(item=>item.replace(/\s+/g,' ').trim()).filter(item=>item.length>=8);
const CTA=/关注|点赞|收藏|转发|评论区|留言|私信|领取|领资料|进群|主页|下单|链接|扫码|购买/;
// 按六类机制的关键词密度给开头打标签，只用于归纳可复用的钩子机制
export function detectHookMechanism(opening){
 const text=String(opening||'');let best=null;
 for(const [type,definition] of Object.entries(hookTypeMechanisms)){
  const hits=definition.terms.filter(term=>text.includes(term)).length;
  if(hits&&(!best||hits>best.hits))best={type,hits};
 }
 return best?best.type:null;
}
export function craftProfile(doc,relevance=0){
 const sentences=sentenceList(doc.content);
 const paragraphs=paragraphList(doc.content);
 const opening=openingOf(doc.content);
 // 没有分段的长文（采集稿常见）按每 3 句取一个骨架点，保证能看到推进顺序
 const skeletonSource=paragraphs.length>=2?paragraphs:Array.from({length:Math.ceil(sentences.length/3)},(_,index)=>sentences.slice(index*3,index*3+3).join(''));
 const clip=(text,max=48)=>text.length<=max?text:text.slice(0,max)+'…';
 const skeleton=skeletonSource.map(item=>item.split(/(?<=[。！？!?])/)[0].trim()).filter(Boolean).slice(0,5).map(item=>clip(item));
 const ending=sentences.slice(-2).join('').slice(0,120);
 const average=sentences.length?Math.round(sentences.reduce((sum,item)=>sum+item.length,0)/sentences.length):0;
 const shortRatio=sentences.length?+(sentences.filter(item=>item.length<=15).length/sentences.length).toFixed(2):0;
 return {documentId:doc.id,name:doc.name,author:doc.author||null,sourceType:doc.type||null,
  angle:String(doc.name||'').replace(/\s+/g,' ').trim().slice(0,60)||opening.slice(0,40),
  openingMechanism:detectHookMechanism(opening)||String(doc.hookType||'')||null,
  opening:opening.slice(0,100),
  skeleton,rhythm:{averageSentenceLength:average,shortSentenceRatio:shortRatio},
  ending,cta:CTA.test(ending)?ending.slice(0,80):null,relevance};
}
// 与开头检索分开的第三次检索：同一知识库，查询按当前主写作方法的需要组织，结果只用于学习写法
export function craftKnowledge(db,job,options={}){
 const scope=knowledgeScope(db,job);
 const base={items:[],scope,mode:'craft',configured:scope.configured,reason:null};
 if(!scope.configured)return {...base,reason:'no_knowledge_configured'};
 const sdb=scopedDb(db,scope,new Set(job.excludedSourceIds||[]));
 const pool=sdb.documents.filter(doc=>{
  const content=String(doc.content||'');
  if(content.length<200)return false;
  return doc.type==='写作案例库'||Boolean(doc.author)||/教程|案例|复盘|方法|拆解/.test(String(doc.name||''));
 });
 if(!pool.length)return {...base,reason:'no_craft_material'};
 // 主写作方法决定检索偏好：写作 DNA 更看结构/节奏，自定义 Prompt 更看选题切口与写法规则
 const route=options.route||'custom';
 const query=[job.title,job.topic,job.angle?.title,String(job.originalBody||'').slice(0,400),job.copyType,job.hookType]
  .concat(route==='dna'?['结构','节奏','推进','论证','结尾']:['切口','开头','结构','方法']).filter(Boolean).join('\n');
 const terms=new Set(termsOf(query));
 const ranked=pool.map(doc=>{
  const hay=(String(doc.name||'')+' '+String(doc.content||'').slice(0,1500)).toLowerCase();
  const hits=[...terms].filter(term=>hay.includes(term)).length;
  return {doc,hits};
 }).sort((a,b)=>b.hits-a.hits||String(b.doc.publishedAt||'').localeCompare(String(a.doc.publishedAt||'')));
 const items=ranked.slice(0,4).map(({doc,hits})=>craftProfile(doc,hits));
 return {...base,items,reason:items.length?'':'no_craft_material'};
}

// 开头检索：同一个知识库、同一个检索接口，但查询条件与结果用途和正文检索分开
export function hookKnowledge(db,job){
  const type=String(job.hookType||'').trim();
  const scope=knowledgeScope(db,job);
  const base={requestedType:type||null,type:type||null,mode:'none',hit:false,items:[],scanned:0,fallback:null};
  if(!type)return {...base,reason:'no_hook_type'};
  if(!scope.configured)return {...base,reason:'no_knowledge_selected',fallback:'writing_prompt_mechanism'};
  const mechanism=hookTypeMechanisms[type];
  const topics=[job.title,job.topic,job.angle?.title,String(job.originalBody||'').slice(0,600)].filter(Boolean);
  const query=[...topics,type,...(mechanism?.terms||[])].join('\n');
  const topicTerms=termsOf(topics.join(' '));
  const sdb=scopedDb(db,scope,new Set(job.excludedSourceIds||[]));
  const chunks=retrieveKnowledge(sdb,query,['写作案例库','事实库'],{limit:40});
  const byDoc=new Map();
  for(const chunk of chunks){if(!chunk.relevance)continue;const previous=byDoc.get(chunk.documentId);if(!previous||chunk.relevance>previous.relevance)byDoc.set(chunk.documentId,chunk);}
  const items=[];
  for(const [documentId,chunk] of byDoc){
    const doc=sdb.documents.find(d=>d.id===documentId);if(!doc)continue;
    const opening=openingOf(doc.content);if(!opening)continue;
    // 主题相关性：必须与本次话题有关，避免把不相关作品的开头搬进来
    const topicHit=topicTerms.some(term=>String(doc.name||'').toLowerCase().includes(term)||String(doc.content||'').toLowerCase().includes(term));
    if(!topicHit)continue;
    const labelMatch=typeTags(doc).some(tag=>tag.includes(type)||type.includes(tag));
    items.push({documentId,name:doc.name,author:doc.author||null,url:doc.url||null,opening,relevance:chunk.relevance,labelMatch});
  }
  items.sort((a,b)=>Number(b.labelMatch)-Number(a.labelMatch)||b.relevance-a.relevance||String(a.documentId).localeCompare(String(b.documentId)));
  const picked=items.slice(0,5);
  const mode=picked.some(item=>item.labelMatch)?'label':'semantic';
  return {...base,mode:picked.length?mode:'none',hit:Boolean(picked.length),items:picked,scanned:byDoc.size,
    mechanism:mechanism?.mechanism||'',fallback:picked.length?null:'writing_prompt_mechanism',reason:picked.length?'':'no_matching_opening'};
}
