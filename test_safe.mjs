// 只读验证回购 Safe 地址算法（Base 主网）：算出的地址 == 工厂 createProxyWithNonce 的 eth_call 结果。
import { createPublicClient, http, getAddress } from 'viem';
import { base } from 'viem/chains';
import { buybackSafe, SALT_LABEL } from './src/buyback_safe.js';
const pub = createPublicClient({ chain: base, transport: http('https://base-rpc.publicnode.com') });
for (const o of ['0xc9059e0f59f40920e5bd24307eaa4defd81df145', '0x571d447f4f24688eC35Ccf07f1D6993655F6aF15']) {
  const r = await buybackSafe(pub, getAddress(o));
  console.log(SALT_LABEL, 'owner', getAddress(o), '→', r.address, r.deployed ? '(已部署)' : '(未部署，地址已与工厂模拟核对一致)');
}
