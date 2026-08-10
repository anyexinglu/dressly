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

const endpointId = "fal-ai/fashn/tryon/v1.5";
const endpoint = `https://queue.fal.run/${endpointId}`;
const key = process.env.FAL_KEY;
const payload = {
  model_image: process.env.DRESSLY_PERSON_IMAGE_URL ?? "https://utfs.io/f/wXFHUNfTHmLj4prvqbRMQ6JXFyUr3IT0avK2HSOmZWiAsxg9",
  garment_image: process.env.DRESSLY_GARMENT_IMAGE_URL ?? "https://utfs.io/f/wXFHUNfTHmLjtkhepmqOUnkr8XxZbNIFmRWldShDLu320TeC",
  category: process.env.DRESSLY_GARMENT_CATEGORY ?? "auto",
  mode: process.env.DRESSLY_TRYON_MODE ?? "balanced",
  garment_photo_type: "auto",
  moderation_level: "permissive",
  num_samples: 1,
  output_format: "png",
};

if (!key) {
  console.log(JSON.stringify({
    provider: "FASHN Virtual Try-On v1.5 on fal.ai",
    state: "blocked",
    endpointId,
    missing: ["FAL_KEY"],
    commercialUse: true,
    freeBoundary: "fal 免费 credits/coupons 仅适用于 Sandbox/Playground，不能用于 API 或 Workflows。",
    payload: { ...payload, model_image: "[official sample]", garment_image: "[official sample]" },
  }, null, 2));
  process.exit(0);
}

const response = await fetch(endpoint, {
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
  provider: "FASHN Virtual Try-On v1.5 on fal.ai",
  state: body.status === "COMPLETED" ? "completed" : "queued",
  requestId: body.request_id,
  statusUrl: body.status_url,
  responseUrl: body.response_url,
  payload: { ...payload, model_image: "[configured]", garment_image: "[configured]" },
}, null, 2));
