(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const money=p=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(Number(p||0)/100);
  const date=s=>s?new Date(s).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const badge=s=>`<span class="status ${esc(String(s).toLowerCase())}">${esc((s==='VERIFICATION_PENDING'?'Awaiting bank verification':String(s).replaceAll('_',' ').toLowerCase()))}</span>`;
  const failureStatuses=['FAILED','EXPIRED','CANCELLED','SUSPICIOUS'];
  let pendingOrderId='',payments=[],allocations=[],settings={},timer,toastTimer,activePage='overview',stream,liveTimer,refreshing=false,refreshAgain=false,authenticated=false,sessionVersion=0;
  const pages={overview:['Your business at a glance','Payments, collections and the details that need your attention.'],transactions:['Transactions','Search, inspect and export your payment history.'],failures:['Failed payments','Find unsuccessful attempts and understand their status.'],refunds:['Refunds','Manage full and partial refund requests and transfer records.'],splits:['Split payments','Configure your platform fee and distribute merchant proceeds.'],settlements:['Settlements','Track settlement batches and confirmed bank credits.'],upi:['UPI accounts','Manage where your customer payments are received.'],merchants:['Business profile','Keep your business identity and customer support details up to date.'],api:['Developer tools','Connect your website and receive signed payment events.'],alerts:['Connections & alerts','Monitor bank observation channels and operational alerts.']};
  function toast(message,error=false){ $('toast').textContent=message;$('toast').className='toast'+(error?' error':'');$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000); }
  async function api(path,body,method){
    const version=sessionVersion;
    const res=await fetch('/api/console/'+path,{method:method||(body?'POST':'GET'),headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    let data; try{data=await res.json();}catch{throw new Error('The service returned an unreadable response. Try Refresh data.');}
    if(version!==sessionVersion)throw new Error('Your sign-in session has changed.');
    if(res.status===401){signedOut();throw new Error('Your session has expired. Sign in again.');}
    if(!res.ok) throw new Error(data.error||`Request failed (${res.status})`);
    return data;
  }
  const consoleApi=(p,b)=>api('v1/admin/console/'+p,b);
  const compactNavigation=globalThis.matchMedia?.('(max-width: 960px)')||{matches:false,addEventListener(){}};
  function setMenu(open,focus=false){
    open=Boolean(open&&compactNavigation.matches);
    document.body.classList.toggle('sidebar-open',open);
    $('menuToggle').setAttribute('aria-expanded',String(open));
    $('menuBackdrop').hidden=!open;
    $('merchantNavigation').inert=compactNavigation.matches&&!open;
    $('merchantMain').inert=open;
    if(focus)$(open?'menuClose':'menuToggle').focus();
  }
  compactNavigation.addEventListener('change',()=>setMenu(false));setMenu(false);
  function signedOut(){setMenu(false);authenticated=false;sessionVersion++;refreshAgain=false;clearInterval(timer);clearTimeout(liveTimer);stream?.close();stream=null;$('console').hidden=true;$('loginScreen').hidden=false;$('clientSecret').value='';$('webhookSecret').value='';$('smsPairingQr').replaceChildren();$('gmailClientSecret').value='';$('gmailRefreshToken').value='';}
  function table(target,headers,rows,empty='No records yet. New activity will appear here.'){
    $(target).innerHTML=`<table class="dp-table"><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td class="empty" colspan="${headers.length}">${esc(empty)}</td></tr>`}</tbody></table>`;
    $(target).querySelectorAll?.('tbody tr').forEach(row=>row.querySelectorAll('td').forEach((cell,i)=>{if(!cell.hasAttribute('colspan'))cell.setAttribute('data-label',headers[i]||'');}));
  }
  function paymentRows(list){return list.map(p=>`<tr><td>${p.source==='SESSION'?`<a href="/checkout/${encodeURIComponent(p.id)}" title="Open payment QR and UPI"><strong>${esc(p.orderId)}</strong></a>`:`<strong>${esc(p.orderId)}</strong>`}<small>${esc(p.id.slice(0,12))}</small></td><td>${esc(p.customer||'—')}</td><td><strong>${money(p.amountPaise)}</strong></td><td>${esc(p.method||'UPI')}</td><td>${badge(p.status)}</td><td>${esc(p.utr||'—')}</td><td>${esc(date(p.createdAt))}</td><td><button class="btn small" data-payment-detail="${esc(p.id)}">Details</button>${p.status==='SUCCESS'&&p.method!=='COD'?` <button class="btn small" data-refund="${esc(p.id)}">Refund</button>`:''}</td></tr>`);}
  function renderPayments(){
    const headers=['Order','Customer','Amount','Method','Status','UTR','Created','Actions'];
    const query=$('paymentSearch').value.trim().toLowerCase(),status=$('paymentStatus').value;
    table('recentTable',headers,paymentRows(payments.slice(0,6)),'No payments yet. Create a payment link or accept your first payment.');
    table('paymentTable',headers,paymentRows(payments.filter(p=>(!status||p.status===status)&&[p.orderId,p.customer,p.utr,p.id].join(' ').toLowerCase().includes(query))),'No transactions match these filters.');
    const failures=payments.filter(p=>failureStatuses.includes(p.status));
    $('failureCount').textContent=`${failures.length} attempts`;
    table('failureTable',['Order','Amount','Status','Reason','Created'],failures.map(p=>`<tr><td>${esc(p.orderId)}</td><td>${money(p.amountPaise)}</td><td>${badge(p.status)}</td><td>${esc(p.failureReason||(p.status==='EXPIRED'?'Payment window expired':p.status==='CANCELLED'?'Checkout cancelled':'See payment status'))}</td><td>${esc(date(p.createdAt))}</td></tr>`),'No unsuccessful payments recorded.');
    const selected=$('refundPayment').value;
    $('refundPayment').innerHTML='<option value="">Choose a successful prepaid payment</option>'+payments.filter(p=>p.status==='SUCCESS'&&p.method!=='COD').map(p=>`<option value="${esc(p.id)}">${esc(p.orderId)} · ${money(p.amountPaise)}</option>`).join('');
    $('refundPayment').value=selected;
  }
  async function overview(){
    const [s,p,r,o]=await Promise.all([consoleApi('summary'),consoleApi('payments'),consoleApi('refunds'),consoleApi('operations')]);if(!authenticated)return;payments=p.payments;renderPayments();
    $('operationSummary').innerHTML=[['Callbacks delivered',o.callbacks.delivered],['Callbacks awaiting retry',o.callbacks.pending],['Callbacks needing review',o.callbacks.exhausted],['Unmatched bank observations',o.unmatchedObservations],['Provider confirmations measured',o.providerConfirmation.samples],['Average provider confirmation',o.providerConfirmation.averageMs===null?'No measurements yet':(o.providerConfirmation.averageMs/1000).toFixed(1)+' seconds']].map(([label,value])=>`<div class="summary-line"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
    const awaiting=(r.refunds||[]).filter(refund=>refund.status==='PENDING_MANUAL').length;
    $('dashboardAttention').hidden=!awaiting;
    $('dashboardAttention').innerHTML=awaiting?`<div><strong>${awaiting===1?'A refund needs your attention':awaiting+' refunds need your attention'}</strong><span>Check the request and record the bank transfer when it is complete.</span></div><button class="btn small" data-goto="refunds">Review ${awaiting===1?'refund':'refunds'}</button>`:'';
    $('statVolume').textContent=money(s.collectedPaise);$('statTotal').textContent=s.total.toLocaleString('en-IN');$('statPending').textContent=s.pending;
    const resolved=payments.filter(p=>p.method!=='COD'&&['SUCCESS',...failureStatuses].includes(p.status));
    $('statSuccess').textContent=resolved.length?`${(100*s.paid/resolved.length).toFixed(1)}%`:'—';
    $('activityCount').textContent=`${s.total} transactions`;
    $('activityBreakdown').innerHTML=[['Received',s.paid],['In progress',s.pending],['Unsuccessful',s.failed]].map(([label,count])=>`<div><span>${label}</span><strong>${count}</strong></div>`).join('');
    const dayKey=value=>new Date(value).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
    const days=Array.from({length:7},(_,i)=>{const d=new Date(Date.now()-(6-i)*86400000);return {key:dayKey(d),label:d.toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',weekday:'short'}),amount:0};});
    payments.filter(p=>p.status==='SUCCESS'&&p.method!=='COD').forEach(p=>{const day=days.find(d=>d.key===dayKey(p.completedAt||p.createdAt));if(day)day.amount+=p.amountPaise;});
    const peak=Math.max(...days.map(d=>d.amount),100);
    $('collectionChart').innerHTML='<div class="collection-bars">'+days.map(d=>`<div class="collection-day"><span class="collection-value">${money(d.amount)}</span><div class="collection-track"><div class="collection-fill${d.amount?' has-value':''}" style="height:${d.amount?Math.max(5,d.amount/peak*100):2}%"></div></div><span class="collection-label">${d.label}</span></div>`).join('')+'</div>';
    $('dashboardDate').textContent=new Date().toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',weekday:'long',day:'numeric',month:'long',year:'numeric'});
    $('updated').textContent='Updated '+new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'});
  }
  async function settlements(){
    const [s,list]=await Promise.all([api('v1/settlements/overview'),api('v1/settlements')]);
    $('settlementSummary').innerHTML=[['Bank-confirmed settlements',s.confirmedBankCredit],['Awaiting settlement',s.settlementPending],['Processing fees',s.processingFees]].map(([l,n])=>`<div class="summary-line"><span>${l}</span><strong>${money(Number(n)*100)}</strong></div>`).join('')+'<p class="help">Direct UPI receipts reach your bank. This section shows confirmed settlement records.</p><button class="btn small section-space" data-goto="settlements">View settlements →</button>';
    $('settlementStats').innerHTML=[['Gross ledger collections',s.grossCollections],['Net payable',s.netPayable],['Bank-confirmed settlements',s.confirmedBankCredit],['Awaiting settlement',s.settlementPending]].map(([l,n])=>`<div class="dp-stat-card"><span>${l}</span><strong>${money(Number(n)*100)}</strong></div>`).join('');
    table('settlementTable',['Batch','Gross','Fees','Net','Status','Bank UTR','Created'],list.settlements.map(r=>`<tr><td>${esc(r.settlementId)}</td><td>${money(Number(r.grossAmount)*100)}</td><td>${money(Number(r.feeAmount)*100)}</td><td>${money(Number(r.netAmount)*100)}</td><td>${badge(r.status)}</td><td>${esc(r.bankUtr||'—')}</td><td>${esc(date(r.createdAt))}</td></tr>`),'No settlement batches recorded. Bank confirmation will appear when received.');
  }
  async function loadSettings(){
    settings=await api('v1/admin/merchant-settings');
    $('accountName').textContent=settings.businessName||'Dynamo Pay';$('businessName').value=settings.businessName||'';
    $('contactEmail').value=settings.contactEmail||'';$('contactPhone').value=settings.contactPhone||'';
  }
  async function credentials(){
    const c=await consoleApi('credentials');
    for(const [id,value] of Object.entries({merchantKey:c.merchantId,clientId:c.clientId,clientSecret:c.clientSecret,webhookSecret:c.webhookSecret,webhookUrl:c.webhookUrl}))$(id).value=value||'';
    $('integrationCode').textContent=`<script src="${location.origin}/youpi.js" data-youpi-key="${c.publishableKey}"><\/script>\n<button data-youpi-pay data-order-id="ORDER-1001" data-amount="499.00">\n  Pay with Dynamo Pay\n</button>`;
  }
  async function refunds(){
    const [local,provider]=await Promise.all([consoleApi('refunds'),api('v1/refunds')]);
    const rows=local.refunds.map(r=>`<tr><td><strong>${esc(r.id.slice(0,12))}</strong><small>${esc(payments.find(p=>p.id===r.payment_id)?.orderId||r.payment_id)}</small></td><td>${money(r.amount_paise)}</td><td>${esc(r.reason)}</td><td>${badge(r.status)}</td><td>${esc(r.bank_reference||'—')}</td><td>${esc(date(r.created_at))}</td><td>${r.status==='PENDING_MANUAL'?`<button class="btn small" data-confirm-refund="${esc(r.id)}">Record transfer</button>`:'—'}</td></tr>`);
    rows.push(...(provider.refunds||[]).map(r=>`<tr><td>${esc(r.refundId)}</td><td>${money(Number(r.amount)*100)}</td><td>${esc(r.reason||'—')}</td><td>${badge(r.status)}</td><td>Provider refund</td><td>${esc(date(r.createdAt))}</td><td>—</td></tr>`));
    table('refundTable',['Reference / payment','Amount','Reason','Status','Bank reference','Created','Action'],rows,'No refund requests. Choose a paid transaction above to record one.');
  }
  function addRecipient(r={name:'',vpa:'',shareBps:0}){
    const el=document.createElement('div');el.className='recipient';
    el.innerHTML=`<label class="field">Recipient name<input class="r-name" required maxlength="120" value="${esc(r.name)}" placeholder="Recipient or business"></label><label class="field">UPI ID<input class="r-vpa" required value="${esc(r.vpa)}" placeholder="recipient@bank"></label><label class="field">Share (%)<input class="r-share" required type="number" min="0.01" max="100" step="0.01" value="${r.shareBps/100||''}"></label><button class="btn danger" type="button" data-remove-recipient aria-label="Remove recipient">×</button>`;
    $('recipients').appendChild(el);preview();
  }
  function recipientInputs(){return [...document.querySelectorAll('.recipient')].map(r=>({name:r.querySelector('.r-name').value.trim(),vpa:r.querySelector('.r-vpa').value.trim(),shareBps:Math.round(Number(r.querySelector('.r-share').value)*100)}));}
  function preview(){
    const gross=Math.round(Number($('splitExample').value)*100),taxRate=Number($('gstPercent').value),fee=Math.min(Math.round(gross*Number($('platformFee').value)/100),Math.floor(gross/(1+taxRate/100))),gst=Math.round(fee*taxRate/100),net=gross-fee-gst;
    const recipients=recipientInputs(),total=recipients.reduce((n,r)=>n+r.shareBps,0);
    $('recipientTotal').textContent=recipients.length?`Recipient shares: ${(total/100).toFixed(2)}% of net merchant proceeds`:'No recipients: the merchant retains the net share.';
    $('splitPreview').innerHTML=[['Platform fee',fee],['GST on fee',gst],['Net merchant share',net]].map(([l,n])=>`<div class="summary-line"><span>${l}</span><strong>${money(n)}</strong></div>`).join('');
  }
  async function splits(){
    const c=await consoleApi('splits');$('platformFee').value=c.platformFeeBps/100;$('gstPercent').value=c.gstPercent;$('recipients').replaceChildren();c.recipients.forEach(addRecipient);preview();
    const data=await consoleApi('allocations');allocations=data.allocations;
    table('allocationTable',['Payment','Gross','Platform fee','GST','Recipients / net amounts','Status','Action'],allocations.map(r=>`<tr><td>${esc(payments.find(p=>p.id===r.payment_id)?.orderId||r.payment_id)}</td><td>${money(r.gross_paise)}</td><td>${money(r.fee_paise)}</td><td>${money(r.gst_paise)}</td><td>${r.recipients.map(p=>`${esc(p.name)} · ${money(p.amountPaise)}<small>${esc(p.vpa)}${r.transfers.find(t=>t.recipient_vpa===p.vpa)?' · Ref: '+esc(r.transfers.find(t=>t.recipient_vpa===p.vpa).bank_reference):''}</small>`).join('<br>')}</td><td>${badge(r.status)}</td><td>${r.status==='AWAITING_TRANSFER'?`<button class="btn small" data-transfer="${esc(r.payment_id)}">Record transfer</button>`:'—'}</td></tr>`),'No allocations yet. Saved recipient rules apply to new verified UPI payments.');
  }
  async function upi(){
    const [d,c,r]=await Promise.all([api('v1/admin/upi-accounts'),consoleApi('upi-channel'),consoleApi('payment-rules')]);
    table('paymentRuleTable',['Rule','Target','Reason','Expiry','State','Action'],r.rules.map(rule=>`<tr><td>${esc(rule.ruleType)}</td><td>${esc(rule.targetType)}<small>${esc(rule.target)}</small></td><td>${esc(rule.reason)}</td><td>${esc(date(rule.expiresAt))}</td><td>${badge(rule.active?'ACTIVE':'INACTIVE')}</td><td><button class="btn small" data-rule-id="${esc(rule.id)}" data-rule-active="${!rule.active}">${rule.active?'Disable':'Enable'}</button></td></tr>`),'No acceptance rules. Channel limits still apply.');
    $('upiChannelEnabled').checked=c.enabled;$('upiChannelMin').value=c.minAmountPaise/100;$('upiChannelMax').value=c.maxAmountPaise/100;$('upiChannelVpas').value=(c.allowedVpas||[]).join('\n');
    table('upiTable',['UPI ID','Payee','Status','Payment slot','Action'],d.accounts.map(a=>`<tr><td><strong>${esc(a.upiId)}</strong></td><td>${esc(a.payeeName)}</td><td>${badge(a.isActive?'ACTIVE':'INACTIVE')}</td><td>${a.isSlotBusy?'In use':'Available'}</td><td>${!a.isActive?`<button class="btn small" data-activate-upi="${esc(a.id)}">Activate</button>`:'Current receiving account'}</td></tr>`),'No receiving accounts. Add a valid merchant UPI ID below.');
  }
  async function alerts(){
    const [o,a,g]=await Promise.all([api('v1/admin/observers'),api('v1/operations/alerts'),api('v1/admin/gmail/credentials')]);
    $('gmailClientId').value=g.clientId||'';$('gmailRedirectUri').value=g.redirectUri||'';
    $('gmailConnectionStatus').textContent=g.status==='CONFIGURED'?'Configured'+(g.connectedEmail?' · '+g.connectedEmail:''):'Not connected';
    $('gmailClientSecret').placeholder=g.hasClientSecret?'Saved secret — leave blank to keep it':'Enter Google OAuth client secret';
    $('gmailMessage').textContent=g.connectedEmail?'Linked account: '+g.connectedEmail:(g.clientId&&g.hasClientSecret?'Ready to connect. Click Connect Gmail and choose your bank-alert inbox.':'Platform setup required: open Platform Gmail setup below and save the Google OAuth client once. Then click Connect Gmail.');
    const observers=[{name:'Gmail observer',...o.gmail},{name:'SMS observer',...o.sms},...(o.android?.devices||[])];
    $('observerList').innerHTML=observers.length?observers.map(r=>`<div class="summary-line"><span>${esc(r.type||r.observerType||r.name||r.id)}<small> ${esc(r.lastSeenAt||r.lastHeartbeatAt||'')}</small></span>${badge(r.status||'UNKNOWN')}</div>`).join(''):'<p>No observer heartbeat recorded. Connect the SMS or Gmail observer to verify incoming bank payments.</p>';
    $('alertList').innerHTML=a.alerts.length?a.alerts.map(r=>`<div class="summary-line"><span>${esc(r.message||r.title||r.alert_type)}</span><button class="btn small" data-ack="${esc(r.id)}">Acknowledge</button></div>`).join(''):'<p>No active operational alerts.</p>';
  }
  const loaders={overview:()=>Promise.all([overview(),settlements()]),transactions:overview,failures:overview,refunds:refunds,splits:splits,settlements:settlements,upi:upi,merchants:loadSettings,api:credentials,alerts:alerts};
  async function refresh(){
    if(!authenticated)return;
    if(refreshing){refreshAgain=true;return;}
    refreshing=true;$('refresh').disabled=true;$('loadError').hidden=true;
    try{await loaders[activePage]();}catch(e){if(authenticated){$('loadError').textContent=e.message;$('loadError').hidden=false;}}
    finally{refreshing=false;$('refresh').disabled=false;if(refreshAgain&&authenticated){refreshAgain=false;refresh();}}
  }
  function scheduleRefresh(){
    if(document.hidden||!authenticated)return;
    clearTimeout(liveTimer);liveTimer=setTimeout(()=>refresh(),250);
  }
  function connectStream(){
    stream?.close();
    if(!authenticated||document.hidden)return;
    $('liveStatus').textContent='Refreshes every 20 seconds';
    if(!globalThis.EventSource)return;
    stream=new EventSource('/api/console/v1/admin/console/stream');
    stream.addEventListener('connected',()=>{$('liveStatus').textContent='Live updates connected';scheduleRefresh();});
    stream.addEventListener('activity',scheduleRefresh);
    stream.onerror=()=>{$('liveStatus').textContent='Reconnecting; refreshes every 20 seconds';};
  }
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){stream?.close();stream=null;clearTimeout(liveTimer);}
    else if(authenticated){connectStream();refresh();}
  });
  function navigate(page){
    if(!pages[page])page='overview';activePage=page;
    document.querySelectorAll('.dp-view').forEach(el=>el.hidden=el.id!=='page-'+page);
    document.querySelectorAll('[data-page]').forEach(el=>{el.classList.toggle('active',el.dataset.page===page);if(el.dataset.page===page)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
    $('pageTitle').textContent=pages[page][0];$('pageDescription').textContent=pages[page][1];$('breadcrumb').textContent=pages[page][0];
    history.replaceState(null,'','#'+page);setMenu(false);refresh();
  }
  async function signedIn(){
    authenticated=true;sessionVersion++;$('loginScreen').hidden=true;$('console').hidden=false;
    try{await Promise.all([loadSettings(),overview()]);navigate(location.hash.slice(1)||'overview');}catch(e){$('loadError').textContent=e.message;$('loadError').hidden=false;}
    connectStream();clearInterval(timer);timer=setInterval(()=>{if(!document.hidden&&['overview','transactions','failures','alerts','settlements','refunds','splits'].includes(activePage))refresh();},20000);
  }
  function submit(id,handler){$(id).addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter||$(id).querySelector?.('button[type=submit]');if(button)button.disabled=true;try{await handler();}catch(err){toast(err.message,true);}finally{if(button)button.disabled=false;}});}
  submit('loginForm',async()=>{
    $('loginError').textContent='';const res=await fetch('/api/console/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('loginEmail').value,password:$('loginPassword').value})});
    const data=await res.json();if(!res.ok){$('loginError').textContent=data.error||'Sign in failed.';return;}$('loginPassword').value='';await signedIn();
  });
  submit('paymentRuleForm',async()=>{
    const expiry=$('paymentRuleExpiry').value;
    await consoleApi('payment-rules',{ruleType:$('paymentRuleType').value,targetType:$('paymentRuleTargetType').value,target:$('paymentRuleTarget').value,reason:$('paymentRuleReason').value,expiresAt:expiry?new Date(expiry).toISOString():null});
    $('paymentRuleForm').reset();await upi();toast('Payment acceptance rule saved.');
  });
  submit('ruleStateForm',async()=>{
    await consoleApi('payment-rules/'+encodeURIComponent($('ruleStateId').value)+'/state',{active:$('ruleStateActive').value==='true',reason:$('ruleStateReason').value});$('ruleStateDialog').close();await upi();toast('Rule state saved.');
  });
  submit('paymentForm',async()=>{
    const p=await api('v1/payments',{orderId:pendingOrderId,amount:$('newAmount').value,currency:'INR'});
    const id=p.paymentId||p.id;if(!id)throw new Error('The payment API did not return a payment ID.');
    location.assign('/checkout/'+encodeURIComponent(id));
  });
  submit('refundForm',async()=>{await consoleApi('refunds',{paymentId:$('refundPayment').value,amount:$('refundAmount').value,reason:$('refundReason').value});$('refundAmount').value='';$('refundReason').value='';toast('Refund request recorded. Bank transfer is pending.');await refunds();});
  submit('confirmRefundForm',async()=>{await consoleApi('refunds/'+encodeURIComponent($('confirmRefundId').value)+'/confirm',{bankReference:$('refundBankReference').value});$('confirmRefundDialog').close();toast('Merchant transfer reference recorded.');await refunds();});
  submit('transferForm',async()=>{await consoleApi('allocations/'+encodeURIComponent($('transferPaymentId').value)+'/transfer',{vpa:$('transferRecipient').value,bankReference:$('transferReference').value});$('transferDialog').close();toast('Recipient transfer reference recorded.');await splits();});
  submit('splitForm',async()=>{await consoleApi('splits',{platformFeeBps:Math.round(Number($('platformFee').value)*100),gstPercent:Number($('gstPercent').value),recipients:recipientInputs()});$('splitSaved').textContent='Saved for new verified payments.';toast('Both split settings saved.');});
  submit('merchantForm',async()=>{await api('v1/admin/merchant-settings',{businessName:$('businessName').value,contactEmail:$('contactEmail').value,contactPhone:$('contactPhone').value,branding:{appName:'Dynamo Pay'},supportEmails:[$('contactEmail').value].filter(Boolean),supportMobiles:[$('contactPhone').value].filter(Boolean)});await loadSettings();toast('Merchant details saved.');});
  submit('webhookForm',async()=>{await api('v1/admin/merchant-settings',{webhookUrl:$('webhookUrl').value});toast('Webhook endpoint saved.');await credentials();});
  submit('upiChannelForm',async()=>{await consoleApi('upi-channel',{enabled:$('upiChannelEnabled').checked,minAmountPaise:Math.round(Number($('upiChannelMin').value)*100),maxAmountPaise:Math.round(Number($('upiChannelMax').value)*100),allowedVpas:$('upiChannelVpas').value.split(/[,\n]+/).map(v=>v.trim()).filter(Boolean)});toast('UPI channel settings saved.');});
  submit('upiForm',async()=>{await api('v1/admin/upi-accounts',{upiId:$('upiId').value,payeeName:$('payeeName').value,bankName:$('receivingBankName').value,accountHolderName:$('receivingHolderName').value,accountNumber:$('receivingAccountNumber').value,ifsc:$('receivingIfsc').value});$('upiForm').reset();toast('UPI account added.');await upi();});
  submit('gmailForm',async()=>{
    const body={clientId:$('gmailClientId').value.trim()};
    if($('gmailClientSecret').value.trim())body.clientSecret=$('gmailClientSecret').value.trim();
    if($('gmailRefreshToken').value.trim())body.refreshToken=$('gmailRefreshToken').value.trim();
    await api('v1/admin/gmail/credentials',body);$('gmailClientSecret').value='';$('gmailRefreshToken').value='';await api('v1/admin/gmail/start-observer',{});await alerts();toast('Gmail settings saved.');
  });
  $('connectGmail').addEventListener('click',async()=>{try{const result=await api('v1/admin/gmail/oauth/start');const url=new URL(result.authUrl);if(url.origin!=='https://accounts.google.com')throw new Error('Invalid Google authorization address.');location.assign(url.href);}catch(error){toast(error.message,true);}});
  $('testGmail').addEventListener('click',async()=>{const button=$('testGmail');button.disabled=true;try{const result=await api('v1/admin/gmail/test',{});$('gmailMessage').textContent=result.message||'Gmail connection verified.';toast('Gmail connection test passed.');}catch(error){$('gmailMessage').textContent=error.message;toast(error.message,true);}finally{button.disabled=false;}});
  $('disconnectGmail').addEventListener('click',async()=>{try{await api('v1/admin/gmail/disconnect',{});await alerts();toast('Gmail disconnected.');}catch(error){toast(error.message,true);}});
  $('refresh').addEventListener('click',refresh);$('paymentSearch').addEventListener('input',renderPayments);$('paymentStatus').addEventListener('change',renderPayments);
  $('pairSmsPhone').addEventListener('click',async()=>{
    const button=$('pairSmsPhone');button.disabled=true;
    try{
      const gatewayUrl=$('smsGatewayUrl').value.trim()||location.origin;
      const data=await api('v1/admin/sms-gateway/pair-qr?gatewayUrl='+encodeURIComponent(gatewayUrl));
      $('smsPairingQr').innerHTML=data.pairingQrSvg;
      $('smsPairingQr').querySelector('svg')?.setAttribute('style','width:260px;max-width:100%;height:auto;background:white;padding:16px');
      $('smsPairingMessage').textContent='In the Android observer tap Scan pairing QR. This QR expires after 10 minutes. Only scan it on your own receiving phone.';
    }catch(e){toast(e.message,true);}finally{button.disabled=false;}
  });
  $('splitForm').addEventListener('input',preview);$('splitExample').addEventListener('input',preview);$('addRecipient').addEventListener('click',()=>addRecipient());
  $('menuToggle').addEventListener('click',()=>setMenu($('menuBackdrop').hidden,true));
  $('menuClose').addEventListener('click',()=>setMenu(false,true));
  $('menuBackdrop').addEventListener('click',()=>setMenu(false,true));
  document.addEventListener('keydown',event=>{
    if($('menuBackdrop').hidden)return;
    if(event.key==='Escape'){event.preventDefault();setMenu(false,true);return;}
    if(event.key==='Tab'){
      const items=[...$('merchantNavigation').querySelectorAll('a[href],button:not([disabled])')];
      const first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  $('createPayment').addEventListener('click',()=>{pendingOrderId='ORDER-'+crypto.randomUUID();$('paymentForm').reset();$('paymentResult').hidden=true;$('paymentDialog').showModal();});
  $('manageMerchants')?.addEventListener('click',async()=>{try{await api('v1/admin/platform-session',{});location.assign('/platform#merchants');}catch(e){toast(e.message,true);}});
  $('logout').addEventListener('click',async()=>{await fetch('/api/console/session',{method:'DELETE'});signedOut();});
  document.addEventListener('click',async e=>{
    const el=e.target.closest('button');if(!el)return;
    try{
      if(el.dataset.page)navigate(el.dataset.page);if(el.dataset.goto)navigate(el.dataset.goto);
      if(el.dataset.close)$(el.dataset.close).close();
      if(el.dataset.copy){const source=$(el.dataset.copy);await navigator.clipboard.writeText(source.value||source.textContent);toast('Copied to clipboard.');}
      if(el.dataset.reveal){const input=$(el.dataset.reveal);input.type=input.type==='password'?'text':'password';el.textContent=input.type==='password'?'Show':'Hide';}
      if(el.hasAttribute('data-remove-recipient')){el.closest('.recipient').remove();preview();}
      if(el.dataset.ruleId){$('ruleStateId').value=el.dataset.ruleId;$('ruleStateActive').value=el.dataset.ruleActive;$('ruleStateReason').value='';$('ruleStateDialog').showModal();}
      if(el.dataset.refund){navigate('refunds');$('refundPayment').value=el.dataset.refund;$('refundAmount').focus();}
      if(el.dataset.paymentDetail){
        const p=payments.find(p=>p.id===el.dataset.paymentDetail);
        if(!p)return;
        $('paymentDetails').innerHTML=[['Order ID',p.orderId],['Payment ID',p.id],['Amount',money(p.amountPaise)],['Method',p.method],['Status',p.status],['Customer',p.customer||'—'],['Bank reference',p.utr||'Not supplied'],['Confirmation source',p.confirmationSource?.replaceAll('_',' ')||'Awaiting confirmation'],['Confirmed at',date(p.completedAt)],['Created',date(p.createdAt)]].map(([label,value])=>`<div class="summary-line"><span>${label}</span><strong style="max-width:65%;overflow-wrap:anywhere;text-align:right">${esc(value)}</strong></div>`).join('');
        $('detailsCheckout').hidden=p.source!=='SESSION';$('detailsCheckout').href='/checkout/'+encodeURIComponent(p.id);$('paymentDetailsDialog').showModal();
      }
      if(el.dataset.confirmRefund){$('confirmRefundId').value=el.dataset.confirmRefund;$('refundBankReference').value='';$('confirmRefundDialog').showModal();}
      if(el.dataset.transfer){const allocation=allocations.find(r=>r.payment_id===el.dataset.transfer);$('transferPaymentId').value=el.dataset.transfer;$('transferReference').value='';$('transferRecipient').innerHTML=allocation.recipients.filter(r=>r.amountPaise>0&&!allocation.transfers.some(t=>t.recipient_vpa===r.vpa)).map(r=>`<option value="${esc(r.vpa)}">${esc(r.name)} · ${money(r.amountPaise)} · ${esc(r.vpa)}</option>`).join('');$('transferDialog').showModal();}
      if(el.dataset.activateUpi){el.disabled=true;await api('v1/admin/upi-accounts/'+encodeURIComponent(el.dataset.activateUpi)+'/activate',{});await upi();toast('Receiving account activated.');}
      if(el.dataset.ack){el.disabled=true;await api('v1/operations/alerts/'+encodeURIComponent(el.dataset.ack)+'/ack',{});await alerts();}
    }catch(err){toast(err.message,true);el.disabled=false;}
  });
  $('exportPayments').addEventListener('click',()=>{
    const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
    const csv=[['Order','Payment ID','Amount INR','Method','Status','UTR','Created'],...payments.map(p=>[p.orderId,p.id,(p.amountPaise/100).toFixed(2),p.method,p.status,p.utr,p.createdAt])].map(row=>row.map(cell).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'})),a=document.createElement('a');a.href=url;a.download='dynamo-pay-transactions.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  const paths=['M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z','M4 7h16 M16 3l4 4-4 4 M20 17H4 M8 13l-4 4 4 4','M12 8v5 M12 17h.01 M10 3 2 19h20L14 3z','M9 4 3 10l6 6 M3 10h10a7 7 0 0 1 7 7v3','M12 3v7 M12 10l-7 6 M12 10l7 6 M3 16h4v5H3z M17 16h4v5h-4z','M3 9h18 L12 3z M5 10v8 M12 10v8 M19 10v8 M3 21h18','M3 6h18v13H3z M3 10h18 M6 15h4','M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21v-2a8 8 0 0 1 16 0v2','M14 3a6 6 0 1 0 4 10l4-4-3-3-2 2 M2 22l8-8','M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4'];
  document.querySelectorAll('[data-page]').forEach((el,i)=>el.insertAdjacentHTML('afterbegin',`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[i]}"/></svg>`));
  fetch('/api/console/session').then(r=>{if(r.ok)signedIn();}).catch(()=>{$('loginError').textContent='Console unavailable. Reload to try again.';});
})();
