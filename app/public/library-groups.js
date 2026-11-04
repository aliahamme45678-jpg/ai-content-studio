function libraryGroups(documents){
 const groups=new Map();
 for(const doc of documents){const kind=/feishu/i.test(doc.source||'')?'飞书链接':/\.md$/i.test(doc.fileName||doc.name||'')||/markdown/i.test(doc.source||'')?'Markdown 文件':'其他素材';
 const key=doc.importSource||doc.sourceFile||doc.fileName||doc.batchId||doc.sourceTaskId||doc.source||doc.id;
 if(!groups.has(key))groups.set(key,{id:key,kind,title:doc.importName||doc.sourceFile||doc.fileName||(kind==='飞书链接'?'飞书内容库':kind==='Markdown 文件'?doc.name:doc.author||'采集素材'),url:doc.importUrl||null,docs:[]});groups.get(key).docs.push(doc);}
 return [...groups.values()];
}
function librarySourceCard(group){
 const sourceUrl=group.url||(group.kind==='飞书链接'?state.data.integration?.feishu?.url:null);
 const url=sourceUrl&&/^https:\/\//i.test(sourceUrl)?sourceUrl:null;const ids=JSON.stringify(group.docs.map(d=>d.id));
 return `<section class="library-source-group spx-library-card" data-library-group data-kind="${esc(group.kind)}" data-library-docs="${esc(ids)}"><div class="spx-library-card-head"><h3 title="${esc(group.title)}">${esc(group.title)}</h3><button class="small-btn" data-asset-manage="${esc(ids)}">管理</button></div><div class="spx-library-card-meta"><span>${esc(group.kind)}</span><span>${group.docs.length} 篇</span></div><div class="library-card-actions"><label><input type="checkbox" data-library-select>选择</label>${url?`<a class="small-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">打开飞书 ↗</a>`:`<button class="small-btn" data-library-open="${esc(group.id)}">查看文案</button>`}</div><div hidden>${group.docs.map(doc=>`<input type="checkbox" data-material-selected="${esc(doc.id)}">`).join('')}</div></section>`;
}
function feishuLibraryCard(group){return librarySourceCard(group);}
function groupedLibraryChoices(){return `<div class="tabs" id="library-source-tabs">${['全部来源','飞书链接','Markdown 文件','其他素材'].map((name,i)=>`<button class="tab ${i?'':'active'}" data-library-kind="${name}">${name}</button>`).join('')}</div><div class="library-tools"><input class="field" id="material-search" aria-label="搜索资料" placeholder="搜索资料"><select class="field" id="library-industry" aria-label="筛选行业"><option value="">全部行业</option><option>同行业文案</option><option>跨行业文案</option><option>未分类</option></select><select class="field" id="library-classify" aria-label="标记所选资料" hidden><option value="">标记所选文案</option><option>同行业文案</option><option>跨行业文案</option></select></div><div id="material-choices">${libraryGroups(state.data.documents.filter(d=>d.content?.trim())).map(librarySourceCard).join('')}</div><div id="library-empty" class="empty" hidden>未找到资料</div>`;}
function openLibrarySource(id){
 const group=libraryGroups(state.data.documents).find(g=>String(g.id)===String(id));if(!group)return;
 showDetail(group.title,`<div class="spx-library-documents">${group.docs.map(doc=>`<article><div><strong>${esc(doc.name)}</strong><span class="muted">${doc.content?.length||0} 字</span></div><button class="small-btn" data-document-detail="${esc(doc.id)}">查看</button></article>`).join('')}</div>`);bindEvents();
}
function bindGroupedLibrary(){
 mountAssetCreate();bindAssetManagement();
 const create=$('#asset-create');if(create)$('.library-tools')?.append(create);
 const importForm=$('#import-form');if(importForm){const oldPanel=importForm.closest('.panel');oldPanel?.classList.add('library-import-panel');const button=$('#open-import');if(button)document.querySelector('.asset-module-tabs')?.append(button);oldPanel?.querySelector('.panel-head')?.remove();}

 document.querySelectorAll('.page>.panel:not(#library-workflow) .panel-head .muted').forEach(node=>node.remove());
 document.querySelectorAll('.page>.panel:not(#library-workflow) .job-row').forEach(row=>row.remove());
 const filter=()=>{const query=$('#material-search').value.toLowerCase(),industry=$('#library-industry').value,kind=document.querySelector('[data-library-kind].active')?.dataset.libraryKind||'全部来源';
 document.querySelectorAll('[data-library-group]').forEach(group=>{let visible=0;if(group.dataset.libraryDocs){const ids=JSON.parse(group.dataset.libraryDocs);visible=state.data.documents.filter(doc=>ids.includes(doc.id)&&(!query||[group.querySelector('h3')?.textContent,doc.name,doc.content].join(' ').toLowerCase().includes(query))&&(!industry||(doc.industryScope||'未分类')===industry)).length;}group.querySelectorAll('[data-material-row]').forEach(row=>{const doc=state.data.documents.find(d=>d.id===row.dataset.materialRow);const match=(!query||[doc.name,doc.content].join(' ').toLowerCase().includes(query))&&(!industry||(doc.industryScope||'未分类')===industry);row.hidden=!match;if(match)visible++;});group.hidden=!visible||kind!=='全部来源'&&group.dataset.kind!==kind;});$('#library-empty').hidden=Boolean(document.querySelector('[data-library-group]:not([hidden])'));};
 $('#material-search').oninput=filter;$('#library-industry').onchange=filter;
 document.querySelectorAll('[data-library-kind]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-library-kind]').forEach(t=>t.classList.toggle('active',t===b));filter();});
 $('#library-classify').onchange=async()=>{const ids=[...new Set([...document.querySelectorAll('[data-material-selected]:checked')].map(i=>i.dataset.materialSelected))];if(!ids.length){toast('请选择文案','error');return;}try{await api('/api/studio/documents/classify',{method:'POST',body:JSON.stringify({ids,industryScope:$('#library-classify').value})});await load();}catch(error){toast(error.message,'error');}};
 document.querySelectorAll('[data-library-select]').forEach(box=>box.onchange=()=>{box.closest('[data-library-group]').querySelectorAll('[data-material-selected]').forEach(input=>input.checked=box.checked);$('#library-classify').hidden=!document.querySelector('[data-library-select]:checked');});
 document.querySelectorAll('[data-library-open]').forEach(button=>button.onclick=()=>openLibrarySource(button.dataset.libraryOpen));
 bindEvents();
}

function showTopicAngles(topic){
 showDetail('选择写作角度',`<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">${topic.angles.map(angle=>`<article class="template-card"><h3>${esc(angle.title)}</h3><p>${esc(angle.audience)}</p><button class="primary" data-use-angle="${esc(angle.id)}">用这个角度写作</button></article>`).join('')}</div>`);
 document.querySelectorAll('[data-use-angle]').forEach(button=>button.onclick=()=>{const angle=topic.angles.find(a=>a.id===button.dataset.useAngle);openFullWriter({mode:'topic',topicId:topic.id,angleId:angle.id,title:angle.title,format:angle.format});});
}

function mountAssetCreate(){
 const tabs=document.querySelector('.asset-module-tabs');if(!tabs||$('#asset-create'))return;
 const button=document.createElement('button');button.className='primary';button.id='asset-create';button.textContent='创建素材库';tabs.append(button);
 button.onclick=()=>{showDetail('创建素材库',`<label>素材库名称<input class="field" id="asset-name"></label><label>来源<select class="field" id="asset-kind"><option value="feishu">飞书内容库</option><option value="markdown">Markdown 文件</option></select></label><div id="asset-feishu-fields"><label>飞书表格链接<input class="field" id="asset-url" value="${esc(state.data.integration?.feishu?.url||'')}"></label></div><div id="asset-markdown-fields" hidden><input type="file" id="asset-file" accept=".md,.markdown,.txt"></div><button class="primary" id="asset-confirm">创建</button><p id="asset-error" role="status"></p>`);
 $('#asset-kind').onchange=()=>{$('#asset-feishu-fields').hidden=$('#asset-kind').value!=='feishu';$('#asset-markdown-fields').hidden=$('#asset-kind').value!=='markdown';};
 $('#asset-confirm').onclick=async()=>{const submit=$('#asset-confirm');submit.disabled=true;try{const kind=$('#asset-kind').value,file=$('#asset-file').files?.[0];if(kind==='markdown'&&!file)throw new Error('请选择 Markdown 文件');const result=await api('/api/studio/assets/create',{method:'POST',body:JSON.stringify({name:$('#asset-name').value,kind,url:$('#asset-url').value,fileName:file?.name,text:file?await file.text():undefined})});document.querySelector('.detail-sheet')?.remove();await load();toast(`已创建 ${result.name}，共 ${result.count} 篇文案`,'success');}catch(error){$('#asset-error').textContent=error.message;submit.disabled=false;}};
 };
}
function bindAssetManagement(){
 document.querySelectorAll('[data-asset-manage]').forEach(b=>b.onclick=()=>{const ids=JSON.parse(b.dataset.assetManage),docs=state.data.documents.filter(d=>ids.includes(d.id));showDetail('管理素材库',`<label>名称<input class="field" id="asset-edit-name" value="${esc(docs[0].importName||docs[0].name)}"></label>${docs.length===1&&!/feishu/i.test(docs[0].source)?`<label>正文<textarea class="textarea" id="asset-edit-content">${esc(docs[0].content)}</textarea></label>`:''}<div class="actions"><button class="primary" id="asset-edit-save">保存</button><button class="small-btn" id="asset-delete">删除</button></div><p id="asset-edit-status" role="status"></p>`);for(const [id,action]of [['asset-edit-save','save'],['asset-delete','delete']])$('#'+id).onclick=async()=>{try{await api('/api/studio/assets/manage',{method:'POST',body:JSON.stringify({ids,action,name:$('#asset-edit-name').value,content:$('#asset-edit-content')?.value})});document.querySelector('.detail-sheet')?.remove();await load();}catch(e){$('#asset-edit-status').textContent=e.message;}};});
}
