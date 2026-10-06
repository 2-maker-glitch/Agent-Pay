/**
 * Shared helpers for the AgentPay testnet build (compile, keys, txs).
 */
const fs = require('fs');
const path = require('path');
const solc = require('solc');
const { JsonRpcProvider, Wallet, Contract } = require('ethers');

const ROOT = path.resolve(__dirname, '..');
const KEYS = path.join(ROOT, '.keys');
const DEPLOY_DIR = path.join(ROOT, 'deployments');

const TESTNET = { chainId: 968, rpc: 'https://rpc.bohr.life', explorer: 'https://scan.bohr.life', name: 'BOT Chain Testnet (bohr)' };
const MAINNET = { chainId: 677, rpc: 'https://rpc.botchain.ai', explorer: 'https://scan.botchain.ai', name: 'BOT Chain Mainnet' };

const provider = (net = TESTNET) => new JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true });

function ensureDir(d) { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); }

/** Compile every .sol in contracts/ with the optimizer on. */
function compile() {
  const dir = path.join(ROOT, 'contracts');
  const sources = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sol'))) {
    sources[f] = { content: fs.readFileSync(path.join(dir, f), 'utf8') };
  }
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const fatal = (out.errors || []).filter((e) => e.severity === 'error');
  if (fatal.length) throw new Error('solc: ' + fatal.map((e) => e.formattedMessage).join('\n'));
  const warnings = (out.errors || []).filter((e) => e.severity !== 'error');
  const artifacts = {};
  for (const [file, contracts] of Object.entries(out.contracts || {})) {
    for (const [name, c] of Object.entries(contracts)) {
      artifacts[name] = { file, abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
    }
  }
  return { artifacts, warnings: warnings.map((w) => w.formattedMessage) };
}

/** Locate a key file by basename in the usual spots. */
function findKey(basenames) {
  const dirs = [path.join(KEYS), '/root/botchain-bridge', '/root/refs', '/root/.hermes/wallets', ROOT];
  for (const b of basenames) {
    for (const d of dirs) {
      const p = path.join(d, b);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function readKey(p) {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const pk = j.privateKey || j.private_key || j.key || (typeof j === 'string' ? j : null);
  if (typeof pk !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error(`no private key in ${p}`);
  return pk;
}

/** Load-or-create a wallet in .keys/ (mode 600). Never logs key material. */
function wallet(name, net = TESTNET) {
  ensureDir(KEYS);
  const p = path.join(KEYS, `${name}.json`);
  let pk;
  if (fs.existsSync(p)) pk = readKey(p);
  else {
    const w = Wallet.createRandom();
    pk = w.privateKey;
    fs.writeFileSync(p, JSON.stringify({ address: w.address, privateKey: pk }, null, 2), { mode: 0o600 });
  }
  return new Wallet(pk, provider(net));
}

function loadDeployer(net = TESTNET) {
  const p = findKey(['deployer.json', 'botchain-deployer.json']);
  if (!p) throw new Error('deployer key not found');
  return { wallet: new Wallet(readKey(p), provider(net)), path: p };
}

/** Send a contract call with explicit gas settings (testnets are picky). */
async function send(contract, method, args, signer, opts = {}) {
  const fee = await signer.provider.getFeeData();
  const overrides = { ...opts };
  if (fee.gasPrice) overrides.gasPrice = fee.gasPrice;
  const fn = contract.getFunction(method);
  if (!overrides.gasLimit) {
    try { overrides.gasLimit = await fn.estimateGas(...args, overrides); } catch { overrides.gasLimit = opts.fallbackGas || 900000n; }
  }
  const tx = await fn(...args, overrides);
  const rc = await tx.wait();
  return { hash: tx.hash, blockNumber: rc.blockNumber, gasUsed: rc.gasUsed, status: rc.status };
}

function writeJson(p, obj) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

module.exports = { ROOT, KEYS, DEPLOY_DIR, TESTNET, MAINNET, provider, compile, wallet, loadDeployer, send, writeJson, readJson, ensureDir, findKey, readKey };
