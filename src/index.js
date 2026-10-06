#!/usr/bin/env node
/**
 * BOT Chain MCP Server — module 01/02 of BOT Chain's published Agent OS
 * (see https://www.botchain.ai/en/agent-os/ : "MCP Service", "AgentPay (x402)").
 *
 * Gives any MCP-capable agent (Claude, Codex, Hermes, …) live read access to
 * BOT Chain: chain state, balances, ERC-20s, the official bridge's config and
 * status, contract introspection, transactions, and the ecosystem leaderboard —
 * none of which is reachable through a documented public API.
 *
 * Read-only in this version. Payment rails (x402 / AgentPay) land in module 02.
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const {
  JsonRpcProvider,
  Contract,
  Interface,
  formatEther,
  formatUnits,
  isAddress,
} = require('ethers');

const RPC = process.env.BOTCHAIN_RPC || 'https://rpc.botchain.ai';
const CHAIN_ID = 677;
const BRIDGE_API = 'https://api-bridge.botchain.ai';
const VOTE_CONTRACT = '0xF5b22756CbD9193CE6F349bbD1835c2e5a6Cb181';
const VOTE_TOPIC0 = '0x710b36627495d2e7af3a196c85bf3e51efd906f54516753e5e801b3a22b18f78';
const KNOWN_PROJECTS = {
  508: 'CrashLab', 19: 'faucetdrops', 132: 'BOT Card', 131: 'BOT Bridge', 130: 'MeMeX',
  133: 'B DEX', 129: 'Bo Wallet', 134: 'NIX Foundation', 558: 'Botex', 267: 'Verdant',
};
const EXPLORER = 'https://scan.botchain.ai';

let provider = null;
const getProvider = () => (provider ??= new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true }));

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];
const BRIDGE_ABI = [
  'function getBridgePause() view returns (bool)',
  'function getMinAmountUsd() view returns (uint256)',
  'function getMaxAmountUsd() view returns (uint256)',
  'function getTokenPauseByResourceId(bytes32) view returns (bool)',
  'function getBotGasConfig() view returns (tuple(uint256 destinationChainId, bytes32 resourceId, uint256 gasAmount, address a, address b, address c, uint256 d))',
];

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] });
const fail = (msg) => ({ content: [{ type: 'text', text: JSON.stringify({ error: String(msg) }) }], isError: true });

/** BOT Chain weeks run Monday 00:00 → Monday 00:00 Asia/Singapore (UTC+8). */
function currentWeek(nowMs = Date.now()) {
  const OFF = 8 * 3600 * 1000;
  const sgt = new Date(nowMs + OFF);
  const dow = (sgt.getUTCDay() + 6) % 7; // Monday = 0
  const monday = Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate() - dow) - OFF;
  return { start: Math.floor(monday / 1000), end: Math.floor((monday + 7 * 86400000) / 1000) };
}

async function blockAt(ts) {
  const p = getProvider();
  const latest = await p.getBlockNumber();
  let lo = 1, hi = latest;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    let b = null;
    for (let i = 0; i < 4 && !b; i++) {
      try { b = await p.getBlock(mid); } catch { await new Promise((r) => setTimeout(r, 300)); }
    }
    if (!b) { lo = mid + 1; continue; }
    if (b.timestamp < ts) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Count Vote logs, optionally filtered to one project, between two blocks. */
async function scanVotes({ fromBlock, toBlock, projectId, maxCalls = 90 }) {
  const p = getProvider();
  const topics = projectId
    ? [VOTE_TOPIC0, '0x' + Number(projectId).toString(16).padStart(64, '0')]
    : [VOTE_TOPIC0];
  const perProject = new Map();
  const voters = new Map();
  const timestamps = [];
  let start = fromBlock;
  let chunk = 15000;
  let calls = 0;
  while (start <= toBlock && calls < maxCalls) {
    const end = Math.min(start + chunk - 1, toBlock);
    try {
      const logs = await p.getLogs({ address: VOTE_CONTRACT, fromBlock: start, toBlock: end, topics });
      calls++;
      for (const l of logs) {
        const pid = Number(BigInt(l.topics[1]));
        const voter = '0x' + l.topics[2].slice(26).toLowerCase();
        const ts = Number(BigInt(l.topics[3]));
        perProject.set(pid, (perProject.get(pid) || 0) + 1);
        if (!voters.has(pid)) voters.set(pid, new Set());
        voters.get(pid).add(voter);
        timestamps.push(ts);
      }
      start = end + 1;
    } catch {
      if (chunk > 2000) chunk = Math.floor(chunk / 2); else start = end + 1;
    }
  }
  return {
    perProject, voters,
    complete: start > toBlock,
    calls,
    from: timestamps.length ? new Date(Math.min(...timestamps) * 1000).toISOString() : null,
    to: timestamps.length ? new Date(Math.max(...timestamps) * 1000).toISOString() : null,
  };
}

const server = new McpServer({ name: 'botchain-mcp', version: '0.1.0' });

// ---------------------------------------------------------------- chain state
server.registerTool('chain_stats', {
  title: 'BOT Chain stats',
  description: 'Current BOT Chain state: chain id, latest block, head timestamp, gas price. Use as the liveness/economics check before anything else.',
  inputSchema: {},
}, async () => {
  try {
    const p = getProvider();
    const [bn, blk, fee] = await Promise.all([p.getBlockNumber(), null, p.getFeeData()]);
    const block = await p.getBlock(bn);
    return ok({
      chainId: CHAIN_ID,
      blockNumber: bn,
      headTimestamp: new Date(block.timestamp * 1000).toISOString(),
      gasPriceWei: fee.gasPrice ? fee.gasPrice.toString() : null,
      gasPriceGwei: fee.gasPrice ? Number(formatEther(fee.gasPrice * 1000000000n)) && (Number(fee.gasPrice) / 1e9).toFixed(2) : null,
      explorer: EXPLORER,
    });
  } catch (e) { return fail(e.shortMessage || e.message); }
});

// ------------------------------------------------------------------ addresses
server.registerTool('address_overview', {
  title: 'Address overview',
  description: 'Native BOT balance, transaction count and whether the address is a contract (with bytecode size).',
  inputSchema: { address: z.string().describe('EVM address on BOT Chain') },
}, async ({ address }) => {
  try {
    if (!isAddress(address)) return fail('invalid EVM address');
    const p = getProvider();
    const [balance, nonce, code] = await Promise.all([
      p.getBalance(address), p.getTransactionCount(address), p.getCode(address),
    ]);
    return ok({
      address,
      botBalance: formatEther(balance),
      nonce,
      isContract: code !== '0x',
      codeBytes: (code.length - 2) / 2,
    });
  } catch (e) { return fail(e.shortMessage || e.message); }
});

server.registerTool('token_info', {
  title: 'ERC-20 info',
  description: 'ERC-20 metadata (name, symbol, decimals, total supply) and optionally the balance held by an address.',
  inputSchema: {
    token: z.string().describe('ERC-20 contract address'),
    holder: z.string().optional().describe('Optional address whose balance you want'),
  },
}, async ({ token, holder }) => {
  try {
    if (!isAddress(token)) return fail('invalid token address');
    const c = new Contract(token, ERC20_ABI, getProvider());
    const [name, symbol, decimals, supply] = await Promise.all([
      c.name().catch(() => null), c.symbol().catch(() => null), c.decimals().catch(() => null), c.totalSupply().catch(() => null),
    ]);
    const out = { token, name, symbol, decimals: decimals === null ? null : Number(decimals), totalSupply: supply === null ? null : supply.toString() };
    if (decimals !== null && supply !== null) out.totalSupplyFormatted = formatUnits(supply, Number(decimals));
    if (holder && isAddress(holder)) {
      const bal = await c.balanceOf(holder);
      out.holder = holder;
      out.balance = bal.toString();
      if (decimals !== null) out.balanceFormatted = formatUnits(bal, Number(decimals));
    }
    return ok(out);
  } catch (e) { return fail(e.shortMessage || e.message); }
});

// --------------------------------------------------------------------- bridge
server.registerTool('bridge_config', {
  title: 'Official bridge config',
  description: 'Live config for BOT Chain\'s official bridge (bridge.botchain.ai): supported source chains, bridge contract addresses and the bridged tokens with their resource ids. Sourced from their public config API.',
  inputSchema: {},
}, async () => {
  try {
    const r = await fetch(`${BRIDGE_API}/config`, { headers: { 'User-Agent': 'botchain-mcp/0.1' } });
    const j = await r.json();
    const chains = (j.data || []).map((c) => ({
      chainId: c.chain_id,
      name: c.chain_name,
      rpc: c.endpoint,
      explorer: c.explorer,
      bridgeContract: c.bohr_bridge_contract_address,
      tokens: (c.tokens || []).map((t) => ({ symbol: t.symbol, address: t.contract_address, decimals: t.decimals, resourceId: t.resource_id })),
    }));
    return ok({ pausedGlobally: j.bridge_out_paused ?? null, notice: j.bridge_out_notice || null, chains });
  } catch (e) { return fail(e.message); }
});

// Per-chain RPC fallbacks — their config advertises an endpoint per chain and
// some of them are not usable JSON-RPC, so fall back to public nodes.
const CHAIN_RPCS = {
  1: ['https://0xrpc.io/eth', 'https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com', 'https://eth.drpc.org'],
  56: ['https://bsc.blockrazor.xyz', 'https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com'],
  677: [RPC],
};

async function providerFor(chainId, advertised) {
  const urls = [...new Set([advertised, ...(CHAIN_RPCS[Number(chainId)] || [])].filter(Boolean))];
  for (const url of urls) {
    try {
      const p = new JsonRpcProvider(url, Number(chainId), { staticNetwork: true });
      await p.getBlockNumber();
      return { provider: p, url };
    } catch { /* try the next endpoint */ }
  }
  return null;
}

server.registerTool('bridge_status', {
  title: 'Bridge status for a chain',
  description: 'Whether a given source chain\'s deposit contract is paused, its per-deposit USD min/max, whether the token is paused, and how much USDT sits behind it. chainId 1 = Ethereum, 56 = BNB, 728126428 = Tron, 677 = BOT Chain.',
  inputSchema: {
    chainId: z.number().describe('Source chain id (1 Ethereum, 56 BNB, 728126428 Tron, 677 BOT)'),
  },
}, async ({ chainId }) => {
  try {
    const r = await fetch(`${BRIDGE_API}/config`, { headers: { 'User-Agent': 'botchain-mcp/0.1' } });
    const j = await r.json();
    const chain = (j.data || []).find((c) => Number(c.chain_id) === Number(chainId));
    if (!chain) return fail(`chain ${chainId} not in bridge config`);
    const token = (chain.tokens || [])[0];

    if (Number(chainId) === 728126428) {
      return ok({
        chainId, chainName: chain.chain_name, bridgeContract: chain.bohr_bridge_contract_address,
        note: 'Tron is not EVM — read state with TronWeb/REST, not eth_call.',
        token: token ? { symbol: token.symbol, address: token.contract_address, decimals: token.decimals } : null,
      });
    }

    const found = await providerFor(chainId, chain.endpoint);
    if (!found) return fail(`no working RPC for chain ${chainId}`);
    const { provider, url } = found;
    const c = new Contract(chain.bohr_bridge_contract_address, BRIDGE_ABI, provider);
    const [paused, minUsd, maxUsd, tokenPaused] = await Promise.all([
      c.getBridgePause().catch(() => null),
      c.getMinAmountUsd().catch(() => null),
      c.getMaxAmountUsd().catch(() => null),
      token ? c.getTokenPauseByResourceId(token.resource_id).catch(() => null) : null,
    ]);
    let liquidity = null;
    if (token && token.contract_address && !/^T/.test(token.contract_address)) {
      const erc20 = new Contract(token.contract_address, ['function balanceOf(address) view returns (uint256)'], provider);
      const bal = await erc20.balanceOf(chain.bohr_bridge_contract_address).catch(() => null);
      if (bal !== null) liquidity = `${formatUnits(bal, Number(token.decimals || 6))} ${token.symbol}`;
    }
    return ok({
      chainId: Number(chain.chain_id),
      chainName: chain.chain_name,
      rpcUsed: url,
      bridgeContract: chain.bohr_bridge_contract_address,
      paused, minAmountUsd: minUsd === null ? null : Number(minUsd), maxAmountUsd: maxUsd === null ? null : Number(maxUsd),
      token: token ? { symbol: token.symbol, address: token.contract_address, paused: tokenPaused } : null,
      liquidity,
    });
  } catch (e) { return fail(e.shortMessage || e.message); }
});

// ---------------------------------------------------------------- ecosystem
server.registerTool('ecosystem_votes', {
  title: 'Ecosystem votes for a project',
  description: 'On-chain vote count and distinct wallet count for one project in the current BOT Chain week (Mon 00:00 Asia/Singapore). Works because the leaderboard API is browser-gated; this reads the chain directly. projectId 508 = CrashLab, 19 = faucetdrops, 132 = BOT Card, 131 = BOT Bridge.',
  inputSchema: {
    projectId: z.number().describe('Project id on the vote contract'),
    hours: z.number().optional().describe('Only count the last N hours (default: whole current week)'),
  },
}, async ({ projectId, hours }) => {
  try {
    const p = getProvider();
    const week = currentWeek();
    const nowSec = Math.floor(Date.now() / 1000);
    const startSec = hours ? Math.max(week.start, nowSec - hours * 3600) : week.start;
    const latest = await p.getBlockNumber();
    const fromBlock = await blockAt(startSec);
    const res = await scanVotes({ fromBlock, toBlock: latest, projectId });
    const votes = res.perProject.get(projectId) || 0;
    const wallets = res.voters.get(projectId)?.size || 0;
    return ok({
      projectId, name: KNOWN_PROJECTS[projectId] || null,
      votes, distinctWallets: wallets,
      window: { from: new Date(startSec * 1000).toISOString(), to: new Date(nowSec * 1000).toISOString() },
      weekEnds: new Date(week.end * 1000).toISOString(),
      firstVote: res.from, lastVote: res.to,
      scanComplete: res.complete,
    });
  } catch (e) { return fail(e.shortMessage || e.message); }
});

server.registerTool('ecosystem_top', {
  title: 'Ecosystem leaderboard (on-chain)',
  description: 'Top projects by on-chain votes for a window (default: last 24h), with distinct wallet counts — the number the official board does not show. Heavy call; keep the window small.',
  inputSchema: {
    limit: z.number().optional().describe('How many projects to return (default 10)'),
    hours: z.number().optional().describe('Window length in hours (default 24)'),
  },
}, async ({ limit = 10, hours = 24 }) => {
  try {
    const p = getProvider();
    const nowSec = Math.floor(Date.now() / 1000);
    const startSec = nowSec - hours * 3600;
    const latest = await p.getBlockNumber();
    const fromBlock = await blockAt(startSec);
    const res = await scanVotes({ fromBlock, toBlock: latest, projectId: null });
    const rows = [...res.perProject.entries()]
      .map(([pid, v]) => ({ projectId: pid, name: KNOWN_PROJECTS[pid] || null, votes: v, wallets: res.voters.get(pid)?.size || 0 }))
      .sort((a, b) => b.votes - a.votes)
      .slice(0, limit);
    return ok({ windowHours: hours, scanComplete: res.complete, calls: res.calls, projects: rows });
  } catch (e) { return fail(e.shortMessage || e.message); }
});

// ------------------------------------------------------- contract & tx inspect
server.registerTool('contract_inspect', {
  title: 'Contract introspection',
  description: 'Bytecode size, and EIP-1967 implementation/admin slots for proxy detection.',
  inputSchema: { address: z.string().describe('Contract address') },
}, async ({ address }) => {
  try {
    if (!isAddress(address)) return fail('invalid address');
    const p = getProvider();
    const code = await p.getCode(address);
    const implSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
    const adminSlot = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
    const [impl, admin] = await Promise.all([
      p.getStorage(address, implSlot).catch(() => null),
      p.getStorage(address, adminSlot).catch(() => null),
    ]);
    const clean = (v) => (v && v !== '0x' + '0'.repeat(64) ? '0x' + v.slice(26) : null);
    return ok({
      address,
      isContract: code !== '0x',
      codeBytes: (code.length - 2) / 2,
      eip1967Implementation: clean(impl),
      eip1967Admin: clean(admin),
    });
  } catch (e) { return fail(e.shortMessage || e.message); }
});

server.registerTool('tx_info', {
  title: 'Transaction info',
  description: 'Status, block, gas used, sender, recipient and value for a transaction hash.',
  inputSchema: { hash: z.string().describe('Transaction hash') },
}, async ({ hash }) => {
  try {
    const p = getProvider();
    const [tx, rc] = await Promise.all([p.getTransaction(hash), p.getTransactionReceipt(hash)]);
    if (!tx && !rc) return fail('transaction not found');
    return ok({
      hash,
      status: rc ? (rc.status === 1 ? 'success' : 'reverted') : 'pending',
      blockNumber: rc?.blockNumber ?? null,
      from: tx?.from, to: tx?.to,
      valueBot: tx ? formatEther(tx.value) : null,
      gasUsed: rc ? Number(rc.gasUsed) : null,
      gasPriceGwei: tx?.gasPrice ? (Number(tx.gasPrice) / 1e9).toFixed(2) : null,
      explorer: `${EXPLORER}/tx/${hash}`,
    });
  } catch (e) { return fail(e.shortMessage || e.message); }
});

const transport = new StdioServerTransport();
server.connect(transport).catch((e) => {
  console.error('botchain-mcp failed to start:', e);
  process.exit(1);
});
