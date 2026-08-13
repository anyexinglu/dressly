const state = { products: [], selected: null, source: "all", persona: "demo", avatarView: 0, avatarReady: false, modelReady: false, photos: {}, demoModelImageUrl: null };
const elements = Object.fromEntries([
  "productGrid", "garmentPreview", "garmentTitle", "garmentPrice", "channelLabel", "modelPreview", "modelFrame",
  "resultPreview", "resultFrame", "tryOnButton", "statusText", "loadingText", "stylePrompt", "searchButton",
  "shopButton",
].map((id) => [id, document.getElementById(id)]));

function money(value) {
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qualityStatus(product) {
  if (product.quality === "recommended") return "此商品为完整白底服装图 · 推荐高质量试穿";
  if (product.quality === "workable") return `此商品可尝试 · ${product.qualityReason}`;
  return `主图不适合精确试穿 · ${product.qualityReason}`;
}

function selectProduct(product) {
  state.selected = product;
  elements.garmentPreview.src = product.imageUrl;
  elements.garmentTitle.textContent = product.title;
  elements.garmentPrice.textContent = money(product.price);
  elements.channelLabel.textContent = product.channel;
  elements.resultPreview.removeAttribute("src");
  elements.resultFrame.classList.remove("has-result");
  elements.shopButton.hidden = true;
  elements.shopButton.removeAttribute("href");
  elements.statusText.textContent = qualityStatus(product);
  renderProducts();
  document.getElementById("studio").scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectPersona(persona) {
  if (persona === "twin" && !state.avatarReady) {
    elements.statusText.textContent = "请先上传一张正面照，并点击「生成本地分身」";
    document.getElementById("avatar").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  state.persona = persona;
  document.querySelectorAll(".persona").forEach((button) => button.classList.toggle("selected", button.dataset.persona === persona));
  const mine = persona === "twin";
  elements.modelPreview.src = mine ? state.photos.front : state.demoModelImageUrl;
  elements.modelPreview.alt = mine ? "我的本地照片分身" : "公开示例模特";
  document.getElementById("modelTitle").textContent = mine ? "我的本地照片分身（正面照）" : "公开全身示例人像（非商业 POC）";
  elements.modelFrame.classList.add("loaded");
  elements.tryOnButton.disabled = !state.modelReady;
  elements.tryOnButton.innerHTML = "<span>✦</span> 一键试穿";
  elements.statusText.textContent = mine
    ? "使用正面照在本机生成；照片不会离开这台电脑"
    : "公开全身示例 · 长裙试穿已优化 · 本机 CatVTON / Apple MPS";
}

function renderProducts() {
  const prompt = elements.stylePrompt.value.trim().toLowerCase();
  const words = prompt.split(/[\s，,。]+/).filter((word) => word.length > 1);
  let products = state.products.filter((product) => state.source === "all" || product.channel === state.source);
  const matched = products.filter((product) => words.some((word) => product.title.toLowerCase().includes(word)));
  if (matched.length) products = [...matched, ...products.filter((product) => !matched.includes(product))];
  elements.productGrid.innerHTML = "";
  for (const product of products) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `product-card${state.selected?.id === product.id ? " selected" : ""}`;
    card.innerHTML = `<img src="${product.imageUrl}" alt=""><div class="meta"><small>${product.channel}</small><em class="quality ${product.quality}">${product.qualityLabel}</em><p></p><strong>¥${money(product.price)}</strong></div>`;
    card.querySelector("p").textContent = product.title;
    card.querySelector("img").alt = product.title;
    card.addEventListener("click", () => selectProduct(product));
    elements.productGrid.append(card);
  }
}

async function loadCatalog() {
  try {
    const response = await fetch("/api/catalog");
    if (!response.ok) throw new Error("商品目录加载失败");
    const catalog = await response.json();
    state.modelReady = catalog.provider.ready;
    state.products = catalog.products;
    if (catalog.modelImageUrl) {
      state.demoModelImageUrl = catalog.modelImageUrl;
      elements.modelPreview.src = state.demoModelImageUrl;
      elements.modelPreview.addEventListener("load", () => elements.modelFrame.classList.add("loaded"), { once: true });
    }
    if (state.products[0]) {
      state.selected = state.products.find(({ quality }) => quality === "recommended") || state.products[0];
      elements.garmentPreview.src = state.selected.imageUrl;
      elements.garmentTitle.textContent = state.selected.title;
      elements.garmentPrice.textContent = money(state.selected.price);
      elements.channelLabel.textContent = state.selected.channel;
    }
    elements.tryOnButton.disabled = !state.modelReady;
    elements.statusText.textContent = !state.modelReady
      ? `本机模型首次准备中 · ${catalog.provider.readyFiles}/${catalog.provider.totalFiles} 个权重已就绪`
      : catalog.provider.failures
      ? `本机模型上次失败 · 本进程已失败 ${catalog.provider.failures} 次`
      : qualityStatus(state.selected);
    renderProducts();
    if (!state.modelReady) setTimeout(checkModelReadiness, 5_000);
  } catch (error) {
    elements.productGrid.innerHTML = `<p>${error.message}</p>`;
    elements.statusText.textContent = error.message;
  }
}

async function checkModelReadiness() {
  try {
    const response = await fetch("/api/catalog");
    const catalog = await response.json();
    state.modelReady = Boolean(catalog.provider?.ready);
    elements.tryOnButton.disabled = !state.modelReady;
    elements.statusText.textContent = state.modelReady
      ? "本机 CatVTON 已就绪 · Apple MPS 实时生成"
      : `本机模型首次准备中 · ${catalog.provider.readyFiles}/${catalog.provider.totalFiles} 个权重已就绪`;
    if (!state.modelReady) setTimeout(checkModelReadiness, 5_000);
  } catch {
    setTimeout(checkModelReadiness, 5_000);
  }
}

function setLoading(loading) {
  elements.tryOnButton.disabled = loading || !state.modelReady;
  elements.tryOnButton.innerHTML = loading ? "<span>◌</span> 正在试穿" : "<span>✦</span> 一键试穿";
  elements.resultFrame.querySelector(".result-loading").hidden = !loading;
  elements.resultFrame.querySelector(".result-empty").hidden = loading;
}

async function blobUrlToDataUrl(url) {
  const blob = await fetch(url).then((response) => response.blob());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener("error", () => reject(new Error("正面照片读取失败")), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function tryOn() {
  if (!state.selected) return;
  setLoading(true);
  const messages = ["正在载入本地模型…", "正在识别衣服轮廓…", "正在保留人物与面料细节…", "正在使用 Apple GPU 完成试穿…", "正在增强仿钻与稀疏纹理…"];
  let index = 0;
  elements.loadingText.textContent = messages[index];
  const ticker = setInterval(() => { index = Math.min(index + 1, messages.length - 1); elements.loadingText.textContent = messages[index]; }, 9000);
  try {
    const personImage = state.persona === "twin" ? await blobUrlToDataUrl(state.photos.front) : null;
    const response = await fetch("/api/tryon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: state.selected.id, personImage }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "试衣生成失败");
    elements.resultPreview.src = result.imageUrl;
    elements.resultFrame.classList.add("has-result");
    elements.shopButton.href = state.selected.sourceUrl;
    elements.shopButton.hidden = false;
    const detailStatus = result.detailReinforcement?.applied
      ? ` · 已增强 ${result.detailReinforcement.count} 个装饰细节`
      : "";
    elements.statusText.textContent = `本机实时生成完成 · CatVTON / Apple MPS${detailStatus} · 任务 ${result.eventId.slice(0, 8)}`;
  } catch (error) {
    elements.shopButton.hidden = true;
    elements.shopButton.removeAttribute("href");
    elements.statusText.textContent = `未生成成功 · ${error.message}`;
    elements.resultFrame.querySelector(".result-empty").hidden = false;
    elements.resultFrame.querySelector(".result-empty p").textContent = "本次没有生成结果\n请查看本机模型状态";
  } finally {
    clearInterval(ticker);
    setLoading(false);
  }
}

function wireCapturePreviews() {
  const inputs = ["photoFront", "photoSide", "photoBack"].map((id) => document.getElementById(id));
  const status = document.getElementById("captureStatus");
  const generateButton = document.getElementById("generateAvatarButton");
  inputs.forEach((input) => input.addEventListener("change", () => {
    const image = input.parentElement.querySelector("img");
    const file = input.files?.[0];
    if (!file) return;
    const view = input.id.replace("photo", "").toLowerCase();
    if (state.photos[view]?.startsWith("blob:")) URL.revokeObjectURL(state.photos[view]);
    state.photos[view] = URL.createObjectURL(file);
    image.src = state.photos[view];
    input.parentElement.classList.add("has-photo");
    const complete = inputs.filter(({ files }) => files?.length).length;
    const hasFront = Boolean(state.photos.front);
    generateButton.disabled = !hasFront;
    generateButton.innerHTML = hasFront ? "生成本地照片分身 <span>→</span>" : "上传正面照后生成本地分身 <span>→</span>";
    status.textContent = hasFront
      ? `已本地预览 ${complete} 张照片 · 正面照已就绪，可生成本地分身（不会上传）`
      : `已本地预览 ${complete} 张照片 · 请补充一张正面照以生成分身`;
  }));
  generateButton.addEventListener("click", async () => {
    if (!state.photos.front) return;
    generateButton.disabled = true;
    generateButton.textContent = "正在生成照片分身…";
    status.textContent = "正在本机生成照片分身…";
    await new Promise((resolve) => setTimeout(resolve, 550));
    state.avatarReady = true;
    state.avatarView = 0;
    updateAvatarView();
    document.getElementById("avatarState").textContent = "已生成（本地）";
    document.getElementById("avatarRoute").textContent = availableAvatarViews().map(({ shortLabel }) => shortLabel).join(" / ");
    generateButton.innerHTML = "本地分身已生成 <span>✓</span>";
    status.textContent = "本地照片分身已生成 · 照片没有离开本机；现在可点击「我的分身」进入试衣台";
  });
}

async function loadExplicitLocalAvatar() {
  if (!new URLSearchParams(window.location.search).has("local-avatar")) return;
  try {
    const response = await fetch("/api/local-avatar");
    if (!response.ok) throw new Error("本机照片通道未开启");
    const { photos } = await response.json();
    for (const view of ["front", "side", "back"]) {
      if (!photos[view]) continue;
      state.photos[view] = photos[view];
      const input = document.getElementById(`photo${view[0].toUpperCase()}${view.slice(1)}`);
      const slot = input.parentElement;
      const image = slot.querySelector("img");
      image.src = photos[view];
      slot.classList.add("has-photo");
    }
    const status = document.getElementById("captureStatus");
    const button = document.getElementById("generateAvatarButton");
    button.disabled = false;
    button.innerHTML = "生成本地照片分身 <span>→</span>";
    status.textContent = `已从本机文件夹临时载入 ${Object.keys(photos).length} 张照片 · 不会上传`;
    button.click();
  } catch (error) {
    document.getElementById("captureStatus").textContent = `未载入本机照片 · ${error.message}`;
  }
}

function availableAvatarViews() {
  return [
    { view: "front", label: "FRONT / 正面", shortLabel: "正面" },
    { view: "side", label: "SIDE / 侧面", shortLabel: "侧面" },
    { view: "back", label: "BACK / 背面", shortLabel: "背面" },
  ].filter(({ view }) => Boolean(state.photos[view]));
}

function updateAvatarView() {
  const views = availableAvatarViews();
  if (!views.length) return;
  state.avatarView %= views.length;
  const { view, label } = views[state.avatarView];
  const viewport = document.getElementById("twinViewport");
  viewport.dataset.view = view;
  document.getElementById("viewLabel").textContent = label;
  const photo = document.getElementById("avatarPhoto");
  if (state.avatarReady && state.photos[view]) {
    photo.src = state.photos[view];
    photo.classList.add("ready");
    viewport.classList.add("has-avatar");
  }
}

function wireAvatarControls() {
  document.getElementById("rotateAvatar").addEventListener("click", () => {
    if (!state.avatarReady) {
      document.getElementById("captureStatus").textContent = "先上传一张正面照并点击「生成本地分身」，再查看";
      return;
    }
    const views = availableAvatarViews();
    if (views.length === 1) {
      document.getElementById("captureStatus").textContent = "当前只有正面照；补充侧面或背面照后可切换视角";
      return;
    }
    state.avatarView = (state.avatarView + 1) % views.length;
    updateAvatarView();
  });
}

function wireExperienceChoices() {
  document.querySelectorAll("[data-theme]").forEach((button) => button.addEventListener("click", () => {
    document.body.dataset.theme = button.dataset.theme;
    document.querySelectorAll("[data-theme]").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("selected", active);
      tab.setAttribute("aria-selected", String(active));
    });
  }));
  document.querySelectorAll("[data-look]").forEach((button) => button.addEventListener("click", () => {
    elements.stylePrompt.value = button.dataset.look;
    document.querySelectorAll("[data-look]").forEach((look) => look.classList.toggle("selected", look === button));
    renderProducts();
    document.getElementById("products").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  document.querySelectorAll(".persona").forEach((button) => button.addEventListener("click", () => selectPersona(button.dataset.persona)));
}

elements.tryOnButton.addEventListener("click", tryOn);
elements.searchButton.addEventListener("click", () => { renderProducts(); document.getElementById("products").scrollIntoView({ behavior: "smooth" }); });
elements.stylePrompt.addEventListener("keydown", (event) => { if (event.key === "Enter") elements.searchButton.click(); });
document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => { elements.stylePrompt.value = button.dataset.prompt; renderProducts(); }));
document.querySelectorAll("[data-source]").forEach((button) => button.addEventListener("click", () => {
  state.source = button.dataset.source;
  document.querySelectorAll("[data-source]").forEach((tab) => tab.classList.toggle("selected", tab === button));
  renderProducts();
}));

wireCapturePreviews();
wireAvatarControls();
wireExperienceChoices();
loadExplicitLocalAvatar();
loadCatalog();
