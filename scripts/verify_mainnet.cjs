const { JsonRpcProvider, ethers, id } = require('/root/botchain-mcp/node_modules/ethers');

const MAINNET = 'https://rpc.botchain.ai';
const VAULT = '0xAd06420D3e247186195189ed0DF571Cdce9f038C';
const TESTNET_VAULT = '0xD6ee2f19c7973baa8146A3B7D494983a59462586';
const REAL_USDT = '0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C';
const TEST_TOKEN = '0x4D3f154CF36a1033e0e5254c30518416f6ffc5c1';

const sel = (s) => id(s).slice(0, 10);

async function main() {
  const m = new JsonRpcProvider(MAINNET);
  const cid = await m.send('eth_chainId', []);
  const block = await m.getBlockNumber();
  console.log('chain:', parseInt(cid, 16), '| block:', block, '\n');

  const code = await m.getCode(VAULT);
  const isContract = code !== '0x';
  console.log('=== MAINNET VAULT 0xAd06... ===');
  console.log('deployed:', isContract, `(${isContract ? (code.length - 2) / 2 : 0} bytes code)`);
  if (!isContract) {
    console.log('>> NOT A CONTRACT on 677. Post would be false.');
    // still show what IS there
    console.log('balance:', ethers.formatEther(await m.getBalance(VAULT)), 'BOT | nonce:', await m.getTransactionCount(VAULT));
    return;
  }

  const dec = ethers.AbiCoder.defaultAbiCoder().decode;
  const token = '0x' + (await m.call({ to: VAULT, data: sel('token()') })).slice(-40);
  console.log('vault.token() =', token);
  console.log('  matches real USDT (0xaBabc7…)?', token.toLowerCase() === REAL_USDT.toLowerCase());
  console.log('  matches TEST mock (0x4D3f…)?', token.toLowerCase() === TEST_TOKEN.toLowerCase());

  const stats = dec(['uint256', 'uint256', 'uint256'], await m.call({ to: VAULT, data: sel('vaultStats()') }));
  console.log('vaultStats: count =', stats[0].toString(), '| totalSettled =', stats[1].toString(), '=', ethers.formatUnits(stats[1], 6), 'USDT | held =', ethers.formatUnits(stats[2], 6), 'USDT');

  const dom = await m.call({ to: VAULT, data: sel('domainSeparator()') });
  console.log('domainSeparator present:', dom !== '0x');

  console.log('\n=== testnet vault 0xD6ee… still live? ===');
  const tc = await m.getCode(TESTNET_VAULT); // note: this is on MAINNET rpc — expect empty (testnet is different chain)
  console.log('(queried on mainnet rpc — expected 0x):', tc !== '0x' ? 'has code' : 'no code (correct, it lives on 968)');

  console.log('\n=== real USDT identity ===');
  const sym = dec(['string'], await m.call({ to: REAL_USDT, data: sel('symbol()') }))[0];
  const nm = dec(['string'], await m.call({ to: REAL_USDT, data: sel('name()') }))[0];
  console.log('USDT:', nm, '|', sym);
}

main().catch(e => { console.error('ERR', e.message); process.exit(1); });
