# Food Waste Redistribution Hub — Working Prototype

A safety-first, explainable matching hub for surplus food donors and
recipients — built from the pitch deck's "Now" milestone: *"Synthetic
donor/recipient demo: registration, explainable matching, custody tracking."*

**Stack:** Plain Node.js (zero npm dependencies — only built-in `http`, `fs`,
`crypto`) + a static HTML/CSS/JS frontend. No build step, no internet
connection required to run. The code is structured so it maps directly onto
the AWS Lambda + DynamoDB + S3 architecture from the deck — see
`AWS_MAPPING.md`.

## How to run it

1. Make sure you have Node.js 16+ installed (`node -v`).
2. From this folder, run:
   ```
   node server.js
   ```
3. Open **http://localhost:3000** in your browser.

That's it — no `npm install`, no environment variables, no database setup.
The app comes pre-seeded with synthetic donors, recipients, donations, and
demand requests so the board isn't empty on first load.

## What's implemented (mapped to the deck)

- **Register** (donors & recipients) — `Register` tab: donor/recipient forms
  capturing food type, quantity, expiry, storage needs, pickup capacity,
  service radius, dietary/allergen filters.
- **Explainable Matching Engine** — `Matching Board` tab, "Run Matching
  Engine" button. Every proposed match shows the exact reasons it was
  suggested (expiry fit, distance, storage compatibility, capacity, donor
  reliability) and any warnings (tight pickup windows, cold-chain risk,
  low-reliability donors) — modeled directly on the "Proposed Match #A-1042"
  card in the deck.
- **No expired or incompatible matches** — expired donations and
  storage/cold-chain-incompatible pairs are excluded before they ever reach
  the board (`matching.js`).
- **No double-allocation** — a donation is locked (`status: 'reserved'`) the
  instant it's proposed in a match, until it's released (cancelled) or
  completed.
- **Mutual acceptance required** — both donor and recipient must click
  Accept before anything moves forward; nothing is auto-committed.
- **Secure handover via OTP** — once both sides accept, a 6-digit OTP is
  issued. Entering the correct OTP on the board logs the custody transfer and
  marks the match delivered.
- **Full custody & cancellation trail** — `Custody Log` tab shows every
  proposal, acceptance, OTP issuance, handoff, and cancellation, timestamped.
- **Batch aggregation** — if no single donation covers a demand request, the
  engine combines several smaller ones (see `engine.js`), exactly like the
  "60 + 50 + 40 = 150 meals" example in the deck.
- **Cold-chain safety** — cold/frozen donations carry an explicit temp range;
  a recipient without matching storage capability is blocked automatically,
  and a warning fires if the pickup window risks breaking the chain.
- **Donor Reliability Score** — `Donor Reliability` tab. Completed handoffs
  raise it, late cancellations (after acceptance) and no-shows lower it.
- **Verified institutions, tiered access** — `Register → Verify an
  Institution`. Donations/requests above 30kg require `institutional`
  verification tier; unverified accounts are blocked with a clear message
  telling them how to verify (simulates the S3-backed document upload gate).
- **Analytics board** — `Analytics` tab: unmatched requests by region (bar
  chart) plus an ESG-style total-kg-diverted-from-landfill counter.

## A quick demo script

1. Open the **Matching Board** tab and click **Run Matching Engine**.
   - You'll see the "Bread loaves → Riverside Community Kitchen" match appear
     with its reasons.
   - Notice the "Frozen vegetables" demand request stays **unmet** — the
     recipient (Hope Shelter Trust) only has ambient storage, so the
     cold-chain guardrail correctly blocks that match. This is intentional,
     to show the guardrail working.
   - The "Canned goods" request also stays unmet — no compatible donor
     exists yet, and it stays visible on the board rather than disappearing.
2. On the proposed match, click **Accept (Donor)** then **Accept
   (Recipient)** — an OTP appears.
3. Enter the OTP and click **Confirm Handover** — the match moves to
   "delivered", the donation is marked completed, and the donor's
   reliability score ticks up.
4. Check the **Analytics** tab — the ESG "diverted from landfill" counter and
   "completed deliveries" stat now reflect the delivery.
5. Check the **Custody Log** tab — every step above is there with a
   timestamp.
6. Try registering a new donor and logging a 50kg donation without verifying
   them first (`Register` tab) — you'll get a 403 telling you to verify the
   donor as `institutional` first. Verify them, then retry — it succeeds.

## What I'd extend first

In priority order, if this moved past a hackathon demo:

1. **Persistence** — swap `db.js`'s in-memory arrays for real DynamoDB tables
   (the record shapes are already DynamoDB-item-ready — see
   `AWS_MAPPING.md`). Right now all data resets when the server restarts.
2. **Real geolocation & distance** — replace the straight-line haversine
   distance in `matching.js` with Amazon Location Service for real driving
   distance/time, which changes which matches are actually feasible.
3. **Auth** — add Amazon Cognito so donors/recipients/admins have real
   accounts instead of picking from a dropdown, and so the "accept" and
   "verify" actions are tied to an authenticated identity instead of an
   honor-system role field.
4. **Real document upload for verification** — today "verify" just accepts a
   filename string; wire up an actual file upload to S3 with a presigned URL,
   plus a manual admin review queue for institutional tier approval.
5. **Push notifications** — SNS/SMS for OTP delivery and for alerting
   recipients when a new compatible donation appears near them, instead of
   requiring someone to click "Run Matching Engine."
6. **Automatic matching triggers** — run the matching engine automatically
   (EventBridge rule) whenever a new donation or demand request is logged,
   instead of the manual button, and re-run periodically to catch newly
   expiring items.
7. **Predictive demand signals** (the deck's "Later" milestone) — use the
   historical unmet-demand-by-region data already captured in `/api/analytics`
   to forecast where more donor supply is needed before shortages happen.

## Project structure

```
food-waste-hub/
├── server.js          # HTTP server + all API routes (maps to Lambda handlers)
├── engine.js           # Match orchestration: batch aggregation, locking
├── matching.js         # Explainable scoring engine + guardrails
├── db.js                # In-memory "DynamoDB tables" + seed data
├── public/
│   ├── index.html       # Tabs: Board, Register, Analytics, Reliability, Custody Log
│   ├── style.css         # Deck-matching dark green / cream / orange theme
│   └── app.js             # Frontend logic, calls the API
├── AWS_MAPPING.md      # How each piece maps onto real AWS services
└── package.json
```
