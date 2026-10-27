/*
 * AgentPay — vault funding from the visitor's own BOT Chain wallet.
 *
 * The product's core function is: deposit USDT once, then pay per API call with a signed
 * voucher. This module lets a visitor connect their own wallet and perform that deposit
 * themselves, so the rail is usable end-to-end from the interface rather than only from a
 * script.
 *
 * No dependencies on purpose: the site is static, so this encodes the four calls it needs
 * by hand and talks to the wallet over EIP-1193. Reads go through the injected provider when
 * one is connected, and fall back to the public BOT Chain RPC otherwise.
 */
(function () {
  "use strict";

  var CHAIN = {
    id: 677,
    hex: "0x2a5",
    name: "BOT Chain",
    rpc: "https://rpc.botchain.ai",
    explorer: "https://scan.botchain.ai",
    currency: { name: "BOT", symbol: "BOT", decimals: 18 }
  };

  var VAULT = "0x54A0Ef469f005d295b60E7c071106953AC5B621C";
  var TOKEN = "0xe3Dc51CC0B4AF6EC01CA929e1be0092325aCAAf0";

  // keccak256(signature)[0:4] — see scripts/../vault ABI. Computed offline, embedded here.
  var SEL = {
    approve: "0x095ea7b3",
    balanceOf: "0x70a08231",
    allowance: "0xdd62ed3e",
    decimals: "0x313ce567",
    deposit: "0xb6b55f25",
    withdraw: "0x2e1a7d4d",
    balance: "0xe3d670d7",
    vaultStats: "0x6ff4ab8a"
  };

  // ---------------------------------------------------------------- encoding
  function word(hexNo0x) {
    return hexNo0x.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  }
  function wordAddr(addr) {
    return word(addr);
  }
  function wordUint(v) {
    return word(BigInt(v).toString(16));
  }
  function units(amountStr, decimals) {
    var s = String(amountStr).trim();
    if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
    var parts = s.split(".");
    var whole = parts[0] === "" ? "0" : parts[0];
    var frac = (parts[1] || "").slice(0, decimals).padEnd(decimals, "0");
    try {
      return BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(frac || "0");
    } catch (e) {
      return null;
    }
  }
  function fmt(v, decimals) {
    if (v === null || v === undefined) return "—";
    var neg = v < 0n;
    var x = neg ? -v : v;
    var base = BigInt(10) ** BigInt(decimals);
    var whole = (x / base).toString();
    var frac = (x % base).toString().padStart(decimals, "0").replace(/0+$/, "");
    return (neg ? "-" : "") + whole + (frac ? "." + frac : "");
  }
  function short(a) {
    return a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
  }

  // ------------------------------------------------------------------- state
  var state = { account: null, chainId: null, decimals: 6, wallet: null, vaultBal: null, allow: null, stats: null, busy: false };
  var $ = function (s) { return document.querySelector(s); };
  var el = {};

  function provider() {
    return window.ethereum || (window.web3 && window.web3.currentProvider) || null;
  }
  function hasProvider() {
    var p = provider();
    return Boolean(p && typeof p.request === "function");
  }

  function read(method, params) {
    var p = provider();
    if (p && typeof p.request === "function") return p.request({ method: method, params: params || [] });
    return fetch(CHAIN.rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: method, params: params || [] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error) throw new Error(j.error.message);
      return j.result;
    });
  }

  function call(to, data) {
    return read("eth_call", [{ to: to, data: data }, "latest"]);
  }
  function callNum(to, data, decimals) {
    return call(to, data).then(function (r) {
      if (!r || r === "0x") return null;
      return BigInt(r);
    });
  }

  function send(to, data) {
    return read("eth_sendTransaction", [{ from: state.account, to: to, data: data }]);
  }

  function receipt(hash) {
    return new Promise(function (resolve, reject) {
      var tries = 0;
      (function poll() {
        read("eth_getTransactionReceipt", [hash]).then(function (r) {
          if (r && r.blockNumber) return resolve(r);
          if (++tries > 60) return reject(new Error("timed out waiting for the transaction"));
          setTimeout(poll, 2500);
        }).catch(reject);
      })();
    });
  }

  // ------------------------------------------------------------------ render
  function say(node, msg, kind) {
    if (!node) return;
    node.textContent = msg || "";
    node.className = "vw-msg" + (kind ? " vw-" + kind : "");
  }
  function setBusy(on, label) {
    state.busy = on;
    ["#vw-approve", "#vw-deposit", "#vw-withdraw"].forEach(function (s) {
      var b = $(s);
      if (b) b.disabled = on;
    });
    if (el.connect) el.connect.disabled = on;
    if (label && el.status) el.status.textContent = label;
  }

  function render() {
    if (el.net) {
      el.net.textContent = state.account
        ? (state.chainId === CHAIN.id ? "on " + CHAIN.name : "on chain " + state.chainId)
        : "not connected";
      el.net.className = "vw-chip" + (state.account && state.chainId === CHAIN.id ? " vw-chip-ok" : "");
    }
    if (el.acct) el.acct.textContent = state.account ? short(state.account) : "";
    if (el.wallet) el.wallet.textContent = state.account ? fmt(state.wallet, state.decimals) : "—";
    if (el.vault) el.vault.textContent = state.account ? fmt(state.vaultBal, state.decimals) : "—";
    if (el.allow) el.allow.textContent = state.account ? fmt(state.allow, state.decimals) : "—";
    if (el.connect) {
      el.connect.textContent = state.account ? "Disconnect" : "Connect BOT Chain wallet";
      el.connect.hidden = false;
    }
    if (el.wrongChain) el.wrongChain.hidden = !(state.account && state.chainId !== CHAIN.id);
    if (el.depositDisabled) el.depositDisabled.hidden = Boolean(state.account);
    if (el.hint) {
      el.hint.textContent = hasProvider()
        ? (state.account ? "" : "Connect your wallet to deposit — your agent pays from this balance.")
        : "No BOT Chain wallet detected in this browser. Install one (or open in your wallet's browser) to deposit.";
    }
    if (el.settledCount && state.stats) {
      el.settledCount.textContent = state.stats.count.toString();
      el.settledTotal.textContent = fmt(state.stats.total, 6) + " USDT";
      el.settledHeld.textContent = fmt(state.stats.held, 6) + " USDT";
    }
  }

  function refresh() {
    if (!state.account) { render(); return Promise.resolve(); }
    return callNum(TOKEN, SEL.decimals).then(function (d) {
      if (d !== null) state.decimals = Number(d);
    }).catch(function () {}).then(function () {
      return Promise.all([
        callNum(TOKEN, SEL.balanceOf + wordAddr(state.account)).then(function (v) { state.wallet = v; }),
        callNum(VAULT, SEL.balance + wordAddr(state.account)).then(function (v) { state.vaultBal = v; }),
        callNum(TOKEN, SEL.allowance + wordAddr(state.account) + wordAddr(VAULT)).then(function (v) { state.allow = v; })
      ]);
    }).then(function () { render(); }).catch(function (e) {
      say(el.msg, "Could not read balances: " + (e && e.message ? e.message : e), "bad");
      render();
    });
  }

  function stats() {
    return call(VAULT, SEL.vaultStats).then(function (r) {
      if (!r || r === "0x") return;
      var h = r.slice(2);
      var count = BigInt("0x" + h.slice(0, 64));
      var total = BigInt("0x" + h.slice(64, 128));
      var held = BigInt("0x" + h.slice(128, 192));
      state.stats = { count: count, total: total, held: held };
      render();
    }).catch(function () {});
  }

  // ----------------------------------------------------------------- actions
  function ensureChain() {
    return read("eth_chainId").then(function (hex) {
      state.chainId = parseInt(hex, 16);
      render();
      if (state.chainId === CHAIN.id) return;
      return read("wallet_switchEthereumChain", [{ chainId: CHAIN.hex }]).catch(function (e) {
        var code = e && (e.code || (e.data && e.data.code));
        if (code === 4902 || /Unrecognized chain/i.test(String(e && e.message))) {
          return read("wallet_addEthereumChain", [{
            chainId: CHAIN.hex,
            chainName: CHAIN.name,
            nativeCurrency: CHAIN.currency,
            rpcUrls: [CHAIN.rpc],
            blockExplorerUrls: [CHAIN.explorer]
          }]);
        }
        throw e;
      }).then(function () {
        return read("eth_chainId").then(function (hex2) { state.chainId = parseInt(hex2, 16); render(); });
      });
    });
  }

  function connect() {
    var err = null;
    if (state.account) {
      state.account = null;
      render();
      return Promise.resolve();
    }
    return read("eth_requestAccounts").then(function (accs) {
      if (!accs || !accs.length) throw new Error("no account was shared by the wallet");
      state.account = accs[0];
      return ensureChain();
    }).catch(function (e) { err = e; }).then(function () {
      if (err) {
        say(el.msg, /rejected|denied/i.test(String(err.message)) ? "Connection request was rejected in your wallet." : ("Could not connect: " + err.message), "bad");
      } else if (!state.account) {
        say(el.msg, "No account was shared by the wallet.", "bad");
      } else {
        say(el.msg, "");
      }
      return refresh();
    });
  }

  function approve() {
    var amount = units(el.amount && el.amount.value, state.decimals);
    if (!state.account) { say(el.msg, "Connect a wallet first.", "bad"); return; }
    if (amount === null || amount <= 0n) { say(el.msg, "Enter an amount greater than zero.", "bad"); return; }
    if (state.wallet !== null && amount > state.wallet) {
      say(el.msg, "That is more USDT than this wallet holds (" + fmt(state.wallet, state.decimals) + ").", "bad");
      return;
    }
    setBusy(true, "waiting for the approval in your wallet…");
    say(el.msg, "Confirm the USDT approval in your wallet.");
    send(TOKEN, SEL.approve + wordAddr(VAULT) + wordUint(amount)).then(function (hash) {
      say(el.msg, "Approval submitted — waiting for the receipt…");
      return receipt(hash).then(function (r) {
        if (Number(r.status) !== 1) throw new Error("the approval transaction failed on-chain");
        say(el.msg, "Approved. Now press Deposit.");
        return refresh();
      });
    }).catch(function (e) {
      say(el.msg, "Approval failed: " + (e && e.message ? e.message : e), "bad");
    }).then(function () { setBusy(false, ""); });
  }

  function deposit() {
    var amount = units(el.amount && el.amount.value, state.decimals);
    if (!state.account) { say(el.msg, "Connect a wallet first.", "bad"); return; }
    if (amount === null || amount <= 0n) { say(el.msg, "Enter an amount greater than zero.", "bad"); return; }
    if (state.allow !== null && state.allow < amount) {
      say(el.msg, "Approve USDT for the vault first — the vault can only pull what you approve.", "bad");
      return;
    }
    setBusy(true, "waiting for the deposit in your wallet…");
    say(el.msg, "Confirm the deposit in your wallet.");
    var hash = null;
    send(VAULT, SEL.deposit + wordUint(amount)).then(function (h) {
      hash = h;
      say(el.msg, "Deposit submitted — waiting for the receipt…");
      return receipt(h);
    }).then(function (r) {
      if (Number(r.status) !== 1) throw new Error("the deposit transaction failed on-chain");
      say(el.msg, "Deposited. Your agent can now pay per call from this balance.");
      if (el.tx) {
        el.tx.hidden = false;
        el.tx.innerHTML = 'On-chain: <a class="vw-link" target="_blank" rel="noopener" href="' + CHAIN.explorer + "/tx/" + hash + '">' + short(hash) + " ↗</a>";
      }
      return refresh();
    }).catch(function (e) {
      say(el.msg, "Deposit failed: " + (e && e.message ? e.message : e), "bad");
    }).then(function () { setBusy(false, ""); });
  }

  function withdraw() {
    var amount = units(el.amount && el.amount.value, state.decimals);
    if (!state.account) { say(el.msg, "Connect a wallet first.", "bad"); return; }
    if (amount === null || amount <= 0n) { say(el.msg, "Enter an amount greater than zero.", "bad"); return; }
    if (state.vaultBal !== null && amount > state.vaultBal) {
      say(el.msg, "That is more than your vault balance (" + fmt(state.vaultBal, state.decimals) + ").", "bad");
      return;
    }
    setBusy(true, "waiting for the withdrawal in your wallet…");
    say(el.msg, "Confirm the withdrawal in your wallet.");
    send(VAULT, SEL.withdraw + wordUint(amount)).then(function (h) {
      say(el.msg, "Withdrawal submitted — waiting for the receipt…");
      return receipt(h);
    }).then(function (r) {
      if (Number(r.status) !== 1) throw new Error("the withdrawal transaction failed on-chain");
      say(el.msg, "Withdrawn back to your wallet.");
      return refresh();
    }).catch(function (e) {
      say(el.msg, "Withdrawal failed: " + (e && e.message ? e.message : e), "bad");
    }).then(function () { setBusy(false, ""); });
  }

  // -------------------------------------------------------------------- init
  function init() {
    el = {
      connect: $("#vw-connect"), net: $("#vw-net"), acct: $("#vw-acct"), wallet: $("#vw-wallet"),
      vault: $("#vw-vault"), allow: $("#vw-allow"), amount: $("#vw-amount"), msg: $("#vw-msg"),
      hint: $("#vw-hint"), tx: $("#vw-tx"), wrongChain: $("#vw-wrong"), depositDisabled: $("#vw-locked"),
      status: $("#vw-status"), settledCount: $("#vw-count"), settledTotal: $("#vw-total"), settledHeld: $("#vw-held")
    };
    if (el.connect) el.connect.addEventListener("click", connect);
    if ($("#vw-approve")) $("#vw-approve").addEventListener("click", approve);
    if ($("#vw-deposit")) $("#vw-deposit").addEventListener("click", deposit);
    if ($("#vw-withdraw")) $("#vw-withdraw").addEventListener("click", withdraw);
    if ($("#vw-max")) $("#vw-max").addEventListener("click", function () {
      if (state.wallet !== null && el.amount) el.amount.value = fmt(state.wallet, state.decimals);
    });
    if ($("#vw-switch")) $("#vw-switch").addEventListener("click", function () { ensureChain().then(refresh); });

    var p = provider();
    if (p && p.on) {
      p.on("accountsChanged", function (accs) {
        state.account = accs && accs.length ? accs[0] : null;
        refresh();
      });
      p.on("chainChanged", function (hex) { state.chainId = parseInt(hex, 16); refresh(); });
    }

    // Show the rail's public on-chain numbers immediately, wallet or not.
    stats();
    // Reconnect silently if the wallet already has this site authorised.
    if (hasProvider()) {
      read("eth_accounts").then(function (accs) {
        if (accs && accs.length) { state.account = accs[0]; return ensureChain().then(refresh); }
        return read("eth_chainId").then(function (hex) { state.chainId = parseInt(hex, 16); render(); });
      }).catch(function () { render(); });
    } else {
      render();
    }
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
