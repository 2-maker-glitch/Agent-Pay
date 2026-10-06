/**
 * x402 payment negotiation — challenge construction, verification, settlement.
 *
 * The standard x402 "exact" scheme needs EIP-3009 (USDC only), which BOT
 * Chain's USDT does not implement.  This is the "batch-settlement" variant:
 * the agent signs an EIP-712 voucher (no gas, no chain write) and the
 * facilitator submits it to AgentPayVault, paying the gas itself.
 */
const fs = require('fs');
const path = require('path');
const { Contract, verifyTypedData, formatUnits } = require('ethers');

const VAULT_ABI = [
  'function settle(address[] agents, address payee, uint256[] amounts, bytes32[] invoiceIds, uint256[] expiries, bytes[] sigs)',
  'function balance(address) view returns (uint256)',
  'function invoiceUsed(bytes32) view returns (bool)',
  'function vaultStats() view returns (uint256 count, uint256 total, uint256 held)',
];

const X402_VERSION = 2;
const SCHEME = 'batch-settlement';

/** Price list, in token base units (USDT has 6 decimals). */
const PRICES = {
  'GET /v1/chain/stats': '1000',    // 0.001 USDT
  'GET /v1/address': '2000',        // 0.002 USDT
  'GET /v1/bridge/status': '2000',  // 0.002 USDT
  'GET /v1/votes': '10000',         // 0.010 USDT
};

const VOUCHER_TYPES = {
  Voucher: [
    { name: 'agent', type: 'address' },
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'invoiceId', type: 'bytes32' },
    { name: 'expiry', type: 'uint256' },
    { name: 'chainId', type: 'uint256' },
    { name: 'vault', type: 'address' },
  ],
};

const TTL_SECONDS = 300;

const domainOf = (dep) => ({ name: 'AgentPay', version: '1', chainId: dep.chainId, verifyingContract: dep.vault });

/** 402 body: what the agent must sign and send back in X-PAYMENT. */
function buildAccept({ resourceKey, url, dep, amount, invoiceId, expiry }) {
  const price = amount || PRICES[resourceKey];
  if (!price) throw new Error(`no price for ${resourceKey}`);
  const inv = invoiceId || '0x' + require('crypto').randomBytes(32).toString('hex');
  const exp = expiry || Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return {
    scheme: SCHEME,
    network: `eip155:${dep.chainId}`,
    asset: dep.token,
    payTo: dep.payee,
    maxAmountRequired: price,
    amountFormatted: `${formatUnits(price, 6)} USDT`,
    resource: url,
    maxTimeoutSeconds: TTL_SECONDS,
    extra: {
      vault: dep.vault,
      chainId: dep.chainId,
      domainName: 'AgentPay',
      domainVersion: '1',
      voucherType: 'Voucher(address agent,address payee,uint256 amount,bytes32 invoiceId,uint256 expiry,uint256 chainId,address vault)',
      invoiceId: inv,
      expiry: exp,
    },
  };
}

function buildChallenge({ resourceKey, url, dep, reason = 'payment required' }) {
  const accept = buildAccept({ resourceKey, url, dep });
  return { x402Version: X402_VERSION, error: reason, accepts: [accept], invoiceId: accept.extra.invoiceId, expiry: accept.extra.expiry };
}

function encodeHeader(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64'); }
function decodeHeader(h) {
  try { return JSON.parse(Buffer.from(String(h), 'base64').toString('utf8')); } catch { return null; }
}

/** Structural checks before we spend any gas. */
function verifyPayment(payment, accept, dep) {
  if (!payment || typeof payment !== 'object') return { ok: false, reason: 'malformed payment payload' };
  if (Number(payment.x402Version) !== X402_VERSION) return { ok: false, reason: 'unsupported x402Version' };
  if (payment.scheme && payment.scheme !== SCHEME) return { ok: false, reason: `unsupported scheme ${payment.scheme}` };
  const p = payment.payload || {};
  for (const k of ['agent', 'payee', 'amount', 'invoiceId', 'expiry', 'signature']) {
    if (p[k] === undefined || p[k] === null) return { ok: false, reason: `payload.${k} missing` };
  }
  if (String(p.payee).toLowerCase() !== String(dep.payee).toLowerCase()) return { ok: false, reason: 'payee mismatch' };
  if (BigInt(p.amount) < BigInt(accept.maxAmountRequired)) {
    return { ok: false, reason: `underpaid: sent ${p.amount}, need ${accept.maxAmountRequired}` };
  }
  if (Number(p.expiry) < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'voucher expired' };
  if (String(p.invoiceId).toLowerCase() !== String(accept.extra.invoiceId).toLowerCase()) {
    return { ok: false, reason: 'invoiceId does not match this challenge' };
  }
  const value = {
    agent: p.agent, payee: p.payee, amount: BigInt(p.amount), invoiceId: p.invoiceId,
    expiry: BigInt(p.expiry), chainId: BigInt(dep.chainId), vault: dep.vault,
  };
  let signer;
  try { signer = verifyTypedData(domainOf(dep), VOUCHER_TYPES, value, p.signature); } catch (e) { return { ok: false, reason: `bad signature: ${e.message}` }; }
  if (signer.toLowerCase() !== String(p.agent).toLowerCase()) return { ok: false, reason: 'signature does not match agent' };
  return { ok: true, payload: p, signer };
}

/** Submit one voucher to the vault and wait for the receipt. */
async function settlePayment(p, dep, signer) {
  const vault = new Contract(dep.vault, VAULT_ABI, signer);
  const args = [[p.agent], p.payee, [BigInt(p.amount)], [p.invoiceId], [BigInt(p.expiry)], [p.signature]];
  const fee = await signer.provider.getFeeData();
  const fn = vault.getFunction('settle');
  const overrides = { gasPrice: fee.gasPrice };
  try { overrides.gasLimit = await fn.estimateGas(...args, overrides); } catch { overrides.gasLimit = 400000n; }
  const tx = await fn(...args, overrides);
  const rc = await tx.wait();
  if (rc.status !== 1) throw new Error('settlement reverted');
  return { txHash: rc.hash, blockNumber: rc.blockNumber, gasUsed: [rc.gasUsed.toString()] };
}

function encodeReceipt(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64'); }

/** Local replay guard so a re-sent header doesn't burn a second settlement. */
function usedStore(file) {
  const f = file || path.join(__dirname, '..', '.state', 'used.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
  const save = (o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1)); };
  return {
    has: (inv) => Boolean(load()[String(inv).toLowerCase()]),
    add: (inv, info) => { const o = load(); o[String(inv).toLowerCase()] = info; save(o); },
    all: load,
  };
}

module.exports = { X402_VERSION, SCHEME, PRICES, VOUCHER_TYPES, VAULT_ABI, domainOf, buildAccept, buildChallenge, encodeHeader, decodeHeader, verifyPayment, settlePayment, encodeReceipt, usedStore, TTL_SECONDS };
