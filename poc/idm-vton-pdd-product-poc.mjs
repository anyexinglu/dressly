#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const baseUrl = "https://yisol-idm-vton.hf.space";

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

const productSample = JSON.parse(await readFile(new URL("./pdd-womens-clothing-sample.json", import.meta.url), "utf8"));
const product = productSample.products[0];
if (!product?.imageUrl) throw new Error("拼多多样例缺少商品主图");

const config = await getJson(`${baseUrl}/config`);
const humanDataset = config.components.find(({ type, props }) => type === "dataset" && props.headers?.[0]?.includes("Human"));
const human = humanDataset?.props.samples?.[0]?.[0];
if (!human) throw new Error("IDM-VTON 官方人像样例不可用");

const productImageResponse = await fetch(product.imageUrl, { signal: AbortSignal.timeout(20_000) });
if (!productImageResponse.ok) throw new Error(`拼多多主图 HTTP ${productImageResponse.status}`);
const productImage = await productImageResponse.blob();
const formData = new FormData();
formData.append("files", productImage, "pdd-garment.jpg");
const uploaded = await getJson(`${baseUrl}/upload`, { method: "POST", body: formData });
const garmentPath = uploaded[0];
if (!garmentPath) throw new Error(`IDM-VTON 上传未返回路径: ${JSON.stringify(uploaded)}`);

const garment = {
  path: garmentPath,
  url: `${baseUrl}/file=${garmentPath}`,
  orig_name: "pdd-garment.jpg",
  mime_type: productImage.type || "image/jpeg",
  meta: { _type: "gradio.FileData" },
};
const submission = await getJson(`${baseUrl}/call/tryon`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    data: [
      human,
      garment,
      product.title,
      true,
      false,
      20,
      42,
    ],
  }),
});
if (!submission.event_id) throw new Error(`IDM-VTON 未返回任务 ID: ${JSON.stringify(submission)}`);

const eventResponse = await fetch(`${baseUrl}/call/tryon/${submission.event_id}`, { signal: AbortSignal.timeout(180_000) });
if (!eventResponse.ok) throw new Error(`IDM-VTON event HTTP ${eventResponse.status}`);
const eventText = await eventResponse.text();
const completedLine = eventText.split("\n").find((line) => line.startsWith("data: ["));
if (!completedLine) throw new Error(`IDM-VTON 未完成: ${eventText.slice(-800)}`);

const outputs = JSON.parse(completedLine.slice("data: ".length));
console.log(JSON.stringify({
  source: {
    channel: "多多进宝",
    searchUrl: productSample.sourceUrl,
    title: product.title,
    price: product.price,
    imageUrl: product.imageUrl,
  },
  tryOn: {
    provider: "IDM-VTON public Hugging Face Space",
    license: "CC BY-NC-SA 4.0 — 仅限非商业 POC",
    eventId: submission.event_id,
    outputs: outputs.map(({ url, mime_type: mimeType }) => ({ url, mimeType })),
  },
}, null, 2));
