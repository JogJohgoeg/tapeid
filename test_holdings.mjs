// 只读验证：扫描钱包在 BSC / X Layer / Base 上拥有的电路与容器。
import { scanHoldings } from './src/holdings.js';
const who = process.argv[2] || '0xc9059e0f59f40920e5bd24307eaa4defd81df145';
const t0 = Date.now();
const { items, errors } = await scanHoldings(who, (m) => console.log('  ·', m));
console.log(`共 ${items.length} 个电路，用时 ${((Date.now() - t0) / 1000).toFixed(1)} s`, errors.length ? errors : '');
for (const x of items.filter((x) => ['279.732', '282.732'].includes(x.tapeId) || x.chainKey !== 'bsc').slice(0, 12))
  console.log(x.tapeId, x.chainName, `${x.nIn}入/${x.nOut}出/${x.gates}门`, 'container', x.container, x.opened ? '已开通' : '未开通');
