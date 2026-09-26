// IGNIX（X Layer 官方发币平台）发币：税收分配金库（templateId 2），收款人与比例在发币时锁死。
// 流程与 ignix.bot 前端一致：challenge → 钱包签消息（不花钱）→ /v1/ignix/sign 取平台签名 → createToken。
// 服务器返回的每个参数都在本地逐项核对，不一致就拒绝发送；发完再读金库合约核对收款人。
import { createPublicClient, decodeEventLog, decodeFunctionResult, encodeFunctionData, getAddress, http, toHex, zeroAddress } from 'viem';
import { xLayer } from 'viem/chains';
import ABI from './ignix_abi.json';

export const API = 'https://api.ignix.bot';
export const MANAGER = '0x96b51c57e5346d0c0198899243cf851d1e23c309';
export const TEMPLATE_DISTRIBUTION = 2;
export const tokenUrl = (t) => `https://ignix.bot/launch?token=${t}`;
const VAULT_ABI = [
  { type: 'function', name: 'recipients', stateMutability: 'view', inputs: [], outputs: [{ type: 'address[]' }] },
  { type: 'function', name: 'recipientBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16[]' }] },
];

async function post(path, body) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!j || j.code !== 200) throw new Error(`ignix-${j?.errorCode || j?.message || r.status}`);
  return j.data;
}

// 把正方形 logo 转成 IGNIX 要的 data URL（它的前端也是裁成正方形后直接放进 meta.image）
export async function logoDataUrl(url, size = 512) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL('image/png');
}

// 取平台签名并核对；返回可直接发送的交易请求（已在链上模拟通过）。
export async function prepareLaunch({ wallet, pub, account: acct, name, symbol, meta, taxBps, recipients }) {
  // acct 可以是地址（浏览器钱包签名）或本地账户对象（测试用）
  const account = typeof acct === 'string' ? acct : acct.address;
  const ch = await post('/v1/creator/challenge', { creator: account, purpose: 'create-token' });
  const creatorSignature = await wallet.signMessage({ account: acct, message: ch.message });
  const want = {
    creator: account, nonce: ch.nonce, creatorSignature, name, symbol, quote: 'OKB',
    graduationProtectionDays: 100, taxEnabled: true, taxBuyBps: taxBps, taxSellBps: taxBps, dividendBps: 0,
    snipeStartBps: 0, snipeMins: 0, firstBuy: '0', meta, templateId: TEMPLATE_DISTRIBUTION,
    taxRecipients: recipients.map((r) => ({ address: getAddress(r.address), bps: r.bps })),
  };
  const d = await post('/v1/ignix/sign', want);
  const k = d.params;
  const bad = [
    k.name !== name && 'name', k.symbol !== symbol && 'symbol', k.quote.toLowerCase() !== zeroAddress && 'quote',
    Number(k.taxBuyBps) !== taxBps && 'taxBuyBps', Number(k.taxSellBps) !== taxBps && 'taxSellBps',
    Number(k.snipeStartBps) !== 0 && 'snipe', BigInt(k.firstBuy) !== 0n && 'firstBuy',
    Number(d.templateId) !== TEMPLATE_DISTRIBUTION && 'templateId',
  ].filter(Boolean);
  if (bad.length) throw new Error(`ignix-params-mismatch:${bad.join(',')}`);
  const value = BigInt(k.listingFee) + BigInt(k.firstBuy);
  const args = [[k.name, k.symbol, k.metadataURI, k.salt, k.quote, BigInt(k.graduation), k.buyFeeBps, k.sellFeeBps, k.taxBuyBps,
    k.taxSellBps, k.snipeStartBps, k.snipeMins, BigInt(k.listingFee), BigInt(k.firstBuy), k.founderBps, k.founderSecs, k.founderRoot],
    d.templateId ?? 0, d.vaultData ?? '0x', BigInt(d.deadline), d.factory, d.venue, BigInt(d.graduationProtectionSecs), d.signature];
  const { request } = await pub.simulateContract({ account: acct, address: MANAGER, abi: ABI, functionName: 'createToken', args, value, chain: xLayer });
  const predicted = getAddress(d.tokenAddress);
  const vault = await previewVault({ from: account, args, value, predicted });
  const same = vault.recipients.length === recipients.length && recipients.every((r) =>
    vault.recipients.some((v) => v.address.toLowerCase() === r.address.toLowerCase() && v.bps === r.bps));
  if (!same) throw new Error(`ignix-vault-mismatch:${JSON.stringify(vault.recipients)}`);
  return { request, predicted, vault, listingFee: BigInt(k.listingFee), curveFeeBps: Number(k.buyFeeBps) };
}

// 发币前预演：在同一次模拟里 createToken → vaultOf → 读金库收款人与比例（需要支持 eth_simulateV1 的节点）。
const SIM_RPC = 'https://xlayer.drpc.org';
async function previewVault({ from, args, value, predicted }) {
  const sim = createPublicClient({ chain: xLayer, transport: http(SIM_RPC) });
  const create = { from, to: MANAGER, data: encodeFunctionData({ abi: ABI, functionName: 'createToken', args }), value: toHex(value) };
  const run = (calls) => sim.request({ method: 'eth_simulateV1', params: [{ blockStateCalls: [{
    stateOverrides: { [from]: { balance: toHex(10n ** 18n + value) } }, calls }], validation: false }, 'latest'] });
  const r1 = await run([create, { to: MANAGER, data: encodeFunctionData({ abi: ABI, functionName: 'vaultOf', args: [predicted] }) }]);
  if (r1[0].calls[0].status !== '0x1') throw new Error('ignix-preview-create-reverted');
  const vault = decodeFunctionResult({ abi: ABI, functionName: 'vaultOf', data: r1[0].calls[1].returnData });
  const r2 = await run([create, ...['recipients', 'recipientBps'].map((fn) => ({ to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: fn }) }))]);
  const addrs = decodeFunctionResult({ abi: VAULT_ABI, functionName: 'recipients', data: r2[0].calls[1].returnData });
  const bps = decodeFunctionResult({ abi: VAULT_ABI, functionName: 'recipientBps', data: r2[0].calls[2].returnData });
  return { vault, recipients: addrs.map((a, i) => ({ address: getAddress(a), bps: Number(bps[i]) })) };
}

// 发送并核对：TokenCreated 地址 == 预测地址；金库收款人 / 比例 == 我们要的。
export async function sendLaunch({ wallet, pub, prep, recipients }) {
  const hash = await wallet.writeContract(prep.request);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error('createToken-reverted');
  let token = null;
  for (const l of rc.logs) {
    try { const e = decodeEventLog({ abi: ABI, data: l.data, topics: l.topics }); if (e.eventName === 'TokenCreated') { token = getAddress(e.args.token); break; } } catch {}
  }
  if (!token || token !== prep.predicted) throw new Error('token-address-mismatch');
  const vault = await pub.readContract({ address: MANAGER, abi: ABI, functionName: 'vaultOf', args: [token] });
  const [addrs, bps] = await Promise.all(['recipients', 'recipientBps'].map((fn) => pub.readContract({ address: vault, abi: VAULT_ABI, functionName: fn })));
  const ok = addrs.length === recipients.length && recipients.every((r, i) =>
    addrs.some((a, j) => a.toLowerCase() === r.address.toLowerCase() && Number(bps[j]) === r.bps) && i >= 0);
  return { hash, token, vault, recipients: addrs.map((a, i) => ({ address: a, bps: Number(bps[i]) })), ok };
}
