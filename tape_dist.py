"""链上版（282.732.tape/tapeid/）打包：脚本 gzip 存链上、页面内解压运行；header 图标用链上 SVG。

npm run build && python3 tape_dist.py   → dist_tape/tapeid/{index.html, app.js.gz, tapeid-default.svg}
上传：hashport/site_upload.py plan|upload|verify --chain bsc --container 0x39d97ab281f04a5bc3aCc562f8DeA3f0b4266aA3 --dist dist_tape
（操作员需持有人先 setOperator + 转 gas，见 op_282.html；传完 refund 回持有人）
"""
import shutil, subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'dist_tape' / 'tapeid'
shutil.rmtree(HERE / 'dist_tape', ignore_errors=True)
OUT.mkdir(parents=True)
# 用系统 gzip -9 -n（无文件名、mtime=0），与链上已传字节一致
(OUT / 'app.js.gz').write_bytes(subprocess.run(['gzip', '-9', '-n', '-c', str(HERE / 'tapeid_coin.bundle.js')], check=True, capture_output=True).stdout)
shutil.copyfile(HERE / 'logo' / 'tapeid-default.svg', OUT / 'tapeid-default.svg')
BOOT = '<p id="tapeBoot" style="text-align:center;color:#888;margin:8px 0 16px">正在从链上加载（约 0.3 MB）… / Loading from chain…</p>'
LOADER = '''<script type="module">
// 链上版：脚本以 gzip 存在容器里，浏览器里解压后运行（网关若已自动解压则直接运行）。
// 一律用绝对路径：地址少了结尾斜杠（…/tapeid）时相对路径会指到根目录，网关回的是引导页 HTML。
if (!location.pathname.endsWith('/')) history.replaceState(null, '', location.pathname + '/' + location.search + location.hash);
const boot = document.getElementById('tapeBoot');
try {
  const res = await fetch('/tapeid/app.js.gz');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!res.ok || buf[0] === 0x3c) throw new Error(`app.js.gz ${res.status}`);
  const code = buf[0] === 0x1f && buf[1] === 0x8b
    ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(buf);
  await import(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
  boot.remove();
} catch (e) {
  boot.innerHTML = `链上脚本没加载成功（${e.message}）。请刷新重试，或打开普通网址 / Failed to load from chain — reload or use `
    + '<a href="https://nand.aihashrate.stream/tapeid/">nand.aihashrate.stream/tapeid</a>';
}
</script>'''
s = (HERE / 'index.html').read_text()
tag = '<script type="module" src="./tapeid_coin.bundle.js"></script>'
assert tag in s
assert '<main>' in s
s = s.replace('<main>', '<main>\n  ' + BOOT, 1).replace(tag, LOADER).replace('https://nand.aihashrate.stream/tapeid/tapeid-default.png', '/tapeid/tapeid-default.svg')
(OUT / 'index.html').write_text(s)
for f in sorted(OUT.iterdir()):
    print(f'{f.stat().st_size:>9}  tapeid/{f.name}')
