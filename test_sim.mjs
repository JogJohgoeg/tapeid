// 只读验证：用发币页同样的参数对 Base 主网做 eth_call 模拟，并核对编码进交易的分成。不签名、不发交易。
import { createPublicClient, http, getAddress, decodeFunctionData } from 'viem';
import { base } from 'viem/chains';
import { Clanker } from 'clanker-sdk/v4';
import { FEE_CONFIGS, POOL_POSITIONS, WETH_ADDRESSES } from 'clanker-sdk';
const me = getAddress('0xc9059e0f59f40920e5bd24307eaa4defd81df145');
const pub = createPublicClient({ chain: base, transport: http('https://base-rpc.publicnode.com') });
const c = new Clanker({ publicClient: pub });
const cfg = {
  chainId: base.id, name: '21 NAND Driver', symbol: 'TAPEID', image: 'https://nand.aihashrate.stream/tapeid/21-nand-driver.png', tokenAdmin: me,
  metadata: { description: 'test', socialMediaUrls: [{ platform: 'website', url: 'https://nand.aihashrate.stream/' }] },
  context: { interface: 'TapeID Launch', platform: '', messageId: '', id: '' },
  pool: { pairedToken: WETH_ADDRESSES[base.id], positions: POOL_POSITIONS.Standard },
  fees: FEE_CONFIGS.StaticBasic,
  rewards: { recipients: [
    { recipient: me, admin: me, bps: 8000, token: 'Paired' },
    { recipient: me, admin: me, bps: 2000, token: 'Paired' } ] },
  vanity: false,
};
const tx = await c.getDeployTransaction(cfg);
console.log('factory', tx.address, 'fn', tx.functionName, 'value', String(tx.value ?? 0n));
const lc = tx.args[0].lockerConfig;
console.log('locker', lc.locker, 'rewardBps', lc.rewardBps, 'recipients', lc.rewardRecipients, 'admins', lc.rewardAdmins, 'feePreference', lc.feePreference ?? '(in lockerData)');
const r = await c.deploySimulate(cfg, { address: me, type: 'json-rpc' });
if (r.error) { console.log('SIM ERROR', r.error.data ?? '', String(r.error.error?.shortMessage ?? r.error.error?.message ?? r.error).slice(0,1500)); process.exit(1); }
console.log('SIM OK predicted token', r.result); if (lc.locker.toLowerCase() !== '0xffa37784d619f228d8b379d287a4d7282e500762') throw new Error('unexpected locker');
