let promptLibraryTab='writing';
const promptCategoryLabels={writing:'写作提示词',style:'灵魂管理',other:'其他提示词',topic:'话题生文提示词'};
// 黄金三秒已由统一写作 Prompt 承载；历史 hooks 分类仍可读，归入其他提示词，不删除数据
function promptCategory(t){const c=t.promptCategory||(t.platform?.includes('X')?'other':'writing');return c==='hooks'?'other':c;}
// 一键复制的文本：提示词在前，写作 DNA 分层按固定顺序跟随，空段自动跳过
function promptBundleText(name,prompt,report){
 const parts=[`# ${String(name||'').trim()||'提示词'}`,'## 提示词',String(prompt||'').trim()];
 for(const [key,label] of [['language','语言 DNA'],['structure','结构模板'],['cognition','选题、素材与认知'],['visual','视觉与资料范围']]){
  const value=String(report?.[key]||'').trim();if(value)parts.push(`## ${label}`,value);
 }
 return parts.join('\n\n').trim();
}
function renderPromptLibrary(){
 const items=state.data.templates.filter(t=>t.active&&promptCategory(t)===promptLibraryTab);
 shell('提示词模板','',`<div class="tabs spx-prompt-tabs" role="tablist">${Object.entries(promptCategoryLabels).map(([id,name])=>`<button class="tab ${id===promptLibraryTab?'active':''}" role="tab" aria-selected="${id===promptLibraryTab}" data-prompt-tab="${id}">${name}</button>`).join('')}</div><section class="panel"><div class="panel-head"><h3>${promptCategoryLabels[promptLibraryTab]}</h3><div class="actions"><button class="primary" id="prompt-new">新建提示词</button></div></div><div class="spx-prompt-grid">${items.map(t=>`<article class="template-card"><h3>${esc(t.name)}</h3><p class="spx-prompt-preview">${esc(t.prompt||'')}</p>${boundKnowledge(t)}<button class="small-btn" data-prompt-edit="${esc(t.id)}">编辑</button><button class="small-btn" data-prompt-delete="${esc(t.id)}">删除</button></article>`).join('')||'<div class="muted">暂无提示词</div>'}</div></section>`);
 document.querySelectorAll('[data-prompt-tab]').forEach(b=>b.onclick=()=>{promptLibraryTab=b.dataset.promptTab;renderPromptLibrary();});$('#prompt-new').onclick=()=>openPromptEditor();document.querySelectorAll('[data-prompt-edit]').forEach(b=>b.onclick=()=>openPromptEditor(state.data.templates.find(t=>t.id===b.dataset.promptEdit)));document.querySelectorAll('[data-prompt-delete]').forEach(b=>b.onclick=async()=>{await api(`/api/studio/prompt-library/${b.dataset.promptDelete}/delete`,{method:'POST',body:'{}'});await load();});bindEvents();
}
function boundKnowledge(t){
 const ids=t?.knowledgeSetIds||[];if(!ids.length)return '';
 const sets=(state.data.knowledgeSets||[]).filter(s=>ids.includes(s.id)&&!s.deletedAt);
 if(!sets.length)return '<p class="job-sub">已绑定的知识库已不存在</p>';
 const total=sets.reduce((sum,set)=>sum+(set.documentIds||[]).length,0);
 return `<p class="job-sub">已绑定知识库：${sets.map(set=>esc(set.name)).join('、')} · ${total} 篇</p>`;
}
function knowledgeKindLabel(set){return set?.sourceKind==='feishu'?'飞书':set?.sourceKind==='markdown'?'Markdown':'本地';}
function promptEditorKnowledge(template){
 const picked=new Set(template?.knowledgeSetIds||[]);
 const sets=(state.data.knowledgeSets||[]).filter(set=>!set.deletedAt);
 return `<fieldset class="prompt-knowledge"><legend>关联知识库（写作时自动读取）</legend><p class="job-sub">勾选后，用这个模板写作会默认检索这些库；在写作页手动勾选其他库时，以手动选择为准。飞书多表格可以直接在这里链接，读取后自动绑定。</p><div id="prompt-set-list">${sets.map(set=>`<label><input type="checkbox" data-prompt-set="${esc(set.id)}" ${picked.has(set.id)?'checked':''}><span>${esc(set.name)}<small>${knowledgeKindLabel(set)} · ${(set.documentIds||[]).length} 篇</small></span></label>`).join('')||'<p class="job-sub">还没有知识库，可以先链接一个飞书知识库。</p>'}</div><div class="actions"><button type="button" class="small-btn" id="prompt-feishu-open">+ 链接飞书知识库</button></div><div id="prompt-feishu-form" hidden><label for="prompt-feishu-url">飞书多维表格链接</label><input class="field" id="prompt-feishu-url" placeholder="https://xxx.feishu.cn/base/...?table=tbl..."><label for="prompt-feishu-name">知识库名称</label><input class="field" id="prompt-feishu-name" placeholder="例如：爆款开头语料"><button type="button" class="small-btn" id="prompt-feishu-create">读取并绑定</button><p id="prompt-feishu-status" role="status"></p></div></fieldset>`;
}
function layoutPromptEditor(){
 const form=$('#prompt-editor-form');if(!form)return;
 form.closest('.detail-sheet')?.classList.add('prompt-editor-sheet');
 const main=document.createElement('div');main.className='prompt-editor-main';
 const side=document.createElement('aside');side.className='prompt-editor-side';side.setAttribute('aria-label','知识库与写作 DNA');
 const footer=document.createElement('div');footer.className='prompt-editor-footer';
 for(const node of [...form.children]){
  if(node.matches('.prompt-knowledge,.spx-dna-sections'))side.append(node);
  else if(node.matches('.actions,#prompt-editor-status'))footer.append(node);
  else main.append(node);
 }
 form.append(main,side,footer);
}
function openPromptEditor(template){
 showDetail(template?'编辑提示词':'新建提示词',`<form id="prompt-editor-form"><label for="prompt-name">模板名称</label><input class="field" id="prompt-name" value="${esc(template?.name||'')}" required maxlength="120"><label for="prompt-content">提示词</label><textarea class="textarea" id="prompt-content" required maxlength="30000">${esc(template?.prompt||'')}</textarea>${promptEditorKnowledge(template)}${template?.dnaReport?`<details class="spx-dna-sections"><summary>写作 DNA 分层（随模板保存，写文案时注入语言／结构／认知三段）</summary>${[['language','语言 DNA'],['structure','结构模板'],['cognition','选题、素材与认知'],['visual','视觉与资料范围']].filter(([key])=>template.dnaReport[key]).map(([key,label])=>`<p class="job-sub"><strong>${label}</strong>${key==='visual'?'（仅备查，不注入写作）':''}</p><pre class="detail-text">${esc(template.dnaReport[key])}</pre>`).join('')}<p class="job-sub">来源：${esc(String(template.dnaReport.sourceRunId||''))} · ${esc(String(template.dnaReport.articles||0))} 篇语料${template.dnaReport.quality?` · 结构模板 ${template.dnaReport.quality.structureTypes} 类 · 核心命题 ${template.dnaReport.quality.propositions} 条 · 元数据覆盖 ${Math.round((template.dnaReport.quality.metadataCoverage||0)*100)}%`:''}${template.dnaReport.specVersion?` · 规格 ${esc(String(template.dnaReport.specVersion))}`:''}</p></details>`:''}<div class="actions"><button class="primary" type="submit">保存</button><button type="button" class="small-btn" id="prompt-copy-all" title="复制提示词与语言 DNA、结构模板、选题认知等全部内容">一键复制全部</button></div><p id="prompt-editor-status" role="status"></p></form>`);
 layoutPromptEditor();
 const copyAll=$('#prompt-copy-all');
 if(copyAll)copyAll.onclick=async()=>{
  const status=$('#prompt-editor-status');
  const text=promptBundleText($('#prompt-name').value,$('#prompt-content').value,template?.dnaReport);
  const done=()=>{status.textContent=`已复制提示词与分层内容，共 ${text.length} 字`;};
  try{await navigator.clipboard.writeText(text);done();}
  catch{
   const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();
   let ok=false;try{ok=document.execCommand('copy');}catch{ok=false;}
   area.remove();status.textContent=ok?`已复制提示词与分层内容，共 ${text.length} 字`:'复制失败，请手动选择文本复制。';
  }
 };
 const feishuOpen=$('#prompt-feishu-open'),feishuCreate=$('#prompt-feishu-create');
 if(feishuOpen)feishuOpen.onclick=()=>{$('#prompt-feishu-form').hidden=false;};
 if(feishuCreate)feishuCreate.onclick=async()=>{
  const status=$('#prompt-feishu-status');feishuCreate.disabled=true;status.textContent='正在读取飞书表格…';
  try{
   const url=$('#prompt-feishu-url').value.trim();const name=$('#prompt-feishu-name').value.trim()||'飞书知识库';
   const result=await api('/api/studio/assets/create',{method:'POST',body:JSON.stringify({name,kind:'feishu',url})});
   const list=$('#prompt-set-list');list.querySelector('.job-sub')?.remove();
   const label=document.createElement('label');
   label.innerHTML=`<input type="checkbox" data-prompt-set="${esc(result.id)}" checked><span>${esc(result.name||name)}<small>飞书 · ${result.count||0} 篇</small></span>`;
   list.append(label);$('#prompt-feishu-form').hidden=true;status.textContent=`已读取 ${result.count||0} 篇，保存模板后生效。`;
  }catch(error){status.textContent=error.message;}
  finally{feishuCreate.disabled=false;}
 };
 $('#prompt-editor-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const knowledgeSetIds=[...document.querySelectorAll('[data-prompt-set]:checked')].map(input=>input.dataset.promptSet);await api('/api/studio/prompt-library',{method:'POST',body:JSON.stringify({id:template?.id,category:promptLibraryTab,name:$('#prompt-name').value,prompt:$('#prompt-content').value,knowledgeSetIds})});document.querySelector('.detail-sheet')?.remove();await load();}catch(error){$('#prompt-editor-status').textContent=error.message;b.disabled=false;}};
}
function writerLibraryChoices(draft){
 const template=state.data.templates.find(t=>t.id===draft.templateId);
 const inherited=draft.scope!=='selected';
 const sets=inherited?(template?.knowledgeSetIds||[]):(draft.knowledgeSetIds||[]);
 const docs=inherited?(template?.documentIds||[]):(draft.documentIds||[]);
 const grouped=libraryGroups(state.data.documents.filter(d=>d.content?.trim()));return `<div class="fw-knowledge-list">${(state.data.knowledgeSets||[]).map(set=>`<label class="spx-picker-option"><input type="checkbox" data-fw-set="${esc(set.id)}" ${sets.includes(set.id)?'checked':''}><span>${esc(set.name)}</span></label>`).join('')}${grouped.filter(g=>!state.data.knowledgeSets?.some(s=>s.documentIds.length===g.docs.length&&g.docs.every(d=>s.documentIds.includes(d.id)))).map(g=>`<label class="spx-picker-option"><input type="checkbox" data-fw-library="${esc(JSON.stringify(g.docs.map(d=>d.id)))}" ${g.docs.every(d=>docs.includes(d.id))?'checked':''}><span>${esc(g.title)}<small>${g.docs.length} 篇</small></span></label>`).join('')}</div>`;
}

function mountGlobalAuditSettings(){
 const tabs=$('#spx-settings-tabs');if(!tabs||$('#global-audit-config'))return;
 const section=document.createElement('section');section.id='global-audit-config';section.className='panel';section.dataset.settingsPanel='audit';section.setAttribute('role','tabpanel');section.hidden=settingsTab!=='audit';const skills=state.data.integration?.auditConfig?.skills||['dbs-ai-check','dbs-content-risk-check'];section.innerHTML=`<h3>dont 共用审核技能</h3><div class="spx-purpose-options">${Object.entries(workflowSkillLabels).filter(([id])=>id!=='dbs-spread').map(([id,name])=>`<label><input type="checkbox" data-global-audit="${id}" ${skills.includes(id)?'checked':''}>${name}</label>`).join('')}</div><button class="primary" id="save-global-audit">保存</button><p id="global-audit-status" role="status"></p>`;tabs.after(section);
 const b=document.createElement('button');b.className='tab';b.setAttribute('role','tab');b.textContent='dont 审核';b.dataset.settingsTab='audit';tabs.append(b);
 // Include the shared review configuration in the existing tab switch contract.
 tabs.querySelectorAll('button').forEach(tab=>{const previous=tab.onclick;tab.onclick=()=>{if(tab===b){settingsTab='audit';document.querySelectorAll('[data-settings-panel]').forEach(p=>p.hidden=p!==section);tabs.querySelectorAll('button').forEach(t=>{t.classList.toggle('active',t===b);t.setAttribute('aria-selected',String(t===b));});}else{previous?.();section.hidden=true;b.classList.remove('active');b.setAttribute('aria-selected','false');}};});
 if(settingsTab==='audit'){b.classList.add('active');b.setAttribute('aria-selected','true');}
 $('#save-global-audit').onclick=async()=>{const button=$('#save-global-audit');button.disabled=true;try{const result=await api('/api/studio/audit-config',{method:'POST',body:JSON.stringify({skills:[...section.querySelectorAll('[data-global-audit]:checked')].map(i=>i.dataset.globalAudit)})});state.data.integration||={};state.data.integration.auditConfig=result;$('#global-audit-status').textContent='已保存，所有写作共用';}catch(error){$('#global-audit-status').textContent=error.message;}finally{button.disabled=false;}};
}
