// 一键领取页只读测试：U=<页面网址> node e2e_claim.mjs（模拟钱包=用户地址，转发 X Layer 公共节点，拒绝签名）
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: '/tmp/tapeid-claim-' + Date.now() });
const p = await b.newPage(); await p.setViewport({ width: 390, height: 844 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.evaluateOnNewDocument(() => { window.ethereum = { on() {}, async request({ method, params }) {
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0xc9059e0f59f40920e5bd24307eaa4defd81df145'];
  if (method === 'eth_chainId') return '0xc4'; if (method === 'wallet_switchEthereumChain') return null;
  if (method.startsWith('eth_send') || method.includes('sign')) throw Object.assign(new Error('User rejected (mock)'), { code: 4001 });
  const r = await fetch('https://rpc.xlayer.tech', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());
  if (r.error) throw Object.assign(new Error(r.error.message), r.error); return r.result; } }; });
await p.goto(process.env.U || 'http://localhost:8787/claim.html', { waitUntil: 'load' });
await p.waitForFunction(() => document.getElementById('connect') && document.querySelector('h1')?.textContent, { timeout: 90000 }); await p.click('#connect');
await p.waitForFunction(() => document.querySelector('#rows section') || !document.getElementById('none').hidden, { timeout: 180000 });
const rows = await p.$$eval('#rows section', (s) => s.map((x) => x.innerText.replace(/\s+/g, ' ')));
console.log('rows', rows, '\nfee', await p.$eval('#feeNote', (e) => e.textContent), '\nsafe', await p.$eval('#safeNote', (e) => e.textContent));
const btn = await p.$('[data-claim="0"]');
if (btn && !(await p.$eval('[data-claim="0"]', (e) => e.disabled))) { await btn.click(); await new Promise((r) => setTimeout(r, 3000)); console.log('after click steps:', await p.$$eval('ol.steps li', (l) => l.map((x) => x.className + ' ' + x.textContent)), 'toast:', await p.$eval('#toast', (e) => e.textContent)); }
console.log('errors', errs);
await p.screenshot({ path: '/tmp/claude-501/claim.png', fullPage: true });
await b.close();
