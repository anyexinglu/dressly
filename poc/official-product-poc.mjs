import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { normalizeJd, normalizePdd, normalizeTaobao, sortedSignature, validateProducts } from './official-product-core.mjs';

async function loadDotEnv() {
  try {
    const text = await readFile(new URL('../.env', import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim();
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function now() {
  const date = new Date(); const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function missing(...keys) { return keys.filter((key) => !process.env[key]); }
async function request(url, params) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20_000) });
  const json = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(json)}`);
  return json;
}
async function pdd(keyword) {
  const absent = missing('PDD_CLIENT_ID', 'PDD_CLIENT_SECRET', 'PDD_PID');
  if (absent.length) return { channel: 'pinduoduo', state: 'blocked', missing: absent };
  const params = { client_id: process.env.PDD_CLIENT_ID, data_type: 'JSON', keyword, page: '1', page_size: '10', pid: process.env.PDD_PID, timestamp: String(Date.now()), type: 'pdd.ddk.goods.search' };
  params.sign = sortedSignature(process.env.PDD_CLIENT_SECRET, params);
  const json = await request('https://gw-api.pinduoduo.com/api/router', params);
  const list = json.goods_search_response?.goods_list ?? [];
  return { channel: 'pinduoduo', state: 'ok', rawCount: list.length, products: validateProducts(list.map(normalizePdd)) };
}
async function jd(keyword) {
  const absent = missing('JD_APP_KEY', 'JD_APP_SECRET');
  if (absent.length) return { channel: 'jd', state: 'blocked', missing: absent };
  const params = { app_key: process.env.JD_APP_KEY, format: 'json', method: 'jd.union.open.goods.query', param_json: JSON.stringify({ goodsReqDTO: { keyword, pageIndex: 1, pageSize: 10 } }), sign_method: 'md5', timestamp: now(), v: '1.0' };
  params.sign = sortedSignature(process.env.JD_APP_SECRET, params);
  const json = await request('https://api.jd.com/routerjson', params);
  const result = json.jd_union_open_goods_query_responce?.queryResult;
  const decoded = typeof result === 'string' ? JSON.parse(result) : result;
  const list = decoded?.data ?? [];
  return { channel: 'jd', state: 'ok', rawCount: list.length, products: validateProducts(list.map(normalizeJd)) };
}
async function taobao(keyword) {
  const absent = missing('TAOBAO_APP_KEY', 'TAOBAO_APP_SECRET', 'TAOBAO_ADZONE_ID');
  if (absent.length) return { channel: 'taobao_tmall', state: 'blocked', missing: absent };
  const params = { adzone_id: process.env.TAOBAO_ADZONE_ID, app_key: process.env.TAOBAO_APP_KEY, format: 'json', method: 'taobao.tbk.dg.material.optional.upgrade', page_no: '1', page_size: '10', q: keyword, sign_method: 'md5', timestamp: now(), v: '2.0' };
  params.sign = sortedSignature(process.env.TAOBAO_APP_SECRET, params);
  const json = await request('https://eco.taobao.com/router/rest', params);
  const list = json.tbk_dg_material_optional_upgrade_response?.result_list?.map_data ?? [];
  return { channel: 'taobao_tmall', state: 'ok', rawCount: list.length, products: validateProducts(list.map(normalizeTaobao)) };
}
await loadDotEnv();
const keyword = process.env.DRESSLY_KEYWORD ?? '连衣裙';
const report = { generatedAt: new Date().toISOString(), keyword, scope: '仅调用三个官方联盟接口；blocked 表示尚未配置联盟开发者凭据，不代表接口失败。', results: await Promise.all([pdd(keyword), jd(keyword), taobao(keyword)]) };
await mkdir(new URL('.', import.meta.url), { recursive: true });
await writeFile(new URL('./official-products-report.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
