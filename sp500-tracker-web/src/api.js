// Real market data via Twelve Data (https://twelvedata.com).
// Free tier: 800 requests/day, works directly from the browser (CORS enabled).
// Symbols used as tracking proxies for indices that aren't directly quotable
// on the free tier:
//   SPY  -> S&P 500 ETF (tracks the index closely)
//   QQQ  -> Nasdaq 100 ETF (tracks the index closely)
//   BTC/USD, XAU/USD -> quoted directly

const BASE = "https://api.twelvedata.com";

function getKey() {
  const key = import.meta.env.VITE_TWELVEDATA_KEY;
  if (!key || key === "your_api_key_here") {
    throw new Error("ยังไม่ได้ตั้งค่า API key: เพิ่ม VITE_TWELVEDATA_KEY ในไฟล์ .env (ดูวิธีได้ใน README)");
  }
  return key;
}

export async function fetchQuote(symbol) {
  const key = getKey();
  const res = await fetch(`${BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${key}`);
  const data = await res.json();
  if (data.status === "error" || data.code >= 400) {
    throw new Error(data.message || "เรียกข้อมูลราคาไม่สำเร็จ");
  }
  return {
    symbol: data.symbol,
    price: parseFloat(data.close),
    changePercent: parseFloat(data.percent_change),
    datetime: data.datetime,
  };
}

export async function fetchMonthlySeries(symbol, months = 12) {
  const key = getKey();
  const res = await fetch(
    `${BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=1month&outputsize=${months}&apikey=${key}`
  );
  const data = await res.json();
  if (data.status === "error" || !data.values) {
    throw new Error(data.message || "เรียกข้อมูลย้อนหลังไม่สำเร็จ");
  }
  return data.values
    .slice()
    .reverse()
    .map((v) => ({ date: v.datetime, close: parseFloat(v.close) }));
}

export const MARKET_SYMBOLS = [
  { key: "SP500", symbol: "SPY", label: "S&P 500 (ผ่าน SPY ETF)" },
  { key: "NASDAQ100", symbol: "QQQ", label: "NASDAQ 100 (ผ่าน QQQ ETF)" },
  { key: "BTC", symbol: "BTC/USD", label: "Bitcoin" },
  { key: "GOLD", symbol: "XAU/USD", label: "ทองคำ" },
];
