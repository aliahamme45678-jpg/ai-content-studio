let currentHistoryId = null;
let prompts = {};
let activePromptKey = "rewrite";
let materialLibrary = [];
let currentMaterialPage = 1;
let materialViewMode = "grid";
let editingMaterialId = null;
let forbiddenWords = [];

const materialPageSize = 12;
const SOUL_STORAGE_KEY = "copywriter_soul_state_v2";
const $ = (id) => document.getElementById(id);

const text = {
  generated: "已生成",
  pending: "待生成",
  notGenerated: "未生成",
  generating: "生成中...",
  rewriting: "重构中...",
  copy: "复制",
  edit: "编辑",
  delete: "删除",
  fission: "裂变文案",
  submitDone: "已入库，素材库已按添加时间从新到旧刷新。",
  saveDone: "已保存，提示词会在下一次生成时生效。",
  materialSaved: "素材已更新。",
  materialDeleted: "素材已删除。",
  empty: "暂无匹配素材",
  all: "全部",
  chars: "字数",
  createdAt: "更新时间",
  stylePending: "待识别",
  styleGood: "佳",
  requestFailed: "请求失败"
};

const iconMap = {
  edit: `<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  plus: `<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
  bulb: `<svg viewBox="0 0 24 24"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.5 14a6 6 0 1 1 7 0c-.7.5-1 1.2-1 2h-5c0-.8-.3-1.5-1-2Z"/></svg>`,
  zap: `<svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 10-13h-7z"/></svg>`,
  spark: `<svg viewBox="0 0 24 24"><path d="M12 3 14.2 8.8 20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2Z"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m8 12 2.6 2.6L16 9"/></svg>`,
  info: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
  alert: `<svg viewBox="0 0 24 24"><path d="m12 3 10 18H2Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  file: `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>`,
  copy: `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  layers: `<svg viewBox="0 0 24 24"><path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`,
  import: `<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14a2 2 0 0 0 2-2v-3"/><path d="M3 16v3a2 2 0 0 0 2 2"/></svg>`,
  filter: `<svg viewBox="0 0 24 24"><path d="M22 3H2l8 9.5V20l4 2v-9.5Z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>`,
  search: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  grid: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
  list: `<svg viewBox="0 0 24 24"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>`,
  clock: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  close: `<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
};

function renderIcons(root = document) {
  for (const item of root.querySelectorAll("[data-icon]")) {
    const svg = iconMap[item.dataset.icon];
    if (!svg) continue;
    item.classList.add("svg-icon");
    item.innerHTML = svg;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || text.requestFailed);
  return data;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitTitleBody(output) {
  const raw = String(output || "").trim();
  const titleMatch = raw.match(/^标题[:：]\s*(.+)$/m);
  const body = raw.replace(/^标题[:：].*$/m, "").trim();
  return { title: titleMatch?.[1]?.trim() || "", body };
}

function splitParagraphs(output) {
  return splitTitleBody(output).body.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
}

function targetSectionText(output, section) {
  const paragraphs = splitParagraphs(output);
  if (!paragraphs.length) return "";
  if (section === "opening") return paragraphs[0] || "";
  if (section === "ending") return paragraphs[paragraphs.length - 1] || "";
  return paragraphs.slice(1, -1).join("\n\n") || paragraphs.slice(1).join("\n\n") || "";
}

function highlightForbidden(html) {
  return highlightForbiddenText(String(html || ""));
}

function highlightForbiddenText(rawText) {
  const source = String(rawText || "");
  const candidates = [...forbiddenWords]
    .filter((item) => item.word && item.word.length >= 2 && source.includes(item.word))
    .sort((a, b) => b.word.length - a.word.length);
  if (!candidates.length) return escapeHtml(source);

  const ranges = [];
  for (const item of candidates) {
    let from = 0;
    while (from < source.length) {
      const index = source.indexOf(item.word, from);
      if (index < 0) break;
      const end = index + item.word.length;
      const overlaps = ranges.some((range) => index < range.end && end > range.start);
      if (!overlaps) ranges.push({ start: index, end, item });
      from = end;
    }
  }
  ranges.sort((a, b) => a.start - b.start);

  let cursor = 0;
  let html = "";
  for (const range of ranges) {
    html += escapeHtml(source.slice(cursor, range.start));
    const word = source.slice(range.start, range.end);
    html += `<span class="forbidden-word" title="${escapeHtml(range.item.level)} ${escapeHtml(range.item.category)}">${escapeHtml(word)}</span>`;
    cursor = range.end;
  }
  html += escapeHtml(source.slice(cursor));
  return html;
}

function renderPlainPreview(targetId, value) {
  const preview = $(targetId);
  if (!preview) return;
  const raw = String(value || "");
  preview.classList.toggle("muted-preview", !raw.trim());
  preview.innerHTML = raw.trim() ? highlightForbiddenText(raw) : escapeHtml(preview.textContent || "");
}

function renderRewritePreview(value, section, originalOutput) {
  const preview = $("sectionOutputPreview");
  if (!preview) return;
  const raw = String(value || "");
  preview.classList.toggle("muted-preview", !raw.trim());
  if (!raw.trim()) {
    preview.textContent = "点击“生成重构”后，结果会显示在这里，不会覆盖左侧生成结果。";
    return;
  }

  const target = targetSectionText(raw, section);
  let html = highlightForbiddenText(raw);
  if (target && raw.includes(target)) {
    html = html.replace(highlightForbiddenText(target), '<span class="rewrite-highlight">' + highlightForbiddenText(target) + '</span>');
  } else {
    html = '<span class="rewrite-highlight">' + html + '</span>';
  }
  preview.innerHTML = html;
}

function normalizeForDuplicate(value) {
  return String(value || "")
    .replace(/^标题[:：].*$/gm, "")
    .replace(/[\s\r\n\t，。！？、；：,.!?;:'"“”‘’（）()【】[\]《》<>—–\-_/\\|]/g, "");
}

function duplicateRate(rawContent, output) {
  const raw = normalizeForDuplicate(rawContent);
  const result = normalizeForDuplicate(output);
  if (!raw || !result) return 0;
  if (result.length < 2) return raw.includes(result) ? 100 : 0;

  const rawPairs = new Map();
  for (let i = 0; i < raw.length - 1; i++) {
    const pair = raw.slice(i, i + 2);
    rawPairs.set(pair, (rawPairs.get(pair) || 0) + 1);
  }

  let total = 0;
  let matched = 0;
  for (let i = 0; i < result.length - 1; i++) {
    const pair = result.slice(i, i + 2);
    total += 1;
    const count = rawPairs.get(pair) || 0;
    if (count > 0) {
      matched += 1;
      rawPairs.set(pair, count - 1);
    }
  }
  return total ? Math.round((matched / total) * 100) : 0;
}

function updateDuplicateMetric() {
  const output = $("outputText")?.value || "";
  const raw = $("rawContent")?.value || "";
  const outputCount = output.length;
  const rate = duplicateRate(raw, output);
  if ($("outputCount")) $("outputCount").textContent = String(outputCount);
  const node = $("duplicateRate");
  if (!node) return;
  node.textContent = rate + "%";
  node.classList.remove("dup-red", "dup-blue", "dup-green");
  node.classList.add(rate >= 80 ? "dup-red" : rate >= 50 ? "dup-blue" : "dup-green");
}

function showView(id) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === id));
}

function setBadge(id, status) {
  const badge = $(id);
  if (!badge) return;
  badge.textContent = status;
  badge.classList.remove("pending", "not-generated", "generated");
  if (status === text.generated) badge.classList.add("generated");
  else if (status === text.pending) badge.classList.add("pending");
  else badge.classList.add("not-generated");
}

function setBusy(isBusy) {
  $("generateBtn").disabled = isBusy;
  $("generateBtn").innerHTML = isBusy ? `<span>...</span>${text.generating}` : `<span data-icon="spark"></span>开始生成`;
  renderIcons();
  if (isBusy) setBadge("generateStatus", text.pending);
}

function setSectionBusy(isBusy) {
  $("regenerateSectionBtn").disabled = isBusy;
  $("regenerateSectionBtn").innerHTML = isBusy ? `<span>...</span>${text.rewriting}` : `<span data-icon="refresh"></span>生成重构`;
  renderIcons();
  if (isBusy) setBadge("rewriteStatus", text.pending);
}

function updateCounts() {
  if ($("rawCount")) $("rawCount").textContent = String(($("rawContent")?.value || "").length);
  if ($("problemCount")) $("problemCount").textContent = String(($("reviewProblem")?.value || "").length);
  updateDuplicateMetric();
}

function enterResultEdit(textareaId) {
  const textarea = $(textareaId);
  const shell = textarea?.closest(".rich-result-shell");
  if (!textarea || !shell) return;
  shell.classList.add("editing");
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function leaveResultEdit(textareaId, previewId, isRewrite = false) {
  const textarea = $(textareaId);
  const shell = textarea?.closest(".rich-result-shell");
  if (!textarea || !shell) return;
  shell.classList.remove("editing");
  if (isRewrite) renderRewritePreview(textarea.value, $("sectionType")?.value, $("outputText")?.value || "");
  else renderPlainPreview(previewId, textarea.value);
  updateDuplicateMetric();
}

function currentPromptKey() {
  const activeGroupId = document.querySelector(".prompt-tab.active")?.dataset.promptTab || "rewritePromptGroup";
  const activeSelect = document.querySelector(`#${activeGroupId} [data-prompt-select]`);
  return activeSelect?.value || "rewrite";
}

function syncPromptEditor() {
  activePromptKey = currentPromptKey();
  $("promptText").value = prompts[activePromptKey] || "";
  $("promptStatus").textContent = "";
}

function cachePromptEditor() {
  if (activePromptKey && $("promptText")) prompts[activePromptKey] = $("promptText").value;
}

function formatRating(value) {
  const clean = String(value || "A").replace("级", "").trim() || "A";
  return `${clean}级`;
}

function apiRating(value) {
  return String(value || "A").replace("级", "").trim() || "A";
}

function normalizeIndustry(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.toLowerCase().includes("cross-border")) return "跨境";
  if (raw.includes("跨境")) return "跨境";
  return raw;
}

function normalizeCopyType(value) {
  const raw = String(value || "").trim();
  if (!raw) return "干货类型";
  if (raw.includes("干货")) return "干货类型";
  if (raw.includes("思维")) return "思维类型";
  if (raw.includes("低粉")) return "低粉爆款";
  if (raw.includes("爆款")) return "爆款";
  return raw;
}

function inferIndustryType(value) {
  const raw = String(value || "");
  if (/跨境|电商|TikTok|TK|小店|商品机会|选品|店铺|出单|自然流|GMV|爆单符/i.test(raw)) return "同行业文案";
  return "跨行业文案";
}

function normalizeIndustryType(value, item = {}) {
  const raw = String(value || "").trim();
  if (raw.includes("同行业")) return "同行业文案";
  if (raw.includes("跨行业")) return "跨行业文案";
  return inferIndustryType([item.content, item.copy, item.body, item.niche, item.industry, item.notes].filter(Boolean).join("\n"));
}

function normalizeMaterialItem(item) {
  const content = item.copy || item.body || item.output || item.content || "";
  return {
    id: String(item.id || crypto.randomUUID()),
    source: item.source || "original",
    createdAt: item.createdAt || "",
    content,
    platform: item.platform || "TikTok",
    industry: normalizeIndustry(item.niche || item.industry),
    rating: formatRating(item.rating),
    copyType: normalizeCopyType(item.tags || item.copyType || item.notes),
    industryType: normalizeIndustryType(item.industryType || item.copyIndustryType || item.notes, { ...item, content })
  };
}

function brokenText(value) {
  const raw = String(value || "");
  if (!raw.trim()) return true;
  if (/\?{2,}/.test(raw)) return true;
  if (raw.includes("锟") || raw.includes("\uFFFD")) return true;
  return false;
}

function updateMaterialStats() {
  const copy = $("materialCopy")?.value || "";
  const wordCount = copy.replace(/\s/g, "").length;
  const sentenceCount = copy.split(/[。！？\n]/).filter(Boolean).length;
  if ($("materialWordCount")) $("materialWordCount").textContent = String(wordCount);
  if ($("materialSentenceCount")) $("materialSentenceCount").textContent = String(sentenceCount);
}

function updateMaterialSummary() {
  const industry = normalizeIndustry($("materialNiche")?.value);
  const rating = formatRating($("materialRating")?.value || "S");
  const copyType = normalizeCopyType($("materialCopyType")?.value);
  const industryType = normalizeIndustryType($("materialIndustryType")?.value);
  if ($("materialSummaryIndustry")) $("materialSummaryIndustry").textContent = industry;
  if ($("materialSummaryRating")) $("materialSummaryRating").textContent = rating;
  if ($("materialSummaryType")) $("materialSummaryType").textContent = copyType;
  if ($("materialSummaryIndustryType")) $("materialSummaryIndustryType").textContent = industryType;
}

function syncOptionButtons() {
  document.querySelectorAll(".material-options").forEach((group) => {
    const target = $(group.dataset.target);
    group.querySelectorAll(".material-option").forEach((button) => {
      button.classList.toggle("active", target?.value === button.dataset.value);
    });
  });
  document.querySelectorAll(".filter-pills").forEach((group) => {
    const target = $(group.dataset.filterTarget);
    group.querySelectorAll(".filter-pill").forEach((button) => {
      button.classList.toggle("active", (target?.value || "") === button.dataset.value);
    });
  });
}

function materialDateValue(item) {
  const time = Date.parse(item.createdAt || "");
  if (Number.isFinite(time)) return time;
  const idNumber = Number(String(item.id).replace(/\D/g, ""));
  return Number.isFinite(idNumber) ? idNumber : 0;
}

function filteredMaterials() {
  const keyword = ($("materialSearchInput")?.value || "").trim();
  const industry = $("materialFilterIndustry")?.value || "";
  const rating = $("materialFilterRating")?.value || "";
  const copyType = $("materialFilterType")?.value || "";
  const industryType = $("materialFilterIndustryType")?.value || "";
  return materialLibrary
    .filter((item) => !brokenText(item.content))
    .filter((item) => (keyword ? item.content.includes(keyword) : true))
    .filter((item) => (industry ? item.industry === industry : true))
    .filter((item) => (rating ? item.rating === formatRating(rating) : true))
    .filter((item) => (copyType ? item.copyType === copyType : true))
    .filter((item) => (industryType ? item.industryType === industryType : true))
    .sort((a, b) => materialDateValue(b) - materialDateValue(a));
}

function tagClass(value) {
  if (value === "同行业文案") return "blue";
  if (value === "跨行业文案") return "orange";
  if (value === "S级" || value === "爆款") return "orange";
  if (value === "A级") return "purple";
  if (value === "AI") return "blue";
  return "green";
}

function renderPagination(totalPages) {
  const box = document.querySelector(".material-pagination");
  if (!box) return;
  const pageButton = (page, label = page) => `<button type="button" data-page="${page}" class="${page === currentMaterialPage ? "active" : ""}">${label}</button>`;
  const pages = [];
  pages.push(pageButton(Math.max(1, currentMaterialPage - 1), "‹"));
  for (let page = 1; page <= Math.min(totalPages, 5); page += 1) pages.push(pageButton(page));
  if (totalPages > 6) pages.push("<span>...</span>", pageButton(totalPages));
  pages.push(pageButton(Math.min(totalPages, currentMaterialPage + 1), "›"));
  box.innerHTML = pages.join("");
  box.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      currentMaterialPage = Number(button.dataset.page || 1);
      renderMaterialLibrary();
    });
  });
}

function renderMaterialLibrary() {
  const grid = $("materialLibraryGrid");
  const empty = $("materialEmptyState");
  if (!grid) return;
  const items = filteredMaterials();
  const totalPages = Math.max(1, Math.ceil(items.length / materialPageSize));
  currentMaterialPage = Math.max(1, Math.min(currentMaterialPage, totalPages));
  const pageItems = items.slice((currentMaterialPage - 1) * materialPageSize, currentMaterialPage * materialPageSize);
  if ($("materialResultCount")) $("materialResultCount").textContent = String(items.length);
  if ($("materialTotalBadge")) $("materialTotalBadge").textContent = `${materialLibrary.filter((item) => !brokenText(item.content)).length} 条`;

  grid.classList.toggle("list-mode", materialViewMode === "list");
  grid.innerHTML = pageItems.map((item) => {
    const date = item.createdAt ? String(item.createdAt).slice(0, 16).replace("T", " ") : "本地素材";
    const count = item.content.replace(/\s/g, "").length;
    return `<article class="material-card" data-material-id="${escapeHtml(item.id)}">
      <div class="material-tags">
        <span class="material-tag ${tagClass(item.industry)}">${escapeHtml(item.industry)}</span>
        <span class="material-tag ${tagClass(item.industryType)}">${escapeHtml(item.industryType)}</span>
        <span class="material-tag ${tagClass(item.rating)}">${escapeHtml(item.rating)}</span>
        <span class="material-tag ${tagClass(item.copyType)}">${escapeHtml(item.copyType)}</span>
      </div>
      <p class="material-card-content">${escapeHtml(item.content)}</p>
      <div class="material-card-meta"><span><span data-icon="clock"></span>${escapeHtml(date)}</span><span>字数${count}</span></div>
      <div class="material-actions">
        <button type="button" data-material-action="edit"><span data-icon="edit"></span>${text.edit}</button>
        <button type="button" data-material-action="delete"><span data-icon="trash"></span>${text.delete}</button>
        <button type="button" data-material-action="fission"><span data-icon="spark"></span>${text.fission}</button>
      </div>
    </article>`;
  }).join("");
  empty.style.display = pageItems.length ? "none" : "flex";
  empty.textContent = text.empty;
  renderIcons(grid);
  renderPagination(totalPages);
}

async function loadMaterials() {
  const data = await api("/api/materials");
  const seen = new Map();
  data.map(normalizeMaterialItem).forEach((item) => {
    if (!brokenText(item.content)) seen.set(item.id, item);
  });
  materialLibrary = [...seen.values()];
  renderMaterialLibrary();
}

function setMaterialTab(tabId) {
  document.querySelectorAll(".material-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.materialTab === tabId));
  document.querySelectorAll(".material-pane").forEach((pane) => pane.classList.toggle("active", pane.id === tabId));
  if (tabId === "materialLibraryPane") loadMaterials().catch((error) => {
    if ($("materialStatus")) $("materialStatus").textContent = error.message;
  });
}

function openEditModal(id) {
  const item = materialLibrary.find((entry) => entry.id === id);
  if (!item) return;
  editingMaterialId = id;
  $("editMaterialCopy").value = item.content;
  $("editMaterialIndustry").value = item.industry;
  $("editMaterialRating").value = apiRating(item.rating);
  $("editMaterialType").value = item.copyType;
  $("editMaterialIndustryType").value = item.industryType;
  $("materialEditModal").classList.add("open");
}

function closeEditModal() {
  editingMaterialId = null;
  $("materialEditModal")?.classList.remove("open");
}

async function deleteMaterial(id) {
  await api(`/api/material/${encodeURIComponent(id)}`, { method: "DELETE" });
  materialLibrary = materialLibrary.filter((item) => item.id !== id);
  renderMaterialLibrary();
  if ($("materialStatus")) $("materialStatus").textContent = text.materialDeleted;
}

async function saveMaterialEdit() {
  if (!editingMaterialId) return;
  const payload = {
    copy: $("editMaterialCopy").value,
    niche: $("editMaterialIndustry").value,
    rating: $("editMaterialRating").value,
    tags: $("editMaterialType").value,
    industryType: $("editMaterialIndustryType").value,
    platform: "TikTok"
  };
  const updated = await api(`/api/material/${encodeURIComponent(editingMaterialId)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  const normalized = normalizeMaterialItem(updated);
  materialLibrary = materialLibrary.map((item) => item.id === editingMaterialId ? normalized : item);
  closeEditModal();
  renderMaterialLibrary();
  if ($("materialStatus")) $("materialStatus").textContent = text.materialSaved;
}

function fissionFromMaterial(id) {
  const item = materialLibrary.find((entry) => entry.id === id);
  if (!item) return;
  $("rawContent").value = item.content;
  $("functionType").value = "fission";
  showView("rewriteView");
  updateCounts();
  $("generateBtn").click();
}

function wireEvents() {
  document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => showView(item.dataset.view)));
  document.querySelectorAll(".prompt-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      cachePromptEditor();
      document.querySelectorAll(".prompt-tab").forEach((item) => item.classList.toggle("active", item === tab));
      document.querySelectorAll(".prompt-group").forEach((group) => group.classList.toggle("active", group.id === tab.dataset.promptTab));
      syncPromptEditor();
    });
  });
  document.querySelectorAll("[data-prompt-select]").forEach((select) => select.addEventListener("change", () => {
    cachePromptEditor();
    syncPromptEditor();
  }));
  $("promptText")?.addEventListener("input", () => {
    prompts[activePromptKey] = $("promptText").value;
  });
  $("rawContent")?.addEventListener("input", updateCounts);
  $("reviewProblem")?.addEventListener("input", updateCounts);
  $("materialCopy")?.addEventListener("input", updateMaterialStats);
  $("outputPreview")?.addEventListener("click", () => enterResultEdit("outputText"));
  $("sectionOutputPreview")?.addEventListener("click", () => enterResultEdit("sectionOutputText"));
  $("outputText")?.addEventListener("input", () => {
    renderPlainPreview("outputPreview", $("outputText").value);
    updateDuplicateMetric();
  });
  $("sectionOutputText")?.addEventListener("input", () => renderRewritePreview($("sectionOutputText").value, $("sectionType")?.value, $("outputText")?.value || ""));
  $("outputText")?.addEventListener("blur", () => leaveResultEdit("outputText", "outputPreview"));
  $("sectionOutputText")?.addEventListener("blur", () => leaveResultEdit("sectionOutputText", "sectionOutputPreview", true));

  document.querySelectorAll(".material-tab").forEach((tab) => tab.addEventListener("click", () => setMaterialTab(tab.dataset.materialTab)));
  document.querySelectorAll(".material-option").forEach((button) => {
    button.addEventListener("click", () => {
      const target = $(button.closest(".material-options").dataset.target);
      if (target) target.value = button.dataset.value;
      syncOptionButtons();
      updateMaterialSummary();
    });
  });
  document.querySelectorAll(".filter-pill").forEach((button) => {
    button.addEventListener("click", () => {
      const target = $(button.closest(".filter-pills").dataset.filterTarget);
      if (target) target.value = button.dataset.value;
      currentMaterialPage = 1;
      syncOptionButtons();
      renderMaterialLibrary();
    });
  });
  document.querySelectorAll(".view-toggle").forEach((button, index) => {
    button.addEventListener("click", () => {
      materialViewMode = index === 0 ? "grid" : "list";
      document.querySelectorAll(".view-toggle").forEach((item) => item.classList.toggle("active", item === button));
      renderMaterialLibrary();
    });
  });

  $("materialSearchInput")?.addEventListener("input", () => {
    currentMaterialPage = 1;
    renderMaterialLibrary();
  });
  $("materialSearchClear")?.addEventListener("click", () => {
    $("materialSearchInput").value = "";
    currentMaterialPage = 1;
    renderMaterialLibrary();
  });
  $("materialResetBtn")?.addEventListener("click", () => {
    $("materialSearchInput").value = "";
    ["materialFilterIndustry", "materialFilterRating", "materialFilterType", "materialFilterIndustryType"].forEach((id) => $(id).value = "");
    currentMaterialPage = 1;
    syncOptionButtons();
    renderMaterialLibrary();
  });
  $("materialFilterBtn")?.addEventListener("click", renderMaterialLibrary);
  $("clearMaterialBtn")?.addEventListener("click", () => {
    $("materialCopy").value = "";
    updateMaterialStats();
  });

  $("materialLibraryGrid")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-material-action]");
    const card = event.target.closest("[data-material-id]");
    if (!button || !card) return;
    const id = card.dataset.materialId;
    if (button.dataset.materialAction === "edit") openEditModal(id);
    if (button.dataset.materialAction === "delete") deleteMaterial(id).catch((error) => $("materialStatus").textContent = error.message);
    if (button.dataset.materialAction === "fission") fissionFromMaterial(id);
  });

  $("closeMaterialEditBtn")?.addEventListener("click", closeEditModal);
  $("saveMaterialEditBtn")?.addEventListener("click", () => saveMaterialEdit().catch((error) => $("materialStatus").textContent = error.message));
}

function readSoulRewritePayload() {
  try {
    const state = JSON.parse(localStorage.getItem(SOUL_STORAGE_KEY) || "null");
    if (!state) return { type: "none", enabled: false };
    const selected = state.selectedPersona || "我的灵魂";
    if (selected && selected !== "我的灵魂") {
      return { type: "builtin", enabled: true, persona: selected };
    }
    if (state.profile?.created) {
      return { type: "custom", enabled: true, profile: state.profile };
    }
  } catch {}
  return { type: "none", enabled: false };
}

function readTopicSoulPayload() {
  const selected = $("topicSoulStyle")?.value || "none";
  if (selected === "none") return { soulRewrite: false, soul: { type: "none", enabled: false }, label: "不使用灵魂" };
  if (selected !== "personal") return { soulRewrite: true, soul: { type: "builtin", enabled: true, persona: selected }, label: selected };
  try {
    const state = JSON.parse(localStorage.getItem(SOUL_STORAGE_KEY) || "null");
    if (state?.profile?.created) {
      return { soulRewrite: true, soul: { type: "custom", enabled: true, profile: state.profile }, label: state.profile.name || "个人灵魂" };
    }
  } catch {}
  return { soulRewrite: false, soul: { type: "none", enabled: false }, label: "个人灵魂未创建" };
}

function topicPayload() {
  const soul = readTopicSoulPayload();
  return {
    topic: $("topicInput")?.value.trim() || "",
    conditions: $("topicConditions")?.value.trim() || "",
    targetWordCount: Number($("topicTargetWords")?.value || 900),
    copyStyle: $("topicCopyStyle")?.value || "清醒实战型",
    hookType: $("topicHookType")?.value || "扎心共情型",
    copyType: $("topicCopyType")?.value || "思维型",
    isLeadGen: Boolean($("topicLeadGen")?.checked),
    leadGenGoal: $("topicLeadGoal")?.value || "",
    leadGenKeyword: $("topicLeadKeyword")?.value.trim() || "",
    debug: Boolean($("topicDebug")?.checked),
    soulRewrite: soul.soulRewrite,
    soul: soul.soul,
    soulLabel: soul.label
  };
}

function renderTopicDebug(data) {
  const box = $("topicDebugBox");
  if (!box) return;
  box.hidden = !Boolean($("topicDebug")?.checked);
  if (box.hidden) return;
  $("topicMaterialJson").textContent = JSON.stringify(data.material_json || {}, null, 2);
  $("topicStepARaw").textContent = data.step_a_raw_output || "";
  $("topicIndustryCards").textContent = JSON.stringify(data.industry_content_cards || [], null, 2);
  $("topicStyleCards").textContent = JSON.stringify(data.cross_industry_style_cards || [], null, 2);
}

async function generateTopicCopy() {
  const payload = topicPayload();
  if (!payload.topic) {
    $("topicResultText").textContent = "请先输入话题。";
    setBadge("topicStatus", text.notGenerated);
    return;
  }
  setBadge("topicStatus", text.generating);
  $("topicResultText").textContent = "正在检索素材并生成文案...";
  try {
    const data = await api("/api/topic-copywriting", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const output = data.final_copy_text || "";
    $("topicResultText").textContent = output;
    $("topicActualStat").textContent = String(output.replace(/\s/g, "").length);
    $("topicTargetStat").textContent = String(payload.targetWordCount);
    if ($("topicCopyTypeStat")) $("topicCopyTypeStat").textContent = payload.copyType;
    $("topicHookStat").textContent = payload.hookType;
    $("topicSoulStat").textContent = payload.soulLabel;
    $("topicMeta").textContent = `${payload.targetWordCount} 字 · ${payload.copyStyle} · ${payload.copyType} · ${payload.hookType}`;
    renderTopicDebug(data);
    setBadge("topicStatus", text.generated);
  } catch (error) {
    $("topicResultText").textContent = error.message;
    setBadge("topicStatus", text.notGenerated);
  }
}

async function generateCopy() {
  const rawContent = $("rawContent").value.trim();
  if (!rawContent) {
    setBadge("generateStatus", text.notGenerated);
    $("outputText").value = "请先粘贴原始文案。";
    renderPlainPreview("outputPreview", $("outputText").value);
    updateDuplicateMetric();
    return;
  }
  setBusy(true);
  try {
    const soulPayload = readSoulRewritePayload();
    const data = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        rawContent,
        functionType: $("functionType").value,
        soulRewrite: Boolean($("soulRewriteToggle")?.checked),
        soul: soulPayload
      })
    });
    currentHistoryId = data.id;
    $("outputText").value = data.output || "";
    renderPlainPreview("outputPreview", $("outputText").value);
    updateDuplicateMetric();
    $("modeText").textContent = data.mode === "hermes" ? "Hermes 已生成" : "草稿模式";
    setBadge("generateStatus", text.generated);
  } catch (error) {
    $("outputText").value = error.message;
    renderPlainPreview("outputPreview", $("outputText").value);
    updateDuplicateMetric();
    setBadge("generateStatus", text.notGenerated);
  } finally {
    setBusy(false);
  }
}

async function regenerateSection() {
  const output = $("outputText").value.trim();
  if (!output) {
    $("sectionOutputText").value = "请先生成文案。";
    renderRewritePreview($("sectionOutputText").value, $("sectionType").value, output);
    return;
  }
  setSectionBusy(true);
  try {
    const data = await api("/api/regenerate-section", {
      method: "POST",
      body: JSON.stringify({
        rawContent: $("rawContent").value,
        output,
        section: $("sectionType").value
      })
    });
    $("sectionOutputText").value = data.output || "";
    renderRewritePreview($("sectionOutputText").value, $("sectionType").value, output);
    setBadge("rewriteStatus", text.generated);
  } catch (error) {
    $("sectionOutputText").value = error.message;
    renderRewritePreview($("sectionOutputText").value, $("sectionType").value, output);
    setBadge("rewriteStatus", text.notGenerated);
  } finally {
    setSectionBusy(false);
  }
}

async function saveMaterial() {
  const copy = $("materialCopy").value.trim();
  if (!copy) {
    $("materialStatus").textContent = "请先输入文案。";
    return;
  }
  const item = await api("/api/material", {
    method: "POST",
    body: JSON.stringify({
      copy,
      platform: $("materialPlatform")?.value || "TikTok",
      niche: $("materialNiche").value,
      rating: apiRating($("materialRating").value),
      tags: $("materialCopyType").value,
      industryType: $("materialIndustryType").value,
      notes: "手动添加到原始爆款素材库"
    })
  });
  $("materialStatus").textContent = text.submitDone;
  $("materialCopy").value = "";
  updateMaterialStats();
  await loadMaterials();
  setMaterialTab("materialLibraryPane");
  currentMaterialPage = 1;
  renderMaterialLibrary();
}

async function saveReview() {
  try {
    const data = await api("/api/review", {
      method: "POST",
      body: JSON.stringify({
        historyId: currentHistoryId,
        output: $("outputText").value,
        rawContent: $("rawContent").value,
        rating: $("reviewRating").value,
        problem: $("reviewProblem").value,
        scores: Object.fromEntries([...document.querySelectorAll(".score-input")].map((input) => [input.dataset.scoreLabel, input.value]))
      })
    });
    $("reviewStatus").textContent = `${data.rating || $("reviewRating").value} 已记录`;
  } catch (error) {
    $("reviewStatus").textContent = error.message;
  }
}

async function init() {
  renderIcons();
  wireEvents();
  try {
    const config = await api("/api/config");
    $("configText").textContent = config.hermesConfigured ? "Hermes 已接入" : "Hermes 未配置";
  } catch {
    $("configText").textContent = "连接失败";
  }
  try {
    const data = await api("/api/prompts");
    prompts = data.prompts || {};
    syncPromptEditor();
  } catch (error) {
    $("promptStatus").textContent = error.message;
  }
  try {
    forbiddenWords = await api("/api/forbidden-words");
  } catch {
    forbiddenWords = [];
  }
  setBadge("generateStatus", text.notGenerated);
  setBadge("rewriteStatus", text.pending);
  updateCounts();
  updateMaterialStats();
  updateMaterialSummary();
  syncOptionButtons();
  loadMaterials().catch(() => renderMaterialLibrary());
}

$("generateBtn")?.addEventListener("click", generateCopy);
$("topicGenerateBtn")?.addEventListener("click", generateTopicCopy);
$("topicGenerateBtnBottom")?.addEventListener("click", generateTopicCopy);
$("topicCopyBtn")?.addEventListener("click", () => navigator.clipboard.writeText($("topicResultText")?.textContent || ""));
$("topicInput")?.addEventListener("input", () => {
  if ($("topicCount")) $("topicCount").textContent = `${$("topicInput").value.length}/200`;
});
$("topicLeadGen")?.addEventListener("change", () => {
  const fields = $("topicLeadGenFields");
  if (fields) fields.classList.toggle("active", $("topicLeadGen").checked);
});
document.querySelectorAll("[data-topic-words]").forEach((button) => {
  button.addEventListener("click", () => {
    $("topicTargetWords").value = button.dataset.topicWords;
    $("topicTargetStat").textContent = button.dataset.topicWords;
  });
});
$("regenerateSectionBtn")?.addEventListener("click", regenerateSection);
$("copyBtn")?.addEventListener("click", () => navigator.clipboard.writeText($("outputText").value || ""));
$("copySectionBtn")?.addEventListener("click", () => navigator.clipboard.writeText($("sectionOutputText").value || ""));
$("saveMaterialBtn")?.addEventListener("click", () => saveMaterial().catch((error) => $("materialStatus").textContent = error.message));
  $("saveReviewBtn")?.addEventListener("click", saveReview);
$("savePromptBtn")?.addEventListener("click", async () => {
  try {
    cachePromptEditor();
    const data = await api("/api/prompts", {
      method: "POST",
      body: JSON.stringify({ prompts })
    });
    prompts = data.prompts || prompts;
    $("promptStatus").textContent = text.saveDone;
  } catch (error) {
    $("promptStatus").textContent = error.message;
  }
});

document.querySelectorAll(".score-input").forEach((input) => {
  input.addEventListener("input", () => {
    const label = $(input.dataset.scoreLabel);
    if (label) label.textContent = input.value;
  });
});

init();
