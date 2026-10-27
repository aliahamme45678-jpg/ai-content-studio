export const SKILL_LICENSE = 'dbskill CC BY-NC 4.0 · 本地规则兼容实现，不是原 Skill 执行器';

function issue(skill, severity, quote, explanation, suggestion, extra={}) {
  return { skill, severity, quote, explanation, suggestion, ...extra };
}

export function runLocalSkills(job, template={}) {
  const body=String(job.body||''); const issues=[]; const skills=template.audits||[];
  if(skills.includes('dbs-ai-check')) {
    for(const phrase of ['综上所述','在当今','值得注意的是','总而言之']) {
      const index=body.indexOf(phrase); if(index>=0) issues.push(issue('dbs-ai-check','低',phrase,'这是常见的平滑连接表达，可能让语气显得模板化。','根据作者真实语气替换或删除。',{location:{start:index,end:index+phrase.length},evidence:'本地表达规则'}));
    }
  }
  if(skills.includes('dbs-script-flow') && job.format==='视频口播') {
    const sentences=body.split(/[。！？!?]/).map(item=>item.trim()).filter(Boolean);
    sentences.forEach((sentence,index)=>{if(sentence.length>55)issues.push(issue('dbs-script-flow','中',sentence.slice(0,80),'单句信息密度较高，口播时可能出现停顿或跟不上。','拆成两句，保留一个动作或判断。',{location:{start:body.indexOf(sentence),end:body.indexOf(sentence)+sentence.length},evidence:'本地口播长度规则'}));});
  }
  if(skills.includes('dbs-content-value') && !body.trim()) issues.push(issue('dbs-content-value','高','', '没有正文，暂时无法判断开头和观看回报。','先补充标题、开头或正文。',{location:null,evidence:'本地内容价值规则',blocking:true}));
  if(skills.includes('dbs-content-risk-check')) {
    for(const phrase of ['保证赚钱','绝对不会','百分之百有效']) {const index=body.indexOf(phrase);if(index>=0)issues.push(issue('dbs-content-risk-check','高',phrase,'绝对化或收益承诺可能产生平台风险。','改为有条件、可核验的表达。',{location:{start:index,end:index+phrase.length},evidence:'本地风险词规则'}));}
  }
  return {skills, issues, license:SKILL_LICENSE, engine:'local-rules', generatedAt:new Date().toISOString()};
}

export function runSkillPipeline(job, template={}) {
  const configured=[...(template.audits || [])];
  const enabled=configured.length ? configured : ['dbs-ai-check'];
  const all=runLocalSkills(job,{...template,audits:enabled});
  const runs=enabled.map(skill=>({skill,state:skill==='dbs-script-flow'&&job.format!=='视频口播'?'skipped':'succeeded',engine:'local-rules',license:SKILL_LICENSE,startedAt:all.generatedAt,finishedAt:all.generatedAt,issueCount:all.issues.filter(issue=>issue.skill===skill).length}));
  return {...all,runs};
}
