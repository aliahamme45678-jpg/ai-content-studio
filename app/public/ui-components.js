/* Shared range controls and submission feedback. */
// 展示名 → 技能 id 的唯一映射表（与后端 workflow.mjs skillAliases 保持一致，禁止再复制一份）
const SKILL_ALIASES={'AI 味检查':'dbs-ai-check','发布风险':'dbs-content-risk-check','共鸣检查':'dbs-resonate','口播流畅度':'dbs-script-flow','结构检查':'dbs-content-value'};
function collectionFilterFields(prefix,filters={}){
 return `<div class="spx-filter-grid">${[['Digg','点赞数'],['Collect','收藏数'],['Comment','评论数'],['Share','转发数'],['PlayCount','播放量']].map(([key,label])=>`<fieldset class="spx-range"><legend>${label}</legend><div><input class="field" type="number" min="0" step="1" aria-label="${label}最低" placeholder="最低" data-filter-group="${prefix}" data-collection-filter="min${key}" value="${filters['min'+key]??''}"><span>—</span><input class="field" type="number" min="0" step="1" aria-label="${label}最高" placeholder="不限" data-filter-group="${prefix}" data-collection-filter="max${key}" value="${filters['max'+key]??''}"></div></fieldset>`).join('')}</div>`;
}
function bindCollectionFilters(root,prefix,filters){root.querySelectorAll(`[data-filter-group="${prefix}"]`).forEach(input=>input.addEventListener('input',()=>{if(input.value==='')delete filters[input.dataset.collectionFilter];else filters[input.dataset.collectionFilter]=Number(input.value);}));}
// Same character-window duplicate-rate logic as Hermes server.js.
function writerTextSimilarity(original,output){
 const normalize=value=>String(value||'').replace(/^标题[:：].*$/gm,'').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g,'').toLowerCase();
 const raw=normalize(original),value=normalize(output);if(!raw||!value)return null;if(value.length<16)return raw.includes(value)?100:0;
 const size=value.length>=80?4:2,windows=new Set();for(let i=0;i<=raw.length-size;i++)windows.add(raw.slice(i,i+size));let hit=0,total=0;for(let i=0;i<=value.length-size;i++){total++;if(windows.has(value.slice(i,i+size)))hit++;}return total?Math.round(hit/total*100):0;
}
function mountWriterSimilarity(){
 const root=document.querySelector('#content-workbench'),footer=root?.querySelector('.fw-result-footer');if(!footer)return;
 const label=document.createElement('span');label.id='fw-similarity';label.title='沿用 Hermes 原项目的连续字符窗口重合率；仅表示文字重复程度';footer.append(label);
 const update=()=>{const result=writerTextSimilarity(document.querySelector('#fw-original')?.value,document.querySelector('#fw-output')?.value);label.textContent=result===null?'':`原文相似度 ${result}%`;};root.addEventListener('input',update);update();
}
function startSubmissionFeedback(button){
 if(!button||!button.isConnected)return ()=>{};
 button._pendingCount=(button._pendingCount||0)+1;button.classList.add('is-loading');button.setAttribute('aria-busy','true');
 return ()=>{button._pendingCount--;if(!button._pendingCount){button.classList.remove('is-loading');button.removeAttribute('aria-busy');}};
}
if(typeof document!=='undefined'){
 const pickerSelector='#content-workbench .fw-top-settings .fw-settings-knowledge,#content-workbench .fw-top-settings .fw-hook-picker>details';
 document.addEventListener('click',event=>{document.querySelectorAll(pickerSelector).forEach(p=>{if(p.open&&!p.contains(event.target))p.open=false;});});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll(pickerSelector).forEach(p=>{if(p.open){p.open=false;p.querySelector('summary')?.focus();}});});
 let clicked=null;document.addEventListener('click',event=>{clicked=event.target.closest('button');queueMicrotask(()=>clicked=null);},true);
 globalThis.submissionFeedback=()=>startSubmissionFeedback(clicked);
 const annotate=root=>{for(const node of root.querySelectorAll('.tag,.status,.account-run-status,.collection-flow-status>strong,[role="status"]')){const text=node.textContent.trim();const active=/^(进行中|运行中|处理中|生成中|排队中|已提交|正在|AI 正在|自动流程：.*处理中)/.test(text)&&!/(失败|已完成|已暂停|待核对|未知)/.test(text);node.classList.toggle('task-loading',active);}};
 if(typeof MutationObserver!=='undefined'){const observer=new MutationObserver(()=>annotate(document));observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});}
}
