import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
/*
 * Integration test: execute the actual Worker against Miniflare’s local D1
 * runtime. SQL statements and database constraints run for real; the database
 * is not replaced with a mock that simply assumes the expected results.
 */
test("Levels 1–3: persistence, validation, concurrency and cancellation", async () => {
  /*
   * Create an isolated Worker runtime with a test-only key and D1 binding.
   * ES module rules allow the entrypoint to import the API and page modules.
   */
  const mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    scriptPath: "worker/index.js",
    compatibilityDate: "2026-01-01",
    d1Databases: ["DB"],
    bindings: { API_KEY: "test-key" },
  });
  try {
    /*
     * Apply the committed schema to the test database before exercising requests.
     * The helper sends HTTP-shaped requests through the Worker and returns both
     * the response status and parsed JSON for assertions.
     */
    const db = await mf.getD1Database("DB");
    await db.exec(
      (await readFile("drizzle/0000_clinic.sql", "utf8")).replaceAll("\n", " "),
    );
    const call = async (path, method = "GET", body, key = "test-key") => {
      const r = await mf.dispatchFetch("http://localhost" + path, {
        method,
        headers: { "X-API-Key": key, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: await r.json() };
    };
    /*
     * Start with authentication, then seed one future slot and one past slot.
     * Check chronological ordering and exact provider filtering. The fixed future
     * date keeps the happy-path fixture independent of the current year until 2099.
     */
    assert.equal((await call("/slots", "GET", null, "bad")).status, 401);
    const slots = [
      {
        id: "s1",
        provider: "Dr Ade",
        start: "2099-12-10T09:00:00Z",
        end: "2099-12-10T09:30:00Z",
      },
      {
        id: "past",
        provider: "Dr Ada",
        start: "2020-01-01T09:00:00Z",
        end: "2020-01-01T09:30:00Z",
      },
    ];
    assert.equal((await call("/reset", "POST", { slots })).status, 200);
    assert.equal((await call("/slots")).body.slots[0].id, "past");
    assert.equal((await call("/slots?provider=Dr%20Ade")).body.slots.length, 1);
    /*
     * Use mixed case and surrounding spaces to test normalization on success.
     * These rejected attempts cover invalid email, empty name, missing slot,
     * and a slot that has already started.
     */
    const b = { slot_id: "s1", name: " Ada Obi ", email: " ADA@Example.com " };
    assert.equal(
      (await call("/bookings", "POST", { ...b, email: "bad" })).status,
      400,
    );
    assert.equal(
      (await call("/bookings", "POST", { ...b, name: " " })).status,
      400,
    );
    assert.equal(
      (await call("/bookings", "POST", { ...b, slot_id: "missing" })).status,
      404,
    );
    assert.equal(
      (await call("/bookings", "POST", { ...b, slot_id: "past" })).status,
      400,
    );
    /*
     * Launch 25 requests without awaiting them individually. Exactly one must
     * return 201 and the other 24 must return 409. This exercises the database
     * uniqueness guarantee under overlapping requests, not just sequential calls.
     */
    const race = await Promise.all(
      Array.from({ length: 25 }, () => call("/bookings", "POST", b)),
    );
    assert.equal(race.filter((r) => r.status === 201).length, 1);
    assert.equal(race.filter((r) => r.status === 409).length, 24);
    /*
     * Read the winning booking in a separate request to check stored values
     * and cross-request persistence within this runtime. Verify that its slot
     * is now unavailable. This test does not simulate a host restart.
     */
    const booking = race.find((r) => r.status === 201).body;
    assert.equal(booking.name, "Ada Obi");
    assert.equal(booking.email, "ada@example.com");
    assert.deepEqual((await call("/bookings/" + booking.id)).body, booking);
    assert.equal(
      (await call("/slots?provider=Dr%20Ade")).body.slots[0].available,
      false,
    );
    /*
     * Race two cancellation requests: one must succeed and one must conflict.
     * Then confirm availability is restored and another booking can be created.
     * Finally, resetting to an empty slot list must also remove the old bookings.
     */
    const cancelled = await Promise.all([
      call("/bookings/" + booking.id, "DELETE"),
      call("/bookings/" + booking.id, "DELETE"),
    ]);
    assert.deepEqual(cancelled.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (await call("/slots?provider=Dr%20Ade")).body.slots[0].available,
      true,
    );
    assert.equal((await call("/bookings", "POST", b)).status, 201);
    assert.equal((await call("/reset", "POST", { slots: [] })).status, 200);
    assert.equal((await call("/bookings/" + booking.id)).status, 404);
    /*
     * Always stop the local runtime, including after a failed assertion,
     * so the test process releases its resources.
     */
  } finally {
    await mf.dispose();
  }
});
