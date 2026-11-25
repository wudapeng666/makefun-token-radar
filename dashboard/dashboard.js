(function () {
  "use strict";

  var DATA = window.RADAR;
  var root = document.getElementById("board");
  if (!DATA) {
    root.textContent = "Radar data did not load.";
    return;
  }

  var state = { query: "", category: "all", tab: "pre-token", sort: "value", direction: -1, selected: null };
  var form = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  function money(value) {
    if (value === null || value === undefined || !isFinite(value)) return "n/a";
    if (Math.abs(value) >= 1e9) return "$" + (value / 1e9).toFixed(2) + "B";
    if (Math.abs(value) >= 1e6) return "$" + (value / 1e6).toFixed(1) + "M";
    if (Math.abs(value) >= 1e3) return "$" + Math.round(value / 1e3) + "K";
    return form.format(value);
  }
  function pct(value) {
    if (value === null || value === undefined || !isFinite(value)) return "n/a";
    return (value > 0 ? "+" : "") + value.toFixed(2) + "%";
  }
  function age(value) {
    if (value === null || value === undefined) return "unknown";
    return value >= 730 ? (value / 365).toFixed(1) + "y" : Math.round(value) + "d";
  }
  function node(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      if (key === "class") el.className = attrs[key];
      else if (key === "text") el.textContent = attrs[key];
      else if (key === "html") el.innerHTML = attrs[key];
      else if (key.slice(0, 2) === "on") el.addEventListener(key.slice(2), attrs[key]);
      else if (attrs[key] !== null && attrs[key] !== undefined) el.setAttribute(key, attrs[key]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (part) { if (part) el.appendChild(part); });
      else if (typeof child === "string") el.appendChild(document.createTextNode(child));
      else el.appendChild(child);
    }
    return el;
  }

  function chain(row) { return row.chains && row.chains.length ? row.chains[0] : "its main chain"; }
  function capital(tvl) {
    if (tvl >= 5e9) return 250;
    if (tvl >= 1e9) return 150;
    if (tvl >= 1e8) return 100;
    return 50;
  }
  function action(row) {
    var category = (row.category || "").toLowerCase();
    var amount = capital(row.tvl_usd);
    if (/(lending|cdp|collateral)/.test(category)) return "Supply $" + amount + " of USDC to " + row.name + " on " + chain(row) + ", then borrow no more than 35% against it.";
    if (/(dex|exchange)/.test(category)) return "Provide $" + amount + " split across a narrow USDC pair in " + row.name + " on " + chain(row) + ".";
    if (/(rwa|real world)/.test(category)) return "Complete " + row.name + "'s eligibility check, then mint or deposit $" + amount + " of its permitted yield asset on " + chain(row) + ".";
    if (/(derivative|perpetual|options)/.test(category)) return "Deposit $" + amount + " of USDC margin into " + row.name + " on " + chain(row) + " and open one small hedge.";
    if (/(yield|leveraged farm)/.test(category)) return "Deposit $" + amount + " of USDC into " + row.name + "'s simplest vault on " + chain(row) + ".";
    if (/(liquid staking|restaking)/.test(category)) return "Stake a small $" + amount + " position through " + row.name + " and retain the receipt token on " + chain(row) + ".";
    if (/(stable|synthetics)/.test(category)) return "Mint or deposit $" + amount + " through " + row.name + " on " + chain(row) + " using a conservative collateral ratio.";
    return "Deposit $" + amount + " of USDC into " + row.name + "'s core contract on " + chain(row) + " only after checking the audit page.";
  }
  function steps(row) {
    var amount = capital(row.tvl_usd);
    var hold = row.age_days === null ? 45 : row.age_days < 180 ? 60 : row.age_days < 730 ? 45 : 30;
    return [
      "Use a separate wallet funded with at most $" + (amount + 20) + "; never reveal its recovery phrase or sign an unexplained transaction. Cost: up to $3 of gas. Time: 10 minutes.",
      action(row) + " Keep the position modest and verify the contract address from the protocol's official page. Cost: $" + amount + " principal plus estimated gas. Time: 15 minutes.",
      "Execute one qualifying action after 7 days, such as another small deposit, a repayment, a swap, or a governance vote where available. Cost: about $2-$8 of gas. Time: 10 minutes.",
      "Hold for at least " + hold + " days and export the transaction hashes; this creates evidence of sustained use before any token announcement. Cost: principal remains locked or exposed. Time: " + hold + " days.",
      "Check the protocol's official documentation or governance page for a token or points program; treat unsolicited links and DMs as fraud. Cost: $0. Time: 10 minutes weekly.",
      "Unwind gradually, repay debt first, confirm no withdrawal queue or vesting condition remains, and record the net result. Cost: closing gas and any exit fees. Time: 30 minutes."
    ];
  }

  function visibleRows() {
    var q = state.query.trim().toLowerCase();
    return DATA.rows.filter(function (row) {
      if (state.category !== "all" && row.category !== state.category) return false;
      if (!q) return true;
      return [row.name, row.slug, row.category, (row.chains || []).join(" ")].join(" ").toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows() {
    return visibleRows().slice().sort(function (a, b) {
      var av;
      var bv;
      if (state.sort === "name") { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (state.sort === "tvl") { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (state.sort === "growth") { av = a.change_7d ?? -Infinity; bv = b.change_7d ?? -Infinity; }
      else if (state.sort === "age") { av = a.age_days ?? Infinity; bv = b.age_days ?? Infinity; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      return av === bv ? a.slug.localeCompare(b.slug) : av < bv ? -state.direction : state.direction;
    });
  }

  var dialog = node("dialog", { id: "protocol-detail" });
  dialog.addEventListener("close", function () { state.selected = null; });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (item) { return item.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    dialog.textContent = "";
    dialog.appendChild(node("div", { class: "detail-head" },
      node("div", null,
        node("span", { class: "eyebrow", text: "Rank " + row.rank + " / " + DATA.board_size }),
        node("h2", { text: row.name }),
        node("p", { class: "subtle", text: (row.category || "Other") + " · " + (row.chains || []).join(", ") })
      ),
      node("button", { class: "close", type: "button", text: "Close", onclick: function () { dialog.close(); } })
    ));
    var body = node("div", { class: "detail-body" });
    body.appendChild(node("section", { class: "detail-section" },
      node("h3", { text: "Data-derived value" }),
      node("div", { class: "metric-grid" },
        node("div", { class: "metric" }, node("span", { text: "TVL" }), node("b", { text: money(row.tvl_usd) })),
        node("div", { class: "metric" }, node("span", { text: "7-day TVL" }), node("b", { text: pct(row.change_7d) })),
        node("div", { class: "metric" }, node("span", { text: "Without token" }), node("b", { text: age(row.age_days) })),
        node("div", { class: "metric" }, node("span", { text: "Fitted FDV/TVL" }), node("b", { text: "×" + row.value_drivers.fitted_ratio })),
        node("div", { class: "metric" }, node("span", { text: "7d sensitivity" }), node("b", { text: row.value_drivers.growth_coefficient })),
        node("div", { class: "metric" }, node("span", { text: "Implied value" }), node("b", { text: money(row.implied_value_usd) }))
      )
    ));
    body.appendChild(node("p", { class: "subtle", text: "Peer range: " + money(row.implied_value_low_usd) + " to " + money(row.implied_value_high_usd) + ". The range uses the category peers' lower and upper quartile FDV/TVL, not a promise." }));
    body.appendChild(node("section", { class: "detail-section" },
      node("h3", { text: "Farm plan" }),
      node("ol", { class: "steps" }, steps(row).map(function (step) { return node("li", { text: step }); }))
    ));
    dialog.appendChild(body);
    if (!dialog.isConnected) root.appendChild(dialog);
    dialog.showModal();
  }

  function header() {
    return node("header", { class: "masthead" },
      node("div", null,
        node("div", { class: "eyebrow", text: "Launch Compass · token radar 01" }),
        node("h1", { text: "Find value before the ticker exists." })
      ),
      node("div", { class: "timestamp" },
        node("div", { text: "Snapshot " + DATA.as_of }),
        node("div", { text: DATA.model.version }),
        node("div", { text: "DefiLlama protocol index" })
      )
    );
  }

  function summary() {
    return node("section", { class: "summary" },
      node("div", null,
        node("p", { class: "note", text: "A fitted launch-value radar using TVL, seven-day growth, protocol age and chain breadth, with a category-peer uncertainty band. It does not predict whether a token will launch." }),
        node("p", { class: "subtle", text: "5-fold holdout: " + DATA.calibration.sample_size + " live protocols, median error " + DATA.calibration.median_error_pct + "%, " + DATA.calibration.within_two_x_pct + "% within 2×. Verify contracts and audits before using capital." })
      ),
      node("div", null, node("p", { text: "Snapshot screened" }), node("strong", { text: String(DATA.universe_size) })),
      node("div", null, node("p", { text: "Watchlist covered" }), node("strong", { text: DATA.watchlist_size + " / " + DATA.watchlist_size })),
      node("div", null, node("p", { text: "Pre-token rows" }), node("strong", { text: String(DATA.board_size) })),
      node("div", null, node("p", { text: "Below-floor discoveries" }), node("strong", { text: String(DATA.early_size) }))
    );
  }

  function toolbar() {
    var categories = Array.from(new Set(DATA.rows.map(function (row) { return row.category || "Other"; }))).sort();
    var input = node("input", { type: "search", value: state.query, placeholder: "Protocol, category or chain", "aria-label": "Search protocols" });
    input.addEventListener("input", function () { state.query = input.value; render(); });
    var select = node("select", { "aria-label": "Filter category" },
      node("option", { value: "all", text: "All categories" }),
      categories.map(function (category) { return node("option", { value: category, text: category, selected: category === state.category ? "selected" : null }); })
    );
    select.addEventListener("change", function () { state.category = select.value; render(); });
    var pretoken = node("button", { type: "button", text: "Pre-token", "aria-pressed": state.tab === "pre-token" ? "true" : "false", onclick: function () { state.tab = "pre-token"; render(); } });
    var live = node("button", { type: "button", text: "Already trading", "aria-pressed": state.tab === "live" ? "true" : "false", onclick: function () { state.tab = "live"; render(); } });
    return node("div", { class: "toolbar" },
      node("div", { class: "field" }, node("label", { text: "Search" }), input),
      node("div", { class: "field" }, node("label", { text: "Category" }), select),
      node("div", { class: "field" }, node("span", { text: "Token status" }), node("div", { class: "tabs" }, pretoken, live)),
      node("span", { class: "result-count", text: state.tab === "pre-token" ? visibleRows().length + " ranked rows" : DATA.live_size + " live-token protocols" })
    );
  }

  function sortButton(key, label) {
    return node("th", null, node("button", { type: "button", text: label + (state.sort === key ? (state.direction < 0 ? " ↓" : " ↑") : ""), onclick: function () {
      if (state.sort === key) state.direction *= -1;
      else { state.sort = key; state.direction = -1; }
      render();
    } }));
  }

  function preTokenTable() {
    var list = sortedRows();
    if (!list.length) return node("div", { class: "panel" }, node("div", { class: "empty", text: "No protocol matches this filter." }));
    var maximum = Math.max.apply(null, list.map(function (row) { return row.implied_value_usd; }));
    return node("section", { class: "panel" },
      node("div", { class: "panel-head" },
        node("div", null, node("h2", { text: "Pre-token value board" }), node("p", { text: "Every row is scored by the same formula; select one for its factors and farm plan." })),
        node("span", { class: "status", text: "No token on record" })
      ),
      node("div", { class: "table-wrap" },
        node("table", null,
          node("thead", null, node("tr", null,
            node("th", { text: "Rank" }), sortButton("name", "Protocol"), sortButton("tvl", "TVL"), sortButton("growth", "7d"), sortButton("age", "Age"), sortButton("value", "Implied value"), node("th", { text: "Model state" })
          )),
          node("tbody", null, list.map(function (row) {
            var growthClass = row.change_7d === null ? "" : row.change_7d >= 0 ? "positive" : "negative";
            return node("tr", { tabindex: "0", onclick: function () { openDetail(row.slug); }, onkeydown: function (event) { if (event.key === "Enter") openDetail(row.slug); } },
              node("td", { class: "rank", text: String(row.rank) }),
              node("td", null, node("div", { class: "protocol" }, node("b", { text: row.name }), node("span", { class: "subtle", text: (row.category || "Other") + " · " + (row.chains || []).slice(0, 2).join(", ") }))),
              node("td", { class: "num", text: money(row.tvl_usd) }),
              node("td", { class: "num " + growthClass, text: pct(row.change_7d) }),
              node("td", { class: "num", text: age(row.age_days) }),
              node("td", { class: "value" }, node("div", { class: "bar" }, node("i", { style: "width:" + Math.max(3, Math.round((row.implied_value_usd / maximum) * 100)) + "%" })), node("span", { class: "num", text: money(row.implied_value_usd) })),
              node("td", null, node("span", { class: "status", text: "ranked" }))
            );
          }))
        )
      )
    );
  }

  function liveTable() {
    return node("section", { class: "panel" },
      node("div", { class: "panel-head" },
        node("div", null, node("h2", { text: "Already trading" }), node("p", { text: "These protocols record a token, so they are set aside. Market cap is the market's value, not the model's." }))
      ),
      node("div", { class: "table-wrap" },
        node("table", null,
          node("thead", null, node("tr", null, node("th", { text: "Protocol" }), node("th", { text: "TVL" }), node("th", { text: "7d" }), node("th", { text: "Market cap" }), node("th", { text: "Category" }))),
          node("tbody", null, DATA.live.map(function (row) {
            return node("tr", null,
              node("td", null, node("div", { class: "protocol" }, node("b", { text: row.name }), node("span", { class: "subtle", text: (row.chains || []).slice(0, 2).join(", ") }))),
              node("td", { class: "num", text: money(row.tvl_usd) }),
              node("td", { class: "num " + (row.change_7d !== null && row.change_7d >= 0 ? "positive" : "negative"), text: pct(row.change_7d) }),
              node("td", { class: "num", text: money(row.mcap_usd) }),
              node("td", { class: "subtle", text: row.category || "Other" })
            );
          }))
        )
      )
    );
  }

  function methodology() {
    return node("section", { class: "method" },
      node("div", null,
        node("div", { class: "eyebrow", text: "Method" }),
        node("h2", { text: "Value is a weighted function, not a name list." }),
        node("p", { text: "A protocol below the house floor can still enter the early radar. The watchlist is always included, and live-token protocols are excluded from the ranking." })
      ),
      node("div", { class: "formula", text: "log10(marketCap) = intercept + β1·log10(TVL) + β2·clamp(7d growth) + β3·age + β4·log2(chains)\nfit = ridge least squares on live-token protocols in the sealed snapshot\nvalidation = 5-fold holdout, not fitted on the test fold\nimplied = TVL × the fitted market-cap / TVL ratio\nrange = category peers' 25th-75th percentile ratio around the fitted value\nsample = " + DATA.calibration.sample_size + " live protocols; folds = " + DATA.calibration.folds + "\nearly radar = top 160 pre-token protocols below the floor by TVL" })
    );
  }

  function render() {
    root.textContent = "";
    var shell = node("div", { class: "shell" });
    shell.appendChild(header());
    shell.appendChild(summary());
    shell.appendChild(toolbar());
    shell.appendChild(state.tab === "pre-token" ? preTokenTable() : liveTable());
    shell.appendChild(methodology());
    root.appendChild(shell);
    if (state.selected && !dialog.isConnected) root.appendChild(dialog);
    root.setAttribute("aria-busy", "false");
  }

  render();
})();
