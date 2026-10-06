#!/usr/bin/env node
/**
 * AgentPay HTTP surface — the paid, machine-callable endpoint.
 *
 * Every paid route answers 402 with an x402 challenge.  The agent signs an
 * EIP-712 voucher (zero gas, zero chain writes on its side), re-sends the
 * request with an X-PAYMENT header, the facilitator settles it on BOT Chain
 * testnet and pays the gas, and the response carries an X-PAYMENT-RESPONSE
 * receipt with the settlement tx hash.
 *
 * Data routes read BOT Chain MAINNET (the ecosystem vote contract and the
 * official bridge only exist there); payment settles on TESTNET 968.
 *
 * Run: node src/http.js            (PORT env, default 9681)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JsonRpcProvider, Contract, formatEther, formatUnits, isAddress } = require('ethers');
const x402 = require('./x402');
const L = require('../scripts/lib.cjs');

const PORT = Number(process.env.PORT || 9681);
// Settlement network is a config choice: DEPLOYMENT=968 (testnet, default) or DEPLOYMENT=677 (mainnet).
const DEPLOYMENT = process.env.DEPLOYMENT || '968';
const DEP = L.readJson(path.join(L.DEPLOY_DIR, `${DEPLOYMENT}.json`));
const NET = Number(DEP.chainId) === L.MAINNET.chainId ? L.MAINNET : L.TESTNET;
const facilitator = L.wallet('facilitator', NET);
const used = x402.usedStore();

const mainnet = new JsonRpcProvider(L.MAINNET.rpc, L.MAINNET.chainId, { staticNetwork: true });
const VOTE_CONTRACT = '0xF5b22756CbD9193CE6F349bbD1835c2e5a6Cb181';
const VOTE_TOPIC0 = '0x710b36627495d2e7af3a196c85bf3e51efd906f54516753e5e801b3a22b18f78';
const KNOWN = { 508: 'CrashLab', 19: 'faucetdrops', 132: 'BOT Card', 131: 'BOT Bridge', 130: 'MeMeX', 133: 'B DEX', 129: 'Bo Wallet', 134: 'NIX Foundation' };
const CHAIN_RPCS = {
  1: ['https://0xrpc.io/eth', 'https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'],
  56: ['https://bsc.blockrazor.xyz', 'https://bsc-dataseed.binance.org'],
  677: [L.MAINNET.rpc],
};

const LOG = path.join(L.ROOT, '.state', 'requests.log');
function log(line) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
}

// ------------------------------------------------------------------ mainnet data
function currentWeek() {
  const OFF = 8 * 3600 * 1000;
  const sgt = new Date(Date.now() + OFF);
  const dow = (sgt.getUTCDay() + 6) % 7;
  const monday = Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate() - dow) - OFF;
  return { start: Math.floor(monday / 1000), end: Math.floor((monday + 7 * 86400000) / 1000) };
}

async function blockAt(ts) {
  let lo = 1, hi = await mainnet.getBlockNumber();
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    let b = null;
    for (let i = 0; i < 4 && !b; i++) { try { b = await mainnet.getBlock(mid); } catch { await new Promise((r) => setTimeout(r, 250)); } }
    if (!b) { lo = mid + 1; continue; }
    if (b.timestamp < ts) lo = mid + 1; else hi = mid;
  }
  return lo;
}

async function dataChainStats() {
  const [bn, fee] = await Promise.all([mainnet.getBlockNumber(), mainnet.getFeeData()]);
  const block = await mainnet.getBlock(bn);
  return {
    chainId: L.MAINNET.chainId, network: 'BOT Chain mainnet',
    blockNumber: bn, headTimestamp: new Date(block.timestamp * 1000).toISOString(),
    txInHeadBlock: block.length !== undefined ? block.length : null,
    gasPriceGwei: fee.gasPrice ? (Number(fee.gasPrice) / 1e9).toFixed(3) : null,
    explorer: L.MAINNET.explorer,
  };
}

async function dataAddress(addr) {
  if (!isAddress(addr)) throw new Error('invalid address');
  const [bal, nonce, code] = await Promise.all([
    mainnet.getBalance(addr), mainnet.getTransactionCount(addr), mainnet.getCode(addr),
  ]);
  const usdt = new Contract('0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C', ['function balanceOf(address) view returns (uint256)'], mainnet);
  const u = await usdt.balanceOf(addr).catch(() => null);
  return {
    address: addr, botBalance: formatEther(bal), nonce, isContract: code !== '0x',
    usdtBalance: u === null ? null : formatUnits(u, 6),
  };
}

async function dataBridgeStatus(chainId) {
  const r = await fetch('https://api-bridge.botchain.ai/config', { headers: { 'User-Agent': 'agentpay/0.1' } });
  const j = await r.json();
  const chain = (j.data || []).find((c) => Number(c.chain_id) === Number(chainId));
  if (!chain) throw new Error(`chain ${chainId} not in official bridge config`);
  const token = (chain.tokens || [])[0] || null;
  if (Number(chainId) === 728126428) {
    return { chainId, chainName: chain.chain_name, note: 'Tron is not EVM — read with TronWeb/REST, not eth_call', token: token && { symbol: token.symbol, address: token.contract_address } };
  }
  let p = null;
  for (const url of [chain.endpoint, ...(CHAIN_RPCS[Number(chainId)] || [])].filter(Boolean)) {
    try { const c = new JsonRpcProvider(url, Number(chainId), { staticNetwork: true }); await c.getBlockNumber(); p = { c, url }; break; } catch { /* next */ }
  }
  if (!p) throw new Error(`no working RPC for chain ${chainId}`);
  const bridge = new Contract(chain.bohr_bridge_contract_address, [
    'function getBridgePause() view returns (bool)',
    'function getMinAmountUsd() view returns (uint256)',
    'function getMaxAmountUsd() view returns (uint256)',
    'function getTokenPauseByResourceId(bytes32) view returns (bool)',
  ], p.c);
  const [paused, minUsd, maxUsd, tokenPaused] = await Promise.all([
    bridge.getBridgePause().catch(() => null), bridge.getMinAmountUsd().catch(() => null),
    bridge.getMaxAmountUsd().catch(() => null),
    token ? bridge.getTokenPauseByResourceId(token.resource_id).catch(() => null) : null,
  ]);
  let liquidity = null;
  if (token && token.contract_address && !/^T/.test(token.contract_address)) {
    const erc20 = new Contract(token.contract_address, ['function balanceOf(address) view returns (uint256)'], p.c);
    const b = await erc20.balanceOf(chain.bohr_bridge_contract_address).catch(() => null);
    if (b !== null) liquidity = `${formatUnits(b, Number(token.decimals || 6))} ${token.symbol}`;
  }
  return {
    chainId, chainName: chain.chain_name, rpcUsed: p.url, bridgeContract: chain.bohr_bridge_contract_address,
    paused, minAmountUsd: minUsd === null ? null : Number(minUsd), maxAmountUsd: maxUsd === null ? null : Number(maxUsd),
    token: token && { symbol: token.symbol, address: token.contract_address, paused: tokenPaused }, liquidity,
  };
}

async function dataVotes(projectId, hours) {
  const week = currentWeek();
  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = hours ? Math.max(week.start, nowSec - hours * 3600) : week.start;
  const fromBlock = await blockAt(startSec);
  const toBlock = await mainnet.getBlockNumber();
  const topics = [VOTE_TOPIC0, '0x' + Number(projectId).toString(16).padStart(64, '0')];
  const voters = new Set();
  let votes = 0, start = fromBlock, chunk = 15000, calls = 0, first = null, last = null;
  while (start <= toBlock && calls < 90) {
    const end = Math.min(start + chunk - 1, toBlock);
    try {
      const logs = await mainnet.getLogs({ address: VOTE_CONTRACT, fromBlock: start, toBlock: end, topics });
      calls++;
      for (const l of logs) {
        votes++;
        voters.add('0x' + l.topics[2].slice(26).toLowerCase());
        const ts = Number(BigInt(l.topics[3]));
        first = first === null ? ts : Math.min(first, ts);
        last = last === null ? ts : Math.max(last, ts);
      }
      start = end + 1;
    } catch {
      if (chunk > 2000) chunk = Math.floor(chunk / 2); else start = end + 1;
    }
  }
  return {
    projectId, name: KNOWN[projectId] || null, votes, distinctWallets: voters.size,
    window: { from: new Date(startSec * 1000).toISOString(), to: new Date(nowSec * 1000).toISOString() },
    weekEnds: new Date(week.end * 1000).toISOString(),
    firstVote: first ? new Date(first * 1000).toISOString() : null,
    lastVote: last ? new Date(last * 1000).toISOString() : null,
    scanComplete: start > toBlock, rpcCalls: calls,
  };
}

// ----------------------------------------------------------------------- routes
const PAID_ROUTES = {
  '/v1/chain/stats': { key: 'GET /v1/chain/stats', handler: () => dataChainStats() },
  '/v1/address': { key: 'GET /v1/address', handler: (u) => dataAddress(u.pathname.split('/').pop()) },
  '/v1/bridge/status': { key: 'GET /v1/bridge/status', handler: (u) => dataBridgeStatus(Number(u.searchParams.get('chainId') || 1)) },
  '/v1/votes': { key: 'GET /v1/votes', handler: (u) => dataVotes(Number(u.pathname.split('/').pop()), u.searchParams.get('hours') ? Number(u.searchParams.get('hours')) : null) },
};

function matchPaid(u, method) {
  if (method !== 'GET') return null;
  let base = null;
  if (u.pathname === '/v1/chain/stats') base = '/v1/chain/stats';
  else if (u.pathname === '/v1/bridge/status') base = '/v1/bridge/status';
  else if (u.pathname.startsWith('/v1/address/')) base = '/v1/address';
  else if (u.pathname.startsWith('/v1/votes/')) base = '/v1/votes';
  return base ? PAID_ROUTES[base] : null;
}

function send(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

/**
 * One facilitator wallet = one nonce stream. Two settlements landing at once
 * would collide (ethers: "replacement fee too low"), so every settlement is
 * serialised through this queue. Slow by a second, correct by design.
 */
let settleChain = Promise.resolve();
function serialize(fn) {
  const next = settleChain.then(fn, fn);
  settleChain = next.catch(() => {});
  return next;
}

let _tn = null;
const testnetProvider = () => (_tn ??= new JsonRpcProvider(NET.rpc, NET.chainId, { staticNetwork: true }));

// ------------------------------------------------------------- demo console
const CONSOLE = path.join(L.ROOT, 'public', 'index.html');
const DEMO_RE = /^\/v1\/(chain\/stats|bridge\/status\?chainId=\d+|address\/0x[a-fA-F0-9]{40}|votes\/\d+(\?hours=\d+)?)$/;
let demoHits = [];

/**
 * Runs the whole payer flow server-side so a human can see it in a browser:
 * request -> 402 -> sign the voucher -> settle -> data. The console signs with the
 * demo agent wallet; a real integration signs with its own key.
 */
async function demoCall(u) {
  const target = u.searchParams.get('route') || '';
  if (!DEMO_RE.test(target)) return { error: 'route not allowed for the demo console' };
  const now = Date.now();
  demoHits = demoHits.filter((t) => now - t < 3600_000);
  if (demoHits.length && now - demoHits[demoHits.length - 1] < 4000) return { error: 'one demo call every 4 seconds — the vault float is finite' };
  if (demoHits.length > 120) return { error: 'demo budget for this hour is spent; run scripts/agent-demo.cjs locally instead' };
  demoHits.push(now); // recorded up front, so simultaneous clicks are throttled too

  const agent = L.wallet('agent', NET);
  const self = `http://127.0.0.1:${PORT}`;

  const r1 = await fetch(self + target);
  if (r1.status !== 402) return { error: `expected 402 from ${target}, got ${r1.status}` };
  const challenge = await r1.json();
  const accept = challenge.accepts[0];

  const value = {
    agent: agent.address, payee: accept.payTo, amount: BigInt(accept.maxAmountRequired),
    invoiceId: accept.extra.invoiceId, expiry: BigInt(accept.extra.expiry),
    chainId: BigInt(accept.extra.chainId), vault: accept.extra.vault,
  };
  const signature = await agent.signTypedData(x402.domainOf(DEP), x402.VOUCHER_TYPES, value);
  const header = x402.encodeHeader({
    x402Version: x402.X402_VERSION, scheme: accept.scheme, network: accept.network,
    payload: { agent: agent.address, payee: accept.payTo, amount: String(accept.maxAmountRequired), invoiceId: accept.extra.invoiceId, expiry: String(accept.extra.expiry), signature },
  });

  const r2 = await fetch(self + target, { headers: { 'x-payment': header } });
  const body = await r2.json();
  if (r2.status !== 200) return { error: body.error || `payment failed (${r2.status})` };
  demoHits.push(now);

  return {
    steps: {
      challenge: { resource: accept.resource, amountFormatted: accept.amountFormatted, invoiceId: accept.extra.invoiceId, maxTimeoutSeconds: accept.maxTimeoutSeconds },
      voucher: { agent: agent.address, signature, gasPaidByPayer: 0 },
    },
    receipt: body.payment,
    data: body.data,
  };
}

async function freeRoutes(u, res, req) {
  if (u.pathname === '/' || u.pathname === '/console') {
    const html = fs.readFileSync(CONSOLE, 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html), 'cache-control': 'no-store' });
    return res.end(html);
  }
  if (u.pathname === '/v1/demo/call') return send(res, 200, await demoCall(u));
  if (u.pathname === '/health' || u.pathname === '/v1/health') {
    return send(res, 200, {
      ok: true, service: 'agentpay', x402Version: x402.X402_VERSION,
      network: `eip155:${DEP.chainId}`, vault: DEP.vault, token: DEP.token, payee: DEP.payee,
      facilitator: facilitator.address, paidRoutes: Object.values(PAID_ROUTES).map((r) => r.key),
      dataSource: 'BOT Chain mainnet (677)', settlement: `BOT Chain testnet (${DEP.chainId})`,
    });
  }
  if (u.pathname === '/v1/pricing') {
    return send(res, 200, {
      network: `eip155:${DEP.chainId}`, asset: DEP.token, currency: 'USDT (6 decimals)', scheme: x402.SCHEME,
      routes: Object.entries(x402.PRICES).map(([k, v]) => ({ route: k, amount: v, price: `${formatUnits(v, 6)} USDT` })),
    });
  }
  if (u.pathname === '/v1/vault') {
    const tp = testnetProvider();
    const vault = new Contract(DEP.vault, x402.VAULT_ABI, tp);
    const token = new Contract(DEP.token, ['function balanceOf(address) view returns (uint256)'], tp);
    const [stats, held, payeeCredit, gas] = await Promise.all([
      vault.vaultStats(), token.balanceOf(DEP.vault), vault.balance(DEP.payee), tp.getBalance(facilitator.address),
    ]);
    return send(res, 200, {
      vault: DEP.vault, token: DEP.token, chainId: DEP.chainId,
      settleCount: Number(stats[0]), totalSettledUsdt: formatUnits(stats[1], 6),
      heldInVaultUsdt: formatUnits(held, 6), payeeEarnedUsdt: formatUnits(payeeCredit, 6),
      facilitatorGasBot: formatEther(gas), invoicesUsed: Object.keys(used.all()).length,
    });
  }
  if (u.pathname === '/v1/receipts') return send(res, 200, { count: Object.keys(used.all()).length, receipts: used.all() });
  return false;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  try {
    const free = await freeRoutes(u, res, req);
    if (free !== false) return;
    const route = matchPaid(u, req.method);
    if (!route) return send(res, 404, { error: 'not found' });

    const header = req.headers['x-payment'];
    if (!header) {
      const challenge = x402.buildChallenge({ resourceKey: route.key, url: req.url, dep: DEP });
      log(`${route.key} 402 challenge ${challenge.invoiceId.slice(0, 12)}…`);
      return send(res, 402, challenge);
    }

    const payment = x402.decodeHeader(header);
    if (!payment) return send(res, 400, { error: 'X-PAYMENT header is not valid base64 JSON' });
    const p = payment.payload || {};
    if (used.has(p.invoiceId)) return send(res, 402, { error: 'invoice already used (replay rejected)', invoiceId: p.invoiceId });

    const accept = x402.buildAccept({ resourceKey: route.key, url: req.url, dep: DEP, invoiceId: p.invoiceId, expiry: p.expiry });
    const check = x402.verifyPayment(payment, accept, DEP);
    if (!check.ok) { log(`${route.key} 402 reject: ${check.reason}`); return send(res, 402, { error: check.reason, accepts: [accept] }); }

    // Build the answer BEFORE charging: a paid endpoint must never bill for a 500.
    const data = await route.handler(u);

    const settle = await serialize(() => x402.settlePayment(p, DEP, facilitator));
    used.add(p.invoiceId, { resource: req.url, agent: p.agent, amount: p.amount, amountUsdt: formatUnits(p.amount, 6), txHash: settle.txHash, block: settle.blockNumber, at: new Date().toISOString() });
    log(`${route.key} SETTLED ${settle.txHash} ${p.amount} from ${p.agent}`);

    const receipt = { success: true, invoiceId: p.invoiceId, payer: p.agent, payee: p.payee, amount: p.amount, amountUsdt: `${formatUnits(p.amount, 6)} USDT`, network: `eip155:${DEP.chainId}`, transaction: settle.txHash, blockNumber: settle.blockNumber, explorer: `${NET.explorer}/tx/${settle.txHash}`, settledAt: new Date().toISOString() };
    return send(res, 200, { data, payment: receipt }, { 'x-payment-response': x402.encodeHeader(receipt) });
  } catch (e) {
    log(`ERROR ${e.shortMessage || e.message}`);
    return send(res, 500, { error: e.shortMessage || e.message });
  }
});

server.listen(PORT, () => {
  console.log(`agentpay listening on http://0.0.0.0:${PORT}`);
  console.log(`vault ${DEP.vault} · token ${DEP.token} · payee ${DEP.payee}`);
  console.log(`paid routes: ${Object.keys(x402.PRICES).join(', ')}`);
});
