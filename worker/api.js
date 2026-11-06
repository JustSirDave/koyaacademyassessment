/*
 * Shared response helpers keep the assessment contract consistent.
 * API responses are JSON, and no-store prevents caches from serving stale
 * availability or retaining booking details. Errors always contain an error string.
 */
export const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const error = (message, status) => json({ error: message }, status);
const nonempty = (value) =>
  typeof value === "string" && value.trim().length > 0;
/*
 * Handle the assessment API using the database and secret supplied by the host.
 * DB is a persistent Cloudflare D1 binding; it is not an in-memory JavaScript store.
 * The page itself is served separately by index.js.
 */
export async function api(request, env) {
  /*
   * Check authentication before parsing input or touching the database.
   * A missing server secret also denies access, rather than accepting requests.
   * This shared assessment key is not individual patient authentication.
   */
  if (!env.API_KEY || request.headers.get("X-API-Key") !== env.API_KEY)
    return error("unauthorized", 401);
  const url = new URL(request.url),
    path = url.pathname;
  const db = env.DB;
  /*
   * POST /reset is the evaluator’s setup endpoint. Validate the complete slot
   * collection before changing any data. A Set rejects repeated slot IDs;
   * valid start/end dates and a positive appointment duration are required.
   * Past dates are accepted here because the contract explicitly allows them.
   */
  if (path === "/reset" && request.method === "POST") {
    const body = await request.json();
    if (!Array.isArray(body?.slots))
      return error("slots must be an array", 400);
    const ids = new Set();
    for (const slot of body.slots) {
      if (
        !slot ||
        !["id", "provider", "start", "end"].every((k) => nonempty(slot[k])) ||
        !Number.isFinite(Date.parse(slot.start)) ||
        !Number.isFinite(Date.parse(slot.end)) ||
        Date.parse(slot.end) <= Date.parse(slot.start) ||
        ids.has(slot.id)
      )
        return error("invalid or duplicate slot", 400);
      ids.add(slot.id);
    }
    /*
     * D1 batch executes these statements transactionally: either every change
     * succeeds or the batch rolls back. Delete bookings before referenced slots.
     * Bound parameters keep input values out of the SQL source. Normalize timestamps
     * to UTC ISO strings so chronological ordering works across incoming time zones.
     */
    await db.batch([
      db.prepare("DELETE FROM bookings"),
      db.prepare("DELETE FROM slots"),
      ...body.slots.map((s) =>
        db
          .prepare("INSERT INTO slots VALUES (?, ?, ?, ?)")
          .bind(
            s.id,
            s.provider,
            new Date(s.start).toISOString(),
            new Date(s.end).toISOString(),
          ),
      ),
    ]);
    return json({ ok: true });
  }
  /*
   * GET /slots returns every slot, including booked and past appointments.
   * Availability is derived from confirmed bookings instead of a separate mutable
   * flag. Cancellation therefore frees a slot automatically. The optional provider
   * filter is an exact match and remains a bound SQL parameter.
   */
  if (path === "/slots" && request.method === "GET") {
    const provider = url.searchParams.get("provider");
    const query = `SELECT s.*, NOT EXISTS(SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.status='confirmed') AS available FROM slots s ${provider !== null ? "WHERE provider = ?" : ""} ORDER BY start, id`;
    const statement = db.prepare(query);
    const { results } = await (
      provider !== null ? statement.bind(provider) : statement
    ).all();
    return json({
      slots: results.map((s) => ({ ...s, available: !!s.available })),
    });
  }
  /*
   * POST /bookings validates required string fields before database work.
   * Trim the patient name and email, then lowercase the email for consistent storage.
   * The email expression checks basic address syntax; it does not verify ownership.
   */
  if (path === "/bookings" && request.method === "POST") {
    const b = await request.json();
    if (!b || !["slot_id", "name", "email"].every((k) => nonempty(b[k])))
      return error("slot_id, name and email are required", 400);
    const name = b.name.trim(),
      email = b.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return error("invalid email", 400);
    /*
     * Distinguish an unknown slot (404) from a slot that has started (400).
     * These reads provide useful errors; the database constraint below supplies
     * the concurrency guarantee. A read alone cannot safely reserve an appointment.
     */
    const slot = await db
      .prepare("SELECT * FROM slots WHERE id=?")
      .bind(b.slot_id)
      .first();
    if (!slot) return error("slot not found", 404);
    if (Date.parse(slot.start) <= Date.now())
      return error("slot has already started", 400);
    /*
     * Generate a unique booking reference and a server-controlled creation time.
     * The client cannot choose the booking ID, status, or creation timestamp.
     */
    const booking = {
      id: crypto.randomUUID(),
      slot_id: b.slot_id,
      name,
      email,
      status: "confirmed",
      created_at: new Date().toISOString(),
    };
    try {
      /*
       * INSERT ... SELECT rechecks slot existence and start time in the write
       * statement. RETURNING gives us the row actually saved. Most importantly,
       * the schema’s partial UNIQUE index rejects another confirmed booking for
       * the same slot even if requests arrive at different Worker instances together.
       */
      const inserted = await db
        .prepare(
          "INSERT INTO bookings SELECT ?, ?, ?, ?, 'confirmed', ? FROM slots WHERE id=? AND start > ? RETURNING *",
        )
        .bind(
          booking.id,
          booking.slot_id,
          name,
          email,
          booking.created_at,
          b.slot_id,
          booking.created_at,
        )
        .first();
      if (!inserted) return error("slot is no longer available", 400);
      return json(inserted, 201);
      /*
       * Translate only the expected slot uniqueness violation into HTTP 409.
       * Unexpected database failures propagate to the entrypoint’s generic 500 handler
       * instead of being misreported as a booking conflict.
       */
    } catch (e) {
      if (/UNIQUE constraint failed: bookings.slot_id/.test(String(e)))
        return error("slot already booked", 409);
      throw e;
    }
  }
  /*
   * Match one booking reference for GET lookup or DELETE cancellation.
   * Decode the URL segment before binding it as a database value.
   * Unsupported routes and methods fall through to the JSON 404 response.
   */
  const match = path.match(/^\/bookings\/([^/]+)$/);
  if (match && ["GET", "DELETE"].includes(request.method)) {
    const id = decodeURIComponent(match[1]);
    /*
     * Cancel with one conditional UPDATE, rather than a separate check and write.
     * Only a confirmed booking can change state, so concurrent cancellations yield
     * one success and one conflict. Keep the row as a cancelled booking for lookup.
     */
    if (request.method === "DELETE") {
      const booking = await db
        .prepare(
          "UPDATE bookings SET status='cancelled' WHERE id=? AND status='confirmed' RETURNING *",
        )
        .bind(id)
        .first();
      if (booking) return json(booking);
    }
    /*
     * When cancellation changed no row, look up the ID to distinguish a missing
     * booking (404) from an already cancelled booking (409). GET returns either
     * confirmed or cancelled booking details without changing them.
     */
    const booking = await db
      .prepare("SELECT * FROM bookings WHERE id=?")
      .bind(id)
      .first();
    if (!booking) return error("booking not found", 404);
    return request.method === "DELETE"
      ? error("already cancelled", 409)
      : json(booking);
  }
  return error("not found", 404);
}
