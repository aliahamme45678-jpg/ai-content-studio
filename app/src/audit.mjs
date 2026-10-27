import { createHash } from 'node:crypto';
export const bodyHash = body => createHash('sha256').update(String(body)).digest('hex');
export function inspectDraft(body) {
  const text = String(body || ''); const issues = [];
  for (const match of text.matchAll(/待核实|待补充|待生成正文|TODO|\[待[^\]]*\]/g)) {
    issues.push({ skill:'local-placeholder-check', severity:'高', blocking:true, quote:match[0], location:{start:match.index,end:match.index+match[0].length}, explanation:'稿件仍有待确认内容，需处理后定稿。', suggestion:'用已核验内容替换，或删除该占位片段。', replacement:'' });
  }
  for (const match of text.matchAll(/总而言之|综上所述/g)) {
    issues.push({skill:'local-expression-check',severity:'低',blocking:false,quote:match[0],location:{start:match.index,end:match.index+match[0].length},explanation:'可省去套话，让结论直接出现。',suggestion:'只删除这处过渡短语。',replacement:''});
  }
  if (!text.trim()) issues.push({skill:'local-empty-check',severity:'高',blocking:true,quote:'',location:null,explanation:'正文为空。',suggestion:'先写入正文再审核。'});
  return issues;
}
export function invalidateAudit(db, jobId) {
  for (const issue of db.auditIssues.filter(item=>item.jobId===jobId && item.status!=='已归档')) issue.status='待重新验证';
}
