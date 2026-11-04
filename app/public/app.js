const state = { data: null, view: 'home', jobId: null, templateId: null, topicId: null };
try { const saved=JSON.parse(sessionStorage.getItem('studio-current-writer')||'null'); if(saved?.jobId){state.view='studio';state.jobId=saved.jobId;} } catch {}
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const asyncTaskKind = run => run.request?.purpose === 'writing-dna' ? '写作蒸馏' : run.request?.mode === 'profile' ? '起号分析' : '采集任务';
const asyncTaskState = run => ({ running: '进行中', succeeded: '已完成', failed: '失败', paused: '已暂停', partial: '部分完成', unknown: '未完成' })[run.workflow?.state || run.state] || run.workflow?.state || run.state || '';

function toast(message, tone = 'info') {
  let node = document.querySelector('.studio-toast');
  if (!node) { node = document.createElement('div'); node.className = 'studio-toast'; document.body.appendChild(node); }
  node.className = `studio-toast ${tone}`; node.textContent = message; node.hidden = false;
  clearTimeout(node._timer); node._timer = setTimeout(() => { node.hidden = true; }, 3200);
}

async function api(path, options = {}) {
  const finishFeedback=globalThis.submissionFeedback?.()||(()=>{});
  try {
  let response;
  try{response=await fetch(path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});}catch{throw new Error('连接不到本地工作台，请确认服务已启动后再刷新。');}
  let data;try{data=await response.json();}catch{const error=new Error(`工作台没有返回有效数据（HTTP ${response.status}），请稍后刷新。`);error.code='invalid_server_response';throw error;}
  if (response.status === 401) { showLogin(); throw new Error('需要本地工作台登录'); }
  if (!response.ok) { const labels={revision_outside_selected_issues:'修改涉及未勾选内容，已拦住并保留原稿',invalid_revision_edits:'修改意见已变化，请重新选择',revision_edits_incomplete:'局部修改未返回完整结果，原稿已保留',collector_python_dependencies_missing:'采集环境缺少 requests 或 Playwright，请修复采集 Python 配置',invalid_collection_range:'最高值不能小于最低值',invalid_collection_filter:'采集条件请填写不小于零的数值',section_boundaries_required:'正文不足三个段落或句子，无法单独改写中间内容',invalid_writing_recognition:'模型未返回有效的写法识别结果',model_configuration_busy:'当前模型任务结束后才能切换配置',account_analysis_model_required:'起号 AI 分析需要先配置并开启模型服务',analysis_cost_confirmation_required:'请先确认本次 AI 分析调用',revision_draft_changed:'正文、风格或知识库已变化，请重新检查后生成修改稿',revision_review_changed:'审核意见已变化，请重新检查',select_revision_issues:'请勾选需要 AI 修改的意见',revision_has_no_changes:'修改稿与原文相同，请调整意见后重试',audit_revision_failed:'修改未完成，原文已保留',feishu_target_changed:'飞书目标已改变，请重新确认',audit_required_for_current_body:'正文或配置已变化，请先重新检查当前版本',selected_model_audit_required:'本次选择了模型检查，请运行所选方法后再定稿',select_audit_methods_first:'请至少选择一种检查方法',audit_requires_revalidation:'已采用修改，请重新检查后定稿',resolve_audit_issues_before_finalize:'请先采用或忽略待处理建议',draft_changed_during_audit:'检查期间文案已更新，结果未覆盖新稿，请重新检查',job_cancelled:'任务已取消，请先恢复任务后再操作',model_output_truncated:"模型输出过长被截断，素材已保留，请减少报告长度后重新提炼",select_1_to_30_materials:"请选择 1—30 篇有正文的素材",materials_too_long_select_fewer:"所选素材过长，请减少本次学习的篇数",materials_changed_please_distill_again:"素材已更新，请重新提炼再保存模板",material_distillation_failed:"本次写法提炼未完成，原素材已保留",model_timeout:'模型请求超时或网络中断，已自动重试一次仍失败，请稍后直接重试',model_empty_output:"模型没有返回正文（推理占满了输出额度），请直接重试或换用非推理模型",model_network_failed:"模型连接被中断，已自动重试 2 次仍失败，请直接重试",invalid_writing_recognition_json:"模型返回的识别结果不是合法 JSON，请重试",generation_outcome_unknown:"生成未完成，原稿已保留",generation_in_progress:"模型正在处理，请等待完成",template_name_and_prompt_required:"请填写模板名称和完整系统提示词",word_count_must_be_80_to_5000:"目标字数请填写 80—5000",model_not_configured:"请先在连接和设置中配置写作模型",model_calls_disabled:"写作模型调用尚未开启",stop_or_review_running_analysis_before_edit:'资料仍在处理中，请等待当前任务结束后再保存',source_processing_in_progress:'这批资料正在处理，请稍后继续',analysis_previous_response_needs_review:'上次分析未完成',account_analysis_in_progress:'AI 正在分析这批作品，请等待完成',stage_running_or_outcome_unknown:'转写或评论任务尚未完成，请先查看任务状态',asr_not_configured:'尚未配置语音转写；也可粘贴已有文案继续写作',collection_in_progress:'已有采集任务正在运行，请先查看当前任务',transcript_required_before_writing:'这条作品尚无正文，请先补充文案',collection_result_unavailable:'采集结果尚未就绪，请先查看任务状态',asset_name_required:'素材库名称不能为空',feishu_table_param_missing:'链接中缺少数据表，请复制包含 table 参数的飞书链接',invalid_markdown_file:'请选择非空且不超过20万字的 Markdown 文件',invalid_source_type:'请选择飞书或 Markdown 来源',source_has_no_content:'来源中没有正文，未创建素材库',hook_library_requires_workbench:'所选黄金三秒素材库需通过写作工作台的开始生成或开始改写执行',hook_library_not_found:'黄金三秒素材库不存在或已删除',invalid_feishu_link:'请填写包含数据表 table 参数的有效飞书链接',feishu_table_no_fields:'飞书表中没有可读取字段',feishu_pagination_incomplete:'飞书分页未完成，未使用部分缓存',hook_library_empty:'黄金三秒素材库没有可读取的案例',hook_library_in_use:'该黄金三秒素材库正在用于写作，请任务完成后再编辑或删除',hook_library_name_and_kind_required:'请填写素材库名称和来源类型',feishu_sync_failed:'飞书写入失败，请查看运行记录',saved_response_not_recoverable:'已保存的模型回复无法恢复为正文',audit_replacement_identical_to_quote:'替换文字与原文相同，请填写真实改法'};const upstreamTimeout=data.detail==='model_http_522';const title=upstreamTimeout?'模型服务连接超时（522），原稿已保留。请查看运行记录，或在连接和设置中更换 API。':labels[data.error]||data.error||`HTTP ${response.status}`;const error = new Error(!upstreamTimeout&&data.detail ? `${title}：${data.detail}` : title); error.code = data.error; error.runId = data.runId; toast(error.message, 'error'); throw error; }
  return data;
  } finally { finishFeedback(); }
}

function showLogin() {
  location.replace('/login');
}

let loadSequence=0;
async function load() {
  const sequence=++loadSequence;
  const data=await api('/api/studio/overview');
  const [runtimeStatus,authStatus,hermesStatus,dependencies,writingStyles]=await Promise.all([
    api('/api/studio/runtime/status').catch(()=>null),api('/api/studio/auth/status'),
    api('/api/studio/integrations/hermes/status').catch(()=>null),api('/api/studio/runtime/dependencies').catch(()=>null),api('/api/studio/writing/styles').catch(()=>null)
  ]);
  if(sequence!==loadSequence)return;
  state.data={...data,runtimeStatus,hermesStatus,dependencies,writingStyles};state.authStatus=authStatus;render();
}

const capabilityLabel=value=>({adapter_ready:'采集器已接通',not_configured:'未配置',configured:'已配置',ready:'本机服务已连接',live:'已接入',local_compatibility:'方法文档辅助',export_only:'仅导出文件'})[value]||value||'尚未检查';

function shell(title, subtitle, content) {
  $('#page-title').textContent = title;
  const integration = state.data?.integration?.aihot;
  const badge = integration?.mode === 'live' ? 'AIHOT 已连接' : integration?.mode === 'error' ? `AIHOT 同步失败：${esc(integration.lastError)}` : '演示数据 · 未连接 AIHOT';
  const runtime = state.data?.runtimeStatus;
  const runtimePanel = title === '来源与连接' && runtime ? `<section class="panel" style="margin-bottom:14px"><div class="panel-head"><div><h3>本地运行状态</h3><div class="job-sub">Node ${esc(runtime.node)} · ${esc(runtime.host)}:${esc(runtime.port)}</div></div><span class="tag">本机开发</span></div><div class="chips"><span class="chip">模型调用：${runtime.modelCallsEnabled ? '开启' : '关闭'}</span><span class="chip">采集：${runtime.collectionEnabled ? '开启' : '关闭'}</span><span class="chip">飞书推送：${runtime.feishuPushEnabled ? '开启' : '关闭'}</span><span class="chip">自动发布：关闭</span><span class="chip">模型：${esc(runtime.model)}</span></div>${runtime.modelService?`<p class="${['outcome_unknown','degraded'].includes(runtime.modelService.state)?'collection-error':'job-sub'}" role="status">模型服务：${esc(runtime.modelService.detail)}</p>`:''}</section>` : '';
  if(['library','templates'].includes(state.view)){title='素材与模板';content=`<div class="tabs asset-module-tabs"><button class="tab ${state.view==='library'?'active':''}" data-view="library">素材库</button><button class="tab ${state.view==='templates'?'active':''}" data-view="templates">写作模板</button></div>`+content;}
  $('#page-title').textContent=title;
  $('#app').innerHTML = `<div class="page"><div class="welcome"><div><div class="muted">${subtitle}</div></div><span class="tag" title="情报来源状态">${badge}</span></div>${runtimePanel}${content}</div>`;

}

function jobRow(job) {
  const source=String(job.entry||'').includes('AIHOT')?'AIHOT 情报':job.entry==='抖音素材库'?'视频素材':job.entry==='参考改写'?'原稿改写':job.entry==='手动想法'?'手动想法':job.entry;
  return `<div class="job-row"><span class="status ${job.status === '已定稿' || job.status === '已发布' ? 'done' : ''}">${esc(job.status)}</span><div><div class="job-title">${esc(job.title)}</div><div class="job-sub">${esc(source)} · ${esc(job.template)} · ${esc(job.updatedAt)}</div></div><div class="actions" style="margin-left:auto"><button class="small-btn" data-open-job="${esc(job.id)}">打开</button>${!['已发布','已取消'].includes(job.status) ? `<button class="small-btn" data-cancel-job="${esc(job.id)}">取消</button>` : ''}</div></div>`;
}
function isActionableJob(job) {
  const title = String(job.title || '').trim();
  return Boolean(title||job.topic||job.originalBody||job.body) && !job.archived && !job.hidden && !title.includes('取消验证') && !title.includes('验证发布') && !title.includes('验证任务') && !['已取消','已发布','已定稿'].includes(job.status);
}

function formatCost(run) {
  return run.cost === null || run.cost === undefined ? '费用未知，需核对网关账单' : `${run.cost}${run.currency ? ` ${run.currency}` : ''}`;
}

function runDetails(run) {
  const responses = run.responses || [];
  return `<article class="job-row" style="display:block"><div class="panel-head"><strong class="job-title">${esc(run.taskKind)} · ${esc(run.state)}</strong><span class="tag">${esc(run.model || '本地处理')}</span></div><div class="job-sub">${esc(run.startedAt || '')} → ${esc(run.finishedAt || '尚未结束')}</div><div class="job-sub">${esc(formatCost(run))} · 请求 ${esc(run.attempts ?? responses.length)} 次</div>${run.error ? `<p class="issue">${esc(run.error)}</p>` : ''}${run.state==='unknown'?`<button class="small-btn" data-resolve-run="${esc(run.id)}">重新转写</button>`:''}<div class="job-sub">输入指纹：${esc(run.inputHash || '未记录')}</div>${responses.map((response, index) => `<details style="margin-top:10px"><summary>响应 ${index + 1} · ${esc(response.receivedAt || '')}</summary><pre class="detail-text">${esc(JSON.stringify(response.usage || {}, null, 2))}</pre><pre class="detail-text">${esc(response.raw || '')}</pre></details>`).join('')}</article>`;
}

async function showJobRuns(jobId) {
  const runs = await api(`/api/studio/jobs/${encodeURIComponent(jobId)}/runs`);
  showDetail('任务运行记录', runs.map(runDetails).join('') || '<div class="empty">暂无运行记录</div>');bindUnknownResolution();
}

function splitThread(body) {
  const blocks = String(body || '').split(/\n\s*\n/).map(item => item.trim()).filter(Boolean);
  if (blocks.length > 1) return blocks;
  const text = String(body || '').trim();
  return text ? text.match(/.{1,220}(?:\s+|$)/g)?.map(item => item.trim()).filter(Boolean) || [text] : [''];
}

function newsDate(value){const date=new Date(value);return value&&!Number.isNaN(date.getTime())?new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Shanghai'}).format(date):'';}
function newsCard(item) {
  return `<article class="news-card"><div class="news-top"><div><div class="news-title" title="${esc(item.originalTitle||item.title)}">${esc(item.title)}</div><div class="news-meta">${esc(item.source)} · ${esc(newsDate(item.publishedAt))}</div></div><span class="tag">${esc(item.status)}</span></div><p class="news-summary">${esc(item.summary)}</p><div class="actions"><button class="small-btn blue" data-write="${esc(item.id)}">用这条情报写文案</button><button class="small-btn" data-topic="${esc(item.id)}">找写作角度</button><button class="small-btn" data-favorite="${esc(item.id)}">${item.status === '已收藏' ? '取消收藏' : '收藏素材'}</button><button class="small-btn" data-intelligence-analyze="${esc(item.id)}">AI 整理</button><button class="small-btn" data-source-detail="${esc(item.id)}">查看来源</button></div></article>`;
}

function home() { renderFullWriter(); }

function intelligenceItems(sources = state.data.sources, filters = {}) {
  const query = String(filters.query || '').trim().toLowerCase();
  return sources.filter(item => item.origin === 'aihot-live' && !item.demo
    && (!query || [item.title, item.summary, item.source].join(' ').toLowerCase().includes(query))
    && (!filters.source || item.source === filters.source)
    && (!filters.category || item.category === filters.category)
    && (!filters.tab || filters.tab === 'all' || filters.tab === 'favorites' && item.status === '已收藏' || filters.tab === 'selected' && item.selected));
}

function refreshIntelligence() {
  const items = intelligenceItems(state.data.sources, {
    query: $('#intel-query')?.value, source: $('#intel-source')?.value,
    category: $('#intel-category')?.value,
    tab: document.querySelector('[data-filter].active')?.dataset.filter || 'all'
  });
  $('#intel-list').innerHTML = items.map(newsCard).join('') || '<div class="empty">没有符合条件的情报。收录文案请到“素材库”查看。</div>';
  bindEvents();
}

function intel() {
  const items = intelligenceItems();
  const sources = [...new Set(items.map(item => item.source).filter(Boolean))].slice(0, 12);
  const categories = [...new Set(items.map(item => item.category).filter(Boolean))];
  shell('情报中心', '这里显示 AIHOT 采集的资讯；你收录的文案和转写内容在“素材库”，可供写作引用。', `<div class="panel" style="margin-bottom:14px"><div class="grid" style="grid-template-columns:1.4fr 1fr 1fr"><input class="field" id="intel-query" placeholder="搜索标题、摘要或来源"><select class="field" id="intel-source"><option value="">全部来源</option>${sources.map(item => `<option>${esc(item)}</option>`).join('')}</select><select class="field" id="intel-category"><option value="">全部分类</option>${categories.map(item => `<option>${esc(item)}</option>`).join('')}</select></div><div class="spx-intel-filter-row"><div class="pipeline-tabs spx-intel-tabs" role="tablist" aria-label="情报范围"><button class="tab active" role="tab" aria-selected="true" data-filter="all">全部</button><button class="tab" role="tab" aria-selected="false" data-filter="favorites">已收藏</button><button class="tab" role="tab" aria-selected="false" data-filter="selected">AIHOT 精选</button></div><div class="actions"><button class="small-btn" id="apply-intel-filter">应用筛选</button><button class="small-btn" id="refresh-intel">刷新情报</button></div></div></div><div id="intel-list">${items.map(newsCard).join('') || '<div class="empty">暂无情报，请在连接与设置中同步 AIHOT。</div>'}</div>`);
}

function library() {
  const docs = state.data.documents;
  setTimeout(() => { const header = document.querySelector('.asset-module-tabs'); if (header && !document.querySelector('#open-douyin-import')) { const button = document.createElement('button'); button.className = 'small-btn'; button.id = 'open-douyin-import'; button.textContent = '导入抖音流水线'; header.appendChild(button); const feishu = document.createElement('button'); feishu.className = 'small-btn'; feishu.id = 'open-feishu-import'; feishu.textContent = '导入飞书导出'; header.appendChild(feishu); bindEvents(); } }, 0);
  shell('素材与知识库', '导入前预检，确认后入库；保留原文和文件指纹。', `<div class="panel"><div class="panel-head"><div><h3>知识集</h3><div class="muted" style="margin-top:5px">支持 .md、.txt、.docx、.csv、.xlsx、.json、.jsonl；Word / Excel 文件在本机解析，确认后入库。</div></div><button class="primary" id="open-import">导入素材</button></div><div id="import-form" hidden><div class="grid" style="grid-template-columns:1fr 1fr;margin-bottom:10px"><input class="field" id="import-name" placeholder="素材名称，例如作者蒸馏指南.md"><select class="field" id="import-type"><option>事实库</option><option>写作案例库</option><option>蒸馏方法库</option><option>规则与记忆库</option></select></div><input class="field" type="file" id="import-file" accept=".md,.txt,.docx,.csv,.xlsx,.json,.jsonl,text/markdown,text/plain,application/json" style="width:100%;margin-bottom:10px"><textarea class="textarea" id="import-text" placeholder="选择本地文件或粘贴素材正文；文件内容只作为资料处理。" style="min-height:150px"></textarea><div class="actions" style="margin:10px 0 18px"><button class="primary" id="preview-import">预检</button><span id="import-result" class="muted"></span></div></div>${docs.map(doc => `<div class="job-row"><span class="tag">${esc(doc.type)}</span><div><div class="job-title">${esc(doc.name)}</div><div class="job-sub">${esc(doc.source)} · ${doc.chunks} 个可检索片段 · ${esc(doc.tag)}${doc.hash ? ` · SHA-256 ${esc(doc.hash.slice(0, 12))}` : ''}</div></div><button class="small-btn" style="margin-left:auto" data-document-detail="${esc(doc.id)}">查看全文</button></div>`).join('')}</div>`);
}

function topics() {
  const topic = state.data.topics.find(item => item.id === state.topicId) || state.data.topics[0];
  if (!topic) {
    shell('选题中心', '选题是可选路径；直接写作同样会保留来源关联。', '<div class="empty panel">还没有选题候选<br><span class="muted">在情报卡上选择“找写作角度”，生成多个角度供比较。</span></div>');
    return;
  }
  state.topicId = topic.id;
  shell('选题中心', '比较受众、证据和体裁，选定后进入统一创作流程。', `<div class="panel"><div class="panel-head"><div><h3>${esc(topic.sourceTitle)}</h3><div class="job-sub">来源情报 · ${esc(topic.state)}</div></div><span class="tag">${topic.angles.length} 个角度</span></div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">${topic.angles.map(angle => `<article class="template-card"><h3>${esc(angle.title)}</h3><p>目标读者：${esc(angle.audience)}</p><p>建议体裁：${esc(angle.format)}</p><div class="job-sub">依据：${esc(angle.evidence)}</div><button class="small-btn ${angle.recommended ? 'blue' : ''}" data-select-angle="${esc(angle.id)}" style="margin-top:12px">用这个角度创作</button></article>`).join('')}</div></div>`);
}

function studio() { renderFullWriter(state.data.jobs.find(item => item.id === state.jobId)); }

function templates(){renderPromptLibrary();}

function audit() {
  const job = state.data.jobs.find(item => item.id === state.jobId) || state.data.jobs[0];
  if (!job) return shell('审核台', '按需审核，人工确认后定稿。', '<div class="empty panel">没有待审核内容</div>');
  state.jobId = job.id;
  const issues = state.data.auditIssues.filter(item => item.jobId === job.id && item.status!=='已归档');
   const runs = state.data.auditRuns.filter(item => item.jobId === job.id);
   const taskRuns = state.data.taskRuns.filter(item => item.jobId === job.id);
   const skillRuns = runs[0]?.skillRuns || [];
   const currentRun = runs[0];
   queueMicrotask(() => {
     if (state.view !== 'audit' || state.jobId !== job.id) return;
     const note = document.createElement('p'); note.className = 'muted';
     note.textContent = currentRun?.engine === 'skill-guided-model' ? '已按所选 Skill 文档完成模型诊断；未执行原工具分支或外部事实核验。建议仍需人工判断。' : currentRun?.engine === 'local-rules' ? '当前为本地规则审核：检查空稿、占位内容和部分表达。尚未执行 dbskill、模型事实核验或平台审核。' : '历史审核记录；建议重新运行当前本地规则检查。';
     document.querySelector('.page .welcome')?.after(note);
     if (!currentRun || issues.some(item=>item.status==='待重新验证')) { const button=$('#approve'); if(button){button.disabled=true;button.title='请重新审核当前正文';} }
   });
   shell('审核台', '审核意见只定位问题，不未经授权覆盖正文。', `<div class="layout"><section class="panel"><div class="panel-head"><h3>待处理问题 · ${esc(job.title)}</h3><span class="status">${issues.filter(item => item.status === '待处理').length} 条待处理</span></div><p class="muted" style="line-height:1.8">接受建议只修改对应片段；忽略后仍保留原始报告。全部问题处理后再定稿。</p><div class="actions"><button class="small-btn" id="back-to-studio">返回创作室</button><button class="small-btn" id="show-audit-report">查看原始报告</button><button class="primary" id="approve" ${issues.some(item => item.status === '待处理') ? 'disabled title="请先处理待处理问题"' : ''}>确认定稿</button></div><hr style="border:0;border-top:1px solid var(--line);margin:16px 0"><h3>审核运行记录</h3>${runs.map(run => `<div class="job-sub" style="margin-top:8px">${esc(run.createdAt)} · ${esc(run.state)} · ${(run.skills || []).map(esc).join('、')}</div>`).join('') || '<div class="job-sub" style="margin-top:8px">尚未运行审核</div>'}<h3 style="margin-top:16px">任务运行</h3>${taskRuns.map(run => `<div class="job-sub" style="margin-top:6px">${esc(run.taskKind)} · ${esc(run.state)} · 成本 ${esc(formatCost(run))}</div>`).join('') || '<div class="job-sub" style="margin-top:6px">暂无任务运行记录</div>'}</section><section class="panel"><div class="panel-head"><h3>问题卡</h3><span class="tag">保留原始报告</span></div>${issues.map(issue => `<div class="issue ${issue.status !== '待处理' ? 'secondary' : ''}"><strong>${esc(issue.skill)} · ${esc(issue.severity)} · ${esc(issue.status)}</strong><p>${esc(issue.explanation)}</p><div class="job-sub">原句：${esc(issue.quote)}</div><p class="job-sub">建议：${esc(issue.suggestion||'请按原意修改这一处。')}</p>${issue.status==='待处理'&&issue.location?`<label class="job-sub">替换文字<textarea class="textarea" data-issue-replacement="${esc(issue.id)}" style="min-height:70px;margin-top:6px" placeholder="填写替换文字，留空表示删除该句">${esc(issue.replacement??'')}</textarea></label>`:''}${issue.status === '待处理' ? `<div class="actions" style="margin-top:8px"><button class="small-btn blue" data-rewrite-issue="${esc(issue.id)}">替换这一处</button><button class="small-btn" data-ignore-issue="${esc(issue.id)}">忽略</button></div>` : ''}</div>`).join('') || `<div class="empty">${runs.length?'未发现需要修改的问题':'尚未运行审核'}</div>`}</section></div>`);
   queueMicrotask(()=>{const panel=document.querySelector('.layout > section.panel');if(!panel||!skillRuns.length)return;const section=document.createElement('section');section.className='panel';section.style.marginTop='14px';section.innerHTML=`<h3>Skill 执行明细</h3>${skillRuns.map(run=>`<div class="job-row"><span class="status ${run.state==='succeeded'?'done':''}">${esc(run.state)}</span><div><div class="job-title">${esc(run.skill)}</div><div class="job-sub">${esc(run.engine)} · ${run.detail?esc(run.detail)+' · ':''}${run.issueCount} 条问题 · ${esc(run.license)}</div></div></div>`).join('')}`;panel.append(section);});
}

function archive() {
  shell('内容与发布记录','',`<section class="panel"><div class="pipeline-table-wrap"><table class="pipeline-table spx-records-table"><colgroup><col><col style="width:180px"><col style="width:110px"><col style="width:130px"><col style="width:130px"><col style="width:96px"><col style="width:144px"></colgroup><thead><tr>${['文案标题','创建时间','文案类型','文案风格','黄金开头','文案字数','操作'].map(label=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${state.data.jobs.filter(job=>!job.archived).map(job=>`<tr><td>${esc(job.title)}</td><td>${esc(job.createdAt||state.data.versions.filter(v=>v.jobId===job.id).at(-1)?.createdAt||'—')}</td><td>${esc(job.copyType||'—')}</td><td>${esc(job.copyStyle||'—')}</td><td>${esc(job.hookType||'—')}</td><td>${String(job.body||'').replace(/\s/g,'').length}</td><td><button class="small-btn" data-record-body="${esc(job.id)}">查看文案</button></td></tr>`).join('')}</tbody></table></div></section>`);
  document.querySelectorAll('[data-record-body]').forEach(button=>button.onclick=()=>{const job=state.data.jobs.find(j=>j.id===button.dataset.recordBody);showDetail(job.title,`<pre class="detail-text">${esc(job.body||'尚无正文')}</pre>`);});
}

function checklist() {
  shell('P0 验收清单', '按 PRD 验收项查看当前系统状态；未完成项不会被伪装成完成。', '<div id="checklist-panel" class="panel">读取中…</div>');
}

function settings() {
  const integration = state.data.integration?.aihot || {};
  const status = integration.mode === 'live' ? '已连接并同步' : integration.mode === 'error' ? '同步失败' : integration.mode === 'configured' ? '已配置，尚未同步' : '演示模式';
  const diag = state.data.aihotDiagnostics;
  const hermes = state.data.hermesStatus;
  const runtime = state.data.runtimeStatus;
  const runtimePanel = `<section class="panel" style="margin-bottom:14px"><div class="panel-head"><div><h3>本地运行状态</h3><div class="job-sub">Node ${esc(runtime?.node || '未知')} · ${esc(runtime?.host || '127.0.0.1')}:${esc(runtime?.port || '')}</div></div><span class="tag">本机开发</span></div><div class="chips"><span class="chip">模型调用：${runtime?.modelCallsEnabled ? '开启' : '关闭'}</span><span class="chip">采集：${runtime?.collectionEnabled ? '开启' : '关闭'}</span><span class="chip">飞书推送：${runtime?.feishuPushEnabled ? '开启' : '关闭'}</span><span class="chip">自动发布：关闭</span><span class="chip">模型：${esc(runtime?.model || '未配置')}</span></div><hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><h3>Hermes 文案引擎</h3><input class="field" id="hermes-service-url" placeholder="原生 Hermes 服务，例如 http://127.0.0.1:8787" value="${esc(hermes?.serviceUrl||'')}" style="width:100%;margin:8px 0"><div class="job-sub">${hermes?.configured ? '已配置' : '未配置'} · ${hermes?.health === 'ok' ? '服务可用' : hermes?.health === 'unreachable' ? '服务不可达' : '尚未检查'} · Key ${hermes?.hasKey?'已配置':'缺失'} · 素材 ${hermes?.materialConfigured?'已配置':'缺失'} · 记忆 ${hermes?.memoryConfigured?'已配置':'缺失'}</div><div class="grid" style="grid-template-columns:1fr 1fr;margin-top:10px"><input class="field" id="hermes-api-url" placeholder="HERMES_API_URL" value="${esc(hermes?.endpoint || '')}"><input class="field" id="hermes-model" placeholder="模型 ID" value="${esc(hermes?.model || '')}"></div><input class="field" id="hermes-api-key" type="password" placeholder="API Key（仅本机保存，不回显）" style="width:100%;margin-top:8px"><div class="grid" style="grid-template-columns:1fr 1fr;margin-top:8px"><input class="field" id="hermes-memory-root" placeholder="MEMORY_ROOT 本地路径"><input class="field" id="hermes-material-path" placeholder="MATERIAL_PATH 本地路径"></div><div class="actions" style="margin-top:8px"><button class="small-btn" id="save-hermes-config">保存 Hermes 配置</button><button class="small-btn" id="check-hermes-health">检查 Hermes 服务</button><span id="hermes-config-result" class="job-sub"></span></div></section>`;
  shell('连接和设置', '配置 AIHOT 的只读地址；私有稿件不会回写到 AIHOT。', `<div class="layout"><section class="panel"><div class="panel-head"><div><h3>AIHOT 情报引擎</h3><div class="job-sub">状态：${status} · 已缓存 ${integration.count || 0} 条公开情报</div></div><span class="tag">只读适配器</span></div><label class="job-sub" for="aihot-base-url">AIHOT 服务地址</label><input class="field" id="aihot-base-url" value="${esc(integration.endpoint || '')}" placeholder="例如 http://127.0.0.1:3000" style="width:100%;margin:7px 0 12px"><div class="grid" style="grid-template-columns:1fr 1fr;margin-bottom:12px"><label class="job-sub">同步范围<select class="field" id="aihot-sync-mode" style="display:block;width:100%;margin-top:5px"><option value="all" ${integration.syncMode === 'all' ? 'selected' : ''}>全部公开动态</option><option value="selected" ${integration.syncMode === 'selected' ? 'selected' : ''}>仅精选情报</option></select></label><label class="job-sub">时间窗口<select class="field" id="aihot-sync-window" style="display:block;width:100%;margin-top:5px"><option value="7d">最近 7 天</option><option value="24h">最近 24 小时</option></select></label></div><div class="actions"><button class="primary" id="save-aihot-config">保存配置</button><button class="small-btn" id="test-aihot">立即同步</button><button class="small-btn" id="clear-aihot-config">切回演示数据</button></div><div id="aihot-config-result" class="muted" style="margin-top:12px">${integration.lastSyncAt ? `最近同步：${new Date(integration.lastSyncAt).toLocaleString()} · ${integration.count || 0} 条缓存` : '尚未同步'}</div>${integration.lastError ? `<div class="issue" style="margin-top:12px"><strong>最近错误</strong><p>${esc(integration.lastError)}</p></div>` : ''}<div class="job-row" style="display:block;margin-top:14px"><strong class="job-title">最近同步</strong>${(integration.syncHistory || []).slice(0, 5).map(run => `<div class="job-sub">${esc(run.mode || '')} · ${esc(run.count ?? '失败')} 条 · ${esc(run.syncedAt || run.failedAt || '')}${run.error ? ` · ${esc(run.error)}` : ''}</div>`).join('') || '<div class="job-sub">暂无同步记录</div>'}</div></section><section class="panel"><h3>AIHOT 本地处理状态</h3>${diag?.available ? `<div class="grid" style="grid-template-columns:1fr 1fr;margin-top:12px"><div class="stat"><div class="stat-label">已采集文章</div><div class="stat-value">${diag.collected}</div></div><div class="stat"><div class="stat-label">待 AI 评判</div><div class="stat-value">${diag.pending_review}</div></div><div class="stat"><div class="stat-label">正文已就绪</div><div class="stat-value">${diag.body_ready}</div></div><div class="stat"><div class="stat-label">公开精选</div><div class="stat-value">${diag.selected_items}</div></div></div><div class="job-sub" style="line-height:1.8;margin-top:12px">${diag.pending_review > 0 && diag.public_items === 0 ? '文章已从真实信源采集，但尚未经过 AIHOT 评判，因此不会出现在公开 API。' : '统计来自本机 AIHOT 数据库；文章正文仍只通过公开 API 读取。'}</div>` : '<div class="job-sub" style="margin-top:10px">本地诊断未配置。公开 API 同步不受影响。</div>'}<hr style="border:0;border-top:1px solid var(--line);margin:15px 0"><h3>数据边界</h3><div class="job-sub" style="line-height:1.9;margin-top:8px">内容只读取 AIHOT 的公开接口 <code>/api/v1/items</code>。本地数据库诊断只返回计数，不读取文章正文、不绕过公开层。</div></section></div>`);
}

async function bindEvents() {
  const account=document.querySelector('.avatar');
  if(account) account.onclick=()=>{
    showDetail('私人工作台访问', state.authStatus?.mode==='session' ? '<p class="muted">已通过私人会话登录。会话有效期为 8 小时，重启服务后需要重新登录。</p><button class="small-btn" id="logout-session">退出登录</button>' : '<p class="muted">当前仅本机开发模式，尚未启用 STUDIO_TOKEN 登录保护。</p>');
    const logout=$('#logout-session');
    if(logout) logout.onclick=async()=>{await api('/api/studio/auth/logout',{method:'POST',body:'{}'});state.data=null;document.querySelector('.detail-sheet')?.remove();$('#app').textContent='已退出私人工作台';showLogin();};
  };
  const generate = $('#generate-content'); if (generate) generate.onclick = async () => { generate.disabled = true; generate.textContent = '生成中…'; try { const mode=$('#generation-mode')?.value||'studio'; const endpoint=mode==='hermes'?'hermes-generate':'generate'; const result = await api(`/api/studio/writing/jobs/${encodeURIComponent(state.jobId)}/${endpoint}`, { method: 'POST', body: JSON.stringify({body:document.querySelector('#draft')?.value||''}) }); state.jobId = result.job.id; await load(); } catch (error) { const unresolved = ['generation_outcome_unknown','generation_in_progress'].includes(error.code); generate.disabled = unresolved; generate.textContent = error.code==='hermes_incomplete_configuration'?'Hermes 未配置':unresolved ? '未完成，请查看运行记录' : '生成失败，点击重试'; window.alert(error.message); } };
  const hermesSection=$('#hermes-section'); if(hermesSection) hermesSection.onchange=async()=>{try{await api(`/api/studio/writing/jobs/${encodeURIComponent(state.jobId)}/hermes-section`,{method:'POST',body:JSON.stringify({section:hermesSection.value,instruction:'保留原意，增加具体性和自然表达。'})});await load();}catch(error){window.alert(error.message)}};
  const searchButton = $('#open-search'); if (searchButton) searchButton.onclick = () => { showDetail('搜索工作台', '<input class="field" id="global-search-input" placeholder="搜索情报、素材或内容" style="width:100%"><div class="actions" style="margin-top:10px"><button class="primary" id="global-search-submit">搜索</button></div>'); const input=$('#global-search-input'); input.focus(); const submit=()=>{const query=input.value.trim();if(!query)return;document.querySelector('.detail-sheet')?.remove();searchResults(query);}; $('#global-search-submit').onclick=submit; input.onkeydown=event=>{if(event.key==='Enter')submit();}; };
  document.querySelectorAll('[data-view]').forEach(element => element.onclick = async () => {
    if(typeof fullWriter!=='undefined'&&document.querySelector('#content-workbench')){
      if(fullWriter.busy)return;
      const draft=fullWriterDraft();
      if(draft.dirty&&(draft.original?.trim()||draft.title?.trim())){
        fullWriter.busy=true;fullWriter.lockedDraft=draft;
        try{await saveFullWriterInput(true);}catch(error){toast(`尚未保存：${error.message}`,'error');return;}finally{fullWriter.busy=false;}
      }
    }
    state.view = element.dataset.view; document.querySelectorAll('.nav').forEach(nav => nav.classList.toggle('active', nav.dataset.view === state.view)); render();
  });
  document.querySelectorAll('[data-write]').forEach(element => element.onclick = async () => { const job = await api('/api/studio/writing/jobs', { method: 'POST', body: JSON.stringify({ sourceId: element.dataset.write, entry: 'AIHOT 新闻', template: state.data.templates.find(item => item.id === 'tpl-news')?.name }) }); state.jobId = job.id; state.view = 'studio'; await load(); });
  document.querySelectorAll('[data-topic]').forEach(element => element.onclick = async () => { if(element.disabled)return; element.disabled=true; try{ const topic = await api('/api/studio/topics/derive', { method: 'POST', body: JSON.stringify({ sourceId: element.dataset.topic }) }); state.topicId = topic.id;showTopicAngles(topic); } catch(error){ toast(error.message,'error'); } finally{ element.disabled=false; } });
  document.querySelectorAll('[data-favorite]').forEach(element => element.onclick = async () => { if(element.disabled)return; element.disabled=true; try{ await api(`/api/studio/sources/${encodeURIComponent(element.dataset.favorite)}/favorite`, { method: 'POST', body: '{}' }); await load(); } catch(error){ toast(error.message,'error'); element.disabled=false; } });
  document.querySelectorAll('[data-intelligence-analyze]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const result=await api(`/api/studio/sources/${encodeURIComponent(b.dataset.intelligenceAnalyze)}/analyze`,{method:'POST',body:'{}'});showDetail('AI 情报整理',`<p class="muted">${esc(result.model)}</p><pre class="detail-text">${esc(result.text)}</pre>`);}catch(error){toast(error.message,'error');}finally{b.disabled=false;}});
  document.querySelectorAll('[data-source-detail]').forEach(element => element.onclick = async () => { const source = await api(`/api/studio/sources/${encodeURIComponent(element.dataset.sourceDetail)}`); showDetail('来源详情', `<h3>${esc(source.title)}</h3><p class="muted">${esc(source.source)} · ${esc(source.publishedAt)}</p><p class="news-summary">${esc(source.summary)}</p>${source.originalTitle&&source.originalTitle!==source.title?`<details><summary>原文</summary><h4>${esc(source.originalTitle)}</h4><p>${esc(source.originalSummary||'')}</p></details>`:''}<p class="job-sub">原文：<a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.url)}</a></p>`); });
  document.querySelectorAll('[data-document-detail]').forEach(element => element.onclick = async () => { const doc = await api(`/api/studio/documents/${encodeURIComponent(element.dataset.documentDetail)}`); showDetail('素材全文', `<h3>${esc(doc.name)}</h3><p class="muted">${esc(doc.type)} · ${esc(doc.source)} · ${esc(doc.tag)}</p><pre class="detail-text">${esc(doc.content || '该文档为历史摘要，尚未保存全文。')}</pre>`); });
  document.querySelectorAll('[data-filter]').forEach(element => element.onclick = () => {
    document.querySelectorAll('[data-filter]').forEach(tab => {tab.classList.toggle('active', tab === element);tab.setAttribute('aria-selected',String(tab===element));});
    refreshIntelligence();
  });
  const applyIntel = $('#apply-intel-filter'); if (applyIntel) applyIntel.onclick = refreshIntelligence;
  const intelQuery = $('#intel-query'); if (intelQuery) intelQuery.onkeydown = event => { if (event.key === 'Enter') refreshIntelligence(); };
  document.querySelectorAll('[data-select-angle]').forEach(element => element.onclick = async () => { const job = await api('/api/studio/topics/select', { method: 'POST', body: JSON.stringify({ topicId: state.topicId, angleId: element.dataset.selectAngle }) }); state.jobId = job.id; state.view = 'studio'; await load(); });
  document.querySelectorAll('[data-rewrite-issue]').forEach(element => element.onclick = async () => { const field=document.querySelector(`[data-issue-replacement="${element.dataset.rewriteIssue}"]`); const replacement=field?.value; if(replacement===undefined){toast('找不到替换文字框','error');return;} if(replacement.trim()===''&&!window.confirm('替换文字为空将删除原文这一句，确认删除吗？')){return;} if(replacement===field?.placeholder){toast('请先填写修改后的文字。','error');return;} element.disabled=true; try{ await api(`/api/studio/audit-issues/${encodeURIComponent(element.dataset.rewriteIssue)}`, { method: 'PATCH', body: JSON.stringify({ action: 'rewrite', replacement }) }); await load(); } catch(error){ toast(error.message,'error'); element.disabled=false; } });
  document.querySelectorAll('[data-ignore-issue]').forEach(element => element.onclick = async () => { await api(`/api/studio/audit-issues/${encodeURIComponent(element.dataset.ignoreIssue)}`, { method: 'PATCH', body: JSON.stringify({ action: 'ignore' }) }); await load(); });
  const openImport = $('#open-import'); if (openImport) openImport.onclick = () => { $('#import-form').hidden = !$('#import-form').hidden; };
  const openDouyin = $('#open-douyin-import');
  if (openDouyin) openDouyin.onclick = () => {
    showDetail('导入抖音素材流水线结果', `<p class="muted">支持 JSON 数组、JSONL 和 CSV。缺失或不可验证的播放量标记为未知，不用点赞折算。</p><input class="field" type="file" id="douyin-file" style="width:100%;margin:10px 0"><textarea class="textarea" id="douyin-json" style="min-height:150px"></textarea><div class="actions" style="margin-top:10px"><button class="primary" id="douyin-preview">预检</button><span id="douyin-result" class="muted"></span></div>`);
    bindDouyinPreview();
  };
  const openFeishu=$('#open-feishu-import');
  if(openFeishu)openFeishu.onclick=()=>{
    showDetail('导入飞书导出文件',`<label for="feishu-source-link">飞书来源链接</label><input class="field" id="feishu-source-link" placeholder="https://...feishu.cn/base/..."><p class="muted">此入口只处理飞书导出的 JSON、JSONL 或 CSV，不访问飞书、不回写飞书。标题和正文映射必须明确。</p><input class="field" type="file" id="feishu-file" accept=".json,.jsonl,.csv" style="width:100%;margin:10px 0"><textarea class="textarea" id="feishu-text" placeholder="粘贴 JSON、JSONL 或 CSV" style="min-height:120px"></textarea><div id="feishu-fields"></div><div class="actions" style="margin-top:10px"><button class="primary" id="feishu-preview">读取列并预检</button><span id="feishu-result" class="muted"></span></div>`);
    const file=$('#feishu-file');if(file)file.onchange=async()=>{$('#feishu-text').value=await file.files[0].text();};
    $('#feishu-preview').onclick=async()=>{try{const text=$('#feishu-text').value;const result=await api('/api/studio/feishu/preview',{method:'POST',body:JSON.stringify({text,mapping:{}})});$('#feishu-fields').innerHTML=`<div class="grid" style="grid-template-columns:repeat(2,1fr);margin-top:10px">${['title','content','author','url','publishedAt'].map(key=>`<label class="job-sub">${key}<select class="field feishu-map" data-map-key="${key}" style="display:block;width:100%;margin-top:4px"><option value="">不映射</option>${result.fields.map(field=>`<option value="${esc(field)}">${esc(field)}</option>`).join('')}</select></label>`).join('')}</div><select class="field" id="feishu-license" style="width:100%;margin-top:10px"><option value="内部研究，不自动发布">内部研究，不自动发布</option><option value="允许内部发布，需人工确认">允许内部发布，需人工确认</option></select><button class="primary" id="feishu-confirm" style="margin-top:10px">按映射确认入库</button>`;$('#feishu-result').textContent=`读取 ${result.rows} 行 · ${result.fields.length} 列`;$('#feishu-confirm').onclick=async()=>{const mapping={};document.querySelectorAll('.feishu-map').forEach(select=>{if(select.value)mapping[select.dataset.mapKey]=select.value});try{await api('/api/studio/feishu/commit',{method:'POST',body:JSON.stringify({previewId:result.id,mapping,importUrl:$('#feishu-source-link').value,licenseScope:$('#feishu-license').value,docType:'写作案例库'})});document.querySelector('.detail-sheet')?.remove();await load();}catch(error){$('#feishu-result').textContent=error.message};};}catch(error){$('#feishu-result').textContent=error.message};};
  };
  const importFile = $('#import-file'); if (importFile) importFile.onchange = async () => { const file = importFile.files?.[0]; if (!file) return; $('#import-name').value = file.name; $('#import-text').value = await file.text(); };
  const previewImport = $('#preview-import'); if (previewImport) previewImport.onclick = async () => { const result = $('#import-result'); try { const preview = await api('/api/studio/imports/preview', { method: 'POST', body: JSON.stringify({ name: $('#import-name').value, type: $('#import-type').value, text: $('#import-text').value }) }); result.textContent = `预检通过：${preview.chunks} 个片段 · ${preview.duplicate ? '发现重复素材' : '未发现重复素材'}`; const confirm = document.createElement('button'); confirm.className = 'small-btn blue'; confirm.textContent = '确认入库'; confirm.onclick = async () => { await api('/api/studio/imports/commit', { method: 'POST', body: JSON.stringify({ previewId: preview.id }) }); await load(); }; result.append(' ', confirm); } catch (error) { result.textContent = error.message; } };
  const saveDraft = $('#save-draft'); if (saveDraft) saveDraft.onclick = async () => { await api('/api/studio/writing/versions', { method: 'POST', body: JSON.stringify({ jobId: state.jobId, body: $('#draft').value }) }); await load(); };
  const saveVideo = $('#save-video'); if (saveVideo) saveVideo.onclick = async () => { await api(`/api/studio/writing/jobs/${encodeURIComponent(state.jobId)}`, { method: 'PATCH', body: JSON.stringify({ title: $('#video-title').value, durationSeconds: $('#video-duration').value, hook: $('#video-hook').value, body: $('#draft').value }) }); await api('/api/studio/writing/versions', { method: 'POST', body: JSON.stringify({ jobId: state.jobId, body: $('#draft').value, reason: '保存口播稿' }) }); await load(); };
  document.querySelectorAll('.post-input').forEach(input => input.addEventListener('input', () => { const count = document.querySelector(`[data-count-for="${input.dataset.post}"]`); if (count) count.textContent = `${input.value.length} 字符`; }));
  const readDraft = () => { const posts = [...document.querySelectorAll('.post-input')]; return posts.length ? posts.map(input => input.value.trim()).filter(Boolean).join('\n\n') : ($('#draft')?.value || ''); };
  if (saveDraft) saveDraft.onclick = async () => { await api('/api/studio/writing/versions', { method: 'POST', body: JSON.stringify({ jobId: state.jobId, body: readDraft() }) }); await load(); };
  const jobTemplate = $('#job-template'); if (jobTemplate) jobTemplate.onchange = async () => { await api(`/api/studio/writing/jobs/${encodeURIComponent(state.jobId)}`, { method: 'PATCH', body: JSON.stringify({ templateId: jobTemplate.value }) }); await load(); };
  const showVersions = $('#show-versions'); if (showVersions) showVersions.onclick = async () => { const data = await api(`/api/studio/jobs/${encodeURIComponent(state.jobId)}/versions`); const current = data.job.body || ''; showDetail('版本与 Diff', `<div class="actions" style="margin-bottom:12px"><select class="field" id="diff-version">${data.versions.map((version, index) => `<option value="${esc(version.id)}">版本 ${data.versions.length - index} · ${esc(version.reason)}</option>`).join('')}</select><button class="small-btn blue" id="render-diff">查看 Diff</button></div><div id="diff-output" class="editor"><pre class="detail-text">${esc(current)}</pre><pre class="detail-text">选择一个历史版本后查看差异</pre></div><div class="actions" style="margin-top:12px">${data.versions.map(version => `<button class="small-btn" data-restore-version="${esc(version.id)}">恢复版本 ${esc(version.id.slice(-6))}</button>`).join('')}</div>`); const renderDiff = $('#render-diff'); if (renderDiff) renderDiff.onclick = () => { const version = data.versions.find(item => item.id === $('#diff-version').value); if (!version) return; const left = version.body.split('\n'); const right = current.split('\n'); const max = Math.max(left.length, right.length); $('#diff-output').innerHTML = `<pre class="detail-text">${Array.from({length:max},(_,i)=>`<span style="display:block;background:${left[i] !== right[i] ? '#fff2e5' : 'transparent'}">- ${esc(left[i] ?? '')}</span>`).join('')}</pre><pre class="detail-text">${Array.from({length:max},(_,i)=>`<span style="display:block;background:${left[i] !== right[i] ? '#eef8f2' : 'transparent'}">+ ${esc(right[i] ?? '')}</span>`).join('')}</pre>`; }; document.querySelectorAll('[data-restore-version]').forEach(button => button.onclick = async () => { await api(`/api/studio/jobs/${encodeURIComponent(state.jobId)}/restore`, { method: 'POST', body: JSON.stringify({ versionId: button.dataset.restoreVersion }) }); document.querySelector('.detail-sheet')?.remove(); await load(); }); };
  const runAudit = $('#run-audit'); if (runAudit) runAudit.onclick = async () => { const posts = [...document.querySelectorAll('.post-input')]; if (posts.length) await api('/api/studio/writing/versions', { method: 'POST', body: JSON.stringify({ jobId: state.jobId, body: posts.map(input => input.value.trim()).filter(Boolean).join('\n\n'), reason: '审核前保存' }) }); await api('/api/studio/audits', { method: 'POST', body: JSON.stringify({ jobId: state.jobId }) }); state.view = 'audit'; await load(); };
  const copyDraft = $('#copy-draft'); if (copyDraft) copyDraft.onclick = () => { const posts = [...document.querySelectorAll('.post-input')].map(input => input.value.trim()).filter(Boolean); navigator.clipboard?.writeText(posts.length > 1 ? posts.map((post, index) => `${index + 1}/${posts.length}\n${post}`).join('\n\n') : ($('#draft')?.value || posts[0] || '')); };
  const backStudio = $('#back-to-studio'); if (backStudio) backStudio.onclick = () => { state.view = 'studio'; render(); };
  const showAuditReport = $('#show-audit-report'); if (showAuditReport) showAuditReport.onclick = () => { const jobIssues = state.data.auditIssues.filter(item => item.jobId === state.jobId); showDetail('原始审核报告', `<pre class="detail-text">${esc(JSON.stringify({ jobId: state.jobId, issues: jobIssues, runs: state.data.auditRuns.filter(item => item.jobId === state.jobId) }, null, 2))}</pre>`); };
  const approve = $('#approve'); if (approve) approve.onclick = async () => { const job = state.data.jobs.find(item => item.id === state.jobId); try { await api('/api/studio/writing/finalize', { method: 'POST', body: JSON.stringify({ jobId: job.id, body: job.body }) }); await load(); } catch (error) { window.alert(error.message.includes('hard_rule_blocked') ? '硬性规则未通过，请修改后再定稿。' : error.message); } };
  const newIdea = document.querySelector('[data-new-idea]'); if (newIdea) newIdea.onclick = () => { showDetail('新建内容', `<div class="actions"><button class="small-btn blue" id="new-idea-mode">空白想法</button><button class="small-btn" id="rewrite-mode">参考改写</button></div><div id="new-content-form" style="margin-top:12px"></div>`); $('#new-idea-mode').onclick = () => { $('#new-content-form').innerHTML = '<input class="field" id="idea-title" placeholder="输入想法或选题" style="width:100%"><textarea class="textarea" id="idea-body" placeholder="补充草稿（可留空）" style="margin-top:8px;min-height:120px"></textarea><button class="primary" id="create-idea" style="margin-top:8px">进入创作室</button>'; $('#create-idea').onclick = async () => { const button=$('#create-idea'); button.disabled=true; button.textContent='创建中…'; try { const job = await api('/api/studio/manual-ideas', { method: 'POST', body: JSON.stringify({ title: $('#idea-title').value, body: $('#idea-body').value }) }); toast('已创建内容任务','success'); state.jobId = job.id; state.view = 'studio'; document.querySelector('.detail-sheet')?.remove(); await load(); } catch { button.disabled=false; button.textContent='进入创作室'; } }; }; $('#rewrite-mode').onclick = () => { $('#new-content-form').innerHTML = '<input class="field" id="rewrite-title" placeholder="任务标题" style="width:100%"><select class="field" id="rewrite-template" style="width:100%;margin-top:8px">'+state.data.templates.filter(item => item.active).map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')+'</select><select class="field" id="rewrite-level" style="width:100%;margin-top:8px"><option>轻改</option><option>中改</option><option>重构</option></select><textarea class="textarea" id="rewrite-original" placeholder="粘贴现有原稿" style="margin-top:8px;min-height:180px"></textarea><button class="primary" id="create-rewrite" style="margin-top:8px">进入对照编辑</button>'; $('#create-rewrite').onclick = async () => { const button=$('#create-rewrite');button.disabled=true;button.textContent='创建中…';try{const job = await api('/api/studio/rewrite-jobs', { method: 'POST', body: JSON.stringify({ title: $('#rewrite-title').value, templateId: $('#rewrite-template').value, mode: $('#rewrite-level').value, original: $('#rewrite-original').value }) });toast('已创建参考改写任务','success'); state.jobId = job.id; state.view = 'studio'; document.querySelector('.detail-sheet')?.remove(); await load();}catch{button.disabled=false;button.textContent='进入对照编辑';}}; }; };
  const newRewrite=document.querySelector('[data-new-rewrite]'); if(newRewrite){newRewrite.onclick=()=>{document.querySelector('[data-new-idea]')?.click();setTimeout(()=>$('#rewrite-mode')?.click(),0);};}
  const refreshIntel=$('#refresh-intel');if(refreshIntel)refreshIntel.onclick=async()=>{refreshIntel.disabled=true;refreshIntel.textContent='更新中…';try{await api('/api/studio/integrations/aihot/sync',{method:'POST',body:'{}'});await load();}catch(error){refreshIntel.disabled=false;refreshIntel.textContent='重新刷新';}};
  const syncAihot = $('#sync-aihot'); if (syncAihot) syncAihot.onclick = async () => { syncAihot.disabled = true; syncAihot.textContent = '同步中…'; try { await api('/api/studio/integrations/aihot/sync', { method: 'POST', body: '{}' }); await load(); } catch (error) { syncAihot.disabled = false; syncAihot.textContent = '同步失败'; window.alert(error.message); } };
  const saveAihot = $('#save-aihot-config'); if (saveAihot) saveAihot.onclick = async () => { try { await api('/api/studio/integrations/aihot/config', { method: 'POST', body: JSON.stringify({ baseUrl: $('#aihot-base-url').value, syncMode: $('#aihot-sync-mode').value }) }); $('#aihot-config-result').textContent = '配置已保存。'; await load(); } catch (error) { $('#aihot-config-result').textContent = error.message; } };
  const testAihot = $('#test-aihot'); if (testAihot) testAihot.onclick = async () => { testAihot.disabled = true; testAihot.textContent = '同步中…'; try { await api('/api/studio/integrations/aihot/config', { method: 'POST', body: JSON.stringify({ baseUrl: $('#aihot-base-url').value, syncMode: $('#aihot-sync-mode').value }) }); await api('/api/studio/integrations/aihot/sync', { method: 'POST', body: JSON.stringify({ mode: $('#aihot-sync-mode').value, window: $('#aihot-sync-window').value }) }); await load(); } catch (error) { testAihot.disabled = false; testAihot.textContent = '重试同步'; $('#aihot-config-result').textContent = error.message; } };
  const clearAihot = $('#clear-aihot-config'); if (clearAihot) clearAihot.onclick = async () => { await api('/api/studio/integrations/aihot/config', { method: 'POST', body: JSON.stringify({ baseUrl: '' }) }); await load(); };
  const saveHermes = $('#save-hermes-config'); if(saveHermes)saveHermes.onclick=async()=>{saveHermes.disabled=true;try{await api('/api/studio/integrations/hermes/config',{method:'POST',body:JSON.stringify({serviceUrl:$('#hermes-service-url')?.value,apiUrl:$('#hermes-api-url').value,model:$('#hermes-model').value,apiKey:$('#hermes-api-key').value,memoryRoot:$('#hermes-memory-root').value,materialPath:$('#hermes-material-path').value})});$('#hermes-config-result').textContent='已保存；重启工作台后应用到 Hermes 代理。';}catch(error){$('#hermes-config-result').textContent=error.message;}finally{saveHermes.disabled=false;}};
  const checkHermes=$('#check-hermes-health'); if(checkHermes)checkHermes.onclick=async()=>{checkHermes.disabled=true;checkHermes.textContent='检查中…';try{const status=await api('/api/studio/integrations/hermes/health',{method:'POST',body:'{}'});$('#hermes-config-result').textContent=status.health==='ok'?`Hermes 服务可用：${status.service}`:`Hermes 不可用：${status.healthError||status.detail}`;}catch(error){$('#hermes-config-result').textContent=error.message;}finally{checkHermes.disabled=false;}};
  const newTemplate = $('#new-template'); if (newTemplate) newTemplate.onclick = () => { state.templateId = null; $('#template-editor').hidden = false; $('#tpl-name').value = ''; $('#tpl-prompt').value = ''; $('#tpl-rules').value = ''; };
  document.querySelectorAll('[data-edit-template]').forEach(element => element.onclick = () => { const template = state.data.templates.find(item => item.id === element.dataset.editTemplate); state.templateId = template.id; $('#template-editor').hidden = false; $('#tpl-name').value = template.name; $('#tpl-kind').value = template.kind; $('#tpl-prompt').value = template.prompt || ''; $('#tpl-rules').value = (template.rules || []).join('；'); $('#tpl-review-mode').value = template.reviewMode || '手动'; $('#tpl-rounds').value = template.maxRevisionRounds || 1; document.querySelectorAll('[data-tpl-binding]').forEach(input => input.checked=(template.bindings||[]).includes(input.dataset.tplBinding)); document.querySelectorAll('[data-tpl-audit]').forEach(input => input.checked=(template.audits||[]).includes(input.dataset.tplAudit)); });
  const saveTemplate = $('#save-template'); if (saveTemplate) saveTemplate.onclick = async () => { const bindings=[...document.querySelectorAll('[data-tpl-binding]:checked')].map(input=>input.dataset.tplBinding); const audits=[...document.querySelectorAll('[data-tpl-audit]:checked')].map(input=>input.dataset.tplAudit); await api('/api/studio/templates', { method: 'POST', body: JSON.stringify({ id: state.templateId, ...readKnowledgeScope('tpl-scope'), name: $('#tpl-name').value, kind: $('#tpl-kind').value, bindings, audits, prompt: $('#tpl-prompt').value, rules: $('#tpl-rules').value.split(/[;；]/).map(item => item.trim()).filter(Boolean), reviewMode: $('#tpl-review-mode').value, maxRevisionRounds: Number($('#tpl-rounds').value || 1) }) }); await load(); };
  const cancelTemplate = $('#cancel-template'); if (cancelTemplate) cancelTemplate.onclick = () => { $('#template-editor').hidden = true; };
  document.querySelectorAll('[data-open-job]').forEach(element => element.onclick = () => { state.jobId = element.dataset.openJob; state.view = 'studio'; render(); });
  document.querySelectorAll('[data-cancel-job]').forEach(element => element.onclick = async () => { await api(`/api/studio/jobs/${encodeURIComponent(element.dataset.cancelJob)}/status`, { method: 'PATCH', body: JSON.stringify({ status: '已取消' }) }); await load(); });
  document.querySelectorAll('[data-archive-job]').forEach(element => element.onclick = async () => { await api(`/api/studio/jobs/${encodeURIComponent(element.dataset.archiveJob)}/archive`, { method: 'PATCH', body: '{}' }); toast('任务已归档','success'); await load(); });
  document.querySelectorAll('[data-restore-job]').forEach(element => element.onclick = async () => { await api(`/api/studio/jobs/${encodeURIComponent(element.dataset.restoreJob)}/restore-visibility`, { method: 'PATCH', body: '{}' }); toast('任务已恢复显示','success'); await load(); });
  document.querySelectorAll('[data-job-runs]').forEach(element => element.onclick = () => showJobRuns(element.dataset.jobRuns));
  document.querySelectorAll('[data-log-publication]').forEach(element => element.onclick = async () => { const job = state.data.jobs.find(item => item.id === element.dataset.logPublication); showDetail('登记发布', `<div class="grid" style="grid-template-columns:1fr 1fr"><input class="field" id="pub-url" placeholder="X 发布链接"><input class="field" id="pub-date" placeholder="发布时间，例如 2026-10-26 18:30"></div><div class="actions" style="margin-top:12px"><button class="primary" id="save-pub">保存发布记录</button><span id="pub-error" class="job-sub"></span></div>`); $('#save-pub').onclick = async () => { const button=$('#save-pub');button.disabled=true;try{await api('/api/studio/publications', { method: 'POST', body: JSON.stringify({ jobId: job.id, title: job.title, platform: 'X', url: $('#pub-url').value, publishedAt: $('#pub-date').value || new Date().toISOString(), body: job.body }) }); document.querySelector('.detail-sheet')?.remove(); await load();}catch(error){$('#pub-error').textContent=error.message;button.disabled=false;} }; });
  document.querySelectorAll('[data-retro]').forEach(element => element.onclick = () => { const publication = state.data.publications.find(item => item.id === element.dataset.retro); showDetail('发布指标与复盘', `<h3>${esc(publication.title)}</h3><div class="grid" style="grid-template-columns:repeat(4,1fr);margin-top:12px">${['impressions','likes','replies','reposts','bookmarks','follows','dms','leads'].map(key => `<label class="job-sub">${({impressions:'曝光',likes:'点赞',replies:'回复',reposts:'转发',bookmarks:'收藏',follows:'新增关注',dms:'私信',leads:'咨询线索'})[key]}<input class="field" data-metric-key="${key}" type="number" min="0" placeholder="未知可留空" value="${esc(publication.metrics?.[key] ?? '')}"></label>`).join('')}</div><textarea class="textarea" id="retro-facts" placeholder="事实：实际观察到的结果" style="min-height:80px;margin-top:12px">${esc(publication.retrospective?.facts || '')}</textarea><textarea class="textarea" id="retro-inferences" placeholder="推测：尚未验证的传播假设" style="min-height:80px;margin-top:8px">${esc(publication.retrospective?.inferences || '')}</textarea><textarea class="textarea" id="retro-validation" placeholder="验证结果：下一步如何验证" style="min-height:80px;margin-top:8px">${esc(publication.retrospective?.validation || '')}</textarea><div class="actions" style="margin-top:10px"><button class="primary" id="save-retro">保存指标与复盘</button><span id="retro-error" class="job-sub"></span></div>`); $('#save-retro').onclick = async () => { const metrics = {}; document.querySelectorAll('[data-metric-key]').forEach(input => { metrics[input.dataset.metricKey] = input.value === '' ? null : Number(input.value); }); const button=$('#save-retro');button.disabled=true;try{await api(`/api/studio/publications/${encodeURIComponent(publication.id)}/metrics`, { method: 'POST', body: JSON.stringify(metrics) }); await api(`/api/studio/publications/${encodeURIComponent(publication.id)}/retrospective`, { method: 'POST', body: JSON.stringify({ facts: $('#retro-facts').value, inferences: $('#retro-inferences').value, validation: $('#retro-validation').value }) }); document.querySelector('.detail-sheet')?.remove(); await load();}catch(error){$('#retro-error').textContent=error.message;button.disabled=false;} }; });
  enhanceWorkflow();
}

function showDetail(title, content) {
  document.querySelector('.detail-sheet')?._close?.();
  const sheet=document.createElement('div');sheet.className='detail-sheet';
  sheet.innerHTML=`<section class="panel spx-dialog" role="dialog" aria-modal="true" aria-labelledby="spx-dialog-title" tabindex="-1"><div class="panel-head"><h3 id="spx-dialog-title">${esc(title)}</h3><button class="small-btn" data-close-detail aria-label="关闭窗口">关闭</button></div><div class="spx-dialog-body">${content}</div></section>`;
  const previous=document.activeElement;
  const onKey=event=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const items=[...sheet.querySelectorAll('button,a[href],input,textarea,select,summary,[tabindex="0"]')].filter(n=>!n.disabled&&!n.hidden&&n.getClientRects().length);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
  const close=()=>{document.removeEventListener('keydown',onKey);sheet.remove();previous?.isConnected&&previous.focus();};sheet._close=close;
  document.body.append(sheet);sheet.querySelector('[data-close-detail]').onclick=close;sheet.onclick=e=>{if(e.target===sheet)close();};document.addEventListener('keydown',onKey);sheet.querySelector('[data-close-detail]').focus();
}

// Both file and pasted text use the server parser so CSV and JSONL have identical validation.
function bindDouyinPreview() {
  const file = $('#douyin-file');
  if (file) {
    file.accept = '.json,.jsonl,.csv,application/json,text/csv';
    file.onchange = async () => {
      const selected = file.files?.[0]; if (!selected) return;
      const result = $('#douyin-result');
      if (selected.size > 4 * 1024 * 1024) { result.textContent = '文件超过 4 MB，请拆分后导入。'; return; }
      try { $('#douyin-json').value = await selected.text(); result.textContent = `已读取 ${selected.name}，请预检。`; }
      catch { result.textContent = '文件读取失败，请重新选择。'; }
    };
  }
  const input = $('#douyin-json');
  if (input) input.placeholder = '粘贴 JSON 数组、JSONL 或 CSV';
  const button = $('#douyin-preview');
  if (!button) return;
  button.onclick = async () => {
    button.disabled = true;
    const result = $('#douyin-result');
    try {
      const preview = await api('/api/studio/imports/douyin/preview', { method:'POST', body:JSON.stringify({text:input.value}) });
      result.textContent = `${preview.count} 条 · 播放量未知 ${preview.unknownPlayCount} 条`;
      const confirm = document.createElement('button'); confirm.className='small-btn blue'; confirm.textContent='确认入库';
      confirm.onclick = async () => {
        confirm.disabled=true;
        try { await api('/api/studio/imports/douyin/commit',{method:'POST',body:JSON.stringify({previewId:preview.id})}); document.querySelector('.detail-sheet')?.remove(); await load(); }
        catch(error) { result.append(document.createTextNode(` ${error.message}`)); confirm.disabled=false; }
      };
      result.append(' ',confirm);
    } catch(error) { result.textContent=error.message; }
    finally { button.disabled=false; }
  };
}

async function searchResults(query) {
  try { const result = await api(`/api/studio/search?q=${encodeURIComponent(query)}`); const groups = result.groups || {}; shell('搜索结果', `本地搜索：${esc(query)}`, `<div class="layout"><section class="panel"><div class="panel-head"><h3>情报与来源</h3><span class="tag">${result.sources.length} 条</span></div>${result.sources.map(newsCard).join('') || '<div class="empty">没有匹配情报</div>'}</section><section class="panel"><div class="panel-head"><h3>知识库分组</h3><span class="tag">${result.documents.length} 条</span></div>${Object.entries({事实库:groups.facts||[],写作案例库:groups.examples||[],蒸馏方法库:groups.methods||[],规则与记忆库:groups.rules||[]}).map(([name,items]) => items.length ? `<h3 style="margin:14px 0 6px">${name}</h3>${items.map(item => `<div class="job-row"><div><div class="job-title">${esc(item.name)}</div><div class="job-sub">${esc(item.source)} · ${esc(item.tag)}</div></div></div>`).join('')}` : '').join('')}${result.jobs.map(job => `<div class="job-row"><div><div class="job-title">${esc(job.title)}</div><div class="job-sub">${esc(job.status)} · ${esc(job.template)}</div></div><button class="small-btn" data-open-job="${esc(job.id)}">打开</button></div>`).join('') || '<div class="empty">没有匹配内容</div>'}</section></div>`); bindEvents(); } catch (error) { window.alert(error.message); }
}

function render() {
  if (!state.data) return;
  try { if(state.view==='studio'&&state.data.jobs.some(j=>j.id===state.jobId))sessionStorage.setItem('studio-current-writer',JSON.stringify({jobId:state.jobId}));else sessionStorage.removeItem('studio-current-writer'); } catch {}
  if (!document.querySelector('[data-view="douyin"]')) {
    const button=document.createElement('button');button.className='nav';button.dataset.view='douyin';button.innerHTML='<span class="nav-icon" aria-hidden="true">▤</span><span class="nav-label">抖音流水线</span>';
    document.querySelector('[data-view="library"]')?.after(button);
  }
  if(state.view==='douyin'){openDouyinWorkspace();return;}
  ({ home, intel, library, topics, studio, templates, audit, archive, checklist, settings }[state.view] || home)();
  bindEvents();
  if (state.view === 'studio' && state.jobId && !$('#content-workbench')) {
    const currentJob=state.data.jobs.find(item=>item.id===state.jobId);
    if(currentJob?.pipelinePlanSnapshot){
      const note=document.createElement('section');note.className='panel';note.style.marginBottom='14px';
      note.innerHTML=`<h3>已绑定 Skill 组合：${esc(currentJob.pipelinePlanSnapshot.name)}</h3><p class="job-sub">${currentJob.pipelinePlanSnapshot.skills.map(esc).join(' → ')}</p><span class="tag">${esc(currentJob.skillExecutionState||'尚未执行')}</span><p class="job-sub">当前本地规则审核不代表已执行这组 dbskill。</p>`;
      document.querySelector('.page .welcome')?.after(note);
    }
    const actions = $('#run-audit')?.parentElement;
    if (actions && !$('#studio-runs')) { const button = document.createElement('button'); button.id = 'studio-runs'; button.className = 'small-btn'; button.textContent = '生成用量与原始响应'; button.onclick = () => showJobRuns(state.jobId); actions.append(button); }
  }
  if (state.view === 'settings' && !state.data.aihotDiagnostics && !state.diagnosticsLoading) {
    state.diagnosticsLoading = true;
    Promise.all([api('/api/studio/integrations/aihot/diagnostics'),api('/api/studio/integrations/hermes/status'),api('/api/studio/integrations/hermes/capability'),api('/api/studio/douyin/workspace'),api('/api/studio/runtime/dependencies')]).then(([value,hermes,capability,douyin,dependencies])=>{state.data.aihotDiagnostics=value;state.data.hermesStatus=hermes;state.data.hermesCapability=capability;state.data.douyinCapability=douyin.capabilities;state.data.dependencies=dependencies;if(state.view==='settings'){render();drawDependencyPanel();}}).catch(() => {}).finally(() => { state.diagnosticsLoading = false; });
  }
  if (state.view === 'studio' && state.jobId && !$('#content-workbench')) {
    const requestedJobId = state.jobId;
    api(`/api/studio/retrieve?jobId=${encodeURIComponent(requestedJobId)}`).then(result => {
      if (state.view !== 'studio' || state.jobId !== requestedJobId) return;
      const panel = document.querySelector('.editor aside'); if (!panel) return;
      const heading = [...panel.querySelectorAll('h3')].find(item => item.textContent.includes('检索预览')); if (!heading) return;
      const fragment = document.createElement('div');
      fragment.innerHTML = (result.warning ? `<p class="muted">${esc(result.warning)}</p>` : '') + result.documents.map(item => `<div class="job-row"><div><div class="job-title">${esc(item.name)}</div><div class="job-sub">${esc(item.type)} · v${esc(item.version)} · ${esc(item.locator)}</div><p class="news-summary">${esc(item.excerpt)}</p><button class="small-btn" data-document-detail="${esc(item.documentId)}">打开原文</button></div></div>`).join('');
      let node = heading.nextElementSibling;
      while (node && !node.classList.contains('chips')) { const next = node.nextElementSibling; node.remove(); node = next; }
      heading.after(fragment); bindEvents();
    }).catch(() => {});
  }
  if (state.view === 'checklist') api('/api/studio/runtime/checklist').then(result => { const node = $('#checklist-panel'); if (node) node.innerHTML = result.items.map(item => `<div class="job-row"><span class="status ${item.state === 'passed' ? 'done' : ''}">${item.state === 'passed' ? '已通过' : '待完成'}</span><div><div class="job-title">${esc(item.label)}</div><div class="job-sub">${esc(item.detail)}</div></div></div>`).join(''); }).catch(error => { const node = $('#checklist-panel'); if (node) node.textContent = error.message; });
}

function drawDependencyPanel(){
  return;
  if($('#dependency-list'))return;
  const page=document.querySelector('.page');if(!page)return;
  const section=document.createElement('section');section.className='panel';section.style.marginBottom='14px';section.innerHTML=`<div class="panel-head"><div><h3>依赖与边界</h3><div class="job-sub">只显示真实连接状态；未接通能力不会伪装完成。</div></div><span class="tag">运行体检</span></div><div id="dependency-list">${(state.data.dependencies?.dependencies||[]).map(item=>`<div class="job-row"><span class="status ${['live','ready','adapter_ready'].includes(item.state)?'done':''}">${esc(capabilityLabel(item.state))}</span><div><div class="job-title">${esc(item.name)}</div><div class="job-sub">${esc(item.detail)}</div></div></div>`).join('')}</div><div class="chips" style="margin-top:12px">${(state.data.hermesCapability?.modes||[]).map(item=>`<span class="chip">Hermes ${esc(item.label)}：${item.ready?'已配置，远端需验证':'待配置'}</span>`).join('')}<span class="chip">抖音采集：${esc(capabilityLabel(state.data.douyinCapability?.collection))}</span><span class="chip">ASR：${esc(capabilityLabel(state.data.douyinCapability?.transcription))}</span><span class="chip">飞书：${esc(state.data.douyinCapability?.feishu||'关闭')}</span></div><p class="job-sub">自动发布：关闭 · 自动飞书回写：关闭 · unknown 回执自动重发：关闭</p>`;
  page.querySelector('.welcome')?.after(section);
}

load().catch(error => { $('#app').innerHTML = `<div class="page"><div class="panel">无法加载本地工作台：${esc(error.message)}</div></div>`; });
