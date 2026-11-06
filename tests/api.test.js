import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
test('Levels 1–3: persistence, validation, concurrency and cancellation',async()=>{
 const mf=new Miniflare({modules:true,scriptPath:'worker/index.js',compatibilityDate:'2026-01-01',d1Databases:['DB'],bindings:{API_KEY:'test-key'}});
 try {
 const db=await mf.getD1Database('DB'); await db.exec((await readFile('drizzle/0000_clinic.sql','utf8')).replaceAll('\n',' '));
 const call=async(path,method='GET',body,key='test-key')=>{const r=await mf.dispatchFetch('http://localhost'+path,{method,headers:{'X-API-Key':key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}};
 assert.equal((await call('/slots','GET',null,'bad')).status,401);
 const slots=[{id:'s1',provider:'Dr Ade',start:'2099-12-10T09:00:00Z',end:'2099-12-10T09:30:00Z'},{id:'past',provider:'Dr Ada',start:'2020-01-01T09:00:00Z',end:'2020-01-01T09:30:00Z'}];
 assert.equal((await call('/reset','POST',{slots})).status,200);
 assert.equal((await call('/slots')).body.slots[0].id,'past');
 assert.equal((await call('/slots?provider=Dr%20Ade')).body.slots.length,1);
 const b={slot_id:'s1',name:' Ada Obi ',email:' ADA@Example.com '};
 assert.equal((await call('/bookings','POST',{...b,email:'bad'})).status,400);
 assert.equal((await call('/bookings','POST',{...b,name:' '})).status,400);
 assert.equal((await call('/bookings','POST',{...b,slot_id:'missing'})).status,404);
 assert.equal((await call('/bookings','POST',{...b,slot_id:'past'})).status,400);
 const race=await Promise.all(Array.from({length:25},()=>call('/bookings','POST',b)));
 assert.equal(race.filter(r=>r.status===201).length,1); assert.equal(race.filter(r=>r.status===409).length,24);
 const booking=race.find(r=>r.status===201).body;
 assert.equal(booking.name,'Ada Obi');assert.equal(booking.email,'ada@example.com');
 assert.deepEqual((await call('/bookings/'+booking.id)).body,booking);
 assert.equal((await call('/slots?provider=Dr%20Ade')).body.slots[0].available,false);
 const cancelled=await Promise.all([call('/bookings/'+booking.id,'DELETE'),call('/bookings/'+booking.id,'DELETE')]);
 assert.deepEqual(cancelled.map(r=>r.status).sort(),[200,409]);
 assert.equal((await call('/slots?provider=Dr%20Ade')).body.slots[0].available,true);
 assert.equal((await call('/bookings','POST',b)).status,201);
 assert.equal((await call('/reset','POST',{slots:[]})).status,200);
 assert.equal((await call('/bookings/'+booking.id)).status,404);
 }finally{await mf.dispose()}
});
