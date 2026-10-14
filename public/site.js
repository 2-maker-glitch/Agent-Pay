const $=(s)=>document.querySelector(s);
const menu=$('#menu'),nav=$('#nav');
if(menu&&nav)menu.addEventListener('click',()=>{const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',String(open));menu.textContent=open?'Close':'Menu'});
const short=(h,n=10)=>h?h.slice(0,n)+'…'+h.slice(-5):'—';
const META={
  '/v1/chain/stats':'mainnet head block and gas price',
  '/v1/address':'BOT and USDT balance, nonce, contract?',
  '/v1/votes':'on-chain votes and distinct wallets',
  '/v1/bridge/status':'official bridge pause, limits, liquidity'
};
const keyOf=(p)=>Object.keys(META).find(k=>p.startsWith(k));
const withArg=(p)=>p.startsWith('/v1/votes')?p+'/508?hours=6':p.startsWith('/v1/address')?p+'/0xfad8473C54c058b58DF32caDf6415FBa15639682':p.startsWith('/v1/bridge')?p+'?chainId=1':p;
let ROUTES=[];
async function getJSON(url){const r=await fetch(url);if(!r.ok)throw new Error(`${url} returned ${r.status}`);return r.json()}
async function loadConsole(){
  if(!$('.console')||!$('#routes'))return;
  try{
    const [health,pricing]=await Promise.all([getJSON('/health'),getJSON('/v1/pricing')]);
    $('#cNet').textContent=health.network;
    $('#cVault').textContent='vault '+short(health.vault,8);
    if(health.agent)$('#cAgent').textContent='payer '+short(health.agent,8);
    ROUTES=pricing.routes.map(r=>{const path=r.route.replace('GET ','');return{path:withArg(path),price:r.price,desc:META[keyOf(path)]||''}});
    $('#routes').innerHTML=ROUTES.map((r,i)=>`<button class="route" data-i="${i}"><span class="info"><span class="path">${r.path.replace(/^\/v1\//,'/')}</span><span class="desc">${r.desc}</span></span><span class="price">${r.price}</span><span class="go">→</span></button>`).join('');
    document.querySelectorAll('#routes .route').forEach(b=>b.addEventListener('click',()=>runCall(b)));
  }catch(e){$('#routes').innerHTML=`<div class="route"><span class="info"><span class="path">Service unavailable</span><span class="desc">${e.message}</span></span></div>`}
  loadWire();
}
function step(n,state,detail){const s=$('#s'+n);if(!s)return;s.className='step '+state;if(detail!==undefined)$('#d'+n).textContent=detail}
async function runCall(btn){
  const r=ROUTES[Number(btn.dataset.i)];
  document.querySelectorAll('#routes .route').forEach(b=>b.disabled=true);
  $('#settled').classList.remove('on');$('#out').textContent='running…';$('#outLabel').textContent='Response';
  [1,2,3,4].forEach(n=>step(n,'','awaiting'));
  try{
    const t0=performance.now();step(1,'on','GET '+r.path);
    const r1=await fetch(r.path),ch=await r1.json();
    if(r1.status!==402)throw new Error('expected 402, got '+r1.status);
    const a=ch.accepts[0];step(1,'done','GET '+r.path);step(2,'on',a.amountFormatted+' · '+short(a.extra.invoiceId,9));step(2,'done',a.amountFormatted+' required');
    step(3,'on','signing voucher');
    const sg=await getJSON('/v1/demo/sign?route='+encodeURIComponent(r.path)+'&invoiceId='+a.extra.invoiceId+'&expiry='+a.extra.expiry);
    if(sg.error)throw new Error(sg.error);step(3,'done','agent '+short(sg.agent,8)+' · gas 0');
    step(4,'on','submitting to vault');
    const header=btoa(JSON.stringify({x402Version:2,scheme:a.scheme,network:a.network,payload:{agent:sg.agent,payee:sg.payee,amount:sg.amount,invoiceId:sg.invoiceId,expiry:sg.expiry,signature:sg.signature}}));
    const r2=await fetch(r.path,{headers:{'x-payment':header}}),body=await r2.json();
    if(r2.status!==200)throw new Error(body.error||'settlement failed ('+r2.status+')');
    const rc=body.payment,ms=Math.round(performance.now()-t0);step(4,'done','tx '+short(rc.transaction,12)+' · block '+rc.blockNumber);
    $('#sAmt').textContent=rc.amountUsdt;$('#sTx').innerHTML='tx <a href="'+rc.explorer+'" target="_blank" rel="noopener">'+rc.transaction+'</a> · block '+rc.blockNumber+' · '+ms+'ms round trip';$('#settled').classList.add('on');
    $('#outLabel').textContent='Response · live BOT Chain data';$('#out').textContent=JSON.stringify(body.data,null,2);loadWire();
  }catch(e){$('#outLabel').textContent='Failed';$('#out').textContent=String(e.message||e);[1,2,3,4].forEach(n=>{const s=$('#s'+n);if(s&&s.classList.contains('on'))$('#d'+n).textContent='stopped: '+(e.message||e)})}
  finally{document.querySelectorAll('#routes .route').forEach(b=>b.disabled=false)}
}
async function loadWire(){if(!$('#wire'))return;try{const r=await getJSON('/v1/receipts');const rows=Object.entries(r.receipts).reverse().slice(0,8);$('#wire').innerHTML=rows.length?rows.map(([inv,x])=>`<div class="wrow"><span>${x.amountUsdt}</span><span><a href="https://scan.bohr.life/tx/${x.txHash}" target="_blank" rel="noopener">${x.resource}</a></span><span class="t">${new Date(x.at).toISOString().slice(11,19)}</span></div>`).join(''):'<div class="wrow"><span>—</span><span>No settlements yet</span><span></span></div>'}catch(e){$('#wire').innerHTML='<div class="wrow"><span>—</span><span>Receipts temporarily unavailable</span><span></span></div>'}}
loadConsole();
