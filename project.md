# BOT Chain AgentPay — project

## What this is

A live implementation of the agent-facing half of **BOT Chain's published Agent OS**
(https://www.botchain.ai/en/agent-os/):

- **Module 01 — MCP Service.** An MCP server giving any MCP-capable agent (Claude, Codex, Hermes,
  Cursor) read access to BOT Chain: chain state, balances, ERC-20s, the official bridge's config and
  status, contract introspection, transactions, and the ecosystem leaderboard read straight from the
  chain because the public API is browser-gated.
- **Module 02 — AgentPay (x402).** A payment rail where an agent pays per call in USDT, **spending no
  gas**: prepaid vault, EIP-712 vouchers signed off-chain, permissionless batch settlement.

All six modules are marked *"support status to be confirmed by engineering"* on the chain's own site,
and nobody in the ecosystem has shipped one. Modules 01 and 02 are now live.

## Status

| part | state |
|---|---|
| MCP server (9 tools, stdio) | shipped, verified end-to-end |
| AgentPayVault + MockUSDT on testnet 968 | deployed |
| Paid HTTP surface (4 routes) | live under TLS at `https://agentpay.104-252-77-136.sslip.io` |
| Facilitator (verify + settle) | live, 9 settlements on-chain |
| Paying-agent demo | passes, including replay rejection |
| Mainnet (677) deploy | not started |
| GitHub publish | local commit ready; blocked on a push-capable token |

## Architecture

```
MCP clients ──stdio──► src/index.js        9 read tools          ──► mainnet 677 RPC
                                                                └─► api-bridge.botchain.ai

agents ──HTTPS──► src/http.js ──402──► x402.js ──EIP-712──► AgentPayVault (968)
                                  └── verify + settle ──────► facilitator pays gas
                                  └── data handlers ────────► mainnet 677
```

Payment settles on testnet while the data comes from mainnet, because the vote contract and the
official bridge exist only on mainnet. The vault is token-agnostic — mainnet is a config change.

## Established on-chain facts

- Vote contract `0xF5b22756CbD9193CE6F349bbD1835c2e5a6Cb181`; CrashLab is project **508**.
- BOT Chain USDT `0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C` is vanilla Tether (6,188 bytes,
  no proxy, no `permit`, no EIP-3009) — hence the `batch-settlement` design.
- Bridge deposit min $10 / max $30,150, fee 0 for destination 677, USDT only.
- `eth_getLogs` silently under-reports above ~15k blocks; chunk at 15k and halve on failure.
- Days/weeks on BOT Chain run Monday 00:00 Asia/Singapore (UTC+8).

## Roadmap

1. Mainnet deploy of the vault against real USDT; point the live endpoint at 677.
2. Metered batching — accumulate vouchers, settle N per transaction.
3. Remote MCP (streamable HTTP) so agents connect by URL instead of cloning.
4. Modules 03 (Agent Wallet) and the policy layer (per-call spend limits) — the voucher cap is the hook.
5. Ecosystem-program submission (`SUBMISSION.md` is written and ready).

## Risks

- **BOT Chain may build this internally.** Their page says support status is unconfirmed. The counter
  is being first, public, and correct — hence shipping on testnet the same day.
- **Testnet USDT is a mock.** Real mainnet USDT is the same shape (no permit/3009), so the design
  carries over; the remaining risk is the bridge's mint/burn behaviour, not the token interface.
- **Single facilitator key** pays all gas. Fine for testnet; mainnet wants a funded relayer with a
  spend ceiling.
