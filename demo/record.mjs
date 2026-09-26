// 录制 TapeID 发币向导演示（中英字幕）：node demo/record.mjs → demo/frames/*.png + frames.txt，再由 make.sh 合成 GIF / MP4。
// 用只读模拟钱包（查询转发 Base 公共节点，拒绝签名）；第 5 步展示真实已发的币 $NAD。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const PAGE_URL = process.env.TAPEID_URL || 'https://nand.aihashrate.stream/tapeid/';
const ME = '0xc9059e0f59f40920e5bd24307eaa4defd81df145';
const TOKEN = '0xab62f377f4fe2eef95d49ebfe5980c5563425567';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'frames');
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
    if (method === 'eth_chainId') return '0x2105';
    if (method.startsWith('wallet_') || method.startsWith('eth_send') || method.includes('sign')) throw new Error('demo: no signing');
    const r = await fetch('https://base-rpc.publicnode.com', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());
    if (r.error) throw Object.assign(new Error(r.error.message), r.error);
    return r.result; } };
}, ME);
await p.goto(PAGE_URL, { waitUntil: 'networkidle2' });

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
await cap('把你在 TapeOut 做的电路，一键发成币', 'Turn your TapeOut circuit into a coin in one click', null, 3);
await cap('① 连接钱包', '① Connect your wallet', '#connect', 2.2);
await p.evaluate(() => document.querySelectorAll('.demoHi').forEach((e) => e.classList.remove('demoHi')));
await p.click('#connect');
await p.waitForSelector('#circuits .circ', { timeout: 120000 });
await p.evaluate(() => document.getElementById('st2').scrollIntoView({ block: 'start' }));
await cap('自动找到你拥有的所有电路', 'All the circuits you own are found automatically', '#searchRow', 2.8);
await cap('② 选一个电路', '② Pick a circuit', '#circuits .circ', 2);
await p.evaluate(() => document.querySelectorAll('.demoHi').forEach((e) => e.classList.remove('demoHi')));
await p.click('#circuits .circ');
await p.waitForFunction(() => document.getElementById('cSim').className.includes('ok'), { timeout: 120000 });
await cap('名字、代码、logo 自动生成，想改也能改', 'Name, ticker and logo are filled in — edit if you like', '#st3 .preview', 3);
await cap('每笔买卖 0.64% 归你，0.16% 回购 $BEM', '0.64% of every trade goes to you, 0.16% buys back $BEM', '#st3 .earn-list', 3.2);
await cap('③ 自动检查：网络、手续费、免费试发', '③ Auto checks: network, fee and a free dry run', '#cSim', 3);
await cap('④ 点「发币」，在钱包里确认一次', '④ Tap “Launch” and confirm once in your wallet', '#launch', 3);
// 第 5 步：真实已发的币
await p.evaluate(() => document.querySelectorAll('.demoHi').forEach((e) => e.classList.remove('demoHi')));
await p.type('#lookupAddr', TOKEN);
await p.click('#lookupBtn');
await p.waitForFunction(() => !document.getElementById('st5').hidden && document.querySelectorAll('#earnRows .earn').length, { timeout: 120000 });
await cap('⑤ 币发好了：一键发到 X', '⑤ Your coin is live — share it to X in one tap', '#shareX', 3);
await cap('收益随时一键领取', 'Claim your earnings any time', '#earnRows', 3);
await p.evaluate(() => {
  document.getElementById('demoCap')?.remove();
  const d = document.createElement('div');
  d.id = 'demoEnd';
  d.innerHTML = `<img src="https://nand.aihashrate.stream/tapeid/tapeid-default.png"><div>给你的电路发一个币</div>
    <div class="en">Launch a coin for your circuit</div><div class="url">nand.aihashrate.stream/tapeid</div>`;
  document.body.append(d);
});
await new Promise((r) => setTimeout(r, 800));
const fEnd = `f${String(n++).padStart(2, '0')}.png`;
await p.screenshot({ path: path.join(OUT, fEnd) });
frames.push([fEnd, 3.5]);

// ffmpeg concat 清单（最后一帧需重复一次才能保住时长）
const list = frames.map(([f, s]) => `file '${f}'\nduration ${s}`).join('\n') + `\nfile '${frames.at(-1)[0]}'\n`;
fs.writeFileSync(path.join(OUT, 'frames.txt'), list);
console.log(`录了 ${frames.length} 帧，共 ${frames.reduce((a, [, s]) => a + s, 0).toFixed(1)} 秒 → ${OUT}`);
await b.close();
