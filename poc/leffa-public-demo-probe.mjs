#!/usr/bin/env node

const baseUrl = "https://franciszzj-leffa.hf.space";
const modelApiUrl = "https://huggingface.co/api/models/franciszzj/Leffa";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), ...options });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json();
}

async function fetchJsonResult(url, options) {
  try {
    return { ok: true, value: await fetchJson(url, options) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

const [configResult, apiInfoResult, modelResult] = await Promise.all([
  fetchJsonResult(`${baseUrl}/config`),
  fetchJsonResult(`${baseUrl}/gradio_api/info`),
  fetchJsonResult(modelApiUrl),
]);
const config = configResult.value ?? { components: [] };
const apiInfo = apiInfoResult.value ?? { named_endpoints: {} };
const model = modelResult.value ?? {};

const endpoint = apiInfo.named_endpoints?.["/leffa_predict_vt"];
const personDataset = config.components.find(({ id }) => id === 10);
const garmentDataset = config.components.find(({ id }) => id === 14);
const person = personDataset?.props.samples?.[0]?.[0];
const garment = garmentDataset?.props.samples?.[0]?.[0];

let generation = { state: "not-attempted" };
if (endpoint && person && garment) {
  try {
    const submission = await fetchJson(`${baseUrl}/gradio_api/call/leffa_predict_vt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [person, garment, false, 30, 2.5, 42, "viton_hd", "upper_body", false],
      }),
    });
    const eventResponse = await fetch(`${baseUrl}/gradio_api/call/leffa_predict_vt/${submission.event_id}`, {
      signal: AbortSignal.timeout(120_000),
    });
    const eventText = await eventResponse.text();
    const completedLine = eventText.split("\n").find((line) => line.startsWith("data: ["));
    generation = completedLine ? {
      state: "success",
      eventId: submission.event_id,
      outputs: JSON.parse(completedLine.slice("data: ".length)),
    } : {
      state: eventText.includes("event: error") ? "service-error" : "incomplete",
      eventId: submission.event_id,
      responseTail: eventText.slice(-300),
    };
  } catch (error) {
    generation = {
      state: error.name === "TimeoutError" ? "timeout" : "request-error",
      error: error.message,
    };
  }
}

console.log(JSON.stringify({
  provider: "franciszzj/Leffa",
  repository: "https://github.com/franciszzj/Leffa",
  model: "https://huggingface.co/franciszzj/Leffa",
  codeLicense: "MIT",
  modelLicense: model.cardData?.license ?? null,
  gated: model.gated ?? null,
  metadataChecks: {
    spaceConfig: configResult.ok ? "ok" : configResult.error,
    apiInfo: apiInfoResult.ok ? "ok" : apiInfoResult.error,
    modelCard: modelResult.ok ? "ok" : modelResult.error,
  },
  publicApi: {
    exposed: Boolean(endpoint),
    endpoint: endpoint ? "/leffa_predict_vt" : null,
    parameterCount: endpoint?.parameters?.length ?? 0,
    personSamples: personDataset?.props.samples?.length ?? 0,
    garmentSamples: garmentDataset?.props.samples?.length ?? 0,
  },
  generation,
  conclusion: generation.state === "success"
    ? "公开 API 本次真实生成成功；免费共享资源仍不构成生产 SLA。"
    : "公开 API 与样例可发现，但本次真实生成未成功；保留为可自托管候选，不作为稳定免费依赖。",
}, null, 2));
