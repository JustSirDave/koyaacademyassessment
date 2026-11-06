# Four-minute Loom walkthrough

0:00–0:30 — Show deployed URL; enter supplied API key. Explain implemented scope: Levels 1–3.

0:30–1:30 — Select an available appointment, enter a fictional patient's name/email, and confirm. Show booking reference. Reload and look up that reference to demonstrate persistence. Cancel, then show the slot available again.

1:30–2:15 — Show `worker/api.js`: key guard; trim/lowercase normalization; validation, missing slot and past slot errors. Explain reset is the evaluator's way to seed appointments.

2:15–3:15 — Show `drizzle/0000_clinic.sql`: partial unique index guarantees one confirmed booking per slot in the database. Show conditional cancellation update and transactional reset batch.

3:15–4:00 — Run `npm test`, point to the 25-request race and cancellation race. Show public GitHub repository and README. State Levels 4–5 are outside the implemented scope.
