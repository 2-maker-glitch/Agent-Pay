/** What does one batch-settlement actually cost in gas? Read the last few settle() txs. */
const { JsonRpcProvider, Contract, formatEther } = require('ethers');
const fs = require('fs');
const L = require('/root/botchain-mcp/scripts/lib.cjs');

(async () => {
  const dep = L.readJson('/root/botchain-mcp/deployments/968.json');
  const p = new JsonRpcProvider(L.TESTNET.rpc, L.TESTNET.chainId, { staticNetwork: true });
  const used = JSON.parse(fs.readFileSync('/root/botchain-mcp/.state/used.json', 'utf8'));
  const hashes = Object.values(used).map((x) => x.txHash).slice(-6);
  let sum = 0n, n = 0;
  for (const h of hashes) {
    const rc = await p.getTransactionReceipt(h).catch(() => null);
    if (!rc) continue;
    const tx = await p.getTransaction(h);
    const cost = rc.gasUsed * tx.gasPrice;
    sum += cost; n++;
    console.log(`  ${h.slice(0, 20)}… gas ${rc.gasUsed} @ ${(Number(tx.gasPrice) / 1e9).toFixed(1)} gwei = ${formatEther(cost)} BOT`);
  }
  if (n) {
    const avg = sum / BigInt(n);
    console.log(`\n  average settle() cost: ${formatEther(avg)} BOT  (${n} settlements measured)`);
    console.log(`  ≈ $${(Number(formatEther(avg)) * 0.5).toFixed(6)} at a token price of $0.50/BOT (illustrative)`);
  }
  const vault = new Contract(dep.vault, ['function settleCount() view returns (uint256)'], p);
  console.log(`  total settlements on chain: ${await vault.settleCount()}`);
})().catch((e) => console.error('FAIL', e.shortMessage || e.message));
