"""X Layer 链上版（1.2.245 容器站点，根目录）打包：xlayer.html + 脚本 gzip 存链上页内解压 + 256px logo。

npm run build && python3 tape_dist_xl.py   → dist_xl/{index.html, app.js.gz, claim.html, claim.js.gz, tapeid-default.png, 21-nand-driver.png, tapeid-default.svg}
上传：hashport/site_upload.py plan|upload|verify --chain xlayer --container 0x75c6E2D063963561c08c838476111adda7a1a6CD --dist dist_xl
"""
import shutil, subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'dist_xl'
shutil.rmtree(OUT, ignore_errors=True)
OUT.mkdir()
for n in ('tapeid-default', '21-nand-driver'):
    subprocess.run(['sips', '-Z', '256', str(HERE / 'logo' / f'{n}.png'), '--out', str(OUT / f'{n}.png')], check=True, capture_output=True)
shutil.copyfile(HERE / 'logo' / 'tapeid-default.svg', OUT / 'tapeid-default.svg')
BOOT = '<p id="tapeBoot" style="text-align:center;color:#888;margin:8px 0 16px">正在从 X Layer 链上加载… / Loading from X Layer…</p>'
def loader(gz, fallback):
    return f'''<script type="module">
// 链上版：脚本以 gzip 存在容器里，浏览器里解压后运行（网关若已自动解压则直接运行）。一律用绝对路径。
const boot = document.getElementById('tapeBoot');
try {{
  const res = await fetch('/{gz}');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!res.ok || buf[0] === 0x3c) throw new Error(`{gz} ${{res.status}}`);
  const code = buf[0] === 0x1f && buf[1] === 0x8b
    ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(buf);
  await import(URL.createObjectURL(new Blob([code], {{ type: 'text/javascript' }})));
  boot.remove();
}} catch (e) {{
  boot.innerHTML = `链上脚本没加载成功（${{e.message}}）。请刷新重试，或打开普通网址 / Failed to load — reload or use `
    + '<a href="{fallback}">{fallback}</a>';
}}
</script>'''

def page(src, bundle, gz, out, fallback):
    (OUT / gz).write_bytes(subprocess.run(['gzip', '-9', '-n', '-c', str(HERE / bundle)], check=True, capture_output=True).stdout)
    s = (HERE / src).read_text()
    tag = f'<script type="module" src="./{bundle}"></script>'
    assert tag in s and '<main>' in s, src
    s = s.replace('<main>', '<main>\n  ' + BOOT, 1).replace(tag, loader(gz, fallback))
    s = s.replace('<a href="./">Base 版</a>', '<a href="https://nand.aihashrate.stream/tapeid/">Base 版</a>')
    s = s.replace('href="./xlayer.html"', 'href="/"').replace('href="./claim.html"', 'href="/claim.html"')
    (OUT / out).write_text(s)

page('xlayer.html', 'xlayer.bundle.js', 'app.js.gz', 'index.html', 'https://nand.aihashrate.stream/tapeid/xlayer.html')
page('claim.html', 'claim.bundle.js', 'claim.js.gz', 'claim.html', 'https://nand.aihashrate.stream/tapeid/claim.html')
for f in sorted(OUT.iterdir()):
    print(f'{f.stat().st_size:>9}  {f.name}')
