import fs from 'node:fs';
const tab=(await(await fetch('http://127.0.0.1:9223/json')).json()).find(t=>t.type==='page');const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));});const evalJs=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value;
const a=JSON.parse(fs.readFileSync('data/.secrets/manual-handover.json','utf8'));const login=await fetch('http://127.0.0.1:8080/api/console/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:a.email,password:a.password})});const value=login.headers.get('set-cookie').split(';')[0].split('=')[1];await send('Network.setCookie',{name:'dynamo_session',value,url:'http://127.0.0.1:8080',httpOnly:true});
const results=[];
for(const width of [360,390,768,1024,1440]){
 await send('Emulation.setDeviceMetricsOverride',{width,height:width<640?844:1000,deviceScaleFactor:1,mobile:width<640});
 await send('Page.navigate',{url:'http://127.0.0.1:8080/admin'});await new Promise(r=>setTimeout(r,750));
 for(const page of ['overview','transactions','refunds','splits','upi','merchants','api','alerts']){
  if(width<=960)await evalJs('document.getElementById("menuToggle").click()');
  await evalJs(`document.querySelector('[data-page="${page}"]').click()`);await new Promise(r=>setTimeout(r,180));
  const result=await evalJs(`({width:innerWidth,scroll:document.documentElement.scrollWidth,page:${JSON.stringify(page)},menuClosed:document.getElementById('menuBackdrop').hidden,visibleViews:[...document.querySelectorAll('.dp-view')].filter(x=>!x.hidden).length,error:!document.getElementById('loadError').hidden})`);
  if(result.scroll>width||!result.menuClosed||result.visibleViews!==1||result.error)throw Error(JSON.stringify(result));results.push(result);
  if((width===390||width===1440)&&['overview','transactions','splits'].includes(page)){
   const pic=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`tmp/responsive-${width}-${page}.png`,Buffer.from(pic.data,'base64'));
  }
 }
 if(width<=960){
  await evalJs('document.getElementById("menuToggle").click()');
  await new Promise(r=>setTimeout(r,260));if(width===390){console.log(await evalJs('({drawerLeft:document.getElementById("merchantNavigation").getBoundingClientRect().left,drawerRight:document.getElementById("merchantNavigation").getBoundingClientRect().right})'));const pic=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('tmp/responsive-mobile-menu.png',Buffer.from(pic.data,'base64'));}
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  if(!await evalJs('document.getElementById("menuBackdrop").hidden'))throw Error('Escape did not close drawer');
 }
}
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Page.navigate',{url:'http://127.0.0.1:8080/admin'});await new Promise(r=>setTimeout(r,600));await evalJs('document.getElementById("createPayment").click()');const modal=await evalJs('(()=>{const d=document.getElementById("paymentDialog"),r=d.getBoundingClientRect();return {open:d.open,left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()');if(!modal.open||modal.left<0||modal.right>390||modal.top<0||modal.bottom>844)throw Error(JSON.stringify(modal));await evalJs('document.getElementById("paymentDialog").close()');console.log('Mobile payment dialog bounds: PASS');
console.log(JSON.stringify({checkedViews:results.length,widths:[360,390,768,1024,1440],overflow:0,viewErrors:0,drawerEscape:'PASS'}));ws.close();
