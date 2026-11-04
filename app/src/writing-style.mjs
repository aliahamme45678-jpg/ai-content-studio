import {readFileSync} from 'node:fs';

// Read the upstream defaults as text without starting its HTTP server.
const dnaCleanup=readFileSync(new URL('../prompts/writing-dna-upstream/skills/lieflat-less-ai-tone/SKILL.md',import.meta.url),'utf8');
const source=readFileSync(new URL('../../opensource/hermes-copywriting-engine/server.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
export function upstreamPrompt(name){
  const start=source.indexOf(`function ${name}() {`);
  const opening=source.indexOf('return String.raw`',start);
  const end=source.indexOf('`;\n}',opening);
  if(start<0||opening<0||end<0)throw new Error('hermes_prompt_contract_changed');
  return source.slice(opening+'return String.raw`'.length,end);
}
export const soulNames=['马斯克风格','鲁迅风格','余华风格','罗永浩风格'];
// 黄金三秒类型：前 6 个是历史分类（旧任务、旧知识库标签仍可读），后 9 个是知识库新增分类
export const hookTypes=[
 '扎心共情型','结果反差型','命令指令型','悬念好奇型','数据直击型','身份立场型',
 '反常识冲击型','信息差型','低门槛承诺型','利益承诺/利益钩子型','归因反转型',
 '游戏段位感型','权威背书型','现象佐证型','方法论承诺型'
];
export const copyStyles=['清醒实战型','犀利避坑型','老板视角型','新手听得懂型','冷静拆解型','口语成交型'];
// account-distill 的方法不只在 methodology：深写DNA、语言指纹、产物规范、传播分析都要一起给
export const authorMethodFiles=['methodology.md','evidence-validation.md','deep-writing-dna.md','language-fingerprint.md','output-schema.md','performance-analysis.md'];
export const authorMethods=authorMethodFiles.map(name=>({name,content:readFileSync(new URL(`../../opensource/Chzhinan/skills/account-distill/references/${name}`,import.meta.url),'utf8')}));
export function builtinSoul(name){
  if(!soulNames.includes(name))return '';
  return upstreamPrompt('defaultBuiltInSoulRulesPrompt').split(/\n=+\n/).find(section=>section.includes(`# ${name.replace('风格','人格灵魂')}`))?.trim()||'';
}
// 写作优先级只描述运行时裁决顺序，不改写用户已保存的 Prompt 文本
export const writingPriority=[
 '写作优先级（冲突时按此裁决，1 最高）：',
 '1. 用户原稿与真实事实：改写不得改动核心观点、数字、事实与操作逻辑；没有依据的数字和个人经历一律不写。',
 '2. 用户本次手动选择：黄金三秒类型与文案类型必须执行，覆盖写作 DNA 中相反的钩子偏好与常用正文结构。',
 '3. 统一写作 Prompt：负责真实性、逻辑完整性、信息密度、原创性、开头与正文衔接和最终审核；不得用固定结构覆盖写作 DNA。',
 '4. 写作 DNA（灵魂）：决定叙述视角、句式、词汇、叙事节奏、情绪强度、论证方式与转化方式，但不得改变 1-3。',
 '5. 知识库提供内容素材与同行写法（切口、爆点机制、架构、论证、节奏、结尾），只借用结构与机制，不决定作者身份；不得把其他作者的经历、语气和风格混入成稿。'
].join('\n');
// 蒸馏模板：整合文档与四份完整分层产物均参与写作；视觉资料缺失时只读取范围声明。
export function stylePromptOf(preset){
 const base=String(preset?.prompt||'').trim(),report=preset?.dnaReport;
 if(!report)return base;
 const blocks=[['language','语言 DNA'],['structure','结构模板'],['cognition','选题、素材与认知'],['visual','视觉与已验证排版范围']].map(([key,label])=>{const value=String(report[key]||'').trim();return value?`${label}：\n${value}`:'';}).filter(Boolean);
 if(!blocks.length)return base;
 // DNA 里的禁止性规则（不得/不要/别/禁止/严禁…）单列成硬性禁忌放最前：模型对长文末尾的否定规则执行不稳（实测拟人化禁令被违反）
 const banLines=[];
 for(const [key] of [['language'],['structure'],['cognition']]){
  for(const line of String(report[key]||'').split('\n')){
   const t=line.trim();
   if(t.length>=8&&t.length<=120&&/(不得|不要|别|禁止|严禁|不写|不拟人|不允许)/.test(t)&&!banLines.includes(t))banLines.push(t);
  }
 }
 const ban=banLines.length?`硬性禁忌（逐条遵守，知识库案例和示例里的相反写法一律忽略）：\n${banLines.slice(0,10).map(item=>`- ${item.replace(/^[-•\d.、\s]+/,'')}`).join('\n')}\n\n`:'';
 return `${base}\n\n${ban}写作 DNA 分层规则（同一批语料蒸馏产出，决定个人表达方式，不覆盖用户本次选择的黄金三秒类型与文案类型）：\n${blocks.join('\n\n')}\n\n按 DNA 成稿后执行以下来源 Skill 的白名单去 AI 痕迹检查，只处理命中项；DNA 特征优先，不改事实、框架与未命中句子：\n${dnaCleanup}`;
}
export function styleConfig(input,db,previous={}){
  const out={};const fail=message=>{throw Object.assign(new Error(message),{statusCode:400});};
  for(const [key,choices] of [['soulPersona',soulNames],['hookType',hookTypes],['copyStyle',copyStyles],['copyType',['思维型','实战型']]]){
    const value=input[key]??previous[key];if(value===undefined)continue;
    if(typeof value!=='string'||value&&!choices.includes(value)&&!(key!=='soulPersona'&&value==='AI自动识别'))fail(`invalid_${key}`);out[key]=value;
  }
  if(input.stylePromptId!==undefined||previous.stylePromptId!==undefined){
    const id=input.stylePromptId??previous.stylePromptId;if(typeof id!=='string')fail('invalid_style_prompt');
    const preset=id&&db.templates?.find(t=>t.id===id&&t.promptCategory==='style');if(id&&!preset)fail('style_prompt_not_found');
    out.styleDnaRunId=id?(previous.stylePromptId===id&&previous.styleDnaRunId||preset.distillationRunId||''):'';
    out.stylePromptId=id;out.stylePromptSnapshot=id?(previous.stylePromptId===id&&previous.stylePromptSnapshot||stylePromptOf(preset)):'';
  }
  const profileId=input.soulProfileId??previous.soulProfileId;
  if(profileId!==undefined){
    if(typeof profileId!=='string')fail('invalid_soul_profile');
    const doc=profileId&&db.documents.find(d=>d.id===profileId&&d.soulProfile);
    if(profileId&&!doc)fail('soul_profile_not_found');
    out.soulProfileId=profileId;
    out.soulSnapshot=profileId?(previous.soulProfileId===profileId&&previous.soulSnapshot||JSON.stringify(doc.soulProfile)):'';
  }
  if(out.soulPersona)out.soulSnapshot=previous.soulPersona===out.soulPersona&&previous.soulSnapshot||builtinSoul(out.soulPersona);
  if(input.targetWordCount!==undefined||previous.targetWordCount!==undefined){const n=Number(input.targetWordCount??previous.targetWordCount);if(n!==0&&(!Number.isInteger(n)||n<80||n>5000))fail('word_count_must_be_80_to_5000');out.targetWordCount=n;}
  const prompt=input.customPrompt??previous.customPrompt;
  if(prompt!==undefined){if(typeof prompt!=='string'||prompt.length>20000)fail('invalid_custom_prompt');out.customPrompt=prompt;}
  const durationMode=(input.durationMode??previous.durationMode)===''?'original':(input.durationMode??previous.durationMode);
  if(durationMode!==undefined){if(!['original','custom'].includes(durationMode))fail('invalid_duration_mode');out.durationMode=durationMode;}
  return out;
}
// 主写作方法只有一套：选了灵魂用 Writing DNA，没选灵魂用用户所选写作 Prompt
export const hasWritingSoul=job=>Boolean(job?.stylePromptId||job?.soulPersona||job?.soulProfileId||job?.stylePromptSnapshot||job?.soulSnapshot);
export const writingRoute=job=>hasWritingSoul(job)?'dna':'custom';
// 文案层面的归一：只用于判断两段 DNA 文本是否重复，不改变任何原始 Prompt 文本
const dnaNormalize=value=>String(value||'').replace(/[\s\u3000]+/g,'').replace(/[，。！？、；：""''「」『』（）()《》【】…—\-,.!?;:"'()\[\]*#>`~|]/g,'').toLowerCase();
const dnaLines=text=>String(text||'').split(/\n+/).map(item=>item.trim()).filter(Boolean);
// 同一 DNA 可能同时来自「灵魂提示词」和「蒸馏模板提示词」：按整段包含 + 行级包含去重，只保留一份
export function mergeWritingDna(blocks){
 const kept=[],reports=[];let accumulated='';
 for(const block of blocks){
  const text=String(block?.text||'').trim();if(!text)continue;
  const normalized=dnaNormalize(text);if(!normalized)continue;
  if(accumulated&&accumulated.includes(normalized)){reports.push({label:block.label,action:'dropped_duplicate',chars:text.length,removed:0});continue;}
  let next=text,removed=0;
  if(accumulated){
   const retained=[];
   for(const line of dnaLines(text)){
    const normalizedLine=dnaNormalize(line);
    if(normalizedLine.length>=12&&accumulated.includes(normalizedLine)){removed+=1;continue;}
    retained.push(line);
   }
   next=retained.join('\n');
  }
  if(!next.trim()){reports.push({label:block.label,action:'dropped_duplicate',chars:text.length,removed});continue;}
  accumulated+=dnaNormalize(next);
  kept.push({...block,text:next});
  reports.push({label:block.label,action:removed?'deduped':'kept',chars:next.length,removed});
 }
 return {blocks:kept,reports,removed:reports.reduce((sum,item)=>sum+item.removed,0)};
}
// 判断「蒸馏模板」与「所选灵魂」是否同一份 DNA：同 id、同蒸馏批次，或模板 prompt 已被灵魂提示词包含
export function sameDnaSource(job,template,custom){
 if(!template||!(template.distillationRunId||template.soulProfileId))return false;
 if(template.id&&template.id===job?.stylePromptId)return true;
 if(template.distillationRunId&&template.distillationRunId===job?.styleDnaRunId)return true;
 // 模板自带灵魂档案：只有与本次灵魂档案同一份才算同一 DNA
 if(template.soulProfileId&&job?.soulProfileId)return template.soulProfileId===job.soulProfileId;
 // 没有另外选灵魂模板或人格时，这份蒸馏模板本身就是本次的 DNA 来源
 if(!job?.stylePromptId&&!job?.soulPersona&&custom)return true;
 if(job?.stylePromptSnapshot&&custom)return dnaNormalize(job.stylePromptSnapshot).includes(dnaNormalize(custom));
 return false;
}
// 返回本次实际下发的唯一主写作方法，以及合并去重过程（用于落库追溯，不改动用户已保存的 Prompt）
export function writingMethod(job,templatePrompt){
 const template=job?.templateSnapshot||{};
 const custom=String(templatePrompt??template.prompt??'').trim();
 const rules=(template.rules||[]).filter(Boolean);
 const soulRequested=writingRoute(job)==='dna';
 const templateIsSoul=Boolean(template.distillationRunId||template.soulProfileId);
 const sameSource=templateIsSoul&&sameDnaSource(job,template,custom);
 const blocks=[];
 const add=(label,text,source)=>{const value=String(text||'').trim();if(value)blocks.push({label,text:value,source});};
 add('写作 DNA（Writing DNA Skill）',job?.stylePromptSnapshot,'soul');
 // 同一 DNA 来源的蒸馏模板提示词只做合并去重；不同来源的蒸馏模板不再作为第二套完整方法注入
 if(templateIsSoul&&custom&&sameSource)add('写作 DNA 主提示词（同一蒸馏来源，已合并去重）',custom,'template');
 add('灵魂人格规则',job?.soulSnapshot,'persona');
 const merged=mergeWritingDna(blocks);
 const dnaText=merged.blocks.map(block=>`${block.label}：\n${block.text}`).join('\n\n');
 const route=soulRequested&&dnaText?'dna':'custom';
 return {route,custom,rules,dna:dnaText,soulRequested,templateIsSoul,sameSource,
  merge:merged.reports,removedDuplicates:merged.removed,
  // 选了灵魂又挂了另一份蒸馏模板：只保留所选灵魂的方法，模板降级为不注入
  skippedTemplate:templateIsSoul&&custom&&!sameSource&&soulRequested?'different_distillation_source':null,
  // 同一来源且模板规则属于这套 DNA，作为硬性规则继续生效
  dnaRules:templateIsSoul&&sameSource?rules:[]};
}
export function writingStylePrompt(job,templatePrompt,resolved){
 const method=resolved||writingMethod(job,templatePrompt);
 const mergeNote=method.route==='dna'&&method.removedDuplicates>0?`（同一蒸馏来源已合并去重，删除 ${method.removedDuplicates} 行重复内容，避免同一方法重复下发）`:'';
 const target=Number(job?.targetWordCount)>0?Number(job.targetWordCount):0;
 const lengthRule=target?`目标字数：${target} 字，允许 ${Math.round(target*.9)}—${Math.round(target*1.1)} 字（硬性区间）。`:'';
 return [
  writingPriority,
  method.route==='dna'
   ?`本次主写作方法：所选写作 DNA（灵魂），本次唯一主写作方法。执行它完整的钩子、架构、论证、句式、节奏、情绪、视角、结尾与转化方式；不同时注入另一套写作 Prompt 的完整写法，避免两套方法冲突。${mergeNote}\n${method.dna}${method.dnaRules.length?`\n硬性规则（同一 DNA 模板）：\n${method.dnaRules.join('\n')}`:''}`
   :`本次主写作方法：用户所选写作 Prompt，完整执行其写作规范、结构、风格和其他规则。\n${method.custom}${method.rules.length?`\n硬性规则：\n${method.rules.join('\n')}`:''}`,
  job?.customPrompt?`用户补充写作要求（不得覆盖主写作方法与用户本次选择）：${job.customPrompt}`:'',
  job?.durationMode==='original'?'目标时长基于原稿的信息量与口播节奏，不强行扩写或压缩。':'',
  ['hookType','copyStyle','copyType'].some(k=>job?.[k]==='AI自动识别')?'先识别原稿的黄金三秒、语气、结构和内容类型，再从提供的知识片段中选择匹配写法复用；只有标记自动的字段由你判断，其他用户指定字段优先。不得照搬案例事实。':'',
  job?.hookType?`黄金三秒类型：${job.hookType}`:'',
  job?.copyStyle?`文案风格：${job.copyStyle}`:'',
  job?.copyType?`文案类型：${job.copyType}`:'',
  lengthRule,
  job?.originalBody?`改写篇幅必须与原稿信息量匹配：原稿约 ${[...String(job.originalBody)].filter(char=>!/\s/.test(char)).length} 字，不得压成摘要，也不得为凑字数注水。`:'',
  method.route==='dna'?'写作 DNA 参与内容策划、正文组织与初稿写作；成稿阶段只做一致性与事实检查，不再用另一套写作方法整篇重写。':'',
  '质量检查（两种主写作方法都生效）：真实性、逻辑完整、信息密度、原创性、开头与正文衔接、原稿要点是否保留、用户本次选项是否落实。'
 ].filter(Boolean).join('\n');
}
