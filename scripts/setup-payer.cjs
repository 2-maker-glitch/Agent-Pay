#!/usr/bin/env node
/**
 * Fund and prime the paying agent on testnet 968:
 *   - create .keys/agent.json if missing
 *   - give it gas (testnet BOT) from the deployer
 *   - mint test USDT to it
 *   - approve the vault and make the one-time deposit
 *
 * After this the agent never needs gas again — every paid call is a signature.
 */
const { Contract, parseUnits, formatEther, formatUnits } = require('ethers');
const L = require('./lib.cjs');

const ERC20 = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function mint(address,uint256)',
];
const VAULT = ['function balance(address) view returns (uint256)', 'function deposit(uint256)'];

(async () => {
  const net = L.TESTNET;
  const dep = L.readJson(`${L.DEPLOY_DIR}/${net.chainId}.json`);
  const { wallet: deployer } = L.loadDeployer(net);
  const agent = L.wallet('agent', net).connect(L.provider(net));
  const fee = await agent.provider.getFeeData();

  console.log('agent', agent.address);

  let gasTx = null;
  const gas = await agent.provider.getBalance(agent.address);
  if (gas < parseUnits('0.1', 18)) {
    const tx = await deployer.sendTransaction({ to: agent.address, value: parseUnits('0.5', 18), gasPrice: fee.gasPrice });
    gasTx = (await tx.wait()).hash;
  }
  console.log('agent gas', formatEther(await agent.provider.getBalance(agent.address)), 'BOT', gasTx ? `(funded ${gasTx})` : '');

  const tokenAsDeployer = new Contract(dep.token, ERC20, deployer);
  const token = new Contract(dep.token, ERC20, agent);
  const want = parseUnits('50', 6);
  if ((await token.balanceOf(agent.address)) < want) {
    const rc = await (await tokenAsDeployer.mint(agent.address, want, { gasPrice: fee.gasPrice })).wait();
    console.log('minted 50 test USDT to agent in', rc.hash);
  }
  console.log('agent USDT', formatUnits(await token.balanceOf(agent.address), 6));

  const vaultApprove = await token.approve(dep.vault, parseUnits('100', 6), { gasPrice: fee.gasPrice });
  await vaultApprove.wait();
  console.log('approved vault', vaultApprove.hash);

  const vault = new Contract(dep.vault, VAULT, agent);
  const depTx = await vault.deposit(parseUnits('5', 6), { gasPrice: fee.gasPrice, gasLimit: 200000n });
  await depTx.wait();
  console.log('deposited 5 USDT into vault', depTx.hash);
  console.log('vault credit for agent', formatUnits(await vault.balance(agent.address), 6), 'USDT');
  console.log('agent wallet USDT left', formatUnits(await token.balanceOf(agent.address), 6));
})().catch((e) => { console.error('SETUP FAILED:', e.shortMessage || e.message); process.exit(1); });
