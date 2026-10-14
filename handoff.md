# Handoff — BOT Chain AgentPay (Agent OS modules 01 + 02)

Updated: 2026-10-14 (mainnet contract + public-site visual refresh live)

## 2026-10-14 llms.txt

- Added `/llms.txt` with canonical website/page links, X profile and launch post, BOT Chain mainnet deployment details, protocol flow, live-vs-demo boundary, API pricing and MCP tools.
- Added `<link rel="alternate" type="text/plain" href="/llms.txt">` to every page and a visible footer link.
- Corrected the PNG favicon MIME declaration from `image/svg+xml` to `image/png`.

## 2026-10-14 exact-logo correction

- Second user correction: the manually redrawn rounded-square mark still changed the supplied logo's proportions and stroke geometry.
- The exact uploaded image is now the source of truth: `public/assets/agentpay-logo-source.jpg` preserves the untouched upload; `agentpay-logo-exact.png` is a background-removed crop of those same pixels, not a redraw.
- Header/footer marks use that exact PNG directly. The favicon, 192px icon and social card are generated from the same extracted pixels.

## 2026-10-14 logo-led correction

- User correction: the supplied logo is a rounded-square shell with a diagonal rail and green endpoint—not a circular plus. The prior orange editorial system did not follow the logo and was rejected.
- Rebuilt the entire shared visual system from the logo: off-white `#eceee9`, ink `#12180e`, deep green `#316820`, lime `#d8ed76`; rounded modular surfaces, diagonal connections and circular endpoint motifs.
- Removed orange, newspaper/broadsheet rules, sharp ledger styling and generic circular-plus marks.
- Added the correct vector mark (`public/assets/agentpay-mark.svg`), matching favicon, and a new 1200×630 logo-led social card (`public/assets/agentpay-og-v3.png`).

## 2026-10-14 multi-page redesign

- Replaced the previous one-page Talise-style site completely; retained only the AgentPay circular plus mark.
- New information architecture: `/` home, `/product/` payment rail, `/developers/` integration guide, `/network/` BOT Chain rationale, `/console/` live payment demo.
- New visual system: editorial protocol dossier — paper background, black rules/type, signal orange and yellow, asymmetric compositions, no card-grid SaaS template.
- Shared assets are `public/site.css` and `public/site.js`; `scripts/build-site.sh` copies the complete recursive public tree.
- New 1200×630 social card at `public/assets/agentpay-og-v2.png` is used on every page.
- Browser verification: all five pages return 200 with zero desktop overflow; all five return 200 at 390px after fixing the Console grid's min-content overflow. Mobile menu opens on every page. No browser console/page errors in production.
- Functional verification: the rebuilt Console loaded four live prices and completed a real demonstration call for 0.001 USDT on testnet; receipt returned at block 26806644. `/health` is 200 and an unpaid paid route remains 402.

## 2026-10-14 milestone

- Public front door refreshed at `https://agentpay-rail.netlify.app`.
- Added the AgentPay × BOT Chain launch art, protocol-flow diagram, voucher anatomy, and settlement-economics visual.
- Added favicon plus Open Graph / X large-card metadata.
- Mainnet vault is linked and identified as chain 677: `0xAd06420D3e247186195189ed0DF571Cdce9f038C`.
- The page remains explicit that the clickable settlement demo uses testnet 968; no production claim was substituted for the demo.
- `scripts/build-site.sh` now includes `assets/` and `favicon.svg` while preserving the `/health` and `/v1/*` proxy rules.
- Live verification: all static assets + four free API endpoints return 200; an unpaid paid-route request returns 402; Chromium desktop 1440px and mobile 390px show zero horizontal overflow and no console/page errors.

## Read this first

Two of the six modules on BOT Chain's published Agent OS are built, deployed and settling. The work
lives in `/root/botchain-mcp` (git, committed as `Nifemi0`, **not pushed** — see Blocked).
The public front door is **https://agentpay-rail.netlify.app**.

## Current state

| | |
|---|---|
| Hosted front door | `https://agentpay-rail.netlify.app` (Netlify, static assets local + API proxied) |
| Origin (holds the settlement key) | `https://agentpay.104-252-77-136.sslip.io` · pm2 process `agentpay` · nginx site `agentpay` |
| Relocated locally at | `/root/agentpay-site` (built by `scripts/build-site.sh`) |
| Settlements on chain | 29 · 0.069 USDT · vault holds 5.0 USDT |
| Sendable intro | `INTRO.md` (long version, DM version, facts table, honest limits) |
| Design | implements the reference grammar at `talise.io` — tokens extracted, not invented |

### Deployments (BOT Chain testnet 968 / bohr)

| item | value |
|---|---|
| AgentPayVault | `0xD6ee2f19c7973baa8146A3B7D494983a59462586` |
| MockUSDT (6dp, no permit/3009 — mirrors real USDT) | `0x4D3f154CF36a1033e0e5254c30518416f6ffc5c1` |
| payee / facilitator | `0x7b65fA9ae72EeF34d0092209070a81e9dCD49E5a` |
| agent (pays from vault credit) | `0xFFBa9023dC8ac5510284d9e3b706986d67c22DDB` |
| EIP-712 domain separator | `0x8d03875ef6dacbddf76841d40370efe2a8b9e773ba49d2353a5137d7fba679cc` |
| config of record | `deployments/968.json` |

Keys: `.keys/{facilitator,agent}.json` (mode 600, gitignored). Testnet gas came from the pre-existing
`deployer.json` (Trestle's testnet deployer) — **testnet only, mainnet untouched**.

## How it works (the part that matters)

```
agent ──GET paid route──► 402 { price, invoiceId, expiry, payee }
                        ──sign EIP-712 voucher──► (no gas, no nonce, no chain write)
                        ──GET + X-PAYMENT header──► facilitator verifies
                                                 ──► settle() on 968 (facilitator pays gas)
                                                 ──► data returned + receipt (tx hash) in X-PAYMENT-RESPONSE
```

- **Why not x402-exact:** it needs EIP-3009 (`transferWithAuthorization`). BOT Chain's USDT is vanilla
  Tether — verified by scanning the deployed bytecode for selectors, not from docs. The hosted x402
  facilitator also serves a fixed chain allowlist that excludes 677. Hence x402 v2 `batch-settlement`,
  built here.
- **settle() cost:** 80,123 gas = 0.0016 BOT at 20 gwei (measured across 6 settlements).
- **Prices:** 0.001 / 0.002 / 0.002 / 0.010 USDT. The cheapest route earns roughly its gas; batching is
  what makes the cheap end comfortable.
- **Settlement network is a config choice:** `DEPLOYMENT=677 pm2 restart agentpay --update-env` flips
  the rail to mainnet. `scripts/deploy-mainnet.cjs` deploys the vault there (dry-run unless `--fire`).

## Files

```
src/index.js            MCP server, 9 tools, stdio
src/http.js             paid HTTP surface + console + /v1/demo/{sign,call,domain} + static assets
src/x402.js             challenge construction, voucher verify, settlement
contracts/              AgentPayVault.sol, MockUSDT.sol
public/index.html       the console (Talise grammar; single file, no build step)
public/fonts/           self-hosted: Hanken Grotesk + JetBrains Mono (the reference's own families)
public/shots/           real screenshots of this deployment, used as the page's imagery
scripts/                lib, deploy, setup-payer, agent-demo, deploy-mainnet, mainnet-recon,
                        gas-cost, build-site.sh
deployments/968.json    addresses, ABIs, domain separator
INTRO.md / README.md / SUBMISSION.md / project.md / handoff.md
```

## Endpoints

Free: `/` (console) · `/health` · `/v1/pricing` · `/v1/vault` · `/v1/receipts` ·
`/v1/demo/domain` · `/v1/demo/sign` (signature only, never pays) · `/v1/demo/call` (runs the flow
server-side) · `/fonts/*` · `/shots/*`

Paid (402 → settle → serve): `/v1/chain/stats` · `/v1/address/:address` ·
`/v1/bridge/status?chainId=` · `/v1/votes/:projectId?hours=`

## Verified this session (mechanical, not opinion)

- 29 settlements on chain, `settleCount` on chain matches the server count exactly.
- A real paid call **through the hosted URL**: tx `0xa574e9df…` block 25941440, 6.5s round trip.
- Hosted: fonts + 4/4 images load from the host, `/health` and `/v1/pricing` 200 through the proxy,
  the paywall still answers 402 with its body intact.
- Mobile 390px: zero horizontal overflow (twice fixed — grid/flex children default to `min-content`).
- Type metrics match the reference: h1 62px w500 ls −1.24px, h2 40px w500 ls −0.8px, body JetBrains Mono.
- Mobile page height 15,584px vs the reference's 15,586px — density is in the same band.
- Browsers log one red `402` per paid call. **That is the product working, not an error.**

## Blocked

1. **GitHub push.** No push-capable credential on this box: the live token has only `read:user`, the one
   in `/root/.git-credentials` is revoked (401), no fine-grained `github_pat_` anywhere, no SSH key.
   Repo is committed and ready. Needs a classic PAT with `repo` scope, then:
   `git -C /root/botchain-mcp push "https://x-access-token:<PAT>@github.com/Nifemi0/botchain-agentpay.git" main`
2. **Vercel.** CLI installed, but its token is invalid and no token exists in any project here.
   The bundle is Vercel-ready (`/root/agentpay-site/vercel.json` has external rewrites) — needs a token
   from vercel.com/account/tokens, then `vercel deploy --prod` from that directory.

## Next, in order

1. Push the repo (PAT above); optionally redeploy on Vercel.
2. Deploy the vault to **mainnet 677** against real USDT (`scripts/deploy-mainnet.cjs --fire`, costs
   ~0.017 BOT from the ops float) and flip `DEPLOYMENT=677`.
3. **Bring-your-own-wallet in the console** — browser wallet → approve → deposit → sign in-page. This is
   the difference between a demo that spends our float and a product a stranger can pay with.
4. Metered batching — accumulate vouchers, settle N per transaction.
5. Remote MCP transport (streamable HTTP) so agents connect by URL instead of a local process.
6. Module 03 (Agent Wallet) and the policy layer (per-call spend limits).

## Lessons worth keeping

- **Two rejected designs before this one.** The first was a generic dark dashboard; the second was my own
  invented "receipt/settlement slip" direction. Both were rejected. The rule (see the
  `reference-driven-ui-design` skill): **do not author a visual direction — get the reference and
  implement it.** Sky supplies references (talise.io).
- **Render the UI in a real browser and read the DOM back.** curl-based checks missed a blank stats
  strip (my `$()` was `querySelector` and the code indexed it like a NodeList), a 580px mobile overflow,
  and a nonce collision between concurrent settlements.
- **A paid endpoint must build its answer before charging** — the first version settled and then 500'd,
  billing the agent for an error.
- **`eth_getLogs` silently under-reports above ~15k blocks** on BOT Chain — chunk at 15k, halve on failure.
- **solc needs `viaIR: true`** for `AgentPayVault.settle` (stack too deep otherwise).
