export function validateGeneration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.body !== 'string') throw new Error('model_output_missing_body');
  const body = value.body.trim();
  if ([...body].length < 80 || !/[A-Za-z\u3400-\u9fff]/u.test(body) || /^(?:[.…?？\s]+|待生成正文|暂无内容|至少\s*80\s*个字符的完整可编辑正文)$/u.test(body)) throw new Error('model_output_quality_too_low');
  if (value.corePoint !== undefined && typeof value.corePoint !== 'string') throw new Error('model_output_invalid_core_point');
  if (value.needsVerification !== undefined && (!Array.isArray(value.needsVerification) || value.needsVerification.some(item => typeof item !== 'string'))) throw new Error('model_output_invalid_verification');
  return { body, corePoint: value.corePoint || '', needsVerification: value.needsVerification || [] };
}

// Scan balanced objects, skipping examples and reasoning objects that do not contain a usable draft.
export function parseGeneration(text) {
  const source = String(text || '');
  let lastError = new Error('model_output_missing_body');
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== '{') continue;
    let depth = 0; let quoted = false; let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
      if (char === '"') quoted = true;
      else if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) {
        try { return validateGeneration(JSON.parse(source.slice(start, index + 1))); } catch (error) { lastError = error; }
        start = index;
        break;
      }
    }
  }
  throw lastError;
}
