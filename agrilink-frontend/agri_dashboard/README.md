# AgriLink Control

AgriLink Control is the separate administrator frontend for the unified AgriLink platform. It uses the same backend and MongoDB database as the Farmer/Buyer application.

## Local development

- Control: `http://localhost:5173`
- Farmer/Buyer: `http://localhost:5199`
- API: `http://localhost:4300/api/v1`
- MongoDB database: `agrilink` on the existing local MongoDB replica set

Control sends credentialed API requests to the shared backend. Set `VITE_API_BASE_URL=http://localhost:4300/api/v1` in the local Vite environment when needed. Provider credentials belong in backend configuration or encrypted server-side settings, never Vite variables.

From this directory:

```sh
npm install
npm run dev
npm test
npm run build
```

Start the API separately from `../../backend` with its local environment configured. The existing local MongoDB is persistent; do not delete or reset its data directory. Local ports and database startup details are recorded in [backend/FEATURE_STATUS.md](../../backend/FEATURE_STATUS.md).

## Authentication and permissions

Administrator sign-in accepts the email or username on the existing administrator account. The shared backend creates an HttpOnly session cookie, protects writes with CSRF, restores sessions through `/auth/admin/session`, and checks each administrative permission server-side. The frontend hides navigation and actions that the active role cannot use; those checks are only a usability layer.

The development preview route is available only in Vite development mode and never creates an authenticated session. Do not use it as an administrator login or as verification of backend access.

## Data and provider status

Dashboard records and analytics come from the shared database. Empty collections render empty states; provider failures remain errors or unavailable states. The live local database was inspected with one existing administrator and its bootstrap audit entry; the application does not seed demo users, products, orders, payments, prices, or analytics.

NVIDIA, SMTP, M-Pesa, PayPal, and push delivery require authorized provider configuration before their corresponding live workflows can be verified. The KAMIS adapter has been retrieved and exercised against the isolated test database. See [backend/FEATURE_STATUS.md](../../backend/FEATURE_STATUS.md) for current verification evidence and limitations.

## Integration and verification documents

- [Admin dashboard integration map](docs/ADMIN_DASHBOARD_INTEGRATION_MAP.md)
- [Admin API contract reference](docs/api-integration/ADMIN_API_CONTRACT.md)
- [Administrator authentication contract](docs/api-integration/ADMIN_AUTH_CONTRACT.md)
- [Deployment notes](docs/architecture/DEPLOYMENT.md)
