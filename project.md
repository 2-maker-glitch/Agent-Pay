# BOT Chain AgentPay — project

## What this is

A live implementation of the agent-facing half of **BOT Chain's published Agent OS**
(https://www.botchain.ai/en/agent-os/):

- **Module 01 — MCP Service.** An MCP server giving any MCP-capable agent (Claude, Codex, Hermes,
  Cursor) read access to BOT Chain: chain state, balances, ERC-20s, the official bridge's config and
  status, contract introspection, transactions, and the ecosystem leaderboard read straight from chain
  logs because the public API is browser-gated.
- **Module 02 — AgentPay (x402).** A payment rail where an agent pays per call in USDT and **spends no
  gas**: prepaid vault, EIP-712 vouchers signed off-chain, permissionless batch settlement.

All six modules are marked *"support status to be confirmed by engineering"* on the chain's own site.
Nobody in the ecosystem appears to have shipped one. Modules 01 and 02 are now live and settling.

## Status

| part | state |
|---|---|
| MCP server (9 tools, stdio) | shipped, verified end-to-end |
| AgentPayVault + MockUSDT on testnet 968 | deployed |
| Paid HTTP surface (4 routes) | live, 29 settlements, 0.069 USDT |
| Facilitator (verify + settle) | live, pays the gas |
| Console (browser drives the real protocol) | live, verified through the hosted URL |
| Hosted front door | https://agentpay-rail.netlify.app |
| Vercel bundle | prepared, not deployed (no valid token) |
| GitHub push | committed as Nifemi0, not pushed (no push credential) |
| Mainnet (677) deploy | prepared (`scripts/deploy-mainnet.cjs`), not run |

## Architecture

```
MCP clients ──stdio──► src/index.js        9 read tools      ──► mainnet 677 RPC
                                                            └─► api-bridge.botchain.ai

agents / browser ──HTTPS──► src/http.js ──402──► x402.js ──EIP-712──► AgentPayVault (968)
                                        └── verify + settle ──────► facilitator pays gas
                                        └── data handlers ───────► mainnet 677
```

Payments settle on testnet while data comes from mainnet, because the vote contract and the official
bridge exist only on mainnet. The vault is token-agnostic — mainnet is a config change
(`DEPLOYMENT=677`), not a rewrite. `scripts/deploy-mainnet.cjs` (dry-run unless `--fire`) deploys there
for ~0.017 BOT.

## Established on-chain facts

- Vote contract `0xF5b22756CbD9193CE6F349bbD1835c2e5a6Cb181`; CrashLab is project **508**.
- BOT Chain USDT `0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C` is vanilla Tether (6,188 bytes, no proxy,
  no `permit`, no EIP-3009) — hence the `batch-settlement` design.
- `settle()` = 80,123 gas = 0.0016 BOT at 20 gwei (measured over 6 settlements).
- Bridge deposit min $10 / max $30,150, fee 0 for destination 677, USDT only.
- `eth_getLogs` silently under-reports above ~15k blocks; chunk at 15k and halve on failure.
- Weeks on BOT Chain run Monday 00:00 Asia/Singapore (UTC+8).

## Design provenance

The visual language is **not invented** — it implements the reference Sky supplied (`talise.io`), with
tokens extracted from its computed styles rather than eyeballed:

```
--color-bg #edf0ea   --color-fg #121a0f    --color-accent #2f6a1f   --radius .75rem
--surface #fff       --fg-muted #55634e    --accent-soft #e6efdd    --accent-light #caffb8
--color-line rgba(18,26,15,.12)            h1 62px w500 ls -1.24px  h2 40px w500 ls -0.8px
                                           body: JetBrains Mono 17px · display: Hanken Grotesk
```

Two earlier visual directions were rejected (a generic dark dashboard, then an invented receipt
metaphor). See the `reference-driven-ui-design` skill for the rule that came out of it: get the
reference, implement it, don't author a direction.

## Roadmap

1. Push the repo; optionally redeploy to Vercel.
2. Mainnet vault (677) against real USDT; flip `DEPLOYMENT=677`.
3. Bring-your-own-wallet in the console — a stranger paying with their own funds.
4. Metered batching — N vouchers per transaction.
5. Remote MCP transport (streamable HTTP).
6. Modules 03 (Agent Wallet) and the policy layer (per-call spend limits).

## Risks

- **BOT Chain may build this internally.** Their page says support status is unconfirmed. The counter is
  being first, public and correct — hence shipping the same day.
- **The hosted link depends on the origin box** staying up: the API and the settlement key live there.
  Static assets are local to the host; `/health` and `/v1/*` are proxied.
- **One facilitator key** pays all gas. Fine on testnet; mainnet wants a funded relayer with a ceiling.
- **The console spends a demo float**, so a visitor watches a real settlement without risking funds.
