# Mapping this prototype onto AWS

This prototype runs entirely locally with zero cloud dependencies, so it's easy
to demo anywhere with just Node.js. It's structured so the port to the AWS
architecture in the pitch deck is mechanical, not a rewrite.

| In this prototype | Becomes, in production |
|---|---|
| `db.js` in-memory arrays (`donors`, `recipients`, `donations`, `demandRequests`, `matches`, `custodyLog`) | **Amazon DynamoDB** tables, one per array. Each record is already shaped as a flat item with a UUID `id` partition key. |
| `donor.verificationDoc` / `recipient.verificationDoc` string fields (currently fake `s3://...` paths) | **Amazon S3** objects. Swap the fake path for a real presigned-upload flow into a `food-hub-verification-docs` bucket. |
| Each block in `server.js`'s `handleApi()` (e.g. `POST /api/donations`, `POST /api/match/run`) | An **AWS Lambda** function behind **API Gateway**. The route handlers are already pure functions of `(request, db)` — copy the body of each `if` block into its own Lambda handler. |
| `engine.js` `runMatching()` | The **Explainable Matching Engine** Lambda. In prod, trigger it from **Amazon EventBridge** on a `DonationRegistered` or `DemandRegistered` event instead of the manual "Run Matching Engine" button. |
| `matching.js` `haversineKm()` | Replace with **Amazon Location Service** distance/routing calls for real road distance instead of straight-line. |
| OTP generation/verification in `server.js` | Same logic, but issue the OTP via **Amazon SNS** (SMS) instead of returning it directly in the API response. |
| Manual "Run Matching" polling | **Amazon SQS** + EventBridge for async, retry-safe dispatch once volume grows past a demo. |
| `console.log` / `/api/custody-log` | **Amazon CloudWatch Logs** for operational logs; keep DynamoDB as the source of truth for the audit trail (already is). |
| No auth (anyone can call any endpoint) | **Amazon Cognito** user pools for donor/recipient/admin login, gating the API Gateway routes. |

### Suggested first deployment step
Wrap each `if (pathname === ... )` block in `server.js` as its own file under
`lambdas/`, put `db.js`'s tables into real DynamoDB (using the same field
names), and deploy with AWS SAM or the Serverless Framework. Because the
business logic in `matching.js` and `engine.js` has no dependency on `http` or
`fs`, those two files can be imported into Lambda handlers unchanged.
