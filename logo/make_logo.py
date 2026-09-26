"""21 NAND driver logo：用电路 #279 的真实网表（15 输入、21 个 NAND、深度 10、2 输出）画成圆形徽章。

python3 make_logo.py                 →  21-nand-driver.svg
python3 make_logo.py ID TAPE CIRCUIT tapeid-default  →  通用 TapeID 徽章
（再用 headless Chrome 渲染成 1024×1024 PNG）
"""
import json, sys
from pathlib import Path

BIG, TOP, BOTTOM, OUT = (sys.argv[1:5] + [None] * 4)[:4]
BIG, TOP, BOTTOM, OUT = BIG or '21', TOP or 'NAND', BOTTOM or 'DRIVER', OUT or '21-nand-driver'

HERE = Path(__file__).resolve().parent
NL = json.loads((HERE / '../data/dlgn_ctrl.json').read_text())
N_IN, PAIRS, TAPS = NL['nIn'], NL['pairs'], NL['taps']   # farm 编号：0..nIn-1 输入，nIn+i = NAND i
assert len(PAIRS) == 21 and N_IN == 15

# 逻辑层级：输入 = 0，NAND = 1 + max(输入层级)
lvl = {w: 0 for w in range(N_IN)}
for i, (a, b) in enumerate(PAIRS):
    lvl[N_IN + i] = 1 + max(lvl[a], lvl[b])
DEPTH = max(lvl.values())
assert DEPTH == NL['depth'], (DEPTH, NL['depth'])

S, R = 1024, 470           # 画布与徽章半径
cx = cy = S / 2
x0, x1 = 120, 840          # 电路横向范围（层 0 → 层 DEPTH），铺满徽章当背景
cols = {}
for w, l in sorted(lvl.items()):
    cols.setdefault(l, []).append(w)

pos = {}
for l, ws in cols.items():
    x = x0 + (x1 - x0) * l / DEPTH
    span = 700 if l == 0 else min(620, 150 * len(ws))
    for k, w in enumerate(ws):
        y = cy - span / 2 + span * (k + 0.5) / len(ws)
        pos[w] = (x, y)

BG0, BG1 = '#0b1220', '#132640'
WIRE, GATE, HOT, INK = '#2f5d8a', '#e8b04a', '#ffcf6b', '#f3efe4'

out = []
add = out.append
add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">')
add('<defs>'
    f'<radialGradient id="bg" cx="50%" cy="42%" r="65%"><stop offset="0" stop-color="{BG1}"/><stop offset="1" stop-color="{BG0}"/></radialGradient>'
    '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/>'
    '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    f'<clipPath id="disc"><circle cx="{cx}" cy="{cy}" r="{R}"/></clipPath>'
    '</defs>')
add(f'<rect width="{S}" height="{S}" fill="{BG0}"/>')
add(f'<circle cx="{cx}" cy="{cy}" r="{R}" fill="url(#bg)"/>')
add('<g clip-path="url(#disc)" opacity="0.30">')

# 导线：曲线从源到门
def wire(a, b, color, w):
    (xa, ya), (xb, yb) = pos[a], pos[b]
    mx = (xa + xb) / 2
    add(f'<path d="M{xa:.1f},{ya:.1f} C{mx:.1f},{ya:.1f} {mx:.1f},{yb:.1f} {xb - 16:.1f},{yb:.1f}" '
        f'fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round"/>')

on_path = set(TAPS)       # 输出锥：反向标出驱动两路输出的门
stack = list(TAPS)
while stack:
    w = stack.pop()
    if w >= N_IN:
        for s in PAIRS[w - N_IN]:
            if s not in on_path:
                on_path.add(s); stack.append(s)
for i, (a, b) in enumerate(PAIRS):
    g = N_IN + i
    for s in {a, b}:
        wire(s, g, HOT, 4)

# 输入：5 条测距射线 × 3 档，画成小圆点
for w in range(N_IN):
    x, y = pos[w]
    add(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="{WIRE}"/>')

# NAND 门：D 形 + 输出小圈
for i in range(21):
    x, y = pos[N_IN + i]
    h = 30
    add(f'<path d="M{x - 18:.1f},{y - h / 2:.1f} h14 a{h / 2},{h / 2} 0 0 1 0,{h} h-14 z" fill="{GATE}"/>')
    add(f'<circle cx="{x + 15:.1f}" cy="{y:.1f}" r="4.5" fill="none" stroke="{GATE}" stroke-width="3"/>')

# 两路输出：左 / 右 转向
for k, t in enumerate(TAPS):
    x, y = pos[t]
    add(f'<path d="M{x + 20:.1f},{y:.1f} H{x + 70:.1f}" stroke="{HOT}" stroke-width="5"/>')
add('</g>')

# 中央：大号 NAND 门符号里写 21
gx, gy, gh = cx - 5, cy - 80, 300
add('<g filter="url(#glow)">'
    f'<path d="M{gx - 190:.1f},{gy - gh / 2:.1f} h190 a{gh / 2},{gh / 2} 0 0 1 0,{gh} h-190 z" '
    f'fill="{BG0}" fill-opacity="0.82" stroke="{GATE}" stroke-width="14" stroke-linejoin="round"/>'
    f'<circle cx="{gx + gh / 2 + 28:.1f}" cy="{gy:.1f}" r="22" fill="{BG0}" stroke="{GATE}" stroke-width="12"/>'
    f'<path d="M{gx - 250:.1f},{gy - 70:.1f} h60 M{gx - 250:.1f},{gy + 70:.1f} h60 M{gx + gh / 2 + 50:.1f},{gy:.1f} h70" '
    f'stroke="{GATE}" stroke-width="12" stroke-linecap="round"/>'
    '</g>')
add(f'<text x="{gx - 20:.1f}" y="{gy + 62:.1f}" text-anchor="middle" '
    'font-family="Helvetica Neue, Arial Black, Arial, sans-serif" font-weight="900" font-size="190" '
    f'fill="{INK}" letter-spacing="-6">{BIG}</text>')

# 下方字标
add(f'<text x="{cx}" y="{cy + 215}" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" '
    f'font-weight="800" font-size="92" fill="{GATE}" letter-spacing="10">{TOP}</text>')
add(f'<text x="{cx}" y="{cy + 300}" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" '
    f'font-weight="700" font-size="64" fill="{INK}" letter-spacing="16">{BOTTOM}</text>')
add(f'<circle cx="{cx}" cy="{cy}" r="{R - 7}" fill="none" stroke="{GATE}" stroke-width="14"/>')
add('</svg>')

(HERE / f'{OUT}.svg').write_text('\n'.join(out))
print('depth', DEPTH, 'levels', {l: len(ws) for l, ws in sorted(cols.items())}, 'output cone', len(on_path))
