# Food Waste Redistribution Hub — Working Prototype

A safety-first, explainable matching hub for surplus food donors and recipients.

**Stack:** Plain Node.js (zero npm dependencies — only built-in `http`, `fs`, `crypto`) + ES Modules + a static HTML/CSS/JS frontend. No build step, no external services required to run.

## How to run it

1. Make sure you have Node.js 16+ installed (`node -v`).
2. From this folder, run:
   ```
   node server.js
   ```
3. Open **http://localhost:3000** in your browser.

The app comes pre-seeded with synthetic donors, recipients, donations, and demand requests so the board isn't empty on first load.

## What's implemented

- **Register** (donors & recipients) — donor/recipient forms capturing food type, quantity, expiry, storage needs, pickup capacity, service radius, dietary/allergen filters.
- **Explainable Matching Engine** — every proposed match shows the exact reasons it was suggested (expiry fit, distance, storage compatibility, capacity, donor reliability) and any warnings (tight pickup windows, cold-chain risk, low-reliability donors).
- **No expired or incompatible matches** — expired donations and storage/cold-chain-incompatible pairs are excluded before reaching the board (`matching.js`).
- **No double-allocation** — a donation is locked (`status: 'reserved'`) the instant it's proposed in a match, until released or completed.
- **Mutual acceptance required** — both donor and recipient accept before custody handoff begins.
- **Secure handover via OTP** — once both sides accept, a 6-digit OTP is issued and verified at pickup.
- **Full custody & cancellation trail** — custody log tracks proposals, acceptances, OTP issuance, handoffs, and cancellations.
- **Batch aggregation** — combines smaller donations if no single donation covers the requested quantity (`engine.js`).
- **Cold-chain safety** — cold/frozen donations require verified storage match.
- **Donor Reliability Score** — completed handoffs raise it; cancellations lower it.
- **Analytics board** — shows diverted surplus and delivery statistics.

## Project structure

```
food-waste-hub/
├── server.js          # HTTP server + API routes
├── engine.js          # Match orchestration & batch aggregation
├── matching.js        # Scoring engine & guardrails
├── db.js              # In-memory data store + seed data
├── public/
│   ├── index.html     # UI frontend
│   ├── style.css      # Styling
│   └── app.js         # Client script
└── package.json
```
