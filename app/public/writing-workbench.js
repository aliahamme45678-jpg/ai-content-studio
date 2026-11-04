const fullWriter = { mode:'rewrite', jobId:null, options:{}, drafts:{rewrite:{},topic:{}} };
try { const saved=JSON.parse(sessionStorage.getItem('studio-writer-drafts')||'null');if(saved&&['rewrite','topic'].includes(saved.mode)&&saved.drafts?.rewrite&&saved.drafts?.topic){Object.assign(fullWriter,saved);delete fullWriter.busy;delete fullWriter.lockedDraft;} } catch {}
function rememberWriterSession(){try{sessionStorage.setItem('studio-writer-drafts',JSON.stringify({mode:fullWriter.mode,jobId:fullWriter.jobId,options:fullWriter.options,drafts:fullWriter.drafts,recoveryDrafts:fullWriter.recoveryDrafts||{}}));}catch{}}
function freshWriterDraft(draft,original='',title=''){
  return {...draft,jobId:null,title,recordTitle:'',original,output:'',baseBody:undefined,dirty:false,options:{},durationSeconds:''};
}
function resetWriterPage({original='',title='',draft=fullWriterDraft()}={}){
  if(fullWriter.busy)return;
  clearTimeout(fullWriter.reviewTimer);
  fullWriter.jobId=null;state.jobId=null;state.view='home';
  fullWriter.options={};fullWriter.resultView='draft';fullWriter.recoveryDrafts={};
  fullWriter.drafts[fullWriter.mode]=freshWriterDraft(draft,original,title);
  try{sessionStorage.removeItem('studio-current-writer');}catch{}
  rememberWriterSession();render();
}
// 后台生成/重跑产生了新版本时，本地缓存不能继续盖住服务端正文：
// 只有「草稿基于当前这版正文」才保留本地修改，否则把草稿收进“未保存草稿”，页面显示服务端最新版
function protectChangedWriterBody(job,cached){
 if(!job||!cached?.dirty||cached.jobId!==job.id)return;
 const sameBase=typeof cached.baseBody==='string'&&cached.baseBody===job.body;
 if(sameBase)return;
 fullWriter.recoveryDrafts||={};
 fullWriter.recoveryDrafts[job.id]={...cached};
 cached.dirty=false;
}
function writerAuditIds(template){return (template.auditSkills||template.audits||[]).map(id=>SKILL_ALIASES[id]||id);}

function openFullWriter(options={}) {
  options={...state.data.templates?.find(t=>t.id===options.templateId)?.writingOrigin,...options};
  fullWriter.mode=options.mode==='rewrite'?'rewrite':'topic';
  const materialIds=options.materialIds||[];
  const existing=materialIds.length&&state.data.jobs.find(job=>job.originalBody&&!['已定稿','已发布','已取消'].includes(job.status)&&materialIds.every(id=>(job.materialIds||job.sourceIds)?.includes(id)));
  if(existing){fullWriter.jobId=existing.id;fullWriter.options={...existing.writingOrigin,...options};state.jobId=existing.id;state.view='studio';document.querySelector('.detail-sheet')?.remove();render();return;}
  fullWriter.jobId=null;fullWriter.options=options;
  fullWriter.drafts[fullWriter.mode]={title:options.title||'',original:options.original||'',output:'',templateId:options.templateId||null,auditSkills:options.auditSkills,auditEngine:options.auditEngine||'model'};
  state.jobId=null;state.view='home';rememberWriterSession();document.querySelector('.detail-sheet')?.remove();render();
}

function fullWriterDraft() {
  if(fullWriter.busy&&fullWriter.lockedDraft)return {...fullWriter.lockedDraft};
  const current=fullWriter.drafts[fullWriter.mode];
  return {...current,...writerStyleValues(current),recordTitle:$('#fw-record-title')?.value??current.recordTitle??'',title:$('#fw-title')?.value??current.title??'',original:$('#fw-original')?.value??current.original??'',
    output:$('#fw-output')?.value??current.output??'',instruction:'',
    templateId:$('#fw-template')?.value??current.templateId,hook:'',durationSeconds:'',
    scope:current.scope||'template',
    knowledgeSetIds:[...document.querySelectorAll('[data-fw-set]:checked')].map(i=>i.dataset.fwSet),
    documentIds:[...new Set([...document.querySelectorAll('[data-fw-library]:checked')].flatMap(i=>JSON.parse(i.dataset.fwLibrary)))],
    auditSkills:state.data.integration?.auditConfig?.skills||current.auditSkills||[...document.querySelectorAll('[data-fw-audit]:checked')].map(el=>el.value),
    auditEngine:'model',engine:'studio'};
}

function renderFullWriter(selectedJob) {
  if(selectedJob){const same=fullWriter.jobId===selectedJob.id;fullWriter.jobId=selectedJob.id;fullWriter.mode=selectedJob.originalBody?'rewrite':'topic';fullWriter.options={...selectedJob.writingOrigin,...(same?fullWriter.options:{})};}
  const job=state.data.jobs.find(j=>j.id===fullWriter.jobId);
  const mode=job?(job.originalBody?'rewrite':'topic'):fullWriter.mode;fullWriter.mode=mode;
  const cached=fullWriter.drafts[mode];
  // Recover tabs created before source changes detached the previous writing job.
  if(job&&cached.dirty&&cached.jobId===job.id&&
    (mode==='rewrite'?cached.original!==undefined&&cached.original!==(job.originalBody||''):cached.title!==undefined&&cached.title!==(job.topic||job.title))){
    fullWriter.jobId=null;state.jobId=null;fullWriter.options={};fullWriter.resultView='draft';
    fullWriter.drafts[mode]=freshWriterDraft(cached,cached.original||'',mode==='topic'?cached.title||'':'');
    try{sessionStorage.removeItem('studio-current-writer');}catch{}
    rememberWriterSession();return renderFullWriter();
  }
  protectChangedWriterBody(job,cached);
  const recovery=job&&fullWriter.recoveryDrafts?.[job.id];
  const draft=job&&!(cached.dirty&&cached.jobId===job.id)?{...cached,title:mode==='topic'?(job.topic||job.title):job.title,recordTitle:job.topic!==undefined?job.title:'',original:job.originalBody||'',output:job.body||'',instruction:job.writingInstruction||'',templateId:job.templateVersionId,
    scope:job.knowledgeSetIds!==undefined||job.documentIds!==undefined?'selected':'template',knowledgeSetIds:job.knowledgeSetIds||[],documentIds:job.documentIds||[],...Object.fromEntries(writerStyleKeys.map(key=>[key,job[key]??''])),auditSkills:job.auditSkills,auditEngine:job.auditEngine||'local',engine:job.writingEngine||cached.engine||'studio'}:cached;
  const active=state.data.templates.filter(t=>(t.active||t.id===draft.templateId)&&((mode==='topic'?['topic','other']:['writing','other']).includes(promptCategory(t))));
  const preferred=fullWriter.options.format==='视频口播'?'视频口播':fullWriter.options.format==='X Thread'?'Thread':'短帖';
  const template=active.find(t=>t.id===draft.templateId)||active.find(t=>t.kind===preferred)||active[0]||{};
  draft.templateId=template.id;draft.jobId=job?.id||null;if(job&&!draft.dirty){draft.hook=job.hook||'';draft.durationSeconds=job.durationSeconds||'';}fullWriter.drafts[mode]=draft;
  const ready=state.data.hermesStatus?.mode==='ready';
  const refs=job?(Array.isArray(job.sourceSnapshot)?job.sourceSnapshot:job.sourceSnapshot?[job.sourceSnapshot]:[]):
    [...(fullWriter.options.sourceId?[state.data.sources.find(s=>s.id===fullWriter.options.sourceId)].filter(Boolean):[]),...(fullWriter.options.materialIds||[]).map(id=>state.data.documents.find(d=>d.id===id)).filter(Boolean).map(d=>({title:d.name,source:d.source}))];
  const auditRun=job&&state.data.auditRuns.find(r=>r.jobId===job.id);
  const auditCurrent=auditRun&&!draft.dirty&&['待人工确认','已定稿','已发布'].includes(job.status);
  const issues=job?state.data.auditIssues.filter(i=>i.jobId===job.id&&i.status!=='已归档'):[];
  const versions=job?state.data.versions.filter(v=>v.jobId===job.id):[];
  const aliases=SKILL_ALIASES;
  const enabled=(state.data.integration?.auditConfig?.skills||['dbs-ai-check','dbs-content-risk-check']).map(s=>aliases[s]||s);
  shell('','',`<div id="content-workbench">
    
    ${fullWriter.options.returnAccountTaskId||fullWriter.options.returnCollectionTaskId?`<button class="small-btn" id="fw-back-account">${fullWriter.options.returnAccountTaskId?'← 返回博主作品，换一篇':'← 返回采集任务'}</button>`:''}
    ${writingFlowSummary(job,draft,template)}<div class="fw-heading"><div><h2>${mode==='rewrite'?'把原稿改成你想要的文案':'从一个选题开始写文案'}</h2><p>${mode==='rewrite'?'左侧设置写法，中间查看文案，右侧勾选审核意见后改写。':'输入你要表达的主题，选择模板和知识库，生成一篇可编辑的文案。'}</p></div><div class="fw-heading-actions"><div class="fw-mode-switch" role="tablist" aria-label="文案模式"><button role="tab" aria-selected="${mode==='rewrite'}" data-fw-mode="rewrite">原稿改写</button><button role="tab" aria-selected="${mode==='topic'}" data-fw-mode="topic">选题生成</button></div></div></div>
    <div class="fw-work-grid">
      <section class="panel fw-input-panel"><div class="fw-panel-title"><div><span class="fw-step">01</span><h3>${mode==='rewrite'?'原始文案':'选题与要求'}</h3></div><span class="tag">输入</span></div>
        ${mode==='topic'?`<label class="fw-label" for="fw-title">你想写什么</label><textarea class="fw-topic-input" id="fw-title" placeholder="例如：普通商家怎样用 AI 改善商品介绍？">${esc(draft.title||'')}</textarea>`:''}

        ${mode==='rewrite'?`<label class="fw-label" for="fw-original">粘贴原文案</label><textarea id="fw-original" class="fw-original-input" placeholder="把需要改写的原始文案粘贴到这里…">${esc(draft.original||'')}</textarea><div class="fw-input-footer"><span id="fw-original-count">${(draft.original||'').length} 字</span><span>原稿单独保留</span></div>`:'<div class="fw-topic-hint">可以是一句话、一个观点，或想回答的具体问题。</div>'}

        <button class="primary fw-generate" id="fw-generate">${mode==='rewrite'?'开始改写':'开始生成'} <span aria-hidden="true">→</span></button><p id="fw-feedback" role="status" class="fw-feedback"></p>
      </section>
      <section class="panel fw-result-panel"><div class="fw-panel-title"><div><span class="fw-step">02</span><h3>生成结果</h3></div><span id="fw-result-status" class="tag">${esc(draft.dirty?'有未保存修改':job?.status||'等待生成')}</span></div>
        <div class="fw-result-title">${esc(job?.title||'')}</div><textarea class="fw-output" id="fw-output" aria-label="生成文案" placeholder="生成文案">${esc(draft.output||'')}</textarea>
        ${hookWritingEvidence(job)}<div class="fw-result-footer"><span id="fw-output-count">${(draft.output||'').length} 字</span><span>${versions.length} 个保存版本</span></div>
        ${recovery?`<details class="fw-details"><summary>另有一份未保存草稿，后台正文已更新</summary><p>为避免覆盖已采用的修改，当前显示后台版本。旧草稿仍保留在这里。</p><pre class="detail-text">${esc(recovery.output||'')}</pre><button class="small-btn" id="fw-recover-local">把这份草稿恢复到编辑区</button></details>`:''}<div class="fw-result-actions"><button class="small-btn" id="fw-save">保存文案</button><button class="small-btn" id="fw-copy">复制文案</button><button class="small-btn" id="fw-to-review">运行 dont 检查 ↓</button></div>
        <details class="fw-details"><summary>局部改写</summary><div class="actions"><select class="field" id="fw-section" aria-label="局部重构范围"><option value="opening">重写开头</option><option value="body">重写中间内容</option><option value="ending">重写结尾</option></select><textarea class="textarea" id="fw-section-instruction" placeholder="输入本次局部改写要求"></textarea><button class="small-btn" id="fw-section-run" ${!job?.body?'disabled':''}>生成局部修改</button><button class="small-btn" id="fw-history" ${!versions.length?'disabled':''}>查看保存版本</button></div><p class="job-sub">局部重构会生成新版本，其余段落保留。</p></details>
      </section>
      <aside class="panel fw-settings-panel"><div class="fw-panel-title"><div><h3>这次怎么写</h3></div><span class="fw-settings-caption">写作配置</span></div>
        <label class="fw-label" for="fw-template">${mode==='topic'?'话题生文提示词':'写作提示词'}</label><select class="field" id="fw-template">${active.map(t=>`<option value="${esc(t.id)}" ${t.id===template.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select><p id="fw-template-note" class="fw-setting-note">${esc(template.kind||'')} · ${esc(template.version||'')}</p>
        <div id="fw-style-fields">${writerStyleFields(draft,template)}</div><div class="fw-setting-divider"></div><div class="fw-setting-heading"><label class="fw-label" >使用的知识库</label><button class="link fw-text-button" data-view="library">管理</button></div>
        <div id="fw-knowledge-picker">${writerLibraryChoices(draft)}</div>

        <div class="fw-setting-divider"></div><div id="fw-model-settings"></div>
      </aside>
    </div>
    <section class="panel fw-review-panel" id="fw-review"><div class="fw-review-heading"><div><div class="fw-panel-title"><div><span class="fw-step">03</span><h3>dontbesilent 检查与修改</h3></div></div><p>选择方法后点击检查；结果会显示原句、原因和改法，由你决定是否采用。</p></div><div class="actions"><select class="field" id="fw-audit-engine" aria-label="检查方式"><option value="local" ${draft.auditEngine==='local'?'selected':''}>本地规则快检（不执行 dont 方法）</option><option value="model" ${draft.auditEngine!=='local'?'selected':''}>dontbesilent 方法 + 当前模型</option></select><button class="primary" id="fw-audit">运行所选检查方法</button><button class="small-btn blue" id="fw-finalize" ${draft.dirty||!job||!auditRun||issues.some(i=>['待处理','待重新验证'].includes(i.status))||!['待人工确认','已定稿'].includes(job.status)?'disabled':''}>保存定稿</button></div></div>
      <p id="fw-review-feedback" class="fw-feedback" role="status" aria-live="polite"></p><div class="fw-audit-choices">${Object.entries(workflowSkillLabels).filter(([id])=>id!=='dbs-spread').map(([id,label])=>`<label><input type="checkbox" value="${id}" data-fw-audit ${enabled.includes(id)?'checked':''} ${template.kind!=='视频口播'&&['dbs-script-flow','dbs-title-cover-intro'].includes(id)?'disabled':''}>${label}</label>`).join('')}</div>
      <p class="fw-method-notice">dontbesilent 用来检查文案，不负责采集或语音转写。“方法 + 当前模型”会读取所选 dbskill 方法文档，给出原句定位和修改建议；本地快检只做基础规则检查。<details><summary>方法来源与执行范围</summary>来源：dontbesilent2025/dbskill · CC BY-NC 4.0。这里运行方法文档辅助的模型检查，未执行原 Skill 的完整工具流程。</details></p>
      ${auditRun?`<p class="fw-method-notice" id="fw-audit-stale" ${auditCurrent?'hidden':''}>以下是上一版检查记录；正文或写作配置已变化，请重新检查后再定稿。</p>`:''}<div id="fw-review-results">${writerAuditFailure(job)}${writerRevisionPanel(job,auditCurrent,issues)}${auditRun?`<div class="fw-audit-summary">${esc(auditRun.summary||`已完成${auditRun.engine==='skill-guided-model'?'模型诊断':'本地快检'}`)} · ${issues.filter(i=>i.status==='待处理').length} 处待处理<br>本次已执行：${(auditRun.skills||[]).filter(s=>workflowSkillLabels[s]).map(s=>esc(workflowSkillLabels[s])).join('、')||'基础规则检查'} · ${auditRun.engine==='skill-guided-model'?'dont 方法文档 + 模型':'本地规则'}</div>${issues.map(issue=>`<article class="fw-issue"><div><span class="tag">${esc(issue.status)}</span><strong>${esc(workflowSkillLabels[issue.skill]||'文字检查')}</strong></div><blockquote>${esc(issue.quote||'正文内容')}</blockquote><p>${esc(issue.explanation)}</p><p class="fw-suggestion">${esc(issue.suggestion||'')}</p>${issue.status==='待处理'?`<label><input type="checkbox" data-fw-revise-issue="${esc(issue.id)}" checked ${auditCurrent?'':'disabled'}> 认同这条意见，纳入改写</label><textarea aria-label="替换文字" placeholder="填写替换文字，留空表示删除该句" data-fw-replacement="${esc(issue.id)}">${esc(issue.replacement??'')}</textarea><div class="actions"><button class="small-btn blue" data-fw-apply="${esc(issue.id)}">${issue.replacement===''?'删除这处文字':'采用这一处修改'}</button><button class="small-btn" data-fw-ignore="${esc(issue.id)}" ${issue.blocking?'disabled':''}>忽略建议</button></div>`:''}</article>`).join('')||`<div class="fw-review-empty">${auditCurrent?'未发现需要修改的问题，可以保存定稿。':'已有检查记录不适用于当前版本，请重新运行检查。'}</div>`}`:writerAuditFailure(job)?'':'<div class="fw-review-empty">点击上方「检查文案」，这里显示检查意见。</div>'}</div>
    </section>
    <div class="fw-bottom-links"><button class="fw-text-button link" data-view="archive">查看已保存的作品</button>${job?`<span>当前稿件已关联来源与版本</span>`:''}</div>
    </div>`);
  mountWriterReview(job,auditCurrent,issues);bindFullWriter(job);bindWriterStyle();bindWritingFlow();bindUnknownResolution();
}

// 生成依据：只读本次任务已落库的回执（开头检索、主写作方法、知识库用途、原稿要点、成稿校验）
function hookWritingEvidence(job){
  const version=(state.data.versions||[]).find(v=>v.jobId===job?.id&&(v.hookSources||v.hookPlan||v.hookValidation||v.coverage||v.writingKnowledge));
  if(!version)return '';
  const hook=version.hookSources||null,validation=version.hookValidation||null,dna=version.writingDna||null,coverage=version.coverage||null,knowledge=version.writingKnowledge||null;
  const rows=[];
  if(hook)rows.push(['开头检索',hook.hit?`命中 ${hook.count||0} 条 · ${hook.mode==='label'?'类型标签':hook.mode==='semantic'?'语义匹配':'未匹配'}${hook.type?` · ${hook.type}`:''}`:`未命中 · ${hook.reason||'按写作方法原创'}`]);
  if(dna?.route)rows.push(['主写作方法',dna.route==='dna'?'写作 DNA（灵魂）':'写作 Prompt']);
  if(knowledge)rows.push(['知识库用途',`内容素材 ${knowledge.body||0} 段 · 同行写法 ${knowledge.craft||0} 条${knowledge.configured?'':' · 本次未选择知识库'}`]);
  if(coverage)rows.push(['原稿要点',`关键事实 ${Math.round((coverage.criticalCoverage??1)*100)}%${coverage.criticalMissing?.length?` · 缺 ${coverage.criticalMissing.length} 条`:''} · 表述细节 ${Math.round((coverage.coverage??1)*100)}%`]);
  if(validation)rows.push(['成稿校验',validation.finalPassed?'通过':validation.needsHumanReview?'需人工确认':'未通过']);
  if(!rows.length)return '';
  const review=(validation?.reviewIssues||[]).slice(0,3);
  return `<details class="fw-details"><summary>本次生成依据</summary><div class="job-sub">${rows.map(([label,value])=>`<p>${esc(label)}：${esc(value)}</p>`).join('')}</div>${review.length?`<ul>${review.map(item=>`<li>${esc(String(item))}</li>`).join('')}</ul>`:''}</details>`;
}
function writerAuditFailure(job){
  const run=job&&(state.data.taskRuns||[]).find(r=>r.jobId===job.id&&r.taskKind==='model-audit');
  if(!run||!['unknown','failed'].includes(run.state))return '';
  const detail=String(run.httpFailure?.detail||'');
  const httpReason=/INSUFFICIENT_BALANCE|Insufficient account balance/i.test(detail)?'模型服务余额不足（403），不是检查方法的问题。':/401|Unauthorized|invalid.?api.?key/i.test(detail)||run.httpFailure?.status===401?'模型密钥无效或已过期（401）。':run.httpFailure?`模型服务返回 HTTP ${run.httpFailure.status}${detail?'：'+detail.slice(0,120):''}。`:'';
  const reason=/timeout|aborted/i.test(run.error||'')?'模型检查超时，没有收到结果。':run.error==='fetch failed'?'模型连接中断，没有收到检查结果。':httpReason||'模型检查没有完成。';
  return `<div class="fw-review-error" role="status"><strong>${esc(reason)}</strong><p>原稿已保留。${run.state==='unknown'?'本次检查未完成。':/余额不足|密钥无效/.test(reason)?'请在「连接和设置 → 模型档案」里充值该模型服务或把检查用途切到有余额的模型，然后重试。':'请查看记录或调整检查方法后再试。'}</p><button class="small-btn" data-resolve-run="${esc(run.id)}">查看检查记录</button></div>`;
}
function pollWriterReview(jobId,runId){
  clearTimeout(fullWriter.reviewTimer);
  fullWriter.reviewTimer=setTimeout(async()=>{if(!$('#content-workbench')||fullWriter.jobId!==jobId)return;try{const run=await api(`/api/studio/task-runs/${runId}/receipt`);if(run.state==='running')pollWriterReview(jobId,runId);else await refreshFullWriter(jobId);}catch(error){const status=$('#fw-review-feedback');if(status)status.textContent=error.message;}},3000);
}

function showWriterResult(view){
  const draft=$('#fw-draft-pane'),candidate=$('#fw-candidate-pane');
  fullWriter.resultView=view;
  if(draft)draft.hidden=Boolean(candidate&&view!=='draft');
  if(candidate)candidate.hidden=view==='draft';
  document.querySelectorAll('[data-fw-result-view]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.fwResultView===(candidate&&view!=='draft'?'revision':'draft'))));
  const save=$('#fw-save');if(save)save.hidden=Boolean(candidate&&view!=='draft');
}
function startWriterReview(){
  if(fullWriter.busy)return;
  const button=$('#fw-audit');if(button&&!button.disabled)button.click();
}
function layoutWriterSettingFields(){
  const root=document.querySelector('.fw-top-settings');if(!root)return;
  const library=root.querySelector('#fw-knowledge-picker .fw-knowledge-list');
  if(library&&!library.closest('.fw-settings-knowledge')){
    const field=document.createElement('div');field.className='fw-setting-field fw-knowledge-field';
    const label=document.createElement('span');label.className='fw-label';label.textContent='知识库';
    const picker=document.createElement('details');picker.className='fw-settings-knowledge';
    const summary=document.createElement('summary');picker.append(summary);library.before(field);field.append(label,picker);picker.append(library);
    const update=()=>{const count=library.querySelectorAll('input:checked').length;summary.textContent=count?`已选 ${count} 个`:'不使用知识库';};library.addEventListener('change',update);update();
  }
  const method=root.querySelector('#fw-style-fields [aria-label="写法来源"]');
  if(method){root.querySelector('.fw-method-switch')?.remove();method.classList.add('fw-method-switch');root.querySelector('.fw-top-settings-head h3').after(method);}
  root.querySelectorAll('.fw-settings-fields > label, #fw-style-fields > label, #fw-video-fields > label, #fw-model-settings > label').forEach(label=>{
    const control=label.nextElementSibling;if(!control?.matches('input,select,textarea'))return;
    const field=document.createElement('div');field.className='fw-setting-field';label.before(field);field.append(label,control);
    if(control.id==='fw-duration-mode'&&document.querySelector('#fw-duration'))field.append(document.querySelector('#fw-duration'));
  });
  // Put complete label/control pairs in the grid; switches and hidden headings never take a cell.
  const ids=['fw-template','fw-soul','fw-hook-type','fw-copy-type','fw-word-count'];
  ids.forEach((id,index)=>{const field=root.querySelector('#'+id)?.closest('.fw-setting-field');if(field)field.style.order=index;});
  const knowledge=root.querySelector('.fw-knowledge-field');if(knowledge)knowledge.style.order=5;
  root.querySelectorAll('#fw-model-settings .fw-setting-field').forEach(field=>field.style.order=6);
  root.querySelectorAll('#fw-video-fields .fw-setting-field').forEach(field=>field.style.order=7);
}

function mountWriterReview(job,current,issues){
  const grid=document.querySelector('.fw-work-grid'),panel=grid?.querySelector('.fw-result-panel'),input=grid?.querySelector('.fw-input-panel'),settings=grid?.querySelector('.fw-settings-panel'),review=$('#fw-review');if(!panel||!review)return;
  // Settings sit above three independent comparison columns.
  input.querySelector('h3').textContent=fullWriter.mode==='topic'?'选题':'原文';
  const generate=$('#fw-generate'),feedback=$('#fw-feedback');
  const original=document.createElement('div');original.className='fw-original-details';
  while(input.children.length>1)original.append(input.children[1]);
  const settingsFields=document.createElement('div');settingsFields.className='fw-settings-fields';
  settings.querySelector('.fw-panel-title')?.remove();while(settings.firstChild)settingsFields.append(settings.firstChild);
  const video=$('#fw-video-fields');if(video)settingsFields.prepend(video);
  const knowledge=settingsFields.querySelector('.fw-knowledge-list');
  if(knowledge){const picker=document.createElement('details');picker.className='fw-settings-knowledge';const summary=document.createElement('summary');summary.textContent='选择知识库';picker.append(summary);const field=document.createElement('div');field.className='fw-setting-field fw-knowledge-field';field.innerHTML='<span class="fw-label">知识库</span>';knowledge.before(field);field.append(picker);picker.append(knowledge);const updateKnowledge=()=>{const count=knowledge.querySelectorAll('input:checked').length;summary.textContent=count?`已选 ${count} 个`:'不使用知识库';};knowledge.addEventListener('change',updateKnowledge);updateKnowledge();settingsFields.querySelector('.fw-setting-heading')?.remove();}
  const top=document.createElement('section');top.className='panel fw-top-settings';top.setAttribute('aria-label','写作设置');
  const topHead=document.createElement('div');topHead.className='fw-top-settings-head';topHead.innerHTML='<h3>写作设置</h3><button type="button" class="small-btn" id="fw-clear">一键清空</button>';
  const inputActions=document.createElement('div');inputActions.className='fw-input-actions';inputActions.append(generate);topHead.append(inputActions);top.append(topHead,settingsFields,feedback);grid.before(top);
  const inputBody=document.createElement('div');inputBody.className='fw-input-scroll';inputBody.tabIndex=0;inputBody.setAttribute('role','region');inputBody.setAttribute('aria-label',fullWriter.mode==='topic'?'选题内容':'原文内容');inputBody.append(original);
  input.append(inputBody);settings.remove();layoutWriterSettingFields();
  $('#fw-hook')?.remove();
  mountWriterSimilarity();
  // Middle: current text and the candidate revision share the output window.
  const draft=document.createElement('div');draft.id='fw-draft-pane';draft.className='fw-result-pane';
  while(panel.children.length>1)draft.append(panel.children[1]);panel.append(draft);
  const outputActions=document.createElement('div');outputActions.className='fw-output-actions';
  outputActions.append($('#fw-save'),$('#fw-copy'),$('#fw-finalize'));panel.querySelector('.fw-panel-title').after(outputActions);
  $('#fw-to-review')?.remove();
  // Right: review settings, selectable opinions and their actions stay together.
  const column=document.createElement('aside');column.className='panel fw-review-column';column.innerHTML='<div class="fw-panel-title"><h3>审核意见与修改</h3><span class="tag">勾选后改写</span></div>';
  const dock=document.createElement('div');dock.className='fw-action-dock';dock.innerHTML='<p class="fw-dock-status" id="fw-dock-hint"></p><div class="fw-dock-buttons"></div>';
  const reviewPane=document.createElement('div');reviewPane.id='fw-review-pane';reviewPane.className='fw-review-scroll';reviewPane.append(review);column.append(dock,reviewPane);grid.append(column);
  const sectionEditor=$('#fw-section')?.closest('details');if(sectionEditor){sectionEditor.open=false;reviewPane.append(sectionEditor);sectionEditor.querySelector('summary').textContent='局部改写';}
  const buttons=dock.querySelector('.fw-dock-buttons'),audit=$('#fw-audit'),finalize=$('#fw-finalize');audit.textContent='检查文案';buttons.append(audit);
  const adopt=$('#fw-adopt-revision'),revise=$('#fw-revise');
  if(adopt){adopt.textContent='采用并复审';buttons.append(adopt);if(revise)revise.hidden=true;}
  else if(revise){revise.textContent='按意见改写';buttons.append(revise);}
  else{const blocked=document.createElement('button');blocked.className='small-btn';blocked.textContent='按意见改写';blocked.disabled=true;buttons.append(blocked);}
  const pending=job&&(state.data.taskRuns||[]).find(r=>r.jobId===job.id&&['model-audit','audit-revision'].includes(r.taskKind));
  if(pending?.state==='unknown'&&pending.taskKind==='model-audit'){audit.textContent='查看检查记录';audit.dataset.resolveRun=pending.id;}
  if(pending?.state==='running'){audit.disabled=true;if(revise)revise.disabled=true;if(adopt)adopt.disabled=true;audit.textContent=pending.taskKind==='model-audit'?'正在检查…':'正在改写…';pollWriterReview(job.id,pending.id);}
  dock.prepend($('#fw-review-feedback'));
  $('#fw-dock-hint').textContent=job?.needsHumanReview?('自动校验未通过，共'+((job.autoCheckIssues||[]).length)+'项待确认：'+(job.autoCheckNote||'请人工确认后定稿。')):pending?.state==='unknown'?'检查未完成，正文已保留。':pending?.state==='running'?'正在处理，完成后自动更新。':adopt?'修改稿已输出到中间，确认后采用。':!current?((state.data.auditRuns||[]).some(r=>r.jobId===job?.id)?'正文或写作设置已变化，请先重新检查。':job?.body?'点击「检查文案」，取得这版文案的修改意见。':'生成文案后，在这里运行检查。'):issues.some(i=>i.status==='待处理')?'勾选认同的意见，改写稿将输出到中间。':'当前检查已通过，可在中间保存定稿。';
  review.querySelector('.fw-review-error [data-resolve-run]')?.remove();$('#fw-review-before-revise')?.remove();
  const engine=$('#fw-audit-engine');review.querySelector('.fw-review-heading')?.remove();
  const config=document.createElement('details');config.className='fw-review-settings';config.innerHTML='<summary>检查方法与设置</summary>';
  const choices=review.querySelector('.fw-audit-choices');if(engine)config.append(engine);if(choices)config.append(choices);
  const notice=review.querySelector('.fw-method-notice:not(#fw-audit-stale)');if(notice)config.append(notice);
  // Review skills are configured globally in connection settings.
  const candidate=$('#fw-revision-body');
  if(candidate){
    const preview=candidate.closest('.fw-revision-panel'),candidatePane=document.createElement('div');candidatePane.id='fw-candidate-pane';candidatePane.className='fw-result-pane';
    preview.querySelector('p')?.remove();preview.querySelector('h4').textContent='按审核意见改写的文案';candidatePane.append(preview);panel.append(candidatePane);
    const tabs=document.createElement('div');tabs.className='fw-result-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','原稿与修改稿');tabs.innerHTML='<button role="tab" data-fw-result-view="draft">修改前</button><button role="tab" data-fw-result-view="revision">修改稿</button>';outputActions.after(tabs);tabs.querySelectorAll('button').forEach(button=>button.onclick=()=>showWriterResult(button.dataset.fwResultView));
    showWriterResult('revision');
  }else showWriterResult('draft');
}

function writerRevisionPanel(job,current,issues){
  if(!job)return '';
  const run=(state.data.taskRuns||[]).find(r=>r.jobId===job.id&&r.taskKind==='audit-revision'&&r.baseBody===job.body&&!r.appliedVersionId&&['succeeded','unknown','running'].includes(r.state));
  if(current&&!issues.some(i=>i.status==='待处理')&&!run)return '';
  if(!current&&!run)return '';
  return `<div class="fw-revision-panel">${current&&!issues.some(i=>i.status==='待处理')&&!run?'<p>这版检查未发现待修改问题，可以保存定稿；也可以更换检查方法后重新检查。</p>':''}<p>勾选认同的意见，点击上方「按意见改写」。修改稿会出现在中间。</p><button class="primary" id="fw-revise" ${current&&issues.some(i=>i.status==='待处理')&&!['unknown','running'].includes(run?.state)?'':'disabled'}>AI 按勾选意见生成修改稿</button>${run?.state==='unknown'?`<p>上次修改未完成，原文已保留。</p><button class="small-btn" data-resolve-run="${esc(run.id)}">重新尝试</button>`:run?.state==='running'?'<p>AI 正在修改，请稍候。</p>':run?.result?`<h4>AI 修改稿预览</h4><p>${esc(run.result.corePoint)}</p><details><summary>查看修改前正文</summary><pre class="detail-text">${esc(run.baseBody)}</pre></details><textarea class="textarea" id="fw-revision-body" aria-label="AI 修改稿">${esc(run.result.body)}</textarea>${run.result.needsVerification?.length?`<p>待核验：${run.result.needsVerification.map(esc).join('；')}</p>`:''}<button class="primary" id="fw-adopt-revision" data-run-id="${esc(run.id)}">采用修改稿并重新审核</button><p>采用后生成新版本，旧稿可在历史版本中恢复。</p>`:''}</div>`;
}

// 勾选任意知识库即视为手动选择；全不勾选时沿用模板绑定的知识库
function bindKnowledgePicker(){
 document.querySelectorAll('#fw-knowledge-picker [data-fw-set],#fw-knowledge-picker [data-fw-library]').forEach(input=>{input.onchange=()=>{fullWriter.drafts[fullWriter.mode].scope='selected';};});
}
function bindFullWriter(job) {
  const remember=event=>{if(event?.target?.closest('#fw-review-results')||event?.target?.id==='fw-revision-body')return;fullWriter.drafts[fullWriter.mode]={...fullWriterDraft(),jobId:job?.id||fullWriter.jobId,baseBody:job?.body,dirty:true};$('#fw-finalize').disabled=true;if($('#fw-revise'))$('#fw-revise').disabled=true;if($('#fw-dock-hint'))$('#fw-dock-hint').textContent='写作设置或正文已变化，请先重新检查。';const stale=$('#fw-audit-stale');if(stale)stale.hidden=false;rememberWriterSession();};
  $('#content-workbench').addEventListener('input',remember);$('#content-workbench').addEventListener('change',remember);
  document.querySelectorAll('[data-fw-mode]').forEach(button=>button.onclick=()=>{
    fullWriter.drafts[fullWriter.mode]={...fullWriterDraft(),options:fullWriter.options};fullWriter.mode=button.dataset.fwMode;fullWriter.jobId=fullWriter.drafts[fullWriter.mode].jobId||null;fullWriter.options=fullWriter.drafts[fullWriter.mode].options||{};state.jobId=fullWriter.jobId;state.view='home';rememberWriterSession();render();
  });
  $('#fw-clear')?.addEventListener('click',()=>resetWriterPage());
  const sourceChanged=event=>{
    const source=event.target;
    const current=fullWriter.drafts[fullWriter.mode];
    const changed=source.id==='fw-original'?source.value!==(current.original||''):source.value!==(current.title||'');
    if(changed&&(fullWriter.jobId||$('#fw-output')?.value||$('#fw-candidate-pane'))){
      const start=source.selectionStart,end=source.selectionEnd,id=source.id;
      resetWriterPage({original:$('#fw-original')?.value||'',title:$('#fw-title')?.value||''});
      const next=$('#'+id);next?.focus();next?.setSelectionRange(start,end);return;
    }
    if(source.id==='fw-original')$('#fw-original-count').textContent=`${source.value.length} 字`;
  };
  $('#fw-original')?.addEventListener('input',sourceChanged);
  $('#fw-title')?.addEventListener('input',sourceChanged);
  $('#fw-output').oninput=()=>{$('#fw-output-count').textContent=`${$('#fw-output').value.length} 字`;$('#fw-finalize').disabled=true;$('#fw-result-status').textContent='编辑中';};
  document.querySelectorAll('[data-fw-replacement]').forEach(field=>field.addEventListener('input',()=>{field.dataset.edited='true';}));
  bindKnowledgePicker();
  $('#fw-template').onchange=()=>{
    const template=state.data.templates.find(t=>t.id===$('#fw-template').value);$('#fw-template-note').textContent=`${template.kind} · ${template.version}`;

    fullWriter.drafts[fullWriter.mode].templateId=template.id;
    for(const key of writerStyleKeys)fullWriter.drafts[fullWriter.mode][key]=template[key]??'';
    $('#fw-style-fields').innerHTML=writerStyleFields(fullWriter.drafts[fullWriter.mode],template);layoutWriterSettingFields();bindWriterStyle();
    const picker=$('#fw-knowledge-picker');if(picker){picker.innerHTML=writerLibraryChoices(fullWriter.drafts[fullWriter.mode]);layoutWriterSettingFields();bindKnowledgePicker();}
    document.querySelectorAll('[data-fw-audit]').forEach(input=>{input.disabled=template.kind!=='视频口播'&&['dbs-script-flow','dbs-title-cover-intro'].includes(input.value);input.checked=writerAuditIds(template).includes(input.value);});
    $('#fw-finalize').disabled=true;
  };
  const action=(button,work)=>async()=>{if(fullWriter.busy)return;fullWriter.lockedDraft=fullWriterDraft();fullWriter.busy=true;const controls=[...document.querySelectorAll('#content-workbench button,#content-workbench input,#content-workbench textarea,#content-workbench select')].filter(element=>!element.matches('[data-fw-result-view]')).map(element=>[element,element.disabled]);controls.forEach(([element])=>element.disabled=true);const text=button.textContent;button.textContent='处理中…';$('#fw-feedback').textContent='';const review=$('#fw-review-feedback');const operation=button.id==='fw-audit'?'正在运行所选检查方法':button.id==='fw-revise'?'AI 正在按勾选意见生成修改稿':button.id==='fw-adopt-revision'?'正在保存修改稿并重新审核':null;const started=Date.now();const progress=()=>{const status=$('#fw-review-feedback');if(status&&operation)status.textContent=`${operation}，已等待 ${Math.floor((Date.now()-started)/1000)} 秒。请勿重复提交；原稿会保留。`;};progress();const timer=operation?setInterval(progress,1000):null;try{await work();}catch(error){if($('#fw-feedback'))$('#fw-feedback').textContent=error.message;if(error.runId&&$('#fw-feedback')){const receipt=document.createElement('button');receipt.type='button';receipt.className='small-btn fw-error-receipt';receipt.dataset.resolveRun=error.runId;receipt.textContent='查看运行记录';$('#fw-feedback').append(receipt);bindUnknownResolution();}if(operation&&$('#fw-review-feedback'))$('#fw-review-feedback').textContent=error.message;toast(error.message,'error');}finally{if(timer)clearInterval(timer);if(review?.isConnected&&operation&&review.textContent.startsWith(operation))review.textContent='本次操作已结束，请查看下方结果或提示。';fullWriter.busy=false;controls.forEach(([element,disabled])=>{if(element.isConnected)element.disabled=disabled;});if(button.isConnected)button.textContent=text;}};
  const back=$('#fw-back-account');if(back){back.textContent=fullWriter.options.returnAccountTaskId?'保存并返回博主作品':'保存并返回采集任务';back.onclick=action(back,async()=>{await saveFullWriterInput(true);if(fullWriter.options.returnAccountTaskId){accountView.taskId=fullWriter.options.returnAccountTaskId;douyinTab='account';}else douyinTab='collect';state.view='douyin';await openDouyinWorkspace();});}
  $('#fw-generate').onclick=action($('#fw-generate'),async()=>{
    fullWriter.resultView='draft';const job=await saveFullWriterInput();const draft=fullWriterDraft();
    $('#fw-feedback').textContent=fullWriter.mode==='rewrite'?'正在结合模板和知识库改写原稿…':'正在结合选题和资料生成文案…';
    await api(`/api/studio/writing/jobs/${job.id}/${draft.engine==='hermes'?'hermes-generate':'generate'}`,{method:'POST',body:'{}'});await refreshFullWriter(job.id);
  });
  $('#fw-save').onclick=action($('#fw-save'),async()=>{const job=await saveFullWriterInput(true);await refreshFullWriter(job.id);toast('文案已保存。','success');});
  $('#fw-recover-local')?.addEventListener('click',()=>{const saved=fullWriter.recoveryDrafts?.[job.id];if(!saved)return;fullWriter.drafts[fullWriter.mode]={...saved,baseBody:job.body,dirty:true};delete fullWriter.recoveryDrafts[job.id];rememberWriterSession();render();});
  $('#fw-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#fw-candidate-pane')&&!$('#fw-candidate-pane').hidden?$('#fw-revision-body').value:$('#fw-output').value);toast('文案已复制。','success');}catch{toast('请选中文字复制。','error');}};
  $('#fw-to-review')?.addEventListener('click',()=>startWriterReview());
  $('#fw-review-before-revise')?.addEventListener('click',()=>startWriterReview());
  $('#fw-audit').onclick=action($('#fw-audit'),async()=>{
    if(!$('#fw-output').value.trim())throw new Error('请先生成或填写文案，再开始检查。');
    showWriterResult('review');
    const job=await saveFullWriterInput(true);const draft=fullWriterDraft();
    await api(`/api/studio/audits${draft.auditEngine==='model'?'/model':''}`,{method:'POST',body:JSON.stringify({jobId:job.id})});await refreshFullWriter(job.id);showWriterResult('review');
  });
  $('#fw-revise')?.addEventListener('click',action($('#fw-revise'),async()=>{
    showWriterResult('review');const issueIds=[...document.querySelectorAll('[data-fw-revise-issue]:checked')].map(e=>e.dataset.fwReviseIssue);
    if(!issueIds.length)throw new Error('请至少勾选一条要修改的审核意见。');
    const saved=await saveFullWriterInput(true);
    const edits=issueIds.flatMap(id=>{const field=document.querySelector(`[data-fw-replacement="${id}"]`),issue=state.data.auditIssues.find(i=>i.id===id);return field&&(typeof issue?.replacement==='string'||field.dataset.edited==='true')?[{issueId:id,replacement:field.value}]:[];});
    try{await api(`/api/studio/writing/jobs/${saved.id}/audit-revision`,{method:'POST',body:JSON.stringify({issueIds,edits})});}finally{await refreshFullWriter(saved.id);}
    showWriterResult('review');
  }));
  $('#fw-adopt-revision')?.addEventListener('click',action($('#fw-adopt-revision'),async()=>{
    showWriterResult('review');const body=$('#fw-revision-body').value,runId=$('#fw-adopt-revision').dataset.runId;
    const saved=await saveFullWriterInput(true);const engine=fullWriterDraft().auditEngine;
    await api(`/api/studio/writing/jobs/${saved.id}/audit-revision/apply`,{method:'POST',body:JSON.stringify({runId,body})});
    try{await api(`/api/studio/audits${engine==='model'?'/model':''}`,{method:'POST',body:JSON.stringify({jobId:saved.id})});}finally{await refreshFullWriter(saved.id);showWriterResult('review');}
    toast('修改稿已保存为新版本，并完成重新检查。','success');
  }));
  $('#fw-finalize').onclick=action($('#fw-finalize'),async()=>{if(!job)return;const draft=fullWriterDraft();if(draft.output!==job.body)throw new Error('文案已修改，请先重新检查。');await saveFullWriterInput(true);await api('/api/studio/writing/finalize',{method:'POST',body:JSON.stringify({jobId:job.id})});await refreshFullWriter(job.id);toast('已保存定稿。','success');});
  $('#fw-section-run').onclick=action($('#fw-section-run'),async()=>{if(!$('#fw-output').value.trim())throw new Error('请先生成正文。');const job=await saveFullWriterInput(true);await api(`/api/studio/writing/jobs/${job.id}/hermes-section`,{method:'POST',body:JSON.stringify({section:$('#fw-section').value,instruction:$('#fw-section-instruction').value||'保留原意，让这一部分更清晰。'})});await refreshFullWriter(job.id);});
  $('#fw-history').onclick=async()=>{if(!job)return;const data=await api(`/api/studio/jobs/${job.id}/versions`);showDetail('文案版本',data.versions.map(v=>`<article class="job-row" style="display:block"><strong>${esc(v.reason)}</strong><p class="job-sub">${esc(v.createdAt)}</p><pre class="detail-text">${esc(v.body)}</pre><button class="small-btn" data-fw-restore="${esc(v.id)}">恢复这一版</button></article>`).join(''));document.querySelectorAll('[data-fw-restore]').forEach(button=>button.onclick=async()=>{await api(`/api/studio/jobs/${job.id}/restore`,{method:'POST',body:JSON.stringify({versionId:button.dataset.fwRestore})});document.querySelector('.detail-sheet')?.remove();await refreshFullWriter(job.id);});};
  document.querySelectorAll('[data-fw-apply],[data-fw-ignore]').forEach(button=>button.onclick=async()=>{
    const id=button.dataset.fwApply||button.dataset.fwIgnore;const issue=state.data.auditIssues.find(i=>i.id===id);const replacement=document.querySelector(`[data-fw-replacement="${id}"]`)?.value;
    if(button.dataset.fwApply&&replacement===issue.quote){toast('请先填写修改后的文字。','error');return;}if(button.dataset.fwApply&&replacement.trim()===''&&issue.replacement!==''&&!window.confirm('替换文字为空将删除原文这一句，确认删除吗？')){return;}
    try{await api(`/api/studio/audit-issues/${id}`,{method:'PATCH',body:JSON.stringify({action:button.dataset.fwApply?'rewrite':'ignore',replacement})});await refreshFullWriter(job.id);showWriterResult('review');}catch(error){toast(error.message,'error');}
  });
}

async function saveFullWriterInput(saveOutput=false) {
  const draft=fullWriterDraft();fullWriter.drafts[fullWriter.mode]=draft;
  const rewrite=fullWriter.mode==='rewrite';const original=draft.original.trim();
  const topic=rewrite?'':draft.title.trim();const title=rewrite?draft.title.trim():(draft.recordTitle||'').trim();
  if(rewrite&&!original)throw new Error('请先粘贴原始文案。');if(!rewrite&&!topic)throw new Error('请先输入一个选题。');
  const pickedSets=draft.knowledgeSetIds||[],pickedDocs=draft.documentIds||[];
  // 未操作时沿用模板；主动取消全部勾选表示本次不读取知识库。
  const manualKnowledge=draft.scope==='selected';
  const scope=manualKnowledge?{knowledgeSetIds:pickedSets,documentIds:pickedDocs}:{knowledgeSetIds:null,documentIds:null};
  const input={...writerStyleValues(draft),title,topic,templateId:draft.templateId,...scope,auditSkills:draft.auditSkills,auditEngine:draft.auditEngine,writingEngine:draft.engine,writingInstruction:draft.instruction,hook:draft.hook,durationSeconds:draft.durationSeconds};
  let job=state.data.jobs.find(j=>j.id===fullWriter.jobId);
  if(job&&(rewrite?original!==(job.originalBody||''):topic!==(job.topic||job.title))){
    job=null;fullWriter.jobId=null;state.jobId=null;fullWriter.options={};
    draft.output='';draft.title=rewrite?'':topic;draft.recordTitle='';
    input.title='';
    fullWriter.drafts[fullWriter.mode]=draft;
    if(fullWriter.busy)fullWriter.lockedDraft={...draft};
  }
  if(!job){
    const options=fullWriter.options;const endpoint=options.topicId?'/api/studio/topics/select':rewrite?'/api/studio/rewrite-jobs':options.materialIds?.length?'/api/studio/materials/create-content':'/api/studio/writing/jobs';
    job=await api(endpoint,{method:'POST',body:JSON.stringify({...options,...input,templateId:draft.templateId,original,rewriteMode:'按模板改写',writingOrigin:{returnAccountTaskId:options.returnAccountTaskId,returnCollectionTaskId:options.returnCollectionTaskId,format:options.format}})});
    fullWriter.jobId=job.id;state.jobId=job.id;if(!state.data.jobs.some(j=>j.id===job.id))state.data.jobs.unshift(job);
  }
  const template=state.data.templates.find(t=>t.id===draft.templateId);
  const saved=await api(`/api/studio/writing/jobs/${job.id}`,{method:'PATCH',body:JSON.stringify({...input,...(!template?.active?{templateId:undefined}:{}),originalBody:rewrite?original:'',creationMode:rewrite?'rewrite':'topic',...(saveOutput?{body:draft.output}:{})})});
  Object.assign(job,saved);fullWriter.drafts[fullWriter.mode]={...draft,jobId:job.id,dirty:false};rememberWriterSession();return saved;
}

async function refreshFullWriter(jobId) {
  fullWriter.drafts[fullWriter.mode].dirty=false;
  fullWriter.jobId=jobId;state.jobId=jobId;state.view='studio';await load();
  rememberWriterSession();
}
