# AgriLink Farmer/Buyer application

The Farmer/Buyer application is the public marketplace frontend. It shares the unified Express backend and central MongoDB database with the separate AgriLink Control administrator frontend.

## Local development

- Farmer/Buyer: `http://localhost:5199`
- AgriLink Control: `http://localhost:5173`
- API: `http://localhost:4300/api/v1`
- MongoDB database: `agrilink`

Start Vite from this directory:

```sh
npm install
npm run dev
npm run test:client
npm run build
```

Start the unified API from the sibling `../backend` directory and use the existing local MongoDB service. Configure `VITE_API_BASE_URL` only with the backend URL; provider secrets must stay in backend configuration. The local database is persistent and must not be reset to test the frontend.

## Integrated workflows

Authentication, profiles, listings, marketplace search, favorites, carts, purchase requests, checkout, orders, notifications, messaging, FAQs, reviews, support, Market Intelligence, and deterministic calculations use backend operations where implemented. The backend remains authoritative for stock, currency, price, payment status, ownership, and permissions.

NVIDIA-generated guidance reports unavailable when its provider is not configured. KAMIS market observations include source and freshness details. Missing provider data is rendered as unavailable or empty, never as an invented observation or record.

## Data integrity

The application does not seed demo accounts, listings, transactions, prices, analytics, notifications, or AI responses. Empty database results remain empty states, loading is shown during retrieval, and failed API requests remain errors. Automated fixtures are confined to the isolated `agrilink_test` database.

For current provider configuration, test evidence, database counts, and remaining infrastructure requirements, see [backend/FEATURE_STATUS.md](../backend/FEATURE_STATUS.md). Administrator-specific workflows and known Control gaps are listed in the [dashboard integration map](agri_dashboard/docs/ADMIN_DASHBOARD_INTEGRATION_MAP.md).
