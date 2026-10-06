#!/usr/bin/env node
/**
 * The paying agent — an autonomous client with no gas and no special SDK.
 *
 * 1. GET a paid route           -> 402 + challenge
 * 2. sign the EIP-712 voucher   -> no chain write, no gas
 * 3. re-send with X-PAYMENT     -> facilitator settles on BOT Chain testnet
 * 4. read the data + receipt    -> tx hash you can open on the explorer
 *
 * Usage: node scripts/agent-demo.cjs [baseUrl]
 */
const { formatUnits, Contract, JsonRpcProvider } = require('ethers');
const x402 = require('../src/x402');
const L = require('./lib.cjs');

const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:9681';

async function payAndFetch(pathname, { label, replay = false } = {}) {
  const url = BASE + pathname;
  const agent = L.wallet('agent', L.TESTNET).connect(L.provider(L.TESTNET));
  console.log(`\n=== ${label || pathname}`);
  console.log(`agent ${agent.address} · wallet gas ${(await agent.provider.getBalance(agent.address)) > 0n ? 'has some' : 'none needed'}`);

  const r1 = await fetch(url);
  const challenge = await r1.json();
  console.log(`  GET ${pathname} -> ${r1.status} ${challenge.error || ''}`);
  if (r1.status !== 402) throw new Error(`expected 402, got ${r1.status}`);
  const accept = challenge.accepts[0];
  console.log(`  price ${accept.amountFormatted} · payTo ${accept.payTo.slice(0, 10)}… · invoice ${accept.extra.invoiceId.slice(0, 12)}…`);

  const dep = L.readJson(`${L.DEPLOY_DIR}/968.json`);
  const value = {
    agent: agent.address,
    payee: accept.payTo,
    amount: BigInt(accept.maxAmountRequired),
    invoiceId: accept.extra.invoiceId,
    expiry: BigInt(accept.extra.expiry),
    chainId: BigInt(accept.extra.chainId),
    vault: accept.extra.vault,
  };
  const signature = await agent.signTypedData(x402.domainOf(dep), x402.VOUCHER_TYPES, value);
  console.log(`  signed voucher (gas spent: 0, nonce ${await agent.provider.getTransactionCount(agent.address)} unchanged)`);

  const header = x402.encodeHeader({
    x402Version: x402.X402_VERSION, scheme: accept.scheme, network: accept.network,
    payload: {
      agent: agent.address, payee: accept.payTo, amount: String(accept.maxAmountRequired),
      invoiceId: accept.extra.invoiceId, expiry: String(accept.extra.expiry), signature,
    },
  });

  const r2 = await fetch(url, { headers: { 'x-payment': header } });
  const body = await r2.json();
  console.log(`  retry with X-PAYMENT -> ${r2.status}`);
  if (r2.status !== 200) { console.log('  !! failed:', JSON.stringify(body).slice(0, 300)); return { header, ok: false }; }

  const receiptHeader = r2.headers.get('x-payment-response');
  const receipt = receiptHeader ? x402.decodeHeader(receiptHeader) : body.payment;
  console.log(`  RECEIPT settled ${receipt.amountUsdt} · tx ${receipt.transaction}`);
  console.log(`          ${receipt.explorer}`);
  console.log('  DATA ' + JSON.stringify(body.data).slice(0, 400));

  if (replay) {
    const r3 = await fetch(url, { headers: { 'x-payment': header } });
    const c3 = await r3.json();
    console.log(`  REPLAY of the same voucher -> ${r3.status} ${c3.error || ''}`);
  }
  return { header, ok: true, receipt };
}

(async () => {
  console.log(`agentpay demo against ${BASE}`);

  const health = await (await fetch(BASE + '/health')).json();
  console.log(`\nservice  ${health.service} · x402 v${health.x402Version} · ${health.network} · vault ${health.vault}`);
  console.log(`pricing  ${(await (await fetch(BASE + '/v1/pricing')).json()).routes.map((r) => `${r.route.replace('GET ', '')}=${r.price}`).join('  ')}`);

  const a = await payAndFetch('/v1/chain/stats', { label: 'paid read: BOT Chain mainnet stats' });
  const b = await payAndFetch('/v1/address/0xfad8473C54c058b58DF32caDf6415FBa15639682', { label: 'paid read: address overview' });
  const c = await payAndFetch('/v1/votes/508?hours=6', { label: 'paid read: CrashLab on-chain votes (6h)', replay: true });

  const vault = await (await fetch(BASE + '/v1/vault')).json();
  console.log('\n=== vault after the run');
  console.log(JSON.stringify(vault, null, 1));

  const spent = [a, b, c].filter((x) => x.receipt).reduce((s, x) => s + Number(x.receipt.amount), 0);
  console.log(`\nagent spent ${formatUnits(spent, 6)} USDT across ${[a, b, c].filter((x) => x.ok).length} paid calls; zero gas spent by the agent.`);
})().catch((e) => { console.error('DEMO FAILED:', e.shortMessage || e.message); process.exit(1); });
