// squeezeScore.js — ES module for Chrome extensions / web
// Nothing hits 100; scores capped at 99.

/** ---------- Utilities ---------- */
const clamp99 = (x) => Math.min(x, 99);
const asFloat = (v) => {
  if (v == null) return 0;
  const s = String(v).trim().replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const asBool = (v) => {
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "t" || s === "yes" || s === "y";
};

/** ---------- Tunable thresholds / weights ---------- */
const FLOAT_BUCKETS = [
  [5_000_000, 35],
  [10_000_000, 30],
  [20_000_000, 25],
  [50_000_000, 15],
  [Infinity, 5],
];

const REGSHO_BONUS = 4;

/** Guardrails (minimum baseline rules) */
function applyMinimumsAdditive(score, floatShares, ctb, siPct) {
  if (floatShares < 10_000_000 && ctb > 300) score = Math.max(score, 91);
  if (floatShares < 5_000_000 && ctb > 100) score = Math.max(score, 88);
  if (floatShares < 30_000_000 && ctb > 50 && siPct >= 20) score = Math.max(score, 85);
  return score;
}
function applyMinimumsMultiplicative(score, floatShares, ctb, siPct) {
  if (floatShares < 10_000_000 && ctb > 300) score = Math.max(score, 91);
  if (floatShares < 5_000_000 && ctb > 100) score = Math.max(score, 88);
  if (floatShares < 30_000_000 && ctb > 50 && siPct >= 20) score = Math.max(score, 85);
  return score;
}

/** ---------- Multipliers for multiplicative model ---------- */
function floatMultiplier(floatShares) {
  if (floatShares < 5_000_000) return 3.0;
  if (floatShares < 10_000_000) return 2.5;
  if (floatShares < 20_000_000) return 2.0;
  if (floatShares < 50_000_000) return 1.5;
  return 1.0;
}
function ctbMultiplier(ctb) {
  if (ctb >= 500) return 3.0;
  if (ctb >= 300) return 2.7;
  if (ctb >= 100) return 2.0;
  if (ctb >= 50)  return 1.6;
  if (ctb >= 25)  return 1.3;
  return 1.0;
}
function siMultiplier(siPct) {
  if (siPct >= 50) return 2.5;
  if (siPct >= 20) return 2.0;
  if (siPct >= 10) return 1.5;
  if (siPct >= 5)  return 1.2;
  return 1.0;
}
function ftdMultiplier(ftdVal) {
  if (ftdVal >= 10_000_000) return 1.3;
  if (ftdVal >= 5_000_000)  return 1.2;
  if (ftdVal >= 1_000_000)  return 1.1;
  return 1.0;
}
const regshoMultiplier = (regsho) => (regsho ? 1.05 : 1.0);

/** ---------- Additive model ---------- */
export function scoreAdditive({ float_shares, si_pct, ctb, ftd_val, regsho }) {
  let score = 0;

  // Float
  const floatPts = FLOAT_BUCKETS.find(([thr]) => float_shares < thr)?.[1] ?? 5;
  score += floatPts;

  // CTB
  if (ctb >= 500) score += 24;
  else if (ctb >= 300) score += 23;
  else if (ctb >= 100) score += 19;
  else if (ctb >= 50)  score += 14;
  else if (ctb >= 25)  score += 10;
  else if (ctb >= 10)  score += 5;

  // SI%
  if (si_pct >= 50) score += 25;
  else if (si_pct >= 20) score += 19;
  else if (si_pct >= 10) score += 14;
  else if (si_pct >= 5)  score += 10;

  // Bonuses
  if (float_shares < 10_000_000 && si_pct >= 20) score += 8;
  if (float_shares < 5_000_000 && ctb > 100)     score += 12;
  if (float_shares < 10_000_000 && ctb > 300)    score += 8;

  // FTDs ($)
  if (ftd_val >= 10_000_000)      score += 9;
  else if (ftd_val >= 5_000_000)   score += 7;
  else if (ftd_val >= 1_000_000)   score += 5;

  // RegSHO bonus only
  if (regsho) score += REGSHO_BONUS;

  // Guardrails & cap
  score = applyMinimumsAdditive(score, float_shares, ctb, si_pct);
  return clamp99(score);
}

/** ---------- Multiplicative model ---------- */
export function scoreMultiplicative({ float_shares, si_pct, ctb, ftd_val, regsho }) {
  const raw =
    floatMultiplier(float_shares) *
    ctbMultiplier(ctb) *
    siMultiplier(si_pct) *
    ftdMultiplier(ftd_val) *
    regshoMultiplier(regsho);

  // Normalize to ~0–100; 45 is empirical “max” anchor
  let score = (raw / 45) * 100;

  // Guardrails & cap
  score = applyMinimumsMultiplicative(score, float_shares, ctb, si_pct);
  return clamp99(score);
}

/** ---------- Core consensus ---------- */
const BONUS_RULES = [
  ({ float_shares, si_pct }) => (float_shares < 15_000_000 && si_pct >= 20) ? 4 : 0,
  ({ float_shares, ctb })      => (float_shares < 10_000_000 && ctb > 200) ? 6 : 0,
  ({ float_shares, ctb })      => (float_shares < 5_000_000 && ctb > 100) ? 8 : 0,
  ({ si_pct })                 => (si_pct >= 30) ? 5 : 0,
  ({ ctb })                    => (ctb >= 100) ? 4 : 0,
  ({ ctb, si_pct })            => (ctb >= 50 && si_pct >= 20) ? 3 : 0,
];

const FTD_RULES = [
  ({ ftd_val }) => (ftd_val >= 25_000_000 ? 12 : 0),
  ({ ftd_val }) => (ftd_val >= 10_000_000 ? 9 : 0),
  ({ ftd_val }) => (ftd_val >= 5_000_000 ? 6 : 0),
  ({ ftd_val }) => (ftd_val >= 1_000_000 ? 4 : 0),
];

function scoreFloatComponent(float_shares) {
  if (float_shares <= 1_000_000) return 35;
  if (float_shares <= 5_000_000) return 30;
  if (float_shares <= 10_000_000) return 25;
  if (float_shares <= 20_000_000) return 20;
  if (float_shares <= 50_000_000) return 12;
  return 5;
}

function scoreCtbComponent(ctb) {
  if (ctb >= 500) return 24;
  if (ctb >= 300) return 23;
  if (ctb >= 150) return 20;
  if (ctb >= 100) return 17;
  if (ctb >= 50)  return 11;
  if (ctb >= 25)  return 7;
  return 2;
}

function scoreSiComponent(si_pct) {
  if (si_pct >= 50) return 24;
  if (si_pct >= 30) return 21;
  if (si_pct >= 20) return 17;
  if (si_pct >= 10) return 12;
  if (si_pct >= 5)  return 7;
  return 2;
}

function scoreBonuses(payload) {
  return BONUS_RULES.reduce((total, rule) => total + rule(payload), 0);
}

function scoreFtd(payload) {
  return FTD_RULES.reduce((total, rule) => Math.max(total, rule(payload)), 0);
}

function derivePayload({ float_shares, os_shares, si_pct, ctb, ftd_val, regsho }) {
  const payload = {
    float_shares: asFloat(float_shares),
    os_shares: asFloat(os_shares),
    si_pct: asFloat(si_pct),
    ctb: asFloat(ctb),
    ftd_val: asFloat(ftd_val),
    regsho: asBool(regsho),
  };

  // Fallback: if SI% comes in as fraction (0-1), make it percentage
  if (payload.si_pct > 0 && payload.si_pct <= 1) {
    payload.si_pct *= 100;
  }

  return payload;
}

export function scoreBreakdown(input) {
  const payload = derivePayload(input);
  const floatPts = scoreFloatComponent(payload.float_shares);
  const ctbPts = scoreCtbComponent(payload.ctb);
  const siPts = scoreSiComponent(payload.si_pct);
  const bonuses = scoreBonuses(payload);
  const ftdPts = scoreFtd(payload);
  const regPts = payload.regsho ? REGSHO_BONUS : 0;

  let additiveTotal = floatPts + ctbPts + siPts + bonuses + ftdPts + regPts;

  additiveTotal = applyMinimumsAdditive(additiveTotal, payload.float_shares, payload.ctb, payload.si_pct);
  additiveTotal = clamp99(additiveTotal);

  const multiplicativeTotal = scoreMultiplicative(payload);
  const consensus = Math.round(((additiveTotal + multiplicativeTotal) / 2) * 10) / 10;

  return {
    Float: floatPts,
    CTB: ctbPts,
    "SI%": siPts,
    Bonuses: bonuses,
    FTD: ftdPts,
    RegSHO: regPts,
    "Additive Total": Number(additiveTotal.toFixed(1)),
    "Multiplicative Total": Number(multiplicativeTotal.toFixed(1)),
    Consensus: consensus,
  };
}

export function scoreConsensus(input) {
  const payload = derivePayload(input);
  const additive = scoreAdditive(payload);
  const multiplicative = scoreMultiplicative(payload);
  return Math.round(((additive + multiplicative) / 2) * 10) / 10;
}

/** ---------- Batch helpers ---------- */
export function scoreMany(rows) {
  return rows.map((r) =>
    Object.assign(
      { ticker: r.ticker ?? "" },
      scoreBreakdown({
        float_shares: asFloat(r.float_shares),
        os_shares: asFloat(r.os_shares),
        si_pct: asFloat(r.si_pct),
        ctb: asFloat(r.ctb),
        ftd_val: asFloat(r.ftd_val),
        regsho: asBool(r.regsho),
      })
    )
  );
}

/** ---------- CSV parsing (robust) ---------- */
const HEADER_ALIASES = {
  ticker: new Set(["ticker", "symbol"]),
  float_shares: new Set(["float_shares", "free float", "float", "free_float"]),
  os_shares: new Set(["os_shares", "shares outstanding", "outstanding", "os", "shares_outstanding"]),
  si_pct: new Set(["si_pct", "short float %", "short %", "short_percent", "short_float_pct"]),
  ctb: new Set(["ctb", "cost to borrow", "borrow cost", "ctb%", "cost_to_borrow"]),
  ftd_val: new Set(["ftd_val", "ftd $", "ftd value", "ftd", "ftd_usd"]),
  regsho: new Set(["regsho", "reg sho", "threshold", "on_regsho"]),
};

function normalizeHeaders(headers) {
  const lower = headers.map((h) => h.trim()).map((h) => [h.toLowerCase(), h]);
  const map = {};
  for (const [canon, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const [low, raw] of lower) {
      if (aliases.has(low)) { map[canon] = raw; break; }
    }
  }
  return map;
}

function sniffDelimiter(firstLine) {
  if ((firstLine.match(/,/g) || []).length >= 1) return ",";
  if ((firstLine.match(/;/g) || []).length >= 1) return ";";
  if ((firstLine.match(/\t/g) || []).length >= 1) return "\t";
  return ","; // default
}

/**
 * Parse CSV text and return breakdown rows.
 * @param {string} csvText
 * @param {{debug?: boolean}=} opts
 * @returns {Array<object>}
 */
export function scoreFromCSV(csvText, opts = {}) {
  // Strip BOM if present
  if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);
  const lines = csvText.split(/\r\n|\r|\n/);
  if (!lines.length) return [];
  const delim = sniffDelimiter(lines[0]);

  // Simple CSV splitter (no embedded quotes support). For robust CSVs use PapaParse.
  const split = (line) => line.split(delim).map((s) => s.trim());

  const header = split(lines[0]);
  const map = normalizeHeaders(header);
  const idx = (canon) => header.indexOf(map[canon] ?? "__missing__");

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row.trim()) continue;
    const cols = split(row);
    try {
      const payload = {
        ticker: cols[idx("ticker")] ?? "",
        float_shares: asFloat(cols[idx("float_shares")]),
        os_shares: asFloat(cols[idx("os_shares")]),
        si_pct: asFloat(cols[idx("si_pct")]),
        ctb: asFloat(cols[idx("ctb")]),
        ftd_val: asFloat(cols[idx("ftd_val")]),
        regsho: asBool(cols[idx("regsho")]),
      };
      out.push(Object.assign({ ticker: payload.ticker }, scoreBreakdown(payload)));
    } catch (e) {
      if (opts.debug) console.warn(`[row ${i}] parse error:`, e, row);
    }
  }
  return out;
}
