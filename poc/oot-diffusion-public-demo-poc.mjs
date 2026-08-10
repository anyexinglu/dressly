#!/usr/bin/env node

/**
 * Runs one no-credential virtual-try-on POC against OOTDiffusion's public
 * Hugging Face Space, using only its built-in public sample images.
 *
 * The result validates a free demonstration path only. OOTDiffusion is
 * CC BY-NC-SA 4.0 and therefore must not be used as a Dressly production
 * dependency without a separate commercial license analysis.
 */
const baseUrl = "https://levihsu-ootdiffusion.hf.space";

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function waitForResult(endpoint, eventId) {
  const response = await fetch(`${baseUrl}/gradio_api/call/${endpoint}/${eventId}`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: result stream`);
  const text = await response.text();
  const completedLine = text.split("\n").find((line) => line.startsWith("data: ["));
  if (!completedLine) throw new Error(`Public demo did not complete: ${text.slice(-800)}`);
  return JSON.parse(completedLine.slice("data: ".length));
}

const config = await getJson(`${baseUrl}/config`);
const modelSample = config.components.find(({ id }) => id === 10)?.props.samples?.[0]?.[0];
const garmentSample = config.components.find(({ id }) => id === 13)?.props.samples?.[0]?.[0];
if (!modelSample || !garmentSample) throw new Error("Public demo samples are unavailable or its UI schema changed.");

const submitted = await getJson(`${baseUrl}/gradio_api/call/process_hd`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ data: [modelSample, garmentSample, 1, 20, 2, -1] }),
});
if (!submitted.event_id) throw new Error(`Public demo did not return an event id: ${JSON.stringify(submitted)}`);

const output = await waitForResult("process_hd", submitted.event_id);
const result = output.flat().map(({ image, caption }) => ({ url: image?.url, caption }));
console.log(JSON.stringify({
  source: "OOTDiffusion public Hugging Face Space",
  license: "CC BY-NC-SA 4.0 — non-commercial POC only",
  eventId: submitted.event_id,
  outputs: result,
}, null, 2));
