// 端到端只读测试：本目录先 python3 -m http.server 8787，再 node e2e.mjs [钱包地址] [--rich]
// 页面加载前注入只读模拟钱包（查询转发给 Base 公共节点，拒绝一切签名）；--rich 假装有 1 ETH，--poor 假装 0 ETH。
import puppeteer from 'puppeteer-core';
const args = process.argv.slice(2);
const ME = (args.find((a, i) => a.startsWith('0x') && args[i - 1] !== '--lookup') || '0xc9059e0f59f40920e5bd24307eaa4defd81df145').toLowerCase();
const RICH = args.includes('--rich');
const POOR = args.includes('--poor');
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, userDataDir: '/tmp/tapeid-e2e-chrome', args: [args.includes('--en') ? '--lang=en-US' : '--lang=zh-CN'] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844 });   // 手机宽度
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.evaluateOnNewDocument((me, rich, poor) => {
  window.ethereum = { on() {}, async request({ method, params }) {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [me];
    if (method === 'eth_chainId') return '0x2105';
    if (rich && method === 'eth_getBalance') return '0xde0b6b3a7640000';
    if (poor && method === 'eth_getBalance') return '0x0';
    if (method.startsWith('wallet_') || method.startsWith('eth_send') || method.includes('sign')) throw new Error('mock: no signing');
    const r = await fetch('https://base-rpc.publicnode.com', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());
    if (r.error) { const e = new Error(r.error.message); e.code = r.error.code; e.data = r.error.data; throw e; }
    return r.result; } };
}, ME, RICH, POOR);
await p.goto(process.env.TAPEID_URL || 'http://localhost:8787/index.html', { waitUntil: 'load' });
await p.evaluate(() => localStorage.removeItem('tapeid-lang'));
await p.reload({ waitUntil: 'load' });
if (args.includes('--en') && (await p.$eval('#lang', (e) => e.textContent.trim())) === 'EN') await p.click('#lang');
const txt = (sel) => p.$eval(sel, (e) => e.textContent.trim());
const out = { h1: await txt('h1') };
await p.click('#connect');
await p.waitForSelector('#circuits .circ', { timeout: 120000 });
out.found = await txt('#found');
out.firstCards = await p.$$eval('#circuits .circ', (c) => c.slice(0, 3).map((x) => x.innerText.replace(/\s+/g, ' ')));
await p.click('#circuits .circ');
await p.waitForFunction(() => ['cGas', 'cSim'].some((id) => /ok|bad/.test(document.getElementById(id).className))
  && (document.getElementById('cSim').className.includes('ok') || document.getElementById('cSim').className.includes('bad') || !document.getElementById('needEth').hidden), { timeout: 120000 });
out.preview = { name: await txt('#pvName'), symbol: await txt('#pvSymbol'), tid: await txt('#pvTid'), earn: await txt('#earnYou') };
out.checks = await p.$$eval('.chk', (c) => c.map((x) => `${x.className.replace('chk ', '')}: ${x.innerText.trim()}`));
out.needEthShown = await p.$eval('#needEth', (e) => !e.hidden);
out.launchEnabled = await p.$eval('#launch', (e) => !e.disabled);
out.addr = { author: await p.$eval('#addrAuthor', (e) => e.value), buyback: await p.$eval('#addrBuyback', (e) => e.value) };
const li = args.indexOf('--lookup');
if (li >= 0) {
  await p.type('#lookupAddr', args[li + 1]);
  await p.click('#lookupBtn');
  await p.waitForFunction(() => !document.getElementById('st5').hidden && document.querySelectorAll('#earnRows .earn').length, { timeout: 60000 }).catch(() => {});
  out.lookup = { shown: await p.$eval('#st5', (e) => !e.hidden), addr: await txt('#coinAddr'),
    rows: await p.$$eval('#earnRows .earn', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' '))),
    share: decodeURIComponent((await p.$eval('#shareX', (e) => e.href)).split('text=')[1] || '').slice(0, 160),
    toast: await txt('#toast') };
}
out.pageErrors = errs;
await p.screenshot({ path: `/tmp/tapeid-e2e-${RICH ? 'rich' : POOR ? 'poor' : 'real'}.png`, fullPage: true });
console.log(JSON.stringify(out, null, 1));
await b.close();
