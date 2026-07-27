# S&P500 Investment Tracker

A personal investment dashboard: DCA (dollar-cost averaging) calculator, multi-asset
portfolio allocation, simulated drawdown, scenario comparison, CSV transaction import,
and a live market data tab backed by a real financial API. Built with React + Vite +
Recharts.

## Features

- DCA growth calculator with a compounding projection chart
- Goal solver: reverse-calculates the monthly contribution needed to hit a target
- Multi-asset portfolio allocation (S&P 500 / NASDAQ 100 / Bitcoin / Gold) with a
  blended expected return and a donut chart
- Simulated drawdown chart (clearly labeled as a simulation, not real history)
- Scenario comparison: 8% / 10% / 12% vs. your blended portfolio return
- CSV transaction import (`Date, Amount, Type, Ticker`)
- **Live market data tab** — real prices and 12-month history via the
  [Twelve Data](https://twelvedata.com) API
- Print / "Download report" button (browser print-to-PDF)

## 1. Install

```bash
npm install
```

## 2. Get a free API key (for the "ราคาตลาดจริง" / live market tab)

1. Go to <https://twelvedata.com/pricing> and sign up for the free tier
   (800 requests/day — plenty for a personal dashboard).
2. Copy your API key.
3. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
4. Paste your key into `.env`:
   ```
   VITE_TWELVEDATA_KEY=your_real_key_here
   ```

Without this key, every tab still works except the live market data tab, which will
show a clear error message telling you to add the key.

## 3. Run locally

```bash
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## 4. Build for production

```bash
npm run build
npm run preview   # optional: preview the production build locally
```

## 5. Deploy (free options, good for a resume link)

**Vercel** (recommended, easiest):
1. Push this folder to a GitHub repo.
2. Go to <https://vercel.com>, "New Project", import the repo.
3. In the project's Environment Variables settings, add `VITE_TWELVEDATA_KEY`
   with your key.
4. Deploy — Vercel auto-detects Vite. You'll get a live URL like
   `your-project.vercel.app`.

**Netlify** works the same way: connect the repo, set the build command to
`npm run build`, publish directory to `dist`, and add the same environment
variable under Site settings → Environment variables.

Once deployed, put the live URL and this repo link on your resume/portfolio.

## Notes on data accuracy

- S&P 500 and NASDAQ 100 are tracked via their most liquid ETFs (SPY, QQQ) since
  the free tier of most market-data APIs does not offer the raw index ticker.
  Prices track the real indices very closely.
- The drawdown chart is a **Monte Carlo simulation** based on the return/volatility
  assumptions you set on the Portfolio tab — it is not a real historical price
  series. This is disclosed in the UI.
- This project is for personal learning and portfolio purposes and is not
  investment advice.
