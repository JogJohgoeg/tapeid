// TapeID · 一键领取（X Layer）：把 IGNIX 税收分配金库分给你电路容器的交易税，结算 → 领到容器 → 转到你的钱包。
// 金库的 sync / claimFor 谁都能调，钱只进收款人；容器转出只有电路持有人能做，每次付容器执行费 EXEC_FEE。每笔先模拟。
import { createPublicClient, createWalletClient, custom, encodeFunctionData, decodeFunctionResult, formatEther, getAddress, http, parseAbi, toHex } from 'viem';
import { xLayer } from 'viem/chains';
import { scanHoldings } from './holdings.js';
import { buybackSafe } from './buyback_safe.js';

const HEX = '0xc4';
const API = 'https://api.ignix.bot';
const SIM_RPC = 'https://xlayer.drpc.org';          // 支持 eth_simulateV1
const VAULT = parseAbi(['function recipients() view returns (address[])', 'function recipientBps() view returns (uint16[])',
  'function claimable(address) view returns (uint256)', 'function sync()', 'function claimFor(address)']);
const ACCT = parseAbi(['function execute(address to, uint256 value, bytes data, uint8 operation) payable returns (bytes)',
  'function EXEC_FEE() view returns (uint256)', 'function owner() view returns (address)']);

const zh = {
  title: '一键领取交易税', lead: '在 IGNIX 发过 TapeID 币？把分给你电路容器的交易税，一键结算、领到容器、再转进你的钱包。',
  connect: '连接钱包（X Layer）', connected: '已连接 {a} · {b} OKB', noWallet: '没检测到钱包。请安装 OKX 钱包或 MetaMask，手机请在 OKX App 浏览器里打开。',
  scanning: '正在找你的电路容器和对应的金库…', none: '没找到分钱给你电路容器的 IGNIX 金库。先用 TapeID 给你的 X Layer 电路发一个币。',
  coin: '币', container: '电路容器', pending: '可领', inBox: '容器里已有', total: '可转到钱包',
  claimBtn: '一键领取到钱包', notOpened: '这个容器还没开通，开通后才能转出（开通费 0.08 OKB，由电路持有人在 TapeOut 上操作）。',
  notOwner: '你不是这个电路的持有人，不能从容器转出。', step1: '① 结算金库', step2: '② 领到电路容器', step3: '③ 从容器转到你的钱包（执行费 {f} OKB）',
  sim: '模拟通过，请在钱包确认…', sent: '已发送', done: '完成', allDone: '已领到你的钱包：{v} OKB', nothing: '暂时没有可领的',
  feeNote: '每次从容器转出要付 {f} OKB 执行费（归 TapeOut）。金额很小时可以攒一攒再领。',
  safeNote: '20% 回购那份进的是你的回购 Safe {s}，钱安全地留在那里，等你要回购时部署 Safe 再用。本页不转它。',
  refresh: '刷新', lang: 'EN', err: '出错了：{m}', rejected: '你在钱包里取消了。',
};
const en = {
  title: 'Claim trading tax in one click', lead: 'Launched a TapeID coin on IGNIX? Settle the tax owed to your circuit container, claim it into the container, then move it to your wallet — one click.',
  connect: 'Connect wallet (X Layer)', connected: 'Connected {a} · {b} OKB', noWallet: 'No wallet found. Install OKX Wallet or MetaMask; on a phone open this page in the OKX app browser.',
  scanning: 'Finding your circuit containers and their vaults…', none: 'No IGNIX vault pays your circuit containers yet. Launch a TapeID coin for your X Layer circuit first.',
  coin: 'Coin', container: 'Circuit container', pending: 'Claimable', inBox: 'Already in container', total: 'To your wallet',
  claimBtn: 'Claim to my wallet', notOpened: 'This container is not open yet; open it on TapeOut first (0.08 OKB, circuit holder only).',
  notOwner: 'You do not hold this circuit, so you cannot move funds out of its container.', step1: '① Settle the vault', step2: '② Claim into the circuit container', step3: '③ Move from container to your wallet (exec fee {f} OKB)',
  sim: 'Dry run passed, confirm in your wallet…', sent: 'Sent', done: 'Done', allDone: 'Sent to your wallet: {v} OKB', nothing: 'Nothing to claim yet',
  feeNote: 'Each move out of a container costs a {f} OKB exec fee (to TapeOut). For tiny amounts, wait and claim later.',
  safeNote: 'The 20% buyback share goes to your buyback Safe {s}; it stays there safely until you deploy the Safe to buy back. This page does not move it.',
  refresh: 'Refresh', lang: '中文', err: 'Something went wrong: {m}', rejected: 'You cancelled in the wallet.',
};
let lang = 'zh';
try { lang = localStorage.getItem('tapeid-lang') || ((navigator.language || '').startsWith('zh') ? 'zh' : 'en'); } catch {}
const t = (k, v = {}) => ((lang === 'en' ? en : zh)[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? `{${x}}`);
const $ = (id) => document.getElementById(id);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const okb = (w) => { const v = Number(formatEther(w)); return v === 0 ? '0' : v < 0.0001 ? v.toPrecision(2) : v.toFixed(5); };
const S = { account: null, wallet: null, pub: null, sim: createPublicClient({ chain: xLayer, transport: http(SIM_RPC) }), rows: [] };

function i18n() { for (const el of document.querySelectorAll('[data-i]')) el.innerHTML = t(el.dataset.i); }
function toast(m, kind = '') { const e = $('toast'); e.textContent = m; e.className = `toast show ${kind}`; clearTimeout(toast.h); toast.h = setTimeout(() => { e.className = 'toast'; }, 6000); }
function errText(e) { const m = e?.shortMessage || e?.message || String(e); return e?.code === 4001 || /reject|denied|cancel/i.test(m) ? t('rejected') : t('err', { m }); }
const guard = (f) => async (...a) => { try { await f(...a); } catch (e) { console.error(e); toast(errText(e), 'bad'); } };

async function ensureChain() {
  const p = window.ethereum;
  if ((await p.request({ method: 'eth_chainId' })) === HEX) return;
  try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: HEX }] }); } catch (e) {
    if (e.code !== 4902) throw e;
    await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: HEX, chainName: 'X Layer', nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
      rpcUrls: ['https://rpc.xlayer.tech'], blockExplorerUrls: ['https://www.oklink.com/xlayer'] }] });
  }
}

// 预演 sync 之后每个容器在该金库的可领金额（不上链）
async function previewClaimable(vault, containers) {
  const calls = [{ to: vault, data: encodeFunctionData({ abi: VAULT, functionName: 'sync' }) },
    ...containers.map((c) => ({ to: vault, data: encodeFunctionData({ abi: VAULT, functionName: 'claimable', args: [c] }) }))];
  const r = await S.sim.request({ method: 'eth_simulateV1', params: [{ blockStateCalls: [{ calls }], validation: false }, 'latest'] });
  return containers.map((_, i) => (r[0].calls[i + 1].status === '0x1' ? decodeFunctionResult({ abi: VAULT, functionName: 'claimable', data: r[0].calls[i + 1].returnData }) : 0n));
}

async function connect() {
  if (!window.ethereum) { $('noWallet').hidden = false; return; }
  const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  await ensureChain();
  S.account = getAddress(a);
  S.wallet = createWalletClient({ account: S.account, chain: xLayer, transport: custom(window.ethereum) });
  S.pub = createPublicClient({ chain: xLayer, transport: custom(window.ethereum) });
  $('connected').textContent = t('connected', { a: short(S.account), b: okb(await S.pub.getBalance({ address: S.account })) });
  $('connected').hidden = false;
  $('connect').hidden = true;
  const safe = await buybackSafe(S.pub, S.account);
  $('safeNote').innerHTML = t('safeNote', { s: `<span class="mono">${short(safe.address)}</span>` });
  await load();
}

async function load() {
  $('state').textContent = t('scanning'); $('state').hidden = false; $('rows').innerHTML = ''; $('none').hidden = true;
  const [{ items }, refs] = await Promise.all([scanHoldings(S.account, null, ['xlayer']),
    fetch(`${API}/v1/me/tax-distribution-refs?address=${S.account}`).then((r) => r.json()).then((j) => j.data?.launches || [])]);
  const mine = new Map(items.filter((x) => x.container).map((x) => [x.container.toLowerCase(), x]));
  const vaults = refs.filter((r) => r.templateId === 2 && r.taxRouter);
  const rec = vaults.length ? await S.pub.multicall({ allowFailure: true, contracts: vaults.map((v) => ({ address: v.taxRouter, abi: VAULT, functionName: 'recipients' })) }) : [];
  const hits = [];
  vaults.forEach((v, i) => {
    const addrs = rec[i]?.status === 'success' ? rec[i].result : [];
    for (const a of addrs) { const x = mine.get(a.toLowerCase()); if (x) hits.push({ vault: getAddress(v.taxRouter), token: getAddress(v.tokenAddress), symbol: v.symbol, circuit: x }); }
  });
  S.rows = [];
  for (const h of hits) {
    const [pending] = await previewClaimable(h.vault, [h.circuit.container]);
    const [inBox, fee, owner] = await Promise.all([S.pub.getBalance({ address: h.circuit.container }),
      S.pub.readContract({ address: h.circuit.container, abi: ACCT, functionName: 'EXEC_FEE' }).catch(() => null),
      S.pub.readContract({ address: h.circuit.container, abi: ACCT, functionName: 'owner' }).catch(() => null)]);
    S.rows.push({ ...h, pending, inBox, fee, owner });
  }
  $('state').hidden = true;
  if (!S.rows.length) { $('none').hidden = false; return; }
  render();
}

function render() {
  const fee = S.rows.find((r) => r.fee != null)?.fee;
  $('feeNote').textContent = fee != null ? t('feeNote', { f: okb(fee) }) : '';
  // 同一容器可能有多枚币：按容器合并转出，只付一次执行费
  $('rows').innerHTML = S.rows.map((r, i) => {
    const opened = r.circuit.opened && r.fee != null;
    const isOwner = r.owner && r.owner.toLowerCase() === S.account.toLowerCase();
    const total = r.pending + r.inBox;
    const warn = !opened ? t('notOpened') : !isOwner ? t('notOwner') : '';
    return `<section class="row">
      <div class="head"><b>$${r.symbol}</b> <span class="dim">TapeID ${r.circuit.tapeId}</span></div>
      <table><tr><td class="dim">${t('coin')}</td><td class="mono">${short(r.token)}</td></tr>
        <tr><td class="dim">${t('container')}</td><td class="mono">${short(r.circuit.container)}</td></tr>
        <tr><td class="dim">${t('pending')}</td><td>${okb(r.pending)} OKB</td></tr>
        <tr><td class="dim">${t('inBox')}</td><td>${okb(r.inBox)} OKB</td></tr>
        <tr><td class="dim">${t('total')}</td><td><b>${okb(total)} OKB</b></td></tr></table>
      ${warn ? `<p class="note">${warn}</p>` : ''}
      <ol class="steps" id="steps${i}" hidden><li>${t('step1')}</li><li>${t('step2')}</li><li>${t('step3', { f: okb(r.fee ?? 0n) })}</li></ol>
      <button class="big" data-claim="${i}" ${!warn && total > (r.fee ?? 0n) ? '' : 'disabled'}>${total > 0n ? t('claimBtn') : t('nothing')}</button>
    </section>`;
  }).join('');
}

async function send(req, li) {
  const { request } = await S.pub.simulateContract({ ...req, account: S.account, chain: xLayer });
  li.textContent += ` · ${t('sim')}`;
  const hash = await S.wallet.writeContract(request);
  li.innerHTML += ` · ${t('sent')} <a href="https://www.oklink.com/xlayer/tx/${hash}" target="_blank" rel="noopener">${hash.slice(0, 10)}…</a>`;
  const rc = await S.pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error('tx reverted');
  li.innerHTML += ` · ✓ ${t('done')}`; li.className = 'ok';
}

async function claimRow(i) {
  const r = S.rows[i];
  await ensureChain();
  const btn = document.querySelector(`[data-claim="${i}"]`);
  btn.disabled = true;
  const steps = $(`steps${i}`); steps.hidden = false;
  const [s1, s2, s3] = steps.querySelectorAll('li');
  try {
    // ① 结算：只有有未结算的钱时才需要
    const settled = await S.pub.readContract({ address: r.vault, abi: VAULT, functionName: 'claimable', args: [r.circuit.container] });
    if (r.pending > settled) await send({ address: r.vault, abi: VAULT, functionName: 'sync' }, s1); else { s1.className = 'ok'; s1.textContent += ' · —'; }
    // ② 领到容器
    const now = await S.pub.readContract({ address: r.vault, abi: VAULT, functionName: 'claimable', args: [r.circuit.container] });
    if (now > 0n) await send({ address: r.vault, abi: VAULT, functionName: 'claimFor', args: [r.circuit.container] }, s2); else { s2.className = 'ok'; s2.textContent += ' · —'; }
    // ③ 容器里全部 OKB 转给你（附执行费）
    const bal = await S.pub.getBalance({ address: r.circuit.container });
    const fee = await S.pub.readContract({ address: r.circuit.container, abi: ACCT, functionName: 'EXEC_FEE' });
    await send({ address: r.circuit.container, abi: ACCT, functionName: 'execute', args: [S.account, bal, '0x', 0], value: fee }, s3);
    toast(t('allDone', { v: okb(bal) }), 'ok');
    await load();
  } catch (e) {
    // 失败或取消：保留已完成的步骤记录，按钮恢复，可以接着点（已完成的步骤会自动跳过）
    btn.disabled = false;
    throw e;
  }
}

$('lang').onclick = () => { lang = lang === 'zh' ? 'en' : 'zh'; try { localStorage.setItem('tapeid-lang', lang); } catch {} i18n(); if (S.rows.length) render(); };
$('connect').onclick = guard(connect);
$('refresh').onclick = guard(load);
$('rows').onclick = (e) => { const b = e.target.closest('[data-claim]'); if (b) guard(claimRow)(Number(b.dataset.claim)); };
if (window.ethereum) { window.ethereum.on?.('accountsChanged', () => location.reload()); window.ethereum.on?.('chainChanged', () => location.reload()); }
i18n();
