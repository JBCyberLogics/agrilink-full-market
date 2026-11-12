# AgriLink AI module

This module provides typed capability identifiers, request and response validation, a single authenticated backend-proxy client, feature services, React hooks, and deterministic algorithms. It does not call providers directly and has no provider credential in the frontend.

## Enable the proxy

Set `VITE_AGRILINK_AI_PROXY_URL` to the backend AI route base after the server implements the contract. For example, a backend may expose `/api/v1/ai`; the client then posts to `{base}/{shared|farmer|buyer}/{capability}`. With the variable unset, requests return `AI_PROXY_NOT_CONFIGURED`, make no network request, and show no generated result.

The API key and model credentials belong in backend secret management. Never add any provider key to a frontend environment file.

The diagnostics screen is available only in development at `#/dev/ai-diagnostics`. It has no prefilled request bodies. Feature calls are sent only after an explicit action with user-entered JSON. Provider configuration and diagnostics are Admin-only in AgriLink Control; Farmer/Buyer diagnostics never call administrator routes.

## Use a capability service

```js
import { marketAdvisor } from './services/index.js'

const response = await marketAdvisor({
  produce: 'Maize',
  location: 'Nakuru',
  quantity: 50,
  timePeriod: 'month',
})

if (response.ok) {
  // The data was returned by the configured proxy and passed schema validation.
} else {
  // Render response.error / response.code; do not substitute a sample result.
}
```

Use `useAIRequest(capability)` for form-based requests and `useAIChat()` for assistant conversation state. Chat requests are bounded to 12 prior turns and messages longer than 4,000 characters are rejected locally. Current feature forms keep their existing layouts and call the compatibility exports from `src/services/ai.js`, which now resolve to this module.

## Algorithms

Import algorithms from `./algorithms/index.js`. Scorers accept user/data-derived criteria in the `0..100` range and configurable weights. Missing inputs remain missing and reduce score coverage. Purchase optimization requires matching currency and units. Net profit returns a null profit until the caller confirms that all costs are represented.

See [the backend handover](../../docs/BACKEND_INTEGRATION_HANDOVER.md) for capability schemas, the proxy envelope, weight formulas, profile contracts, and deployment/testing requirements.
