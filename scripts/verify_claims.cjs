const { JsonRpcProvider, ethers, id, Interface } = require('/root/botchain-mcp/node_modules/ethers');

const TESTNET = 'https://rpc.bohr.life';
const MAINNET = 'https://rpc.botchain.ai';
const VAULT = '0xD6ee2f19c7973baa8146A3B7D494983a59462586';
const TEST_TOKEN = '0x4D3f154CF36a1033e0e5254c30518416f6ffc5c1';
const MAIN_USDT = '0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C';
const PAYEE = '0x7b65fA9ae72EeF34d0092209070a81e9dCD49E5a';

function sel(sig) { return id(sig).slice(0, 10); }

async function call(p, to, data) {
  return await p.call({ to, data });
}

async function main() {
  const t = new JsonRpcProvider(TESTNET);
  const m = new JsonRpcProvider(MAINNET);

  console.log('=== TESTNET 968 ===');
  const tChain = await t.send('eth_chainId', []);
  const tBlock = await t.getBlockNumber();
  console.log('chainId:', tChain, '=', parseInt(tChain, 16), '| block:', tBlock);

  const code = await t.getCode(VAULT);
  console.log('vault bytecode length:', code.length > 2 ? (code.length - 2) / 2 : 0, 'bytes');

  const stats = await call(t, VAULT, sel('vaultStats()'));
  const [count, total, held] = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256', 'uint256'], stats);
  console.log('vaultStats(): count =', count.toString(), '| totalSettled =', total.toString(), 'raw units =', ethers.formatUnits(total, 6), 'USDT | held =', held.toString(), 'raw =', ethers.formatUnits(held, 6), 'USDT');

  const tok = await call(t, VAULT, sel('token()'));
  const tokAddr = '0x' + tok.slice(-40);
  console.log('vault.token() =', tokAddr, tokAddr.toLowerCase() === TEST_TOKEN.toLowerCase() ? '(MATCHES deployment)' : '(MISMATCH!)');

  // token identity
  const sym = await call(t, TEST_TOKEN, sel('symbol()'));
  const dec = await call(t, TEST_TOKEN, sel('decimals()'));
  console.log('token symbol =', ethers.AbiCoder.defaultAbiCoder().decode(['string'], sym)[0],
    '| decimals =', ethers.AbiCoder.defaultAbiCoder().decode(['uint8'], dec)[0]);

  const payeeBal = await call(t, VAULT, sel('balance(address)') + PAYEE.slice(2).padStart(64, '0'));
  console.log('payee vault balance =', ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], payeeBal)[0].toString(), 'raw =', ethers.formatUnits(ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], payeeBal)[0], 6), 'USDT');

  console.log('\n=== MAINNET 677 ===');
  const mChain = await m.send('eth_chainId', []);
  const mBlock = await m.getBlockNumber();
  console.log('chainId:', mChain, '=', parseInt(mChain, 16), '| block:', mBlock);
  const usdtCode = await m.getCode(MAIN_USDT);
  console.log('mainnet USDT bytecode length:', usdtCode.length > 2 ? (usdtCode.length - 2) / 2 : 0, 'bytes (0 = no code!)');

  if (usdtCode.length > 2) {
    const name = ethers.AbiCoder.defaultAbiCoder().decode(['string'], await call(m, MAIN_USDT, sel('name()')))[0];
    const usym = ethers.AbiCoder.defaultAbiCoder().decode(['string'], await call(m, MAIN_USDT, sel('symbol()')))[0];
    const udec = ethers.AbiCoder.defaultAbiCoder().decode(['uint8'], await call(m, MAIN_USDT, sel('decimals()')))[0];
    console.log('token:', name, '|', usym, '|', udec, 'decimals');

    const scan = {
      'permit (EIP-2612)': 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
      'transferWithAuthorization (EIP-3009)': 'transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)',
      'receiveWithAuthorization (EIP-3009)': 'receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)',
      'cancelAuthorization (EIP-3009)': 'cancelAuthorization(address,bytes32,uint8,bytes32,bytes32)',
      'authorizationState (EIP-3009)': 'authorizationState(address,bytes32)',
    };
    const low = usdtCode.toLowerCase();
    console.log('\nselector scan (does bytecode contain it?):');
    for (const [label, sig] of Object.entries(scan)) {
      const s = sel(sig).slice(2).toLowerCase();
      console.log('  ', low.includes(s) ? 'FOUND' : 'absent', '—', label, sel(sig));
    }
  }
}

main().catch(e => { console.error('ERR', e.message); process.exit(1); });
