const PDD_SINGLE_PROMOTION = 'https://jinbao.pinduoduo.com/promotion/single-promotion';
const TAOBAO_GOODS = 'https://pub.alimama.com/portal/v2/pages/promo/goods/index.htm';

export function normalizeOutfitQuery(prompt) {
  const normalized = String(prompt ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '女装';
  return /女装|连衣裙|半身裙|上衣|裤|外套|鞋|包/.test(normalized)
    ? normalized
    : `女装 ${normalized}`;
}

export function buildSearchRoutes(prompt) {
  const query = normalizeOutfitQuery(prompt);
  const pdd = new URL(PDD_SINGLE_PROMOTION);
  pdd.searchParams.set('keyword', query);

  const taobao = new URL(TAOBAO_GOODS);
  taobao.searchParams.set('pageNum', '1');
  taobao.searchParams.set('pageSize', '30');
  // 淘宝联盟当前页面使用双重编码的空 JSON 筛选器；保留这个格式以匹配已验证 URL。
  taobao.searchParams.set('filters', '%7B%7D');
  taobao.searchParams.set('fn', 'search');
  taobao.searchParams.set('q', query);
  taobao.searchParams.set('sort', 'default');
  taobao.searchParams.set('selected', '%7B%7D');
  taobao.searchParams.set('floorId', '80674');

  return { query, pinduoduo: pdd.toString(), taobaoTmall: taobao.toString() };
}

function selfTest() {
  const routes = buildSearchRoutes('通勤 连衣裙');
  if (routes.query !== '通勤 连衣裙') throw new Error('服饰提示词不应被改写');
  if (!routes.pinduoduo.includes('keyword=%E9%80%9A%E5%8B%A4+%E8%BF%9E%E8%A1%A3%E8%A3%99')) throw new Error('拼多多关键词路由错误');
  if (!routes.taobaoTmall.includes('q=%E9%80%9A%E5%8B%A4+%E8%BF%9E%E8%A1%A3%E8%A3%99')) throw new Error('淘宝关键词路由错误');
  if (buildSearchRoutes('约会').query !== '女装 约会') throw new Error('非服饰提示词应补充女装类目');
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv[2] === '--self-test') {
    selfTest();
    console.log('query router assertions passed');
  } else {
    console.log(JSON.stringify(buildSearchRoutes(process.argv.slice(2).join(' ')), null, 2));
  }
}
