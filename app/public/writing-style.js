const writerStyleKeys=['stylePromptId','soulPersona','soulProfileId','hookType','copyStyle','copyType','targetWordCount','customPrompt','durationMode'];
function writerStyleValues(draft){
  const soul=$('#fw-soul')?.value;
  return {...Object.fromEntries(writerStyleKeys.map(key=>[key,draft[key]??''])),...(soul===undefined?{}:{stylePromptId:soul.startsWith('prompt:')?soul.slice(7):'',soulPersona:soul.startsWith('profile:')||soul.startsWith('prompt:')?'':soul,soulProfileId:soul.startsWith('profile:')?soul.slice(8):''}),hookType:$('#fw-hook-type')?.value??draft.hookType??'',copyStyle:$('#fw-copy-style')?.value??draft.copyStyle??'',copyType:$('#fw-copy-type')?.value??draft.copyType??'',customPrompt:draft.customPrompt??'',durationMode:'original',targetWordCount:Number($('#fw-word-count')?.value??draft.targetWordCount??0)};
}
function writerStyleFields(draft,template){
  const values={...Object.fromEntries(writerStyleKeys.map(key=>[key,draft[key]??template[key]??'']))};
  const catalog=state.data.writingStyles||{};
  const options=(items,selected)=>`<option value="" ${selected?'':'selected'}>不改开头（模板默认）</option><option value="AI自动识别" ${selected==='AI自动识别'?'selected':''}>AI 自动识别</option>${(items||[]).map(item=>`<option ${selected===item?'selected':''}>${esc(item)}</option>`).join('')}`;
  const soul=values.stylePromptId?'prompt:'+values.stylePromptId:values.soulPersona|| (values.soulProfileId?'profile:'+values.soulProfileId:'');
  const hasSoul=Boolean(soul);
  return `<div class="fw-setting-divider"></div><h3>文风与写法</h3><p class="fw-setting-note">写作提示词与灵魂二选一：选一边，另一边自动禁用。知识库独立于写法，未选择库时不检索。</p><div class="fw-method-switch" role="group" aria-label="写法来源"><button type="button" data-writer-method="template" aria-pressed="${hasSoul?'false':'true'}">写作提示词</button><button type="button" data-writer-method="soul" aria-pressed="${hasSoul?'true':'false'}">灵魂</button></div><label class="fw-label" for="fw-hook-type">黄金三秒类型</label><select class="field" id="fw-hook-type">${options(catalog.hookTypes,values.hookType||'AI自动识别')}</select><label class="fw-label" for="fw-soul">灵魂管理</label><select class="field" id="fw-soul"><option value="">不使用灵魂</option>${state.data.templates.filter(t=>(t.active||t.id===values.stylePromptId)&&t.promptCategory==='style').map(t=>`<option value="prompt:${esc(t.id)}" ${soul==='prompt:'+t.id?'selected':''}>${esc(t.name)}</option>`).join('')}${(state.data.soulProfiles||state.data.documents).filter(d=>d.soulProfile).map(d=>`<option value="profile:${esc(d.id)}" ${soul==='profile:'+d.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select><label class="fw-label" for="fw-copy-type">文案类型</label><select class="field" id="fw-copy-type">${options(['思维型','实战型'],values.copyType)}</select><label class="fw-label" for="fw-word-count">目标字数</label><input class="field" id="fw-word-count" type="number" min="80" max="5000" value="${values.targetWordCount||''}" placeholder="例如 900">`;
}
// 写作提示词与灵魂二选一：默认用写作提示词（灵魂不可选），点「灵魂」后反过来
function chooseWritingMethod(method){
  const soul=$('#fw-soul');if(!soul)return;
  if(method==='template'){soul.value='';}
  else if(!soul.value){const first=[...soul.options].find(option=>option.value);if(!first){if(typeof toast==='function')toast('还没有可用的灵魂，请先在灵魂管理里新建。','error');return;}soul.value=first.value;}
  syncWritingMethodChoice();
  soul.dispatchEvent(new Event('change',{bubbles:true}));
}
function syncWritingMethodChoice(){
  const soul=$('#fw-soul'),template=$('#fw-template');
  if(!soul||!template)return;
  const hasSoul=Boolean(soul.value);
  template.disabled=hasSoul;
  soul.disabled=!hasSoul;
  const templateField=template.closest?.('.fw-setting-field'),soulField=soul.closest?.('.fw-setting-field');
  if(templateField)templateField.hidden=hasSoul;
  if(soulField)soulField.hidden=!hasSoul;
  document.querySelectorAll('[data-writer-method]').forEach(button=>{
    const active=button.dataset.writerMethod===(hasSoul?'soul':'template');
    button.setAttribute('aria-pressed',String(active));
    button.classList.toggle('active',active);
  });
  template.title=hasSoul?'当前由灵魂主导，写作提示词不参与本次生成；把灵魂切回「不使用灵魂」即可重新选择':'';
  const note=$('#fw-template-note');
  if(note){
    const record=state.data.templates.find(t=>t.id===template.value);
    const base=[record?.kind||'',record?.version||''].filter(Boolean).join(' · ');
    note.textContent=hasSoul?`${base} · 已由灵魂「${soul.selectedOptions[0]?.textContent||''}」主导，这份写作提示词不参与本次生成`:base;
  }
}
function bindWriterStyle(){
  mountWriterModels();
  const duration=$('#fw-duration-mode');if(duration)duration.onchange=()=>{$('#fw-duration').hidden=duration.value!=='custom';};
  const soul=$('#fw-soul');if(soul)soul.onchange=()=>{syncWritingMethodChoice();};
  document.querySelectorAll('[data-writer-method]').forEach(button=>{button.onclick=()=>chooseWritingMethod(button.dataset.writerMethod);});
  syncWritingMethodChoice();
}
function writingFlowSummary(job,draft,template){
  const sets=draft.scope==='selected'?draft.knowledgeSetIds||[]:template.knowledgeSetIds||[];
  const ids=new Set(draft.scope==='selected'?draft.documentIds||[]:template.documentIds||[]);
  for(const id of sets)for(const docId of state.data.knowledgeSets.find(s=>s.id===id)?.documentIds||[])ids.add(docId);
  const sources=state.data.documents.filter(d=>ids.has(d.id));
  const soul=(draft.soulPersona??template.soulPersona)||(state.data.soulProfiles||state.data.documents).find(d=>d.id===(draft.soulProfileId??template.soulProfileId))?.name||'自然表达';
  return `<div class="fw-flow-path" aria-label="创作流程"><button class="small-btn" data-view="douyin">① 采集 / 整理素材</button><span>→</span><button class="small-btn" data-view="templates">② 写法模板与灵魂</button><span>→</span><span class="tag">③ ${fullWriter.mode==='rewrite'?'原稿改写':'选题生成'}</span><span>→</span><button class="small-btn" id="fw-flow-review">④ 检查与定稿</button></div><div class="fw-context-summary"><div><strong>这篇使用：${esc(template.name||'请选择模板')}</strong><p>灵魂：${esc(soul)} · ${sources.length?`已绑定 ${sources.length} 份资料`:'按模板的知识范围检索'}${job?.status?` · ${esc(job.status)}`:''}</p>${sources.length?`<small>${sources.slice(0,3).map(d=>esc(d.name)).join('、')}${sources.length>3?' 等':''}</small>`:''}</div><button class="small-btn" id="fw-context-preview">查看 AI 将读取的资料与提示词</button></div>`;
}
function bindWritingFlow(){
  const update=()=>{const draft=fullWriterDraft();const selected=$('#fw-soul');const template=state.data.templates.find(t=>t.id===draft.templateId);const heading=document.querySelector('.fw-context-summary strong');if(heading)heading.textContent=`这篇使用：${template?.name||'请选择模板'}`;const details=document.querySelector('.fw-context-summary small');if(details)details.textContent=draft.scope==='selected'?'资料范围已更新，点击右侧查看实际片段。':(template?.documentIds||[]).map(id=>state.data.documents.find(d=>d.id===id)?.name).filter(Boolean).slice(0,3).join('、');const summary=document.querySelector('.fw-context-summary p');if(summary)summary.textContent=`灵魂：${selected.selectedOptions[0]?.textContent||'自然表达'} · ${fullWriterDraft().scope==='selected'?'使用手动所选资料':'沿用模板知识库'}${draft.hookType?' · '+draft.hookType:''}`;};
  $('#content-workbench').addEventListener('change',update);
  $('#fw-flow-review').onclick=()=>startWriterReview();
  $('#fw-context-preview').onclick=async()=>{
    if(fullWriter.busy)return;
    try{const job=await saveFullWriterInput(true);const context=await api(`/api/studio/writing/jobs/${job.id}/context`);showDetail('本次创作使用的资料与写法',`<p>当前已保存。以下是本次实际组合的模板、灵魂与知识片段；此操作不调用模型。</p><h3>模板与写法</h3><pre class="detail-text">${esc(context.system)}</pre><h3>知识库片段 · ${context.knowledge.length}</h3>${context.knowledge.map(d=>`<article><strong>${esc(d.name)} · ${esc(d.locator)}</strong><p>${esc(d.excerpt)}</p></article>`).join('')||'<p>没有检索到资料，请调整知识库范围。</p>'}<h3>原始来源 · ${context.refs.length}</h3>${context.refs.map(d=>`<p>${esc(d.title)}</p>`).join('')}`);}catch(error){toast(error.message,'error');}
  };
}
async function openTaskDistillation(taskId){
  try{
    const task=await api(`/api/studio/douyin/tasks/${taskId}`);
    const rows=(task.rows||[]).filter(row=>String(row.transcript||row.content||'').trim());
    if(!rows.length)throw new Error('这批作品还没有正文，请先补转写或粘贴已有文案。');
    showDetail('选择这一批要学习的文案',`<p>采集到的文字可以直接带入提炼，不必先手动逐篇入库。</p><div class="workflow-doc-list">${rows.map((row,i)=>`<label><input type="checkbox" data-task-distill="${i}" ${i<30?'checked':''}>${esc(row.title||row.desc||'作品')} <small>${String(row.transcript||row.content).length} 字</small></label>`).join('')}</div><button class="primary" id="task-distill-next">整理所选素材，进入写法提炼</button><p id="task-distill-status" role="status"></p>`);
    $('#task-distill-next').onclick=async()=>{const selected=[...document.querySelectorAll('[data-task-distill]:checked')].map(i=>rows[Number(i.dataset.taskDistill)]);if(!selected.length||selected.length>30){$('#task-distill-status').textContent='请选择 1—30 篇文案。';return;}const button=$('#task-distill-next');button.disabled=true;$('#task-distill-status').textContent='正在整理素材，此步骤不调用模型…';try{const ids=[];for(const row of selected){const doc=await api(`/api/studio/douyin/tasks/${taskId}/prepare-writing`,{method:'POST',body:JSON.stringify({videoId:String(row.externalId||row.aweme_id||''),url:row.url})});ids.push(doc.id);}document.querySelector('.detail-sheet')?.remove();await load();openMaterialDistillation(ids);}catch(error){$('#task-distill-status').textContent=error.message;button.disabled=false;}};
  }catch(error){toast(error.message,'error');}
}
function openMaterialDistillation(selectedIds=[]){
  const docs=state.data.documents.filter(d=>d.content?.trim()&&!d.soulProfile);
  showDetail('从素材提炼灵魂与写作模板',`<p>① 选同行或自己的完整文案　② 提炼并修改提示词　③ 保存模板去写作</p><p class="job-sub">使用原 Hermes 灵魂提取方法分析句式、语气、黄金三秒和结尾。提炼样本写法，不把同行经历当成你的事实。每次最多 30 篇。</p><label for="distill-name">模板名称</label><input class="field" id="distill-name" value="我的口播写法" style="width:100%;margin:8px 0"><div class="workflow-doc-list">${docs.map(d=>`<label><input type="checkbox" data-distill-doc="${esc(d.id)}" ${selectedIds.includes(d.id)?'checked':''}>${esc(d.name)} <small>${d.content.length} 字</small></label>`).join('')||'<p>还没有可用文案，请先采集转写，或在“我的素材”上传并入库。</p>'}</div><label for="distill-requirements">你希望保留或调整什么</label><textarea class="textarea" id="distill-requirements" placeholder="例如：学习结果反差式开头和短句，保留操作步骤，不要硬广。"></textarea><button class="primary" id="distill-run" ${docs.length?'':'disabled'}>AI 提炼灵魂与提示词</button><p id="distill-feedback" role="status"></p><div id="distill-result"></div>`);
  $('#distill-run').onclick=async()=>{
    const button=$('#distill-run'),feedback=$('#distill-feedback'),resultNode=$('#distill-result');
    const documentIds=[...document.querySelectorAll('[data-distill-doc]:checked')].map(i=>i.dataset.distillDoc);
    if(!documentIds.length){feedback.textContent='请先勾选需要学习的文案。';return;}
    button.disabled=true;resultNode.innerHTML='';feedback.textContent='正在提炼写法与原句证据，请勿重复提交…';
    try{
      const run=await api('/api/studio/materials/distill',{method:'POST',body:JSON.stringify({documentIds,requirements:$('#distill-requirements').value})});
      if(!resultNode.isConnected)return;
      feedback.textContent=`已分析 ${documentIds.length} 篇。请核对原句证据，编辑提示词后保存。`;
      resultNode.innerHTML=`<h3>提炼出的灵魂</h3><p>${esc(run.result.soul.soul_summary)}</p><details><summary>查看写法与原句证据 · ${run.result.patterns.length}</summary>${run.result.patterns.map(p=>`<article><strong>${esc(p.name)}</strong><blockquote>${esc(p.quote)}</blockquote><p>${esc(p.explanation)}</p><small>${esc(docs.find(d=>d.id===p.documentId)?.name)}</small></article>`).join('')}</details><label for="distill-prompt">可编辑的系统提示词</label><textarea class="textarea" id="distill-prompt" style="min-height:260px">${esc(run.result.prompt)}</textarea><label for="distill-rules">硬性规则（可修改，每行一条）</label><textarea class="textarea" id="distill-rules">${esc(run.result.rules.join("\n"))}</textarea><p class="job-sub">保存后，模板会绑定本次素材和提炼出的灵魂。写作时可更换灵魂或知识库。</p><div class="actions"><button class="primary" id="distill-save-topic">保存模板，输入选题写新稿</button><button class="small-btn" id="distill-save-rewrite">保存模板，粘贴原稿改写</button></div>`;
      for(const mode of ['topic','rewrite'])$(`#distill-save-${mode}`).onclick=async()=>{
        resultNode.querySelectorAll('button').forEach(b=>b.disabled=true);
        try{const saved=await api('/api/studio/materials/distill/save',{method:'POST',body:JSON.stringify({runId:run.id,name:$('#distill-name').value,prompt:$('#distill-prompt').value,rules:$('#distill-rules').value.split('\n').map(line=>line.trim()).filter(Boolean)})});document.querySelector('.detail-sheet')?.remove();await load();openFullWriter({mode,templateId:saved.template.id,format:'视频口播'});toast('模板与灵魂已保存，素材已绑定。','success');}catch(error){feedback.textContent=error.message;resultNode.querySelectorAll('button').forEach(b=>b.disabled=false);}
      };
    }catch(error){feedback.textContent=error.code==='generation_outcome_unknown'?'模型请求结果未知，未自动重试。请查看本次运行记录。':error.message;}
    finally{if(button.isConnected)button.disabled=false;}
  };
}

async function mountWriterModels(){
 const container=$('#fw-model-settings');if(!container||$('#fw-api-model'))return;
 try{const config=await api('/api/studio/models/config');if(!container.isConnected)return;
 const label=document.createElement('label');label.className='fw-label';label.htmlFor='fw-api-model';label.textContent='API 模型';
 const select=document.createElement('select');select.className='field';select.id='fw-api-model';select.innerHTML=`<option value="">${esc(config.currentModel||'当前配置')}</option>`+config.profiles.map(p=>`<option value="${esc(p.id)}" ${(config.assignments?.writing||config.activeId)===p.id?'selected':''}>${esc(p.name)} · ${esc(p.model)}</option>`).join('');container.append(label,select);layoutWriterSettingFields();
 select.onchange=async()=>{if(!select.value)return;if(fullWriter.busy){toast('当前任务完成后可切换模型','error');return;}select.disabled=true;try{await api('/api/studio/models/config',{method:'POST',body:JSON.stringify({activateId:select.value,purpose:'writing'})});}catch(error){toast(error.message,'error');}finally{select.disabled=false;}};
 }catch(error){const el=document.querySelector('#fw-model-settings');if(el)el.innerHTML='<p class="collection-error">模型配置加载失败，请检查设置。</p>';}
}
