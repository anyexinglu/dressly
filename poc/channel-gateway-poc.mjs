import { mkdir, writeFile } from 'node:fs/promises';

const channels = [
  {
    name: 'pinduoduo',
    url: 'https://gw-api.pinduoduo.com/api/router?type=pdd.ddk.goods.search',
    expects: '公共参数错误:timestamp',
  },
  {
    name: 'taobao_tmall',
    url: 'https://eco.taobao.com/router/rest?method=taobao.itemcats.get&format=json&v=2.0',
    expects: 'Missing app key',
  },
  {
    name: 'jd',
    url: 'https://api.jd.com/routerjson?method=jd.union.open.goods.query&v=1.0&format=json',
    expects: 'appkey',
  },
];

async function probe(channel) {
  const runs = await Promise.all(Array.from({ length: 3 }, async () => {
    const startedAt = Date.now();
    try {
      const response = await fetch(channel.url, {
        headers: { 'user-agent': 'DresslyGatewayPOC/0.1 (connectivity only)' },
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.text();
      return {
        ok: response.status === 200 && body.includes(channel.expects),
        status: response.status,
        elapsedMs: Date.now() - startedAt,
        evidence: body.slice(0, 180).replace(/\s+/g, ' '),
      };
    } catch (error) {
      return { ok: false, elapsedMs: Date.now() - startedAt, error: String(error) };
    }
  }));
  return { channel: channel.name, passed: runs.filter((run) => run.ok).length, total: runs.length, runs };
}

const report = {
  generatedAt: new Date().toISOString(),
  scope: '官方网关可达性与鉴权边界；不代表已获得商品数据权限或商品价格准确性。',
  results: await Promise.all(channels.map(probe)),
};

await mkdir(new URL('.', import.meta.url), { recursive: true });
await writeFile(new URL('./report.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
