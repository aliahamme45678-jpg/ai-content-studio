export function writingDnaContext(db,job){
 const preset=db.templates?.find(t=>t.id===job.stylePromptId);const run=db.taskRuns?.find(r=>r.id===(job.styleDnaRunId||preset?.distillationRunId)&&r.taskKind==='writing-dna'&&r.state==='succeeded');if(!run)return null;
 const topic=String(job.topic||job.title||job.originalBody||'');const terms=[...new Intl.Segmenter('zh',{granularity:'word'}).segment(topic)].filter(v=>v.isWordLike).map(v=>v.segment);const metadata=(run.batches||[]).flatMap(b=>b.metadata||[]);
 const genre=String(job.format||job.copyType||'');
 const examples=run.corpus.map(d=>{const meta=metadata.filter(m=>m.id===d.id);const haystack=[d.title,...meta.flatMap(m=>[m.article_type,...(m.topic_tags||[])])].join(' ');const genreMatch=genre&&meta.some(m=>m.article_type?.includes(genre)||genre.includes(m.article_type));return {doc:d,genreMatch:Boolean(genreMatch),score:terms.filter(t=>haystack.includes(t)).length};}).sort((a,b)=>Number(b.genreMatch)-Number(a.genreMatch)||b.score-a.score||String(b.doc.date||'').localeCompare(String(a.doc.date||''))).slice(0,5).map(x=>x.doc);
 // Read the five selected originals in full; never silently replace full calibration with excerpts.
 const budgeted=examples;
 return {method:run.method.url,scope:run.corpus.length<20?'当前样本写法':'多篇语料写法',quality:run.quality||null,artifacts:{...run.result,...(preset?.dnaReport?Object.fromEntries(['language','structure','cognition','visual'].filter(k=>preset.dnaReport[k]).map(k=>[k,preset.dnaReport[k]])):{}),...(preset?.prompt?{prompt:preset.prompt}:{})},examples:budgeted,calibration:'写作前通读这五篇（不足五篇时读取全部并承认样本不足），明确共同语感后再写；先匹配体裁，再匹配题材，用近期原文校准。',referenceOnly:'参考完整原文校准句式和节奏，不复制作者事实与经历；本次用户明确要求优先。'};
}
