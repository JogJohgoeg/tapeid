#!/usr/bin/env python3
"""Upload a built dist directory into a TapeOut container's SiteRegistry with a temporary operator key.

  keygen                         create ~/.tapeout_site_op.json (chmod 600), print the operator address
  plan   --chain X --container C --dist D      compare local files with chain (fileInfo size+sha), print what to send
  upload --chain X --container C --dist D      putFile / appendChunk every missing or changed file, resumable
  verify --chain X --container C --dist D      every file's on-chain size + sha256 == local
  refund --chain X --to ADDR                   send the operator's remaining balance back

Chains: bsc (registry 0xd006…, chain 56, gas ≥0.05 gwei) | xlayer (registry 0xd6ef…, chain 196).
Interface from TapeKit SPEC Appendix B.5: putFile(container,path,contentType,sha256,data≤24000) writes chunk 0 and
replaces an existing file; appendChunk(container,path,expectIndex,data) appends; fileInfo → (size,contentType,sha,updatedAt,chunkCount).
The operator must have been authorized with setOperator(container, op, ttl) by the holder (xlayer_setup.html step 4).
Never prints the private key.
"""
import argparse, hashlib, json, mimetypes, os, sys, time
from pathlib import Path
from web3 import Web3
from eth_account import Account

CHUNK = 24_000
CHAINS = {
    'bsc': dict(chainId=56, rpc=os.environ.get('BSC_RPC_URL') or 'https://bsc-dataseed.bnbchain.org',
                registry='0xd006ffdd5ae313b17729621a00999cd3c71ce5e6', minGwei=0.05, explorer='https://bscscan.com/tx/'),
    'xlayer': dict(chainId=196, rpc=os.environ.get('XLAYER_RPC_URL') or 'https://rpc.xlayer.tech',
                   registry='0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6', minGwei=0.02, explorer='https://www.oklink.com/xlayer/tx/'),
}
ABI = json.loads('''[
 {"type":"function","name":"putFile","stateMutability":"nonpayable","inputs":[{"name":"container","type":"address"},{"name":"path","type":"string"},{"name":"contentType","type":"string"},{"name":"sha256Hash","type":"bytes32"},{"name":"data","type":"bytes"}],"outputs":[]},
 {"type":"function","name":"appendChunk","stateMutability":"nonpayable","inputs":[{"name":"container","type":"address"},{"name":"path","type":"string"},{"name":"expectIndex","type":"uint256"},{"name":"data","type":"bytes"}],"outputs":[]},
 {"type":"function","name":"removeFile","stateMutability":"nonpayable","inputs":[{"name":"container","type":"address"},{"name":"path","type":"string"}],"outputs":[]},
 {"type":"function","name":"setFallback","stateMutability":"nonpayable","inputs":[{"name":"container","type":"address"},{"name":"path","type":"string"}],"outputs":[]},
 {"type":"function","name":"fileInfo","stateMutability":"view","inputs":[{"name":"container","type":"address"},{"name":"path","type":"string"}],"outputs":[{"name":"size","type":"uint32"},{"name":"contentType","type":"string"},{"name":"sha256Hash","type":"bytes32"},{"name":"updatedAt","type":"uint40"},{"name":"chunkCount","type":"uint256"}]},
 {"type":"function","name":"pathCount","stateMutability":"view","inputs":[{"name":"container","type":"address"}],"outputs":[{"name":"","type":"uint256"}]},
 {"type":"function","name":"pathsRange","stateMutability":"view","inputs":[{"name":"container","type":"address"},{"name":"from","type":"uint256"},{"name":"n","type":"uint256"}],"outputs":[{"name":"","type":"string[]"}]},
 {"type":"function","name":"isOpenedContainer","stateMutability":"view","inputs":[{"name":"container","type":"address"}],"outputs":[{"name":"","type":"bool"}]}
]''')
KEYFILE = Path.home() / '.tapeout_site_op.json'
MIME = {'.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
        '.wasm': 'application/wasm', '.gz': 'application/gzip', '.nlz': 'application/octet-stream', '.spz': 'application/octet-stream',
        '.onnx': 'application/octet-stream', '.glb': 'model/gltf-binary', '.xml': 'application/xml', '.svg': 'image/svg+xml',
        '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
        '.jinja': 'text/plain; charset=utf-8', '.pid': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8'}


def content_type(path):
    ext = Path(path).suffix.lower()
    return MIME.get(ext) or mimetypes.guess_type(path)[0] or 'application/octet-stream'


def load_key():
    if not KEYFILE.exists():
        sys.exit(f'{KEYFILE} 不存在：先 keygen')
    return Account.from_key(json.loads(KEYFILE.read_text())['key'])


def local_files(dist):
    out = []
    for f in sorted(Path(dist).rglob('*')):
        if f.is_file() and f.name != '.manifest.json' and not f.name.startswith('.DS_'):
            data = f.read_bytes()
            out.append((f.relative_to(dist).as_posix(), data, hashlib.sha256(data).digest()))
    return out


def connect(chain):
    c = CHAINS[chain]
    w3 = Web3(Web3.HTTPProvider(c['rpc'], request_kwargs={'timeout': 60}))
    assert w3.eth.chain_id == c['chainId'], f'RPC chain id {w3.eth.chain_id} != {c["chainId"]}'
    return w3, c, w3.eth.contract(address=Web3.to_checksum_address(c['registry']), abi=ABI)


def state_of(reg, container, path):
    size, ctype, sha, upd, n = reg.functions.fileInfo(container, path).call()
    return dict(size=size, sha=bytes(sha), chunks=n)


def cmd_keygen(a):
    if KEYFILE.exists():
        acct = load_key(); print('已有操作员密钥，地址', acct.address); return
    acct = Account.create()
    KEYFILE.write_text(json.dumps({'key': acct.key.hex(), 'address': acct.address, 'created': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}))
    os.chmod(KEYFILE, 0o600)
    print('操作员地址', acct.address, '（密钥在', KEYFILE, '，别打印）')


def plan(a, quiet=False):
    w3, c, reg = connect(a.chain)
    container = Web3.to_checksum_address(a.container)
    assert reg.functions.isOpenedContainer(container).call(), '容器未开通'
    todo, same, total = [], 0, 0
    for path, data, sha in local_files(a.dist):
        st = state_of(reg, container, path)
        if st['chunks'] and st['size'] == len(data) and st['sha'] == sha:
            same += 1
            continue
        todo.append((path, data, sha, st))
        total += len(data)
    if not quiet:
        print(f'{a.chain} 容器 {container}: 已一致 {same} 个；待传 {len(todo)} 个，{total/1e6:.2f} MB，约 {sum(max(1,-(-len(d)//CHUNK)) for _,d,_,_ in todo)} 笔')
        for path, data, sha, st in todo:
            print(f'  {len(data):>9}  {path}' + (f'  (链上 size={st["size"]} chunks={st["chunks"]}，将重写)' if st['chunks'] else ''))
    return w3, c, reg, container, todo


def cmd_plan(a): plan(a)


def cmd_upload(a):
    w3, c, reg, container, todo = plan(a, quiet=True)
    acct = load_key()
    bal = w3.eth.get_balance(acct.address)
    gas_price = max(w3.eth.gas_price, int(c['minGwei'] * 1e9))
    print(f'操作员 {acct.address} 余额 {bal/1e18:.5f}，gasPrice {gas_price/1e9:.4f} gwei，待传 {len(todo)} 个文件')
    nonce = w3.eth.get_transaction_count(acct.address, 'pending')
    sent = 0

    def send(fn, label, nbytes):
        nonlocal nonce
        tx = fn.build_transaction({'from': acct.address, 'nonce': nonce, 'gasPrice': gas_price, 'chainId': c['chainId'],
                                   'gas': min(16_500_000, 400_000 + nbytes * 260)})
        try:
            est = w3.eth.estimate_gas({k: v for k, v in tx.items() if k in ('from', 'to', 'data', 'value')})
            tx['gas'] = min(16_500_000, int(est * 1.15) + 50_000)
        except Exception as e:
            sys.exit(f'{label}: 模拟失败，不发：{str(e)[:300]}')
        _st = acct.sign_transaction(tx)
        raw = getattr(_st, 'raw_transaction', None) or _st.rawTransaction
        h = w3.eth.send_raw_transaction(raw)
        rc = w3.eth.wait_for_transaction_receipt(h, timeout=300)
        if rc.status != 1:
            sys.exit(f'{label}: 交易回滚 {h.hex()}')
        nonce += 1
        return rc

    for path, data, sha, st in todo:
        chunks = [data[i:i + CHUNK] for i in range(0, len(data), CHUNK)] or [b'']
        start = 0
        # resume: an unfinished upload of the same bytes keeps its chunks (chunkCount tells where we stopped);
        # any other mismatch is rewritten from chunk 0 (putFile replaces the whole file)
        if st['chunks'] and st['sha'] == sha and st['size'] == len(data) and st['chunks'] < len(chunks):
            start = st['chunks']
        elif st['chunks'] and not (st['sha'] == sha and st['size'] == len(data)):
            start = 0
        if start == 0:
            rc = send(reg.functions.putFile(container, path, content_type(path), sha, chunks[0]), f'putFile {path}', len(chunks[0]))
            sent += 1; start = 1
            print(f'  putFile   {path} 1/{len(chunks)} gas {rc.gasUsed}', flush=True)
        for i in range(start, len(chunks)):
            rc = send(reg.functions.appendChunk(container, path, i, chunks[i]), f'appendChunk {path} #{i}', len(chunks[i]))
            sent += 1
            print(f'  append    {path} {i+1}/{len(chunks)} gas {rc.gasUsed}', flush=True)
        st2 = state_of(reg, container, path)
        ok = st2['size'] == len(data) and st2['sha'] == sha and st2['chunks'] == len(chunks)
        print(f'  {"OK " if ok else "BAD"} {path} size {st2["size"]} chunks {st2["chunks"]}', flush=True)
        if not ok:
            sys.exit('链上状态与本地不符，停止')
    print(f'完成：{sent} 笔；操作员余额 {w3.eth.get_balance(acct.address)/1e18:.5f}')


def cmd_verify(a):
    w3, c, reg, container, todo = plan(a, quiet=True)
    n = reg.functions.pathCount(container).call()
    onchain = set()
    for i in range(0, n, 200):
        onchain.update(reg.functions.pathsRange(container, i, 200).call())
    local = {p for p, _, _ in local_files(a.dist)}
    print(f'链上 {n} 个路径，本地 {len(local)}；待传/不一致 {len(todo)}；链上多出 {sorted(onchain - local)}')
    sys.exit(0 if not todo else 1)


def cmd_refund(a):
    w3, c, reg = connect(a.chain)
    acct = load_key()
    gas_price = max(w3.eth.gas_price, int(c['minGwei'] * 1e9))
    bal = w3.eth.get_balance(acct.address)
    value = bal - 21_000 * gas_price
    if value <= 0:
        print('余额不足以退款'); return
    tx = {'from': acct.address, 'to': Web3.to_checksum_address(a.to), 'value': value, 'gas': 21_000, 'gasPrice': gas_price,
          'nonce': w3.eth.get_transaction_count(acct.address, 'pending'), 'chainId': c['chainId']}
    _st = acct.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(getattr(_st, 'raw_transaction', None) or _st.rawTransaction)
    rc = w3.eth.wait_for_transaction_receipt(h, timeout=300)
    print('退款', value / 1e18, '→', a.to, 'status', rc.status, c['explorer'] + h.hex())


ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sub = ap.add_subparsers(dest='cmd', required=True)
sub.add_parser('keygen').set_defaults(f=cmd_keygen)
for name, f in (('plan', cmd_plan), ('upload', cmd_upload), ('verify', cmd_verify)):
    p = sub.add_parser(name); p.add_argument('--chain', required=True, choices=CHAINS); p.add_argument('--container', required=True); p.add_argument('--dist', required=True); p.set_defaults(f=f)
p = sub.add_parser('refund'); p.add_argument('--chain', required=True, choices=CHAINS); p.add_argument('--to', required=True); p.set_defaults(f=cmd_refund)
a = ap.parse_args()
a.f(a)
