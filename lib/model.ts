export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConfig {
  version: string;
  fallbackRatio: number;
  ratioMinimum: number;
  ratioMaximum: number;
  earlyRows: number;
  liveRows: number;
}

export const MODEL: ModelConfig = {
  version: "peer-fitted-v4",
  fallbackRatio: 0.16,
  ratioMinimum: 0.015,
  ratioMaximum: 2.5,
  earlyRows: 160,
  liveRows: 30,
};

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_low_usd: number;
  implied_value_high_usd: number;
  implied_value_usd: number;
  launch_odds_pct: number;
  farm_verdict: "SET UP" | "MARGINAL" | "SKIP";
  modeled_net_usd: number;
  modeled_hours: number;
  modeled_net_per_hour: number;
  token_status: "pre-token";
  value_drivers: {
    fitted_ratio: number;
    fitted_ratio_low: number;
    fitted_ratio_high: number;
    training_sample: number;
    growth_coefficient: number;
    age_coefficient: number;
    chain_coefficient: number;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConfig;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  universe_size: number;
  calibration: {
    sample_size: number;
    folds: number;
    median_error_pct: number;
    within_two_x_pct: number;
  };
  rows: Omit<BoardRow, "farm_steps">[];
  live: LiveRow[];
}

interface PeerBenchmark {
  median: number;
  low: number;
  high: number;
  count: number;
}

const DAY_MS = 86_400_000;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("snapshot is not JSON");
  }
  if (!isRecord(raw)) throw new Error("snapshot is not an object");
  if (typeof raw.as_of !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.as_of)) {
    throw new Error("snapshot.as_of is invalid");
  }
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error("snapshot protocols or watchlist is missing");
  }
  const protocols = raw.protocols.map((value, index) => parseProtocol(value, index));
  return {
    as_of: raw.as_of,
    source: typeof raw.source === "string" ? raw.source : "DefiLlama protocol snapshot",
    floor_usd: integer(raw.floor_usd, 50_000_000),
    protocols,
    watchlist: raw.watchlist.filter((value): value is string => typeof value === "string"),
  };
}

function parseProtocol(value: unknown, index: number): SnapshotProtocol {
  if (!isRecord(value)) throw new Error(`protocol ${index} is not an object`);
  if (typeof value.slug !== "string" || typeof value.name !== "string") {
    throw new Error(`protocol ${index} has no slug or name`);
  }
  return {
    slug: value.slug,
    name: value.name,
    category: typeof value.category === "string" ? value.category : null,
    chains: Array.isArray(value.chains) ? value.chains.filter((v): v is string => typeof v === "string") : [],
    tvl_usd: numberValue(value.tvl_usd),
    change_7d: Number.isFinite(value.change_7d) ? Number(value.change_7d) : null,
    mcap_usd: Number.isFinite(value.mcap_usd) ? Number(value.mcap_usd) : null,
    listed_at: typeof value.listed_at === "string" ? value.listed_at : null,
    gecko_id: typeof value.gecko_id === "string" ? value.gecko_id : null,
    symbol: typeof value.symbol === "string" ? value.symbol : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function integer(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

export function rankablePreToken(p: SnapshotProtocol): boolean {
  return !hasToken(p) && p.category !== "CEX" && !VERSIONED.test(p.name);
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

function quantile(values: number[], fraction: number): number {
  if (values.length === 0) return MODEL.fallbackRatio;
  const ordered = values.slice().sort((a, b) => a - b);
  const position = (ordered.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return ordered[low]!;
  return ordered[low]! * (high - position) + ordered[high]! * (position - low);
}

function benchmark(values: number[]): PeerBenchmark {
  const usable = values.filter((value) => Number.isFinite(value) && value > 0);
  if (usable.length === 0) {
    return { median: MODEL.fallbackRatio, low: MODEL.fallbackRatio, high: MODEL.fallbackRatio, count: 0 };
  }
  return {
    median: quantile(usable, 0.5),
    low: quantile(usable, 0.25),
    high: quantile(usable, 0.75),
    count: usable.length,
  };
}

interface Benchmarks {
  byCategory: Map<string, PeerBenchmark>;
  overall: PeerBenchmark;
  coefficients: number[];
  calibration: RadarData["calibration"];
}

function ratioFor(p: SnapshotProtocol): number | null {
  if (!hasToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return null;
  const ratio = p.mcap_usd / p.tvl_usd;
  return ratio >= 0.015 && ratio <= 2.5 ? ratio : null;
}

function categoryKey(category: string | null): string {
  return (category ?? "other").toLowerCase();
}

function buildBenchmarks(snapshot: Snapshot): Benchmarks {
  const grouped = new Map<string, number[]>();
  const all: number[] = [];
  for (const protocol of snapshot.protocols) {
    const ratio = ratioFor(protocol);
    if (ratio === null) continue;
    all.push(ratio);
    const key = categoryKey(protocol.category);
    const values = grouped.get(key) ?? [];
    values.push(ratio);
    grouped.set(key, values);
  }
  const byCategory = new Map<string, PeerBenchmark>();
  for (const [key, values] of grouped) {
    if (values.length >= 4) byCategory.set(key, benchmark(values));
  }
  const overall = benchmark(all);
  const training = snapshot.protocols.filter((p) => ratioFor(p) !== null);
  const coefficients = fitCoefficients(training, snapshot.as_of);
  return {
    byCategory,
    overall,
    coefficients,
    calibration: crossValidate(training, snapshot.as_of),
  };
}

function peerBenchmark(p: SnapshotProtocol, benchmarks: Benchmarks): PeerBenchmark {
  return benchmarks.byCategory.get(categoryKey(p.category)) ?? benchmarks.overall;
}

function featureVector(p: SnapshotProtocol, asOf: string): number[] {
  const days = ageDays(asOf, p.listed_at) ?? 540;
  return [
    1,
    Math.log10(Math.max(1, p.tvl_usd)),
    Math.min(110, Math.max(-50, p.change_7d ?? 0)) / 100,
    Math.min(1460, Math.max(0, days)) / 1460,
    Math.log2(Math.max(1, p.chains.length)),
  ];
}

function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]!]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) {
      if (Math.abs(a[row]![column]!) > Math.abs(a[pivot]![column]!)) pivot = row;
    }
    [a[column], a[pivot]] = [a[pivot]!, a[column]!];
    const divisor = a[column]![column]! || 1e-12;
    for (let j = column; j <= n; j++) a[column]![j] = a[column]![j]! / divisor;
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = a[row]![column]!;
      for (let j = column; j <= n; j++) a[row]![j] = a[row]![j]! - factor * a[column]![j]!;
    }
  }
  return a.map((row) => row[n]!);
}

function fitCoefficients(rows: SnapshotProtocol[], asOf: string): number[] {
  const size = 5;
  const xtx = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const xty = Array<number>(size).fill(0);
  for (const row of rows) {
    const x = featureVector(row, asOf);
    const y = Math.log10(Math.max(1, row.mcap_usd ?? 1));
    for (let i = 0; i < size; i++) {
      xty[i] += x[i]! * y;
      for (let j = 0; j < size; j++) xtx[i]![j] += x[i]! * x[j]!;
    }
  }
  const ridge = [0, 0.02, 0.2, 0.2, 0.2];
  for (let i = 0; i < size; i++) xtx[i]![i] += ridge[i]!;
  return solve(xtx, xty);
}

function predictedMarketCap(p: SnapshotProtocol, asOf: string, coefficients: number[]): number {
  const x = featureVector(p, asOf);
  const logValue = x.reduce((sum, value, index) => sum + value * coefficients[index]!, 0);
  return 10 ** logValue;
}

function crossValidate(rows: SnapshotProtocol[], asOf: string): RadarData["calibration"] {
  const errors: number[] = [];
  let withinTwo = 0;
  const folds = 5;
  for (let fold = 0; fold < folds; fold++) {
    const train = rows.filter((_, index) => index % folds !== fold);
    const test = rows.filter((_, index) => index % folds === fold);
    const coefficients = fitCoefficients(train, asOf);
    for (const row of test) {
      const predicted = predictedMarketCap(row, asOf, coefficients);
      const actual = row.mcap_usd ?? predicted;
      errors.push(Math.abs(predicted - actual) / Math.max(1, actual));
      if (predicted >= actual / 2 && predicted <= actual * 2) withinTwo += 1;
    }
  }
  return {
    sample_size: rows.length,
    folds,
    median_error_pct: errors.length ? round(quantile(errors, 0.5) * 100, 1) : 0,
    within_two_x_pct: errors.length ? round((withinTwo / errors.length) * 100, 1) : 0,
  };
}

function weightedValue(
  p: SnapshotProtocol,
  asOf: string,
  benchmarks: Benchmarks,
): {
  value: number;
  low: number;
  high: number;
  factors: BoardRow["value_drivers"];
  age: number | null;
} {
  const age = ageDays(asOf, p.listed_at);
  const fittedRatio = Math.min(
    MODEL.ratioMaximum,
    Math.max(
      MODEL.ratioMinimum,
      predictedMarketCap(p, asOf, benchmarks.coefficients) / Math.max(1, p.tvl_usd),
    ),
  );
  const peers = peerBenchmark(p, benchmarks);
  const lowRatio = fittedRatio * (peers.low / Math.max(peers.median, 1e-9));
  const highRatio = fittedRatio * (peers.high / Math.max(peers.median, 1e-9));
  const value = Math.max(1, Math.round(p.tvl_usd * fittedRatio));
  return {
    value,
    low: Math.max(1, Math.round(p.tvl_usd * lowRatio)),
    high: Math.max(1, Math.round(p.tvl_usd * highRatio)),
    age,
    factors: {
      fitted_ratio: round(fittedRatio, 4),
      fitted_ratio_low: round(lowRatio, 4),
      fitted_ratio_high: round(highRatio, 4),
      training_sample: benchmarks.calibration.sample_size,
      growth_coefficient: round(benchmarks.coefficients[2] ?? 0, 4),
      age_coefficient: round(benchmarks.coefficients[3] ?? 0, 4),
      chain_coefficient: round(benchmarks.coefficients[4] ?? 0, 4),
    },
  };
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function primaryChain(p: SnapshotProtocol): string {
  return p.chains[0] ?? "its main chain";
}

function capitalBand(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

function actionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? "").toLowerCase();
  const chain = primaryChain(p);
  const capital = capitalBand(p.tvl_usd);
  if (/(lending|cdp|collateral)/.test(c)) return `Supply $${capital} of USDC to ${p.name} on ${chain}, then borrow no more than 35% against it.`;
  if (/(dex|exchange)/.test(c)) return `Provide $${capital} split across a narrow USDC pair in ${p.name} on ${chain}.`;
  if (/(rwa|real world)/.test(c)) return `Complete ${p.name}'s eligibility check, then mint or deposit $${capital} of its permitted yield asset on ${chain}.`;
  if (/(derivative|perpetual|options)/.test(c)) return `Deposit $${capital} of USDC margin into ${p.name} on ${chain} and open one small hedge.`;
  if (/(yield|leveraged farm)/.test(c)) return `Deposit $${capital} of USDC into ${p.name}'s simplest vault on ${chain}.`;
  if (/(liquid staking|restaking)/.test(c)) return `Stake a small ${capital} dollar position through ${p.name} and retain the receipt token on ${chain}.`;
  if (/(stable|synthetics)/.test(c)) return `Mint or deposit $${capital} through ${p.name} on ${chain} using a conservative collateral ratio.`;
  return `Deposit $${capital} of USDC into ${p.name}'s core contract on ${chain} only after checking the audit page.`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const capital = capitalBand(p.tvl_usd);
  const hold = age === null ? 45 : age < 180 ? 60 : age < 730 ? 45 : 30;
  return [
    `Use a separate wallet funded with at most $${capital + 20}; never reveal its recovery phrase or sign an unexplained transaction. Cost: up to $3 of gas. Time: 10 minutes.`,
    `${actionFor(p)} Keep the position modest and verify the contract address from the protocol's official page. Cost: $${capital} principal plus estimated gas. Time: 15 minutes.`,
    `Execute one qualifying action after 7 days, such as another small deposit, a repayment, a swap, or a governance vote where available. Cost: about $2-$8 of gas. Time: 10 minutes.`,
    `Hold for at least ${hold} days and export the transaction hashes; this creates evidence of sustained use before any token announcement. Cost: principal remains locked or exposed. Time: ${hold} days.`,
    `Check the protocol's official documentation or governance page for a token or points program; treat unsolicited links and DMs as fraud. Cost: $0. Time: 10 minutes weekly.`,
    `Unwind gradually, repay debt first, confirm no withdrawal queue or vesting condition remains, and record the net result. Cost: closing gas and any exit fees. Time: 30 minutes.`,
  ].map((step) => {
    const clean = step.trim();
    if (clean.length <= 600) return clean.length >= 20 ? clean : `${clean} Keep a transaction log.`;
    return `${clean.slice(0, 596)}...`;
  });
}

function tokenPrevalence(snapshot: Snapshot): (protocol: SnapshotProtocol) => number {
  const grouped = new Map<string, { total: number; tokenized: number }>();
  let total = 0;
  let tokenized = 0;
  for (const protocol of snapshot.protocols) {
    total += 1;
    const has = hasToken(protocol) ? 1 : 0;
    tokenized += has;
    const key = categoryKey(protocol.category);
    const counts = grouped.get(key) ?? { total: 0, tokenized: 0 };
    counts.total += 1;
    counts.tokenized += has;
    grouped.set(key, counts);
  }
  const baseline = tokenized / Math.max(1, total);
  return (protocol) => {
    const counts = grouped.get(categoryKey(protocol.category));
    return counts && counts.total >= 8 ? counts.tokenized / counts.total : baseline;
  };
}

function farmEconomics(
  impliedValue: number,
  odds: number,
  protocol: SnapshotProtocol,
  age: number | null,
): Pick<BoardRow, "farm_verdict" | "modeled_net_usd" | "modeled_hours" | "modeled_net_per_hour"> {
  const capital = capitalBand(protocol.tvl_usd);
  const hold = age === null ? 45 : age < 180 ? 60 : age < 730 ? 45 : 30;
  const hours = 0.25 + (hold / 7) * (10 / 60) + 0.5;
  const participationValue = impliedValue * 0.000002 * odds;
  const gas = 3 + (capital >= 150 ? 8 : 4) + (hold / 7) * 2 + 3;
  const capitalCost = capital * 0.05 * (hold / 365);
  const net = participationValue - gas - capitalCost;
  const perHour = net / hours;
  return {
    farm_verdict: perHour >= 8 ? "SET UP" : perHour >= 0 ? "MARGINAL" : "SKIP",
    modeled_net_usd: round(net, 2),
    modeled_hours: round(hours, 1),
    modeled_net_per_hour: round(perHour, 2),
  };
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const benchmarks = buildBenchmarks(snapshot);
  const prevalence = tokenPrevalence(snapshot);
  const selected = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const protocol = index.get(slug);
    if (protocol !== undefined) selected.set(slug, protocol);
  }
  const early = snapshot.protocols
    .filter((p) => !selected.has(p.slug) && rankablePreToken(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug))
    .slice(0, MODEL.earlyRows);
  for (const protocol of early) selected.set(protocol.slug, protocol);

  const scored = [...selected.values()].map((protocol) => {
    const weighted = weightedValue(protocol, snapshot.as_of, benchmarks);
    const rawOdds = prevalence(protocol);
    const growth = Math.min(110, Math.max(-50, protocol.change_7d ?? 0));
    const ageFactor = weighted.age === null ? 0.92 : 0.85 + Math.min(1460, weighted.age) / 1460 * 0.15;
    const odds = Math.min(0.95, Math.max(0.05, rawOdds * (1 + (growth / 100) * 0.25) * ageFactor));
    return {
      protocol,
      ...weighted,
      odds,
      economics: farmEconomics(weighted.value, odds, protocol, weighted.age),
    };
  });
  scored.sort((a, b) => b.value - a.value || a.protocol.slug.localeCompare(b.protocol.slug));
  const board = scored.map((row, index): BoardRow => ({
    rank: index + 1,
    slug: row.protocol.slug,
    name: row.protocol.name,
    category: row.protocol.category,
    chains: row.protocol.chains,
    tvl_usd: row.protocol.tvl_usd,
    change_7d: row.protocol.change_7d,
    age_days: row.age,
    implied_value_low_usd: row.low,
    implied_value_high_usd: row.high,
    implied_value_usd: row.value,
    launch_odds_pct: round(row.odds * 100, 1),
    ...row.economics,
    token_status: "pre-token",
    value_drivers: row.factors,
    farm_steps: farmSteps(row.protocol, row.age),
  }));

  const live = snapshot.protocols
    .filter((p) => hasToken(p) && p.category !== "CEX")
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, MODEL.liveRows)
    .map((p): LiveRow => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((row) => !snapshot.watchlist.includes(row.slug)).length,
    live_size: live.length,
    universe_size: snapshot.protocols.length,
    calibration: benchmarks.calibration,
    rows: board.map(({ farm_steps: _steps, ...row }) => row),
    live,
  };
  return { board, radar };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `only ${board.length} rows`;
  const slugs = new Set(board.map((row) => row.slug));
  const missing = [...new Set(snapshot.watchlist)].filter((slug) => !slugs.has(slug));
  if (missing.length) return `missing watchlist slugs: ${missing.slice(0, 5).join(", ")}`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank sequence breaks at ${i + 1}`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `value order breaks at ${i + 1}`;
    if (board[i]!.farm_steps.length < 3 || board[i]!.farm_steps.length > 12) return `${board[i]!.slug}: farm step count`;
    if (board[i]!.farm_steps.some((step) => step.length < 20 || step.length > 600)) return `${board[i]!.slug}: farm step length`;
  }
  if (board.length > 1 && new Set(board.map((row) => row.implied_value_usd)).size === 1) return "all implied values are equal";
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
