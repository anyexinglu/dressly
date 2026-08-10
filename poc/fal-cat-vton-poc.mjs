#!/usr/bin/env node

import { readFile } from "node:fs/promises";

async function loadDotEnv() {
  try {
    const content = await readFile(new URL("../.env", import.meta.url), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim();
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

await loadDotEnv();

const key = process.env.FAL_KEY;
if (!key) {
  console.log(JSON.stringify({
    provider: "fal.ai CatVTON",
    state: "blocked",
    missing: ["FAL_KEY"],
    scope: "官方队列接口已按 OpenAPI Schema 固化；缺少账户 API Key 时不发起试衣请求。",
  }, null, 2));
  process.exit(0);
}

const payload = {
  human_image_url: process.env.DRESSLY_PERSON_IMAGE_URL ?? "https://storage.googleapis.com/falserverless/catvton/man5.jpg",
  garment_image_url: process.env.DRESSLY_GARMENT_IMAGE_URL ?? "https://storage.googleapis.com/falserverless/catvton/tshirt.jpg",
  cloth_type: process.env.DRESSLY_CLOTH_TYPE ?? "upper",
  image_size: "portrait_4_3",
  num_inference_steps: 20,
  guidance_scale: 2.5,
};

const response = await fetch("https://queue.fal.run/fal-ai/cat-vton", {
  method: "POST",
  headers: {
    Authorization: `Key ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(30_000),
});
const body = await response.json();
if (!response.ok) throw new Error(`fal.ai HTTP ${response.status}: ${JSON.stringify(body)}`);

console.log(JSON.stringify({
  provider: "fal.ai CatVTON",
  state: body.status === "COMPLETED" ? "completed" : "queued",
  requestId: body.request_id,
  statusUrl: body.status_url,
  responseUrl: body.response_url,
  payload: { ...payload, human_image_url: "[configured]", garment_image_url: "[configured]" },
}, null, 2));
