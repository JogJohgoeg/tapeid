// 发币配置与链上读写（与界面无关）：Clanker v4 / Base，手续费 80% 作者 / 20% BEM 回购。
import { getAddress } from 'viem';
import { base } from 'viem/chains';
import { publicActionsL2 } from 'viem/op-stack';
import { FEE_CONFIGS, POOL_POSITIONS, WETH_ADDRESSES, clankerConfigFor } from 'clanker-sdk';

export const AUTHOR_BPS = 8000;
export const BUYBACK_BPS = 2000;
export const WETH = WETH_ADDRESSES[base.id];
export const FEE_LOCKER = clankerConfigFor(base.id, 'clanker_v4').related.feeLocker;
export const DEFAULT_LOGO = 'https://nand.aihashrate.stream/tapeid/tapeid-default.png';
export const DEFAULT_SYMBOL = 'TAPEID';

// 已有专门名字 / 图片 / 网站的电路；其余按链上数据自动生成。
export const KNOWN = {
  '279.732': {
    name: '21 NAND Driver', image: 'https://nand.aihashrate.stream/tapeid/21-nand-driver.png', site: 'https://nand.aihashrate.stream/',
    blurb: { zh: '只用 21 个 NAND 门开车的小车控制器。', en: 'A car controller that drives with just 21 NAND gates.' },
  },
};

// 由电路（holdings.js 的一项）生成默认代币参数。
export function defaultsFor(x, lang) {
  const k = KNOWN[x.tapeId] || {};
  const name = k.name || `TapeID ${x.tapeId}`;
  const shape = `${x.nIn} in / ${x.nOut} out / ${x.gates} gates${x.nState ? ` / ${x.nState} state bits` : ''}`;
  const desc = lang === 'en'
    ? `${name} (TapeID ${x.tapeId}): TapeOut circuit #${x.circuitId} on ${x.chainName} processor #${x.cpuIndex}, ${shape}, taped out on-chain. ${k.blurb?.en || ''}`
      + `${x.container ? `Circuit container ${x.container} (${x.chainName}). ` : ''}Trading fees: 80% to the author, 20% buys back $BEM.`
    : `${name}（TapeID ${x.tapeId}）：TapeOut 电路 #${x.circuitId}（${x.chainName} 处理器 #${x.cpuIndex}），`
      + `${x.nIn} 入 / ${x.nOut} 出 / ${x.gates} 门${x.nState ? ` / ${x.nState} 位状态` : ''}，已流片上链。${k.blurb?.zh || ''}`
      + `${x.container ? `电路容器 ${x.container}（${x.chainName}）。` : ''}交易手续费 80% 归作者，20% 回购 $BEM。`;
  return { name, symbol: DEFAULT_SYMBOL, image: k.image || DEFAULT_LOGO, site: k.site || x.nftUrl, desc };
}

// Base 上的电路：80% 直接进它的容器；其它链的容器不在 Base，80% 进钱包。
export const authorFor = (x, account) => (x.chainKey === 'base' && x.container ? x.container : account);

export function buildConfig({ account, author, buyback, name, symbol, image, desc, site, handle, devBuyEth }) {
  if (!account) throw new Error('need-wallet');
  if (!name || !symbol) throw new Error('need-name');
  if (!buyback) throw new Error('need-buyback');
  // ClankerFeeLocker 只按 收款地址+币种 记账：两份同一地址会合并，20% 回购就无法单独核对。
  if (getAddress(buyback) === getAddress(author)) throw new Error('same-address');
  const h = (handle || '').trim().replace(/^@/, '');
  const socials = [];
  if (site) socials.push({ platform: 'website', url: site });
  if (h) socials.push({ platform: 'x', url: `https://x.com/${h}` });
  const cfg = {
    chainId: base.id, name, symbol, image, tokenAdmin: account,
    metadata: { description: `${desc} BEM buyback: ${getAddress(buyback)}`, socialMediaUrls: socials },
    context: { interface: 'TapeID Launch', platform: h ? 'X' : '', messageId: '', id: h },
    pool: { pairedToken: WETH, positions: POOL_POSITIONS.Standard },
    fees: FEE_CONFIGS.StaticBasic,
    rewards: { recipients: [
      { recipient: getAddress(author), admin: account, bps: AUTHOR_BPS, token: 'Paired' },
      { recipient: getAddress(buyback), admin: account, bps: BUYBACK_BPS, token: 'Paired' },
    ] },
    vanity: false,
  };
  const d = Number(devBuyEth || 0);
  if (!(d >= 0)) throw new Error('bad-devbuy');
  if (d > 0) cfg.devBuy = { ethAmount: d, recipient: account };
  return cfg;
}

// 发币总费用（Base 执行 gas + L1 数据费）+ 首笔买入，单位 wei。估算失败返回 null。
export async function estimateCost(pub, clanker, cfg, account) {
  const tx = await clanker.getDeployTransaction(cfg);
  const l2 = pub.extend(publicActionsL2());
  const fee = await l2.estimateContractTotalFee({ ...tx, account, chain: base });
  return fee + (tx.value ?? 0n);
}

const FEE_LOCKER_ABI = [
  { type: 'function', name: 'availableFees', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [] },
];
export const claimable = (pub, owner) =>
  pub.readContract({ address: FEE_LOCKER, abi: FEE_LOCKER_ABI, functionName: 'availableFees', args: [owner, WETH] });
export const claim = (wallet, account, owner) =>
  wallet.writeContract({ address: FEE_LOCKER, abi: FEE_LOCKER_ABI, functionName: 'claim', args: [owner, WETH], account, chain: base });
