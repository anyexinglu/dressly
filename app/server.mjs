#!/usr/bin/env node

import { createServer } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = fileURLToPath(new URL("./", import.meta.url));
const pocDirectory = fileURLToPath(new URL("../poc/", import.meta.url));
const host = "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const requiredLocalModels = [
  ["../.cache/huggingface/models--stable-diffusion-v1-5--stable-diffusion-inpainting/blobs/24b788b4a777748377cc20364eea4ae113c8c42f4468c16bc8c02fdae5492af9", 1_719_154_104],
  ["../.cache/huggingface/models--stabilityai--sd-vae-ft-mse/blobs/a1d993488569e928462932c8c38a0760b874d166399b14414135bd9c42df5815", 334_643_276],
  ["../.cache/huggingface/models--zhengchong--CatVTON/blobs/a1fc093f1b6744623079e6f4e7313411f524e388c4b7467df1e0e7f577cba23a", 198_303_368],
];
const localAvatarFiles = {
  front: process.env.DRESSLY_LOCAL_AVATAR_FRONT,
  side: process.env.DRESSLY_LOCAL_AVATAR_SIDE,
  back: process.env.DRESSLY_LOCAL_AVATAR_BACK,
};

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

let activeTryOn;
let demoModelAsset;
const resultCache = new Map();
const serviceStats = { successes: 0, failures: 0, lastSuccessAt: null, lastError: null };

async function getLocalModelReadiness() {
  const checks = await Promise.all(requiredLocalModels.map(async ([relativePath, expectedBytes]) => {
    try {
      const file = await stat(join(appDirectory, relativePath));
      return file.size === expectedBytes;
    } catch {
      return false;
    }
  }));
  return { ready: checks.every(Boolean), readyFiles: checks.filter(Boolean).length, totalFiles: checks.length };
}

function decodePersonImage(dataUrl) {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("人物照片格式无效");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 12 * 1024 * 1024) throw new Error("人物照片不能超过 12MB");
  return { bytes, extension: match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg" };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("本地试衣超过 15 分钟，已停止本次任务"));
    }, 15 * 60_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`本地 CatVTON 失败（${code}）：${stderr.trim().split("\n").at(-1) || stdout.trim()}`));
    });
  });
}

async function runLocalTryOn(product, personImage) {
  const requestId = crypto.randomUUID();
  const requestDirectory = join(appDirectory, "../.cache/requests", requestId);
  await mkdir(requestDirectory, { recursive: true });
  try {
    const garmentResponse = await fetch(product.imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!garmentResponse.ok) throw new Error(`商品图读取失败：HTTP ${garmentResponse.status}`);
    const garmentPath = join(requestDirectory, "garment.jpg");
    await writeFile(garmentPath, Buffer.from(await garmentResponse.arrayBuffer()));

    const decoded = decodePersonImage(personImage);
    const personPath = decoded ? join(requestDirectory, `person.${decoded.extension}`) : join(appDirectory, "assets/demo-model.jpg");
    if (decoded) await writeFile(personPath, decoded.bytes);
    const outputPath = join(requestDirectory, "result.png");

    await runCommand(join(appDirectory, "../.venv/bin/python"), [
      join(appDirectory, "../poc/local-catvton-poc.py"),
      "--person", personPath,
      "--garment", garmentPath,
      "--output", outputPath,
      "--steps", "20",
    ], {
      cwd: join(appDirectory, ".."),
      env: {
        ...process.env,
        HF_ENDPOINT: "https://hf-mirror.com",
        HF_HOME: join(appDirectory, "../.cache/huggingface"),
        HF_HUB_OFFLINE: "1",
        HF_HUB_ENABLE_HF_TRANSFER: "0",
        PYTORCH_ENABLE_MPS_FALLBACK: "1",
      },
    });

    resultCache.set(requestId, { bytes: await readFile(outputPath), contentType: "image/png" });
    serviceStats.successes += 1;
    serviceStats.lastSuccessAt = new Date().toISOString();
    serviceStats.lastError = null;
    return { eventId: requestId, imageUrl: `/api/results/${requestId}`, live: true, cached: false, provider: "local-catvton-mps" };
  } catch (error) {
    serviceStats.failures += 1;
    serviceStats.lastError = error.message;
    throw error;
  } finally {
    await rm(requestDirectory, { recursive: true, force: true });
  }
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
      const readiness = await getLocalModelReadiness();
      return sendJson(response, 200, {
        products,
        modelImageUrl: "/assets/demo-model",
        provider: { id: "local-catvton-mps", mode: "local-non-commercial-poc", ...readiness, ...serviceStats },
      });
    }
    if (request.method === "GET" && url.pathname === "/assets/demo-model") {
      if (!demoModelAsset) {
        demoModelAsset = {
          bytes: await readFile(join(appDirectory, "assets/demo-model.jpg")),
          contentType: "image/jpeg",
        };
      }
      response.writeHead(200, { "Content-Type": demoModelAsset.contentType, "Cache-Control": "public, max-age=3600" });
      response.end(demoModelAsset.bytes);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/local-avatar") {
      const enabled = Object.values(localAvatarFiles).every(Boolean);
      return sendJson(response, enabled ? 200 : 404, enabled
        ? { photos: Object.fromEntries(Object.keys(localAvatarFiles).map((view) => [view, `/api/local-avatar/${view}`])) }
        : { error: "本机分身照片未配置" });
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/local-avatar/")) {
      const view = url.pathname.slice("/api/local-avatar/".length);
      const file = localAvatarFiles[view];
      if (!file) return sendJson(response, 404, { error: "未配置该视图照片" });
      const bytes = await readFile(file);
      response.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
      response.end(bytes);
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/results/")) {
      const result = resultCache.get(url.pathname.slice("/api/results/".length));
      if (!result) return sendJson(response, 404, { error: "结果已过期，请重新生成" });
      response.writeHead(200, { "Content-Type": result.contentType, "Cache-Control": "no-store" });
      response.end(result.bytes);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/tryon") {
      const { productId, personImage } = await readBody(request);
      const product = products.find(({ id }) => id === productId);
      if (!product) return sendJson(response, 400, { error: "请选择有效商品" });
      if (!(await getLocalModelReadiness()).ready) return sendJson(response, 503, { error: "本机模型首次准备中，请稍后自动重试" });
      if (activeTryOn) return sendJson(response, 409, { error: "已有试衣任务正在生成，请稍候" });
      activeTryOn = runLocalTryOn(product, personImage);
      try {
        return sendJson(response, 200, await activeTryOn);
      } catch (error) {
        return sendJson(response, 503, { error: error.message, provider: "Local CatVTON on Apple MPS" });
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
