# Handoff — BOT Chain AgentPay (Agent OS modules 01 + 02)

Updated: 2026-10-06 (modules 01 and 02 both live)

## Current milestone

**Both agent-facing modules of BOT Chain's Agent OS are shipped and settling real value on testnet.**

- Module 01 — MCP server, 9 tools over stdio, real mainnet data. Verified with `node test/smoke.mjs`.
- Module 02 — AgentPay x402 rail: `AgentPayVault` + facilitator + 4 paid HTTP endpoints, live at
  `https://agentpay.104-252-77-136.sslip.io` under Let's Encrypt TLS, running under pm2 as `agentpay`.
- 9 settlements on-chain; 0.039 USDT settled; agent spent **zero gas**; replay attempt rejected 402.

## Live deployments (testnet 968 / bohr)

| item | value |
|---|---|
| vault | `0xD6ee2f19c7973baa8146A3B7D494983a59462586` |
| mock USDT | `0x4D3f154CF36a1033e0e5254c30518416f6ffc5c1` |
| payee / facilitator | `0x7b65fA9ae72EeF34d0092209070a81e9dCD49E5a` |
| domain separator | `0x8d03875ef6dacbddf76841d40370efe2a8b9e773ba49d2353a5137d7fba679cc` |
| config of record | `deployments/968.json` |
| nginx site | `/etc/nginx/sites-available/agentpay` → proxy to `127.0.0.1:9681` |
| pm2 process | `agentpay` (`pm2 save` already run) |

Keys: `.keys/{facilitator,agent}.json`, mode 600, gitignored. Deployer key is the pre-existing
`deployer.json` (Trestle testnet deployer) — used only as a gas source on testnet.

## Verified facts, established the hard way

- **BOT Chain USDT is vanilla Tether**: no EIP-2612 `permit`, no EIP-3009. Confirmed by scanning the
  deployed bytecode (`0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C`, 6,188 bytes, not a proxy) for the
  selectors. Consequence: x402's `exact` scheme is impossible here; use `batch-settlement`.
- **The hosted x402 facilitator only serves a fixed allowlist** (`/facilitator/supported`): Base
  Sepolia, Solana devnet, Algorand. Chain 677 is not and will not be on it. Build the facilitator.
- **`eth_getLogs` silently under-reports above ~15k blocks** on both testnet and mainnet BOT Chain.
  Chunk at 15k, halve on failure.
- **A paid endpoint must compute its answer before charging** — the first version settled and then
  threw a 500, charging the agent for an error.
- solc needs `viaIR: true` for `AgentPayVault.settle` (stack too deep otherwise).

## Gotchas for the next session

- The vote contract and the official bridge only exist on **mainnet 677**; payments settle on **968**.
  That split is deliberate and documented in `README.md`.
- Agent wallet `0xFFBa9023dC8ac5510284d9e3b706986d67c22DDB` holds 5 USDT of vault credit (4.987 after
  the run) and testnet BOT. The vault is **not** drained — top up with `scripts/setup-payer.cjs` if it
  falls below the demo prices.
- `process.env.PORT` defaults to 9681. Do not reuse 4180 (converge-canton) or 8088 (trestle).
- The HTTP surface is on chain-agnostic code: switching to mainnet is a change of
  `deployments/677.json` + real USDT address, no contract changes.

## Blocked

**GitHub publish.** No push-capable credential on the box: the live token (login `Nifemi0`) has only
`read:user` scope; the `ghp_` in `/root/.git-credentials` is revoked (401). Repo is committed locally
and ready — needs a classic PAT with `repo` scope, then:

```bash
git -C /root/botchain-mcp push "https://x-access-token:<PAT>@github.com/Nifemi0/botchain-agentpay.git" main
```

## Next session, in order

1. Push the repo (needs the PAT above).
2. Deploy the vault to mainnet 677 against real USDT and point the live endpoint at it.
3. Remote MCP transport (streamable HTTP) so agents connect by URL.
4. Metered batching — accumulate vouchers, settle N per transaction.
5. Module 03 (Agent Wallet) and the policy layer (per-call spend limits).
