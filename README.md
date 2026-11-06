# Stillwell Clinic booking API

Koya Academy assessment implementation: **Levels 1–3**. Levels 4 and 5 are intentionally not claimed. Persistent Cloudflare D1 database; standard Worker ESM, no frontend framework.

## Run

Node 22+ required. `npm ci`, then `npx wrangler d1 migrations apply DB --local`. Set `API_KEY` in ignored `.dev.vars`, then `npm run dev`. Open the page and enter that key. No key is embedded in public source or browser JavaScript.

`npm test` exercises the actual Worker with a real local D1 runtime, including a 25-request race, cancellation races, validation, availability, filtering, reset, and lookup. `npm run build` packages the Worker for Sites. `openapi.json` is the supplied assessment contract; this implementation supports its Levels 1–3 subset.

## Endpoints

Every API request requires `X-API-Key`. JSON errors use `{ "error": "message" }`.

- `POST /reset`: atomically delete bookings and replace slots, including past ones.
- `GET /slots?provider=Dr%20Ade`: list all slots chronologically, optional exact provider filter.
- `POST /bookings`: `{ "slot_id":"s1", "name":"Ada Obi", "email":"ada@example.com" }`; returns 201.
- `GET /bookings/:id`: retrieve a booking or 404.
- `DELETE /bookings/:id`: cancel and release the slot; a second cancellation returns 409.

The database's partial unique index permits only one confirmed booking per slot. This remains true across Worker isolates. An atomic conditional UPDATE ensures only one cancellation succeeds. Reset is a D1 transactional batch. Dates are normalized to UTC before sorting, and past slots are retained but cannot be booked. User-provided content is rendered with textContent.

## Deployment

Sites project identity is in `.openai/hosting.json`. Configure secret `API_KEY` through the host, provision binding `DB`, and apply `drizzle/0000_clinic.sql` before serving traffic. No runtime table creation or in-memory booking store. Wrangler configuration also supports deployment to a personal Cloudflare account after replacing its local database ID with a provisioned D1 ID and setting the secret.

The shared API key grants access to all assessment API operations, including reset and lookup. This follows the assessment contract; it is not a production patient-authentication system. Use fictional patient information.

## Demo (under five minutes)

See `DEMO.md` for the recording script. A Loom recording requires the submitter's Loom account and voice/screen capture.
