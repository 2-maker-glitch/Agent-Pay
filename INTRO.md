# AgentPay — introduction (for sending on)

## The short version (paste this)

> I built **AgentPay** — the first working implementation of the agent-facing half of BOT Chain's
> published Agent OS.
>
> It's two things. **An MCP server** that gives any AI agent (Claude, Codex, Hermes, Cursor) live read
> access to BOT Chain — nine tools, no integration code. **And an x402 payment rail** so an agent can
> pay per call in USDT and **spend zero gas doing it**.
>
> That second part needed real work. x402's standard scheme depends on EIP-3009, which is a USDC feature
> — BOT Chain's USDT doesn't have it, and the hosted x402 facilitator doesn't serve chain 677. I verified
> that by scanning the deployed bytecode for the function selectors rather than trusting docs. So the
> rail is x402 v2's batch-settlement scheme, built here: the agent signs an EIP-712 voucher off-chain
> (no gas, no nonce, no transaction), and the facilitator submits it and pays the fee. `settle()` costs
> a fixed 80,123 gas — 0.0016 BOT — which is what makes a 0.001 USDT call viable at all.
>
> **Live and settling now: https://agentpay-rail.netlify.app** — click any route and your browser runs
> the actual exchange: 402 → signed voucher → on-chain settlement, with the transaction hash as the
> receipt. 28 settlements so far, vault at `0xD6ee2f19c7973baa8146A3B7D494983a59462586`.
>
> Currently on BOT Chain testnet 968, with chain data read from mainnet 677. The vault is
> token-agnostic, so mainnet is a deployment rather than a rewrite.
>
> Worth a look if the ecosystem is serious about the Agent OS roadmap — modules 01 and 02 are the two
> that face agents, and as far as I can tell nobody has shipped either.

## The two-line version (for a DM)

> Built the first working implementation of BOT Chain's Agent OS: an MCP server giving any agent read
> access to the chain, plus an x402 rail where an agent pays per call in USDT with zero gas (signed
> vouchers, since BOT Chain's USDT has no EIP-3009). Live and settling: https://agentpay-rail.netlify.app

## Facts behind the claims (if asked)

| | |
|---|---|
| Live | https://agentpay-rail.netlify.app |
| Vault (testnet 968) | `0xD6ee2f19c7973baa8146A3B7D494983a59462586` |
| Test USDT | `0x4D3f154CF36a1033e0e5254c30518416f6ffc5c1` |
| Settlements | 28 · 0.068 USDT settled |
| Prices | 0.001 / 0.002 / 0.002 / 0.010 USDT |
| settle() cost | 80,123 gas = 0.0016 BOT at 20 gwei |
| MCP tools | chain_stats, address_overview, token_info, bridge_config, bridge_status, ecosystem_votes, ecosystem_top, contract_inspect, tx_info |
| Data source | BOT Chain mainnet 677 |
| Settlement | BOT Chain testnet 968 |

## Stated honestly

- Settlement is on **testnet** with a test USDT that deliberately replicates the real token's
  constraints. The vault contract is token-agnostic.
- The console pays from a **demo float**, so a visitor watches a real settlement without risking funds.
- **One facilitator key** submits every settlement — fine on testnet, wants a spend ceiling in production.
- Module 01's MCP transport is **stdio (local)**; a remote transport is the next piece.
