const SOUL_STORAGE_KEY = "copywriter_soul_state_v2";
const MAX_SOUL_MATERIALS = 9;

const soulDefaultAvatar =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
    <rect width="120" height="120" rx="32" fill="#eff6ff"/>
    <circle cx="60" cy="46" r="22" fill="#1463ff"/>
    <path d="M24 104c7-24 24-36 36-36s29 12 36 36" fill="#93c5fd"/>
  </svg>`);

const emptyProfile = {
  created: false,
  avatar: "",
  savedAvatar: "",
  pendingAvatar: "",
  name: "尚未创建灵魂",
  status: "未创建",
  tags: [],
  description:
    "你还没有录入写作灵魂。上传3-9篇你自己写过的文案，AI会自动提取你的表达方式、句式习惯、情绪强度和文案风格。",
  stats: {
    averageSentence: "--",
    emotion: "--",
    spoken: "--",
    aiTaste: "--",
    viral: "--"
  },
  score: null
};

const soulMock = {
  name: "我的创作灵魂",
  status: "待确认",
  tags: ["结果前置", "高压迫感", "真人口播", "短句", "低AI味"],
  description:
    "你的文案习惯用直接的方式抓住用户注意力，开头通常先给结果或制造压力，语气偏口语化，废话少，转折强，适合短视频口播和商业转化类内容。",
  stats: {
    averageSentence: "12.6字",
    emotion: "高",
    spoken: "92%",
    aiTaste: "18%",
    viral: "85%"
  },
  score: 85
};

const personas = [
  { name: "我的灵魂", avatar: soulDefaultAvatar, tags: ["专属表达", "训练后启用"], builtIn: false },
  { name: "马斯克风格", avatar: "/personas/musk.jpg", tags: ["第一性原理", "未来主义", "目标导向"], builtIn: true },
  { name: "鲁迅风格", avatar: "/personas/luxun.png", tags: ["讽刺", "批判", "刀子感"], builtIn: true },
  { name: "余华风格", avatar: "/personas/yu-hua.png", tags: ["平静", "真实", "故事感"], builtIn: true },
  { name: "罗永浩风格", avatar: "/personas/luo-yonghao.png", tags: ["强观点", "反击", "口语"], builtIn: true }
];

const personaProfiles = {
  "马斯克风格": {
    name: "马斯克风格",
    status: "已激活",
    tags: ["第一性原理", "未来主义", "目标导向"],
    description: "极度目标导向，极度理性，习惯把问题拆到本质层。表达不铺垫，不煽情，先否定旧逻辑，再重新定义问题，最后给出更高效率的新逻辑。",
    stats: { averageSentence: "10.8字", emotion: "中高", spoken: "74%", aiTaste: "22%", viral: "78%" },
    score: null
  },
  "鲁迅风格": {
    name: "鲁迅风格",
    status: "已激活",
    tags: ["讽刺", "批判", "刀子感"],
    description: "冷、锋利、克制，不热血，不煽情。表达不直接愤怒，而是用平静语气揭露荒诞，用反差和冷幽默刺痛人。",
    stats: { averageSentence: "13.4字", emotion: "高", spoken: "66%", aiTaste: "20%", viral: "82%" },
    score: null
  },
  "余华风格": {
    name: "余华风格",
    status: "已激活",
    tags: ["平静", "真实", "故事感"],
    description: "真实、克制、不喊口号，不假装热血。用最平静的话说最难受的事，靠日常细节和普通人的沉默感，让情绪慢慢压上来。",
    stats: { averageSentence: "15.2字", emotion: "中", spoken: "70%", aiTaste: "18%", viral: "74%" },
    score: null
  },
  "罗永浩风格": {
    name: "罗永浩风格",
    status: "已激活",
    tags: ["强观点", "反击", "口语"],
    description: "不服、不怕冲突、讨厌正确废话。表达方式是先开炮，再解释，再继续开炮，用口语压人，用反问和吐槽正面撞碎错误认知。",
    stats: { averageSentence: "11.6字", emotion: "高", spoken: "88%", aiTaste: "16%", viral: "84%" },
    score: null
  }
};

const initialState = {
  profile: { ...emptyProfile },
  materials: [],
  selectedPersona: "我的灵魂",
  editingMaterialId: null,
  extracting: false,
  resetDialogOpen: false
};

let soulState = loadSoulState();
let personaSearchKeyword = "";

const soul$ = (id) => document.getElementById(id);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadSoulState() {
  try {
    const saved = JSON.parse(localStorage.getItem(SOUL_STORAGE_KEY) || "null");
    if (!saved) return clone(initialState);
    return {
      ...clone(initialState),
      ...saved,
      profile: { ...clone(emptyProfile), ...(saved.profile || {}) },
      materials: Array.isArray(saved.materials) ? saved.materials.slice(0, MAX_SOUL_MATERIALS) : []
    };
  } catch {
    return clone(initialState);
  }
}

function persistSoulState() {
  const { extracting, editingMaterialId, resetDialogOpen, ...safeState } = soulState;
  localStorage.setItem(SOUL_STORAGE_KEY, JSON.stringify(safeState));
}

function soulStatusClass(status) {
  if (status === "已激活") return "generated";
  if (status === "待确认") return "pending";
  return "not-generated";
}

function soulWordCount(value) {
  return String(value || "").replace(/\s/g, "").length;
}

function soulNow() {
  return new Date().toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function currentAvatar() {
  if (soulState.selectedPersona !== "我的灵魂") {
    return personas.find((item) => item.name === soulState.selectedPersona)?.avatar || soulDefaultAvatar;
  }
  return soulState.profile.pendingAvatar || soulState.profile.savedAvatar || soulState.profile.avatar || soulDefaultAvatar;
}

function currentProfileView() {
  if (soulState.selectedPersona !== "我的灵魂") {
    return {
      ...personaProfiles[soulState.selectedPersona],
      created: true,
      avatar: currentAvatar()
    };
  }
  return soulState.profile;
}

function renderSoulStatusCards() {
  const count = soulState.materials.length;
  const profile = currentProfileView();
  soul$("soulStateText").textContent = soulState.selectedPersona === "我的灵魂" ? soulState.profile.status : "内置人格";
  soul$("soulMaterialCount").textContent = `${count}/${MAX_SOUL_MATERIALS}`;
  soul$("soulMaterialHint").textContent = count >= 3 ? "已满足提取条件" : "至少3篇后可提取";
  soul$("soulScoreText").textContent = profile.score === null ? "待提取" : `${profile.score}分`;
  const uploaded = soul$("soulUploadedCount");
  if (uploaded) uploaded.textContent = `已上传 ${count}/${MAX_SOUL_MATERIALS} 篇`;
}

function renderSoulProfileCard() {
  const profile = currentProfileView();
  const isOwnSoul = soulState.selectedPersona === "我的灵魂";
  soul$("soulAvatar").src = currentAvatar();
  soul$("soulNameInput").value = profile.name;
  soul$("soulNameInput").readOnly = !isOwnSoul;
  soul$("soulDescriptionInput").value = profile.description;
  soul$("soulDescriptionInput").readOnly = !isOwnSoul;

  const badge = soul$("soulProfileStatus");
  badge.textContent = profile.status;
  badge.className = `status-badge ${soulStatusClass(profile.status)}`;

  soul$("soulTagList").innerHTML = profile.tags.length
    ? profile.tags.map((tag) => `<span>${tag}</span>`).join("")
    : `<em>暂无风格标签</em>`;

  const stats = [
    ["平均句长", profile.stats.averageSentence],
    ["情绪强度", profile.stats.emotion],
    ["口语化程度", profile.stats.spoken],
    ["AI味指数", profile.stats.aiTaste],
    ["爆款潜力", profile.stats.viral]
  ];
  soul$("soulStatsGrid").innerHTML = stats
    .map(([label, value]) => `<div class="soul-stat"><span>${label}</span><b>${value}</b></div>`)
    .join("");

  soul$("avatarChangeHint").textContent = soulState.profile.pendingAvatar ? "头像已更换，保存后生效" : "";
  soul$("editSoulBtn").disabled = !isOwnSoul;
  soul$("saveSoulBtn").disabled = !isOwnSoul;
  soul$("extractSoulAgainBtn").disabled = !isOwnSoul || !soulState.profile.created || soulState.materials.length < 3;
  soul$("soulEmptyActions").style.display = isOwnSoul && !soulState.profile.created ? "flex" : "none";
}

function materialCardHtml(item, index) {
  if (!item) {
    return `<article class="soul-material-slot empty" data-empty-slot="${index}">
      <button type="button" class="soul-slot-add" data-empty-slot="${index}">
        <span>+</span>
      </button>
    </article>`;
  }

  return `<article class="soul-material-card" data-soul-material-id="${item.id}">
    <div class="soul-material-index">${index + 1}</div>
    <span class="soul-material-state">${item.status}</span>
    <p>${item.content.slice(0, 92)}${item.content.length > 92 ? "..." : ""}</p>
    <div class="soul-material-meta"><span>字数 ${soulWordCount(item.content)}</span><span>上传时间 ${item.createdAt}</span></div>
    <div class="soul-material-actions"><button data-soul-material-action="edit">编辑</button><button data-soul-material-action="delete">删除</button></div>
  </article>`;
}

function renderSoulMaterials() {
  const list = soul$("soulMaterialList");
  const empty = soul$("soulMaterialEmpty");
  const count = soulState.materials.length;
  empty.style.display = "none";

  const slots = Array.from({ length: MAX_SOUL_MATERIALS }, (_, index) => materialCardHtml(soulState.materials[index], index));
  list.innerHTML = slots.join("");

  const canExtract = count >= 3 && !soulState.extracting;
  soul$("extractSoulBtn").disabled = !canExtract;
  soul$("soulExtractTip").textContent =
    count < 3 ? "至少上传3篇文案后才能提取灵魂" : count >= MAX_SOUL_MATERIALS ? "已达到9篇上限，可以开始提取" : "已满足提取条件，可继续补充到9篇";
}

function renderPersonas() {
  const ownAvatar = soulState.profile.savedAvatar || soulState.profile.avatar || soulDefaultAvatar;
  const list = soul$("personaList");
  const keyword = personaSearchKeyword.trim();
  const visiblePersonas = personas.filter((persona) => !keyword || persona.name.includes(keyword));
  list.innerHTML = visiblePersonas
    .map((persona) => {
      const active = soulState.selectedPersona === persona.name;
      const avatar = persona.name === "我的灵魂" ? ownAvatar : persona.avatar;
      const name = persona.name === "我的灵魂" && soulState.profile.created ? soulState.profile.name : persona.name;
      return `<article class="persona-item ${active ? "active" : ""}" data-persona="${persona.name}">
        <div class="persona-avatar"><img src="${avatar}" alt="${name}" /></div>
        <div class="persona-body"><h3>${name}</h3><div>${persona.tags.slice(0, 3).map((tag) => `<span>${tag}</span>`).join("")}</div></div>
        <button type="button">${active ? "使用中" : "使用"}</button>
      </article>`;
    })
    .join("") || `<div class="persona-empty">没有找到对应灵魂</div>`;
  soul$("personaSelect").value = soulState.selectedPersona;
  const selected = personas.find((item) => item.name === soulState.selectedPersona);
  soul$("personaNotice").textContent =
    selected?.builtIn
      ? "你正在使用系统内置人格，创建自己的灵魂后可获得更贴近你的写法"
      : "即使没有创建自己的灵魂，也可以使用系统内置人格。";
}

function renderResetDialog() {
  let dialog = soul$("soulResetDialog");
  if (!dialog) {
    dialog = document.createElement("div");
    dialog.id = "soulResetDialog";
    dialog.className = "soul-reset-dialog";
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = `<div class="soul-reset-card">
    <h3>确认重置灵魂</h3>
    <p>您确认要重置灵魂吗，重置后所有的灵魂训练素材都会清空，包括灵魂名称、头像等。</p>
    <div><button type="button" id="cancelSoulResetBtn" class="white-btn">取消</button><button type="button" id="confirmSoulResetBtn" class="blue-btn compact-btn">确认</button></div>
  </div>`;
  dialog.classList.toggle("open", soulState.resetDialogOpen);
  soul$("cancelSoulResetBtn")?.addEventListener("click", () => {
    soulState.resetDialogOpen = false;
    renderResetDialog();
  });
  soul$("confirmSoulResetBtn")?.addEventListener("click", () => {
    soulState = clone(initialState);
    persistSoulState();
    renderSoulSystem();
  });
}

function renderSoulSystem() {
  if (!soul$("soulStateText")) return;
  renderSoulStatusCards();
  renderSoulProfileCard();
  renderSoulMaterials();
  renderPersonas();
  renderResetDialog();
}

function openSoulMaterialForm(content = "", id = null) {
  soulState.editingMaterialId = id;
  soul$("soulMaterialInput").value = content;
  soul$("soulMaterialForm").classList.add("open");
  soul$("soulMaterialInput").focus();
}

function closeSoulMaterialForm() {
  soulState.editingMaterialId = null;
  soul$("soulMaterialInput").value = "";
  soul$("soulMaterialForm").classList.remove("open");
}

function saveSoulMaterials() {
  const raw = soul$("soulMaterialInput").value.trim();
  if (!raw) return;

  if (soulState.editingMaterialId) {
    soulState.materials = soulState.materials.map((item) =>
      item.id === soulState.editingMaterialId ? { ...item, content: raw, status: "待分析" } : item
    );
    closeSoulMaterialForm();
    persistSoulState();
    renderSoulSystem();
    return;
  }

  const parts = raw.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const available = MAX_SOUL_MATERIALS - soulState.materials.length;
  const nextParts = parts.slice(0, available);
  soulState.materials.push(
    ...nextParts.map((content) => ({
      id: crypto.randomUUID(),
      content,
      createdAt: soulNow(),
      status: "待分析"
    }))
  );
  closeSoulMaterialForm();
  persistSoulState();
  renderSoulSystem();
}

function applyMockSoul() {
  soulState.profile = {
    ...soulState.profile,
    created: true,
    name: soul$("soulNameInput").value.trim() || soulMock.name,
    status: soulMock.status,
    tags: soulMock.tags,
    description: soulMock.description,
    stats: soulMock.stats,
    score: soulMock.score
  };
  soulState.materials = soulState.materials.map((item) => ({ ...item, status: "已分析" }));
  soulState.selectedPersona = "我的灵魂";
  persistSoulState();
}

function mapSoulResultToProfile(result) {
  const rules = result?.writing_rules || {};
  return {
    ...soulState.profile,
    created: true,
    name: soul$("soulNameInput").value.trim() || "我的创作灵魂",
    status: "待确认",
    tags: Array.isArray(result?.soul_tags) && result.soul_tags.length ? result.soul_tags.slice(0, 8) : soulMock.tags,
    description: result?.soul_summary || soulMock.description,
    stats: {
      averageSentence: rules.avg_sentence_length || soulMock.stats.averageSentence,
      emotion: rules.emotion_strength || rules.pressure_level || soulMock.stats.emotion,
      spoken: rules.oral_level || soulMock.stats.spoken,
      aiTaste: rules.ai_smell_score || soulMock.stats.aiTaste,
      viral: result?.personality_strength || result?.style_consistency_score || soulMock.stats.viral
    },
    score: Number.parseInt(String(result?.style_consistency_score || "").match(/\d+/)?.[0] || "0", 10) || soulMock.score,
    rules: result
  };
}

async function extractSoul() {
  if (soulState.materials.length < 3 || soulState.extracting) return;
  soulState.extracting = true;
  soul$("extractSoulBtn").disabled = true;
  soul$("extractSoulBtn").textContent = "提取中...";
  try {
    const contents = soulState.materials
      .map((item, index) => `第${index + 1}篇：\n${item.content}`)
      .join("\n\n---\n\n");
    const response = await fetch("/api/extract-soul", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents })
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "灵魂提取失败");
    soulState.profile = mapSoulResultToProfile(data.soul);
    soulState.materials = soulState.materials.map((item) => ({ ...item, status: "已分析" }));
    soulState.selectedPersona = "我的灵魂";
    persistSoulState();
  } catch (error) {
    soul$("soulExtractTip").textContent = error.message || "灵魂提取失败";
  } finally {
    soulState.extracting = false;
    soul$("extractSoulBtn").textContent = "AI 提取灵魂";
    renderSoulSystem();
  }
}

function saveSoulProfile() {
  if (soulState.selectedPersona !== "我的灵魂") return;
  const name = soul$("soulNameInput").value.trim();
  if (!name || name === "尚未创建灵魂") {
    soul$("avatarChangeHint").textContent = "请输入您的呢称或简称作为灵魂名字";
    soul$("soulNameInput").focus();
    return;
  }
  soulState.profile.name = name;
  soulState.profile.description = soul$("soulDescriptionInput").value.trim() || soulState.profile.description;
  if (soulState.profile.pendingAvatar) {
    soulState.profile.savedAvatar = soulState.profile.pendingAvatar;
    soulState.profile.pendingAvatar = "";
  }
  if (soulState.profile.created) soulState.profile.status = "已激活";
  persistSoulState();
  renderSoulSystem();
}

function selectPersona(name) {
  soulState.selectedPersona = name;
  persistSoulState();
  renderSoulSystem();
  soul$("personaPanel").classList.add("highlight");
  setTimeout(() => soul$("personaPanel").classList.remove("highlight"), 900);
}

function wireSoulSystem() {
  if (!soul$("soulAvatarPicker")) return;
  soul$("soulAvatarPicker").addEventListener("click", () => {
    if (soulState.selectedPersona === "我的灵魂") soul$("soulAvatarInput").click();
  });
  soul$("soulAvatarInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      soulState.profile.pendingAvatar = String(reader.result || "");
      persistSoulState();
      renderSoulProfileCard();
      renderPersonas();
    };
    reader.readAsDataURL(file);
  });

  soul$("showSoulMaterialFormBtn").addEventListener("click", () => {
    if (soulState.materials.length >= MAX_SOUL_MATERIALS) return;
    openSoulMaterialForm();
  });
  soul$("addFirstSoulMaterialBtn").addEventListener("click", () => openSoulMaterialForm());
  soul$("cancelSoulMaterialBtn").addEventListener("click", closeSoulMaterialForm);
  soul$("addSoulMaterialBtn").addEventListener("click", saveSoulMaterials);
  soul$("extractSoulBtn").addEventListener("click", extractSoul);
  soul$("extractSoulAgainBtn").addEventListener("click", extractSoul);
  soul$("saveSoulBtn").addEventListener("click", saveSoulProfile);
  soul$("editSoulBtn").addEventListener("click", () => soul$("soulNameInput").focus());
  soul$("resetSoulBtn")?.addEventListener("click", () => {
    soulState.resetDialogOpen = true;
    renderResetDialog();
  });
  soul$("scrollToSoulMaterials").addEventListener("click", () => soul$("soulMaterialsSection").scrollIntoView({ behavior: "smooth", block: "start" }));
  soul$("focusPersonaPanel").addEventListener("click", () => {
    soul$("personaPanel").scrollIntoView({ behavior: "smooth", block: "center" });
    soul$("personaPanel").classList.add("highlight");
    setTimeout(() => soul$("personaPanel").classList.remove("highlight"), 1100);
  });
  soul$("personaSelect").addEventListener("change", (event) => selectPersona(event.target.value));
  soul$("personaSearchInput")?.addEventListener("input", (event) => {
    personaSearchKeyword = event.target.value;
    renderPersonas();
  });
  soul$("personaList").addEventListener("click", (event) => {
    const item = event.target.closest("[data-persona]");
    if (item) selectPersona(item.dataset.persona);
  });
  soul$("soulMaterialList").addEventListener("click", (event) => {
    const emptySlot = event.target.closest("[data-empty-slot]");
    if (emptySlot) {
      if (soulState.materials.length < MAX_SOUL_MATERIALS) openSoulMaterialForm();
      return;
    }
    const card = event.target.closest("[data-soul-material-id]");
    const button = event.target.closest("[data-soul-material-action]");
    if (!card || !button) return;
    const id = card.dataset.soulMaterialId;
    if (button.dataset.soulMaterialAction === "delete") {
      soulState.materials = soulState.materials.filter((item) => item.id !== id);
      persistSoulState();
      renderSoulSystem();
    } else {
      const item = soulState.materials.find((entry) => entry.id === id);
      if (item) openSoulMaterialForm(item.content, item.id);
    }
  });
}

wireSoulSystem();
renderSoulSystem();
