function decodeDnaFilename(name){try{return decodeURIComponent(name);}catch{return name;}}
const writingDnaView={mode:'links',urls:'',text:'',documents:[],filters:{},taskId:null,timer:null};
function writingDnaInput(text){
 const urls=collectionPasteUrls(text).split(/\s+/).filter(Boolean);const profile=urls.some(url=>{try{return new URL(url).pathname.startsWith('/user/');}catch{return false;}});
 if(profile&&urls.length!==1)throw Error('博主主页请单独输入，视频链接可以一次输入多个。');
 return {mode:profile?'profile':'links',urls:urls.join('\n'),purpose:'writing-dna',collectAll:profile,maxVideos:500,filters:writingDnaView.filters,fields:['title','url','author','publishedAt','transcript'],workflow:{transcribe:true,saveLibrary:false,syncFeishu:false,distill:true,confirmPaid:true,confirmModel:true}};
}
async function drawWritingDna(node){
 clearTimeout(writingDnaView.timer);
 node.classList.remove('account-report-detail');
 node.innerHTML=`<section class="panel spx-dna-form"><div class="tabs pipeline-tabs" role="tablist" aria-label="蒸馏来源"><button class="tab ${writingDnaView.mode==='links'?'active':''}" data-dna-mode="links" role="tab" aria-selected="${writingDnaView.mode==='links'}">视频链接</button><button class="tab ${writingDnaView.mode==='text'?'active':''}" data-dna-mode="text" role="tab" aria-selected="${writingDnaView.mode==='text'}">上传文案</button></div>${writingDnaView.mode==='links'?`<label for="dna-links">视频或博主主页链接</label><textarea class="textarea" id="dna-links" placeholder="粘贴抖音视频分享链接或博主主页链接">${esc(writingDnaView.urls)}</textarea><section class="collection-filter-panel"><h4>蒸馏条件</h4>${collectionFilterFields('dna',writingDnaView.filters)}</section>`:`<label for="dna-text">文案内容</label><textarea class="textarea" id="dna-text" placeholder="直接粘贴需要提炼写法的文案">${esc(writingDnaView.text)}</textarea><label for="dna-files">上传 Markdown／TXT 文件</label><input type="file" id="dna-files" accept=".md,.markdown,.txt" multiple><div id="dna-file-list" class="job-sub">${writingDnaView.documents.map(d=>esc(d.name)).join('、')}</div>`}<div class="actions"><button class="primary" id="dna-start">开始蒸馏灵魂</button></div><p id="dna-feedback" role="status"></p></section><div id="dna-progress"></div><div id="dna-history"></div>`;
 node.querySelectorAll('[data-dna-mode]').forEach(b=>b.onclick=()=>{writingDnaView.mode=b.dataset.dnaMode;drawWritingDna(node);});
 $('#dna-links')?.addEventListener('input',()=>{writingDnaView.urls=$('#dna-links').value;});$('#dna-text')?.addEventListener('input',()=>{writingDnaView.text=$('#dna-text').value;});
 $('#dna-files')?.addEventListener('change',async()=>{const files=[...$('#dna-files').files];try{if(files.some(f=>!(/\.(md|markdown|txt)$/i.test(f.name))||f.size>800000))throw Error('请上传每份不超过800KB的 Markdown／TXT 文件。');writingDnaView.documents=await Promise.all(files.map(async f=>({name:decodeDnaFilename(f.name),text:await f.text()})));const names=writingDnaView.documents.map(d=>d.name).join('、');$('#dna-file-list').textContent=names;try{const preview=await api('/api/studio/writing-dna/split-preview',{method:'POST',body:JSON.stringify({documents:writingDnaView.documents})});$('#dna-file-list').textContent=`${names} · 识别到 ${preview.count} 篇文案`;writingDnaView.splitCount=preview.count;}catch{$('#dna-feedback').textContent='已读取文件，但分篇预览失败，开始蒸馏时会重新识别。';}}catch(error){$('#dna-feedback').textContent=error.message;}});
 $('#dna-start').onclick=async()=>{const button=$('#dna-start');let startedTask=false;button.disabled=true;try{const textMode=writingDnaView.mode==='text';const payload=textMode?{text:writingDnaView.text,documents:writingDnaView.documents,confirmModel:true}:writingDnaInput(writingDnaView.urls);const task=await api(textMode?'/api/studio/writing-dna/import':'/api/studio/douyin/collect',{method:'POST',body:JSON.stringify(payload)});writingDnaView.taskId=task.id;startedTask=true;await updateWritingDna();}catch(error){$('#dna-feedback').textContent=error.message;}finally{if(button.isConnected)button.disabled=startedTask;}};
 bindCollectionFilters(node,'dna',writingDnaView.filters);
 await updateWritingDna();
 void loadWritingDnaHistory();
}
function dnaHistoryMarkup(items,page=1){
 const pages=Math.max(1,Math.ceil(items.length/10));page=Math.max(1,Math.min(page,pages));
 const label=v=>({succeeded:'已完成',running:'进行中',failed:'失败',unknown:'结果未知',paused:'已暂停',partial:'部分完成',pending:'未开始'}[v]||'未开始');
 const date=value=>{const d=new Date(value);return value&&!Number.isNaN(d.getTime())?d.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'—';};
 const rows=items.slice((page-1)*10,page*10);
 return `<section class="panel dna-history-panel"><div class="panel-head"><h3>历史蒸馏任务 <span class="dna-history-count">${items.length}</span></h3><button class="small-btn" id="dna-history-refresh">刷新</button></div><p id="dna-history-error" class="collection-error" role="alert"></p>${items.length?`<div class="pipeline-table-wrap"><table class="pipeline-table dna-history-table"><colgroup><col><col style="width:110px"><col style="width:72px"><col style="width:164px"><col style="width:104px"><col style="width:104px"><col style="width:144px"></colgroup><thead><tr><th>文案 / 来源</th><th>来源方式</th><th>篇数</th><th>创建时间</th><th>精读片段</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.map(t=>`<tr><td><span class="dna-history-title" title="${esc(decodeDnaFilename(t.title))}">${esc(decodeDnaFilename(t.title))}</span></td><td>${esc(t.mode==='text'?'上传文案':t.mode==='profile'?'博主主页':'视频链接')}</td><td>${t.count||'—'}</td><td class="dna-history-date">${esc(date(t.startedAt))}</td><td>${t.totalBatches?esc(t.completedBatches+' / '+t.totalBatches):'—'}</td><td><span class="dna-history-state ${['running','succeeded','failed','unknown','paused'].includes(t.dnaState)?t.dnaState:''}">${esc(label(t.dnaState))}</span></td><td><button class="small-btn" data-dna-report="${esc(t.id)}">${t.hasResult?'查看报告':'查看任务'}</button></td></tr>`).join('')}</tbody></table></div>${pages>1?`<div class="account-pagination dna-history-pagination"><button class="small-btn" id="dna-history-prev" ${page===1?'disabled':''}>上一页</button><span>${page} / ${pages}</span><button class="small-btn" id="dna-history-next" ${page===pages?'disabled':''}>下一页</button></div>`:''}`:'<div class="empty">还没有蒸馏任务</div>'}</section>`;
}
function drawDnaHistory(items){
 const host=$('#dna-history');if(!host)return;
 writingDnaView.historyPage=Math.max(1,Math.min(writingDnaView.historyPage||1,Math.ceil(items.length/10)||1));
 host.innerHTML=dnaHistoryMarkup(items,writingDnaView.historyPage);
 $('#dna-history-refresh').onclick=()=>loadWritingDnaHistory();
 host.querySelectorAll('[data-dna-report]').forEach(button=>button.onclick=()=>openWritingDnaReport(button.dataset.dnaReport));
 for(const [id,step] of [['dna-history-prev',-1],['dna-history-next',1]]){const button=$('#'+id);if(button)button.onclick=()=>{writingDnaView.historyPage+=step;drawDnaHistory(items);};}
}
async function loadWritingDnaHistory(){
 const host=$('#dna-history');if(!host)return;
 const sequence=(writingDnaView.historyRequest||0)+1;writingDnaView.historyRequest=sequence;
 const refresh=$('#dna-history-refresh');if(refresh){refresh.disabled=true;refresh.classList.add('is-loading');refresh.setAttribute('aria-busy','true');}
 try{
  const {items=[]}=await api('/api/studio/writing-dna/history');
  if($('#dna-history')!==host||douyinTab!=='dna'||writingDnaView.historyRequest!==sequence)return;
  drawDnaHistory(items);
 }catch(error){if(writingDnaView.historyRequest!==sequence||$('#dna-history')!==host)return;if(!$('#dna-history-error'))drawDnaHistory([]);$('#dna-history-error').textContent=error.message;}
 finally{if(writingDnaView.historyRequest===sequence){const current=$('#dna-history-refresh');if(current){current.disabled=false;current.classList.remove('is-loading');current.removeAttribute('aria-busy');}}}
}

async function updateWritingDna(){
 clearTimeout(writingDnaView.timer);if(state.view!=='douyin'||douyinTab!=='dna'||!$('#dna-progress'))return;
 try{
  if(!writingDnaView.taskId){const data=await api('/api/studio/douyin/tasks');writingDnaView.taskId=data.tasks.find(t=>t.request?.purpose==='writing-dna')?.id;}
  if(!writingDnaView.taskId)return;
  const data=await api('/api/studio/writing-dna/'+encodeURIComponent(writingDnaView.taskId)+'?view=progress');if(!$('#dna-progress')||douyinTab!=='dna')return;
  const {task,run}=data;const busy=task.state==='running'||task.workflow?.state==='running';$('#dna-start').disabled=busy;$('#dna-start').classList.toggle('is-loading',busy);$('#dna-start').setAttribute('aria-busy',String(busy));$('#dna-start').textContent=busy?'正在蒸馏…':'开始蒸馏灵魂';
  const stageLabels={articles:'逐篇精读',language:'语言 DNA',structure:'结构模板',cognition:'选题、素材与认知',prompt:'整合产物',replica:'盲写复刻',review:'复刻检查',complete:'已完成'};
  const stage=run?.progress;
  const extra={...task,logs:[stage?`${stageLabels[stage.phase]||stage.phase} · ${stage.completed}/${stage.total}${stage.title?' · '+stage.title:''}`:'',task.logs,run?.logs,run?.error,task.workflow?.error].filter(Boolean).join('\n')};
  preserveCollectionReading($('#dna-progress'),()=>{$('#dna-progress').innerHTML=collectionProgressLog(extra,data.stages||[])+(busy?'':`<div class="actions"><button class="small-btn" id="dna-view-report">查看任务</button>${task.workflow?.state==='paused'?`<button class="small-btn" data-workflow-resume="${esc(task.id)}">继续任务</button>`:''}</div>`);});
  $('#dna-view-report')?.addEventListener('click',()=>openWritingDnaReport(task.id));bindCollectionFlowButtons($('#dna-progress'));bindDouyinLogin($('#dna-progress'));
  if(busy)writingDnaView.timer=setTimeout(updateWritingDna,4000);
 }catch(error){if($('#dna-feedback'))$('#dna-feedback').textContent=error.message;}
}
async function openWritingDnaReport(id){
 try{const {task,run,stages=[]}=await api('/api/studio/writing-dna/'+encodeURIComponent(id));
  if(run?.state!=='succeeded'){
   showDetail('写作蒸馏',`<p>${esc(collectionStateLabel(run?.state||task.workflow?.state||task.state))}</p><pre class="detail-text">${esc([task.workflow?.error,run?.error,run?.logs,task.logs].filter(Boolean).join('\n'))}</pre>${stages.filter(s=>['unknown','partial'].includes(s.state)).map(s=>`<button class="small-btn" data-resolve-run="${esc(s.id)}">重新转写</button>`).join('')}${run?.state==='unknown'?`<button class="small-btn" data-resolve-run="${esc(run.id)}">查看运行记录</button>`:''}${!['running','unknown'].includes(run?.state)&&task.workflow?.state!=='running'?'<button class="primary" id="dna-restart">继续逐篇蒸馏</button>':''}`);bindDnaRestart(id);bindUnknownResolution();bindCollectionFlowButtons(document.querySelector('.detail-sheet'));return;
  }
  const name=run.corpus[0]?.author||'博主';const sample=run.corpus.length;const incomplete=run.coverage?.complete===false||task.request.mode==='profile'&&!run.coverage?.complete;
  showDetail('写作蒸馏 · '+name,writingDnaReportBody(task,run,name,sample,incomplete));
  document.querySelector('.detail-sheet')?.classList.add('dna-report-sheet');
  document.querySelectorAll('[data-dna-report-tab]').forEach(button=>button.onclick=()=>{
   document.querySelectorAll('[data-dna-report-tab]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-selected',String(b===button));});
   document.querySelectorAll('[data-dna-report-panel]').forEach(panel=>panel.hidden=panel.dataset.dnaReportPanel!==button.dataset.dnaReportTab);
  });
  bindDnaRestart(id);
  $('#dna-download')?.addEventListener('click',async()=>{const b=$('#dna-download');b.disabled=true;try{const response=await fetch('/api/studio/writing-dna/'+encodeURIComponent(id)+'/export');if(!response.ok)throw Error('下载失败，请重新登录后重试。');const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='Writing-DNA.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){toast(error.message,'error');}finally{b.disabled=false;}});
  $('#dna-save-prompt').onclick=async()=>{const b=$('#dna-save-prompt');b.disabled=true;try{const saved=await api('/api/studio/writing-dna/'+encodeURIComponent(id)+'/save',{method:'POST',body:JSON.stringify({name:$('#dna-prompt-name').value,prompt:$('#dna-prompt-result').value})});if(saved.template){const at=state.data.templates.findIndex(t=>t.id===saved.template.id);if(at>=0)state.data.templates[at]=saved.template;else state.data.templates.unshift(saved.template);}$('#dna-save-status').textContent=(saved.restored?'已重新启用该灵魂模板并更新内容（原模板曾被删除）。':saved.template?.dnaReport?`已保存：灵魂提示词 + ${Object.keys(saved.template.dnaReport).filter(k=>!['articles','sourceRunId','savedAt'].includes(k)).length} 段子内容（四份分层产物均参与写作，未验证视觉仅声明范围），写作工作台灵魂管理中可选择。`:'已保存，写作工作台的灵魂管理中可选择。');b.textContent='已保存到灵魂管理';}catch(error){$('#dna-save-status').textContent=error.message;b.disabled=false;}};
 }catch(error){toast(error.message,'error');}
}

function writingDnaReportBody(task,run,name,sample,incomplete){
 const quality=run.quality||{},validation=run.validation,labels={samples:'独立完整样本达到20篇',metadata:'逐篇标注覆盖全部语料',structureTypes:'实际覆盖至少3种体裁',propositions:'至少3条跨篇证据支持的命题',compactIntegration:'整合文档不超过4000字',replication:'模型辅助复刻评分达到7分'};
 const verdict={provisional:'样本暂定', 'needs-review':'仍有待验证项','text-checks-passed':'文字检查项通过'}[quality.verdict]||'旧版报告，未完成新版精读验收';
 const tab=(key,label,active=false)=>`<button class="tab ${active?'active':''}" role="tab" aria-selected="${active}" data-dna-report-tab="${key}">${label}</button>`;
 const nodes=(label,items)=>`<h4>${label}</h4>${items.map(n=>`<div class="dna-skeleton-node"><span>${esc(n.role)}</span><blockquote>${esc(n.quote)}</blockquote></div>`).join('')}`;
 return `<div class="spx-dna-report"><div class="dna-report-summary"><div><strong>${esc(verdict)}</strong><p>${sample} 篇原文 · ${run.articles?.length||0} 篇精读${sample<20?' · 未满20篇':''}${incomplete?' · 来源未确认采全':''} · 图片未分析</p></div><div class="actions">${run.specVersion!=='v4-per-article-evidence-20261104'?'<button class="small-btn" id="dna-restart">按新版重新蒸馏</button>':''}<button class="small-btn" id="dna-download">下载完整产物</button></div></div><div class="tabs" role="tablist" aria-label="蒸馏报告">${tab('prompt','灵魂提示词',true)}${tab('articles','逐篇精读')}${tab('artifacts','分层产物')}${tab('validation','复刻检查')}</div>
 <section data-dna-report-panel="prompt"><label for="dna-prompt-name">灵魂名称</label><input class="field" id="dna-prompt-name" maxlength="120" value="${esc(name+' · 写作风格')}"><label for="dna-prompt-result">Writing-DNA</label><textarea class="textarea" id="dna-prompt-result">${esc(run.result.prompt)}</textarea><button class="primary" id="dna-save-prompt" ${run.templateActive?'disabled':''}>${run.templateActive?'已保存到灵魂管理':'保存到灵魂提示词'}</button><p id="dna-save-status" role="status"></p></section>
 <section data-dna-report-panel="articles" hidden>${(run.articles||[]).map(article=>`<details class="dna-article"><summary>${esc(article.metadata?.title||article.id)} <small>${esc(article.metadata?.article_type)} · ${article.metadata?.word_count||0} 字</small></summary><p class="job-sub">${esc(article.metadata?.date||'日期未知')} · ${esc((article.metadata?.topic_tags||[]).join('、'))}</p>${nodes('开头',[article.structure.opening])}${nodes('转折',article.structure.turns||[])}${nodes('正文推进',article.structure.body||[])}${nodes('结尾',[article.structure.ending])}${article.parts.some(p=>p.rejectedPatterns?.length)?`<details><summary>已排除的未核实观察 · ${article.parts.reduce((n,p)=>n+(p.rejectedPatterns?.length||0),0)} 条</summary>${article.parts.flatMap(p=>p.rejectedPatterns||[]).map(p=>`<blockquote>${esc(p.quote)}</blockquote><p class="job-sub">${esc(p.reason)}</p>`).join('')}</details>`:''}${article.parts.map(part=>`<details><summary>第 ${part.part} 段阅读笔记</summary>${[['语言观察','languageObservations'],['选题逻辑','topicLogic'],['素材策略','materialStrategy'],['认知框架','cognitiveFrame']].map(([label,key])=>`<h4>${label}</h4><pre class="detail-text">${esc(part[key])}</pre>`).join('')}</details>`).join('')}<details><summary>完整原文</summary><pre class="detail-text">${esc(run.corpus.find(d=>d.id===article.id)?.content||'')}</pre></details></details>`).join('')||'<p>旧版结果没有逐篇精读记录，请用新版重新蒸馏。</p>'}</section>
 <section data-dna-report-panel="artifacts" hidden>${[['语言DNA.md','language'],['文章结构模板.md','structure'],['写作视角与认知框架.md','cognition'],['视觉风格指南.md','visual']].map(([label,key])=>`<details><summary>${label}</summary><pre class="detail-text">${esc(run.result[key])}</pre>${(run.layers?.[key]?.rules||[]).map(rule=>`<article class="dna-rule"><strong>${esc(rule.statement)}</strong><p>${esc(rule.scope)} · ${rule.supportArticles||1} 篇支持</p>${rule.supports.map(e=>`<blockquote>${esc(e.quote)}<small>${esc(run.corpus.find(d=>d.id===e.articleId)?.title||e.articleId)}</small></blockquote>`).join('')}${rule.counterexamples?.length?'<h4>反例</h4>'+rule.counterexamples.map(e=>`<blockquote>${esc(e.quote)}</blockquote>`).join(''):''}</article>`).join('')}</details>`).join('')}<details><summary>脚本统计（含名词、动词、副词）</summary><pre class="detail-text">${esc(JSON.stringify(run.stats,null,2))}</pre></details></section>
 <section data-dna-report-panel="validation" hidden><ul class="dna-checks">${Object.entries(quality.checks||{}).map(([key,ok])=>`<li class="${ok?'passed':'pending'}">${ok?'通过':'待验证'} · ${esc(labels[key]||key)}</li>`).join('')}</ul>${validation?`<h4>模型辅助自检 ${validation.score}/10</h4><p class="job-sub">这是两次独立请求的盲写与对照检查，尚未经过人工验收。</p><div class="dna-score-grid">${Object.entries(validation.scores).map(([key,value])=>`<span>${esc({language:'语言',structure:'结构',topic:'选题',materials:'素材',cognition:'认知'}[key]||key)} <strong>${value}/10</strong></span>`).join('')}</div><details><summary>盲写成稿</summary><pre class="detail-text">${esc(validation.replica)}</pre></details>${validation.findings.map(f=>`<article class="dna-rule"><blockquote>${esc(f.replicaQuote)}</blockquote><p>${esc(f.reason)}</p><blockquote>${esc(f.reference.quote)}</blockquote></article>`).join('')}<p class="job-sub">${esc(validation.limitations.join('；'))}</p>`:'<p>这份旧报告没有实际复刻检查记录。</p>'}</section><p class="job-sub"><a href="https://github.com/larashero3-dotcom/writing-dna-skill" target="_blank" rel="noopener noreferrer">Writing DNA Skill</a> · ${esc(run.method?.commit?.slice(0,12)||'旧版方法')}</p></div>`;
}

function bindDnaRestart(id){
 const button=$('#dna-restart');if(!button)return;
 button.onclick=async()=>{button.disabled=true;button.classList.add('is-loading');try{await api('/api/studio/writing-dna/'+encodeURIComponent(id)+'/restart',{method:'POST',body:JSON.stringify({confirmModel:true})});writingDnaView.taskId=id;document.querySelector('.detail-sheet')?._close?.();douyinTab='dna';state.view='douyin';await openDouyinWorkspace();}catch(error){toast(error.message,'error');button.disabled=false;button.classList.remove('is-loading');}};
}
