const collectionStateLabel=value=>({running:'进行中',paused:'已暂停',succeeded:'已完成',failed:'失败',partial:'部分完成',unknown:'未完成',cancelled:'已取消'})[value]||value;
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
let douyinTab = 'collect';
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
  const stage=(title,detail,ready)=>`<div class="pipeline-stage"><strong>${title}</strong><span class="tag">${ready?'可用':'未配置'}</span><p class="job-sub">${detail}</p></div>`;
  shell('','启动前选好转写、知识库和飞书同步，后台自动执行；完成后选素材去写作。',`
    ${collectionGuide()}
    <div class="panel" style="margin:16px 0">
    <div class="tabs pipeline-tabs" aria-label="采集与分析">${[['collect','采集任务'],['account','起号分析'],['dna','写作蒸馏']].map(([key,label])=>`<button class="tab ${douyinTab===key?'active':''}" data-pipeline-tab="${key}">${label}</button>`).join('')}</div>
    <div id="pipeline-content"></div></div>
    <section class="panel" id="pipeline-import" ${douyinBatch?'':'hidden'}><div class="panel-head"><h3>导入与预检</h3><span class="tag">确认后才入库</span></div><label for="pipeline-file">导出文件</label><input class="field" id="pipeline-file" type="file" accept=".json,.jsonl,.csv,.xlsx" style="display:block;width:100%;margin:8px 0"><label for="pipeline-text">JSON / JSONL / CSV 原始内容</label><textarea class="textarea" id="pipeline-text" style="min-height:150px" placeholder="粘贴 douyin-material-pipeline 导出内容"></textarea><div class="actions" style="margin-top:12px"><button class="primary" id="pipeline-preview">预检字段与正文</button><span id="pipeline-feedback" role="status" class="muted"></span></div><div id="pipeline-preview-result"></div></section>`);
  document.querySelectorAll('[data-pipeline-tab]').forEach(button=>button.onclick=()=>{douyinTab=button.dataset.pipelineTab;if(['account','tasks'].includes(douyinTab)){accountView.detail=false;accountView.taskId=null;}drawPipelineTab();});
  if($('#pipeline-open-import'))$('#pipeline-open-import').onclick=()=>{$('#pipeline-import').hidden=false;$('#pipeline-import').scrollIntoView({behavior:'smooth',block:'start'});$('#pipeline-text').focus();};
  $('#pipeline-file').onchange=async()=>{const file=$('#pipeline-file').files?.[0];if(!file)return;if(file.size>4*1024*1024){$('#pipeline-feedback').textContent='文件超过 4 MB，请拆分后导入。';return;}if(/\.xlsx$/i.test(file.name)){$('#pipeline-text').value='';$('#pipeline-feedback').textContent='已选择 Excel，点击预检将解析表头与行。';}else $('#pipeline-text').value=await file.text();};
  $('#pipeline-preview').onclick=async()=>{
    const button=$('#pipeline-preview');button.disabled=true;$('#pipeline-feedback').textContent='预检中…';
    try{const result=await api('/api/studio/imports/douyin/preview',{method:'POST',body:JSON.stringify($('#pipeline-file').files?.[0]&&/\.xlsx$/i.test($('#pipeline-file').files[0].name)?await importPayload($('#pipeline-file').files[0]):{text:$('#pipeline-text').value})});douyinBatch=await api(`/api/studio/douyin/batches/${result.id}`);$('#pipeline-feedback').textContent='预检完成，请核对下方行数据。';drawBatchPreview();}
    catch(error){$('#pipeline-feedback').textContent=error.message;}finally{button.disabled=false;}
  };
  drawPipelineTab();
  if(douyinBatch)drawBatchPreview();
  bindEvents();
}

function drawPipelineTab() {
  document.querySelectorAll('.nav[data-view="douyin"]').forEach(button=>button.classList.toggle('active',Boolean(button.hasAttribute('data-account-entry'))===(douyinTab==='account')));
  document.querySelectorAll('[data-pipeline-tab]').forEach(button=>button.classList.toggle('active',button.dataset.pipelineTab===douyinTab));
  document.querySelectorAll('.nav').forEach(button=>button.classList.toggle('active',button.dataset.view==='douyin'&&(button.hasAttribute('data-task-entry')?(douyinTab==='tasks'):(douyinTab!=='tasks'))));
  const tabs=document.querySelector('.pipeline-tabs');if(tabs)tabs.hidden=douyinTab==='tasks';
  const node=$('#pipeline-content');
  node.parentElement.classList.toggle('account-mode',['account','tasks'].includes(douyinTab));
  node.parentElement.classList.toggle('collect-mode',douyinTab==='collect');
  document.querySelector('.collection-guide')?.classList.toggle('account-mode-hidden',['account','tasks'].includes(douyinTab));
  if(douyinTab==='materials') {
    node.innerHTML='<label for="pipeline-search">筛选标题、作者或口播正文</label><input class="field" id="pipeline-search" placeholder="搜索素材" style="width:100%;margin:8px 0 14px"><div id="pipeline-materials"></div>';
    const show=()=>{const q=$('#pipeline-search').value.toLowerCase();const docs=douyinWorkspace.documents.filter(doc=>[doc.name,doc.author,doc.content].join(' ').toLowerCase().includes(q));$('#pipeline-materials').innerHTML=docs.length?`<div class="pipeline-table-wrap"><table class="pipeline-table"><thead><tr><th>作品 / 作者</th><th>口播正文</th><th>点赞</th><th>播放量</th><th>操作</th></tr></thead><tbody>${docs.map(doc=>`<tr><td><strong>${esc(doc.name)}</strong><div class="job-sub">${esc(doc.author||'作者未知')}</div></td><td>${doc.content?'正文已导入':'缺少正文'}</td><td>${esc(doc.diggCount??'未知')}</td><td>${doc.playCountKnown?esc(doc.playCount):'未知'}</td><td><button class="small-btn" data-pipeline-doc="${esc(doc.id)}">查看 / 创建内容</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">暂无匹配素材。先导入流水线导出的 JSON、JSONL 或 CSV，再核对后入库。</div>';document.querySelectorAll('[data-pipeline-doc]').forEach(button=>button.onclick=()=>openPipelineDocument(button.dataset.pipelineDoc));};
    $('#pipeline-search').oninput=show;show();
  } else if(douyinTab==='batches') {
    node.innerHTML=douyinWorkspace.batches.map(batch=>`<div class="job-row"><span class="tag">${esc(batch.state)}</span><div><div class="job-title">${batch.count} 条作品 · 播放量未知 ${batch.unknownPlayCount} 条</div><div class="job-sub">${esc(batch.createdAt)}</div></div><button class="small-btn" style="margin-left:auto" data-pipeline-batch="${esc(batch.id)}">查看批次</button></div>`).join('')||'<div class="empty">暂无导入批次</div>';
    document.querySelectorAll('[data-pipeline-batch]').forEach(button=>button.onclick=async()=>{douyinBatch=await api(`/api/studio/douyin/batches/${button.dataset.pipelineBatch}`);$('#pipeline-import').hidden=false;drawBatchPreview();$('#pipeline-preview-result').scrollIntoView({block:'start'});});
  } else if(douyinTab==='collect') { drawCollectionTasks(node); scheduleCollectionRefresh(); }
  else if(douyinTab==='dna') { drawWritingDna(node); }
  else if(['account','tasks'].includes(douyinTab)) { drawAccountAnalysis(node); }
  else drawSkillPlan(node);
}

function drawCollectionTasks(node){ renderCollectionForm(node); }

function scheduleCollectionRefresh(){
  clearTimeout(collectionRefresh);
  if(state.view!=='douyin'||douyinTab!=='collect'||![...(douyinWorkspace.tasks||[]),...(douyinWorkspace.stageTasks||[])].some(run=>run.state==='running'||run.workflow?.state==='running'))return;
  collectionRefresh=setTimeout(async()=>{
    if(state.view!=='douyin'||douyinTab!=='collect')return;
    try{const result=await api('/api/studio/douyin/tasks');douyinWorkspace.tasks=result.tasks;douyinWorkspace.stageTasks=result.stageTasks||[];
      const table=document.querySelector('#collection-task-list');
      if(table)preserveCollectionReading(table,()=>{table.innerHTML=collectionTaskRows();bindCollectionTaskButtons(table);bindCollectionFlowButtons(table);});
    }catch(error){const feedback=$('#collect-error');if(feedback)feedback.textContent=`状态刷新失败：${error.message}`;}
    scheduleCollectionRefresh();
  },3000);
}

function collectionTaskRows(){ return renderCollectionRows(); }

function bindCollectionTaskButtons(root=document){
  root.querySelectorAll('[data-stage-comments],[data-stage-asr]').forEach(button=>button.onclick=async()=>{
    const asr=Boolean(button.dataset.stageAsr);const id=button.dataset.stageAsr||button.dataset.stageComments;
    const execute=async()=>{button.disabled=true;try{await api(`/api/studio/douyin/tasks/${id}/${asr?'asr':'comments'}`,{method:'POST',body:JSON.stringify({confirmPaid:asr})});document.querySelector('.detail-sheet')?.remove();await openDouyinWorkspace();}catch(error){toast(error.message,'error');button.disabled=false;}};
    if(!asr)return execute();
    showDetail('补跑语音转写','<p class="muted">此步骤会调用已配置的阿里云 ASR，可能产生费用。作品数据会保留；结果未知时不会自动重试。</p><label><input type="checkbox" id="confirm-asr-cost"> 我确认调用 ASR 并承担对应费用</label><button class="primary" id="execute-asr" disabled style="margin-top:12px">开始转写</button>');
    $('#confirm-asr-cost').onchange=()=>{$('#execute-asr').disabled=!$('#confirm-asr-cost').checked;};$('#execute-asr').onclick=execute;
  });

  bindUnknownResolution();
  root.querySelectorAll('[data-cancel-collection]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await api(`/api/studio/douyin/tasks/${button.dataset.cancelCollection}/cancel`,{method:'POST',body:'{}'});await openDouyinWorkspace();}catch(error){const out=$('#collect-error');if(out)out.textContent=error.message;button.disabled=false;}});
  root.querySelectorAll('[data-collect-preview]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const result=await api(`/api/studio/douyin/tasks/${button.dataset.collectPreview}/preview`,{method:'POST',body:'{}'});douyinBatch=await api(`/api/studio/douyin/batches/${result.id}`);$('#pipeline-import').hidden=false;drawBatchPreview();$('#pipeline-import').scrollIntoView({block:'start'});}catch(error){const out=$('#collect-error');if(out)out.textContent=error.message;button.disabled=false;}});
}

function drawBatchPreview() {
  const batch=douyinBatch;
  $('#pipeline-preview-result').innerHTML=`<p class="muted">${batch.count} 条 · 播放量未知 ${batch.unknownPlayCount} 条 · ${batch.rows.filter(row=>!row.transcript).length} 条缺正文。未知播放量不以点赞折算。</p><div class="actions"><a class="small-btn" href="/api/studio/douyin/batches/${encodeURIComponent(batch.id)}/export?format=markdown" target="_blank" rel="noreferrer">导出 Markdown</a><a class="small-btn" href="/api/studio/douyin/batches/${encodeURIComponent(batch.id)}/export?format=json" target="_blank" rel="noreferrer">导出 JSON</a><a class="small-btn" href="/api/studio/douyin/batches/${encodeURIComponent(batch.id)}/export?format=csv" target="_blank" rel="noreferrer">导出飞书用 CSV</a><span class="tag">自动推送关闭</span></div><div class="pipeline-table-wrap"><table class="pipeline-table"><thead><tr><th>行</th><th>标题</th><th>作者</th><th>正文</th><th>播放量</th></tr></thead><tbody>${batch.rows.slice(0,50).map(row=>`<tr><td>${row.row}</td><td>${esc(row.title)}</td><td>${esc(row.author||'未知')}</td><td>${row.transcript?'有':'缺失'}</td><td>${row.playCountKnown?esc(row.playCount):'未知'}</td></tr>`).join('')}</tbody></table></div><p class="job-sub">${batch.count>50?'预览前 50 条，确认将处理全部行。':''}</p><button class="primary" id="pipeline-commit" ${batch.state==='已入库'?'disabled':''}>${batch.state==='已入库'?'该批次已入库':'确认存入知识库'}</button><span id="pipeline-commit-message" role="status"></span>`;
  $('#pipeline-commit').onclick=async()=>{const button=$('#pipeline-commit');button.disabled=true;try{const result=await api('/api/studio/imports/douyin/commit',{method:'POST',body:JSON.stringify({previewId:batch.id})});douyinBatch=null;await load();douyinTab='materials';await openDouyinWorkspace();}catch(error){$('#pipeline-commit-message').textContent=error.message;button.disabled=false;}};
  const header=document.createElement('th');header.textContent='行详情';$('#pipeline-preview-result thead tr').append(header);
  $('#pipeline-preview-result').querySelectorAll('tbody tr').forEach((tr,index)=>{
    const cell=document.createElement('td');const button=document.createElement('button');button.className='small-btn';button.textContent='核对全文';
    button.onclick=()=>{const row=batch.rows[index];showDetail(`批次第 ${row.row} 行`, `<h3>${esc(row.title)}</h3><p class="job-sub">作者：${esc(row.author||'未知')} · 点赞：${esc(row.diggCount??'未知')} · 播放量：${row.playCountKnown?esc(row.playCount):'未知'}</p><p class="job-sub">原链接：${esc(row.url||'缺失')} · 发布时间：${esc(row.publishedAt||'未知')}</p><pre class="detail-text">${esc(row.transcript||'缺少正文，请在上方原始导出内容中补充后重新预检。')}</pre>`);};
    cell.append(button);tr.append(cell);
  });
}

function openPipelineDocument(id) { startMaterialWriting(id); }

function drawSkillPlan(node) {
  node.innerHTML=`<div class="pipeline-route"><strong>素材 → 选题价值 → 用户模板写作 → 按需审核 → 人工修订 → 发布复盘</strong><p class="job-sub">保存常用检查组合，绑定到文案任务；写完后可运行本地快检或模型诊断。</p></div><label for="pipeline-format">目标体裁</label><select class="field" id="pipeline-format" style="margin:8px 0"><option>X 短帖</option><option>X Thread</option><option>视频口播</option></select><div id="pipeline-skills"></div><p class="job-sub">来源：<a href="https://github.com/dontbesilent2025/dbskill" target="_blank" rel="noreferrer">dontbesilent2025/dbskill</a> · CC BY-NC 4.0。商业使用授权尚未记录。保存方案不代表已执行或取得授权。</p><button class="primary" id="pipeline-save-plan">保存组合方案</button><p id="pipeline-plan-result" role="status"></p><h3 style="margin-top:20px">已保存方案</h3>${douyinWorkspace.plans.map(plan=>`<div class="job-row"><div><strong>${esc(plan.name)}</strong><div class="job-sub">${esc(plan.format)} · ${esc(plan.skills.join(' → '))}</div><span class="tag">${esc(plan.state)}</span></div></div>`).join('')||'<p class="muted">暂无方案</p>'}`;
  const show=()=>{const video=$('#pipeline-format').value==='视频口播';$('#pipeline-skills').innerHTML=pipelineSkills.map(([id,title,stage,detail])=>{const unavailable=!video&&['dbs-script-flow','dbs-title-cover-intro'].includes(id);return `<label class="pipeline-skill"><input type="checkbox" data-pipeline-skill="${id}" ${unavailable?'disabled':''} ${['dbs-ai-check','dbs-content-risk-check'].includes(id)?'checked':''}><div><strong>${title}</strong><span class="tag">${stage}</span><div class="job-sub">${detail}${unavailable?' · 仅视频场景':''}</div></div><span class="tag">待接执行</span></label>`;}).join('');};
  $('#pipeline-format').onchange=show;show();
  $('#pipeline-save-plan').onclick=async()=>{try{await api('/api/studio/douyin/plans',{method:'POST',body:JSON.stringify({name:`${$('#pipeline-format').value} · 按需诊断`,format:$('#pipeline-format').value,skills:[...document.querySelectorAll('[data-pipeline-skill]:checked')].map(input=>input.dataset.pipelineSkill)})});await openDouyinWorkspace();}catch(error){$('#pipeline-plan-result').textContent=error.message;}};
}
