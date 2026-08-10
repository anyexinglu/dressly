const state = { products: [], selected: null, source: "all" };
const elements = Object.fromEntries([
  "productGrid", "garmentPreview", "garmentTitle", "garmentPrice", "channelLabel", "modelPreview", "modelFrame",
  "resultPreview", "resultFrame", "tryOnButton", "statusText", "loadingText", "stylePrompt", "searchButton",
].map((id) => [id, document.getElementById(id)]));

function money(value) {
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function selectProduct(product) {
  state.selected = product;
  elements.garmentPreview.src = product.imageUrl;
  elements.garmentTitle.textContent = product.title;
  elements.garmentPrice.textContent = money(product.price);
  elements.channelLabel.textContent = product.channel;
  elements.resultPreview.removeAttribute("src");
  elements.resultFrame.classList.remove("has-result");
  elements.statusText.textContent = "免费共享算力 · 实验性服务，可能排队或失败";
  renderProducts();
  document.getElementById("studio").scrollIntoView({ behavior: "smooth", block: "start" });
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
    card.innerHTML = `<img src="${product.imageUrl}" alt=""><div class="meta"><small>${product.channel}</small><p></p><strong>¥${money(product.price)}</strong></div>`;
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
    state.products = catalog.products;
    if (catalog.modelImageUrl) {
      elements.modelPreview.src = catalog.modelImageUrl;
      elements.modelPreview.addEventListener("load", () => elements.modelFrame.classList.add("loaded"), { once: true });
    }
    if (state.products[0]) {
      state.selected = state.products[0];
      elements.garmentPreview.src = state.selected.imageUrl;
      elements.garmentTitle.textContent = state.selected.title;
      elements.garmentPrice.textContent = money(state.selected.price);
      elements.channelLabel.textContent = state.selected.channel;
    }
    elements.statusText.textContent = catalog.provider.failures
      ? `免费共享服务不稳定 · 本进程已失败 ${catalog.provider.failures} 次`
      : "免费共享算力 · 实验性服务，可能排队或失败";
    renderProducts();
  } catch (error) {
    elements.productGrid.innerHTML = `<p>${error.message}</p>`;
    elements.statusText.textContent = error.message;
  }
}

function setLoading(loading) {
  elements.tryOnButton.disabled = loading;
  elements.tryOnButton.innerHTML = loading ? "<span>◌</span> 正在试穿" : "<span>✦</span> 一键试穿";
  elements.resultFrame.querySelector(".result-loading").hidden = !loading;
  elements.resultFrame.querySelector(".result-empty").hidden = loading;
}

async function tryOn() {
  if (!state.selected) return;
  setLoading(true);
  const messages = ["正在识别衣服轮廓…", "正在生成服装蒙版…", "正在保留面料与细节…", "正在完成 AI 试穿…"];
  let index = 0;
  elements.loadingText.textContent = messages[index];
  const ticker = setInterval(() => { index = Math.min(index + 1, messages.length - 1); elements.loadingText.textContent = messages[index]; }, 9000);
  try {
    const response = await fetch("/api/tryon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: state.selected.id }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "试衣生成失败");
    elements.resultPreview.src = result.imageUrl;
    elements.resultFrame.classList.add("has-result");
    elements.statusText.textContent = result.live
      ? `实时生成完成 · 尝试 ${result.attempts} 次 · 任务 ${result.eventId.slice(0, 8)}`
      : `实时服务失败 · 展示 ${result.verifiedAt} 已验证缓存结果`;
  } catch (error) {
    elements.statusText.textContent = `未生成成功 · ${error.message}`;
    elements.resultFrame.querySelector(".result-empty").hidden = false;
    elements.resultFrame.querySelector(".result-empty p").textContent = "本次没有生成结果\n免费服务当前不可用";
  } finally {
    clearInterval(ticker);
    setLoading(false);
  }
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

loadCatalog();
