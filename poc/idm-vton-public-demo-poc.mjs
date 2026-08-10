#!/usr/bin/env node

/**
 * Runs one no-credential virtual-try-on POC against IDM-VTON's public demo.
 *
 * It deliberately uses only the Space's built-in sample images. Do not change
 * this into a production dependency: this demo is shared infrastructure and
 * the associated model is CC BY-NC-SA 4.0.
 */
const baseUrl = "https://yisol-idm-vton.hf.space";

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

const config = await getJson(`${baseUrl}/config`);
const datasets = config.components.filter(({ type }) => type === "dataset");
const humanDataset = datasets.find(({ props }) => props.headers?.[0]?.includes("Human"));
const garmentDataset = datasets.find(({ props }) => props.headers?.[0] === "Garment");

if (!humanDataset?.props.samples?.[0]?.[0] || !garmentDataset?.props.samples?.[0]?.[0]) {
  throw new Error("Public demo samples are unavailable or its UI schema changed.");
}

const human = humanDataset.props.samples[0][0];
const garment = garmentDataset.props.samples[0][0];
const submission = await getJson(`${baseUrl}/call/tryon`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    data: [
      human,
      garment,
      "Short Sleeve Round Neck T-shirt",
      true, // auto-mask
      false, // no crop
      20, // minimum documented denoising steps
      42,
    ],
  }),
});

if (!submission.event_id) throw new Error(`Public demo did not return an event id: ${JSON.stringify(submission)}`);

const eventResponse = await fetch(`${baseUrl}/call/tryon/${submission.event_id}`);
if (!eventResponse.ok) throw new Error(`${eventResponse.status} ${eventResponse.statusText}: event stream`);
const eventText = await eventResponse.text();
const completedLine = eventText.split("\n").find((line) => line.startsWith("data: ["));
if (!completedLine) throw new Error(`Public demo did not complete: ${eventText.slice(-800)}`);

const outputs = JSON.parse(completedLine.slice("data: ".length));
console.log(JSON.stringify({
  source: "IDM-VTON public Hugging Face Space",
  license: "CC BY-NC-SA 4.0 — non-commercial POC only",
  eventId: submission.event_id,
  outputs: outputs.map(({ url, mime_type }) => ({ url, mimeType: mime_type })),
}, null, 2));
