import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  AreaChart, Area, LineChart, Line, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import Papa from "papaparse";
import { fetchQuote, fetchMonthlySeries, MARKET_SYMBOLS } from "./api.js";

const COLORS = {
  ink: "#16241C",
  forest: "#1F4D3A",
  forestDark: "#123527",
  gold: "#B8912F",
  goldLight: "#D9C07E",
  parchment: "#F6F2E9",
  paper: "#EDE6D6",
  rule: "#C9BFA6",
  red: "#8C3B2E",
  navy: "#3E3A6E",
  muted: "#6B6455",
};

const ASSETS = [
  { key: "SP500", name: "S&P 500", ret: 10, vol: 15, color: COLORS.forest },
  { key: "NASDAQ100", name: "NASDAQ 100", ret: 13, vol: 20, color: COLORS.gold },
  { key: "BTC", name: "Bitcoin", ret: 30, vol: 60, color: COLORS.red },
  { key: "GOLD", name: "ทองคำ", ret: 6, vol: 12, color: COLORS.navy },
];

function fmt(n, currency) {
  if (!isFinite(n)) return "-";
  const abs = Math.abs(n);
  const sym = currency === "USD" ? "$" : "฿";
  const sign = n < 0 ? "-" : "";
  return sign + sym + abs.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function pct(n, digits = 1) {
  if (!isFinite(n)) return "-";
  return n.toFixed(digits) + "%";
}

function projectGrowth(initial, monthly, years, annualRatePct) {
  const monthlyRate = annualRatePct / 100 / 12;
  const months = Math.round(years * 12);
  let balance = initial;
  let contributed = initial;
  const yearly = [{ year: 0, value: Math.round(initial), contributed: Math.round(initial), growth: 0 }];
  for (let m = 1; m <= months; m++) {
    balance = balance * (1 + monthlyRate) + monthly;
    contributed += monthly;
    if (m % 12 === 0) {
      yearly.push({
        year: m / 12,
        value: Math.round(balance),
        contributed: Math.round(contributed),
        growth: Math.round(balance - contributed),
      });
    }
  }
  return yearly;
}

function requiredMonthlyForGoal(initial, years, annualRatePct, goal) {
  const monthlyRate = annualRatePct / 100 / 12;
  const months = Math.round(years * 12);
  const growthFactor = Math.pow(1 + monthlyRate, months);
  const initialFV = initial * growthFactor;
  if (monthlyRate === 0) return (goal - initialFV) / months;
  const annuityFactor = (growthFactor - 1) / monthlyRate;
  return (goal - initialFV) / annuityFactor;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng) {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function simulateDrawdown(years, annualRetPct, annualVolPct, seed) {
  const rng = mulberry32(seed);
  const months = Math.round(years * 12);
  const meanM = annualRetPct / 100 / 12;
  const volM = (annualVolPct / 100) / Math.sqrt(12);
  let equity = 100;
  let peak = 100;
  const path = [{ month: 0, equity: 100, drawdown: 0 }];
  for (let m = 1; m <= months; m++) {
    const r = meanM + volM * gaussian(rng);
    equity = equity * (1 + r);
    peak = Math.max(peak, equity);
    const dd = ((equity - peak) / peak) * 100;
    path.push({ month: m, equity: Math.round(equity * 100) / 100, drawdown: Math.round(dd * 100) / 100 });
  }
  return path;
}

function normalizeAllocations(allocs) {
  const total = Object.values(allocs).reduce((a, b) => a + b, 0);
  if (total === 0) return allocs;
  const out = {};
  Object.keys(allocs).forEach((k) => (out[k] = (allocs[k] / total) * 100));
  return out;
}

const TABS = [
  { key: "overview", label: "ภาพรวม" },
  { key: "portfolio", label: "พอร์ตหลายสินทรัพย์" },
  { key: "drawdown", label: "Drawdown" },
  { key: "scenarios", label: "เปรียบเทียบผลตอบแทน" },
  { key: "market", label: "ราคาตลาดจริง" },
  { key: "import", label: "นำเข้าข้อมูล" },
];

export default function App() {
  const [tab, setTab] = useState("overview");
  const [currency, setCurrency] = useState("USD");
  const [initial, setInitial] = useState(5000);
  const [monthly, setMonthly] = useState(500);
  const [years, setYears] = useState(10);
  const [rate, setRate] = useState(10);
  const [goal, setGoal] = useState(200000);

  const [allocations, setAllocations] = useState({ SP500: 70, NASDAQ100: 15, BTC: 10, GOLD: 5 });

  const [csvRows, setCsvRows] = useState(null);
  const [csvError, setCsvError] = useState(null);
  const fileInputRef = useRef(null);

  // --- real market data state ---
  const [marketQuotes, setMarketQuotes] = useState({});
  const [marketSeries, setMarketSeries] = useState({});
  const [marketStatus, setMarketStatus] = useState("idle"); // idle | loading | done | error
  const [marketError, setMarketError] = useState(null);

  async function loadMarketData() {
    setMarketStatus("loading");
    setMarketError(null);
    try {
      const quotes = {};
      const series = {};
      for (const m of MARKET_SYMBOLS) {
        quotes[m.key] = await fetchQuote(m.symbol);
        series[m.key] = await fetchMonthlySeries(m.symbol, 12);
      }
      setMarketQuotes(quotes);
      setMarketSeries(series);
      setMarketStatus("done");
    } catch (err) {
      setMarketError(err.message);
      setMarketStatus("error");
    }
  }

  const data = useMemo(() => projectGrowth(initial, monthly, years, rate), [initial, monthly, years, rate]);
  const finalRow = data[data.length - 1];
  const totalContributed = finalRow.contributed;
  const totalGrowth = finalRow.growth;
  const projectedValue = finalRow.value;

  const reqMonthly = useMemo(
    () => requiredMonthlyForGoal(initial, years, rate, goal),
    [initial, years, rate, goal]
  );
  const progressPct = Math.min(100, Math.round((projectedValue / goal) * 100));

  const normAlloc = useMemo(() => normalizeAllocations(allocations), [allocations]);
  const blendedReturn = useMemo(
    () => ASSETS.reduce((sum, a) => sum + (normAlloc[a.key] / 100) * a.ret, 0),
    [normAlloc]
  );
  const blendedVol = useMemo(
    () => ASSETS.reduce((sum, a) => sum + (normAlloc[a.key] / 100) * a.vol, 0),
    [normAlloc]
  );
  const pieData = ASSETS.map((a) => ({ name: a.name, value: Math.round(normAlloc[a.key] * 10) / 10, color: a.color }));

  const drawdownPath = useMemo(
    () => simulateDrawdown(years, blendedReturn, blendedVol, Math.round(years * 100 + blendedReturn * 10 + blendedVol)),
    [years, blendedReturn, blendedVol]
  );
  const maxDrawdown = useMemo(() => Math.min(...drawdownPath.map((d) => d.drawdown)), [drawdownPath]);

  const scenarioRates = [8, 10, 12];
  const scenarioData = useMemo(() => {
    const s8 = projectGrowth(initial, monthly, years, 8);
    const s10 = projectGrowth(initial, monthly, years, 10);
    const s12 = projectGrowth(initial, monthly, years, 12);
    const sPortfolio = projectGrowth(initial, monthly, years, blendedReturn);
    return s10.map((row, i) => ({
      year: row.year,
      r8: s8[i].value,
      r10: s10[i].value,
      r12: s12[i].value,
      rPortfolio: sPortfolio[i].value,
    }));
  }, [initial, monthly, years, blendedReturn]);

  function handleCsvFile(file) {
    setCsvError(null);
    setCsvRows(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data.filter((r) => r.Date && r.Amount);
        if (rows.length === 0) {
          setCsvError("ไม่พบข้อมูลที่อ่านได้ ตรวจสอบว่ามีคอลัมน์ Date, Amount, Type, Ticker");
          return;
        }
        const parsed = rows.map((r) => ({
          date: new Date(r.Date),
          amount: parseFloat(String(r.Amount).replace(/[, ]/g, "")) || 0,
          type: (r.Type || "buy").toLowerCase(),
          ticker: r.Ticker || "-",
        })).filter((r) => !isNaN(r.date.getTime()));
        parsed.sort((a, b) => a.date - b.date);
        setCsvRows(parsed);
      },
      error: (err) => setCsvError("อ่านไฟล์ไม่สำเร็จ: " + err.message),
    });
  }

  const csvSummary = useMemo(() => {
    if (!csvRows || csvRows.length === 0) return null;
    const signed = csvRows.map((r) => (r.type.startsWith("sell") || r.type.startsWith("with") ? -r.amount : r.amount));
    const totalNet = signed.reduce((a, b) => a + b, 0);
    const first = csvRows[0];
    const last = csvRows[csvRows.length - 1];
    const monthsSpan = Math.max(1, Math.round((last.date - first.date) / (1000 * 60 * 60 * 24 * 30)));
    const derivedInitial = Math.round(first.amount);
    const derivedMonthly = monthsSpan > 1 ? Math.round((totalNet - derivedInitial) / (monthsSpan - 1)) : 0;
    return { totalNet: Math.round(totalNet), monthsSpan, derivedInitial, derivedMonthly, count: csvRows.length };
  }, [csvRows]);

  function applyCsvValues() {
    if (!csvSummary) return;
    setInitial(Math.max(0, csvSummary.derivedInitial));
    setMonthly(Math.max(0, csvSummary.derivedMonthly));
    setTab("overview");
  }

  function handlePrint() {
    window.print();
  }

  function downloadSampleCsv() {
    const sample = [
      "Date,Amount,Type,Ticker",
      "2024-01-05,5000,deposit,SPY",
      "2024-02-05,500,buy,SPY",
      "2024-03-05,500,buy,SPY",
      "2024-04-05,500,buy,SPY",
    ].join("\n");
    const blob = new Blob([sample], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sample-transactions.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{
      fontFamily: "'Inter', sans-serif",
      background: COLORS.parchment,
      color: COLORS.ink,
      minHeight: "100vh",
      padding: "0 0 40px 0",
    }}>
      <style>{`
        .spx-num { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
        .spx-display { font-family: 'Fraunces', serif; }
        .spx-ticker { display: flex; flex-wrap: wrap; gap: 6px 28px; }
        .spx-input { font-family: 'IBM Plex Mono', monospace; border: 1px solid ${COLORS.rule}; background: #fff;
          padding: 8px 10px; border-radius: 3px; width: 100%; box-sizing: border-box; font-size: 14px; color: ${COLORS.ink}; }
        .spx-input:focus { outline: 2px solid ${COLORS.gold}; outline-offset: 1px; }
        .spx-label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: ${COLORS.muted}; display: block; margin-bottom: 4px; }
        .spx-slider { width: 100%; accent-color: ${COLORS.forest}; }
        .spx-currency-btn { font-family: 'IBM Plex Mono', monospace; padding: 5px 12px; border: 1px solid ${COLORS.forest};
          background: transparent; color: ${COLORS.forest}; cursor: pointer; font-size: 13px; }
        .spx-currency-btn.active { background: ${COLORS.forest}; color: ${COLORS.parchment}; }
        .spx-card { background: #fff; border: 1px solid ${COLORS.rule}; border-radius: 4px; padding: 20px 24px; margin-bottom: 24px; }
        .spx-card-title { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: ${COLORS.gold};
          font-weight: 600; margin-bottom: 14px; border-bottom: 1px solid ${COLORS.rule}; padding-bottom: 8px; }
        .spx-tab { font-family: 'Inter', sans-serif; font-size: 13px; padding: 8px 14px; border: none; background: transparent;
          color: ${COLORS.muted}; cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; }
        .spx-tab.active { color: ${COLORS.forest}; border-bottom: 2px solid ${COLORS.gold}; font-weight: 600; }
        .spx-btn { font-family: 'Inter', sans-serif; font-size: 13px; padding: 8px 16px; border: 1px solid ${COLORS.forest};
          background: ${COLORS.forest}; color: ${COLORS.parchment}; cursor: pointer; border-radius: 3px; }
        .spx-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .spx-btn.secondary { background: transparent; color: ${COLORS.forest}; }
        .spx-btn.secondary:hover { background: ${COLORS.paper}; }

        .spx-hero { background: ${COLORS.forest}; color: ${COLORS.parchment}; border-radius: 8px;
          padding: 28px 28px 24px; margin-bottom: 24px; }
        .spx-hero-label { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;
          color: ${COLORS.goldLight}; margin-bottom: 8px; }
        .spx-hero-value { font-size: 42px; font-weight: 600; line-height: 1.1; letter-spacing: -0.01em; margin: 0; }
        .spx-hero-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 12px; margin-top: 22px; padding-top: 22px; border-top: 1px solid rgba(246,242,233,0.18); }
        .spx-hero-stat { background: rgba(246,242,233,0.08); border-radius: 6px; padding: 12px 16px; }
        .spx-hero-stat-label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
          color: ${COLORS.goldLight}; opacity: 0.9; margin-bottom: 4px; }
        .spx-hero-stat-value { font-size: 19px; font-weight: 600; }

        .spx-stat-card { background: ${COLORS.paper}; border-radius: 6px; padding: 12px 16px; }
        .spx-stat-label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: ${COLORS.muted}; margin-bottom: 4px; }
        .spx-stat-value { font-size: 19px; font-weight: 600; color: ${COLORS.ink}; }

        .spx-csv-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
        @media print {
          .spx-no-print { display: none !important; }
          .spx-card { break-inside: avoid; border: 1px solid #999; }
        }
      `}</style>

      <div className="spx-no-print" style={{ background: COLORS.forestDark, color: COLORS.goldLight, padding: "10px 24px", borderBottom: `2px solid ${COLORS.gold}` }}>
        <div className="spx-num spx-ticker" style={{ fontSize: 13, maxWidth: 780, margin: "0 auto" }}>
          <span>S&P500 ผลตอบแทนเฉลี่ย {rate.toFixed(1)}% ต่อปี</span>
          <span>เงินลงทุนเริ่มต้น {fmt(initial, currency)}</span>
          <span>DCA รายเดือน {fmt(monthly, currency)}</span>
          <span>มูลค่าโครงการปีที่ {years} : {fmt(projectedValue, currency)}</span>
          <span>พอร์ตผสมคาดการณ์ {pct(blendedReturn)} ต่อปี</span>
          <span>Max drawdown จำลอง {pct(maxDrawdown)}</span>
        </div>
      </div>

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "32px 24px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <div>
            <div className="spx-label">โครงการส่วนตัว</div>
            <h1 className="spx-display" style={{ fontSize: 30, fontWeight: 600, margin: "2px 0 4px", color: COLORS.forest }}>
              S&P500 Investment Tracker
            </h1>
            <div style={{ fontSize: 13, color: COLORS.muted }}>ติดตามเงินลงทุน ผลตอบแทน DCA และแผนสู่เป้าหมาย</div>
          </div>
          <div className="spx-no-print" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ display: "flex", border: `1px solid ${COLORS.forest}` }}>
              <button className={`spx-currency-btn ${currency === "USD" ? "active" : ""}`} onClick={() => setCurrency("USD")}>USD $</button>
              <button className={`spx-currency-btn ${currency === "THB" ? "active" : ""}`} onClick={() => setCurrency("THB")}>THB ฿</button>
            </div>
            <button className="spx-btn" onClick={handlePrint}>Download report</button>
          </div>
        </div>

        <div className="spx-no-print" style={{ display: "flex", gap: 4, borderBottom: `1px solid ${COLORS.rule}`, marginBottom: 24, overflowX: "auto" }}>
          {TABS.map((t) => (
            <button key={t.key} className={`spx-tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>

        {tab === "overview" && (
          <>
            <div className="spx-card">
              <div className="spx-card-title">รายการลงทุน</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px 20px" }}>
                <div>
                  <label className="spx-label">เงินลงทุนเริ่มต้น</label>
                  <input className="spx-input" type="number" min="0" step="100" value={initial}
                    onChange={(e) => setInitial(Math.max(0, Number(e.target.value)))} />
                </div>
                <div>
                  <label className="spx-label">DCA ต่อเดือน</label>
                  <input className="spx-input" type="number" min="0" step="50" value={monthly}
                    onChange={(e) => setMonthly(Math.max(0, Number(e.target.value)))} />
                </div>
                <div>
                  <label className="spx-label">ผลตอบแทนคาดหวัง/ปี (%)</label>
                  <input className="spx-input" type="number" min="0" max="30" step="0.5" value={rate}
                    onChange={(e) => setRate(Math.min(30, Math.max(0, Number(e.target.value))))} />
                </div>
              </div>
              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <label className="spx-label" style={{ marginBottom: 0 }}>ระยะเวลาลงทุน</label>
                  <span className="spx-num" style={{ fontSize: 13, color: COLORS.forest, fontWeight: 600 }}>{years} ปี</span>
                </div>
                <input className="spx-slider" type="range" min="1" max="30" step="1" value={years}
                  onChange={(e) => setYears(Number(e.target.value))} />
              </div>
            </div>

            <div className="spx-hero">
              <div className="spx-hero-label">มูลค่าพอร์ตโดยประมาณ ปีที่ {years}</div>
              <div className="spx-hero-value spx-num">{fmt(projectedValue, currency)}</div>
              <div className="spx-hero-stats">
                <div className="spx-hero-stat">
                  <div className="spx-hero-stat-label">เงินลงทุนสะสม</div>
                  <div className="spx-hero-stat-value spx-num">{fmt(totalContributed, currency)}</div>
                </div>
                <div className="spx-hero-stat">
                  <div className="spx-hero-stat-label">ผลตอบแทนสะสม</div>
                  <div className="spx-hero-stat-value spx-num">{fmt(totalGrowth, currency)}</div>
                </div>
              </div>
            </div>

            <div className="spx-card">
              <div className="spx-card-title">การเติบโตของพอร์ตรายปี</div>
              <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 12, color: COLORS.muted }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, background: COLORS.rule, display: "inline-block" }} />เงินลงทุนสะสม
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, background: COLORS.forest, display: "inline-block" }} />มูลค่าพอร์ตรวม
                </span>
              </div>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <AreaChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="spxTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS.forest} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={COLORS.forest} stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={COLORS.rule} strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="year" tickFormatter={(y) => `ปี ${y}`} tick={{ fontSize: 11, fill: COLORS.muted }} axisLine={{ stroke: COLORS.rule }} tickLine={false} />
                    <YAxis tickFormatter={(v) => fmt(v, currency)} tick={{ fontSize: 11, fill: COLORS.muted }} axisLine={false} tickLine={false} width={80} />
                    <Tooltip
                      formatter={(v, name) => [fmt(v, currency), name === "value" ? "มูลค่าพอร์ตรวม" : "เงินลงทุนสะสม"]}
                      labelFormatter={(y) => `ปีที่ ${y}`}
                      contentStyle={{ fontFamily: "Inter, sans-serif", fontSize: 13, border: `1px solid ${COLORS.rule}`, borderRadius: 4 }}
                    />
                    <Area type="monotone" dataKey="contributed" stroke={COLORS.rule} fill={COLORS.paper} strokeWidth={1.5} />
                    <Area type="monotone" dataKey="value" stroke={COLORS.forest} fill="url(#spxTotal)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="spx-card">
              <div className="spx-card-title">เป้าหมายในอีก {years} ปีข้างหน้า</div>
              <label className="spx-label">เป้าหมายมูลค่าพอร์ต</label>
              <input className="spx-input" type="number" min="0" step="1000" value={goal} style={{ marginBottom: 14 }}
                onChange={(e) => setGoal(Math.max(1, Number(e.target.value)))} />

              <div style={{ height: 10, background: COLORS.paper, borderRadius: 5, overflow: "hidden", marginBottom: 8 }}>
                <div style={{ height: "100%", width: `${progressPct}%`, background: progressPct >= 100 ? COLORS.forest : COLORS.gold, transition: "width 0.3s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: COLORS.muted, marginBottom: 16 }}>
                <span>คาดว่าจะได้ {fmt(projectedValue, currency)}</span>
                <span className="spx-num">{progressPct}% ของเป้าหมาย</span>
              </div>

              <div style={{ borderTop: `1px solid ${COLORS.rule}`, paddingTop: 14, fontSize: 14, lineHeight: 1.6 }}>
                {reqMonthly <= 0 ? (
                  <span>เงินลงทุนเริ่มต้นเพียงอย่างเดียวก็เติบโตถึงเป้าหมายนี้ได้ภายใน {years} ปี ด้วยผลตอบแทน {rate}% ต่อปี</span>
                ) : (
                  <span>
                    หากต้องการให้พอร์ตแตะ <b className="spx-num">{fmt(goal, currency)}</b> ภายใน {years} ปี
                    ต้องลงทุน DCA เดือนละประมาณ <span className="spx-num" style={{ color: COLORS.forest, fontWeight: 600 }}>{fmt(Math.ceil(reqMonthly), currency)}</span>
                  </span>
                )}
              </div>
            </div>

            <div className="spx-card" style={{ marginBottom: 0 }}>
              <div className="spx-card-title">สรุปรายปี</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${COLORS.rule}`, color: COLORS.muted, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.04em" }}>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>ปี</th>
                      <th style={{ textAlign: "right", padding: "6px 8px" }}>เงินลงทุนสะสม</th>
                      <th style={{ textAlign: "right", padding: "6px 8px" }}>ผลตอบแทนสะสม</th>
                      <th style={{ textAlign: "right", padding: "6px 8px" }}>มูลค่าพอร์ต</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.filter((d) => d.year > 0).map((d) => (
                      <tr key={d.year} style={{ borderBottom: `1px solid ${COLORS.paper}` }}>
                        <td style={{ padding: "6px 8px" }}>{d.year}</td>
                        <td className="spx-num" style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(d.contributed, currency)}</td>
                        <td className="spx-num" style={{ textAlign: "right", padding: "6px 8px", color: COLORS.forest }}>{fmt(d.growth, currency)}</td>
                        <td className="spx-num" style={{ textAlign: "right", padding: "6px 8px", fontWeight: 600 }}>{fmt(d.value, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {tab === "portfolio" && (
          <>
            <div className="spx-card">
              <div className="spx-card-title">สัดส่วนพอร์ตหลายสินทรัพย์</div>
              <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 16 }}>
                ปรับสัดส่วนแต่ละสินทรัพย์ (รวมกันจะถูกปรับให้เป็น 100% อัตโนมัติ) ตัวเลขผลตอบแทน/ความผันผวนเป็นค่าอ้างอิงระยะยาวโดยประมาณ
              </div>
              {ASSETS.map((a) => (
                <div key={a.key} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <label className="spx-label" style={{ marginBottom: 0 }}>
                      <span style={{ display: "inline-block", width: 9, height: 9, background: a.color, marginRight: 6, verticalAlign: "middle" }} />
                      {a.name} <span style={{ opacity: 0.7 }}>(ผลตอบแทนอ้างอิง {a.ret}%, ผันผวน {a.vol}%)</span>
                    </label>
                    <span className="spx-num" style={{ fontSize: 13, fontWeight: 600 }}>{Math.round(normAlloc[a.key])}%</span>
                  </div>
                  <input className="spx-slider" type="range" min="0" max="100" step="1" value={allocations[a.key]}
                    onChange={(e) => setAllocations({ ...allocations, [a.key]: Number(e.target.value) })} />
                </div>
              ))}
            </div>

            <div className="spx-card" style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ width: 220, height: 220 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {pieData.map((p, i) => <Cell key={i} fill={p.color} />)}
                    </Pie>
                    <Tooltip formatter={(v) => `${v}%`} contentStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="spx-label">ผลตอบแทนพอร์ตผสม (คาดการณ์)</div>
                <div className="spx-num" style={{ fontSize: 32, fontWeight: 600, color: COLORS.forest, marginBottom: 12 }}>{pct(blendedReturn)}</div>
                <div className="spx-label">ความผันผวนพอร์ตผสม (โดยประมาณ)</div>
                <div className="spx-num" style={{ fontSize: 18 }}>{pct(blendedVol)}</div>
                <button className="spx-btn spx-no-print" style={{ marginTop: 16 }} onClick={() => { setRate(Math.round(blendedReturn * 10) / 10); setTab("overview"); }}>
                  ใช้ผลตอบแทนนี้ในภาพรวม
                </button>
              </div>
            </div>
          </>
        )}

        {tab === "drawdown" && (
          <div className="spx-card">
            <div className="spx-card-title">Drawdown จำลอง (ประมาณการ ไม่ใช่ข้อมูลราคาจริง)</div>
            <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 12 }}>
              กราฟจำลองเส้นทางผลตอบแทนรายเดือนแบบสุ่ม โดยอิงผลตอบแทนและความผันผวนของพอร์ตผสมจากแท็บ "พอร์ตหลายสินทรัพย์"
              เพื่อประเมินว่าพอร์ตอาจติดลบจากจุดสูงสุดมากเพียงใดระหว่างทาง เส้นทางจริงในอนาคตจะแตกต่างจากนี้
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
              <div className="spx-stat-card">
                <div className="spx-stat-label">Max drawdown จำลอง</div>
                <div className="spx-stat-value spx-num" style={{ color: COLORS.red }}>{pct(maxDrawdown)}</div>
              </div>
              <div className="spx-stat-card">
                <div className="spx-stat-label">ผลตอบแทน / ความผันผวนที่ใช้</div>
                <div className="spx-stat-value spx-num">{pct(blendedReturn)} / {pct(blendedVol)}</div>
              </div>
            </div>
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <AreaChart data={drawdownPath} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke={COLORS.rule} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={(m) => `ด. ${m}`} tick={{ fontSize: 10, fill: COLORS.muted }} axisLine={{ stroke: COLORS.rule }} tickLine={false} />
                  <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: COLORS.muted }} axisLine={false} tickLine={false} width={50} />
                  <Tooltip formatter={(v) => `${v}%`} labelFormatter={(m) => `เดือนที่ ${m}`} contentStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="drawdown" stroke={COLORS.red} fill={COLORS.red} fillOpacity={0.18} strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {tab === "scenarios" && (
          <div className="spx-card">
            <div className="spx-card-title">เปรียบเทียบผลตอบแทน 8% / 10% / 12% และพอร์ตของคุณ</div>
            <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 12, color: COLORS.muted, flexWrap: "wrap" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 2, background: COLORS.red, display: "inline-block" }} />8% ({fmt(scenarioData[scenarioData.length - 1].r8, currency)})</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 2, background: COLORS.muted, display: "inline-block" }} />10% ({fmt(scenarioData[scenarioData.length - 1].r10, currency)})</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 2, background: COLORS.gold, display: "inline-block" }} />12% ({fmt(scenarioData[scenarioData.length - 1].r12, currency)})</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 2, background: COLORS.forest, display: "inline-block" }} />พอร์ตของคุณ {pct(blendedReturn)} ({fmt(scenarioData[scenarioData.length - 1].rPortfolio, currency)})</span>
            </div>
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <LineChart data={scenarioData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke={COLORS.rule} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="year" tickFormatter={(y) => `ปี ${y}`} tick={{ fontSize: 11, fill: COLORS.muted }} axisLine={{ stroke: COLORS.rule }} tickLine={false} />
                  <YAxis tickFormatter={(v) => fmt(v, currency)} tick={{ fontSize: 11, fill: COLORS.muted }} axisLine={false} tickLine={false} width={80} />
                  <Tooltip formatter={(v) => fmt(v, currency)} labelFormatter={(y) => `ปีที่ ${y}`} contentStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="r8" stroke={COLORS.red} strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
                  <Line type="monotone" dataKey="r10" stroke={COLORS.muted} strokeWidth={1.5} dot={false} strokeDasharray="1 3" />
                  <Line type="monotone" dataKey="r12" stroke={COLORS.gold} strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="rPortfolio" stroke={COLORS.forest} strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {tab === "market" && (
          <>
            <div className="spx-card">
              <div className="spx-card-title">ราคาตลาดจริง (Live, via Twelve Data API)</div>
              <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 16, lineHeight: 1.6 }}>
                ดึงราคาจริงแบบสดจาก Twelve Data — S&P500 และ NASDAQ100 ใช้ ETF ตัวแทน (SPY / QQQ) ที่ราคาเคลื่อนไหวใกล้เคียงดัชนีจริงมาก
                ส่วน Bitcoin และทองคำดึงตรงจาก BTC/USD และ XAU/USD ต้องตั้งค่า API key ในไฟล์ .env ก่อนใช้งาน (ดูวิธีใน README)
              </div>
              <button className="spx-btn spx-no-print" onClick={loadMarketData} disabled={marketStatus === "loading"}>
                {marketStatus === "loading" ? "กำลังดึงข้อมูล..." : "ดึงราคาล่าสุด"}
              </button>
              {marketStatus === "error" && (
                <div style={{ color: COLORS.red, fontSize: 13, marginTop: 12 }}>{marketError}</div>
              )}
            </div>

            {marketStatus === "done" && (
              <>
                <div className="spx-card">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
                    {MARKET_SYMBOLS.map((m) => {
                      const q = marketQuotes[m.key];
                      if (!q) return null;
                      return (
                        <div key={m.key} style={{ background: COLORS.paper, borderRadius: 4, padding: "12px 14px" }}>
                          <div className="spx-label">{m.label}</div>
                          <div className="spx-num" style={{ fontSize: 20, fontWeight: 600 }}>{q.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                          <div className="spx-num" style={{ fontSize: 12, color: q.changePercent >= 0 ? COLORS.forest : COLORS.red }}>
                            {q.changePercent >= 0 ? "+" : ""}{q.changePercent.toFixed(2)}%
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="spx-card">
                  <div className="spx-card-title">กราฟราคาจริงย้อนหลัง 12 เดือน</div>
                  {MARKET_SYMBOLS.map((m) => {
                    const s = marketSeries[m.key];
                    if (!s || s.length === 0) return null;
                    return (
                      <div key={m.key} style={{ marginBottom: 20 }}>
                        <div className="spx-label">{m.label}</div>
                        <div style={{ width: "100%", height: 140 }}>
                          <ResponsiveContainer>
                            <AreaChart data={s} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                              <CartesianGrid stroke={COLORS.rule} strokeDasharray="2 4" vertical={false} />
                              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.muted }} axisLine={{ stroke: COLORS.rule }} tickLine={false} />
                              <YAxis tick={{ fontSize: 10, fill: COLORS.muted }} axisLine={false} tickLine={false} width={60} domain={["auto", "auto"]} />
                              <Tooltip contentStyle={{ fontSize: 12 }} />
                              <Area type="monotone" dataKey="close" stroke={COLORS.forest} fill={COLORS.forest} fillOpacity={0.12} strokeWidth={1.5} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {tab === "import" && (
          <div className="spx-card">
            <div className="spx-card-title">นำเข้าธุรกรรมจาก CSV</div>
            <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 14, lineHeight: 1.6 }}>
              รูปแบบไฟล์ที่รองรับ ต้องมีคอลัมน์: <span className="spx-num">Date, Amount, Type, Ticker</span><br />
              Type ใช้ค่า buy / sell หรือ deposit / withdraw เพื่อระบุว่าเป็นเงินเข้าหรือออก
            </div>
            <div style={{ background: COLORS.paper, border: `1px dashed ${COLORS.rule}`, borderRadius: 4, padding: "10px 14px", marginBottom: 18 }}>
              <table className="spx-num" style={{ fontSize: 12, width: "100%" }}>
                <thead><tr style={{ color: COLORS.muted }}><td>Date</td><td>Amount</td><td>Type</td><td>Ticker</td></tr></thead>
                <tbody>
                  <tr><td>2024-01-05</td><td>5000</td><td>deposit</td><td>SPY</td></tr>
                  <tr><td>2024-02-05</td><td>500</td><td>buy</td><td>SPY</td></tr>
                  <tr><td>2024-03-05</td><td>500</td><td>buy</td><td>SPY</td></tr>
                </tbody>
              </table>
            </div>

            <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }}
              onChange={(e) => e.target.files[0] && handleCsvFile(e.target.files[0])} />
            <div className="spx-csv-actions">
              <button className="spx-btn secondary" onClick={downloadSampleCsv}>ดาวน์โหลดไฟล์ตัวอย่าง CSV</button>
              <button className="spx-btn" onClick={() => fileInputRef.current && fileInputRef.current.click()}>เลือกไฟล์ CSV</button>
            </div>

            {csvError && <div style={{ color: COLORS.red, fontSize: 13, marginTop: 12 }}>{csvError}</div>}

            {csvSummary && (
              <div style={{ marginTop: 20, borderTop: `1px solid ${COLORS.rule}`, paddingTop: 16 }}>
                <div className="spx-label">พบธุรกรรม {csvSummary.count} รายการ ครอบคลุม {csvSummary.monthsSpan} เดือน</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 12, margin: "10px 0 16px" }}>
                  <div className="spx-stat-card"><div className="spx-stat-label">เงินสุทธิที่นำเข้า</div><div className="spx-stat-value spx-num">{fmt(csvSummary.totalNet, currency)}</div></div>
                  <div className="spx-stat-card"><div className="spx-stat-label">เงินลงทุนเริ่มต้น (โดยประมาณ)</div><div className="spx-stat-value spx-num">{fmt(csvSummary.derivedInitial, currency)}</div></div>
                  <div className="spx-stat-card"><div className="spx-stat-label">DCA เฉลี่ยต่อเดือน (โดยประมาณ)</div><div className="spx-stat-value spx-num">{fmt(csvSummary.derivedMonthly, currency)}</div></div>
                </div>
                <button className="spx-btn" onClick={applyCsvValues}>ใช้ค่านี้ในเครื่องคำนวณ (ไปที่ภาพรวม)</button>
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 8, textAlign: "center" }}>
          ตัวเลขเป็นการประมาณการโดยอิงสมมติฐานที่กำหนดเอง ไม่ใช่คำแนะนำการลงทุน ผลตอบแทนในอดีตไม่ได้การันตีผลตอบแทนในอนาคต
          กราฟ Drawdown เป็นการจำลอง ไม่ใช่ราคาย้อนหลังจริง
        </div>
        <div style={{ fontSize: 11, color: COLORS.muted, opacity: 0.7, marginTop: 10, textAlign: "center" }}>
          This website was created by Hex.
        </div>
      </div>
    </div>
  );
}
