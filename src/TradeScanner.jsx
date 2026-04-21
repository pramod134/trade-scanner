import { useState, useEffect, useCallback, useRef } from "react";
import { TF_WEIGHT } from "./shared/scannerCore";

const STRAT_META = {
  FVG_RETEST: { label: "FVG Retest", color: "#00d4ff", icon: "◈" },
  LIQ_SWEEP: { label: "Liq Sweep", color: "#ff6b35", icon: "◉" },
  BOS_PULLBACK: { label: "BOS Pullback", color: "#a78bfa", icon: "◆" },
  VWAP_FADE: { label: "VWAP Fade", color: "#fbbf24", icon: "◎" },
  LVN_BREAKOUT: { label: "LVN Breakout", color: "#34d399", icon: "▲" },
  EQ_SQUEEZE: { label: "EQ Squeeze", color: "#f472b6", icon: "⊕" },
};

function ScoreBar({ score, max = 100 }) {
  const pct = Math.min((score / max) * 100, 100);
  const color = score >= 85 ? "#22c55e" : score >= 70 ? "#f97316" : "#64748b";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        flex: 1, height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden"
      }}>
        <div style={{
          width: `${pct}%`, height: "100%", background: color,
          borderRadius: 2, transition: "width 0.6s ease"
        }} />
      </div>
      <span style={{ fontSize: 11, color, fontWeight: 700, minWidth: 28, textAlign: "right" }}>
        {score.toFixed(0)}
      </span>
    </div>
  );
}

function SignalCard({ signal, index }) {
  const [expanded, setExpanded] = useState(false);
  const meta = STRAT_META[signal.strategy] || { label: signal.strategy, color: "#94a3b8", icon: "○" };
  const isLong = signal.direction === "LONG";

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        border: `1px solid ${expanded ? meta.color : "#334155"}`,
        borderLeft: `3px solid ${isLong ? "#22c55e" : "#ef4444"}`,
        borderRadius: 8,
        padding: "14px 16px",
        cursor: "pointer",
        transition: "all 0.2s ease",
        marginBottom: 8,
        animation: `slideIn 0.3s ease ${index * 0.05}s both`,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1,
            color: meta.color, fontFamily: "monospace" }}>
            {meta.icon} {meta.label}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
            background: isLong ? "#14532d" : "#450a0a",
            color: isLong ? "#4ade80" : "#f87171",
            letterSpacing: 1
          }}>
            {signal.direction}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
            background: "#1e293b", border: `1px solid ${TF_COLOR[signal.timeframe] || "#475569"}`,
            color: TF_COLOR[signal.timeframe] || "#94a3b8"
          }}>
            {signal.timeframe}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
            background: `${TRADE_TYPE_COLOR[signal.tradeType]}20`,
            color: TRADE_TYPE_COLOR[signal.tradeType]
          }}>
            {signal.tradeType}
          </span>
        </div>
        <span style={{ fontSize: 10, color: "#475569" }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Score */}
      <div style={{ marginTop: 10 }}>
        <ScoreBar score={signal.compositeScore} max={120} />
      </div>

      {/* Key levels */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 10
      }}>
        {[
          { label: "ENTRY", value: signal.entry, color: "#e2e8f0" },
          { label: "STOP", value: signal.stop, color: "#f87171" },
          { label: "T1", value: signal.target1, color: "#4ade80" },
          { label: "T2", value: signal.target2, color: "#86efac" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            background: "#0f172a", borderRadius: 6, padding: "6px 8px", textAlign: "center"
          }}>
            <div style={{ fontSize: 9, color: "#64748b", fontWeight: 700, letterSpacing: 1 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color, fontFamily: "monospace", marginTop: 2 }}>
              {value?.toFixed(2)}
            </div>
          </div>
        ))}
      </div>

      {/* R:R badges */}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <span style={{ fontSize: 10, color: "#64748b" }}>Risk ${signal.risk?.toFixed(2)}</span>
        <span style={{ fontSize: 10, color: "#94a3b8" }}>•</span>
        <span style={{ fontSize: 10, color: "#4ade80" }}>T1: {signal.rr1}R</span>
        <span style={{ fontSize: 10, color: "#86efac" }}>T2: {signal.rr2}R</span>
        <span style={{ fontSize: 10, color: "#64748b", marginLeft: "auto" }}>RSI {signal.rsi?.toFixed(0)}</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          marginTop: 12, paddingTop: 12,
          borderTop: "1px solid #1e293b"
        }}>
          <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>
            {signal.reason}
          </div>
          {signal.zone && (
            <div style={{ marginTop: 6, fontSize: 10, color: "#64748b" }}>
              Zone: <span style={{ color: meta.color }}>{signal.zone}</span>
            </div>
          )}
          {signal.structureState && (
            <div style={{ marginTop: 4, fontSize: 10, color: "#64748b" }}>
              Structure: <span style={{ color: "#94a3b8" }}>{signal.structureState}</span>
            </div>
          )}
          {signal.stackCount !== undefined && (
            <div style={{ marginTop: 4, fontSize: 10, color: "#64748b" }}>
              Stack count: <span style={{ color: "#fbbf24" }}>{signal.stackCount}</span>
            </div>
          )}
          {signal.style && (
            <div style={{ marginTop: 4, fontSize: 10, color: "#64748b" }}>
              FVG Style: <span style={{ color: meta.color }}>{signal.style}</span>
              {signal.confidence > 0 && <span style={{ color: "#64748b" }}> ({signal.confidence?.toFixed(0)}%)</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BiasPanel({ bias }) {
  const color = bias.bias === "BULL" ? "#22c55e" : bias.bias === "BEAR" ? "#ef4444" : "#fbbf24";
  return (
    <div style={{
      background: "linear-gradient(135deg, #0f172a, #1e293b)",
      border: `1px solid ${color}40`,
      borderRadius: 10, padding: "14px 16px", marginBottom: 16
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 2, marginBottom: 4 }}>
            HTF BIAS
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color, letterSpacing: 2 }}>
            {bias.bias}
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 400, marginLeft: 8 }}>
              {bias.confidence}% confidence
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#22c55e" }}>{bias.bullScore.toFixed(1)}</div>
            <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1 }}>BULL</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#ef4444" }}>{bias.bearScore.toFixed(1)}</div>
            <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1 }}>BEAR</div>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {bias.notes.map((n, i) => (
          <span key={i} style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 4,
            background: "#0f172a", border: "1px solid #334155",
            color: n.includes("▲") ? "#22c55e" : n.includes("▼") ? "#ef4444" : "#64748b"
          }}>{n}</span>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────


export default function TradeScanner({ defaultSymbol = "SPY" }) {
  const [signals, setSignals] = useState([]);
  const [bias, setBias] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [dirFilter, setDirFilter] = useState("ALL");
  const [tfFilter, setTfFilter] = useState("ALL");
  const [lastScan, setLastScan] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const intervalRef = useRef(null);
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [inputSymbol, setInputSymbol] = useState(defaultSymbol);
  const [error, setError] = useState("");
  const [source, setSource] = useState("server");

  const fetchDashboard = useCallback(async () => {
    const res = await fetch(`/api/dashboard?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        message = body?.error || message;
      } catch {}
      throw new Error(message);
    }
    return res.json();
  }, [symbol]);

  const runScan = useCallback(async () => {
    setIsScanning(true);
    setError("");
    try {
      const payload = await fetchDashboard();
      setSignals(Array.isArray(payload.signals) ? payload.signals : []);
      setBias(payload.bias ?? null);
      setSource(payload.source ?? "server");
      setLastScan(payload.scannedAt ? new Date(payload.scannedAt) : null);
      setScanCount((c) => c + 1);
    } catch (err) {
      console.error("Dashboard fetch failed:", err);
      setSignals([]);
      setBias(null);
      setLastScan(null);
      setError(err?.message || "Unable to load scanner data.");
    } finally {
      setIsScanning(false);
    }
  }, [fetchDashboard]);

  useEffect(() => {
    runScan();
  }, [runScan]);

  useEffect(() => {
    intervalRef.current = setInterval(runScan, 60000);
    return () => clearInterval(intervalRef.current);
  }, [runScan]);

  const filteredSignals = signals.filter((s) => {
    if (filter !== "ALL" && s.tradeType !== filter) return false;
    if (dirFilter !== "ALL" && s.direction !== dirFilter) return false;
    if (tfFilter !== "ALL" && s.timeframe !== tfFilter) return false;
    return true;
  });

  const uniqueTFs = [...new Set(signals.map((s) => s.timeframe))].sort(
    (a, b) => (TF_WEIGHT[b] || 0) - (TF_WEIGHT[a] || 0)
  );

  return (
    <div style={{
      minHeight: "100vh",
      background: "#060d1a",
      fontFamily: "'Courier New', Courier, monospace",
      color: "#e2e8f0",
      padding: "0",
    }}>
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0f172a; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
      `}</style>

      <div style={{
        background: "linear-gradient(90deg, #060d1a 0%, #0f172a 50%, #060d1a 100%)",
        borderBottom: "1px solid #1e293b",
        padding: "14px 20px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 3, color: "#00d4ff" }}>
            ◈ STRUCTURE SCANNER
          </div>
          <div style={{ fontSize: 10, color: "#334155", letterSpacing: 2, marginTop: 2 }}>
            SERVER-SIDE SIGNAL ENGINE
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#475569" }}>
              {lastScan instanceof Date ? `Last: ${lastScan.toLocaleTimeString()}` : "—"}
            </div>
            <div style={{ fontSize: 10, color: "#334155" }}>Refresh #{scanCount}</div>
          </div>
          <button
            onClick={runScan}
            disabled={isScanning}
            style={{
              background: isScanning ? "#1e293b" : "#00d4ff15",
              border: `1px solid ${isScanning ? "#334155" : "#00d4ff"}`,
              color: isScanning ? "#475569" : "#00d4ff",
              borderRadius: 6, padding: "6px 14px", cursor: "pointer",
              fontSize: 11, fontWeight: 700, letterSpacing: 1,
              display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit"
            }}
          >
            {isScanning ? (
              <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>↻</span>
            ) : "↻"} REFRESH
          </button>
        </div>
      </div>

      <div style={{ padding: "16px 20px", maxWidth: 900, margin: "0 auto" }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
          flexWrap: "wrap"
        }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={inputSymbol}
              onChange={(e) => setInputSymbol(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSymbol(inputSymbol.trim().toUpperCase() || defaultSymbol);
                }
              }}
              placeholder="SPY"
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                color: "#e2e8f0",
                borderRadius: 6,
                padding: "8px 10px",
                fontFamily: "inherit",
                minWidth: 120
              }}
            />
            <button
              onClick={() => setSymbol(inputSymbol.trim().toUpperCase() || defaultSymbol)}
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                color: "#e2e8f0",
                borderRadius: 6,
                padding: "8px 10px",
                fontFamily: "inherit",
                cursor: "pointer"
              }}
            >
              Load Symbol
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#64748b" }}>
            Source: <span style={{ color: "#00d4ff" }}>{source}</span> · Symbol: <span style={{ color: "#e2e8f0" }}>{symbol}</span>
          </div>
        </div>

        {error && (
          <div style={{
            background: "#2b0d12",
            border: "1px solid #7f1d1d",
            color: "#fca5a5",
            padding: "10px 12px",
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 12,
          }}>
            {error}
          </div>
        )}

        {bias && <BiasPanel bias={bias} />}

        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            { label: "Total", value: signals.length, color: "#00d4ff" },
            { label: "Long", value: signals.filter((s) => s.direction === "LONG").length, color: "#22c55e" },
            { label: "Short", value: signals.filter((s) => s.direction === "SHORT").length, color: "#ef4444" },
            { label: "Scalp", value: signals.filter((s) => s.tradeType === "SCALP").length, color: "#22c55e" },
            { label: "Day", value: signals.filter((s) => s.tradeType === "DAY").length, color: "#f97316" },
            { label: "Swing", value: signals.filter((s) => s.tradeType === "SWING").length, color: "#a78bfa" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background: "#0f172a", border: "1px solid #1e293b",
              borderRadius: 8, padding: "8px 14px", textAlign: "center"
            }}>
              <div style={{ fontSize: 18, fontWeight: 900, color }}>{value}</div>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1 }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {["ALL", "SCALP", "DAY", "SWING"].map((t) => (
            <button key={t} onClick={() => setFilter(t)} style={{
              background: filter === t ? "#00d4ff20" : "#0f172a",
              border: `1px solid ${filter === t ? "#00d4ff" : "#334155"}`,
              color: filter === t ? "#00d4ff" : "#64748b",
              borderRadius: 6, padding: "4px 10px", cursor: "pointer",
              fontSize: 10, fontWeight: 700, letterSpacing: 1, fontFamily: "inherit"
            }}>{t}</button>
          ))}
          <div style={{ width: 1, background: "#1e293b", margin: "0 2px" }} />
          {["ALL", "LONG", "SHORT"].map((d) => (
            <button key={d} onClick={() => setDirFilter(d)} style={{
              background: dirFilter === d
                ? d === "LONG" ? "#14532d" : d === "SHORT" ? "#450a0a" : "#1e293b"
                : "#0f172a",
              border: `1px solid ${dirFilter === d
                ? d === "LONG" ? "#22c55e" : d === "SHORT" ? "#ef4444" : "#475569"
                : "#334155"}`,
              color: dirFilter === d
                ? d === "LONG" ? "#4ade80" : d === "SHORT" ? "#f87171" : "#94a3b8"
                : "#64748b",
              borderRadius: 6, padding: "4px 10px", cursor: "pointer",
              fontSize: 10, fontWeight: 700, letterSpacing: 1, fontFamily: "inherit"
            }}>{d}</button>
          ))}
          <div style={{ width: 1, background: "#1e293b", margin: "0 2px" }} />
          {["ALL", ...uniqueTFs].map((tf) => (
            <button key={tf} onClick={() => setTfFilter(tf)} style={{
              background: tfFilter === tf ? "#1d4ed820" : "#0f172a",
              border: `1px solid ${tfFilter === tf ? "#3b82f6" : "#334155"}`,
              color: tfFilter === tf ? "#60a5fa" : "#64748b",
              borderRadius: 6, padding: "4px 10px", cursor: "pointer",
              fontSize: 10, fontWeight: 700, letterSpacing: 1, fontFamily: "inherit"
            }}>{tf}</button>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: "#64748b", letterSpacing: 1 }}>
            TOP SETUPS ({filteredSignals.length})
          </div>
        </div>

        {filteredSignals.length === 0 ? (
          <div style={{
            background: "#0f172a",
            border: "1px dashed #334155",
            borderRadius: 10,
            padding: "24px",
            color: "#64748b",
            textAlign: "center",
          }}>
            No signals found for the current filters.
          </div>
        ) : (
          filteredSignals.map((signal, index) => (
            <SignalCard key={`${signal.symbol}-${signal.timeframe}-${signal.strategy}-${signal.direction}-${index}`} signal={signal} index={index} />
          ))
        )}
      </div>
    </div>
  );
}
