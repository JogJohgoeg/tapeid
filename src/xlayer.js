// TapeID · X Layer 版：给你在 X Layer 上的电路，在 IGNIX（X Layer 官方发币平台）发一个币。
// 交易税 80% 进电路容器（谁持有电路归谁）、20% 进发币人专属回购 Safe，发币时锁死。不含自有合约，每笔交易由钱包签名。
import { createPublicClient, createWalletClient, custom, formatEther, getAddress } from 'viem';
import { xLayer } from 'viem/chains';
import { buybackSafe } from './buyback_safe.js';
import { scanHoldings } from './holdings.js';
import { KNOWN } from './launch.js';
import { logoDataUrl, prepareLaunch, sendLaunch, tokenUrl } from './ignix.js';

const HEX = '0xc4';
const TAX_BPS = 100;   // 买卖各 1%（IGNIX 税收分配金库的下限）
const AUTHOR_BPS = 8000, BUYBACK_BPS = 2000;
const PAGE = 24;
const LOGO_DEFAULT = './tapeid-default.png';
const LOGOS = { '279.732': './21-nand-driver.png' };
// ?tid=&name=&symbol=&logo=：从上线页跳来时预选电路并预填（logo 只接受本站相对路径）
const Q = new URLSearchParams(location.search);
const PRE = { tid: Q.get('tid'), name: Q.get('name'), symbol: Q.get('symbol'), logo: /^\.\/[\w.-]+\.png$/.test(Q.get('logo') || '') ? Q.get('logo') : null };
if (PRE.tid && PRE.logo) LOGOS[PRE.tid] = PRE.logo;

const zh = {
  title: '给你的 X Layer 电路发一个币', lead: 'TapeID · X Layer 版：选一个你在 X Layer 上流片的电路，一键在 IGNIX 发币。每笔买卖的交易税按 80% / 20% 自动分给电路容器和你的回购 Safe，发币时锁死，任何人改不了。',
  s1: '连接钱包', s2: '选一个 X Layer 电路', s3: '看看你的币', s4: '发币', s5: '完成',
  connect: '连接钱包（X Layer）', connected: '已连接 {a} · {b} OKB',
  noWallet: '没检测到钱包。电脑装 OKX 钱包或 MetaMask 扩展；手机请在 OKX App 的浏览器里打开本页。',
  scanning: '正在 X Layer 上找你的电路…', found: '找到 {n} 个 X Layer 电路', search: '搜电路号、门数…', more: '再显示 {n} 个',
  none: '这个钱包在 X Layer 上还没有电路。先在 TapeOut 的 X Layer 处理器上流片一个电路，再回来。', makeOne: '去 tapeout.net（X Layer 标签页）',
  gates: '{g} 门', io: '{i} 入 {o} 出', nameL: '名字', symbolL: '代码（$ 后面那串）', symbolH: '1–10 个英文字母或数字。',
  split: '<b>交易税：买卖各 1%</b>，全部进这个币专属的金库，再按固定比例分：',
  toAuthor: '<b>80%</b> → 电路容器 <span class="mono">{c}</span>（谁持有这个电路归谁）',
  toBuyback: '<b>20%</b> → 你专属的回购 Safe <span class="mono">{s}</span>（回购多少、何时回购由你决定）',
  locked: '收款地址和比例在发币时写进金库合约，<b>任何人（包括你和 IGNIX）都改不了</b>。',
  platform: 'IGNIX 另收 1% 曲线费；募满 85 OKB 自动毕业进 Uniswap V2，流动性永久锁定。X 的智能标签目前不支持 X Layer 的币。',
  cNet: '钱包在 X Layer 网络', cGas: '钱包里的 OKB 够付 gas（至少 {m} OKB）', cSign: 'IGNIX 平台签名，参数逐项核对一致', cSim: '试发一遍（不花钱）通过，金库收款人已预先核对：80% 容器 / 20% 回购 Safe',
  prepare: '准备发币（签一条消息，不花钱）', preparing: '请在钱包里签名…', launch: '发币（钱包确认）', launching: '请在钱包确认…', sent: '已提交，正在上链…',
  predicted: '币的地址（发币前已确定）：', fee: '上币费 {f} OKB + gas',
  confirm: '在 X Layer 主网发出 “{n}”（${s}）？\n\n交易税 1%：\n80% → {a}\n20% → {b}\n\n发币后收款地址与比例永久锁定。',
  done: '发好了！', verifyOk: '链上核对：金库收款人与比例 = 80% 容器 / 20% 回购 Safe，已锁死。', verifyBad: '链上核对未通过，请检查！',
  links: '在 IGNIX 查看', share: '发到 X', shareText: '我把 TapeOut 在 X Layer 上的电路 “{n}” 发成了币 ${s}\n交易税 80% 进电路容器，谁持有电路归谁\n{u}',
  err: '出错了：{m}', rejected: '你在钱包里取消了。', lang: 'EN',
};
const en = {
  title: 'Launch a coin for your X Layer circuit', lead: 'TapeID · X Layer edition: pick a circuit you taped out on X Layer and launch it on IGNIX in one click. Trading tax is split 80% / 20% to the circuit container and your buyback Safe, locked at launch — nobody can change it.',
  s1: 'Connect wallet', s2: 'Pick an X Layer circuit', s3: 'Preview your coin', s4: 'Launch', s5: 'Done',
  connect: 'Connect wallet (X Layer)', connected: 'Connected {a} · {b} OKB',
  noWallet: 'No wallet found. Install the OKX Wallet or MetaMask extension; on a phone open this page in the OKX app browser.',
  scanning: 'Looking for your circuits on X Layer…', found: '{n} X Layer circuits found', search: 'Search number, gates…', more: 'Show {n} more',
  none: 'This wallet has no circuits on X Layer yet. Tape out a circuit on a TapeOut X Layer processor first, then come back.', makeOne: 'Go to tapeout.net (X Layer tab)',
  gates: '{g} gates', io: '{i} in {o} out', nameL: 'Name', symbolL: 'Ticker (after the $)', symbolH: '1–10 letters or digits.',
  split: '<b>Trading tax: 1% on buys and sells</b>, all into this coin\'s own vault, then split at fixed ratios:',
  toAuthor: '<b>80%</b> → circuit container <span class="mono">{c}</span> (whoever holds the circuit)',
  toBuyback: '<b>20%</b> → your own buyback Safe <span class="mono">{s}</span> (how much and when to buy back is up to you)',
  locked: 'Recipients and ratios are written into the vault contract at launch — <b>nobody, including you and IGNIX, can change them</b>.',
  platform: 'IGNIX also charges a 1% curve fee; at 85 OKB raised the coin graduates to Uniswap V2 with liquidity locked forever. X smart cashtags do not support X Layer coins yet.',
  cNet: 'Wallet is on X Layer', cGas: 'Enough OKB for gas (at least {m} OKB)', cSign: 'IGNIX platform signature, every parameter checked', cSim: 'Dry run (free) passed, vault recipients pre-checked: 80% container / 20% buyback Safe',
  prepare: 'Prepare launch (sign a message, free)', preparing: 'Sign in your wallet…', launch: 'Launch (confirm in wallet)', launching: 'Confirm in your wallet…', sent: 'Submitted, waiting for the chain…',
  predicted: 'Coin address (known before launch): ', fee: 'Listing fee {f} OKB + gas',
  confirm: 'Launch “{n}” (${s}) on X Layer mainnet?\n\nTrading tax 1%:\n80% → {a}\n20% → {b}\n\nRecipients and ratios are locked forever after launch.',
  done: 'Launched!', verifyOk: 'On-chain check: vault recipients = 80% container / 20% buyback Safe, locked.', verifyBad: 'On-chain check failed — please inspect!',
  links: 'View on IGNIX', share: 'Post on X', shareText: 'I launched my TapeOut circuit on X Layer, “{n}”, as ${s}\n80% of the trading tax goes to the circuit container — whoever holds the circuit\n{u}',
  err: 'Something went wrong: {m}', rejected: 'You cancelled in the wallet.', lang: '中文',
};
let lang = 'zh';
try { lang = localStorage.getItem('tapeid-lang') || ((navigator.language || '').startsWith('zh') ? 'zh' : 'en'); } catch {}
const t = (k, v = {}) => ((lang === 'en' ? en : zh)[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? `{${x}}`);

const $ = (id) => document.getElementById(id);
const S = { account: null, wallet: null, pub: null, safe: null, items: [], shown: PAGE, sel: null, prep: null };
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const MIN_OKB = 5n * 10n ** 15n; // 0.005 OKB：createToken 约 680 万 gas，远小于此

function i18n() {
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  for (const el of document.querySelectorAll('[data-i]')) el.innerHTML = t(el.dataset.i);
  for (const el of document.querySelectorAll('[data-ph]')) el.placeholder = t(el.dataset.ph);
}
function toast(m, kind = '') { const e = $('toast'); e.textContent = m; e.className = `toast show ${kind}`; clearTimeout(toast.h); toast.h = setTimeout(() => { e.className = 'toast'; }, 6000); }
function errText(e) {
  const m = e?.shortMessage || e?.message || String(e);
  if (e?.code === 4001 || /reject|denied|cancel/i.test(m)) return t('rejected');
  return t('err', { m });
}
const guard = (f) => async (...a) => { try { await f(...a); } catch (e) { console.error(e); toast(errText(e), 'bad'); } };
function step(n) { for (let i = 1; i <= 5; i++) { $(`st${i}`).hidden = i > n; $(`dot${i}`).className = i < n ? 'done' : i === n ? 'now' : ''; } }
function mark(id, s, text) { const el = $(id); el.className = `chk ${s}`; if (text != null) el.querySelector('span').innerHTML = text; }

async function ensureChain() {
  const p = window.ethereum;
  if ((await p.request({ method: 'eth_chainId' })) === HEX) return;
  try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: HEX }] }); } catch (e) {
    if (e.code !== 4902) throw e;
    await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: HEX, chainName: 'X Layer', nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
      rpcUrls: ['https://rpc.xlayer.tech'], blockExplorerUrls: ['https://www.oklink.com/xlayer'] }] });
  }
}

async function connect() {
  if (!window.ethereum) { $('noWallet').hidden = false; return; }
  const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  await ensureChain();
  S.account = getAddress(a);
  S.wallet = createWalletClient({ account: S.account, chain: xLayer, transport: custom(window.ethereum) });
  S.pub = createPublicClient({ chain: xLayer, transport: custom(window.ethereum) });
  const bal = await S.pub.getBalance({ address: S.account });
  S.bal = bal;
  $('connected').textContent = t('connected', { a: short(S.account), b: Number(formatEther(bal)).toFixed(4) });
  $('connected').hidden = false;
  $('connect').hidden = true;
  step(2);
  $('scanState').textContent = t('scanning');
  const [safe, res] = await Promise.all([buybackSafe(S.pub, S.account), scanHoldings(S.account, null, ['xlayer'])]);
  S.safe = safe.address;
  res.errors.forEach((e) => toast(e, 'bad'));
  S.items = res.items.sort((x, y) => (KNOWN[y.tapeId] ? 1 : 0) - (KNOWN[x.tapeId] ? 1 : 0) || y.circuitId - x.circuitId);
  $('scanState').hidden = true;
  if (!S.items.length) { $('none').hidden = false; return; }
  $('found').textContent = t('found', { n: S.items.length });
  $('pickerWrap').hidden = false;
  renderList();
  if (PRE.tid && S.items.some((x) => x.tapeId === PRE.tid)) pick(PRE.tid);
}

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const list = S.items.filter((x) => !q || `${x.tapeId} ${KNOWN[x.tapeId]?.name || ''} ${x.gates}`.toLowerCase().includes(q));
  $('circuits').innerHTML = list.slice(0, S.shown).map((x) => `<button type="button" class="circ${S.sel?.tapeId === x.tapeId ? ' on' : ''}" data-tid="${x.tapeId}">
    <span class="tid">${x.tapeId}</span>${KNOWN[x.tapeId] ? `<span class="nm">${KNOWN[x.tapeId].name}</span>` : ''}
    <span class="meta">${t('gates', { g: x.gates })} · ${t('io', { i: x.nIn, o: x.nOut })}</span></button>`).join('');
  const rest = list.length - S.shown;
  $('more').hidden = rest <= 0;
  $('more').textContent = t('more', { n: Math.min(rest, PAGE) });
}

function pick(tid) {
  const x = S.items.find((i) => i.tapeId === tid);
  if (!x || !x.container) return;
  S.sel = x;
  S.prep = null;
  const pre = PRE.tid === x.tapeId;
  $('name').value = (pre && PRE.name) || KNOWN[x.tapeId]?.name || `TapeID ${x.tapeId}`;
  $('symbol').value = (pre && PRE.symbol) || 'TAPEID';
  $('pvLogo').src = LOGOS[x.tapeId] || LOGO_DEFAULT;
  $('pickerWrap').classList.add('picked');
  renderList();
  preview();
  step(4);
  checks();
  $('st3').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function preview() {
  const x = S.sel;
  $('pvName').textContent = $('name').value.trim() || '—';
  $('pvSymbol').textContent = `$${$('symbol').value.trim().toUpperCase() || '—'}`;
  $('pvTid').textContent = `TapeID ${x.tapeId} · X Layer`;
  $('toAuthor').innerHTML = t('toAuthor', { c: short(x.container) });
  $('toBuyback').innerHTML = t('toBuyback', { s: short(S.safe) });
}

const recipients = () => [{ address: S.sel.container, bps: AUTHOR_BPS }, { address: S.safe, bps: BUYBACK_BPS }];
function params() {
  const name = $('name').value.trim(), symbol = $('symbol').value.trim().toUpperCase();
  if (!name || !/^[A-Z0-9]{1,10}$/.test(symbol)) throw new Error(lang === 'en' ? 'Name / ticker invalid' : '名字或代码不合法');
  return { name, symbol };
}

async function checks() {
  S.prep = null;
  $('launch').disabled = true;
  $('launch').textContent = t('prepare');
  $('predicted').hidden = true;
  mark('cNet', 'wait'); mark('cGas', 'wait', t('cGas', { m: formatEther(MIN_OKB) })); mark('cSign', 'wait'); mark('cSim', 'wait');
  await ensureChain();
  mark('cNet', 'ok');
  S.bal = await S.pub.getBalance({ address: S.account });
  mark('cGas', S.bal >= MIN_OKB ? 'ok' : 'bad');
  $('launch').disabled = S.bal < MIN_OKB;
}

async function prepare() {
  const { name, symbol } = params();
  $('launch').disabled = true;
  $('launch').textContent = t('preparing');
  try {
    const x = S.sel;
    const image = await logoDataUrl(LOGOS[x.tapeId] || LOGO_DEFAULT);
    const description = `${name} (TapeID ${x.tapeId}): TapeOut circuit #${x.circuitId} on X Layer processor #${x.cpuIndex}, ${x.nIn} in / ${x.nOut} out / ${x.gates} gates. `
      + `Trading tax 1%: 80% to circuit container ${x.container}, 20% to buyback Safe ${S.safe}. Locked at launch.`;
    S.prep = await prepareLaunch({ wallet: S.wallet, pub: S.pub, account: S.account, name, symbol, taxBps: TAX_BPS, recipients: recipients(),
      meta: { image, description, website: 'https://nand.aihashrate.stream/tapeid/xlayer.html' } });
    mark('cSign', 'ok'); mark('cSim', 'ok');
    $('predicted').innerHTML = `${t('predicted')}<span class="mono">${S.prep.predicted}</span><br>${t('fee', { f: formatEther(S.prep.listingFee) })}`;
    $('predicted').hidden = false;
    $('launch').textContent = t('launch');
  } catch (e) {
    mark('cSign', 'bad', errText(e));
    $('launch').textContent = t('prepare');
    throw e;
  } finally { $('launch').disabled = false; }
}

async function launch() {
  if (!S.prep) return prepare();
  const { name, symbol } = params();
  if (!confirm(t('confirm', { n: name, s: symbol, a: S.sel.container, b: S.safe }))) return;
  $('launch').disabled = true;
  $('launch').textContent = t('launching');
  try {
    const r = await sendLaunch({ wallet: S.wallet, pub: S.pub, prep: S.prep, recipients: recipients() });
    step(5);
    $('st5').hidden = false;
    $('doneAddr').textContent = r.token;
    $('verify').textContent = r.ok ? t('verifyOk') : t('verifyBad');
    $('verify').className = r.ok ? 'ok' : 'bad';
    $('ignixLink').href = tokenUrl(r.token);
    $('okl').href = `https://www.oklink.com/xlayer/token/${r.token}`;
    $('shareX').href = `https://x.com/intent/post?text=${encodeURIComponent(t('shareText', { n: name, s: symbol, u: tokenUrl(r.token) }))}`;
    toast(t('done'), 'ok');
    $('st5').scrollIntoView({ behavior: 'smooth' });
  } finally { $('launch').disabled = false; $('launch').textContent = t('launch'); S.prep = null; }
}

$('lang').onclick = () => { lang = lang === 'zh' ? 'en' : 'zh'; try { localStorage.setItem('tapeid-lang', lang); } catch {} i18n(); if (S.sel) preview(); if (S.items.length) renderList(); };
$('connect').onclick = guard(connect);
$('search').oninput = () => { S.shown = PAGE; renderList(); };
$('more').onclick = () => { S.shown += PAGE; renderList(); };
$('change').onclick = () => $('pickerWrap').classList.remove('picked');
$('circuits').onclick = (e) => { const b = e.target.closest('[data-tid]'); if (b) pick(b.dataset.tid); };
for (const id of ['name', 'symbol']) $(id).addEventListener('input', () => { preview(); if (S.prep) checks(); });
$('launch').onclick = guard(launch);
if (window.ethereum) { window.ethereum.on?.('accountsChanged', () => location.reload()); window.ethereum.on?.('chainChanged', () => location.reload()); }
i18n();
step(1);
