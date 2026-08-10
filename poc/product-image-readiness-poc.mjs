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

function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function webpDimensions(bytes) {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null;
  const format = bytes.toString("ascii", 12, 16);
  if (format === "VP8 ") {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (format === "VP8X") {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (format === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return null;
}

const sampleFiles = [
  ["多多进宝", "./pdd-womens-clothing-sample.json"],
  ["淘宝联盟", "./taobao-womens-clothing-sample.json"],
];
const results = [];
for (const [channel, file] of sampleFiles) {
  const sample = JSON.parse(await readFile(new URL(file, import.meta.url), "utf8"));
  const imageUrl = sample.products.find(({ imageUrl: url }) => url)?.imageUrl;
  if (!imageUrl) throw new Error(`${channel}样例缺少主图 URL`);
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${channel}商品图 HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type");
  const dimensions = contentType?.includes("png")
    ? pngDimensions(bytes)
    : contentType?.includes("webp")
      ? webpDimensions(bytes)
      : jpegDimensions(bytes);
  results.push({
    channel,
    sourceUrl: sample.sourceUrl,
    imageUrl,
    httpStatus: response.status,
    contentType,
    cors: response.headers.get("access-control-allow-origin"),
    bytes: bytes.length,
    dimensions,
    externallyFetchable: response.ok && contentType?.startsWith("image/"),
    pocSuitable: Boolean(dimensions && dimensions.width >= 400 && dimensions.height >= 400),
  });
}

console.log(JSON.stringify({
  results,
  productionRecommendation: "联盟 API 优先取最大可用原始主图；低于 768px 时标记为低清候选，试衣前再做主体/服装类别质量检查。",
}, null, 2));
