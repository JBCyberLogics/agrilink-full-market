# Roadmap — Connect Agrilink frontend to Agrilink backend APIs

1. [in-progress] Inventory backend API contracts (subagent audit)
2. [in-progress] Inventory frontend API usage + session handling (subagent audit)
3. [pending] Align transport: /api/v1 base, JWT bearer auth + refresh handling in apiClient
4. [pending] Map/rebuild frontend services to real backend endpoints (auth, users/profile, shop/marketplace listings, cart, orders, favorites, reviews, notifications, market-intelligence, AI/weather/demand, chat/messages, settings/faq/contact/newsletter)
5. [pending] Wire role dashboards (farmer↔seller, buyer↔customer) to backend data
6. [pending] Update sitemap/menu/routing for any adjusted pages
7. [pending] Run offline tests (bun, mocked DB) + frontend vitest; fix regressions
8. [pending] End-to-end verification in preview (signup → login → farmer listing → buyer order flow) with real inputs

## Frontend ↔ /api/v1 integration
- [x] Farmer produce, profile, image upload → product/users endpoints
- [x] Checkout (server cart → order), buyer & farmer orders, status updates
- [x] Inquiries → chat/message endpoints
- [x] AI tools → market-intelligence & ai-assistant (safe fallbacks)
- [x] Production build passes
- [ ] Live test against running backend on port 5000 (needs backend running + VITE_API_BASE_URL)
