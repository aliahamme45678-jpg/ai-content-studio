// Accept a validated final JSON object even when a model surrounds it with
// explanation, Markdown, or an invalid example. Validation remains mandatory.
export function structuredObjects(raw){
  const source=String(raw||'');const candidates=[];
  for(let start=0;start<source.length;start++){
    if(source[start]!=='{')continue;
    let depth=0,quoted=false,escaped=false;
    for(let end=start;end<source.length;end++){
      const char=source[end];
      if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
      if(char==='"')quoted=true;else if(char==='{')depth++;else if(char==='}'&&--depth===0){try{candidates.push(JSON.parse(source.slice(start,end+1)));}catch{}start=end;break;}
    }
  }
  return candidates;
}
export function parseStructuredOutput(raw,validate,mergeFragments){
  const candidates=structuredObjects(raw);
  let error=new Error('model_output_missing_valid_json'),failed=false;
  for(const candidate of [...candidates].reverse()){try{return validate(candidate);}catch(reason){if(!failed){error=reason;failed=true;}}}
  // 模型偶发把一个 JSON 对象提前闭合、其余键值悬在后面（如 {...,"findings":"..."},"patterns":[...]}）。
  // 单个候选都过不了校验时，用调用方提供的合并器把顶层碎片拼回一个对象再验一次；
  // 拼接只修复包装，不放松任何校验。合并结果打 parseRepaired 标记供审计。
  if(typeof mergeFragments==='function'){const stitched=mergeFragments(candidates);if(stitched&&typeof stitched==='object'){try{return Object.assign(validate(stitched),{parseRepaired:'stitched_top_level_fragments'});}catch(reason){error=reason;failed=true;}}}
  throw error;
}
