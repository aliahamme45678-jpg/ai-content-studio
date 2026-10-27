const pipelineSkills = [
  ['dbs-content-value','选题价值判断','选题','受众、继续阅读理由、最多三项改进方向'],
  ['dbs-script-flow','口播衔接检查','成稿审核','段落衔接、信息密度、口播卡点'],
  ['dbs-ai-check','AI 写作特征','成稿审核','原句定位与表达诊断，默认不改写'],
  ['dbs-resonate','共鸣检查','成稿审核','受众关系、观点表达和共鸣缺口'],
  ['dbs-content-risk-check','发布风险检查','发布前','逐句风险和最小修改建议，不保证过审'],
  ['dbs-title-cover-intro','标题与开头','视频包装','标题、封面文字、开头候选'],
  ['dbs-spread','传播复盘','发布后','结合真实表现解释可能机制，不推断因果'],
];
let douyinWorkspace = null;
let douyinBatch = null;
let douyinTab = 'materials';
let collectionRefresh = null;

async function openDouyinWorkspace() {
  clearTimeout(collectionRefresh);
  state.view='douyin';
  shell('抖音素材流水线','从作品素材到选题、成稿和审核，每一步保留来源。','<div class="panel" role="status">正在读取素材与批次…</div>');
  try { const result=await api('/api/studio/douyin/workspace'); if(state.view!=='douyin')return;douyinWorkspace=result;drawDouyin(); }
  catch(error){if(state.view==='douyin')shell('抖音素材流水线','读取失败，可重新进入页面。',`<div class="issue">${esc(error.message)}</div>`);}
}

function drawDouyin() {
  const data=douyinWorkspace;
  const docs=data.documents;
  const stage=(title,detail,ready)=>`<div class="pipeline-stage"><strong>${title}</strong><span class="tag">${ready?'可用':'未接通'}</span><p class="job-sub">${detail}</p></div>`;
  shell('抖音素材流水线','采集与转写负责材料，写作模板主导表达，Skill 按阶段诊断。',`
    <div class="pipeline-stages">${stage('作品采集','游客模式作品采集；不含转写、评论和推送',true)}${stage('转写与导入','ASR 配置后可补跑，当前保持原始数据',data.capabilities.transcription==='configured')}${stage('评论蒸馏','评论适配器尚未接通，失败不影响作品数据',false)}${stage('选题与创作','素材入库后创建独立内容任务',true)}</div>
    <div class="panel" style="margin:16px 0"><div class="panel-head"><div><h3>素材处理台</h3><div class="job-sub">${docs.length} 条素材 · ${data.batches.length} 个导入批次 · ${data.plans.length} 个组合方案</div></div><button class="primary" id="pipeline-open-import">导入流水线结果</button></div>
    <div class="tabs">${[['collect','采集任务'],['materials','素材列表'],['batches','导入批次'],['skills','Skill 组合']].map(([key,label])=>`<button class="tab ${douyinTab===key?'active':''}" data-pipeline-tab="${key}">${label}</button>`).join('')}</div>
    <div id="pipeline-content"></div></div>
    <section class="panel" id="pipeline-import" ${douyinBatch?'':'hidden'}><div class="panel-head"><h3>导入与预检</h3><span class="tag">确认后才入库</span></div><label for="pipeline-file">导出文件</label><input class="field" id="pipeline-file" type="file" accept=".json,.jsonl,.csv" style="display:block;width:100%;margin:8px 0"><label for="pipeline-text">JSON / JSONL / CSV 原始内容</label><textarea class="textarea" id="pipeline-text" style="min-height:150px" placeholder="粘贴 douyin-material-pipeline 导出内容"></textarea><div class="actions" style="margin-top:12px"><button class="primary" id="pipeline-preview">预检字段与正文</button><span id="pipeline-feedback" role="status" class="muted"></span></div><div id="pipeline-preview-result"></div></section>`);
  document.querySelectorAll('[data-pipeline-tab]').forEach(button=>button.onclick=()=>{douyinTab=button.dataset.pipelineTab;drawPipelineTab();});
  $('#pipeline-open-import').onclick=()=>{$('#pipeline-import').hidden=false;$('#pipeline-import').scrollIntoView({behavior:'smooth',block:'start'});$('#pipeline-text').focus();};
  $('#pipeline-file').onchange=async()=>{const file=$('#pipeline-file').files?.[0];if(!file)return;if(file.size>4*1024*1024){$('#pipeline-feedback').textContent='文件超过 4 MB，请拆分后导入。';return;}$('#pipeline-text').value=await file.text();};
  $('#pipeline-preview').onclick=async()=>{
    const button=$('#pipeline-preview');button.disabled=true;$('#pipeline-feedback').textContent='预检中…';
    try{const result=await api('/api/studio/imports/douyin/preview',{method:'POST',body:JSON.stringify({text:$('#pipeline-text').value})});douyinBatch=await api(`/api/studio/douyin/batches/${result.id}`);$('#pipeline-feedback').textContent='预检完成，请核对下方行数据。';drawBatchPreview();}
    catch(error){$('#pipeline-feedback').textContent=error.message;}finally{button.disabled=false;}
  };
  drawPipelineTab();
  if(douyinBatch)drawBatchPreview();
  bindEvents();
}

function drawPipelineTab() {
  document.querySelectorAll('[data-pipeline-tab]').forEach(button=>button.classList.toggle('active',button.dataset.pipelineTab===douyinTab));
  const node=$('#pipeline-content');
  if(douyinTab==='materials') {
    node.innerHTML='<label for="pipeline-search">筛选标题、作者或口播正文</label><input class="field" id="pipeline-search" placeholder="搜索素材" style="width:100%;margin:8px 0 14px"><div id="pipeline-materials"></div>';
    const show=()=>{const q=$('#pipeline-search').value.toLowerCase();const docs=douyinWorkspace.documents.filter(doc=>[doc.name,doc.author,doc.content].join(' ').toLowerCase().includes(q));$('#pipeline-materials').innerHTML=docs.length?`<div class="pipeline-table-wrap"><table class="pipeline-table"><thead><tr><th>作品 / 作者</th><th>口播正文</th><th>点赞</th><th>播放量</th><th>操作</th></tr></thead><tbody>${docs.map(doc=>`<tr><td><strong>${esc(doc.name)}</strong><div class="job-sub">${esc(doc.author||'作者未知')}</div></td><td>${doc.content?'正文已导入':'缺少正文'}</td><td>${esc(doc.diggCount??'未知')}</td><td>${doc.playCountKnown?esc(doc.playCount):'未知'}</td><td><button class="small-btn" data-pipeline-doc="${esc(doc.id)}">查看 / 创建内容</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">暂无匹配素材。先导入流水线导出的 JSON、JSONL 或 CSV，再核对后入库。</div>';document.querySelectorAll('[data-pipeline-doc]').forEach(button=>button.onclick=()=>openPipelineDocument(button.dataset.pipelineDoc));};
    $('#pipeline-search').oninput=show;show();
  } else if(douyinTab==='batches') {
    node.innerHTML=douyinWorkspace.batches.map(batch=>`<div class="job-row"><span class="tag">${esc(batch.state)}</span><div><div class="job-title">${batch.count} 条作品 · 播放量未知 ${batch.unknownPlayCount} 条</div><div class="job-sub">${esc(batch.createdAt)}</div></div><button class="small-btn" style="margin-left:auto" data-pipeline-batch="${esc(batch.id)}">查看批次</button></div>`).join('')||'<div class="empty">暂无导入批次</div>';
    document.querySelectorAll('[data-pipeline-batch]').forEach(button=>button.onclick=async()=>{douyinBatch=await api(`/api/studio/douyin/batches/${button.dataset.pipelineBatch}`);$('#pipeline-import').hidden=false;drawBatchPreview();$('#pipeline-preview-result').scrollIntoView({block:'start'});});
  } else if(douyinTab==='collect') { drawCollectionTasks(node); scheduleCollectionRefresh(); }
  else drawSkillPlan(node);
}

function drawCollectionTasks(node){
  const fields=[['title','标题'],['url','视频链接'],['author','作者'],['publishedAt','发布时间'],['diggCount','点赞数'],['collectCount','收藏数'],['commentCount','评论数'],['shareCount','转发数'],['playCount','播放量'],['transcript','转写正文'],['comments','评论明细']];
  node.innerHTML=`<h3>创建作品采集任务</h3><p class="muted">复用现有 Python 采集器，游客模式仅取作品数据。最多 500 条链接；不会默认调用转写、抓评论或推送飞书。</p><label for="collect-mode">采集模式</label><select class="field" id="collect-mode" style="display:block;margin:8px 0"><option value="links">视频链接（最多 500 条）</option><option value="profile">单个博主主页</option></select><label for="collect-urls">抖音链接</label><textarea class="textarea" id="collect-urls" style="min-height:100px" placeholder="每行一条 https://www.douyin.com/… 或 https://v.douyin.com/…"></textarea><h3 style="margin-top:14px">筛选条件</h3><div class="grid" style="grid-template-columns:repeat(4,1fr)">${[['minPlayCount','最低播放量'],['minDigg','最低点赞数'],['minCollect','最低收藏数'],['minComment','最低评论数']].map(([key,label])=>`<label class="job-sub">${label}<input class="field collect-filter" data-filter="${key}" type="number" min="0" value="0" style="display:block;width:100%;margin-top:4px"></label>`).join('')}</div><h3 style="margin-top:14px">采集字段</h3><div class="chips">${fields.map(([key,label])=>`<label class="chip"><input type="checkbox" data-collect-field="${key}" ${!['comments','transcript','playCount'].includes(key)?'checked':''}> ${label}</label>`).join('')}</div><div class="actions" style="margin:12px 0"><button class="primary" id="start-collection">开始采集作品数据</button><button class="small-btn" id="refresh-collection">刷新任务状态</button><span id="collect-error" role="status" class="muted"></span></div><h3>采集任务与日志</h3><div id="collection-task-list">${collectionTaskRows()}</div>`;
  $('#refresh-collection').onclick=()=>openDouyinWorkspace();
  $('#start-collection').onclick=async()=>{const button=$('#start-collection');button.disabled=true;try{const filters={};document.querySelectorAll('[data-filter]').forEach(input=>filters[input.dataset.filter]=Number(input.value||0));const fields=[...document.querySelectorAll('[data-collect-field]:checked')].map(input=>input.dataset.collectField);await api('/api/studio/douyin/collect',{method:'POST',body:JSON.stringify({mode:$('#collect-mode').value,urls:$('#collect-urls').value,filters,fields})});await openDouyinWorkspace();}catch(error){$('#collect-error').textContent=error.message;button.disabled=false;}};
  bindCollectionTaskButtons(node);
  const tasks=document.createElement('div');tasks.id='collection-live-status';
  tasks.innerHTML=(douyinWorkspace.tasks||[]).filter(run=>run.state==='running').map(run=>`<div class="job-row"><span class="tag">采集中</span><div class="job-sub">${esc(run.id)}</div><button class="small-btn" data-cancel-collection="${esc(run.id)}">取消此采集任务</button></div>`).join('');
  node.prepend(tasks);
  bindCollectionTaskButtons(node);
}

function scheduleCollectionRefresh(){
  clearTimeout(collectionRefresh);
  if(state.view!=='douyin'||douyinTab!=='collect'||!douyinWorkspace.tasks?.some(run=>run.state==='running'))return;
  collectionRefresh=setTimeout(async()=>{
    if(state.view!=='douyin'||douyinTab!=='collect')return;
    try{const result=await api('/api/studio/douyin/tasks');douyinWorkspace.tasks=result.tasks;
      const table=document.querySelector('#collection-task-list');
      if(table){table.innerHTML=collectionTaskRows();bindCollectionTaskButtons(table);}
    }catch(error){const feedback=$('#collect-error');if(feedback)feedback.textContent=`状态刷新失败：${error.message}`;}
    scheduleCollectionRefresh();
  },3000);
}

function collectionTaskRows(){
  return (douyinWorkspace.tasks||[]).map(run=>`<article class="job-row" style="display:block"><div class="panel-head"><strong>${esc(run.state)} · ${run.count||0} 条</strong><span class="tag">${esc(run.startedAt)}</span></div><p class="job-sub">${esc(run.error||'')} · ${esc(run.request?.mode||'')} · 字段 ${run.fields?.length||0}</p><p class="job-sub">筛选：播放 ${run.filters?.minPlayCount||0} · 点赞 ${run.filters?.minDigg||0} · 收藏 ${run.filters?.minCollect||0} · 评论 ${run.filters?.minComment||0}</p><details><summary>查看日志</summary><pre class="detail-text">${esc(run.logs||'等待输出')}</pre></details><div class="actions">${run.state==='succeeded'?`<button class="small-btn blue" data-collect-preview="${esc(run.id)}">将结果送入预检</button>`:''}${run.state==='running'?`<button class="small-btn" data-cancel-collection="${esc(run.id)}">取消此采集任务</button>`:''}</div></article>`).join('')||'<div class="empty">尚无采集任务。任务完成后先预检，再确认入库。</div>';
}

function bindCollectionTaskButtons(root=document){
  root.querySelectorAll('[data-cancel-collection]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await api(`/api/studio/douyin/tasks/${button.dataset.cancelCollection}/cancel`,{method:'POST',body:'{}'});await openDouyinWorkspace();}catch(error){const out=$('#collect-error');if(out)out.textContent=error.message;button.disabled=false;}});
  root.querySelectorAll('[data-collect-preview]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const result=await api(`/api/studio/douyin/tasks/${button.dataset.collectPreview}/preview`,{method:'POST',body:'{}'});douyinBatch=await api(`/api/studio/douyin/batches/${result.id}`);$('#pipeline-import').hidden=false;drawBatchPreview();$('#pipeline-import').scrollIntoView({block:'start'});}catch(error){const out=$('#collect-error');if(out)out.textContent=error.message;button.disabled=false;}});
}

function drawBatchPreview() {
  const batch=douyinBatch;
  $('#pipeline-preview-result').innerHTML=`<p class="muted">${batch.count} 条 · 播放量未知 ${batch.unknownPlayCount} 条 · ${batch.rows.filter(row=>!row.transcript).length} 条缺正文。未知播放量不以点赞折算。</p><div class="actions"><a class="small-btn" href="/api/studio/douyin/batches/${encodeURIComponent(batch.id)}/export?format=markdown" target="_blank" rel="noreferrer">导出 Markdown</a><a class="small-btn" href="/api/studio/douyin/batches/${encodeURIComponent(batch.id)}/export?format=json" target="_blank" rel="noreferrer">导出 JSON</a><span class="tag">飞书推送：未授权/已关闭</span></div><div class="pipeline-table-wrap"><table class="pipeline-table"><thead><tr><th>行</th><th>标题</th><th>作者</th><th>正文</th><th>播放量</th></tr></thead><tbody>${batch.rows.slice(0,50).map(row=>`<tr><td>${row.row}</td><td>${esc(row.title)}</td><td>${esc(row.author||'未知')}</td><td>${row.transcript?'有':'缺失'}</td><td>${row.playCountKnown?esc(row.playCount):'未知'}</td></tr>`).join('')}</tbody></table></div><p class="job-sub">${batch.count>50?'预览前 50 条，确认将处理全部行。':''}</p><button class="primary" id="pipeline-commit" ${batch.state==='已入库'?'disabled':''}>${batch.state==='已入库'?'该批次已入库':'确认入库'}</button><span id="pipeline-commit-message" role="status"></span>`;
  $('#pipeline-commit').onclick=async()=>{const button=$('#pipeline-commit');button.disabled=true;try{const result=await api('/api/studio/imports/douyin/commit',{method:'POST',body:JSON.stringify({previewId:batch.id})});douyinBatch=null;await load();douyinTab='materials';await openDouyinWorkspace();}catch(error){$('#pipeline-commit-message').textContent=error.message;button.disabled=false;}};
  const header=document.createElement('th');header.textContent='行详情';$('#pipeline-preview-result thead tr').append(header);
  $('#pipeline-preview-result').querySelectorAll('tbody tr').forEach((tr,index)=>{
    const cell=document.createElement('td');const button=document.createElement('button');button.className='small-btn';button.textContent='核对全文';
    button.onclick=()=>{const row=batch.rows[index];showDetail(`批次第 ${row.row} 行`, `<h3>${esc(row.title)}</h3><p class="job-sub">作者：${esc(row.author||'未知')} · 点赞：${esc(row.diggCount??'未知')} · 播放量：${row.playCountKnown?esc(row.playCount):'未知'}</p><p class="job-sub">原链接：${esc(row.url||'缺失')} · 发布时间：${esc(row.publishedAt||'未知')}</p><pre class="detail-text">${esc(row.transcript||'缺少正文，请在上方原始导出内容中补充后重新预检。')}</pre>`);};
    cell.append(button);tr.append(cell);
  });
}

function openPipelineDocument(id) {
  const doc=douyinWorkspace.documents.find(item=>item.id===id);
  showDetail('作品素材与创作入口',`<h3>${esc(doc.name)}</h3><p class="muted">${esc(doc.author||'作者未知')} · ${doc.playCountKnown?'播放量已导入':'播放量未知'}</p><pre class="detail-text">${esc(doc.content||'缺少转写正文，需要先补充材料。')}</pre><label for="pipeline-template">写作模板</label><select class="field" id="pipeline-template" style="display:block;width:100%;margin:8px 0">${state.data.templates.filter(item=>item.active).map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select><p class="job-sub">外部作品用于结构与观点研究，不作为你的个人经历。创建只保存草稿，不自动调用模型。</p><button class="primary" id="pipeline-create" ${doc.content?'':'disabled'}>从这条素材创建内容</button><p id="pipeline-create-error" role="status"></p>`);
  $('#pipeline-create').onclick=async()=>{try{const job=await api('/api/studio/douyin/create-content',{method:'POST',body:JSON.stringify({documentId:id,templateId:$('#pipeline-template').value})});state.jobId=job.id;state.view='studio';document.querySelector('.detail-sheet')?.remove();await load();}catch(error){$('#pipeline-create-error').textContent=error.message;}};
  const planField=document.createElement('div');
  planField.innerHTML='<label for="pipeline-task-plan">可选 Skill 组合</label><select class="field" id="pipeline-task-plan" style="display:block;width:100%;margin:8px 0"></select><p class="job-sub">组合只关联到内容任务，不自动调用 Skill 或模型。</p>';
  $('#pipeline-create').before(planField);
  const refreshPlans=()=>{
    const template=state.data.templates.find(item=>item.id===$('#pipeline-template').value);
    const format=template?.kind==='短帖'?'X 短帖':template?.kind==='Thread'?'X Thread':template?.kind;
    $('#pipeline-task-plan').innerHTML='<option value="">不绑定组合</option>'+douyinWorkspace.plans.filter(plan=>plan.format===format).map(plan=>`<option value="${esc(plan.id)}">${esc(plan.name)}</option>`).join('');
  };
  $('#pipeline-template').onchange=refreshPlans;refreshPlans();
  $('#pipeline-create').onclick=async()=>{
    const button=$('#pipeline-create');button.disabled=true;
    try{const job=await api('/api/studio/douyin/create-content',{method:'POST',body:JSON.stringify({documentId:id,templateId:$('#pipeline-template').value,planId:$('#pipeline-task-plan').value||null})});state.jobId=job.id;state.view='studio';document.querySelector('.detail-sheet')?.remove();await load();}
    catch(error){$('#pipeline-create-error').textContent=error.message;button.disabled=false;}
  };
}

function drawSkillPlan(node) {
  node.innerHTML=`<div class="pipeline-route"><strong>素材 → 选题价值 → 用户模板写作 → 按需审核 → 人工修订 → 发布复盘</strong><p class="job-sub">dbskill 提供诊断方法，不替代主 Prompt；当前可保存编排方案，尚未连接网页执行器。</p></div><label for="pipeline-format">目标体裁</label><select class="field" id="pipeline-format" style="margin:8px 0"><option>X 短帖</option><option>X Thread</option><option>视频口播</option></select><div id="pipeline-skills"></div><p class="job-sub">来源：<a href="https://github.com/dontbesilent2025/dbskill" target="_blank" rel="noreferrer">dontbesilent2025/dbskill</a> · CC BY-NC 4.0。商业使用授权尚未记录。保存方案不代表已执行或取得授权。</p><button class="primary" id="pipeline-save-plan">保存组合方案</button><p id="pipeline-plan-result" role="status"></p><h3 style="margin-top:20px">已保存方案</h3>${douyinWorkspace.plans.map(plan=>`<div class="job-row"><div><strong>${esc(plan.name)}</strong><div class="job-sub">${esc(plan.format)} · ${esc(plan.skills.join(' → '))}</div><span class="tag">${esc(plan.state)}</span></div></div>`).join('')||'<p class="muted">暂无方案</p>'}`;
  const show=()=>{const video=$('#pipeline-format').value==='视频口播';$('#pipeline-skills').innerHTML=pipelineSkills.map(([id,title,stage,detail])=>{const unavailable=!video&&['dbs-script-flow','dbs-title-cover-intro'].includes(id);return `<label class="pipeline-skill"><input type="checkbox" data-pipeline-skill="${id}" ${unavailable?'disabled':''} ${['dbs-ai-check','dbs-content-risk-check'].includes(id)?'checked':''}><div><strong>${title}</strong><span class="tag">${stage}</span><div class="job-sub">${detail}${unavailable?' · 仅视频场景':''}</div></div><span class="tag">待接执行</span></label>`;}).join('');};
  $('#pipeline-format').onchange=show;show();
  $('#pipeline-save-plan').onclick=async()=>{try{await api('/api/studio/douyin/plans',{method:'POST',body:JSON.stringify({name:`${$('#pipeline-format').value} · 按需诊断`,format:$('#pipeline-format').value,skills:[...document.querySelectorAll('[data-pipeline-skill]:checked')].map(input=>input.dataset.pipelineSkill)})});await openDouyinWorkspace();}catch(error){$('#pipeline-plan-result').textContent=error.message;}};
}
