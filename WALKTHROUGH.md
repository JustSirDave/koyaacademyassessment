# Explaining the clinic booking project

## The opening explanation to practise

“I built a clinic booking API and a simple web page using JavaScript. A Cloudflare Worker serves both the page and the API, and Cloudflare D1 stores slots and bookings persistently. I completed Levels 1 to 3: listing, booking, lookup, API-key authentication, validation, cancellation, and protection against concurrent double-booking. Levels 4 and 5 are not implemented.”

Remember this request flow:

**Browser → Worker entrypoint → API key check → validation → D1 database → JSON response → page update.**

## Follow one booking from start to finish

1. A visitor opens `/`. `worker/index.js` returns the HTML string exported by `worker/page.js`.
2. They enter the assessment key and click Load appointments. The browser calls `GET /slots` with the `X-API-Key` header.
3. The entrypoint sends this request to `api()` in `worker/api.js`. It checks the key against the host's `API_KEY` secret before querying D1 through `env.DB`.
4. The slots query returns slots ordered by start time. A slot is available when no confirmed booking refers to it. The browser displays provider, local appointment time, and availability.
5. The visitor selects a slot and submits name and email. The browser sends `POST /bookings` with `slot_id`, `name`, and `email`.
6. The API requires nonempty strings, trims name and email, lowercases email, checks basic email syntax, and checks that the slot exists and has not started.
7. The server generates a UUID and creation timestamp, then inserts the booking. The database's partial unique index allows only one confirmed booking for that slot.
8. A successful insert returns the saved booking with HTTP 201. A competing insert returns HTTP 409. The browser shows the reference and refreshes availability.
9. A later `GET /bookings/:id` reads the booking from D1. It does not depend on the earlier request or browser memory.
10. `DELETE /bookings/:id` changes a confirmed booking to cancelled. Because availability is calculated from confirmed bookings, the slot becomes available again.

## File-by-file explanation

| File | What to say |
| --- | --- |
| `worker/index.js` | “This is the HTTP entrypoint. It serves the page at `/`, forwards API requests, and converts malformed JSON or unexpected failures into JSON errors.” |
| `worker/api.js` | “This contains the routes, authentication, validation, SQL queries, and HTTP response codes.” |
| `worker/page.js` | “This contains the HTML, CSS, and browser JavaScript. It uses fetch to call the same-origin API and textContent to display returned values.” |
| `drizzle/0000_clinic.sql` | “This defines the database tables and indexes, including the concurrency constraint.” |
| `tests/api.test.js` | “This runs the actual Worker against a local D1 runtime and checks the endpoints and overlapping requests.” |
| `scripts/build.mjs` | “This copies the Worker, hosting manifest, and migrations into a deployment artifact. It does not execute SQL or publish the site itself.” |
| `wrangler.jsonc` | “This configures local Worker development and the local DB binding.” |
| `.openai/hosting.json` | “This identifies the existing Sites project and declares its hosted database binding.” |
| `openapi.json` | “This is the original assessment contract. It includes Levels 4 and 5, so it describes more than the implemented subset.” |
| `package.json` | “This declares ES modules, npm commands, and the local development/test tools.” |
| `package-lock.json` | “This records exact dependency resolutions so npm ci can reproduce installation.” |

## The most important database explanation

There are two tables:

- `slots`: an ID, provider, start, and end. These represent appointments the clinic offers.
- `bookings`: an ID, referenced slot ID, patient name, email, status, and creation time. These represent reservations.

The foreign key links a booking to a slot. The status check permits only `confirmed` or `cancelled`.

The key rule is:

```sql
CREATE UNIQUE INDEX one_confirmed_booking_per_slot
ON bookings(slot_id)
WHERE status = 'confirmed';
```

Say: “The index applies only to confirmed bookings. Two requests can both read an available slot, so checking availability in JavaScript would not be enough. The database enforces the rule during insertion, allowing only one confirmed reservation. Cancelled bookings remain for lookup, but they no longer block that slot.”

The email/creation index prepares an efficient access path for querying a person's booking history. It does **not** mean pagination is implemented.

Applied migration SQL is kept unchanged. Its explanation is here rather than added by editing migration history.

## Why cancellation is safe

```sql
UPDATE bookings SET status = 'cancelled'
WHERE id = ? AND status = 'confirmed'
RETURNING *;
```

Say: “The state check and update happen in one database statement. If two cancellation requests overlap, only one changes the booking. The other finds it already cancelled and returns 409.”

Cancellation changes status; it does not delete the booking.

## What reset does

`POST /reset` accepts a slot list. It validates the whole list, deletes existing bookings, deletes existing slots, then inserts the supplied slots in one transactional D1 batch. Either the complete batch succeeds or it rolls back. It accepts past slots because the evaluator needs to test rejection of past appointments.

This is an assessment setup operation, not an ordinary patient-facing action. The shared key grants access to it.

## Status codes to remember

| Status | Meaning here |
| --- | --- |
| 200 | Slots listed, booking retrieved, booking cancelled, or reset completed |
| 201 | Booking created |
| 400 | Invalid details, invalid JSON, or an appointment that has started |
| 401 | Missing or incorrect API key |
| 404 | Unknown slot, booking, or route |
| 409 | Slot already booked or booking already cancelled |
| 500 | Unexpected server failure |

## What the tests prove

Run `npm test`.

The test starts the Worker in Miniflare, applies the SQL to local D1, then calls the API. It checks authentication, reset, sorting, provider filtering, validation, normalized patient values, lookup, availability, cancellation, and rebooking.

The most important part sends 25 booking requests together using `Promise.all`. The assertions require exactly one 201 and 24 conflicts. Two cancellation requests must yield one 200 and one 409.

The persistence assertion retrieves a stored booking in a separate request within the same test runtime. It is not a restart test. The deployed system was also checked with a 12-request race and separate lookup/cancellation requests.

## Configuration and package commands

`package.json` and `.openai/hosting.json` are standard JSON, which cannot contain comments. This section documents them without making the files invalid. Generated lockfiles and the supplied OpenAPI contract are also kept free of explanatory edits.

- `type: module` enables JavaScript import/export syntax.
- `private: true` prevents accidental npm package publication; it does not make the GitHub repository private.
- `npm test` runs Node's test runner.
- `npm run build` prepares output files.
- `npm run dev` starts Wrangler for local development.
- Miniflare supplies the local Worker/D1 test runtime; Wrangler supplies development tooling. Production uses the host's Worker runtime.
- Hosted `API_KEY` is a secret configured separately from source. The page asks the evaluator to enter it and sends it in headers.
- The hosting manifest's `project_id` identifies the existing deployment; `d1: "DB"` declares the persistent database binding; unused R2 storage is null.

## Questions you might be asked

**Why not store bookings in an array?**

“A serverless Worker can restart or handle requests in different instances. An array would not provide shared durable state. D1 stores the records outside the request process.”

**Does disabling the button prevent double-booking?**

“It only improves the UI. The database unique index provides the guarantee across all callers and instances.”

**How do you prevent SQL injection?**

“User values are passed through prepared-statement bindings. They are not concatenated into SQL. The optional filter only changes a fixed query fragment.”

**Is the API key a full patient login system?**

“No. It is the shared authentication mechanism required by the assessment. Anyone holding it can use the assessment API, including reset and booking lookup. Production patient access would need individual authentication and authorization.”

**Are duplicate retries prevented?**

“Another booking for an occupied slot gets 409, but that is not idempotency. Level 4 would need to store the idempotency key, request identity, and original response atomically so a retry receives the original status and booking ID.”

**Can a person page through their bookings? What about spam?**

“Those are Levels 4 and 5 and are not implemented. Next I would add cursor pagination and a persistent per-email rate limiter that counts failed attempts and returns Retry-After.”

**Does the app verify email ownership or send confirmation emails?**

“No. It checks basic syntax and displays confirmation on the page. Email verification and delivery are outside this implementation.”

## A short closing explanation

“The main design choice is enforcing booking consistency in the database. The frontend makes the flow simple, the API validates requests, and D1 guarantees that one slot cannot have two confirmed bookings. I tested both ordinary use and overlapping requests, and kept the implemented scope explicit.”
