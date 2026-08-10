#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function nvidiaSmi() {
  try {
    const { stdout } = await run("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"], { timeout: 5_000 });
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

const gpus = await nvidiaSmi();
const hasCudaNvidiaGpu = gpus.length > 0;
console.log(JSON.stringify({
  provider: "self-hosted DCI-VTON candidate",
  host: { platform: process.platform, arch: process.arch },
  nvidiaGpus: gpus,
  state: hasCudaNvidiaGpu ? "candidate-ready-for-dependency-install" : "blocked-on-cuda-host",
  reason: hasCudaNvidiaGpu
    ? "GPU is detectable; verify Python, CUDA, model weights and each dependency license next."
    : "DCI-VTON upstream instructions target CUDA/Linux. This host has no detectable NVIDIA CUDA GPU, so it is not a local inference host.",
}, null, 2));
