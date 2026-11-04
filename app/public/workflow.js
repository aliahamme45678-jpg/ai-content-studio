const workflowSkillLabels = { 'dbs-content-value':'内容价值', 'dbs-ai-check':'AI 味检查', 'dbs-script-flow':'口播流畅度', 'dbs-resonate':'共鸣检查', 'dbs-content-risk-check':'发布风险', 'dbs-title-cover-intro':'标题与开头', 'dbs-spread':'发布复盘' };

function currentDraft() {
  const posts = [...document.querySelectorAll('.post-input')];
  return posts.length ? posts.map(input => input.value).join('\n\n') : $('#draft')?.value ?? state.data.jobs.find(j=>j.id===state.jobId)?.body ?? '';
}

function knowledgeScope(prefix, config = {}) {
  const explicit = config.knowledgeSetIds !== undefined || config.documentIds !== undefined;
  return `<fieldset class="workflow-fieldset" id="${prefix}"><legend>本次参考的知识库</legend><label><input type="radio" name="${prefix}-mode" value="template" ${explicit?'':'checked'}> 沿用模板绑定</label> <label><input type="radio" name="${prefix}-mode" value="selected" ${explicit?'checked':''}> 自选资料</label><div class="knowledge-choices" ${explicit?'':'hidden'}><div class="chips">${(state.data.knowledgeSets || []).map(set=>`<label class="chip"><input type="checkbox" data-knowledge-set="${esc(set.id)}" ${(config.knowledgeSetIds||[]).includes(set.id)?'checked':''}>${esc(set.name)} · ${set.documentIds.length} 份</label>`).join('') || '<span class="muted">可在“素材库”中将多份资料存成知识库。</span>'}</div><details style="margin-top:10px"><summary>逐份选择资料</summary><div class="workflow-doc-list">${state.data.documents.filter(d=>d.content?.trim()).map(doc=>`<label><input type="checkbox" data-knowledge-document="${esc(doc.id)}" ${(config.documentIds||[]).includes(doc.id)?'checked':''}> ${esc(doc.name)} <small>${esc(doc.type)}</small></label>`).join('') || '<p class="muted">尚无正文资料，请先导入。</p>'}</div></details><p class="job-sub">只检索选中的资料；未选择任何项表示本次不使用知识库。</p></div></fieldset>`;
}
function bindKnowledgeScope(prefix) {
  const node = document.getElementById(prefix); if (!node) return;
  node.querySelectorAll('input[type=radio]').forEach(input=>input.onchange=()=>{node.querySelector('.knowledge-choices').hidden=input.value!=='selected';});
}
function readKnowledgeScope(prefix) {
  const node=document.getElementById(prefix);
  if (!node || node.querySelector('input[type=radio]:checked')?.value !== 'selected') return { knowledgeSetIds:null, documentIds:null };
  return { knowledgeSetIds:[...node.querySelectorAll('[data-knowledge-set]:checked')].map(i=>i.dataset.knowledgeSet), documentIds:[...node.querySelectorAll('[data-knowledge-document]:checked')].map(i=>i.dataset.knowledgeDocument) };
}
function auditChoices(prefix, config = {}, format = '短帖') {
  const aliases=SKILL_ALIASES;
  const skills=(config.auditSkills ?? config.audits ?? ['dbs-ai-check','dbs-content-risk-check']).map(skill=>aliases[skill]||skill);
  return `<fieldset class="workflow-fieldset" id="${prefix}"><legend>生成后按需检查</legend><div class="chips">${Object.entries(workflowSkillLabels).filter(([id])=>id!=='dbs-spread').map(([id,label])=>`<label class="chip"><input type="checkbox" value="${id}" ${skills.includes(id)?'checked':''} ${format!=='视频口播'&&['dbs-script-flow','dbs-title-cover-intro'].includes(id)?'disabled':''}>${label}</label>`).join('')}</div><p class="job-sub">可选本地快检或模型诊断；建议由你决定是否采用。</p></fieldset>`;
}
function readAudits(prefix) { return [...document.querySelectorAll(`#${prefix} input:checked:not(:disabled)`)].map(i=>i.value); }
function activeTemplates(selected) {
  const pinned=state.data.templates.find(t=>t.id===selected);
  const items=state.data.templates.filter(t=>t.active || t.id===selected);
  return items.map(t=>`<option value="${esc(t.id)}" ${t.id===selected?'selected':''}>${esc(t.name)} · ${esc(t.version)}${!t.active?'（历史版本）':''}</option>`).join('');
}

async function openWritingEntry(options = {}) {
  if(fullWriter.busy)return;
  if(document.querySelector('#content-workbench')){
    const draft=fullWriterDraft();
    if(draft.dirty&&(draft.original?.trim()||draft.title?.trim()||draft.output?.trim())){
      fullWriter.busy=true;fullWriter.lockedDraft=draft;
      try{await saveFullWriterInput(true);}catch(error){toast(`当前文案尚未保存：${error.message}`,'error');return;}finally{fullWriter.busy=false;}
    }
  }
  openFullWriter(options);
}

function enhanceWorkflow() {
  if (!state.data) return;
  document.querySelectorAll('.nav').forEach(nav=>nav.classList.toggle('active',nav.dataset.view===state.view&&(state.view!=='douyin'||nav.hasAttribute('data-account-entry')===(douyinTab==='account'))));
  document.querySelectorAll('[data-account-entry]').forEach(button=>{button.classList.toggle('active',state.view==='douyin'&&douyinTab==='account');const navigate=button.onclick;button.onclick=()=>{if(fullWriter.busy)return;douyinTab='account';return navigate?.();};});
  document.querySelectorAll('.nav[data-view="douyin"]:not([data-account-entry])').forEach(button=>{button.classList.toggle('active',state.view==='douyin');const navigate=button.onclick;button.onclick=()=>{if(fullWriter.busy)return;douyinTab='collect';return navigate?.();};});

  const auditCount=document.querySelector('.nav .warn');if(auditCount)auditCount.textContent=state.data.auditIssues.filter(i=>i.status==='待处理').length;
  document.querySelectorAll('[data-new-idea]').forEach(button=>button.onclick=()=>openWritingEntry());
  document.querySelectorAll('[data-new-rewrite]').forEach(button=>button.onclick=()=>openWritingEntry({mode:'rewrite'}));
  document.querySelectorAll('[data-write]').forEach(button=>button.onclick=()=>{const source=state.data.sources.find(s=>s.id===button.dataset.write);if(!source){toast('来源已失效，请刷新','error');return;}openWritingEntry({sourceId:source.id,title:source.title});});
  document.querySelectorAll('[data-select-angle]').forEach(button=>button.onclick=()=>{const topic=state.data.topics.find(t=>t.id===state.topicId);const angle=topic?.angles?.find(a=>a.id===button.dataset.selectAngle);if(!topic||!angle){toast('选题已失效，请刷新','error');return;}openWritingEntry({topicId:topic.id,angleId:angle.id,title:angle.title,format:angle.format});});

  if(state.view==='topics' && !$('#topic-history')) {
    const panel=document.createElement('div');panel.id='topic-history';panel.className='panel';panel.style.marginBottom='14px';
    panel.innerHTML=`<label for="topic-picker">已有选题</label><select class="field" id="topic-picker" style="width:100%;margin-top:8px">${state.data.topics.map(t=>`<option value="${esc(t.id)}" ${t.id===state.topicId?'selected':''}>${esc(t.sourceTitle)} · ${esc(t.state)}</option>`).join('')}</select><p class="job-sub">角度是基于材料的编辑建议，新增事实仍需核实。</p><button class="small-btn" id="topic-new">从新想法找角度</button>`;
    document.querySelector('.page .welcome')?.after(panel);
    $('#topic-picker').onchange=()=>{state.topicId=$('#topic-picker').value;render();};$('#topic-new').onclick=()=>openWritingEntry();
  }

  if(['library','templates'].includes(state.view))document.querySelector('.nav[data-view="library"]')?.classList.add('active');
  if(state.view==='library') {enhanceLibrary();enhanceFileImport();}
  if(state.view==='studio' && state.jobId && !$('#content-workbench')) enhanceWriting();
  if(state.view==='audit')enhanceAudit();
  if(state.view==='settings'){enhanceCollectionSettings();mountModelProfiles();if(!$('#spx-settings-tabs'))cleanSettingsPanels();mountGlobalAuditSettings();}
  if(state.view==='archive') {
    document.querySelectorAll('[data-retro]').forEach(button=>{
      const original=button.onclick;button.onclick=()=>{original?.();const p=state.data.publications.find(p=>p.id===button.dataset.retro);const node=document.createElement('div');node.className='workflow-feedback';node.innerHTML='<hr><label for="confirmed-learning">确认有效的写作经验</label><textarea class="textarea" id="confirmed-learning" placeholder="写明适用条件；推测未经验证时不要提升成规则。"></textarea><button class="small-btn" id="save-learning">确认并存入方法库</button><p id="learning-feedback" role="status"></p>';document.querySelector('.detail-sheet .panel').append(node);$('#save-learning').onclick=async()=>{try{await api(`/api/studio/publications/${p.id}/knowledge`,{method:'POST',body:JSON.stringify({confirmed:true,text:$('#confirmed-learning').value,type:'蒸馏方法库'})});$('#learning-feedback').textContent='已保存，在“素材库”中可查看并用于后续创作。';}catch(error){$('#learning-feedback').textContent=error.message;}};};
    });
  }
}

function enhanceLibrary() {
  if($('#library-workflow'))return;
  const panel=document.createElement('section');panel.id='library-workflow';panel.className='panel';panel.style.marginBottom='14px';
  panel.innerHTML=groupedLibraryChoices();
  (document.querySelector('.asset-module-tabs')||document.querySelector('.page .welcome'))?.after(panel);
  bindGroupedLibrary();
}

function enhanceWriting() {
  const job=state.data.jobs.find(j=>j.id===state.jobId);if(!job)return;
  if(!$('#writing-config')) {
    const config=document.createElement('section');config.id='writing-config';config.className='panel';config.style.marginBottom='14px';
    const template=job.templateSnapshot||{};
    config.innerHTML=`<details><summary>写作设置 · ${esc(template.name||job.template)} · ${esc(template.version||'')}</summary><div style="margin-top:12px"><label for="workflow-title">选题 / 文案标题</label><input class="field" id="workflow-title" value="${esc(job.title)}" style="width:100%;margin:8px 0"><label for="workflow-template">写作模板</label><select class="field" id="workflow-template" style="width:100%;margin:8px 0">${activeTemplates(job.templateVersionId)}</select>${knowledgeScope('job-scope',{...template,...job})}${auditChoices('job-audits',{...template,...job},job.format)}${sourceChoices(job)}<button class="small-btn" id="save-writing-config">保存设置和当前稿</button><p id="writing-config-result" role="status"></p><details><summary>本次模板提示词与硬性规则</summary><pre class="detail-text">${esc(template.prompt||'未设置自定义提示词')}</pre><p class="job-sub">${(template.rules||[]).map(esc).join('；')}</p></details></div></details>`;
    document.querySelector('.page .welcome')?.after(config);bindKnowledgeScope('job-scope');
    $('#save-writing-config').onclick=async()=>{try{await persistWritingSettings(job.id);await load();}catch(error){$('#writing-config-result').textContent=error.message;}};
    $('#workflow-template').onchange=()=>{const template=state.data.templates.find(t=>t.id===$('#workflow-template').value);$('#job-audits').outerHTML=auditChoices('job-audits',template,template.kind);};
    // The existing template selector saves the current editor before changing format.
  }
  if($('#job-template'))$('#job-template').onchange=async()=>{await api(`/api/studio/writing/jobs/${job.id}`,{method:'PATCH',body:JSON.stringify({templateId:$('#job-template').value,body:currentDraft()})});await load();};
  if($('#save-video'))$('#save-video').onclick=async()=>{await api(`/api/studio/writing/jobs/${job.id}`,{method:'PATCH',body:JSON.stringify({title:$('#video-title').value,hook:$('#video-hook').value,durationSeconds:$('#video-duration').value,body:currentDraft()})});await load();};
  const generate=$('#generate-content');
  if(generate)generate.onclick=async()=>{
    generate.disabled=true;generate.textContent='生成中…';
    try{
      await persistWritingSettings(job.id);
      const mode=$('#generation-mode')?.value||'studio';const result=await api(`/api/studio/writing/jobs/${job.id}/${mode==='hermes'?'hermes-generate':'generate'}`,{method:'POST',body:'{}'});
      state.jobId=result.job.id;await load();if(result.reused)toast('已复用相同输入的生成稿；修改选题或模板可生成不同版本。');
    }catch(error){generate.disabled=['generation_outcome_unknown','generation_in_progress'].includes(error.code);generate.textContent=generate.disabled?'未完成':'生成失败，重试';toast(error.message,'error');}
  };
  const section=$('#hermes-section');
  if(section){section.onchange=null;if(!$('#run-hermes-section')){const button=document.createElement('button');button.id='run-hermes-section';button.className='small-btn';button.textContent='修改所选段落';button.disabled=state.data.hermesStatus?.mode!=='ready';section.after(button);button.onclick=async()=>{button.disabled=true;try{await api(`/api/studio/writing/jobs/${job.id}`,{method:'PATCH',body:JSON.stringify({body:currentDraft()})});await api(`/api/studio/writing/jobs/${job.id}/hermes-section`,{method:'POST',body:JSON.stringify({section:section.value,instruction:'保留原意，只改善这一段的清晰度。'})});await load();}catch(error){button.disabled=['generation_outcome_unknown','generation_in_progress'].includes(error.code);toast(error.message,'error');}};}}
  const audit=$('#run-audit');if(audit)audit.textContent='检查文案';
  if(audit&&!$('#run-model-audit')){const model=document.createElement('button');model.id='run-model-audit';model.hidden=true;model.className='small-btn';model.textContent='按所选方法模型审核';model.title='调用当前模型，按所选 Skill 文档诊断；费用以网关账单为准';model.disabled=!state.data.runtimeStatus?.modelCallsEnabled;audit.after(model);model.onclick=()=>runModelAudit(job.id,model);}
  if(audit)audit.onclick=async()=>{if($('#audit-engine')?.value==='model')return runModelAudit(job.id,audit);audit.disabled=true;try{await persistWritingSettings(job.id);await api('/api/studio/writing/versions',{method:'POST',body:JSON.stringify({jobId:job.id,body:currentDraft(),reason:'审核前保存'})});await api('/api/studio/audits',{method:'POST',body:JSON.stringify({jobId:job.id})});state.view='audit';await load();}catch(error){audit.disabled=false;toast(error.message,'error');}};
  if(!$('#audit-engine')){const row=document.createElement('label');row.className='job-sub';row.innerHTML='<span>检查方式</span><select class="field" id="audit-engine" style="display:block;width:100%;margin:8px 0"><option value="local">本地快检（不调用模型）</option><option value="model">按所选方法模型诊断（调用当前模型）</option></select>';$('#job-audits')?.after(row);$('#audit-engine').value=job.auditEngine||'local';}
  if($('#job-template'))$('#job-template').hidden=true;
  const configBody=$('#writing-config details > div');
  if(configBody&&$('#generation-mode')&&!$('#generation-mode').closest('#writing-config')){const row=document.createElement('label');row.className='job-sub';row.textContent='写作引擎';const mode=$('#generation-mode');row.append(mode);mode.style.display='block';mode.style.width='100%';mode.style.margin='8px 0';configBody.prepend(row);}
  const note=$('#generation-note');if(note&&configBody)configBody.append(note);
  if(!$('#writing-tools')){const tools=document.createElement('details');tools.id='writing-tools';tools.style.marginTop='16px';tools.innerHTML='<summary>历史版本与局部修改</summary><div class="actions" style="margin-top:10px"></div>';document.querySelector('.editor > section.panel')?.append(tools);}
  for(const selector of ['#show-versions','#studio-runs','#hermes-section','#run-hermes-section']){const control=$(selector);if(control)$('#writing-tools .actions')?.append(control);}

}

async function importPayload(file) {
  if(file.size>4*1024*1024)throw new Error('文件超过 4 MB，请拆分后导入。');
  if(!/\.(docx|xlsx)$/i.test(file.name))return {name:file.name,text:await file.text()};
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=16384)binary+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
  return {name:file.name,base64:btoa(binary)};
}
function enhanceFileImport(){
  const file=$('#import-file');if(!file)return;
  file.onchange=async()=>{try{const selected=file.files?.[0];if(!selected)return;$('#import-name').value=selected.name;if(/\.(docx|xlsx)$/i.test(selected.name)){$('#import-text').value='';$('#import-text').placeholder='二进制文件将在服务端解析，点击预检查看提取结果。';}else $('#import-text').value=await selected.text();}catch(error){$('#import-result').textContent=error.message;}};
  $('#preview-import').onclick=async()=>{const button=$('#preview-import');button.disabled=true;try{const selected=file.files?.[0];const payload=selected&&/\.(docx|xlsx)$/i.test(selected.name)?await importPayload(selected):{name:$('#import-name').value,text:$('#import-text').value};const preview=await api('/api/studio/imports/preview',{method:'POST',body:JSON.stringify({...payload,name:$('#import-name').value||payload.name,type:$('#import-type').value})});$('#import-text').value=preview.text;$('#import-result').textContent=`${preview.chunks} 个片段 · ${preview.duplicate?'发现相同内容或同名文件':'未发现重复'} · 请核对提取的正文`;const confirm=document.createElement('button');confirm.className='small-btn blue';confirm.textContent='确认入库';confirm.onclick=async()=>{confirm.disabled=true;try{await api('/api/studio/imports/commit',{method:'POST',body:JSON.stringify({previewId:preview.id})});await load();}catch(error){$('#import-result').append(document.createTextNode(error.message));confirm.disabled=false;}};$('#import-result').append(' ',confirm);}catch(error){$('#import-result').textContent=error.message;}finally{button.disabled=false;}};
}

function sourceChoices(job){
  const refs=Array.isArray(job.sourceSnapshot)?job.sourceSnapshot:job.sourceSnapshot?[job.sourceSnapshot]:[];
  return refs.length?`<fieldset class="workflow-fieldset"><legend>本次使用的来源</legend>${refs.map(ref=>`<label style="display:block;margin:8px 0"><input type="checkbox" data-source-enabled="${esc(ref.id)}" ${(job.excludedSourceIds||[]).includes(ref.id)?'':'checked'}> ${esc(ref.title)} <small>${esc(ref.role||ref.factRole||'外部情报·需核验')}</small></label>`).join('')}</fieldset>`:'';
}
function readExcludedSources(){return [...document.querySelectorAll('[data-source-enabled]:not(:checked)')].map(input=>input.dataset.sourceEnabled);}

async function runModelAudit(jobId,button){
  button.disabled=true;button.textContent='审核中…';
  try{if(state.view==='studio'){await persistWritingSettings(jobId);await api('/api/studio/writing/versions',{method:'POST',body:JSON.stringify({jobId,body:currentDraft(),reason:'模型审核前保存'})});}await api('/api/studio/audits/model',{method:'POST',body:JSON.stringify({jobId})});state.view='audit';await load();}catch(error){button.disabled=['generation_outcome_unknown','generation_in_progress'].includes(error.code);button.textContent=button.disabled?'审核未完成':'重试模型审核';toast(error.message,'error');}
}
function enhanceAudit(){
  const job=state.data.jobs.find(j=>j.id===state.jobId);if(!job)return;
  const back=$('#back-to-studio');if(back&&!$('#audit-rerun')){
    const again=document.createElement('button');again.id='audit-rerun';again.className='small-btn';again.textContent='重新快检';back.after(again);again.onclick=async()=>{await api('/api/studio/audits',{method:'POST',body:JSON.stringify({jobId:job.id})});await load();};
    const model=document.createElement('button');model.className='small-btn';model.textContent='模型重新审核';model.disabled=!state.data.runtimeStatus?.modelCallsEnabled;again.after(model);model.onclick=()=>runModelAudit(job.id,model);
  }
  document.querySelectorAll('[data-rewrite-issue]').forEach(button=>button.onclick=async()=>{
    const issue=state.data.auditIssues.find(i=>i.id===button.dataset.rewriteIssue);const field=document.querySelector(`[data-issue-replacement="${issue.id}"]`);
    if(!field){toast('请回到创作室补充正文后重新审核。','error');return;}
    if(field.value===issue.quote||(field.value.trim()===''&&issue.replacement!=='')){toast('请先填写修改后的文字，或选择忽略此建议。','error');return;}
    try{await api(`/api/studio/audit-issues/${issue.id}`,{method:'PATCH',body:JSON.stringify({action:'rewrite',replacement:field.value})});await load();}catch(error){toast(error.message,'error');}
  });
  document.querySelectorAll('[data-ignore-issue]').forEach(button=>{const issue=state.data.auditIssues.find(i=>i.id===button.dataset.ignoreIssue);if(issue?.blocking){button.disabled=true;button.title='需先处理硬性阻断项';}});
  const latest=state.data.auditRuns.find(r=>r.jobId===job.id);if(latest?.summary&&!$('#audit-summary')){const note=document.createElement('p');note.id='audit-summary';note.className='muted';note.textContent=latest.summary;document.querySelector('.page .welcome')?.after(note);}
}

function bindUnknownResolution(){
 document.querySelectorAll('[data-resolve-run]').forEach(button=>button.onclick=async()=>{
  const id=button.dataset.resolveRun;let receipt;try{receipt=await api(`/api/studio/task-runs/${id}/receipt`);}catch(error){toast(error.message,'error');return;}
  const retryable=receipt.state==='unknown'||receipt.state==='partial';const accountId=button.dataset.retryAccount;
  showDetail(accountId?'重新分析':'操作未完成',`<p>${accountId?'采集结果和正文已保留，上次 AI 分析未完成。':'已有内容已保留。'}${retryable?'重新尝试可能产生额外调用费用。':''}</p><details><summary>错误详情</summary><pre class="detail-text">${esc(JSON.stringify(receipt,null,2))}</pre></details>${retryable?`<button class="primary" id="resolve-unknown" style="margin-top:16px">${accountId?'重新分析':'允许重新尝试'}</button>`:''}<p id="resolve-feedback" role="status"></p>`);
  const retry=$('#resolve-unknown');if(!retry)return;
  retry.onclick=async()=>{retry.disabled=true;try{await api(`/api/studio/task-runs/${id}/resolve-unknown`,{method:'POST',body:JSON.stringify({confirmedReviewed:true})});if(accountId){await api(button.dataset.retryWorkflow==='true'?`/api/studio/douyin/tasks/${accountId}/workflow-resume`:`/api/studio/douyin/account-analysis/${accountId}/analyze`,{method:'POST',body:JSON.stringify(button.dataset.retryWorkflow==='true'?{}:{settings:accountView.settings,context:accountView.context})});}document.querySelector('.detail-sheet')?._close?.();await load();}catch(error){$('#resolve-feedback').textContent=error.message;retry.disabled=false;}};
 });
}

async function enhanceCollectionSettings(){
 if($('#collection-settings'))return;
 const node=document.createElement('section');node.className='panel';node.id='collection-settings';node.style.marginTop='14px';
 node.innerHTML=`<details open><summary>抖音登录与语音转写</summary><p id="collection-login-status" role="status">正在读取配置…</p><p class="job-sub">抖音要求登录时，可导入已有的浏览器登录状态 JSON。文件仅保存到本机，采集与评论共用；不会自动开始采集或调用转写。</p><label for="douyin-state-file">选择登录状态 JSON 文件</label><input class="field" id="douyin-state-file" type="file" accept=".json,application/json"><details style="margin:12px 0"><summary>也可以填写本机文件路径</summary><label for="douyin-state-path">抖音登录状态文件路径</label><input class="field" id="douyin-state-path" style="width:100%;margin:8px 0" placeholder="已有 storageState JSON 的本机完整路径；留空保留当前配置"></details><label for="asr-key">语音转写服务 Key（可选）</label><input class="field" id="asr-key" type="text" autocomplete="off" placeholder="未配置也能使用已有文案；留空保留原值" style="display:block;width:100%;margin:8px 0"><div class="actions"><button class="small-btn blue" id="save-collection-config">保存并验证配置</button><button class="small-btn" id="clear-douyin-state">改用游客模式</button></div><p id="collection-config-feedback" role="status"></p></details>`;
 document.querySelector('.page').append(node);
 const paint=result=>{node.querySelector('#asr-key').value=result.asrKey||'';node.querySelector('#collection-login-status').textContent=`登录状态：${result.login?.detail||'尚未检查'}；语音转写：${result.asrConfigured?'已配置':'未配置'}`;};
 const save=async(clearState=false)=>{
   const button=node.querySelector(clearState?'#clear-douyin-state':'#save-collection-config');button.disabled=true;
   const feedback=node.querySelector('#collection-config-feedback');feedback.textContent='正在验证配置…';
   try{
     const file=node.querySelector('#douyin-state-file').files[0];if(file&&file.size>4*1024*1024)throw new Error('文件超过 4 MB，请选择登录状态 JSON');
     const input=clearState?{clearState:true}:{asrKey:node.querySelector('#asr-key').value,statePath:node.querySelector('#douyin-state-path').value,...(file?{stateJson:await file.text()}:{})};
     const result=await api('/api/studio/integrations/douyin/config',{method:'POST',body:JSON.stringify(input)});
     node.querySelector('#douyin-state-file').value='';if(clearState)node.querySelector('#douyin-state-path').value='';
     paint(await api('/api/studio/integrations/douyin/config'));feedback.textContent='已保存并完成文件验证。返回采集任务后可开始新的采集；已有作品保留。';
   }catch(error){feedback.textContent=error.message;}finally{button.disabled=false;}
 };
 node.querySelector('#save-collection-config').onclick=()=>save();node.querySelector('#clear-douyin-state').onclick=()=>save(true);
 try{const result=await api('/api/studio/integrations/douyin/config');if(node.isConnected){paint(result);node.querySelector('#douyin-state-path').value=result.statePath||'';}}catch(error){if(node.isConnected)node.querySelector('#collection-login-status').textContent=error.message;}
}

async function persistWritingSettings(jobId){
 const templateId=$('#workflow-template')?.value;const template=state.data.templates.find(t=>t.id===templateId);
 const input={...readKnowledgeScope('job-scope'),auditSkills:readAudits('job-audits'),auditEngine:$('#audit-engine')?.value||'local',excludedSourceIds:readExcludedSources(),title:$('#workflow-title')?.value,body:currentDraft(),...(template?.active?{templateId}:{})};
 if($('#video-title')){input.title=$('#video-title').value;input.hook=$('#video-hook').value;input.durationSeconds=$('#video-duration').value;}
 await api(`/api/studio/writing/jobs/${jobId}`,{method:'PATCH',body:JSON.stringify(input)});
}
