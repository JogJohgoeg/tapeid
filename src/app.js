// TapeID 发币向导：连接钱包 → 选电路 → 看看你的币 → 发币 → 分享和收钱。
// 不含自有合约；每笔交易都由用户钱包签名。技术细节收在「高级设置」里。
import { createPublicClient, createWalletClient, custom, formatEther, getAddress, isAddress } from 'viem';
import { base } from 'viem/chains';
import { Clanker } from 'clanker-sdk/v4';
import { buybackSafe } from './buyback_safe.js';
import { scanHoldings } from './holdings.js';
import { AUTHOR_BPS, BUYBACK_BPS, DEFAULT_LOGO, KNOWN, authorFor, buildConfig, claim, claimable, defaultsFor, estimateCost } from './launch.js';
import { lang, setLang, t } from './i18n.js';

const BASE_HEX = '0x2105';
const PAGE = 24;
const $ = (id) => document.getElementById(id);
const S = { account: null, wallet: null, pub: null, clanker: null, buyback: null, items: [], shown: PAGE, sel: null, author: null,
  checksOk: false, checkSeq: 0, token: null };
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eth4 = (wei) => { const v = Number(formatEther(wei)); return v === 0 ? '0' : v < 0.0001 ? v.toPrecision(2) : v.toFixed(5); };

// ---------- 通用 ----------
function applyI18n() {
  document.documentElement.lang = lang() === 'en' ? 'en' : 'zh-CN';
  for (const el of document.querySelectorAll('[data-i]')) el.innerHTML = t(el.dataset.i);
  for (const el of document.querySelectorAll('[data-ph]')) el.placeholder = t(el.dataset.ph);
}

function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => { el.className = 'toast'; }, 5000);
}

function errText(e) {
  const m = e?.message || String(e);
  if (e?.code === 4001 || /reject|denied|cancel/i.test(m)) return t('err_rejected');
  const key = `err_${m.replace(/-/g, '_')}`;
  const tr = t(key);
  return tr !== key ? tr : t('err_generic', { msg: e?.shortMessage || m });
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { console.error(e); toast(errText(e), 'bad'); } };

function step(n) {
  for (let i = 1; i <= 5; i++) {
    $(`st${i}`).hidden = i > n && !(i === 5 && S.token);
    $(`dot${i}`).className = i < n ? 'done' : i === n ? 'now' : '';
  }
}

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch { return; }
  const old = btn.textContent;
  btn.textContent = t('copied');
  setTimeout(() => { btn.textContent = old; }, 1500);
}

function eth() {
  if (!window.ethereum) throw new Error('no-wallet');
  return window.ethereum;
}

async function ensureBase() {
  const p = eth();
  if ((await p.request({ method: 'eth_chainId' })) === BASE_HEX) return;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_HEX }] });
  } catch (e) {
    if (e.code !== 4902) throw e;
    await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: BASE_HEX, chainName: 'Base',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'] }] });
  }
}

// ---------- ① 连接钱包 ----------
async function connect() {
  if (!window.ethereum) { $('noWallet').hidden = false; return; }
  const btn = $('connect');
  btn.disabled = true;
  btn.textContent = t('connecting');
  try {
    const p = eth();
    const [a] = await p.request({ method: 'eth_requestAccounts' });
    await ensureBase();
    S.account = getAddress(a);
    S.wallet = createWalletClient({ account: S.account, chain: base, transport: custom(p) });
    S.pub = createPublicClient({ chain: base, transport: custom(p) });
    S.clanker = new Clanker({ wallet: S.wallet, publicClient: S.pub });
    $('connected').textContent = t('connected', { addr: short(S.account) });
    $('connected').hidden = false;
    btn.hidden = true;
    step(2);
    renderMyCoins();
    const [safe] = await Promise.all([buybackSafe(S.pub, S.account), scan()]);
    S.buyback = safe.address;
    $('addrBuyback').value = S.buyback;
    if (S.sel) runChecks();
  } finally {
    btn.disabled = false;
    btn.textContent = t('connect');
  }
}

// ---------- ② 选一个电路 ----------
async function scan() {
  $('scanState').textContent = t('scanning');
  $('scanState').hidden = false;
  const { items, errors } = await scanHoldings(S.account);
  errors.forEach((e) => console.warn('scan', e));
  $('scanErr').hidden = !errors.length;
  // 某条链读失败时不能说「没有电路」：给出失败的链和重试按钮
  if (errors.length) $('scanErrText').textContent = t('scanFailed', { chains: errors.map((e) => e.split('：')[0]).join(' / ') });
  const rank = (x) => (KNOWN[x.tapeId] ? 0 : x.chainKey === 'base' ? 1 : 2);
  S.items = items.sort((a, b) => rank(a) - rank(b) || b.circuitId - a.circuitId);
  $('scanState').hidden = true;
  if (!items.length) { $('none').hidden = !!errors.length; return; }
  $('found').textContent = t('found', { n: items.length });
  $('pickerWrap').hidden = false;
  renderCircuits();
}

const nameOf = (x) => KNOWN[x.tapeId]?.name || '';
function renderCircuits() {
  const q = $('search').value.trim().toLowerCase();
  const list = S.items.filter((x) => !q || `${x.tapeId} ${nameOf(x)} ${x.chainName} ${x.gates}`.toLowerCase().includes(q));
  $('circuits').innerHTML = list.slice(0, S.shown).map((x) => `
    <button class="circ${S.sel?.tapeId === x.tapeId ? ' on' : ''}" data-tid="${x.tapeId}" type="button">
      <span class="tid">${x.tapeId}</span>
      ${nameOf(x) ? `<span class="nm">${esc(nameOf(x))}</span>` : ''}
      <span class="meta">${x.chainName} · ${t('gates', { g: x.gates })} · ${t('io', { i: x.nIn, o: x.nOut })}</span>
    </button>`).join('');
  const rest = list.length - S.shown;
  $('more').hidden = rest <= 0;
  $('more').textContent = t('showMore', { n: Math.min(rest, PAGE) });
}

function pick(tid) {
  const x = S.items.find((i) => i.tapeId === tid);
  if (!x) return;
  S.sel = x;
  const d = defaultsFor(x, lang());
  $('name').value = d.name;
  $('symbol').value = d.symbol;
  $('image').value = d.image;
  $('desc').value = d.desc;
  $('site').value = d.site;
  $('pickerWrap').classList.add('picked');
  S.author = authorFor(x, S.account);
  $('addrAuthor').value = S.author;
  renderCircuits();
  renderPreview();
  step(4);
  $('st3').scrollIntoView({ behavior: 'smooth', block: 'start' });
  runChecks();
}

// ---------- ③ 看看你的币 ----------
function renderPreview() {
  const x = S.sel;
  if (!x) return;
  $('pvLogo').src = $('image').value.trim() || DEFAULT_LOGO;
  $('pvName').textContent = $('name').value.trim() || '—';
  $('pvSymbol').textContent = `$${$('symbol').value.trim() || '—'}`;
  $('pvTid').textContent = `TapeID ${x.tapeId} · ${x.chainName}`;
  $('earnYou').innerHTML = S.author !== S.account ? t('earnYouContainer') : t('earnYou');
}

function currentConfig() {
  const sym = $('symbol').value.trim().toUpperCase();
  if (!/^[A-Z]{1,6}$/.test(sym)) throw new Error('symbol');
  return buildConfig({
    account: S.account, author: S.author, buyback: S.buyback,
    name: $('name').value.trim(), symbol: sym, image: $('image').value.trim(), desc: $('desc').value.trim(),
    site: $('site').value.trim(), handle: $('handle').value, devBuyEth: $('devbuy').value.trim() || 0,
  });
}

// ---------- ④ 发币：自动检查网络 / 余额 / 试发 ----------
function mark(id, s, text) {
  const el = $(id);
  el.className = `chk ${s}`;
  if (text != null) el.querySelector('span').textContent = text;
}

async function runChecks() {
  const seq = ++S.checkSeq;
  S.checksOk = false;
  $('launch').disabled = true;
  $('needEth').hidden = true;
  for (const id of ['cNet', 'cGas', 'cSim']) mark(id, 'wait');
  let cfg;
  try { cfg = currentConfig(); } catch (e) { mark('cSim', 'bad', errText(e)); return; }
  $('config').textContent = JSON.stringify(cfg, null, 2);
  if (!S.buyback) return;
  try {
    await ensureBase();
    mark('cNet', 'ok');
    const [bal, cost] = await Promise.all([S.pub.getBalance({ address: S.account }), estimateCost(S.pub, S.clanker, cfg, S.account)]);
    if (seq !== S.checkSeq) return;
    const need = (cost * 3n) / 2n;
    mark('cGas', bal >= need ? 'ok' : 'bad', t(bal >= need ? 'checkGas' : 'checkGasBad', { cost: eth4(cost) }));
    if (bal < need) {
      $('needText').innerHTML = t('needEth', { need: eth4(need - bal) });
      $('myAddr').textContent = S.account;
      $('needEth').hidden = false;
      mark('cSim', 'wait');
      return;
    }
    const r = await S.clanker.deploySimulate(cfg);
    if (seq !== S.checkSeq) return;
    if (r.error) throw r.error;
    mark('cSim', 'ok');
    S.checksOk = true;
    $('launch').disabled = false;
  } catch (e) {
    if (seq !== S.checkSeq) return;
    console.error(e);
    mark('cSim', 'bad', errText(e));
  }
}
let deb;
const recheck = () => { renderPreview(); clearTimeout(deb); deb = setTimeout(runChecks, 600); };

const LS = () => `tapeid-launched:${S.account}`;
function launched() { try { return JSON.parse(localStorage.getItem(LS()) || '[]'); } catch { return []; } }
function remember(rec) { try { localStorage.setItem(LS(), JSON.stringify([rec, ...launched()])); } catch {} }

async function launch() {
  if (!S.checksOk) return;
  const cfg = currentConfig();
  const prev = launched().find((r) => r.tapeId === S.sel.tapeId);
  if (prev && !confirm(t('alreadyLaunched', { token: prev.token }))) return;
  if (!confirm(t('confirmTitle', { name: cfg.name, symbol: cfg.symbol, author: cfg.rewards.recipients[0].recipient, buyback: cfg.rewards.recipients[1].recipient }))) return;
  await ensureBase();
  const btn = $('launch');
  btn.disabled = true;
  btn.textContent = t('launchWait');
  try {
    const { txHash, waitForTransaction, error } = await S.clanker.deploy(cfg);
    if (error) throw error;
    btn.textContent = t('launchSent');
    $('txLink').innerHTML = `<a href="https://basescan.org/tx/${txHash}" target="_blank" rel="noopener">${short(txHash)}</a>`;
    const { address, error: e2 } = await waitForTransaction();
    if (e2) throw e2;
    remember({ token: address, tapeId: S.sel.tapeId, name: cfg.name, symbol: cfg.symbol, time: Date.now() });
    renderMyCoins();
    await showCoin(address, { name: cfg.name, symbol: cfg.symbol });
    toast(t('done'), 'ok');
  } finally {
    btn.textContent = t('launch');
    btn.disabled = !S.checksOk;
  }
}

// ---------- ⑤ 分享和收钱 ----------
const ERC20_META = ['name', 'symbol'].map((n) => ({ type: 'function', name: n, stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }));
async function showCoin(token, meta) {
  if (!meta.name || !meta.symbol) {
    const [name, symbol] = await Promise.all(['name', 'symbol'].map((fn) => S.pub.readContract({ address: token, abi: ERC20_META, functionName: fn })));
    meta = { name, symbol };
  }
  S.token = token;
  step(5);
  $('st5').hidden = false;
  $('coinName').textContent = `${meta.name || ''} $${meta.symbol || ''}`;
  $('coinAddr').textContent = token;
  const dex = `https://dexscreener.com/base/${token}`;
  $('coinLinks').innerHTML = [['DexScreener', dex], ['BaseScan', `https://basescan.org/token/${token}`], ['Clanker', `https://clanker.world/clanker/${token}`]]
    .map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n}</a>`).join(' · ');
  const text = t('shareText', { name: meta.name || '', symbol: meta.symbol || '', addr: token, url: dex });
  $('shareX').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  await renderEarnings(token);
  $('st5').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function renderEarnings(token) {
  const r = await S.clanker.getTokenRewards({ token });
  const rows = await Promise.all(r.rewardRecipients.map(async (addr, i) => {
    const bps = Number(r.rewardBps[i]);
    const label = bps === AUTHOR_BPS && i === 0 ? t('earnAuthor') : bps === BUYBACK_BPS ? t('earnBuyback') : `${bps / 100}%`;
    return { addr, label, amt: await claimable(S.pub, addr) };
  }));
  $('earnRows').innerHTML = rows.map((x, i) => `
    <div class="earn">
      <div><b>${x.label}</b><div class="mono dim">${short(x.addr)}</div></div>
      <div class="amt">${x.amt > 0n ? `${eth4(x.amt)} WETH` : `<span class="dim">${t('nothing')}</span>`}</div>
      <button type="button" class="ghost" data-claim="${i}" ${x.amt > 0n ? '' : 'disabled'}>${t('claim')}</button>
    </div>`).join('');
  S.earnRows = rows;
}

async function doClaim(i) {
  const x = S.earnRows[i];
  const btn = document.querySelector(`[data-claim="${i}"]`);
  btn.disabled = true;
  btn.textContent = t('claiming');
  await ensureBase();
  const hash = await claim(S.wallet, S.account, x.addr);
  await S.pub.waitForTransactionReceipt({ hash });
  toast(t('claimedTo', { to: short(x.addr) }), 'ok');
  await renderEarnings(S.token);
}

function renderMyCoins() {
  const list = launched();
  $('myCoinsWrap').hidden = false;
  $('myCoinsTitle').hidden = !list.length;
  $('myCoins').innerHTML = list.map((r) => `
    <button type="button" class="coinrow" data-token="${r.token}" data-name="${esc(r.name)}" data-symbol="${esc(r.symbol)}">
      <b>${esc(r.name)}</b> <span class="dim">$${esc(r.symbol)} · TapeID ${r.tapeId}</span> <span class="mono dim">${short(r.token)}</span>
    </button>`).join('');
}

async function lookup() {
  const a = $('lookupAddr').value.trim();
  if (!isAddress(a)) throw new Error('bad-address');
  await showCoin(getAddress(a), {});
}

// ---------- 绑定 ----------
function bind() {
  $('lang').onclick = () => { setLang(lang() === 'zh' ? 'en' : 'zh'); applyI18n(); if (S.sel) pick(S.sel.tapeId); else if (S.items.length) renderCircuits(); };
  $('connect').onclick = guard(connect);
  $('search').oninput = () => { S.shown = PAGE; renderCircuits(); };
  $('more').onclick = () => { S.shown += PAGE; renderCircuits(); };
  $('change').onclick = () => { $('pickerWrap').classList.remove('picked'); $('st2').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('circuits').onclick = (e) => { const b = e.target.closest('[data-tid]'); if (b) pick(b.dataset.tid); };
  for (const id of ['name', 'symbol', 'image', 'desc', 'site', 'handle', 'devbuy']) $(id).addEventListener('input', recheck);
  $('pvLogo').onerror = () => { if (!$('pvLogo').src.endsWith(DEFAULT_LOGO)) $('pvLogo').src = DEFAULT_LOGO; };
  $('recheck').onclick = guard(runChecks);
  $('rescan').onclick = guard(async () => { $('scanErr').hidden = true; $('none').hidden = true; await scan(); });
  $('copyMine').onclick = (e) => copy(S.account, e.target);
  $('copyToken').onclick = (e) => copy(S.token, e.target);
  $('launch').onclick = guard(launch);
  $('earnRows').onclick = (e) => { const b = e.target.closest('[data-claim]'); if (b) guard(doClaim)(Number(b.dataset.claim)); };
  $('myCoins').onclick = (e) => { const b = e.target.closest('[data-token]'); if (b) guard(showCoin)(b.dataset.token, { name: b.dataset.name, symbol: b.dataset.symbol }); };
  $('lookupBtn').onclick = guard(lookup);
  if (window.ethereum) {
    window.ethereum.on?.('accountsChanged', () => location.reload());
    window.ethereum.on?.('chainChanged', () => location.reload());
  }
}

applyI18n();
bind();
step(1);
