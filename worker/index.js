import {api,json} from './api.js';
import {page} from './page.js';
export default {async fetch(request,env){
  if(new URL(request.url).pathname==='/' && request.method==='GET') return new Response(page,{headers:{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'}});
  try{return await api(request,env)}catch(e){if(e instanceof SyntaxError)return json({error:'invalid JSON'},400);console.error(e);return json({error:'internal server error'},500)}
}};
