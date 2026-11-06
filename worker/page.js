/*
 * Serve a self-contained HTML page from the Worker. This template contains
 * markup, styling, and browser JavaScript, so deployment needs no separate
 * frontend bundle or asset server. It calls the API on the same origin.
 */
export const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Stillwell · Clinic appointments</title><style>
:root{font:16px system-ui;color:#163c36;background:#f5f4ed}*{box-sizing:border-box}body{margin:0}header{padding:24px 6%;border-bottom:1px solid #d8ddd3;display:flex;justify-content:space-between}main{max-width:1100px;margin:auto;padding:60px 24px}h1{font:normal clamp(38px,6vw,64px) Georgia;max-width:650px;margin:18px 0}h2{font:normal 28px Georgia}p{line-height:1.6;color:#54665e}.tag{font-size:12px;letter-spacing:2px;text-transform:uppercase}.layout{display:grid;grid-template-columns:1.2fr 1fr;gap:36px;margin-top:40px}.panel{background:white;border:1px solid #dce1d8;border-radius:18px;padding:26px}label{display:block;font-size:14px;margin:16px 0 7px}input,select,button{font:inherit;padding:12px;border-radius:8px;border:1px solid #becdc2;width:100%}button{background:#205b48;color:white;border:0;cursor:pointer;margin-top:16px}button:disabled{opacity:.45;cursor:default}.slot{background:#f4f7f0;color:#163c36;border:1px solid #dce1d8;text-align:left;line-height:1.6}.slot[aria-pressed=true]{outline:2px solid #205b48}.muted{font-size:13px;color:#64776b}#notice{white-space:pre-line;line-height:1.6;margin-top:20px}#notice.error{color:#a62e29}.booking{border-top:1px solid #dde4da;padding:16px 0;overflow-wrap:anywhere}footer{margin-top:50px;font-size:13px;color:#64776b}@media(max-width:720px){.layout{grid-template-columns:1fr}main{padding-top:35px}}</style>
<header><strong>✚ Stillwell Clinic</strong><span class="muted">Care, on your schedule</span></header><main><div class="tag">Your next step to feeling better</div><h1>A little time.<br>A healthier you.</h1><p>Find an appointment that fits your day. Choose a time, share your details,<br>and get your booking confirmation straight away.</p>
<details class="panel"><summary>Connect to the booking API</summary><label for="key">Assessment API key</label><input id="key" type="password" autocomplete="off" placeholder="Enter the supplied API key"><button id="connect">Load appointments</button><p class="muted">The key stays in this tab's memory. Use fictional patient details for this assessment.</p></details>
<div class="layout"><section class="panel"><span class="tag">01 · Choose a time</span><h2>Available appointments</h2><label for="provider">Provider</label><select id="provider"><option value="">All providers</option></select><div id="slots"><p>Connect with your API key to see appointments.</p></div></section>
<section class="panel"><span class="tag">02 · Make it yours</span><h2>Your appointment</h2><p id="selected">Select an appointment to continue.</p><form id="form"><label for="name">Full name</label><input id="name" required autocomplete="name" placeholder="Ada Obi"><label for="email">Email address</label><input id="email" type="email" required autocomplete="email" placeholder="ada@example.com"><button id="book" disabled>Confirm appointment →</button></form><div id="notice" role="status" aria-live="polite"></div></section></div>
<section class="panel" style="margin-top:30px"><h2>Already have a booking?</h2><label for="lookup">Booking reference</label><input id="lookup" placeholder="Paste your booking reference"><button id="find">Look up booking</button><div id="result" aria-live="polite"></div></section><footer>Stillwell Clinic · Appointment booking demo · Times shown in your local timezone</footer></main>
<script>
/*
 * Browser state lives in this tab: the entered API key, latest slots,
 * selected appointment, and an in-flight submission flag. No bookings are
 * stored here; the API database remains the source of truth.
 */
let key='',slots=[],chosen=null,busy=false;
/*
 * Small DOM and date-formatting helpers keep the UI code framework-free.
 * Dates arrive as UTC timestamps and are displayed in the visitor’s local zone.
 */
const $=id=>document.getElementById(id);
const fmt=s=>new Date(s.start).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})+' – '+new Date(s.end).toLocaleTimeString(undefined,{timeStyle:'short'});
/*
 * Send same-origin requests with the assessment key and JSON content type.
 * Convert non-success API responses into exceptions so UI handlers can show
 * the server’s error message. The key is never built into the page source.
 */
async function api(path,method='GET',body){const r=await fetch(path,{method,headers:{'X-API-Key':key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data}
/*
 * Use textContent for messages so patient input and API messages are
 * rendered as text rather than interpreted as executable HTML. The status
 * region in the markup announces updates to assistive technology.
 */
function notice(message,error=false){$('notice').textContent=message;$('notice').className=error?'error':''}
/*
 * Rebuild visible slot buttons using the selected provider filter. Disable
 * booked and past appointments as a UI convenience; the API enforces those
 * rules independently. Selecting a slot updates the summary and enables booking.
 */
function render(){ $('slots').replaceChildren();const visible=slots.filter(s=>!$('provider').value||s.provider===$('provider').value);if(!visible.length)$('slots').textContent='No appointments available. Please check again later.';for(const s of visible){const b=document.createElement('button');b.className='slot';b.textContent=s.provider+' · '+fmt(s)+(!s.available?' · Booked':Date.parse(s.start)<=Date.now()?' · Past':'');b.disabled=!s.available||Date.parse(s.start)<=Date.now();b.setAttribute('aria-pressed',String(chosen?.id===s.id));b.onclick=()=>{chosen=s;$('selected').textContent=s.provider+' · '+fmt(s);$('book').disabled=false;render()};$('slots').append(b)}}
/*
 * Fetch fresh server availability, rebuild the unique provider choices,
 * and render appointments. Preserve the current provider selection when it
 * still exists so refreshes do not unnecessarily reset the visitor’s view.
 */
async function load(){const data=await api('/slots');slots=data.slots;const previous=$('provider').value;$('provider').replaceChildren(new Option('All providers',''),...[...new Set(slots.map(s=>s.provider))].map(p=>new Option(p,p)));$('provider').value=previous;render()}
/*
 * Connecting copies the entered key into tab state and loads appointments.
 * Changing providers filters the already fetched slots locally.
 */
$('connect').onclick=async()=>{key=$('key').value;try{await load();notice('Appointments loaded.')}catch(e){notice(e.message,true)}};$('provider').onchange=render;
/*
 * Prevent normal form navigation and submit the selected slot and details.
 * The busy flag prevents overlapping submissions from this tab; it is not
 * server-side idempotency. On success, display and prefill the booking reference,
 * clear the selection, and refresh availability. Errors are shown to the visitor.
 */
$('form').onsubmit=async e=>{e.preventDefault();if(!chosen||busy)return;busy=true;$('book').disabled=true;try{const b=await api('/bookings','POST',{slot_id:chosen.id,name:$('name').value,email:$('email').value});notice('Appointment confirmed.\\nBooking reference: '+b.id+'\\nSave this reference to look up or cancel your appointment.');$('lookup').value=b.id;chosen=null;$('selected').textContent='Your appointment is confirmed.';await load()}catch(e){notice(e.message,true);$('book').disabled=!chosen;await load().catch(()=>{})}finally{busy=false}};
/*
 * Render lookup results with textContent. Confirmed bookings get a cancel
 * button; successful cancellation redraws the record and refreshes slots.
 * Disable the button while the request runs to discourage accidental repeats.
 */
function show(b){$('result').replaceChildren();const p=document.createElement('p');p.className='booking';p.textContent=b.name+' · '+b.email+' · '+b.status+' · Reference: '+b.id;$('result').append(p);if(b.status==='confirmed'){const cancel=document.createElement('button');cancel.textContent='Cancel this appointment';cancel.onclick=async()=>{cancel.disabled=true;try{show(await api('/bookings/'+encodeURIComponent(b.id),'DELETE'));await load()}catch(e){notice(e.message,true);cancel.disabled=false}};$('result').append(cancel)}}
/*
 * Look up a booking using its saved reference. URL-encode the reference
 * so it stays a single path value, then display the returned record or error.
 */
$('find').onclick=async()=>{try{show(await api('/bookings/'+encodeURIComponent($('lookup').value.trim())))}catch(e){$('result').textContent=e.message}};
</script></html>`;
