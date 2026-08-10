#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = fileURLToPath(new URL("./", import.meta.url));
const pocDirectory = fileURLToPath(new URL("../poc/", import.meta.url));
const host = "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const idmBaseUrl = "https://yisol-idm-vton.hf.space";
const fallbackModelImageUrl = "https://huggingface.co/spaces/yisol/IDM-VTON/resolve/main/example/human/00034_00.jpg";

const samples = await Promise.all([
  readFile(join(pocDirectory, "pdd-womens-clothing-sample.json"), "utf8").then(JSON.parse),
  readFile(join(pocDirectory, "taobao-womens-clothing-sample.json"), "utf8").then(JSON.parse),
]);

const products = samples.flatMap((sample, sampleIndex) => sample.products
  .filter(({ imageUrl }) => imageUrl)
  .map((product, productIndex) => ({
    id: `${sampleIndex === 0 ? "pdd" : "taobao"}-${productIndex}`,
    channel: sampleIndex === 0 ? "拼多多" : "淘宝天猫",
    sourceUrl: sample.sourceUrl,
    title: product.title,
    price: product.price,
    priceType: product.priceType || "页面参考价",
    imageUrl: product.imageUrl,
  })));

let demoModel;
let activeTryOn;

async function getJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function getDemoModel() {
  if (demoModel) return demoModel;
  const config = await getJson(`${idmBaseUrl}/config`, { signal: AbortSignal.timeout(20_000) });
  const dataset = config.components.find(({ type, props }) => type === "dataset" && props.headers?.[0]?.includes("Human"));
  demoModel = dataset?.props.samples?.[0]?.[0];
  if (!demoModel) throw new Error("公开示例模特暂不可用");
  return demoModel;
}

async function runTryOn(product) {
  const human = await getDemoModel();
  const productResponse = await fetch(product.imageUrl, { signal: AbortSignal.timeout(20_000) });
  if (!productResponse.ok) throw new Error(`商品图读取失败：HTTP ${productResponse.status}`);

  const productImage = await productResponse.blob();
  const formData = new FormData();
  formData.append("files", productImage, "dressly-garment.jpg");
  const uploaded = await getJson(`${idmBaseUrl}/upload`, { method: "POST", body: formData });
  const garmentPath = uploaded[0];
  if (!garmentPath) throw new Error("商品图上传未返回文件路径");

  const garment = {
    path: garmentPath,
    url: `${idmBaseUrl}/file=${garmentPath}`,
    orig_name: "dressly-garment.jpg",
    mime_type: productImage.type || "image/jpeg",
    meta: { _type: "gradio.FileData" },
  };
  const submission = await getJson(`${idmBaseUrl}/call/tryon`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [human, garment, product.title, true, false, 20, 42] }),
  });
  if (!submission.event_id) throw new Error("试衣服务未返回任务编号");

  const eventResponse = await fetch(`${idmBaseUrl}/call/tryon/${submission.event_id}`, {
    signal: AbortSignal.timeout(180_000),
  });
  const eventText = await eventResponse.text();
  const completedLine = eventText.split("\n").find((line) => line.startsWith("data: ["));
  if (!completedLine) throw new Error(`共享试衣服务暂不可用：${eventText.includes("event: error") ? "服务端生成失败" : "任务未完成"}`);
  const outputs = JSON.parse(completedLine.slice("data: ".length));
  const output = outputs.find(({ url }) => url);
  if (!output?.url) throw new Error("试衣服务没有返回结果图");

  return { eventId: submission.event_id, imageUrl: output.url, mimeType: output.mime_type, product };
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    if (request.method === "GET" && url.pathname === "/api/catalog") {
      let modelImageUrl = fallbackModelImageUrl;
      try { modelImageUrl = (await getDemoModel()).url || fallbackModelImageUrl; } catch {}
      return sendJson(response, 200, { products, modelImageUrl });
    }
    if (request.method === "POST" && url.pathname === "/api/tryon") {
      const { productId } = await readBody(request);
      const product = products.find(({ id }) => id === productId);
      if (!product) return sendJson(response, 400, { error: "请选择有效商品" });
      if (activeTryOn) return sendJson(response, 409, { error: "已有试衣任务正在生成，请稍候" });
      activeTryOn = runTryOn(product);
      try {
        return sendJson(response, 200, await activeTryOn);
      } finally {
        activeTryOn = null;
      }
    }

    const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!new Set(["index.html", "styles.css", "app.js"]).has(requestedPath)) {
      response.writeHead(404).end("Not found");
      return;
    }
    const file = await readFile(join(appDirectory, requestedPath));
    response.writeHead(200, { "Content-Type": mimeTypes[extname(requestedPath)] || "application/octet-stream" });
    response.end(file);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Dressly 已启动：http://${host}:${port}`);
});
