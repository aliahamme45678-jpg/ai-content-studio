import { skillAliases } from './workflow.mjs';

export const SKILL_LICENSE = 'dbskill CC BY-NC 4.0 · 本地规则兼容实现，不是原 Skill 执行器';

function issue(skill, severity, quote, explanation, suggestion, extra={}) {
  return { skill, severity, quote, explanation, suggestion, ...extra };
}

export function runLocalSkills(job, template={}) {
  const body=String(job.body||''); const issues=[]; const skills=template.audits||[];
  if(skills.includes('dbs-ai-check')) {
    // 对应 writing-dna-skill 6.3「写完之后清理 AI 痕迹」：只标书面套话与空心词，不阻断、不改框架
    const aiTone=['综上所述','在当今','值得注意的是','总而言之','毋庸置疑','众所周知','不难发现','随着时代的发展','在这个信息爆炸的时代','赋能','抓手','底层逻辑','颗粒度','降本增效','全链路','生态位','护城河','势能','心智占领','破局','引爆','天花板','万能公式','建议收藏','一键三连'];
    for(const phrase of aiTone) {
      const index=body.indexOf(phrase); if(index>=0) issues.push(issue('dbs-ai-check','低',phrase,'这是常见的平滑连接或空心表达，可能让语气显得模板化。','根据作者真实语气替换或删除；与蒸馏产物冲突时以蒸馏产物为准。',{location:{start:index,end:index+phrase.length},evidence:'本地表达规则'}));
    }
  }
  if(skills.includes('dbs-script-flow') && job.format==='视频口播') {
    const sentences=body.split(/[。！？!?]/).map(item=>item.trim()).filter(Boolean);
    sentences.forEach((sentence,index)=>{if(sentence.length>55)issues.push(issue('dbs-script-flow','中',sentence,'单句信息密度较高，口播时可能出现停顿或跟不上。','拆成两句，保留一个动作或判断。',{location:{start:body.indexOf(sentence),end:body.indexOf(sentence)+sentence.length},evidence:'本地口播长度规则'}));});
  }
  if(skills.includes('dbs-content-value') && !body.trim()) issues.push(issue('dbs-content-value','高','', '没有正文，暂时无法判断开头和观看回报。','先补充标题、开头或正文。',{location:null,evidence:'本地内容价值规则',blocking:true}));
  if(skills.includes('dbs-content-risk-check')) {
    for(const phrase of ['保证赚钱','绝对不会','百分之百有效']) {const index=body.indexOf(phrase);if(index>=0)issues.push(issue('dbs-content-risk-check','高',phrase,'绝对化或收益承诺可能产生平台风险。','改为有条件、可核验的表达。',{location:{start:index,end:index+phrase.length},evidence:'本地风险词规则'}));}
  }
  return {skills, issues, license:SKILL_LICENSE, engine:'local-rules', generatedAt:new Date().toISOString()};
}

export function runSkillPipeline(job, template={}) {
  const aliases=skillAliases;
  const configured=[...(template.audits || [])].map(skill=>aliases[skill]||skill);
  const enabled=template.audits===undefined?['dbs-ai-check']:configured;
  const all=runLocalSkills(job,{...template,audits:enabled});
  const supported=['dbs-ai-check','dbs-content-value','dbs-script-flow','dbs-content-risk-check'];
  const runs=enabled.map(skill=>({skill,state:!supported.includes(skill)||skill==='dbs-script-flow'&&job.format!=='视频口播'?'skipped':'succeeded',detail:!supported.includes(skill)?'未接入该方法的完整执行器；本地检查不覆盖此项':null,engine:'local-rules',license:SKILL_LICENSE,startedAt:all.generatedAt,finishedAt:all.generatedAt,issueCount:all.issues.filter(issue=>issue.skill===skill).length}));
  return {...all,runs};
}
