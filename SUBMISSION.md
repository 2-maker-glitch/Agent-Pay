# AgentPay — BOT Chain ecosystem support submission

## One line

The first working implementation of BOT Chain's published Agent OS: an MCP server that gives any AI
agent read access to the chain, and an x402 payment rail that lets an agent pay per call in USDT
**without holding gas**.

## Why it matters to BOT Chain

The chain's own Agent OS page publishes six modules for machine agents and marks every one of them
*"feature scope and support status to be confirmed by engineering."* As of today no project in the
ecosystem has shipped any of them. Two are now live and verifiable — not a whitepaper, not a roadmap.

The thing this unlocks: **a machine can pay for a chain read without a human, an account, a
subscription, or a gas balance.** Gas on BOT Chain is ~20 gwei; a full paid read settles for
0.001–0.010 USDT. That price point is only possible on a chain this cheap, and it is the reason
machine-to-machine payments belong here rather than on Ethereum.

## What is live

| | |
|---|---|
| Public endpoint | `https://agentpay.104-252-77-136.sslip.io` (Let's Encrypt TLS, running under pm2) |
| Module 01 | MCP server, 9 tools, verified over stdio against mainnet |
| Module 02 | `AgentPayVault` + facilitator + 4 paid endpoints, settling on testnet 968 |
| Contracts | vault `0xD6ee2f19c7973baa8146A3B7D494983a59462586`, token `0x4D3f154CF36a1033e0e5254c30518416f6ffc5c1` |
| Evidence | 3 paid calls settled on-chain, plus a rejected replay — tx hashes in `README.md` |

## The engineering problem we solved that the spec doesn't mention

x402's standard `exact` scheme depends on **EIP-3009**, which only USDC implements. BOT Chain's USDT is
vanilla Tether — confirmed by scanning the deployed bytecode for the `permit`,
`transferWithAuthorization`, `receiveWithAuthorization` and `authorizationState` selectors: all absent.
And the hosted x402 facilitator only serves a fixed chain allowlist (Base Sepolia, Solana devnet,
Algorand); chain 677 will never be on it.

So the rail had to be built, not rented. This repo implements x402 v2's `batch-settlement` scheme: a
prepaid vault, EIP-712 vouchers signed off-chain by the agent, and a permissionless `settle()` that
anyone can submit — the agent's funds move only with the agent's signature, and the gas is paid by
whoever submits. Vouchers are batched into a single transaction when it pays to.

Any project on BOT Chain that wants agent payments hits this exact wall. It is now solved in the open.

## Ecosystem value

- **Agents can transact on BOT Chain today** — 9 read tools over MCP, no integration code per client.
- **A settlement primitive others can build on** — the vault is generic; any paid API on the chain can
  point at it.
- **Machine-payable chain data** — including the distinct-wallet count behind the ecosystem leaderboard,
  which the official board does not publish.
- **A reference for the chain's own roadmap** — modules 01 and 02 with working code and documented
  pitfalls (`eth_getLogs` silently under-reporting above 15k blocks; the advertised Ethereum RPC being
  unusable).

## What's next

1. Mainnet deploy of the vault (677) with real BOT Chain USDT — the contracts are token-agnostic.
2. Metered batching so N calls settle in one transaction.
3. Remote MCP transport (streamable HTTP) so any agent anywhere can connect by URL.
4. Module 03 (Agent Wallet) and the policy layer — per-call spend limits on top of the voucher cap.

## Reproduce it

```bash
node scripts/agent-demo.cjs https://agentpay.104-252-77-136.sslip.io
```

Prints each 402 challenge, the signed voucher, the settlement transaction, and the data returned.
