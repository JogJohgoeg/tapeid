// 录制 TapeID · X Layer 版演示（中英字幕）：node demo/record_xlayer.mjs → demo/frames_xl/*.png，再 sh demo/make.sh xl 合成。
// 录的是链上网站 1-2-245.aihashrate.stream；只读模拟钱包（查询转发 X Layer 公共节点，拒绝签名）；结尾是真实已发的 $NAND21。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const PAGE_URL = process.env.TAPEID_URL || 'https://1-2-245.aihashrate.stream/?tid=1.2.245&name=21%20NAND%20Driver&symbol=NAND21&logo=.%2F21-nand-driver.png';
const ME = '0xc9059e0f59f40920e5bd24307eaa4defd81df145';
const TOKEN = '0x2831E70D96DD8fb1A0EbE2aE17104147F29CEEEe';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'frames_xl');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, userDataDir: `/tmp/tapeid-demo-${Date.now()}` });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 780, deviceScaleFactor: 2 });
await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await p.evaluateOnNewDocument((me) => {
  try { localStorage.setItem('tapeid-lang', 'zh'); } catch {}
  window.ethereum = { on() {}, async request({ method, params }) {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [me];
    if (method === 'eth_chainId') return '0xc4';
    if (method === 'wallet_switchEthereumChain') return null;
    if (method.startsWith('wallet_') || method.startsWith('eth_send') || method.includes('sign')) throw new Error('demo: no signing');
    const r = await fetch('https://rpc.xlayer.tech', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());
    if (r.error) throw Object.assign(new Error(r.error.message), r.error);
    return r.result; } };
}, ME);
await p.goto(PAGE_URL, { waitUntil: 'networkidle2' });
await p.waitForFunction(() => document.getElementById('connect') && document.querySelector('h1')?.textContent, { timeout: 90000 });
// 字幕层 + 高亮框 + 片尾卡（只加在演示里，不改页面）
await p.addStyleTag({ content: `
  #demoCap { position:fixed; left:10px; right:10px; bottom:12px; z-index:9999; background:rgba(10,12,16,.92); color:#fff;
    border:1px solid rgba(232,176,74,.6); border-radius:12px; padding:10px 14px; font:600 17px/1.4 -apple-system,"PingFang SC",sans-serif; }
  #demoCap .en { font:500 13.5px/1.35 -apple-system,sans-serif; color:#e8b04a; margin-top:3px; }
  .demoHi { outline:3px solid #e8b04a !important; outline-offset:4px; border-radius:10px; box-shadow:0 0 0 9999px rgba(0,0,0,.28); position:relative; z-index:2; }
  #demoEnd { position:fixed; inset:0; z-index:10000; background:#0e1116; color:#eceae4; display:flex; flex-direction:column; align-items:center;
    justify-content:center; gap:14px; text-align:center; font:600 22px/1.4 -apple-system,"PingFang SC",sans-serif; padding:24px; }
  #demoEnd img { width:150px; height:150px; border-radius:50%; }
  #demoEnd .en { color:#e8b04a; font-size:16px; font-weight:500; } #demoEnd .url { font:600 17px ui-monospace,Menlo,monospace; color:#e8b04a; }` });

const frames = [];
let n = 0;
async function cap(zh, en, target, secs) {
  await p.evaluate((zh, en, sel) => {
    document.querySelectorAll('.demoHi').forEach((e) => e.classList.remove('demoHi'));
    let c = document.getElementById('demoCap');
    if (!c) { c = document.createElement('div'); c.id = 'demoCap'; document.body.append(c); }
    c.innerHTML = `<div>${zh}</div><div class="en">${en}</div>`;
    if (sel) {
      const el = document.querySelector(sel);
      // 高于半屏的元素顶部对齐，避免高亮框超出画面
      el.scrollIntoView({ block: el.getBoundingClientRect().height > innerHeight * 0.5 ? 'start' : 'center' });
      if (el.getBoundingClientRect().height > innerHeight * 0.5) scrollBy(0, -70);
      el.classList.add('demoHi');
    }
  }, zh, en, target);
  await new Promise((r) => setTimeout(r, 350));
  const f = `f${String(n++).padStart(2, '0')}.png`;
  await p.screenshot({ path: path.join(OUT, f) });
  frames.push([f, secs]);
}
const scrollTop = () => p.evaluate(() => window.scrollTo(0, 0));

await scrollTop();
await cap('这个网站本身存在 X Layer 链上的电路容器里', 'This site itself lives on X Layer, inside a circuit container', null, 3.2);
await cap('① 连接钱包（X Layer）', '① Connect your wallet (X Layer)', '#connect', 2.2);
await p.evaluate(() => document.querySelectorAll('.demoHi').forEach((e) => e.classList.remove('demoHi')));
await p.click('#connect');
await p.waitForFunction(() => document.getElementById('cGas').className.match(/ok|bad/), { timeout: 120000 });
await p.evaluate(() => document.getElementById('st2').scrollIntoView({ block: 'start' }));
await cap('② 自动找到你在 X Layer 上流片的电路', '② Your circuits taped out on X Layer are found automatically', '#circuits', 2.8);
await cap('名字、代码、logo 自动填好', 'Name, ticker and logo are filled in', '#st3 .preview', 2.8);
await cap('交易税 80% 进电路容器，谁持有电路归谁', '80% of the trading tax goes to the circuit container — whoever holds the circuit', '#toAuthor', 3.2);
await cap('20% 进你的回购 Safe；比例发币时锁死，谁都改不了', '20% to your buyback Safe; ratios locked at launch — nobody can change them', '#st3 .note', 3.4);
await cap('③ 自动检查；IGNIX 平台签名，发币前预演金库收款人', '③ Auto checks; IGNIX signs, vault recipients are pre-checked before launch', '#st4', 3.4);
await cap('④ 签一条消息 + 确认一笔交易，币就发出来了', '④ Sign one message + confirm one transaction, and the coin is live', '#launch', 3);
// 结尾：真实已发的币在 IGNIX 上
await p.goto(`https://ignix.bot/launch?token=${TOKEN}`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 5000));
await p.addStyleTag({ content: `#demoCap { position:fixed; left:10px; right:10px; bottom:12px; z-index:9999; background:rgba(10,12,16,.92); color:#fff;
    border:1px solid rgba(232,176,74,.6); border-radius:12px; padding:10px 14px; font:600 17px/1.4 -apple-system,"PingFang SC",sans-serif; }
  #demoCap .en { font:500 13.5px/1.35 -apple-system,sans-serif; color:#e8b04a; margin-top:3px; }
  #demoEnd { position:fixed; inset:0; z-index:10000; background:#0e1116; color:#eceae4; display:flex; flex-direction:column; align-items:center;
    justify-content:center; gap:12px; text-align:center; font:600 21px/1.4 -apple-system,"PingFang SC",sans-serif; padding:24px; }
  #demoEnd img { width:140px; height:140px; border-radius:50%; } #demoEnd .en { color:#e8b04a; font-size:15px; font-weight:500; }
  #demoEnd .url { font:600 15px ui-monospace,Menlo,monospace; color:#e8b04a; } #demoEnd .dim { color:#9a9ca3; font-size:13px; font-weight:500; }` });
await cap('⑤ 真实的第一枚：21 NAND Driver（$NAND21），已在 IGNIX 交易', '⑤ The first real one: 21 NAND Driver ($NAND21), trading on IGNIX', null, 3.5);
await p.evaluate(() => {
  document.getElementById('demoCap')?.remove();
  const d = document.createElement('div'); d.id = 'demoEnd';
  d.innerHTML = `<img src="https://nand.aihashrate.stream/tapeid/21-nand-driver.png"><div>TapeID · X Layer</div>
    <div class="en">Every circuit can be a coin</div><div class="url">1-2-245.aihashrate.stream</div>
    <div class="dim">处理器 #245 TapeID · 电路 1.2.245 · IGNIX 税收分配金库 80/20</div>`;
  document.body.append(d);
});
await new Promise((r) => setTimeout(r, 1200));
const fEnd = `f${String(n++).padStart(2, '0')}.png`;
await p.screenshot({ path: path.join(OUT, fEnd) });
frames.push([fEnd, 4]);
const list = frames.map(([f, s]) => `file '${f}'\nduration ${s}`).join('\n') + `\nfile '${frames.at(-1)[0]}'\n`;
fs.writeFileSync(path.join(OUT, 'frames.txt'), list);
console.log(`录了 ${frames.length} 帧，共 ${frames.reduce((a, [, s]) => a + s, 0).toFixed(1)} 秒 → ${OUT}`);
await b.close();
