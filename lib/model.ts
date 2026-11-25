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
  baseMultiple: number;
  growthWeight: number;
  growthFloor: number;
  growthCap: number;
  maturityFloor: number;
  maturityDays: number;
  unknownAgeDays: number;
  earlyRows: number;
  liveRows: number;
}

export const MODEL: ModelConfig = {
  version: "launch-compass-v2",
  baseMultiple: 0.18,
  growthWeight: 0.38,
  growthFloor: -50,
  growthCap: 110,
  maturityFloor: 0.55,
  maturityDays: 1460,
  unknownAgeDays: 540,
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
  implied_value_usd: number;
  token_status: "pre-token";
  value_drivers: {
    category_multiple: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
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
  rows: Omit<BoardRow, "farm_steps">[];
  live: LiveRow[];
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

/** Category economics, not protocol names, set the launch-value multiple. */
export function categoryMultiple(category: string | null): number {
  const c = (category ?? "other").toLowerCase();
  if (/(rwa|real world)/.test(c)) return 0.24;
  if (/(derivative|perpetual|options)/.test(c)) return 0.21;
  if (/(lending|cdp|collateral)/.test(c)) return 0.17;
  if (/(dex|exchange)/.test(c)) return 0.16;
  if (/(yield|leveraged farm)/.test(c)) return 0.15;
  if (/(liquid staking|restaking)/.test(c)) return 0.13;
  if (/(stable|synthetics)/.test(c)) return 0.12;
  if (/(bridge|canonical bridge)/.test(c)) return 0.1;
  return 0.14;
}

export function weightedValue(p: SnapshotProtocol, asOf: string): { value: number; factors: BoardRow["value_drivers"]; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const eAge = age ?? MODEL.unknownAgeDays;
  const growth = Math.min(MODEL.growthCap, Math.max(MODEL.growthFloor, p.change_7d ?? 0));
  const growthMultiplier = Math.max(0.35, 1 + (growth / 100) * MODEL.growthWeight);
  const maturityMultiplier = MODEL.maturityFloor + (Math.min(Math.max(eAge, 0), MODEL.maturityDays) / MODEL.maturityDays) * (1 - MODEL.maturityFloor);
  const breadthMultiplier = 1 + Math.min(0.12, Math.log2(Math.max(1, p.chains.length)) * 0.025);
  const categoryMultiplier = categoryMultiple(p.category);
  const value = Math.max(1, Math.round(p.tvl_usd * MODEL.baseMultiple * categoryMultiplier * growthMultiplier * maturityMultiplier * breadthMultiplier));
  return {
    value,
    age,
    factors: {
      category_multiple: round(categoryMultiplier, 4),
      growth_multiplier: round(growthMultiplier, 4),
      maturity_multiplier: round(maturityMultiplier, 4),
      breadth_multiplier: round(breadthMultiplier, 4),
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

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
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

  const scored = [...selected.values()].map((protocol) => ({ protocol, ...weightedValue(protocol, snapshot.as_of) }));
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
    implied_value_usd: row.value,
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
