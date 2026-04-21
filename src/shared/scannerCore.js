// Shared scanner engine used by the server-side API.
// ─────────────────────────────────────────────
// STRATEGY ENGINE — pure functions, no UI deps
// ─────────────────────────────────────────────

const TF_WEIGHT = { "1w": 5, "1d": 4, "1h": 3, "15m": 2, "5m": 1.5, "3m": 1, "1m": 0.5 };

function safeJson(val) {
  if (!val || val === "null") return null;
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch { return null; }
}

function getATR(row) {
  const ea = safeJson(row.extras_advanced);
  return ea?.atr || 1.0;
}

function getTrend(row) {
  const t = safeJson(row.trend);
  return t?.state || "range";
}

function getLastCandle(row) {
  return safeJson(row.last_candle);
}

function getRSI(row) {
  const e = safeJson(row.extras);
  return e?.momentum?.rsi_14 || 50;
}

function getVwap(row) {
  const e = safeJson(row.extras);
  return e?.vwap?.vwap_rth || null;
}

function getLiqSummary(row) {
  const e = safeJson(row.extras);
  return e?.liq_summary || {};
}

function getVolContext(row) {
  const e = safeJson(row.extras);
  return e?.vol_context?.bar_range_vs_atr || 1.0;
}

// ── STRATEGY 1: FVG Retest ──────────────────────────────
function stratFVGRetest(row) {
  const fvgs = safeJson(row.fvgs_lite);
  const candle = getLastCandle(row);
  const trend = getTrend(row);
  const atr = getATR(row);
  if (!fvgs || !candle) return null;

  const signals = [];

  const checkFVGs = (list, dir) => {
    if (!list) return;
    for (const fvg of list) {
      if (fvg.trade_score < 78) continue;
      if (fvg.touch_count > 2) continue;
      if ((fvg.filled_pct || 0) > 55) continue;
      if (fvg.score_status === "not_enough_data") continue;

      const trendAligned =
        (dir === "bull" && ["bull", "range"].includes(trend)) ||
        (dir === "bear" && ["bear", "range"].includes(trend));
      if (!trendAligned) continue;

      const price = candle.close;
      const inFvg = price >= fvg.low && price <= fvg.high;
      const approachingFvg =
        dir === "bull"
          ? price >= fvg.low - atr * 0.3 && price <= fvg.high
          : price <= fvg.high + atr * 0.3 && price >= fvg.low;

      if (!inFvg && !approachingFvg) continue;

      const wickDominant =
        dir === "bull"
          ? candle.lower_wick > candle.body * 0.8
          : candle.upper_wick > candle.body * 0.8;

      const rejecting =
        dir === "bull"
          ? candle.direction === "bull" || wickDominant
          : candle.direction === "bear" || wickDominant;

      if (!rejecting) continue;

      const entry = price;
      const stop =
        dir === "bull"
          ? fvg.low - atr * 0.4
          : fvg.high + atr * 0.4;
      const risk = Math.abs(entry - stop);
      const target1 = dir === "bull" ? entry + risk * 2 : entry - risk * 2;
      const target2 = dir === "bull" ? entry + risk * 3.5 : entry - risk * 3.5;

      signals.push({
        strategy: "FVG_RETEST",
        direction: dir.toUpperCase(),
        entry: +entry.toFixed(4),
        stop: +stop.toFixed(4),
        target1: +target1.toFixed(4),
        target2: +target2.toFixed(4),
        risk: +risk.toFixed(4),
        rr1: 2.0,
        rr2: 3.5,
        score: fvg.trade_score,
        fvgScore: fvg.fvg_score,
        style: fvg.style?.label || "unknown",
        confidence: fvg.style?.confidence || 0,
        touches: fvg.touch_count,
        filledPct: fvg.filled_pct || 0,
        zone: `${fvg.low.toFixed(2)}–${fvg.high.toFixed(2)}`,
        reason: `${dir === "bull" ? "Bullish" : "Bearish"} FVG retest (score ${fvg.trade_score}, ${fvg.touch_count} touches, ${(fvg.filled_pct || 0).toFixed(0)}% filled)`,
      });
    }
  };

  checkFVGs(fvgs.bearish_below, "bull");
  checkFVGs(fvgs.bullish_above, "bear");

  if (!signals.length) return null;
  signals.sort((a, b) => b.score - a.score);
  return signals[0];
}

// ── STRATEGY 2: Liquidity Sweep Reversal ──────────────
function stratLiqSweep(row) {
  const liq = safeJson(row.liquidity_lite);
  const candle = getLastCandle(row);
  const atr = getATR(row);
  const liqSummary = getLiqSummary(row);
  if (!liq || !candle) return null;

  // Sweep ABOVE → short reversal
  const sweptAbove = liq.nearest_swept_above;
  if (sweptAbove && sweptAbove.state === "broken") {
    const sp = sweptAbove.price;
    const sweptAndRejected =
      candle.high > sp &&
      candle.close < sp &&
      candle.upper_wick > candle.body * 1.2;
    const priorHolds = (sweptAbove.break_events || []).filter(e => e.next_hold).length;

    if (sweptAndRejected && priorHolds >= 1) {
      const entry = candle.close;
      const stop = candle.high + atr * 0.3;
      const risk = Math.abs(stop - entry);
      const stackBonus = Math.min((liqSummary.eq_high_stack_count || 1) / 5, 1.0);

      return {
        strategy: "LIQ_SWEEP",
        direction: "SHORT",
        entry: +entry.toFixed(4),
        stop: +stop.toFixed(4),
        target1: +(entry - risk * 2).toFixed(4),
        target2: +(liqSummary.nearest_clean_low_price || entry - risk * 3).toFixed(4),
        risk: +risk.toFixed(4),
        rr1: 2.0,
        rr2: 3.0,
        score: 70 + stackBonus * 25,
        zone: `Swept ${sp.toFixed(2)}`,
        stackCount: liqSummary.eq_high_stack_count || 0,
        reason: `Liquidity sweep above ${sp.toFixed(2)}, ${priorHolds} prior holds, wick rejection`,
      };
    }
  }

  // Sweep BELOW → long reversal
  const sweptBelow = liq.nearest_swept_below;
  if (sweptBelow && sweptBelow.state === "broken") {
    const sp = sweptBelow.price;
    const sweptAndRejected =
      candle.low < sp &&
      candle.close > sp &&
      candle.lower_wick > candle.body * 1.2;
    const priorHolds = (sweptBelow.break_events || []).filter(e => e.next_hold).length;

    if (sweptAndRejected && priorHolds >= 1) {
      const entry = candle.close;
      const stop = candle.low - atr * 0.3;
      const risk = Math.abs(entry - stop);
      const stackBonus = Math.min((liqSummary.eq_low_stack_count || 1) / 5, 1.0);

      return {
        strategy: "LIQ_SWEEP",
        direction: "LONG",
        entry: +entry.toFixed(4),
        stop: +stop.toFixed(4),
        target1: +(entry + risk * 2).toFixed(4),
        target2: +(liqSummary.nearest_clean_high_price || entry + risk * 3).toFixed(4),
        risk: +risk.toFixed(4),
        rr1: 2.0,
        rr2: 3.0,
        score: 70 + stackBonus * 25,
        zone: `Swept ${sp.toFixed(2)}`,
        stackCount: liqSummary.eq_low_stack_count || 0,
        reason: `Liquidity sweep below ${sp.toFixed(2)}, ${priorHolds} prior holds, wick rejection`,
      };
    }
  }

  return null;
}

// ── STRATEGY 3: BOS Pullback ───────────────────────────
function stratBOSPullback(row) {
  const state = row.structure_state;
  const structural = safeJson(row.structural_lite);
  const fvgs = safeJson(row.fvgs_lite);
  const candle = getLastCandle(row);
  const atr = getATR(row);
  const trend = getTrend(row);
  if (!structural || !candle || !state) return null;

  const isBull = state?.includes("bullish");
  const isBear = state?.includes("bearish");
  const isBOS = state?.includes("bos") || state?.includes("building");
  if (!isBOS) return null;

  const price = candle.close;

  if (isBull) {
    const hl = structural.latest_hl;
    if (!hl || hl.swing?.state === "broken") return null;
    const hlPrice = hl.price;
    const nearHL = price <= hlPrice + atr * 1.2 && price >= hlPrice - atr * 0.3;

    const fvgNearHL = (fvgs?.bearish_below || []).find(
      f => f.direction === "bull" &&
           f.low >= hlPrice - atr * 0.5 &&
           f.trade_score >= 72 &&
           f.touch_count <= 2 &&
           (f.filled_pct || 0) < 60
    );

    if (nearHL && fvgNearHL) {
      const entry = Math.max(price, fvgNearHL.low);
      const stop = hlPrice - atr * 0.75;
      const risk = Math.abs(entry - stop);
      const hh = structural.latest_hh;
      const t1 = hh ? hh.price : entry + risk * 2;

      return {
        strategy: "BOS_PULLBACK",
        direction: "LONG",
        entry: +entry.toFixed(4),
        stop: +stop.toFixed(4),
        target1: +t1.toFixed(4),
        target2: +(entry + risk * 3).toFixed(4),
        risk: +risk.toFixed(4),
        rr1: +((t1 - entry) / risk).toFixed(1),
        rr2: 3.0,
        score: 82,
        zone: `HL ${hlPrice.toFixed(2)} + FVG ${fvgNearHL.low.toFixed(2)}–${fvgNearHL.high.toFixed(2)}`,
        reason: `BOS pullback long: HL at ${hlPrice.toFixed(2)}, FVG confluence, state=${state}`,
      };
    }
  }

  if (isBear) {
    const lh = structural.latest_lh;
    if (!lh || lh.swing?.state === "broken") return null;
    const lhPrice = lh.price;
    const nearLH = price >= lhPrice - atr * 1.2 && price <= lhPrice + atr * 0.3;

    const fvgNearLH = (fvgs?.bullish_above || []).find(
      f => f.direction === "bear" &&
           f.high <= lhPrice + atr * 0.5 &&
           f.trade_score >= 72 &&
           f.touch_count <= 2 &&
           (f.filled_pct || 0) < 60
    );

    if (nearLH && fvgNearLH) {
      const entry = Math.min(price, fvgNearLH.high);
      const stop = lhPrice + atr * 0.75;
      const risk = Math.abs(stop - entry);
      const ll = structural.latest_ll;
      const t1 = ll ? ll.price : entry - risk * 2;

      return {
        strategy: "BOS_PULLBACK",
        direction: "SHORT",
        entry: +entry.toFixed(4),
        stop: +stop.toFixed(4),
        target1: +t1.toFixed(4),
        target2: +(entry - risk * 3).toFixed(4),
        risk: +risk.toFixed(4),
        rr1: +((entry - t1) / risk).toFixed(1),
        rr2: 3.0,
        score: 82,
        zone: `LH ${lhPrice.toFixed(2)} + FVG ${fvgNearLH.low.toFixed(2)}–${fvgNearLH.high.toFixed(2)}`,
        reason: `BOS pullback short: LH at ${lhPrice.toFixed(2)}, FVG confluence, state=${state}`,
      };
    }
  }

  return null;
}

// ── STRATEGY 4: VWAP + Structure Fade ─────────────────
function stratVwapStructureFade(row) {
  const candle = getLastCandle(row);
  const extras = safeJson(row.extras);
  const atr = getATR(row);
  const rsi = getRSI(row);
  const vwap = getVwap(row);
  const structural = safeJson(row.structural_lite);
  if (!candle || !vwap || !structural) return null;

  const price = candle.close;
  const distPct = Math.abs(price - vwap) / vwap;

  // Only when price is extended from VWAP
  if (distPct < 0.004) return null;

  const aboveVwap = price > vwap;
  const isBull = aboveVwap;

  // RSI confirmation
  const rsiExtended = aboveVwap ? rsi > 72 : rsi < 28;
  if (!rsiExtended) return null;

  // Must have a swing level to target
  const nearHigh = structural.nearest_high_above;
  const nearLow = structural.nearest_low_below;

  if (aboveVwap && nearHigh) {
    // Fading stretch above VWAP — short back toward VWAP
    const nhPrice = nearHigh.price;
    const priceNearResistance = price >= nhPrice - atr * 0.5;
    if (!priceNearResistance) return null;

    const entry = price;
    const stop = nhPrice + atr * 0.4;
    const risk = Math.abs(stop - entry);

    return {
      strategy: "VWAP_FADE",
      direction: "SHORT",
      entry: +entry.toFixed(4),
      stop: +stop.toFixed(4),
      target1: +vwap.toFixed(4),
      target2: +(vwap - atr * 0.5).toFixed(4),
      risk: +risk.toFixed(4),
      rr1: +((entry - vwap) / risk).toFixed(1),
      rr2: +((entry - (vwap - atr * 0.5)) / risk).toFixed(1),
      score: 68 + Math.min(distPct * 5000, 15),
      zone: `VWAP ${vwap.toFixed(2)}, RSI ${rsi.toFixed(0)}`,
      reason: `VWAP fade short: ${(distPct * 100).toFixed(2)}% above VWAP, RSI ${rsi.toFixed(0)}, near swing high ${nhPrice.toFixed(2)}`,
    };
  }

  if (!aboveVwap && nearLow) {
    const nlPrice = nearLow.price;
    const priceNearSupport = price <= nlPrice + atr * 0.5;
    if (!priceNearSupport) return null;

    const entry = price;
    const stop = nlPrice - atr * 0.4;
    const risk = Math.abs(entry - stop);

    return {
      strategy: "VWAP_FADE",
      direction: "LONG",
      entry: +entry.toFixed(4),
      stop: +stop.toFixed(4),
      target1: +vwap.toFixed(4),
      target2: +(vwap + atr * 0.5).toFixed(4),
      risk: +risk.toFixed(4),
      rr1: +((vwap - entry) / risk).toFixed(1),
      rr2: +((vwap + atr * 0.5 - entry) / risk).toFixed(1),
      score: 68 + Math.min(distPct * 5000, 15),
      zone: `VWAP ${vwap.toFixed(2)}, RSI ${rsi.toFixed(0)}`,
      reason: `VWAP fade long: ${(distPct * 100).toFixed(2)}% below VWAP, RSI ${rsi.toFixed(0)}, near swing low ${nlPrice.toFixed(2)}`,
    };
  }

  return null;
}

// ── STRATEGY 5: Volume Profile LVN Breakout ───────────
function stratLVNBreakout(row) {
  const vp = safeJson(row.volume_profile_lite);
  const candle = getLastCandle(row);
  const atr = getATR(row);
  const trend = getTrend(row);
  const volCtx = getVolContext(row);
  if (!vp || !candle) return null;

  const price = candle.close;
  const profiles = vp.profiles || {};

  // Weight by profile priority
  const priorityOrder = ["daily_extremes", "structural", "rolling_300", "session", "rolling_60"];

  for (const profileName of priorityOrder) {
    const profile = profiles[profileName];
    if (!profile) continue;

    // LVN above — potential breakout up
    const lvnAbove = profile.nearest_lvn_above;
    if (lvnAbove && trend !== "bear") {
      const dist = (lvnAbove.poc - price) / price;
      if (dist > 0 && dist < 0.003) {
        // Price approaching LVN — expect fast move through
        const highVol = volCtx > 0.8; // bar range > 80% of ATR
        if (!highVol) continue;

        const entry = lvnAbove.poc + atr * 0.05; // entry just above LVN
        const stop = price - atr * 0.5;
        const risk = Math.abs(entry - stop);
        const nextHvn = profile.nearest_hvn_above;
        const t1 = nextHvn ? nextHvn.poc : entry + risk * 2;

        return {
          strategy: "LVN_BREAKOUT",
          direction: "LONG",
          entry: +entry.toFixed(4),
          stop: +stop.toFixed(4),
          target1: +t1.toFixed(4),
          target2: +(entry + risk * 3).toFixed(4),
          risk: +risk.toFixed(4),
          rr1: +((t1 - entry) / risk).toFixed(1),
          rr2: 3.0,
          score: 65 + Math.min(lvnAbove.final_score * 0.5, 20),
          zone: `LVN ${lvnAbove.poc.toFixed(2)} (${profileName})`,
          reason: `LVN breakout long above ${lvnAbove.poc.toFixed(2)}, score ${lvnAbove.final_score?.toFixed(1)}, profile=${profileName}`,
        };
      }
    }

    // LVN below — potential breakout down
    const lvnBelow = profile.nearest_lvn_below;
    if (lvnBelow && trend !== "bull") {
      const dist = (price - lvnBelow.poc) / price;
      if (dist > 0 && dist < 0.003) {
        const highVol = volCtx > 0.8;
        if (!highVol) continue;

        const entry = lvnBelow.poc - atr * 0.05;
        const stop = price + atr * 0.5;
        const risk = Math.abs(stop - entry);
        const nextHvn = profile.nearest_hvn_below;
        const t1 = nextHvn ? nextHvn.poc : entry - risk * 2;

        return {
          strategy: "LVN_BREAKOUT",
          direction: "SHORT",
          entry: +entry.toFixed(4),
          stop: +stop.toFixed(4),
          target1: +t1.toFixed(4),
          target2: +(entry - risk * 3).toFixed(4),
          risk: +risk.toFixed(4),
          rr1: +((entry - t1) / risk).toFixed(1),
          rr2: 3.0,
          score: 65 + Math.min(lvnBelow.final_score * 0.5, 20),
          zone: `LVN ${lvnBelow.poc.toFixed(2)} (${profileName})`,
          reason: `LVN breakout short below ${lvnBelow.poc.toFixed(2)}, score ${lvnBelow.final_score?.toFixed(1)}, profile=${profileName}`,
        };
      }
    }
  }

  return null;
}

// ── STRATEGY 6: Equal Highs/Lows Squeeze ──────────────
function stratEQSqueeze(row) {
  const liqSummary = getLiqSummary(row);
  const candle = getLastCandle(row);
  const atr = getATR(row);
  const structural = safeJson(row.structural_lite);
  if (!candle || !structural) return null;

  const eqLow = liqSummary.eq_low_stack_count || 0;
  const eqHigh = liqSummary.eq_high_stack_count || 0;
  const price = candle.close;

  // Strong equal lows stack — sweep down expected, then reverse up
  if (eqLow >= 4 && liqSummary.nearest_clean_low_price) {
    const eqLowPrice = liqSummary.nearest_clean_low_price;
    const nearEqLow = price <= eqLowPrice + atr * 0.5;

    if (nearEqLow && candle.lower_wick > candle.body) {
      const entry = price;
      const stop = eqLowPrice - atr * 0.5;
      const risk = Math.abs(entry - stop);
      const t1 = liqSummary.nearest_clean_high_price || entry + risk * 2;

      return {
        strategy: "EQ_SQUEEZE",
        direction: "LONG",
        entry: +entry.toFixed(4),
        stop: +stop.toFixed(4),
        target1: +t1.toFixed(4),
        target2: +(entry + risk * 3).toFixed(4),
        risk: +risk.toFixed(4),
        rr1: +((t1 - entry) / risk).toFixed(1),
        rr2: 3.0,
        score: 60 + eqLow * 4,
        zone: `EQ Lows x${eqLow} @ ${eqLowPrice.toFixed(2)}`,
        reason: `Equal lows stack x${eqLow} at ${eqLowPrice.toFixed(2)}, wick rejection, long squeeze`,
      };
    }
  }

  // Strong equal highs stack — sweep up expected, then reverse down
  if (eqHigh >= 4 && liqSummary.nearest_clean_high_price) {
    const eqHighPrice = liqSummary.nearest_clean_high_price;
    const nearEqHigh = price >= eqHighPrice - atr * 0.5;

    if (nearEqHigh && candle.upper_wick > candle.body) {
      const entry = price;
      const stop = eqHighPrice + atr * 0.5;
      const risk = Math.abs(stop - entry);
      const t1 = liqSummary.nearest_clean_low_price || entry - risk * 2;

      return {
        strategy: "EQ_SQUEEZE",
        direction: "SHORT",
        entry: +entry.toFixed(4),
        stop: +stop.toFixed(4),
        target1: +t1.toFixed(4),
        target2: +(entry - risk * 3).toFixed(4),
        risk: +risk.toFixed(4),
        rr1: +((entry - t1) / risk).toFixed(1),
        rr2: 3.0,
        score: 60 + eqHigh * 4,
        zone: `EQ Highs x${eqHigh} @ ${eqHighPrice.toFixed(2)}`,
        reason: `Equal highs stack x${eqHigh} at ${eqHighPrice.toFixed(2)}, wick rejection, short squeeze`,
      };
    }
  }

  return null;
}

// ── MASTER SCANNER ────────────────────────────────────
function runScanner(rows) {
  const allSignals = [];

  for (const row of rows) {
    if (!row.last_candle || row.last_candle === "null") continue;

    const tf = row.timeframe;
    const weight = TF_WEIGHT[tf] || 1;
    const atr = getATR(row);
    const candle = getLastCandle(row);
    if (!candle) continue;

    const strategies = [
      stratFVGRetest,
      stratLiqSweep,
      stratBOSPullback,
      stratVwapStructureFade,
      stratLVNBreakout,
      stratEQSqueeze,
    ];

    for (const strat of strategies) {
      const signal = strat(row);
      if (!signal) continue;

      // Trade type classification
      const tradeType =
        ["1d", "1w"].includes(tf) ? "SWING"
        : ["1h", "15m"].includes(tf) ? "DAY"
        : "SCALP";

      allSignals.push({
        ...signal,
        symbol: row.symbol,
        timeframe: tf,
        structureState: row.structure_state,
        tradeType,
        tfWeight: weight,
        atr,
        price: candle.close,
        rsi: getRSI(row),
        timestamp: row.last_updated,
        compositeScore: signal.score * weight,
      });
    }
  }

  // Sort by composite score
  allSignals.sort((a, b) => b.compositeScore - a.compositeScore);

  return allSignals;
}

// ── HTF BIAS ──────────────────────────────────────────
function getHTFBias(rows) {
  const htfRows = rows.filter(r => ["1d", "1w", "1h"].includes(r.timeframe));
  let bullScore = 0, bearScore = 0;
  const notes = [];

  for (const row of htfRows) {
    const w = TF_WEIGHT[row.timeframe] || 1;
    const state = row.structure_state || "";
    const trend = getTrend(row);

    if (state.includes("bullish") || trend === "bull") {
      bullScore += w;
      notes.push(`${row.timeframe}: ${state || trend} ▲`);
    } else if (state.includes("bearish") || trend === "bear") {
      bearScore += w;
      notes.push(`${row.timeframe}: ${state || trend} ▼`);
    } else {
      notes.push(`${row.timeframe}: ${state || trend} ◆`);
    }
  }

  return {
    bias: bullScore > bearScore ? "BULL" : bearScore > bullScore ? "BEAR" : "NEUTRAL",
    bullScore,
    bearScore,
    confidence: Math.round((Math.max(bullScore, bearScore) / (bullScore + bearScore || 1)) * 100),
    notes,
  };
}

// ─────────────────────────────────────────────
// SAMPLE DATA LOADER (server fallback)
// ─────────────────────────────────────────────

function buildSampleRows() {
  // Mimics what your Supabase snapshot returns after each candle close
  return [
    {
      symbol: "SPY", timeframe: "1h", last_updated: new Date().toISOString(),
      structure_state: "bullish_continuation_bos",
      trend: JSON.stringify({ state: "bull", ema50: 693.46, ema200: 683.72 }),
      extras_advanced: JSON.stringify({ atr: 2.498 }),
      last_candle: JSON.stringify({
        close: 709.26, high: 710.39, low: 708.99, open: 709.81,
        direction: "bear", upper_wick: 0.58, lower_wick: 0.27, body: 0.55,
        shape: "normal", vol_rel: 0.79, volume: 5722710
      }),
      fvgs_lite: JSON.stringify({
        bearish_below: [
          { low: 701.195, high: 709.23, direction: "bull", filled_pct: 2.99,
            trade_score: 79, fvg_score: 70.02, touch_count: 3, score_status: "final",
            style: { label: "reversal", confidence: 80, reversal_score: 94.3, continuation_score: 54.3 } },
          { low: 697.62, high: 698.48, direction: "bull", filled_pct: 0,
            trade_score: 95, fvg_score: 51.5, touch_count: 0, score_status: "final",
            style: { label: "continuation", confidence: 80, reversal_score: 46.1, continuation_score: 86.1 } }
        ],
        bullish_above: []
      }),
      liquidity_lite: JSON.stringify({
        nearest_swept_above: null,
        nearest_swept_below: {
          ts: "2026-04-16T15:30:00+00:00", type: "swing_high", price: 702.78,
          state: "broken", break_events: [{ ts: "2026-04-17T13:30:00+00:00", next_hold: true, candle_type: "bull" }],
          wick_count: 0, break_count: 1, break_close_count: 6
        }
      }),
      structural_lite: JSON.stringify({
        latest_hh: { price: 702.78, label: "HH", swing: { state: "broken" } },
        latest_hl: { price: 695.7, label: "HL", swing: { state: "active" } },
        latest_lh: { price: 679.99, label: "LH", swing: { state: "broken" } },
        latest_ll: { price: 676.58, label: "LL", swing: { state: "active" } },
        nearest_high_above: null,
        nearest_low_below: { price: 695.7, label: "HL", swing: { state: "active" } }
      }),
      volume_profile_lite: JSON.stringify({
        profiles: {
          session: {
            poc: 709.82, poc2: null,
            nearest_hvn_above: { low: 709.49, poc: 709.82, high: 710.32, rank: 1, final_score: 43.6,
              tags: ["regime_expansion_hvn_penalty", "trend_aligned_1h"] },
            nearest_lvn_above: { low: 712.14, poc: 712.31, high: 712.31, rank: 1, final_score: 4.77,
              tags: ["regime_expansion_lvn", "trend_aligned_1h", "weekly_balance_lvn_penalty"] },
            nearest_lvn_below: { low: 705.84, poc: 705.84, high: 705.84, rank: 2, final_score: 4.53,
              tags: ["regime_expansion_lvn", "trend_aligned_1h", "fvg_overlap_1h"] },
            nearest_hvn_containing_price: { low: 709.49, poc: 709.82, high: 710.32, rank: 1, final_score: 43.6 }
          },
          daily_extremes: {
            poc: 710.95,
            nearest_hvn_above: { low: 710.51, poc: 710.95, high: 711.40, rank: 1, final_score: 62.1,
              tags: ["regime_expansion_hvn_penalty", "trend_aligned_1h"] },
            nearest_lvn_above: { low: 712.06, poc: 712.28, high: 712.28, rank: 1, final_score: 4.3,
              tags: ["regime_expansion_lvn", "trend_aligned_1h"] },
            nearest_lvn_below: { low: 705.87, poc: 705.87, high: 706.09, rank: 2, final_score: 2.21,
              tags: ["regime_expansion_lvn"] },
            nearest_hvn_containing_price: null
          }
        }
      }),
      extras: JSON.stringify({
        vwap: { vwap_rth: 709.89, extended_flag: "normal", dist_from_vwap_pct: -0.00088 },
        momentum: { rsi_14: 77.23, mom_raw: 0.035, macd_fast: 705.74, macd_slow: 699.79, last_close: 709.26 },
        liq_summary: { eq_low_stack_count: 1, eq_high_stack_count: 0,
          nearest_clean_low_price: 695.7, nearest_clean_high_price: null,
          nearest_clean_low_dist_pct: -0.019, nearest_clean_high_dist_pct: null },
        vol_context: { bar_range_vs_atr: 0.56 }
      })
    },
    {
      symbol: "SPY", timeframe: "15m", last_updated: new Date().toISOString(),
      structure_state: "range_or_transition",
      trend: JSON.stringify({ state: "bull", ema50: 706.24, ema200: 698.15 }),
      extras_advanced: JSON.stringify({ atr: 0.987 }),
      last_candle: JSON.stringify({
        close: 710.04, high: 710.4, low: 709.69, open: 710.29,
        direction: "bear", upper_wick: 0.11, lower_wick: 0.35, body: 0.25,
        shape: "normal", vol_rel: 2.78, volume: 5428379, is_high_vol: true
      }),
      fvgs_lite: JSON.stringify({
        bearish_below: [
          { low: 709.585, high: 709.69, direction: "bull", filled_pct: 0,
            trade_score: 95, fvg_score: null, touch_count: 0, score_status: "not_enough_data",
            style: null },
          { low: 708.36, high: 708.51, direction: "bull", filled_pct: 0,
            trade_score: 95, fvg_score: 65.5, touch_count: 0, score_status: "final",
            style: { label: "continuation", confidence: 80, reversal_score: 50.1, continuation_score: 90.1 } },
          { low: 707.61, high: 708.15, direction: "bull", filled_pct: 0,
            trade_score: 95, fvg_score: 64.8, touch_count: 0, score_status: "final",
            style: { label: "continuation", confidence: 80, reversal_score: 49.9, continuation_score: 89.9 } }
        ],
        bullish_above: [
          { low: 710.37, high: 710.73, direction: "bear", filled_pct: 91.7,
            trade_score: 17, fvg_score: 57.3, touch_count: 4, score_status: "final",
            style: { label: "continuation", confidence: 80 } },
          { low: 711.385, high: 711.9, direction: "bear", filled_pct: 0,
            trade_score: 95, fvg_score: 28.5, touch_count: 0, score_status: "final",
            style: { label: "reversal", confidence: 80, reversal_score: 65.3, continuation_score: 25.3 } }
        ]
      }),
      liquidity_lite: JSON.stringify({
        nearest_swept_above: { ts: "2026-04-17T18:30:00+00:00", type: "swing_high",
          price: 710.39, state: "active", wick_count: 1, break_count: 0,
          break_events: [], break_close_count: 0 },
        nearest_swept_below: { ts: "2026-04-17T15:15:00+00:00", type: "swing_low",
          price: 709.86, state: "broken",
          break_events: [
            { ts: "2026-04-17T18:00:00+00:00", next_hold: true, candle_type: "bear" },
            { ts: "2026-04-17T18:45:00+00:00", next_hold: true, candle_type: "bear" }
          ],
          wick_count: 5, break_count: 2, break_close_count: 5 }
      }),
      structural_lite: JSON.stringify({
        latest_hh: { price: 712.39, label: "HH", swing: { state: "active" } },
        latest_hl: { price: 709.14, label: "HL", swing: { state: "broken" } },
        latest_lh: { price: 710.39, label: "LH", swing: { state: "active" } },
        latest_ll: { price: 709.03, label: "LL", swing: { state: "active" } },
        nearest_high_above: { price: 710.39, label: "LH", swing: { state: "active" } },
        nearest_low_below: { price: 709.86, label: "HL", swing: { state: "broken" } }
      }),
      volume_profile_lite: JSON.stringify({
        profiles: {
          session: {
            poc: 710.15,
            nearest_hvn_containing_price: { low: 709.82, poc: 710.15, high: 710.65, rank: 1, final_score: 84.3,
              tags: ["regime_expansion_hvn_penalty", "trend_aligned_15m", "fvg_overlap_15m"] },
            nearest_lvn_below: { low: 707.67, poc: 707.83, high: 708.0, rank: 2, final_score: 2.63,
              tags: ["regime_expansion_lvn", "trend_aligned_15m", "fvg_overlap_15m", "weekly_balance_lvn_penalty"] },
            nearest_lvn_above: null, nearest_hvn_above: null
          },
          daily_extremes: {
            poc: 710.73,
            nearest_hvn_above: { low: 710.51, poc: 710.73, high: 710.95, rank: 1, final_score: 108.4,
              tags: ["regime_expansion_hvn_penalty", "trend_aligned_15m"] },
            nearest_hvn_below: { low: 708.52, poc: 709.19, high: 709.41, rank: 2, final_score: 19.2,
              tags: ["regime_expansion_hvn_penalty", "trend_aligned_15m"] },
            nearest_lvn_below: { low: 706.75, poc: 707.86, high: 707.86, rank: 2, final_score: 1.35,
              tags: ["regime_expansion_lvn", "weekly_balance_lvn_penalty"] },
            nearest_lvn_above: null, nearest_hvn_containing_price: null
          }
        }
      }),
      extras: JSON.stringify({
        vwap: { vwap_rth: 709.91, extended_flag: "normal", dist_from_vwap_pct: 0.00018 },
        momentum: { rsi_14: 59.29, mom_raw: -0.08, last_close: 710.04 },
        liq_summary: { eq_low_stack_count: 1, eq_high_stack_count: 1,
          nearest_clean_low_price: 699.47, nearest_clean_high_price: 710.7,
          nearest_clean_low_dist_pct: -0.0149, nearest_clean_high_dist_pct: 0.00093 },
        vol_context: { bar_range_vs_atr: 0.72 }
      })
    },
    {
      symbol: "SPY", timeframe: "5m", last_updated: new Date().toISOString(),
      structure_state: "range_or_transition",
      trend: JSON.stringify({ state: "bull", ema50: 709.69, ema200: 704.71 }),
      extras_advanced: JSON.stringify({ atr: 0.512 }),
      last_candle: JSON.stringify({
        close: 710.04, high: 710.4, low: 709.84, open: 710.18,
        direction: "bear", upper_wick: 0.22, lower_wick: 0.20, body: 0.14,
        shape: "small_body", vol_rel: 5.39, volume: 3105648, is_high_vol: true
      }),
      fvgs_lite: JSON.stringify({
        bearish_below: [
          { low: 709.55, high: 709.56, direction: "bull", filled_pct: 0,
            trade_score: 95, fvg_score: 64.0, touch_count: 0, score_status: "final",
            style: { label: "neutral", confidence: 0, reversal_score: 62.6, continuation_score: 62.6 } },
          { low: 708.36, high: 708.79, direction: "bull", filled_pct: 65.1,
            trade_score: 42, fvg_score: 58.4, touch_count: 2, score_status: "final",
            style: { label: "continuation", confidence: 80 } }
        ],
        bullish_above: [
          { low: 710.16, high: 710.87, direction: "bear", filled_pct: 76.1,
            trade_score: 22, fvg_score: 72.7, touch_count: 15, score_status: "final",
            style: { label: "continuation", confidence: 80 } },
          { low: 711.47, high: 711.89, direction: "bear", filled_pct: 0,
            trade_score: 95, fvg_score: 62.2, touch_count: 0, score_status: "final",
            style: { label: "continuation", confidence: 40, reversal_score: 59.9, continuation_score: 79.9 } }
        ]
      }),
      liquidity_lite: JSON.stringify({
        nearest_swept_above: { price: 710.195, state: "broken",
          break_events: [
            { ts: "2026-04-17T17:20:00+00:00", next_hold: true, candle_type: "bear" },
            { ts: "2026-04-17T19:45:00+00:00", next_hold: true, candle_type: "bear" }
          ],
          wick_count: 5, break_count: 5, break_close_count: 28 },
        nearest_swept_below: { price: 709.99, state: "broken",
          break_events: [
            { ts: "2026-04-17T19:35:00+00:00", next_hold: true, candle_type: "bull" },
            { ts: "2026-04-17T19:50:00+00:00", next_hold: true, candle_type: "bull" }
          ],
          wick_count: 1, break_count: 2, break_close_count: 4 }
      }),
      structural_lite: JSON.stringify({
        latest_hh: { price: 710.36, label: "HH", swing: { state: "active" } },
        latest_hl: { price: 709.14, label: "HL", swing: { state: "broken" } },
        latest_lh: { price: 709.99, label: "LH", swing: { state: "broken" } },
        latest_ll: { price: 708.99, label: "LL", swing: { state: "active" } },
        nearest_high_above: { price: 710.36, label: "HH", swing: { state: "active" } },
        nearest_low_below: { price: 709.86, label: "LL", swing: { state: "broken" } }
      }),
      volume_profile_lite: JSON.stringify({
        profiles: {
          session: {
            poc: 709.99,
            nearest_hvn_containing_price: { low: 709.82, poc: 709.99, high: 710.32, rank: 1, final_score: 79.9 },
            nearest_lvn_below: { low: 707.67, poc: 707.83, high: 708.0, rank: 2, final_score: 3.49 },
            nearest_lvn_above: null, nearest_hvn_above: null
          },
          daily_extremes: {
            poc: 710.95,
            nearest_hvn_above: { low: 710.73, poc: 710.95, high: 711.17, rank: 1, final_score: 158.3 },
            nearest_hvn_below: { low: 708.74, poc: 709.19, high: 709.19, rank: 2, final_score: 41.1 },
            nearest_lvn_below: { low: 707.64, poc: 707.86, high: 708.08, rank: 2, final_score: 1.86 },
            nearest_lvn_above: null, nearest_hvn_containing_price: null
          }
        }
      }),
      extras: JSON.stringify({
        vwap: { vwap_rth: 709.93, extended_flag: "normal", dist_from_vwap_pct: 0.000149 },
        momentum: { rsi_14: 51.78, mom_raw: 0.26, last_close: 710.04 },
        liq_summary: { eq_low_stack_count: 5, eq_high_stack_count: 4,
          nearest_clean_low_price: 708.99, nearest_clean_high_price: 710.7,
          nearest_clean_low_dist_pct: -0.00148, nearest_clean_high_dist_pct: 0.00093 },
        vol_context: { bar_range_vs_atr: 1.09 }
      })
    },
    {
      symbol: "SPY", timeframe: "3m", last_updated: new Date().toISOString(),
      structure_state: "range_or_transition",
      trend: JSON.stringify({ state: "bull", ema50: 709.92, ema200: 707.47 }),
      extras_advanced: JSON.stringify({ atr: 0.405 }),
      last_candle: JSON.stringify({
        close: 710.04, high: 710.35, low: 709.84, open: 710.04,
        direction: "neutral", upper_wick: 0.31, lower_wick: 0.20, body: 0,
        shape: "doji", vol_rel: 5.65, volume: 2278142, is_high_vol: true
      }),
      fvgs_lite: JSON.stringify({
        bearish_below: [
          { low: 709.45, high: 709.67, direction: "bull", filled_pct: 50,
            trade_score: 57, fvg_score: 60.2, touch_count: 1, score_status: "final",
            style: { label: "reversal", confidence: 40, reversal_score: 80.8, continuation_score: 60.8 } },
          { low: 708.36, high: 708.47, direction: "bull", filled_pct: 0,
            trade_score: 95, fvg_score: 52.7, touch_count: 0, score_status: "final",
            style: { label: "continuation", confidence: 80, reversal_score: 46.5, continuation_score: 86.5 } }
        ],
        bullish_above: [
          { low: 711.47, high: 711.97, direction: "bear", filled_pct: 0,
            trade_score: 95, fvg_score: 71.1, touch_count: 0, score_status: "final",
            style: { label: "continuation", confidence: 40, reversal_score: 36.8, continuation_score: 56.8 } }
        ]
      }),
      liquidity_lite: JSON.stringify({
        nearest_swept_above: { price: 710.11, state: "broken",
          break_events: [
            { ts: "2026-04-17T17:24:00+00:00", next_hold: true, candle_type: "bear" },
            { ts: "2026-04-17T19:45:00+00:00", next_hold: true, candle_type: "bear" }
          ], wick_count: 7, break_count: 7, break_close_count: 41 },
        nearest_swept_below: { price: 709.86, state: "broken",
          break_events: [
            { ts: "2026-04-17T17:24:00+00:00", next_hold: false, candle_type: "bear" },
            { ts: "2026-04-17T18:06:00+00:00", next_hold: true, candle_type: "bear" }
          ], wick_count: 13, break_count: 5, break_close_count: 25 }
      }),
      structural_lite: JSON.stringify({
        latest_hh: { price: 710.36, label: "HH", swing: { state: "active" } },
        latest_hl: { price: 709.69, label: "HL", swing: { state: "active" } },
        latest_lh: { price: 709.585, label: "LH", swing: { state: "broken" } },
        latest_ll: { price: 708.99, label: "LL", swing: { state: "active" } },
        nearest_high_above: { price: 710.19, label: "LH", swing: { state: "broken" } },
        nearest_low_below: { price: 709.86, label: "LL", swing: { state: "broken" } }
      }),
      volume_profile_lite: JSON.stringify({
        profiles: {
          session: {
            poc: 711.15,
            nearest_hvn_containing_price: { low: 709.82, poc: 709.99, high: 710.48, rank: 1, final_score: 79.9 },
            nearest_lvn_below: { low: 707.67, poc: 707.83, high: 708.0, rank: 2, final_score: 3.13 },
            nearest_lvn_above: null, nearest_hvn_above: null
          }
        }
      }),
      extras: JSON.stringify({
        vwap: { vwap_rth: 709.96, extended_flag: "normal", dist_from_vwap_pct: 0.000112 },
        momentum: { rsi_14: 54.72, mom_raw: -0.26, last_close: 710.04 },
        liq_summary: { eq_low_stack_count: 3, eq_high_stack_count: 5,
          nearest_clean_low_price: 709.69, nearest_clean_high_price: 710.7,
          nearest_clean_low_dist_pct: -0.000493, nearest_clean_high_dist_pct: 0.000930 },
        vol_context: { bar_range_vs_atr: 1.26 }
      })
    },
    {
      symbol: "SPY", timeframe: "1d", last_updated: new Date().toISOString(),
      structure_state: "bullish_structure_building",
      trend: JSON.stringify({ state: "range", ema50: 673.25, ema200: 676.05 }),
      extras_advanced: JSON.stringify({ atr: 8.868 }),
      last_candle: JSON.stringify({
        close: 706.22, high: 706.72, low: 705.97, open: 706.14,
        direction: "bull", upper_wick: 0.5, lower_wick: 0.17, body: 0.08,
        shape: "long_upper_wick", vol_rel: 0.056, is_low_vol: true, volume: 3670521
      }),
      fvgs_lite: JSON.stringify({
        bearish_below: [
          { low: 696.94, high: 705.97, direction: "bull", filled_pct: 0,
            trade_score: 95, fvg_score: null, touch_count: 0, score_status: "not_enough_data",
            style: null },
          { low: 677.93, high: 694.2, direction: "bull", filled_pct: 0,
            trade_score: 95, fvg_score: 49.9, touch_count: 0, score_status: "final",
            style: { label: "continuation", confidence: 80, reversal_score: 45.7, continuation_score: 85.7 } }
        ],
        bullish_above: []
      }),
      liquidity_lite: JSON.stringify({
        nearest_swept_above: null,
        nearest_swept_below: { price: 697.14, state: "broken",
          break_events: [{ ts: "2026-04-16T04:00:00+00:00", next_hold: true, candle_type: "bear" }],
          wick_count: 0, break_count: 1, break_close_count: 2 }
      }),
      structural_lite: JSON.stringify({
        latest_hh: { price: 681.93, label: "HH", swing: { state: "broken" } },
        latest_hl: { price: 674.43, label: "HL", swing: { state: "active" } },
        latest_lh: { price: 658.52, label: "LH", swing: { state: "broken" } },
        latest_ll: { price: 629.28, label: "LL", swing: { state: "active" } },
        nearest_high_above: null,
        nearest_low_below: { price: 681.55, label: "HL", swing: { state: "broken" } }
      }),
      volume_profile_lite: JSON.stringify({
        profiles: {
          rolling_300: {
            poc: 684.13,
            nearest_hvn_below: { low: 680.26, poc: 684.13, high: 686.71, rank: 1, final_score: 51.97 },
            nearest_lvn_below: { low: 641.54, poc: 642.83, high: 644.12, rank: 2, final_score: 2.28 },
            nearest_hvn_above: null, nearest_lvn_above: null, nearest_hvn_containing_price: null
          }
        }
      }),
      extras: JSON.stringify({
        vwap: { vwap_rth: 706.3, extended_flag: "normal", dist_from_vwap_pct: -0.000118 },
        momentum: { rsi_14: 70.2, mom_raw: 25.74, last_close: 706.22 },
        liq_summary: { eq_low_stack_count: 1, eq_high_stack_count: 0,
          nearest_clean_low_price: 674.43, nearest_clean_high_price: null,
          nearest_clean_low_dist_pct: -0.045, nearest_clean_high_dist_pct: null },
        vol_context: { bar_range_vs_atr: 0.085 }
      })
    }
  ];
}


export { TF_WEIGHT, safeJson, runScanner, getHTFBias, buildSampleRows };
