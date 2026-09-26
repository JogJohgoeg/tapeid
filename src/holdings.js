// 自动识别钱包拥有的 TapeOut 电路及其容器（BSC / X Layer / Base），全部是只读 multicall。
// 做法：逐台处理器查 Circuits.balanceOf(钱包) → 有持仓的再批量 ownerOf(0..nextId-1) → 读 circuitInfo 与容器地址。
// 不扫日志：Circuits 没有 tokenOfOwnerByIndex，而全链 Transfer 日志扫描在公共节点上太重。
import { createPublicClient, getAddress, http } from 'viem';
import { base, bsc, xLayer } from 'viem/chains';

// tag = TapeID 中间的链号（BSC 为空，两段式：电路号.处理器号）
export const CHAINS = [
  { key: 'base', name: 'Base', chain: base, tag: 3, rpc: 'https://base-rpc.publicnode.com',
    factory: '0x1f09daefa827f02cbb40967cc91b259763760761', opener: '0x536add8f30f03b69f6fbf29d425a816a0dc50106',
    nftUrl: (c, id) => `https://basescan.org/nft/${c}/${id}` },
  { key: 'bsc', name: 'BNB Chain', chain: bsc, tag: null, rpc: 'https://bsc-dataseed.binance.org',
    factory: '0x68224F668083c29e9800Be2a646d42d18cedF7e2', opener: '0x021745de2f42a7839d96f2d3634d0294487d81f1',
    nftUrl: (c, id) => `https://bscscan.com/nft/${c}/${id}` },
  { key: 'xlayer', name: 'X Layer', chain: xLayer, tag: 2, rpc: 'https://rpc.xlayer.tech',
    factory: '0x1f09daefa827f02cbb40967cc91b259763760761', opener: '0x536add8f30f03b69f6fbf29d425a816a0dc50106',
    nftUrl: (c, id) => `https://www.oklink.com/xlayer/token/${c}?a=${id}` },
];

const fn = (name, inputs, outputs) => ({ type: 'function', name, stateMutability: 'view',
  inputs: inputs.map((type) => ({ type })), outputs: outputs.map((type) => ({ type })) });
const FACTORY = [fn('cpuCount', [], ['uint256']), fn('cpuAt', ['uint256'], ['address'])];
const CIRCUITS = [fn('balanceOf', ['address'], ['uint256']), fn('nextId', [], ['uint256']), fn('ownerOf', ['uint256'], ['address']),
  fn('circuitInfo', ['uint256'], ['uint32', 'uint32', 'uint32', 'uint32'])];
const OPENER = [fn('accountOf', ['address', 'uint256'], ['address']), fn('isOpened', ['address', 'uint256'], ['bool'])];

const BATCH = 400;
const PARALLEL = 4;
async function mc(pub, calls) {
  const parts = [];
  for (let i = 0; i < calls.length; i += BATCH) parts.push(calls.slice(i, i + BATCH));
  const res = new Array(parts.length);
  let next = 0;
  const worker = async () => {
    while (next < parts.length) {
      const k = next++;
      let r = null;
      for (let t = 0; t < 3 && !r; t++) {
        try { r = await pub.multicall({ contracts: parts[k], allowFailure: true }); }
        catch (e) { if (t === 2) throw e; await new Promise((s) => setTimeout(s, 500 * (t + 1))); }
      }
      res[k] = r.map((x) => (x.status === 'success' ? x.result : null));
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, parts.length) }, worker));
  return res.flat();
}

export const tapeIdOf = (cfg, circuitId, cpuIndex) =>
  cfg.tag == null ? `${circuitId}.${cpuIndex}` : `${circuitId}.${cfg.tag}.${cpuIndex}`;

async function scanChain(cfg, owner, onProgress) {
  const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) });
  const n = Number(await pub.readContract({ address: cfg.factory, abi: FACTORY, functionName: 'cpuCount' }));
  const idx = [...Array(n).keys()];
  const cpus = await mc(pub, idx.map((i) => ({ address: cfg.factory, abi: FACTORY, functionName: 'cpuAt', args: [BigInt(i)] })));
  const bals = await mc(pub, cpus.map((c) => ({ address: c, abi: CIRCUITS, functionName: 'balanceOf', args: [owner] })));
  const held = idx.filter((i) => cpus[i] && bals[i] > 0n);
  onProgress?.(`${cfg.name}：${n} 台处理器，其中 ${held.length} 台上有你的电路`);

  // 所有有持仓的处理器合并成大批量：nextId → ownerOf → circuitInfo / 容器（nextId 是最后一个电路的编号，含它本身）
  const nexts = await mc(pub, held.map((i) => ({ address: cpus[i], abi: CIRCUITS, functionName: 'nextId' })));
  const pairs = held.flatMap((i, k) => [...Array(Number(nexts[k] ?? 0n) + 1).keys()].map((id) => [getAddress(cpus[i]), i, id]));
  const owners = await mc(pub, pairs.map(([c, , id]) => ({ address: c, abi: CIRCUITS, functionName: 'ownerOf', args: [BigInt(id)] })));
  const mine = pairs.filter((_, k) => owners[k] && getAddress(owners[k]) === owner);
  const r = await mc(pub, mine.flatMap(([c, , id]) => [
    { address: c, abi: CIRCUITS, functionName: 'circuitInfo', args: [BigInt(id)] },
    { address: cfg.opener, abi: OPENER, functionName: 'accountOf', args: [c, BigInt(id)] },
    { address: cfg.opener, abi: OPENER, functionName: 'isOpened', args: [c, BigInt(id)] },
  ]));
  const items = mine.map(([circuits, i, id], k) => {
    const [info, container, opened] = r.slice(3 * k, 3 * k + 3);
    return {
      chainKey: cfg.key, chainName: cfg.name, chainId: cfg.chain.id, cpuIndex: i, circuits, circuitId: id,
      tapeId: tapeIdOf(cfg, id, i),
      nIn: info ? Number(info[0]) : null, nOut: info ? Number(info[1]) : null,
      nState: info ? Number(info[2]) : null, gates: info ? Number(info[3]) : null,
      container: container ? getAddress(container) : null, opened: opened === true,
      nftUrl: cfg.nftUrl(circuits, id),
    };
  });
  onProgress?.(`${cfg.name}：你拥有 ${items.length} 个电路`);
  return items;
}

// 三条链并行扫；某条链失败不影响其它链，失败原因放进 errors。
// only：只扫这些链（CHAINS 的 key），默认全扫。
export async function scanHoldings(owner, onProgress, only = null) {
  const o = getAddress(owner);
  const chains = only ? CHAINS.filter((c) => only.includes(c.key)) : CHAINS;
  const res = await Promise.allSettled(chains.map((c) => scanChain(c, o, onProgress)));
  const items = [], errors = [];
  res.forEach((r, k) => (r.status === 'fulfilled' ? items.push(...r.value)
    : errors.push(`${chains[k].name}：${r.reason?.shortMessage || r.reason?.message || r.reason}`)));
  return { items, errors };
}
