// BEM 回购 Safe：由「用户钱包 + 固定编号」确定性算出的 Safe v1.4.1 地址（反事实，先收钱、要用时再部署）。
// 所有者只有用户钱包，阈值 1。算出的地址必须与 SafeProxyFactory.createProxyWithNonce 的 eth_call 结果一致才可用。
import { encodeFunctionData, decodeFunctionResult, encodePacked, getAddress, getContractAddress, keccak256, toHex, zeroAddress } from 'viem';

export const SAFE = {
  factory: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67', // SafeProxyFactory v1.4.1
  singleton: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762', // SafeL2 v1.4.1
  fallbackHandler: '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99', // CompatibilityFallbackHandler v1.4.1
};
export const SALT_LABEL = 'TapeID BEM buyback v1';
export const SALT_NONCE = BigInt(keccak256(toHex(SALT_LABEL)));

const setupAbi = [{ type: 'function', name: 'setup', stateMutability: 'nonpayable', inputs: [
  { name: '_owners', type: 'address[]' }, { name: '_threshold', type: 'uint256' }, { name: 'to', type: 'address' },
  { name: 'data', type: 'bytes' }, { name: 'fallbackHandler', type: 'address' }, { name: 'paymentToken', type: 'address' },
  { name: 'payment', type: 'uint256' }, { name: 'paymentReceiver', type: 'address' }], outputs: [] }];
const factoryAbi = [
  { type: 'function', name: 'proxyCreationCode', stateMutability: 'pure', inputs: [], outputs: [{ type: 'bytes' }] },
  { type: 'function', name: 'createProxyWithNonce', stateMutability: 'nonpayable', inputs: [
    { name: '_singleton', type: 'address' }, { name: 'initializer', type: 'bytes' }, { name: 'saltNonce', type: 'uint256' }],
    outputs: [{ name: 'proxy', type: 'address' }] },
];
const safeAbi = [
  { type: 'function', name: 'getOwners', stateMutability: 'view', inputs: [], outputs: [{ type: 'address[]' }] },
  { type: 'function', name: 'getThreshold', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

export function initializer(owner) {
  return encodeFunctionData({ abi: setupAbi, functionName: 'setup',
    args: [[getAddress(owner)], 1n, zeroAddress, '0x', SAFE.fallbackHandler, zeroAddress, 0n, zeroAddress] });
}

// 返回 { address, deployed }；地址与工厂模拟结果不一致、或已部署但所有者不对时抛错。
export async function buybackSafe(pub, owner) {
  for (const a of Object.values(SAFE)) {
    const code = await pub.getCode({ address: a });
    if (!code || code === '0x') throw new Error(`Safe 合约 ${a} 在当前链上不存在`);
  }
  const init = initializer(owner);
  const creation = await pub.readContract({ address: SAFE.factory, abi: factoryAbi, functionName: 'proxyCreationCode' });
  const salt = keccak256(encodePacked(['bytes32', 'uint256'], [keccak256(init), SALT_NONCE]));
  const bytecode = encodePacked(['bytes', 'uint256'], [creation, BigInt(SAFE.singleton)]);
  const address = getContractAddress({ opcode: 'CREATE2', from: SAFE.factory, salt, bytecode });

  const code = await pub.getCode({ address });
  if (code && code !== '0x') {
    const owners = await pub.readContract({ address, abi: safeAbi, functionName: 'getOwners' });
    const th = await pub.readContract({ address, abi: safeAbi, functionName: 'getThreshold' });
    if (owners.length !== 1 || getAddress(owners[0]) !== getAddress(owner) || th !== 1n)
      throw new Error(`回购 Safe ${address} 已部署，但所有者不是 ${owner}`);
    return { address, deployed: true };
  }
  const data = encodeFunctionData({ abi: factoryAbi, functionName: 'createProxyWithNonce', args: [SAFE.singleton, init, SALT_NONCE] });
  const r = await pub.call({ account: getAddress(owner), to: SAFE.factory, data });
  const simulated = decodeFunctionResult({ abi: factoryAbi, functionName: 'createProxyWithNonce', data: r.data });
  if (getAddress(simulated) !== address) throw new Error(`回购 Safe 地址核验失败：算出 ${address}，工厂模拟 ${simulated}`);
  return { address, deployed: false };
}
