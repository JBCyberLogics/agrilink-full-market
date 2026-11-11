# AgriLink unified backend

Node 24, TypeScript, Express 5, MongoDB, and Mongoose. Both browser applications use one versioned API under /api/v1.

## Local setup

1. Install Node.js 24 or newer.
2. Start the installed local MongoDB server with `bash scripts/start-local-mongodb.sh`. It binds only to `127.0.0.1`, uses a single-node replica set for transactions, and preserves data under `${XDG_DATA_HOME:-~/.local/share}/agrilink/mongodb`.
3. Copy `.env.example` to `.env`, generate a private `SESSION_SECRET` (at least 32 characters), and keep the file out of version control. The configured local database is `mongodb://127.0.0.1:27017/agrilink?replicaSet=agrilink-rs`.
4. Install dependencies with `npm install`.
5. Initialize the real `agrilink` database with `npm run db:init`. This creates empty canonical collections and indexes; it inserts no application records.
6. Start with `npm run dev`. The backend also verifies/initializes collections before listening.
7. Inspect the API at `http://localhost:4300/api/docs` and readiness at `http://localhost:4300/api/v1/health/ready`.

The two existing Vite applications use `http://localhost:5199` (Farmer/Buyer) and `http://localhost:5173` (AgriLink Control); both point to the same backend at `http://localhost:4300/api/v1`. Production startup fails when required security or database configuration is missing. Real credentials belong in the backend secret store or an ignored backend `.env`; never place them in either Vite application.

The local MongoDB data directory is persistent and is not part of the repository. Restart MongoDB with the same `scripts/start-local-mongodb.sh` command after a computer restart. Do not remove the data directory to reset application data.

For the first administrator, use the documented interactive `npm run admin:create` setup after an authorized person supplies the administrator's name, email and password. The command does not create a default/demo account.

The application uses existing collections and reads legacy fields without rewriting them. `npm run db:inspect` is read-only. `npm run db:migrate:dry-run` accepts only an isolated `MONGODB_MIGRATION_URI` database ending in `_migration` or `_test`; it reports candidate field mappings and performs zero writes. Production data is not seeded or automatically migrated.

### KAMIS market observations

An administrator can register **KAMIS public market feed** in AgriLink Control → Data Sources, then select **Sync KAMIS**. The backend fetches the [official KAMIS market-search table](https://kamis.kilimo.go.ke/site/market_search) over HTTPS with a fixed host, bounded timeout/response size, and schema checks. It preserves wholesale/retail quote type and the source's date-only precision, maps the Kenyan source prices to `KES` based on the Ministry's [KAMIS price material](https://kilimo.go.ke/wp-content/uploads/2024/12/Kilimo-Bulletin-Issue-II-December.pdf), normalizes supported units, records the public source URL, rejects future/unsupported values, and imports observations transactionally with fingerprint-based replay protection. Missing quote cells are counted as unavailable; the UI shows that observation time was not supplied. The sync is administrator-triggered; no automatic schedule is configured. Other `authorized_api` sources stay marked not integrated until an adapter is tested.

`npm run verify:provider:kamis` performs a live read-only source check and writes nothing to MongoDB. `npm run test:e2e:kamis` exercises the authenticated admin sync against the live provider while using only the isolated `agrilink_test` database and removes its temporary records afterward.

## Verification

`npm run typecheck` and `npm test` cover deterministic business logic and HTTP security boundaries without connecting to application MongoDB. `npm run test:e2e:local` exercises farmer listing, buyer listing-linked request creation/history, stock validation, owner-scoped farmer request matching, buyer/farmer inquiry conversations, saved notification preferences, order alerts and delivery-stage transitions, buyer cart, transactional checkout, stock reservation, idempotent replay, verified reviews tied to delivered orders, support replies, report review, payout-record viewing, authorization, AI unavailable behavior, deterministic profit math, matching-weight configuration/retrieval, and MongoDB reconnect persistence. It refuses to run unless `MONGODB_TEST_URI` points to a loopback `agrilink_*_test` database, disables outbound test email, and cleans its fixtures when finished. The authenticated route `GET /api/v1/algorithms/matching` exposes only normalized weights and version to the live supplier ranker, while `/api/v1/purchase-requests/matches` scores open requests for the current farmer's listings; administrator updates take effect on the next scoring request.

Buyer reviews are visible only from persisted review records. A buyer can submit one after an order containing the listing reaches `delivered`; summaries are calculated from those reviews. In-app message and order alerts use account-scoped `messages` and `orders` preferences, with explicit enabled defaults until saved. Email and mobile push notification channels are unavailable until their providers are integrated. Administrator support replies are saved with a delivery state; the UI distinguishes a stored response from an email that SMTP actually sent. The payout table is read-only until an auditable seller balance and payout provider are implemented.

NVIDIA, M-Pesa, PayPal, and SMTP integrations report not-configured or unavailable until valid server-side credentials are configured. KAMIS does not require credentials for its public market-search feed. No payment, market, or AI result is simulated.
