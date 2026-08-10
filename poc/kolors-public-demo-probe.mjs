#!/usr/bin/env node

const baseUrl = "https://kwai-kolors-kolors-virtual-try-on.hf.space";
const response = await fetch(`${baseUrl}/config`, { signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`Kolors Space config HTTP ${response.status}`);

const config = await response.json();
const datasets = config.components
  .filter(({ type }) => type === "dataset")
  .map(({ props }) => ({ headers: props.headers, sampleCount: props.samples?.length ?? 0 }));
const generation = config.dependencies.find(({ backend_fn: backendFn, inputs, outputs }) => (
  backendFn && inputs?.length === 4 && outputs?.length === 3
));

console.log(JSON.stringify({
  provider: "Kwai-Kolors/Kolors-Virtual-Try-On",
  state: generation ? "ui-only" : "schema-changed",
  spaceVersion: config.version,
  datasets,
  generation: generation ? {
    queue: generation.queue,
    apiName: generation.api_name,
    showApi: generation.show_api,
    publicAutomationAvailable: typeof generation.api_name === "string" && generation.api_name.length > 0,
  } : null,
  conclusion: "官方 Space 可手工试用，但生成函数未暴露公开 API；不能把加载预置结果当作真实生成。",
}, null, 2));
