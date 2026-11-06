CREATE TABLE slots (id TEXT PRIMARY KEY, provider TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL);
CREATE TABLE bookings (id TEXT PRIMARY KEY, slot_id TEXT NOT NULL REFERENCES slots(id), name TEXT NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('confirmed','cancelled')), created_at TEXT NOT NULL);
CREATE UNIQUE INDEX one_confirmed_booking_per_slot ON bookings(slot_id) WHERE status = 'confirmed';
CREATE INDEX bookings_email_created ON bookings(email, created_at, id);
