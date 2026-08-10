# Dressly — Daily Outfits

Dressly 是一个“每日穿搭”概念验证项目：根据风格和预算组合可购买单品，并跳转至原平台完成交易。

## 数据边界

本项目只计划接入平台授权的联盟/内容选品接口：

- 淘宝/天猫：淘宝联盟商品池；可进一步接入官方以图搜商品能力。
- 京东：京东联盟商品池。
- 拼多多：多多进宝商品池。

这不是商家自有商品管理 API，也不是网页抓取。可见范围是**允许联盟站外推广**的商品，不等于三个平台的全部在售 SKU。商品详情页抓取、绕过登录或反爬不在范围内。

## 价格与图片的准确性标准

联盟 API 返回的是检索时刻的商品主图和报价。前台应标为“参考价”，记录 `syncedAt`，并在跳转页提示“以平台结算页为准”。

真实接入后，每个平台至少抽样 30 个商品、在 10 分钟内与落地页人工比对，以下结果才算通过：

| 字段 | 通过标准 |
| --- | --- |
| 商品 ID / 落地链接 | 30/30 对应同一商品 |
| 主图 | 30/30 与落地页主图一致或为同商品官方图 |
| 标价 | 允许 SKU、地区、会员、活动导致差异；必须展示对应价格类型 |
| 券后价 | 必须同时校验券的有效期、门槛和剩余量 |

## 本地 POC

```bash
npm run poc:gateways
```

它不会伪造业务数据：仅连续探测官方网关能否稳定抵达并返回可解析的鉴权错误。运行结果写入 `poc/report.json`（已忽略），真实商品准确性需要配置三个联盟账户的授权后再执行抽样。

拿到联盟开发者身份后，运行以下命令拉取三个官方商品池的首批 10 条“连衣裙”结果：

```bash
npm run poc:official-products
```

输出写入 `poc/official-products-report.json`（已忽略）。它统一记录商品 ID、标题、官方主图 URL、标价、推广价、券额、落地链接和字段完整性；缺少凭据时明确输出 `blocked`，不会把网关响应伪装成商品数据。

本地 `.env`（绝不提交）需要配置：

```dotenv
PDD_CLIENT_ID=
PDD_CLIENT_SECRET=
PDD_PID=
JD_APP_KEY=
JD_APP_SECRET=
TAOBAO_APP_KEY=
TAOBAO_APP_SECRET=
TAOBAO_ADZONE_ID=
```

## 从穿搭提示词检索服饰

POC 直接使用以下三个用户提供的真实入口：

- 多多进宝（原始中文关键词）：<https://jinbao.pinduoduo.com/promotion/single-promotion?keyword=女装>
- 多多进宝（URL 编码关键词）：<https://jinbao.pinduoduo.com/promotion/single-promotion?keyword=%E5%A5%B3%E8%A3%85>
- 淘宝联盟：<https://pub.alimama.com/portal/v2/pages/promo/goods/index.htm?pageNum=1&pageSize=30&filters=%257B%257D&fn=search&q=%E5%A5%B3%E8%A3%85&sort=default&selected=%257B%257D&floorId=80674>

`poc/query-router.mjs` 把用户提示词规范为服饰检索词，并生成已验证的联盟搜索页 URL：

```bash
node poc/query-router.mjs "通勤 连衣裙"
```

- 拼多多：`/promotion/single-promotion?keyword=<检索词>`；例如“女装”。
- 淘宝/天猫：联盟选品页的 `q=<检索词>`、`fn=search`、`pageSize=30` 路由。

提示词应先由搭配器展开为可检索的服饰词（如“通勤连衣裙”“夏季衬衫”“小个子阔腿裤”）；路由器会给没有品类的短词补上“女装”。**URL 只负责打开选品页，不代表已获得商品数据**：只有联盟 API 或已授权页面返回的主图、标题和价格才能进入 Dressly 候选池。

2026-08-10 的 Chrome L1 验证中，多多进宝编码入口成功显示“女装”结果页，并可从商品卡片读取标题、价格/券后价、佣金、佣金比例、销量、店铺与拼多多主图 URL；首批真实样例见 [`poc/pdd-womens-clothing-sample.json`](poc/pdd-womens-clothing-sample.json)。随后淘宝联盟登录态恢复，同一“女装”入口显示当前 1–30 条、共 1200 条；已逐卡核验 10 条标题、价格类型、价格、佣金率和佣金，并读取首件商品的阿里主图，见 [`poc/taobao-womens-clothing-sample.json`](poc/taobao-womens-clothing-sample.json)。动态页面的整批 DOM 读取多次超时，所以未把未核验的 20 条或图片 URL 猜写进样例。

可复跑商品图外部可取性检查：

```bash
npm run poc:product-image-readiness
```

脚本会同时检查多多进宝与淘宝联盟样例中的真实主图 URL，记录 HTTP、MIME、CORS 和尺寸。生产候选池仍应优先使用联盟 API 返回的最大原始主图，并对低于 768px 的图片降级或剔除。

## AI 试衣资源 POC

```bash
npm run poc:tryon-sources
```

试衣生成至少需要三项输入：用户明确同意使用的人像、商品/服装图、服装类别（上装、下装、连衣裙等）。脚本列出当前已核验的来源与许可证边界：

- **非商业效果 POC**：IDM-VTON、CatVTON、OOTDiffusion 的常见发布路径带 `CC BY-NC-SA 4.0`，不能直接用于 Dressly 商业上线。OOTDiffusion 曾完成真实生成，但复跑已明确返回匿名 ZeroGPU 配额耗尽；IDM-VTON 曾完成生成但后续复跑返回服务端错误，CatVTON 当前也返回服务端错误。三者均只保留为不稳定、非商业候选。
- **自托管商业候选**：DCI-VTON 的代码仓库为 MIT；仍必须在接入前逐项核验权重、底座模型、训练数据及输出使用条款。
- **新增自托管候选**：Leffa 的代码仓库和 Hugging Face 模型卡均标注 MIT，并公开了上装、下装、连衣裙能力；但还依赖 SD/SDXL Inpainting、DensePose、SCHP 等组件，商用前必须做完整依赖审计。SwiftTry 的代码为 BSD-3-Clause，但模型派生自 SD-Turbo，不能只看代码许可证。
- **托管商业候选**：FASHN Try-On Max、fal.ai CatVTON 都要求账户/API Key；页面上的“免费开始”或计费展示不等于已取得可用于生产的免费额度或商用授权。

商品图仍应从联盟 API/已授权选品页取得；试衣图不能通过绕过平台登录或反爬取得。用户人像应以临时、可撤回处理为默认，且不应写入仓库或日志。

无需注册的端到端效果验证可运行：

```bash
npm run poc:idm-vton-demo
npm run poc:oot-diffusion-demo
npm run poc:idm-vton-pdd-product
```

前两个脚本只使用对应 Space 自带的公开样例，实际提交一次试衣并输出结果 URL，不上传用户图或商品图。它们用于非商业 POC，不得作为生产依赖。

`poc:idm-vton-pdd-product` 是端到端商品链路：读取多多进宝真实女装样例的主图，搭配 IDM-VTON 官方内置人像，上传并执行一次试衣。2026-08-10 已真实得到 768×1024 PNG；白色针织开衫、黑色蝴蝶结和黑色口袋等商品特征被保留。该结果证明“联盟商品图 → 试衣”技术链路，但 IDM-VTON 的 `CC BY-NC-SA 4.0` 仍限制其只能用于非商业 POC。

托管 API 的可复跑入口：

```bash
npm run poc:fal-cat-vton
npm run poc:fal-fashn-vton
npm run poc:managed-vton-readiness
npm run poc:kolors-demo-probe
npm run poc:leffa-demo-probe
```

前两个脚本分别遵循 fal.ai 公开的 CatVTON 与 FASHN v1.5 队列接口：账号创建后只需在本地 `.env` 写入 `FAL_KEY`，脚本会提交并返回请求与状态 URL；没有 Key 时只输出 `blocked`，不发送请求。默认仅使用官方文档的公开样例 URL；要接入 Dressly 时再在服务端替换为联盟商品图 URL 和经用户同意的人像 URL。`managed-vton-readiness` 还列出 Google Vertex `virtual-try-on-001`、AWS Nova Canvas 与 FASHN 直连 API 的账户、计费和凭证门槛。

`kolors-demo-probe` 会实时读取快手官方 Hugging Face Space 配置。当前能确认 12 组样例和 UI 生成按钮，但生成函数没有公开 API 名称，因此只可手工试用，不能当作 Dressly 可复跑接口。

`leffa-demo-probe` 会同时读取作者 Space 的公开 API Schema、样例数量和 Hugging Face 模型许可证，并真实提交一次公开样例。当前接口公开、模型非 gated，但连续三次生成任务都立即返回服务端 error；因此 Leffa 只提升了“免费可自托管”的候选质量，没有形成新的稳定免费托管容量。

另外复核了 Hugging Face 搜索结果中较高热度的 Miragic 与 WeShopAI：两者都把推理转发到外部服务。Miragic 未声明许可证、核心逻辑被混淆，本轮任务有 event id 但无结果；WeShopAI 模型卡许可证为 `other` 并启用 Hugging Face OAuth。它们可以人工对照效果，但不满足 Dressly 对可审计许可证、稳定复跑和商用边界的要求。

当前商用优先级：

1. **fal/FASHN v1.5**：页面明确标注 Commercial use，接入最小；但免费 credits/coupons 只能在 Sandbox/Playground 使用，API 调用仍需 Key 与可用余额。
2. **Google Vertex AI**：`virtual-try-on-001` 已 GA，官方当前价格为 0.06 美元/图；需要 GCP 项目、计费与服务身份。
3. **AWS Nova Canvas**：Bedrock 原生 `VIRTUAL_TRY_ON`，支持自动服装蒙版、上/下/全身和鞋类；需要 AWS 模型访问与计费。
4. **Kolors Virtual Try-On**：代码 Apache-2.0 不等于权重可直接商用；MAU 不超过 3 亿的商业使用仍须向快手提交官方登记问卷。

自托管候选的本机前置检查：

```bash
npm run poc:self-host-readiness
```

DCI-VTON 的代码仓库为 MIT，但上游推理说明面向 CUDA/Linux。当前 Mac 为 arm64 且没有检测到 NVIDIA CUDA GPU，所以不是该模型的本机推理宿主；若走自托管，需要单独的 CUDA GPU 机器，并在部署前审查权重、底座模型和训练数据的许可证。

## 需要的平台身份

申请的是三个联盟的推广者/开发者能力与推广位，不是向每一家店铺逐一申请商家授权：淘宝联盟、京东联盟、多多进宝。密钥只能保存在服务端环境变量，绝不提交到 Git。
