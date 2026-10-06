# AgentPay — BOT Chain Agent OS, modules 01 + 02

**A live implementation of the two agent-facing modules BOT Chain has published but nobody has shipped:**
an MCP server that gives any AI agent read access to the chain, and an x402 payment rail that lets an
agent pay per call in USDT — with the agent spending **zero gas**.

> Live: `https://agentpay.104-252-77-136.sslip.io` · settlement on BOT Chain testnet (bohr, `968`),
> data read from BOT Chain mainnet (`677`).

---

## Why the payment design looks like this

Standard x402 uses the `exact` scheme, which requires **EIP-3009** (`transferWithAuthorization`) — a
USDC feature. BOT Chain's USDT is vanilla Tether. Verified on-chain, not assumed:

```
USDT 0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C   6,188 bytes, not a proxy
  absent  permit (EIP-2612)             0xd505accf
  absent  transferWithAuthorization     0xe3ee160e
  absent  receiveWithAuthorization      0xef55bec6
  absent  authorizationState            0xe94a0102
  PRESENT approve                       0x095ea7b3
  PRESENT transferFrom                  0x23b872dd
```

The same reason x402 doesn't work with USDT on Ethereum. And the hosted x402 facilitator is a fixed
allowlist of chains — `eip155:84532`, `solana:EtWTRA…`, Algorand — **chain 677 is not on it and will
not be**. So this repo ships the facilitator too.

So the rail is x402 v2's **`batch-settlement`** scheme, built for exactly this constraint:

```
agent deposits USDT once  ──►  AgentPayVault (prepaid balance)
per call:  agent signs an EIP-712 voucher   ← no gas, no nonce, no chain write
           server verifies, settles on-chain ← server pays the gas
           response carries a receipt         ← tx hash, auditable
```

One voucher per call today; `settle()` takes arrays, so N vouchers collapse into one transaction
whenever batching is worth it.

## Live proof (not a mock)

Three paid calls from a real agent wallet, over public HTTPS:

| call | price | settlement tx |
|---|---|---|
| `GET /v1/chain/stats` | 0.001 USDT | `0x256356f7b1f539fc13d7c7848a6b0ddfa4d9ccc6f16c66a04844e3f631408958` |
| `GET /v1/address/0xfad8…9682` | 0.002 USDT | `0x329bfa78f31cf2b0f7fc72838c04fe3c923ef38984c10c259e097995b975fd86` |
| `GET /v1/votes/508?hours=6` | 0.010 USDT | `0x7ca7aab022138112eee38887041f353cddb1289c79d25c29fbff3b3d795de241` |

Reproduce with `node scripts/agent-demo.cjs` — it prints the 402, signs, retries, and shows each
receipt. The demo also re-sends a used voucher and gets **`402 invoice already used`**.

The third call returned real mainnet data: CrashLab project 508 — **71 votes from 16 distinct wallets**
across a 6-hour window. The distinct-wallet count is information the official leaderboard does not show.

## Deployed addresses (testnet 968)

| contract | address |
|---|---|
| `AgentPayVault` | `0xD6ee2f19c7973baa8146A3B7D494983a59462586` |
| `MockUSDT` (test, 6dp, no permit — same shape as real USDT) | `0x4D3f154CF36a1033e0e5254c30518416f6ffc5c1` |
| payee / facilitator | `0x7b65fA9ae72EeF34d0092209070a81e9dCD49E5a` |
| EIP-712 domain separator | `0x8d03875ef6dacbddf76841d40370efe2a8b9e773ba49d2353a5137d7fba679cc` |

## Human surface

A reviewer with a browser and no terminal can use the whole thing. Open the root URL and the console
shows live vault state, the pricing table, and the settlement log — then clicking a paid route runs
the entire payment flow server-side and renders it as it happens:

```
1  Request the paid route      GET /v1/votes/508?hours=6
2  Sign the EIP-712 voucher     no gas, no nonce, no chain write
3  Facilitator settles         tx 0x649a73c9… → scan.bohr.life
4  Data returned               live from BOT Chain mainnet
```

The console signs with the demo agent wallet and pays from its vault balance; a real integration signs
with its own key — the flow is identical. It is rate-limited to one call per 4 seconds and 120 per hour
because the vault float is finite.

## Endpoints

Free: `GET /` (console), `GET /health`, `GET /v1/pricing`, `GET /v1/vault`, `GET /v1/receipts`,
`GET /v1/demo/call?route=/v1/chain/stats` (runs the payer flow for the console, 4s cooldown)

Paid (each answers `402` then serves on payment):

| route | price | data |
|---|---|---|
| `GET /v1/chain/stats` | 0.001 USDT | mainnet head, gas price |
| `GET /v1/address/:address` | 0.002 USDT | BOT + USDT balance, nonce, contract? |
| `GET /v1/bridge/status?chainId=1` | 0.002 USDT | official bridge pause/min/max/liquidity |
| `GET /v1/votes/:projectId?hours=6` | 0.010 USDT | on-chain votes **and distinct wallets** |

`402` body:

```json
{ "x402Version": 2, "error": "payment required",
  "accepts": [{ "scheme": "batch-settlement", "network": "eip155:968",
    "asset": "0x4D3f…c5c1", "payTo": "0x7b65…9E5a",
    "maxAmountRequired": "1000", "amountFormatted": "0.001 USDT",
    "extra": { "vault": "0xD6ee…2586", "invoiceId": "0x…", "expiry": 1759754000 } }] }
```

Pay by re-sending with `X-PAYMENT: base64(JSON)` carrying an EIP-712 `Voucher` signature; the response
comes back with an `X-PAYMENT-RESPONSE` receipt (tx hash + explorer link).

## Module 01 — the MCP server (read access for any agent)

`src/index.js` speaks MCP over stdio, so Claude, Codex, Hermes or Cursor connect with no integration
code. Nine tools, all reading real mainnet data:

`chain_stats` · `address_overview` · `token_info` · `bridge_config` · `bridge_status` ·
`ecosystem_votes` · `ecosystem_top` · `contract_inspect` · `tx_info`

```bash
node test/smoke.mjs                       # spawns the server as an agent does, calls every tool
claude mcp add botchain -- node /root/botchain-mcp/src/index.js
hermes mcp add botchain --command node --args /root/botchain-mcp/src/index.js
```

Two undocumented chain behaviours worth knowing, both found the hard way:

- **`eth_getLogs` silently under-reports above ~15k blocks** on BOT Chain — no error, just fewer logs.
  The voter scan chunks at 15k and halves on failure.
- **The chain's advertised Ethereum RPC is not usable JSON-RPC.** `bridge_status` falls back to public
  nodes per chain.

## Repo layout

```
src/index.js          MCP server (9 tools, stdio)
src/http.js           paid HTTP surface (402 challenge -> verify -> settle -> serve)
src/x402.js           challenge construction, voucher verification, settlement
contracts/            AgentPayVault.sol, MockUSDT.sol
scripts/lib.cjs       compile / keys / tx helpers
scripts/deploy.cjs    compile + deploy + seed
scripts/setup-payer.cjs  fund the agent, approve, deposit
scripts/agent-demo.cjs   the paying agent, end to end
deployments/968.json  addresses, ABIs, domain separator
SUBMISSION.md         BOT Chain ecosystem-program write-up
```

## Run it

```bash
npm install
node scripts/deploy.cjs            # compile + deploy to bohr 968
node scripts/setup-payer.cjs       # agent: gas, USDT, approve, deposit
node src/http.js                   # or: pm2 start src/http.js --name agentpay
node scripts/agent-demo.cjs        # or: node scripts/agent-demo.cjs https://your-host
```

Keys land in `.keys/` (mode 600, gitignored). Never commit them.

## Conformance to BOT Chain's published Agent OS

| module | status |
|---|---|
| 01 MCP Service — read chain data, call onchain tools | **shipped** (9 tools, verified over stdio) |
| 02 AgentPay (x402) — native machine payments | **shipped on testnet** (vault + facilitator + paid endpoints, settling live) |
| 03 Agent Wallet | not started |
| 04 Agent Identity | partially: payer is identified by its signing key + on-chain receipts |
| 05 Skill Hub | the MCP tool list is the primitive; a registry is the next layer |
| policy layer — permissions, limits, execution policies | not started (per-voucher caps are the hook) |

The chain's Agent OS page marks all six modules *"support status to be confirmed by engineering"*.
This repo is the first working implementation of two of them.
