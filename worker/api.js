export const json = (body, status = 200) => Response.json(body, {status, headers:{'Cache-Control':'no-store'}});
const error = (message, status) => json({error:message},status);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export async function api(request, env) {
  if (!env.API_KEY || request.headers.get('X-API-Key') !== env.API_KEY) return error('unauthorized',401);
  const url = new URL(request.url), path = url.pathname;
  const db = env.DB;
  if(path === '/reset' && request.method === 'POST') {
    const body = await request.json();
    if(!Array.isArray(body?.slots)) return error('slots must be an array',400);
    const ids = new Set();
    for(const slot of body.slots) {
      if(!slot || !['id','provider','start','end'].every(k=>nonempty(slot[k])) || !Number.isFinite(Date.parse(slot.start)) || !Number.isFinite(Date.parse(slot.end)) || Date.parse(slot.end)<=Date.parse(slot.start) || ids.has(slot.id)) return error('invalid or duplicate slot',400);
      ids.add(slot.id);
    }
    await db.batch([db.prepare('DELETE FROM bookings'), db.prepare('DELETE FROM slots'), ...body.slots.map(s=>db.prepare('INSERT INTO slots VALUES (?, ?, ?, ?)').bind(s.id,s.provider,new Date(s.start).toISOString(),new Date(s.end).toISOString()))]);
    return json({ok:true});
  }
  if(path === '/slots' && request.method === 'GET') {
    const provider = url.searchParams.get('provider');
    const query = `SELECT s.*, NOT EXISTS(SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.status='confirmed') AS available FROM slots s ${provider!==null?'WHERE provider = ?':''} ORDER BY start, id`;
    const statement = db.prepare(query);
    const {results} = await (provider!==null?statement.bind(provider):statement).all();
    return json({slots:results.map(s=>({...s,available:!!s.available}))});
  }
  if(path === '/bookings' && request.method === 'POST') {
    const b = await request.json();
    if(!b || !['slot_id','name','email'].every(k=>nonempty(b[k]))) return error('slot_id, name and email are required',400);
    const name=b.name.trim(), email=b.email.trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('invalid email',400);
    const slot=await db.prepare('SELECT * FROM slots WHERE id=?').bind(b.slot_id).first();
    if(!slot) return error('slot not found',404);
    if(Date.parse(slot.start)<=Date.now()) return error('slot has already started',400);
    const booking={id:crypto.randomUUID(),slot_id:b.slot_id,name,email,status:'confirmed',created_at:new Date().toISOString()};
    try {
      const inserted=await db.prepare("INSERT INTO bookings SELECT ?, ?, ?, ?, 'confirmed', ? FROM slots WHERE id=? AND start > ? RETURNING *").bind(booking.id,booking.slot_id,name,email,booking.created_at,b.slot_id,booking.created_at).first();
      if(!inserted) return error('slot is no longer available',400);
      return json(inserted,201);
    } catch(e) {
      if(/UNIQUE constraint failed: bookings.slot_id/.test(String(e))) return error('slot already booked',409);
      throw e;
    }
  }
  const match=path.match(/^\/bookings\/([^/]+)$/);
  if(match && ['GET','DELETE'].includes(request.method)) {
    const id=decodeURIComponent(match[1]);
    if(request.method==='DELETE') {
      const booking=await db.prepare("UPDATE bookings SET status='cancelled' WHERE id=? AND status='confirmed' RETURNING *").bind(id).first();
      if(booking) return json(booking);
    }
    const booking=await db.prepare('SELECT * FROM bookings WHERE id=?').bind(id).first();
    if(!booking) return error('booking not found',404);
    return request.method==='DELETE'?error('already cancelled',409):json(booking);
  }
  return error('not found',404);
}
