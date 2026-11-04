// Preserve reading state while background status updates arrive.
function preserveCollectionReading(node, draw) {
  const details=[...node.querySelectorAll('details')].map((item,index)=>({key:item.dataset.readingKey||String(index),open:item.open}));
  const scrolls=[document.scrollingElement,...document.querySelectorAll('main,.main,.content,.collection-log-output')].filter(Boolean).map(item=>({item,top:item.scrollTop,left:item.scrollLeft,key:item.dataset?.logFor}));
  const focus=document.activeElement;
  if(node.contains(focus)&&focus?.matches('input,textarea,select'))return false;
  draw();
  [...node.querySelectorAll('details')].forEach((item,index)=>{const saved=details.find(d=>d.key===(item.dataset.readingKey||String(index)));if(saved)item.open=saved.open;});
  for(const saved of scrolls){const item=saved.key?node.querySelector(`[data-log-for="${CSS.escape(saved.key)}"]`):saved.item;if(item?.isConnected){item.scrollTop=saved.top;item.scrollLeft=saved.left;}}
  return true;
}
function collectionProgressLog(run,stages=[]) {
  const coverage=run.summary?.coverage||run.coverage;
  const needsLogin=String(coverage?.error||'').includes('platform_login_required');
  const imported=run.request?.mode==='text';
  const lines=[`任务 ${run.id}`,imported?`文案：已导入 ${run.rows?.length||run.count||0} 篇`:`采集：${coverage?.complete===false?'部分采集':collectionStateLabel(run.state)} · 已取得 ${run.rows?.length||run.count||0} 条`,
    imported?'来源：用户上传文案。':needsLogin?'需要你配合：抖音要求登录，已保留当前作品。点击下方“扫码登录抖音”，完成后重新采集。':coverage?.complete?'已确认平台末页。':coverage?.stopReason?`尚未采全：${coverage.stopReason}`:'正在等待平台返回作品…',run.logs||'',
    ...stages.map(stage=>`\n${stage.taskKind}：${collectionStateLabel(stage.state)}${stage.error?' · '+stage.error:''}\n${stage.logs||''}`),
    ...(run.workflow?[`自动流程：${run.workflow.state} / ${run.workflow.step}`,run.workflow.error||'']:[])];
  return `<section class="collection-progress" aria-label="任务进度与日志"><div class="panel-head"><h3>任务进度与日志</h3><span class="job-sub">每 3–4 秒更新 · 阅读时不会跳动</span></div>${needsLogin?'<p class="collection-error">抖音要求登录，当前作品未采全。</p>':''}<div class="actions">${needsLogin?'<button class="primary" data-douyin-login>扫码登录抖音</button>':''}<button class="small-btn" data-log-bottom="${esc(run.id)}">查看最新日志</button></div><pre class="collection-log-output" data-log-for="${esc(run.id)}" tabindex="0">${esc(lines.filter(Boolean).join('\n'))}</pre></section>`;
}
let douyinLoginTimer=null;
function bindDouyinLogin(root=document){
  root.querySelectorAll('[data-log-bottom]').forEach(button=>button.onclick=()=>{const log=root.querySelector(`[data-log-for="${CSS.escape(button.dataset.logBottom)}"]`);if(log)log.scrollTop=log.scrollHeight;});
  root.querySelectorAll('[data-douyin-login]').forEach(button=>button.onclick=async()=>{
    showDetail('扫码登录抖音','<p>将打开抖音浏览器窗口，请用手机抖音扫码。成功后只保存本机登录状态，不会自动重试转写或 AI 分析。</p><button class="primary" id="douyin-login-start">打开扫码窗口</button><p id="douyin-login-status" role="status"></p>');
    $('#douyin-login-start').onclick=async()=>{const b=$('#douyin-login-start');b.disabled=true;try{await api('/api/studio/douyin/login',{method:'POST',body:'{}'});pollDouyinLogin();}catch(error){$('#douyin-login-status').textContent=error.message;b.disabled=false;}};
    $('#douyin-login-start').click();
  });
}
async function pollDouyinLogin(){
  clearTimeout(douyinLoginTimer);if(!$('#douyin-login-status'))return;
  try{const result=await api('/api/studio/douyin/login');if(!$('#douyin-login-status'))return;$('#douyin-login-status').textContent=result.detail;
    if(result.state==='waiting')douyinLoginTimer=setTimeout(pollDouyinLogin,3000);
    if(result.state==='failed'){$('#douyin-login-start').disabled=false;$('#douyin-login-start').textContent='重新打开扫码窗口';}
    if(result.state==='succeeded'){$('#douyin-login-start').textContent='登录成功';$('#douyin-login-status').textContent+=' 关闭此窗口，点击“重新采集作品”补齐；原有结果保留。';}
  }catch(error){if($('#douyin-login-status'))$('#douyin-login-status').textContent=error.message;}
}

const collectionDraft={mode:'links',urls:'',maxVideos:30,filters:{},workflow:null,fields:['title','url','author','publishedAt','diggCount','collectCount','commentCount','shareCount']};
function collectionPasteUrls(text){const normalized=String(text).replace(/https?\\:\/\//g,value=>value.replace('\\',''));return (normalized.match(/https?:\/\/[^\s<>"，。！？；）】]+/g)||[]).join('\n')||normalized.trim();}
function collectionStageSummary(task){
  if(task.taskKind==='feishu-sync')return `已写入 ${task.recordIds?.length||0} 条 · 跳过已有 ${task.summary?.skipExisting||0} 条`;
  if(!task.summary)return '';
  return `${task.taskKind==='douyin-asr'?'新转写':'完成'} ${task.summary.succeeded||0} · 复用已有 ${task.summary.skipped||0} · 失败 ${task.summary.failed||0}`;
}

function collectionGuide(){
  return `<div class="collection-guide collection-guide-simple"><div><span>1</span><strong>贴链接，选好流程</strong><p>选择转写、导出和飞书同步</p></div><div><span>2</span><strong>后台自动处理</strong><p>查看进度；只有异常时需要处理</p></div><div><span>3</span><strong>选一篇去写作</strong><p>写作台改写，再用 dont 检查；保存与导出可选</p></div></div>`;
}

function collectionQuickAction(run,rows,textCount,ready){
  if(!ready)return '';
  const account=run.request?.mode==='profile'||run.request?.purpose==='account-analysis';
  const partial=run.summary?.coverage?.complete===false;
  return `<div class="collection-next"><div><strong>${textCount?`已有 ${textCount} 篇文案可以使用`:'先查看采集到的作品'}</strong><p>${partial?'本次只取得部分作品，尚未采全。':''}${textCount?'不必等全部转写完成，也不必先同步飞书。':'没有正文的作品可先看数据，再按需补文案。'}</p></div><button class="primary" ${account?'data-collection-account':'data-collection-works'}="${esc(run.id)}">${account?'查看作品与已有文案':'查看作品并选用'} →</button></div>`;
}

function renderCollectionForm(node){
  node.innerHTML=`<div class="collection-form-head"><div><h3>粘贴链接，开始采集</h3><p>在抖音点击「分享 → 复制链接」，把复制的内容粘贴到下面。</p></div><span class="tag">启动后自动执行所选流程</span></div><div class="collection-form-grid"><div><label for="collect-mode">采集什么</label><select class="field" id="collect-mode"><option value="links">几条指定视频</option><option value="profile">一个博主的作品</option></select></div><div id="collect-limit-wrap" ${collectionDraft.mode==='profile'?'':'hidden'}><label for="collect-limit">最多采集几条作品</label><input class="field" id="collect-limit" type="number" min="1" max="500" value="${esc(collectionDraft.maxVideos)}"></div></div><label for="collect-urls" id="collect-url-label">${collectionDraft.mode==='profile'?'粘贴博主主页链接':'在这里粘贴视频链接或抖音分享内容'}</label><textarea class="textarea" id="collect-urls" style="min-height:120px" placeholder="${collectionDraft.mode==='profile'?'粘贴一个抖音博主主页链接':'把抖音复制的整段分享内容粘贴在这里，也可以只贴链接。多个视频每行一条。'}">${esc(collectionDraft.urls)}</textarea><p class="collection-help" id="collect-input-help">${collectionDraft.mode==='profile'?'只接受一个主页；将按上面的数量上限采集。':'支持整段分享内容，自动识别其中的视频链接。标题、作者和互动数据会一起采集。'}</p><section class="collection-filter-panel"><h4>采集条件</h4>${collectionFilterFields('collect',collectionDraft.filters)}</section><div class="actions"><button class="primary" id="start-collection">开始采集</button><span id="collect-error" role="status"></span></div><div class="collection-list-head"><h3>当前采集任务</h3><button class="small-btn" id="refresh-collection">刷新任务状态</button></div><div id="collection-task-list">${collectionTaskRows()}</div>`;
  $('#collect-mode').value=collectionDraft.mode;
  const remember=()=>{collectionDraft.workflow={transcribe:true,saveLibrary:false,syncFeishu:false,confirmPaid:true};collectionDraft.mode=$('#collect-mode').value;collectionDraft.urls=$('#collect-urls').value;collectionDraft.maxVideos=Number($('#collect-limit').value);collectionDraft.filters=Object.fromEntries([...node.querySelectorAll('[data-collection-filter]')].filter(i=>i.value!=='').map(i=>[i.dataset.collectionFilter,Number(i.value||0)]));collectionDraft.fields=[...node.querySelectorAll('[data-collect-field]:checked')].map(i=>i.dataset.collectField);};
  node.addEventListener('input',remember);node.addEventListener('change',remember);
  $('#collect-mode').onchange=()=>{remember();const profile=collectionDraft.mode==='profile';$('#collect-limit-wrap').hidden=!profile;$('#collect-url-label').textContent=profile?'粘贴博主主页链接':'在这里粘贴视频链接或抖音分享内容';$('#collect-urls').placeholder=profile?'粘贴一个抖音博主主页链接':'把抖音复制的整段分享内容粘贴在这里，也可以只贴链接。多个视频每行一条。';$('#collect-input-help').textContent=profile?'只接受一个主页；将按上面的数量上限采集。':'支持整段分享内容，自动识别其中的视频链接。标题、作者和互动数据会一起采集。';};
  $('#refresh-collection').onclick=async()=>{try{await refreshCollectionTasks();}catch(error){$('#collect-error').textContent=error.message;}};
  $('#start-collection').onclick=async()=>{remember();const button=$('#start-collection');button.disabled=true;$('#collect-error').textContent='';try{if(!collectionDraft.urls.trim())throw new Error('请先粘贴视频或博主主页链接。');await api('/api/studio/douyin/collect',{method:'POST',body:JSON.stringify({...collectionDraft,urls:collectionPasteUrls(collectionDraft.urls)})});await refreshCollectionTasks();$('#collection-task-list').scrollIntoView({behavior:'smooth',block:'start'});$('#collect-error').textContent='采集中，完成后自动转文字。';}catch(error){$('#collect-error').textContent=error.message;}finally{button.disabled=false;}};
  bindCollectionTaskButtons(node);bindCollectionFlowButtons(node);
}

async function refreshCollectionTasks(){
  const result=await api('/api/studio/douyin/tasks');douyinWorkspace.tasks=result.tasks;douyinWorkspace.stageTasks=result.stageTasks||[];
  if($('#collection-task-list'))preserveCollectionReading($('#collection-task-list'),()=>{$('#collection-task-list').innerHTML=collectionTaskRows();bindCollectionTaskButtons($('#collection-task-list'));bindCollectionFlowButtons($('#collection-task-list'));});scheduleCollectionRefresh();
}

function renderCollectionRows(){
  return (douyinWorkspace.tasks||[]).filter(t=>t.request?.purpose!=='writing-dna').slice(0,1).map(run=>{
    const stages=(douyinWorkspace.stageTasks||[]).filter(t=>t.jobId===run.id),busy=run.state==='running'||run.workflow?.state==='running'||stages.some(t=>t.state==='running');
    const rows=run.rows||[],textCount=rows.filter(r=>String(r.transcript||r.content||'').trim()).length;
    const batches=(douyinWorkspace.batches||[]).filter(b=>b.taskId===run.id),ids=new Set(rows.map(r=>String(r.externalId||r.aweme_id||'')));
    const docs=douyinWorkspace.documents.filter(d=>batches.some(b=>b.id===d.batchId)||d.sourceTaskId===run.id||d.externalId&&ids.has(String(d.externalId)));
    const ready=run.state==='succeeded'&&rows.length>0;const asrReady=douyinWorkspace.capabilities.transcription==='configured';
    const stageText=busy?'处理中':collectionStateLabel(run.state);
    return `<article class="collection-task"><div class="panel-head"><div><h3>${esc(run.request?.mode==='profile'?(rows[0]?.author_name||rows[0]?.author||'博主作品采集'):(rows[0]?.title||run.request?.urls?.[0]||'采集任务'))}</h3><p class="collection-help">${esc(run.summary?.coverage?.complete===false?'部分采集':collectionStateLabel(run.state))} · ${esc(run.startedAt?new Date(run.startedAt).toLocaleString():'')} · ${rows.length||run.count||0} 条作品 · ${textCount} 条已有文字</p></div><span class="tag">${esc(stageText)}</span></div>${collectionWorkflowStatus(run)}${collectionProgressLog(run,stages)}${ready?`<div class="actions collection-destination-actions"><a class="small-btn" href="/api/studio/douyin/tasks/${encodeURIComponent(run.id)}/export?format=markdown" download>导出 Markdown</a><button class="small-btn" data-collection-sync="${esc(run.id)}" ${!textCount||busy||!douyinWorkspace.feishu?'disabled':''}>同步飞书</button></div>`:''}${run.error?`<p class="collection-error">${esc(run.error)}</p>`:''}<details class="collection-other-actions"><summary>其他操作：补正文、知识库、飞书与导出</summary><div class="collection-task-steps"><section><span class="collection-step-number">1</span><strong>作品资料</strong><p>${ready?`已取得 ${rows.length} 条作品`:'等待采集完成'}</p>${run.state==='running'?`<button class="small-btn" data-cancel-collection="${esc(run.id)}">取消采集</button>`:''}</section><section><span class="collection-step-number">2</span><strong>语音转文字</strong><p>${textCount?`${textCount} / ${rows.length} 条已有正文`:'取得语音正文后才能改写'}</p><button class="small-btn blue" data-stage-asr="${esc(run.id)}" ${!ready||busy||!asrReady?'disabled':''}>${textCount?'补充缺失的转写':'提取语音文字'}</button>${!asrReady?'<button class="collection-text-button" data-collection-settings>先配置转写服务</button>':''}</section><section><span class="collection-step-number">3</span><strong>保存资料 / 导出</strong><p>核对后存入本地知识库</p><button class="small-btn blue" data-collect-preview="${esc(run.id)}" ${!ready||busy?'disabled':''}>核对并存入知识库</button><div class="actions collection-export-actions">${ready?`<a class="small-btn" href="/api/studio/douyin/tasks/${encodeURIComponent(run.id)}/export?format=markdown" download>导出 Markdown</a><a class="small-btn" href="/api/studio/douyin/tasks/${encodeURIComponent(run.id)}/export?format=csv" download>导出飞书用 CSV</a>`:''}</div><button class="small-btn" data-collection-sync="${esc(run.id)}" ${!ready||busy||!textCount||!douyinWorkspace.feishu?'disabled':''}>同步到飞书</button><button class="collection-text-button" data-collection-feishu>${douyinWorkspace.feishu?'目标：'+esc(douyinWorkspace.feishu.tableName):'连接飞书 / 查看说明'}</button></section><section><span class="collection-step-number">4</span><strong>写文案 + dont 检查</strong><p>${docs.length?'资料已入库，带着原文去写作':'先完成左侧的核对入库'}</p><button class="small-btn blue" data-collection-write="${esc(docs.find(d=>d.content?.trim())?.id||'')}" ${!docs.some(d=>d.content?.trim())?'disabled':''}>用转写写文案 →</button></section></div></details>${stages.map(task=>`<p class="collection-stage-status">${task.taskKind==='douyin-asr'?'语音转写':task.taskKind==='feishu-sync'?'飞书同步':'评论采集'}：${esc(collectionStateLabel(task.state))}${collectionStageSummary(task)?' · '+esc(collectionStageSummary(task)):''}${task.error?` · ${esc(task.error)}`:''}${task.state==='unknown'||task.state==='partial'&&task.taskKind==='douyin-asr'&&task.summary?.unknown>0?` <button class="small-btn" data-resolve-run="${esc(task.id)}">重新转写</button>`:''}</p>`).join('')}<details class="collection-advanced"><summary>查看采集日志、筛选结果与评论操作</summary><p class="collection-help">${run.summary?`返回 ${run.summary.total} 条 · 筛选保留 ${run.summary.matched} 条 · 无效 ${run.summary.failedRows} 条`:''}</p>${ready?`<button class="small-btn" data-stage-comments="${esc(run.id)}" ${busy?'disabled':''}>补采评论原文（可选）</button>`:''}<pre class="detail-text">${esc(run.logs||'暂无日志')}</pre></details></article>`;
  }).join('')||'<div class="collection-empty"><strong>还没有采集任务</strong><p>在上面粘贴链接并点击“开始采集”。完成后这里会引导你转写、保存和写文案。</p></div>';
}

function collectionWorkflowStatus(run){
  const flow=run.workflow;if(!flow)return '';
  const labels={collected:'作品已采集',transcribe:'语音转文字',library:'保存知识库',feishu:'同步飞书',analysis:'AI 起号分析',done:'全部完成'};
  return `<div class="collection-flow-status" role="status"><strong>自动流程：${flow.state==='succeeded'?'已完成':flow.state==='paused'?'已暂停':labels[flow.step]||'正在执行'}</strong><p>${['transcribe','library','analysis','feishu'].filter(key=>({transcribe:flow.options.transcribe,library:flow.options.saveLibrary,feishu:flow.options.syncFeishu,analysis:flow.options.analyze})[key]).map(key=>`${labels[key]} ${flow.steps?.[key]?.state==='succeeded'?'✓'+(key==='transcribe'&&flow.steps[key].result?.reused?'（复用 '+flow.steps[key].result.reused+' 条正文）':key==='library'?'（'+(flow.steps[key].result?.documentIds?.length||0)+' 篇）':key==='feishu'?'（新增 '+(flow.steps[key].result?.written||0)+' 条）':''):flow.step===key&&flow.state==='running'?'处理中':'待完成'}`).join(' → ')}</p>${flow.error?`<p class="collection-error">${esc(flow.error)}</p>`:''}${flow.state==='paused'?`<button class="small-btn" data-workflow-resume="${esc(run.id)}">问题处理后继续流程</button>`:''}</div>`;
}
function bindCollectionFlowButtons(root=document){
  bindDouyinLogin(root);
  root.querySelectorAll('[data-workflow-resume]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await api(`/api/studio/douyin/tasks/${button.dataset.workflowResume}/workflow-resume`,{method:'POST',body:'{}'});if(douyinTab==='dna')await updateWritingDna();else await refreshCollectionTasks();}catch(error){toast(error.message,'error');}finally{button.disabled=false;}});

  root.querySelectorAll("[data-task-distill-start]").forEach(button=>button.onclick=()=>openTaskDistillation(button.dataset.taskDistillStart));
  root.querySelectorAll('[data-collection-works]').forEach(button=>button.onclick=()=>openCollectedWorks(button.dataset.collectionWorks));
  root.querySelectorAll('[data-collection-account]').forEach(button=>button.onclick=()=>{accountView.detail=true;accountView.taskId=button.dataset.collectionAccount;accountView.onlyText=false;accountView.category='全部作品';douyinTab='account';drawPipelineTab();});
  root.querySelectorAll('[data-collection-sync]').forEach(button=>button.onclick=async()=>{
    button.disabled=true;
    try{
      const result=await api(`/api/studio/douyin/tasks/${button.dataset.collectionSync}/feishu-preview`);
      if(result.reused){toast('这一批资料已经同步，不会重复写入。','success');return;}
      showDetail('确认同步到飞书',`<p>目标：<a href="${esc(result.target)}" target="_blank" rel="noreferrer">${esc(result.tableName)}</a></p><p>新增 ${result.create} 条；跳过已有链接 ${result.skipExisting} 条；缺少文字或来源 ${result.skipWithoutText} 条暂不发送。</p><p>只发送标题、作者、原链接、转写正文和已有互动数据。已有记录不覆盖，拆解与蒸馏字段留空。</p><button class="primary" id="confirm-feishu-sync">确认同步 ${result.create} 条</button><p id="feishu-sync-feedback" role="status"></p>`);
      $('#confirm-feishu-sync').onclick=async()=>{const submit=$('#confirm-feishu-sync');submit.disabled=true;$('#feishu-sync-feedback').textContent='正在写入飞书，请勿重复提交…';try{const run=await api(`/api/studio/douyin/tasks/${button.dataset.collectionSync}/feishu`,{method:'POST',body:JSON.stringify({confirmed:true,inputHash:result.inputHash})});$('#feishu-sync-feedback').textContent=`同步完成：新增 ${run.recordIds?.length||0} 条，跳过已有 ${run.summary?.skipExisting||0} 条。`;}catch(error){$('#feishu-sync-feedback').textContent=`${error.message}。结果不明确时请先核对飞书记录，不要重复发送。`;}};
    }catch(error){toast(error.message,'error');}finally{button.disabled=false;}
  });
  root.querySelectorAll('[data-collection-settings]').forEach(b=>b.onclick=()=>{state.view='settings';render();});
  root.querySelectorAll('[data-collection-feishu]').forEach(b=>b.onclick=()=>showDetail('飞书与 Markdown 怎么保存', `<p>“导出 Markdown”会下载包含原链接、作者和已有转写正文的 .md 文件。</p><p>${douyinWorkspace.feishu?`已连接飞书：<a href="${esc(douyinWorkspace.feishu.url)}" target="_blank" rel="noreferrer">${esc(douyinWorkspace.feishu.tableName)}</a>。点击“同步到飞书”，确认新增数量后写入；已有来源不重复添加。`:'尚未连接飞书目标表。'}“导出飞书用 CSV”则只下载文件，供你手动导入。</p><p>保存和同步不会执行 dont 方法。资料存入本地知识库后，点击“用转写写文案”，再在写作台运行 dontbesilent 检查。</p>`));
  root.querySelectorAll('[data-collection-write]').forEach(b=>b.onclick=()=>startMaterialWriting(b.dataset.collectionWrite));
}

function startMaterialWriting(id,templateId){
  const doc=douyinWorkspace.documents.find(d=>d.id===id)||state.data.documents.find(d=>d.id===id);
  if(!doc?.content?.trim())return toast('这份素材还没有语音正文，请先转写并核对入库。','error');
  openFullWriter({mode:'rewrite',format:'视频口播',title:doc.name,original:doc.content,materialIds:[doc.id],templateId,auditEngine:'model',auditSkills:['dbs-ai-check','dbs-content-risk-check']});
}


async function openCollectedWorks(taskId){
  let task;try{task=await api(`/api/studio/douyin/tasks/${taskId}`);}catch{return;}
  const rows=task.rows||[];if(!rows.length){toast('还没有收到作品，请等采集完成。','info');return;}
  const drafts=new Map();let current=0;
  const rowId=row=>String(row.externalId||row.aweme_id||'');
  const bodyText=row=>String(row.transcript||row.content||'');
  showDetail('查看作品与文案',`<label for="collected-work-choice">选择一条作品</label><select class="field" id="collected-work-choice" style="width:100%;margin:12px 0">${rows.map((row,i)=>`<option value="${i}">${esc(row.title||row.desc||'未命名作品')}</option>`).join('')}</select><p id="collected-work-source" class="collection-help"></p><p>有正文可直接改写；没有正文，可粘贴你已有的转写。不会调用语音服务。</p><label for="collected-work-text">这条作品的原文案</label><textarea class="textarea" id="collected-work-text" style="min-height:240px"></textarea><div class="actions"><button class="primary" id="collected-work-use">保存正文并带去写作</button></div><p id="collected-work-feedback" role="status"></p>`);
  const paint=()=>{const row=rows[current];$('#collected-work-text').value=drafts.get(rowId(row))??bodyText(row);$('#collected-work-source').textContent=`${row.author_name||row.author||'作者未知'} · ${row.publish_time||row.publishedAt||'时间未知'} · 点赞 ${row.diggCount??row.digg_count??'未知'} / 收藏 ${row.collectCount??row.collect_count??'未知'} / 评论 ${row.commentCount??row.comment_count??'未知'} / 转发 ${row.shareCount??row.share_count??'未知'}`;$('#collected-work-use').disabled=!$('#collected-work-text').value.trim();};
  $('#collected-work-choice').onchange=()=>{drafts.set(rowId(rows[current]),$('#collected-work-text').value);current=Number($('#collected-work-choice').value);$('#collected-work-feedback').textContent='';paint();};
  $('#collected-work-text').oninput=()=>{$('#collected-work-use').disabled=!$('#collected-work-text').value.trim();};
  $('#collected-work-use').onclick=async()=>{
    const button=$('#collected-work-use');button.disabled=true;const row=rows[current];let saved=false;
    try{await api(`/api/studio/douyin/tasks/${taskId}/transcript`,{method:'POST',body:JSON.stringify({videoId:rowId(row),url:row.url,text:$('#collected-work-text').value})});saved=true;const doc=await api(`/api/studio/douyin/tasks/${taskId}/prepare-writing`,{method:'POST',body:JSON.stringify({videoId:rowId(row),url:row.url})});await load();openFullWriter({mode:'rewrite',format:'视频口播',returnCollectionTaskId:taskId,title:doc.name,original:doc.content,materialIds:[doc.id],auditEngine:'model',auditSkills:['dbs-ai-check','dbs-content-risk-check']});}
    catch(error){$('#collected-work-feedback').textContent=(saved?'正文已保存，进入写作未完成：':'')+error.message;button.disabled=false;}
  };
  paint();
}
