// IGNIX 发币全流程只读演练：临时空钱包（私钥只在内存）→ 签 challenge → 取平台签名并逐项核对 → createToken 链上模拟 → 预演金库收款人。
// 不发任何交易、不花钱；副作用仅是 IGNIX 服务器为临时钱包签出一份永不使用的发币签名。node test_ignix_dry.mjs
import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { xLayer } from 'viem/chains';
import fs from 'node:fs';
const ABI = JSON.parse(fs.readFileSync(new URL('./src/ignix_abi.json', import.meta.url)));
const tmp = new URL('./_ignix_node.mjs', import.meta.url);
fs.writeFileSync(tmp, fs.readFileSync(new URL('./src/ignix.js', import.meta.url), 'utf8').replace("import ABI from './ignix_abi.json';", `const ABI = ${JSON.stringify(ABI)};`));
const { prepareLaunch } = await import(tmp.href);
fs.unlinkSync(tmp);
const acct = privateKeyToAccount(generatePrivateKey());
const pub = createPublicClient({ chain: xLayer, transport: http('https://rpc.xlayer.tech') });
const wallet = createWalletClient({ account: acct, chain: xLayer, transport: http('https://rpc.xlayer.tech') });
const ov = [{ address: acct.address, balance: 10n ** 18n }];
const pubOv = { simulateContract: (a) => pub.simulateContract({ ...a, stateOverride: ov }) };
const recipients = [{ address: '0x69C2a4d9bE3b3D30c4f1A6B11e30AeCa3E09B9a5', bps: 8000 }, { address: '0x8283bC0c4944DE7537D4DDA0fF575B31e1804743', bps: 2000 }];
const prep = await prepareLaunch({ wallet, pub: pubOv, account: acct, name: 'TapeID DryRun', symbol: 'TAPEIDT', taxBps: 100, recipients,
  meta: { description: 'dry run, never launched', website: 'https://nand.aihashrate.stream/tapeid/xlayer.html' } });
console.log('临时钱包', acct.address);
console.log('✓ 平台签名 + 参数核对；✓ createToken 模拟；✓ 金库预演', prep.vault.vault, JSON.stringify(prep.vault.recipients));
console.log('  预测币地址', prep.predicted, '| 上币费', formatEther(prep.listingFee), 'OKB | 曲线费', prep.curveFeeBps, 'bps');
