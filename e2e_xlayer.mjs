// X Layer 页端到端只读测试：node e2e_xlayer.mjs [钱包]（本目录 python3 -m http.server 8787）。模拟钱包转发到 X Layer 公共节点、拒绝签名。
import puppeteer from 'puppeteer-core';
const ME = (process.argv[2] || '0xA75266aC7914fF3d4eB4F6cb94Ea5215dB90255f').toLowerCase();
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: '/tmp/tapeid-e2e-xl-' + Date.now() });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.evaluateOnNewDocument((me) => {
  window.ethereum = { on() {}, async request({ method, params }) {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [me];
    if (method === 'eth_chainId') return '0xc4';
    if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
    if (method.startsWith('wallet_') || method.startsWith('eth_send') || method.includes('sign')) throw Object.assign(new Error('User rejected (mock)'), { code: 4001 });
    const r = await fetch('https://rpc.xlayer.tech', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());
    if (r.error) throw Object.assign(new Error(r.error.message), r.error); return r.result; } };
}, ME);
await p.goto(process.env.TAPEID_URL || 'http://localhost:8787/xlayer.html', { waitUntil: 'load' });
const txt = (s) => p.$eval(s, (e) => e.innerText.trim());
await p.click('#connect');
await p.waitForFunction(() => document.querySelector('#circuits .circ') || !document.getElementById('none').hidden, { timeout: 120000 });
const out = { h1: await txt('h1'), found: await txt('#found').catch(() => ''), first: await p.$$eval('#circuits .circ', (c) => c.slice(0, 2).map((x) => x.innerText.replace(/\s+/g, ' '))) };
if (out.first.length) {
  await p.click('#circuits .circ');
  await p.waitForFunction(() => document.getElementById('cGas').className.match(/ok|bad/), { timeout: 60000 });
  out.preview = { name: await txt('#pvName'), sym: await txt('#pvSymbol'), author: await txt('#toAuthor'), buyback: await txt('#toBuyback') };
  out.checks = await p.$$eval('.chk', (c) => c.map((x) => `${x.className.replace('chk ', '')}: ${x.innerText.trim()}`));
  out.btn = await txt('#launch');
  await p.click('#launch');
  await new Promise((r) => setTimeout(r, 4000));
  out.afterPrepare = { sign: await p.$eval('#cSign', (e) => e.className + ' ' + e.innerText), toast: await txt('#toast') };
}
out.errors = errs;
await p.screenshot({ path: '/tmp/tapeid-e2e-xlayer.png', fullPage: true });
console.log(JSON.stringify(out, null, 1));
await b.close();
