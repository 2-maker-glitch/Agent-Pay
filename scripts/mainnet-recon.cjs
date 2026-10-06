/**
 * Read-only recon: can we deploy AgentPayVault on BOT Chain mainnet (677),
 * with which key, and what does it cost? Nothing is signed or sent here.
 */
const fs = require('fs');
const { JsonRpcProvider, Wallet, ContractFactory, formatEther } = require('ethers');
const L = require('./lib.cjs');

const REAL_USDT = '0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C';

(async () => {
  const p = new JsonRpcProvider(L.MAINNET.rpc, L.MAINNET.chainId, { staticNetwork: true });
  const candidates = [
    ['ops (CrashLab float)', '/root/.hermes/wallets/botchain-ops.json'],
    ['trestle deployer', '/root/botchain-bridge/deployer.json'],
  ];

  const rows = [];
  for (const [name, file] of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const pk = j.privateKey || j.private_key || j.key;
      const w = new Wallet(pk);
      rows.push({ name, addr: w.address, pk, bal: await p.getBalance(w.address) });
    } catch (e) {
      rows.push({ name, err: e.message });
    }
  }
  for (const r of rows) {
    if (r.err) console.log('  ' + r.name + '  ERR ' + r.err);
    else console.log('  ' + r.name.padEnd(22) + r.addr + '  ' + formatEther(r.bal) + ' BOT');
  }

  const { artifacts } = L.compile();
  const payers = rows.filter((r) => r.pk).sort((a, b) => (a.bal < b.bal ? 1 : -1));
  if (!payers.length) return console.log('no usable mainnet key');
  const best = payers[0];

  const w = new Wallet(best.pk, p);
  const f = new ContractFactory(artifacts.AgentPayVault.abi, artifacts.AgentPayVault.bytecode, w);
  const unsigned = await f.getDeployTransaction(REAL_USDT);
  const fee = await p.getFeeData();
  const gas = await p.estimateGas({ ...unsigned, from: w.address });
  const cost = gas * fee.gasPrice;

  console.log('\n  deploy AgentPayVault on mainnet 677 (token = real USDT)');
  console.log('    gas ' + gas.toString() + ' @ ' + (Number(fee.gasPrice) / 1e9).toFixed(1) + ' gwei = ' + formatEther(cost) + ' BOT');
  console.log('    payer: ' + best.name + ' -> ' + (best.bal > cost ? 'AFFORDABLE' : 'TOO EXPENSIVE') + ', leaves ' + formatEther(best.bal - cost) + ' BOT');
  console.log('    that spend equals ~' + Math.floor(Number(formatEther(cost)) / 0.0008) + ' CrashLab votes');
  // sanity: the real token must answer balanceOf
  const t = new (require('ethers').Contract)(REAL_USDT, ['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'], p);
  console.log('    real USDT sanity: ' + (await t.symbol()) + ' ' + Number(await t.decimals()) + 'dp, vault would hold ' + (await t.balanceOf('0x0000000000000000000000000000000000000000')).toString());
})().catch((e) => console.error('RECON FAILED:', e.shortMessage || e.message));
