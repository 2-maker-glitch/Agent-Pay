#!/usr/bin/env node
/**
 * Deploy AgentPayVault to BOT Chain MAINNET (677) against the real, bridged USDT.
 *
 * Dry-run by default — it only estimates. Nothing is signed or sent unless you
 * pass --fire, because the gas comes out of the ops float.
 *
 *   node scripts/deploy-mainnet.cjs            # estimate only
 *   node scripts/deploy-mainnet.cjs --fire     # actually deploy
 *
 * After a successful deploy, restart the paid endpoint against it:
 *   DEPLOYMENT=677 pm2 restart agentpay --update-env
 */
const fs = require('fs');
const { JsonRpcProvider, Wallet, ContractFactory, Contract, formatEther, formatUnits } = require('ethers');
const L = require('./lib.cjs');

const REAL_USDT = '0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C';
const OPS_KEY = '/root/.hermes/wallets/botchain-ops.json';
const FIRE = process.argv.includes('--fire');

const ERC20 = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'];

(async () => {
  const p = new JsonRpcProvider(L.MAINNET.rpc, L.MAINNET.chainId, { staticNetwork: true });
  const j = JSON.parse(fs.readFileSync(OPS_KEY, 'utf8'));
  const deployer = new Wallet(j.privateKey || j.private_key || j.key, p);
  const fee = await p.getFeeData();

  const { artifacts } = L.compile();
  const f = new ContractFactory(artifacts.AgentPayVault.abi, artifacts.AgentPayVault.bytecode, deployer);
  const unsigned = await f.getDeployTransaction(REAL_USDT);
  const gas = await p.estimateGas({ ...unsigned, from: deployer.address });
  const cost = gas * fee.gasPrice;
  const bal = await p.getBalance(deployer.address);

  const usdt = new Contract(REAL_USDT, ERC20, p);
  console.log(`network    ${L.MAINNET.name} (${L.MAINNET.chainId})`);
  console.log(`token      ${REAL_USDT}  ${await usdt.symbol()} ${Number(await usdt.decimals())}dp`);
  console.log(`deployer   ${deployer.address}`);
  console.log(`balance    ${formatEther(bal)} BOT`);
  console.log(`cost       ${gas} gas @ ${(Number(fee.gasPrice) / 1e9).toFixed(1)} gwei = ${formatEther(cost)} BOT (~${Math.floor(Number(formatEther(cost)) / 0.0008)} votes)`);
  console.log(`after      ${formatEther(bal - cost)} BOT`);

  if (!FIRE) return console.log('\nDRY RUN — nothing sent. Re-run with --fire to deploy.');

  const vault = await f.deploy(REAL_USDT, { gasPrice: fee.gasPrice, gasLimit: gas * 2n });
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  const domain = await new Contract(vaultAddr, artifacts.AgentPayVault.abi, p).domainSeparator();

  const out = {
    network: L.MAINNET.name, chainId: L.MAINNET.chainId, rpc: L.MAINNET.rpc, explorer: L.MAINNET.explorer,
    deployedAt: new Date().toISOString(),
    token: REAL_USDT, vault: vaultAddr,
    // payee = the facilitator key (chain-independent address); filled in properly on first settlement
    payee: L.wallet('facilitator', L.MAINNET).address,
    domainSeparator: domain,
    abi: { MockUSDT: artifacts.MockUSDT.abi, AgentPayVault: artifacts.AgentPayVault.abi },
    deployer: deployer.address,
  };
  L.writeJson(`${L.DEPLOY_DIR}/${L.MAINNET.chainId}.json`, out);

  console.log('\ndeployed  ' + vaultAddr);
  console.log('payee     ' + out.payee);
  console.log('domain    ' + domain);
  console.log('saved     deployments/677.json');
  console.log('toggle    DEPLOYMENT=677 pm2 restart agentpay --update-env');
  console.log('explorer  ' + L.MAINNET.explorer + '/address/' + vaultAddr);
})().catch((e) => { console.error('FAILED:', e.shortMessage || e.message); process.exit(1); });
