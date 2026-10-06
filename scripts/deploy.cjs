#!/usr/bin/env node
/**
 * Deploy the AgentPay rail to BOT Chain testnet (bohr, chainId 968):
 *   1. MockUSDT        — 6-decimal Tether-style token (no permit, no EIP-3009)
 *   2. AgentPayVault   — prepaid balances + EIP-712 voucher batch settlement
 * Then seed supply and fund the facilitator's gas.
 *
 * Usage: node scripts/deploy.cjs
 */
const { ContractFactory, Contract, formatEther, parseUnits } = require('ethers');
const L = require('./lib.cjs');

(async () => {
  const net = L.TESTNET;
  console.log(`Deploying to ${net.name} (chainId ${net.chainId}) — ${net.rpc}`);

  const { artifacts, warnings } = L.compile();
  if (warnings.length) console.log(`solc warnings: ${warnings.length}`);
  for (const n of ['MockUSDT', 'AgentPayVault']) if (!artifacts[n]) throw new Error(`${n} artifact missing`);
  console.log('compiled: MockUSDT', artifacts.MockUSDT.bytecode.length / 2 - 1, 'bytes ·  AgentPayVault', artifacts.AgentPayVault.bytecode.length / 2 - 1, 'bytes');

  const { wallet: deployer, path: deployerPath } = L.loadDeployer(net);
  const bal = await deployer.provider.getBalance(deployer.address);
  console.log('deployer', deployer.address, '·', formatEther(bal), 'testnet BOT');
  if (bal === 0n) throw new Error('deployer has no testnet BOT');

  const fee = await deployer.provider.getFeeData();

  const usdtF = new ContractFactory(artifacts.MockUSDT.abi, artifacts.MockUSDT.bytecode, deployer);
  const usdt = await usdtF.deploy({ gasPrice: fee.gasPrice });
  await usdt.waitForDeployment();
  const tokenAddr = await usdt.getAddress();
  console.log('MockUSDT deployed  ', tokenAddr);

  const vaultF = new ContractFactory(artifacts.AgentPayVault.abi, artifacts.AgentPayVault.bytecode, deployer);
  const vault = await vaultF.deploy(tokenAddr, { gasPrice: fee.gasPrice });
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log('AgentPayVault deployed', vaultAddr);

  // seed the deployer with test USDT so it can hand some to the paying agent
  const seed = parseUnits('1000000', 6);
  const mintRc = await L.send(new Contract(tokenAddr, artifacts.MockUSDT.abi, deployer), 'mint', [deployer.address, seed], deployer, { fallbackGas: 200000n });
  console.log('minted 1,000,000 test USDT in', mintRc.hash);

  // facilitator = the payee + gas payer for settlement
  const facilitator = L.wallet('facilitator', net);
  const fBal = await facilitator.provider.getBalance(facilitator.address);
  let fundTx = null;
  if (fBal < parseUnits('0.2', 18)) {
    const tx = await deployer.sendTransaction({ to: facilitator.address, value: parseUnits('1.0', 18), gasPrice: fee.gasPrice });
    const rc = await tx.wait();
    fundTx = rc.hash;
  }
  const fBal2 = await facilitator.provider.getBalance(facilitator.address);

  const domain = await new Contract(vaultAddr, artifacts.AgentPayVault.abi, deployer.provider).domainSeparator();

  const out = {
    network: net.name,
    chainId: net.chainId,
    rpc: net.rpc,
    explorer: net.explorer,
    deployedAt: new Date().toISOString(),
    token: tokenAddr,
    vault: vaultAddr,
    payee: facilitator.address,
    domainSeparator: domain,
    abi: { MockUSDT: artifacts.MockUSDT.abi, AgentPayVault: artifacts.AgentPayVault.abi },
    deployer: deployer.address,
  };
  L.writeJson(`${L.DEPLOY_DIR}/${net.chainId}.json`, out);

  console.log('facilitator/payee ', facilitator.address, '·', formatEther(fBal2), 'BOT', fundTx ? `(funded ${fundTx})` : '');
  console.log('domainSeparator  ', domain);
  console.log('saved             deployments/' + net.chainId + '.json');
  console.log('EXPLORER', `${net.explorer}/address/${vaultAddr}`);
})().catch((e) => { console.error('DEPLOY FAILED:', e.shortMessage || e.message); process.exit(1); });
