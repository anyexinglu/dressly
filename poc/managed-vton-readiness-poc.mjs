#!/usr/bin/env node

const providers = [
  {
    id: "fal-fashn-v15",
    endpoint: "https://queue.fal.run/fal-ai/fashn/tryon/v1.5",
    env: ["FAL_KEY"],
    externalGates: ["fal account", "usable API balance"],
    pricing: "按成功输出计费；免费 credits/coupons 只能在 Sandbox/Playground 使用。",
  },
  {
    id: "google-vertex-vton-001",
    endpoint: "https://LOCATION-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/LOCATION/publishers/google/models/virtual-try-on-001:predict",
    env: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"],
    externalGates: ["Google Cloud access token/ADC", "Vertex AI enabled", "billing enabled"],
    pricing: "官方当前为 0.06 美元/输出图。",
  },
  {
    id: "aws-nova-canvas-vton",
    endpoint: "Bedrock InvokeModel: amazon.nova-canvas-v1:0 / VIRTUAL_TRY_ON",
    env: ["AWS_REGION"],
    externalGates: ["AWS account credentials", "Bedrock Nova Canvas model access", "billing enabled"],
    pricing: "按 Amazon Bedrock 当前区域价格计费。",
  },
  {
    id: "fashn-direct-v16",
    endpoint: "FASHN Developer API / Virtual Try-On v1.6",
    env: ["FASHN_API_KEY"],
    externalGates: ["FASHN account", "purchased API credits"],
    pricing: "1 credit/输出；按需 0.075 美元/credit，最低购买 100 credits。",
  },
];

const report = providers.map((provider) => ({
  ...provider,
  missingEnv: provider.env.filter((name) => !process.env[name]),
  state: provider.env.every((name) => process.env[name]) ? "credentials-unverified" : "account-or-billing-gated",
}));

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  providers: report,
  recommendation: "先用 fal Playground 的免费券验证 FASHN 质量；生产 API 优先比较 fal/FASHN、Google Vertex 与 AWS Nova 的单图成本、隐私保留期和输出一致性。",
}, null, 2));
