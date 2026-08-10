#!/usr/bin/env node

import { readFile } from "node:fs/promises";

function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    if (!length || length < 2) break;
    offset += 2 + length;
  }
  return null;
}

const sample = JSON.parse(await readFile(new URL("./pdd-womens-clothing-sample.json", import.meta.url), "utf8"));
const imageUrl = sample.products[0]?.imageUrl;
if (!imageUrl) throw new Error("拼多多样例缺少主图 URL");

const response = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`商品图 HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const dimensions = jpegDimensions(bytes);
const contentType = response.headers.get("content-type");
const cors = response.headers.get("access-control-allow-origin");

console.log(JSON.stringify({
  sourceUrl: sample.sourceUrl,
  imageUrl,
  httpStatus: response.status,
  contentType,
  cors,
  bytes: bytes.length,
  dimensions,
  externallyFetchable: response.ok && contentType?.startsWith("image/"),
  pocSuitable: Boolean(dimensions && dimensions.width >= 400 && dimensions.height >= 400),
  productionRecommendation: "联盟 API 优先取最大可用原始主图；低于 768px 时标记为低清候选，试衣前再做主体/服装类别质量检查。",
}, null, 2));
