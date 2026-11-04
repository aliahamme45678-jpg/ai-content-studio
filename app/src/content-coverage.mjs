// 原稿要点与覆盖率：只做确定性抽取与比对，不改写原文、不调用模型
const normalize=value=>String(value||'').replace(/[\s\u3000]+/g,'').replace(/[，。！？、；：""''「」『』（）()《》【】…—\-,.!?;:"'()\[\]]/g,'').toLowerCase();
export const realCharCount=text=>[...String(text||'')].filter(char=>!/\s/.test(char)).length;
const STEP_MARK=/^(?:第[一二三四五六七八九十\d]+[步条点]|[0-9]+[.、)）]|[-*•])\s*/;
const IMPORTANT=/\d|%|％|万|千|元|美元|单|倍|天|小时|月|第[一二三四五六七八九十]|先|再|然后|接着|最后|不要|别|必须|一定|记得|核心|关键|本质|所以|因此|结论|等于|就是|不要|禁止|优先/;
const splitSentences=text=>String(text||'').split(/(?<=[。！？!?；;])|\n+/).map(item=>item.replace(STEP_MARK,'').trim()).filter(Boolean);

// 长句按逗号切成可核对的小块，避免一条要点过长导致覆盖率永远不达标
const chunksOf=sentence=>{
 if(normalize(sentence).length<=60)return [sentence];
 const parts=sentence.split(/(?<=[，,])/).map(item=>item.trim()).filter(Boolean);
 const out=[];let buffer='';
 for(const part of parts){
  if(buffer&&(buffer+part).length>60){out.push(buffer);buffer=part;}
  else buffer+=part;
 }
 if(buffer)out.push(buffer);
 return out;
};

// 抽取原稿必须保留的要点：数字、操作步骤、结论、禁止项。原稿本身很短时全部保留。
export function originalPoints(job){
 const original=String(job?.originalBody||'').trim();
 if(!original)return [];
 const sentences=splitSentences(original).flatMap(chunksOf).map(item=>item.trim()).filter(item=>normalize(item).length>=10);
 if(!sentences.length)return [];
 const picked=sentences.length<=30?sentences:sentences.filter(item=>IMPORTANT.test(item)).slice(0,30);
 const unique=[...new Set(picked)];
 return unique.map((text,index)=>({id:`p${index+1}`,text}));
}

const STOP=new Set(['的','了','是','就','在','你','我','他','她','它','也','都','这','那','有','没','不','要','会','能','把','给','对','从','到','和','再','个','上','下','里','还','但','而','着','过','很','更','最','一个','我们','你们','他们','如果','然后','所以','因为','可以','就是','不是','没有','一个','这个','那个']);
const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
const wordsOf=text=>{
 const out=new Set();
 for(const {segment,isWordLike} of segmenter.segment(String(text||'')))if(isWordLike&&!STOP.has(segment)&&segment.length>=2)out.add(segment);
 return [...out];
};
const bigrams=text=>{
 const clean=normalize(text);const out=new Set();
 if(clean.length<=2){if(clean)out.add(clean);return [...out];}
 for(let i=0;i<clean.length-1;i++)out.add(clean.slice(i,i+2));
 return [...out];
};
const CN_DIGIT={'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
// 关键事实只认数字/金额/量级/专名编号：这类信息一旦丢失就是篡改，且同义改写无法替代
function factTokens(text){
 const out=new Set();
 // 金额/数量按“数值”比对：1500、1500美金、一千五视作同一事实；万/亿/千保留量级
 const push=(value,unit)=>{
  if(!unit&&Number(value)<1000)return;
  if(['万','亿','千'].includes(unit))out.add(value+unit);
  else if(unit==='%'||unit==='％')out.add(value+'%');
  else out.add(value);
 };
 for(const match of String(text||'').matchAll(/(\d+(?:\.\d+)?)\s*(万|亿|千|元|块|%|％|单|天|倍|克|公斤|美金|美元|小时|个月|年)?/g))push(match[1],match[2]||'');
 // 几十/几百/十几 是模糊量词，不作为必须保留的精确事实
 for(const match of String(text||'').matchAll(/(?<!几)([零一二两三四五六七八九十]{1,3})\s*(万|亿|千|元|块|%|％|单|天|倍|克|公斤|美金|美元|小时|个月|年)/g))push([...match[1]].map(char=>CN_DIGIT[char]??char).join(''),match[2]);
 return out;
}
// 数字归一：两万/2万、一千五/1500 这类同义写法先统一，再比对
const normalizeDigits=text=>String(text||'').replace(/([零一二两三四五六七八九十]{1,3})(?=\s*(?:万|亿|千|元|块|%|％|单|天|倍|克|公斤|美金|美元|小时|个月|年))/g,(all)=>[...all].map(char=>CN_DIGIT[char]??char).join(''));

// 逐条比对：关键事实（数字/金额/量级）丢失必然算未覆盖；表述细节只做提示，不直接判失败
export function coverageReport(body,points){
 const text=normalizeDigits(normalize(body));
 const bodyFacts=factTokens(body);
 const bodyWords=new Set(wordsOf(body));
 const criticalMissing=[],softMissing=[];
 for(const point of points||[]){
  const facts=[...factTokens(point.text)];
  const lost=facts.filter(fact=>!bodyFacts.has(fact));
  const grams=bigrams(point.text);
  const hits=grams.filter(gram=>text.includes(gram)).length;
  const ratio=grams.length?hits/grams.length:0;
  const words=wordsOf(point.text);
  const wordHits=words.filter(word=>bodyWords.has(word)||text.includes(word)).length;
  const wordRatio=words.length?wordHits/words.length:ratio;
  const detail={id:point.id,text:point.text,ratio:+ratio.toFixed(2),wordRatio:+wordRatio.toFixed(2),lostFacts:lost};
  if(lost.length)criticalMissing.push(detail);
  else if(!(wordRatio>=.6||ratio>=.55))softMissing.push(detail);
 }
 const total=(points||[]).length;
 return {total,criticalMissing,softMissing,missing:softMissing,
  coverage:total?+((total-softMissing.length)/total).toFixed(2):1,
  criticalCoverage:total?+((total-criticalMissing.length)/total).toFixed(2):1,
  ok:!total||criticalMissing.length===0};
}
