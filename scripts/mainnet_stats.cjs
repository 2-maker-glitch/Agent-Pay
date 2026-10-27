const { JsonRpcProvider, ethers, id } = require('/root/botchain-mcp/node_modules/ethers');
const M = 'https://rpc.botchain.ai';
const V = '0xAd06420D3e247186195189ed0DF571Cdce9f038C';
const USDT = '0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C';
const sel = (s) => id(s).slice(0, 10);
const D = (types, data) => ethers.AbiCoder.defaultAbiCoder().decode(types, data);

(async () => {
  const m = new JsonRpcProvider(M);
  const stats = D(['uint256', 'uint256', 'uint256'], await m.call({ to: V, data: sel('vaultStats()') }));
  console.log('mainnet vaultStats: settleCount =', stats[0].toString(),
    '| totalSettled =', stats[1].toString(), '=', ethers.formatUnits(stats[1], 6), 'USDT',
    '| held =', ethers.formatUnits(stats[2], 6), 'USDT');
  const dom = await m.call({ to: V, data: sel('domainSeparator()') });
  console.log('domainSeparator:', dom.slice(0, 18) + '…');
  const heldRaw = D(['uint256'], await m.call({ to: USDT, data: sel('balanceOf(address)') + V.slice(2).padStart(64, '0') }))[0];
  console.log('USDT balance OF vault (on-chain):', ethers.formatUnits(heldRaw, 6), 'USDT');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
