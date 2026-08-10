#!/usr/bin/env node

/**
 * Virtual try-on source inventory.
 *
 * This deliberately records evidence and integration gates rather than
 * pretending that a model page is a production-ready Dressly dependency.
 */
const sources = [
  {
    id: "dci-vton",
    kind: "self-hosted",
    name: "DCI-VTON",
    url: "https://github.com/bcmi/DCI-VTON-Virtual-Try-On",
    license: "MIT（代码仓库）",
    use: "可作为商业自托管候选；仍需逐项复核模型权重、底座模型和训练数据许可证。",
    gate: "需要 Linux/CUDA 推理环境、权重下载与人像+商品图输入；本机为 macOS arm64，未检测到 NVIDIA CUDA GPU。",
    status: "candidate",
  },
  {
    id: "idm-vton",
    kind: "self-hosted",
    name: "IDM-VTON",
    url: "https://github.com/yisol/IDM-VTON",
    license: "CC BY-NC-SA 4.0（模型/常见发布路径）",
    use: "适合非商业效果 POC，不可直接进入 Dressly 商业服务链路。",
    gate: "需要 GPU、权重与人像+商品图输入。",
    status: "poc-only",
  },
  {
    id: "cat-vton",
    kind: "self-hosted",
    name: "CatVTON",
    url: "https://github.com/Zheng-Chong/CatVTON",
    license: "CC BY-NC-SA 4.0",
    use: "约 8 GB VRAM 可做 1024×768 非商业 POC；不可直接商用。",
    gate: "需要 GPU、权重与人像+商品图输入。",
    status: "poc-only",
  },
  {
    id: "idm-vton-hf-demo",
    kind: "public-demo",
    name: "IDM-VTON Hugging Face Space",
    url: "https://huggingface.co/spaces/yisol/IDM-VTON",
    license: "CC BY-NC-SA 4.0",
    use: "本次 POC 曾用公开样例完成真实推理；后续复跑返回服务端 error。",
    gate: "共享 ZeroGPU 资源存在间歇性失败；演示不等于稳定生产容量，也不改变非商业限制。",
    status: "poc-demo-unstable",
  },
  {
    id: "oot-diffusion-hf-demo",
    kind: "public-demo",
    name: "OOTDiffusion Hugging Face Space",
    url: "https://huggingface.co/spaces/levihsu/OOTDiffusion",
    license: "CC BY-NC-SA 4.0",
    use: "本次 POC 已用内置公开样例完成一次真实生成并返回 WebP URL。",
    gate: "复跑明确返回 ZeroGPU quota exceeded（匿名额度耗尽）；演示可用不等于连续调用或生产容量，也不改变非商业限制。",
    status: "poc-demo-quota-exhausted",
  },
  {
    id: "cat-vton-hf-demo",
    kind: "public-demo",
    name: "CatVTON Hugging Face Space",
    url: "https://huggingface.co/spaces/zhengchong/CatVTON",
    license: "CC BY-NC-SA 4.0",
    use: "公开、非 gated、运行中的演示，且提供公开样例和 API。",
    gate: "2026-08-10 以其标准预处理+生成链路提交时返回服务端 error；当前仅作待复测候选。",
    status: "poc-demo-unstable",
  },
  {
    id: "fashn",
    kind: "managed-api",
    name: "FASHN Try-On Max",
    url: "https://docs.fashn.ai/api-reference/tryon-max",
    license: "受服务条款与 API 计划约束",
    use: "商业化候选；接口要求 product_image 与 model_image。",
    gate: "需创建账户、购买 credits 并取得 API Key；官方当前按 credits 计费，Virtual Try-On v1.6 每张 1 credit，按需购买最低 100 credits / 7.50 美元。",
    status: "account-gated",
  },
  {
    id: "fal-cat-vton",
    kind: "managed-api",
    name: "fal.ai CatVTON",
    url: "https://fal.ai/models/fal-ai/cat-vton",
    license: "受 fal.ai 服务条款与模型条款约束",
    use: "页面列为 CatVTON 托管推理；需传 human_image_url、garment_image_url、cloth_type。",
    gate: "需 FAL_KEY；页面计费信息不替代实际账户额度与生产授权核验。",
    status: "account-gated",
  },
  {
    id: "fal-fashn-v15",
    kind: "managed-api",
    name: "FASHN Virtual Try-On v1.5 on fal.ai",
    url: "https://fal.ai/models/fal-ai/fashn/tryon/v1.5/api",
    license: "页面明确标注 Commercial use；仍受 fal.ai 与 FASHN 服务条款约束",
    use: "当前最直接的 Dressly 商用 POC 候选；支持人像、平铺/上身服装图、tops/bottoms/one-pieces 类别。",
    gate: "需 fal 账户和 FAL_KEY；免费 credits/coupons 仅用于 Sandbox/Playground，不能用于 API 或 Workflows。",
    status: "account-gated-commercial",
  },
  {
    id: "google-vertex-vton",
    kind: "managed-api",
    name: "Google Vertex AI Virtual Try-On",
    url: "https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/virtual-try-on-api",
    license: "Google Cloud 服务条款",
    use: "virtual-try-on-001 已于 2026-01 GA；输入 personImage 与 productImages，官方定价为每张 0.06 美元。",
    gate: "需要 Google Cloud 项目、启用 Vertex AI、计费账户、区域和服务身份；没有持续免费 API 路径。",
    status: "cloud-account-gated-commercial",
  },
  {
    id: "aws-nova-canvas-vton",
    kind: "managed-api",
    name: "Amazon Nova Canvas Virtual Try-On",
    url: "https://docs.aws.amazon.com/nova/latest/userguide/image-gen-vto.html",
    license: "AWS 服务条款",
    use: "Bedrock 的 VIRTUAL_TRY_ON 支持人物、服装与自动/显式蒙版，可覆盖上装、下装、全身与鞋类。",
    gate: "需要 AWS 账户、Bedrock Nova Canvas 模型访问和计费；可用区包括 us-east-1、ap-northeast-1、eu-west-1。",
    status: "cloud-account-gated-commercial",
  },
  {
    id: "kolors-vton",
    kind: "self-hosted",
    name: "Kolors Virtual Try-On",
    url: "https://github.com/Kwai-Kolors/Kolors",
    license: "代码 Apache-2.0；模型权重为 Kolors Model License",
    use: "可作为中国团队维护的自托管候选；MAU 不超过 3 亿时仍需向快手提交商业登记问卷。",
    gate: "商业使用前必须完成官方问卷登记；需要 Linux/CUDA 与权重部署，不能把代码许可证等同于模型商用授权。",
    status: "registration-gated-commercial",
  },
  {
    id: "kolors-vton-hf-demo",
    kind: "public-demo",
    name: "Kolors Virtual Try-On official Hugging Face Space",
    url: "https://huggingface.co/spaces/Kwai-Kolors/Kolors-Virtual-Try-On",
    license: "沿用 Kolors Model License",
    use: "官方 Space 提供 12 组人物与服装样例，可用于手工视觉试用。",
    gate: "Gradio 配置中生成函数 api_name=false；公开接口只能加载预置样例，不能作为自动化生成 API。",
    status: "poc-demo-ui-only",
  },
];

const requiredInput = ["person image", "garment/product image", "garment category"];
const report = {
  generatedAt: new Date().toISOString(),
  requiredInput,
  sources,
  recommendation: {
    poc: "用 CatVTON 或 IDM-VTON 仅验证输入图片、生成链路与质量评测；输出不可用于商业发布。",
    commercial: "优先用 fal/FASHN 做低接入成本的商用质量 POC，再以 Google Vertex 或 AWS Nova 做云厂商备选；自托管仅评估完成权重授权登记的 Kolors/DCI-VTON。",
    data: "商品图只能来自联盟 API/已授权选品页；人像必须由用户上传并取得同意。",
  },
};

const counts = Object.groupBy(sources, ({ status }) => status);
const summary = Object.fromEntries(Object.entries(counts).map(([status, items]) => [status, items.length]));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Dressly AI 试衣来源 POC");
  console.table(sources.map(({ id, kind, license, status }) => ({ id, kind, license, status })));
  console.log("\n状态汇总:", summary);
  console.log("\n输入要求:", requiredInput.join(" / "));
  console.log("\n商用建议:", report.recommendation.commercial);
}

if (sources.some(({ status }) => status === "candidate") && sources.every(({ url }) => url.startsWith("https://"))) {
  process.exitCode = 0;
} else {
  process.exitCode = 1;
}
