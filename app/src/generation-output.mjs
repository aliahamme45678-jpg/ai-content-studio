import {parseStructuredOutput} from './structured-output.mjs';
export function validateGeneration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.body !== 'string') throw new Error('model_output_missing_body');
  const body = value.body.trim();
  if ([...body].length < 80 || !/[A-Za-z\u3400-\u9fff]/u.test(body) || /^(?:[.…?？\s]+|待生成正文|暂无内容|至少\s*80\s*个字符的完整可编辑正文)$/u.test(body)) throw new Error('model_output_quality_too_low');
  if (value.corePoint !== undefined && typeof value.corePoint !== 'string') throw new Error('model_output_invalid_core_point');
  if (value.needsVerification !== undefined && (!Array.isArray(value.needsVerification) || value.needsVerification.some(item => typeof item !== 'string'))) throw new Error('model_output_invalid_verification');
  return { ...(typeof value.title==='string'&&value.title.trim()?{title:value.title.trim().slice(0,60)}:{}),body, corePoint: value.corePoint || '', needsVerification: value.needsVerification || [] };
}

// Scan balanced objects, skipping examples and reasoning objects that do not contain a usable draft.
export function parseGeneration(text) {
  return parseStructuredOutput(text,validateGeneration);
}

export function generatedTitle(result){
 const title=String(result.title||'').replace(/[\r\n]+/g,' ').trim();if(title)return title.slice(0,60);
 const first=String(result.body||'').split(/[\n。！？!?]/).map(v=>v.trim()).find(Boolean)||'';
 return first.replace(/^标题[:：]\s*/,'').slice(0,30);
}
