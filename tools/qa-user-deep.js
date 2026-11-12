'use strict';
/** 用户中心深度交互：Key 全生命周期、客服、充值下单、订阅页、全部侧栏页面 */
const { spawn } = require('child_process');
const fs=require('fs'); const path=require('path');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT=path.resolve(__dirname,'../logs/qa'); const PORT=9981;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class CDP{constructor(u){this.ws=new WebSocket(u);this.id=0;this.p=new Map();this.h=new Map();
this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const q=this.p.get(m.id);this.p.delete(m.id);m.error?q.reject(new Error(m.error.message)):q.resolve(m.result);}else if(m.method)(this.h.get(m.method)||[]).forEach(f=>f(m.params));});}
ready(){return new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
on(m,f){if(!this.h.has(m))this.h.set(m,[]);this.h.get(m).push(f);}
send(m,p){const id=++this.id;return new Promise((res,rej)=>{this.p.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method:m,params:p||{}}));setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('timeout '+m));}},30000);});}
async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)return 'ERR '+(r.exceptionDetails.exception&&r.exceptionDetails.exception.description);return r.result.value;}
async waitFor(e,t=12000){const t0=Date.now();while(Date.now()-t0<t){try{if(await this.eval(e))return true;}catch(x){}await sleep(150);}return false;}
async shot(n){const r=await this.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(path.join(OUT,n+'.png'),Buffer.from(r.data,'base64'));}
}
(async()=>{
fs.mkdirSync(OUT,{recursive:true});
const ch=spawn(CHROME,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir=/tmp/qu'+Date.now(),'--no-first-run','--disable-gpu','--hide-scrollbars','--window-size=1440,1000','--force-device-scale-factor=2','about:blank'],{stdio:'ignore'});
const errs=[]; let cur='';
try{
let cdp=null;
for(let i=0;i<60&&!cdp;i++){try{const l=await(await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();const p=l.find(t=>t.type==='page');if(p){cdp=new CDP(p.webSocketDebuggerUrl);await cdp.ready();}}catch(e){}if(!cdp)await sleep(250);}
cdp.on('Runtime.exceptionThrown',p=>errs.push(cur+' EXC '+((p.exceptionDetails.exception&&p.exceptionDetails.exception.description)||'').slice(0,110)));
cdp.on('Runtime.consoleAPICalled',p=>{ if(p.type==='error') errs.push(cur+' console '+p.args.map(a=>a.value||a.description||'').join(' ').slice(0,110)); });
cdp.on('Network.responseReceived',p=>{ if(p.response.status>=400 && !/favicon/.test(p.response.url)) errs.push(cur+' HTTP '+p.response.status+' '+p.response.url.slice(0,80)); });
await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Network.enable');
await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:2,mobile:false});

await cdp.send('Page.navigate',{url:'http://127.0.0.1:8849/?page=login'});await sleep(1200);
await cdp.eval("document.querySelector('input[name=username]').value='sham';document.querySelector('input[name=password]').value='ioioio000';document.querySelector('form[data-auth-pane=pwd] button[type=submit]').click();1");
await sleep(2500);

console.log('=== 侧栏全部页面 ===');
const pages=[['/','控制台'],['/?page=subscription','订阅'],['/?page=keys','Key'],['/?page=billing','账单'],['/?page=recharge','充值'],['/?page=invite','邀请'],['/?page=settings','设置'],['/?page=docs','文档'],['/playground','Playground'],['/usage','用量']];
for(const [u,name] of pages){
  cur=name;
  const before=errs.length;
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:8849'+u});await sleep(1500);
  const txt=await cdp.eval("document.body.innerText.length");
  console.log('  '+(errs.length>before?'⚠':'✓')+' '+name+'（文本 '+txt+'）');
}

console.log('=== Key 全生命周期 ===');
cur='keys';
await cdp.send('Page.navigate',{url:'http://127.0.0.1:8849/?page=keys'});await sleep(1800);
await cdp.waitFor("!!document.getElementById('ytkKeyPanel')");
const n0=await cdp.eval("document.querySelectorAll('#ytkKeyBody .ytk-table tbody tr').length");
await cdp.eval("document.getElementById('ytkKeyNew').click();1");await sleep(500);
await cdp.eval("document.getElementById('ytkNewName').value='QA全流程';document.getElementById('ytkNewOk').click();1");await sleep(1400);
const n1=await cdp.eval("document.querySelectorAll('#ytkKeyBody .ytk-table tbody tr').length");
console.log('  创建前 '+n0+' 行 → 创建后 '+n1+' 行 '+(n1>n0?'✓':'✗'));
await cdp.eval("document.querySelector('#ytkKeyBody [data-act=toggle]').click();1");await sleep(1200);
const offText=await cdp.eval("document.querySelector('#ytkKeyBody .ytk-table tbody tr td:nth-child(5)').textContent");
console.log('  停用后状态列：'+offText);
await cdp.eval("document.querySelector('#ytkKeyBody [data-act=toggle]').click();1");await sleep(1200);

console.log('=== 客服会话 ===');
cur='support';
await cdp.send('Page.navigate',{url:'http://127.0.0.1:8849/'});await sleep(1600);
await cdp.eval("document.getElementById('ytkSupportBtn').click();1");await sleep(500);
await cdp.eval(`(()=>{const nm=document.getElementById('ytkSName'),ip=document.getElementById('ytkSInput');
 nm.value='sham';nm.dispatchEvent(new Event('input'));ip.value='QA 自动化消息';ip.dispatchEvent(new Event('input'));
 document.getElementById('ytkSSend').click();return 1;})()`);
await sleep(1500);
console.log('  消息条数：'+await cdp.eval("document.querySelectorAll('#ytkSBody .ytk-s-msg').length"));

console.log('=== 充值下单 ===');
cur='recharge';
await cdp.send('Page.navigate',{url:'http://127.0.0.1:8849/?page=recharge'});await sleep(1800);
await cdp.waitFor("!!document.getElementById('ytkRecharge')");
await cdp.eval("document.querySelector('#ytkRecharge [data-amount=\"50\"]').click();1");await sleep(1600);
const qr=await cdp.eval("!!document.querySelector('#ytkQr canvas')");
console.log('  二维码：'+(qr?'✓':'✗'));
await cdp.eval("document.querySelector('#ytkPayOpen') && document.querySelector('#ytkPayOpen').getAttribute('href')").then?.(()=>{});
const payUrl=await cdp.eval("document.querySelector('#ytkPayOpen') ? document.querySelector('#ytkPayOpen').getAttribute('href') : ''");
console.log('  收银台链接：'+payUrl);
await cdp.eval("[...document.querySelectorAll('.ytk-modal [data-x]')].forEach(b=>b.click());1");

console.log('=== 订阅页 tab ===');
cur='subscription';
await cdp.send('Page.navigate',{url:'http://127.0.0.1:8849/?page=subscription'});await sleep(1600);
const tabs=await cdp.eval("document.querySelectorAll('.sub-tabs button').length");
for(let i=0;i<Math.min(tabs,3);i++){ await cdp.eval("document.querySelectorAll('.sub-tabs button')["+i+"].click();1"); await sleep(500); }
console.log('  tab 数 '+tabs+'，切换完成');
await cdp.shot('user-qa');

const uniq=[...new Set(errs)];
console.log('\n异常/失败请求：'+(uniq.length?'\n - '+uniq.slice(0,12).join('\n - '):'无'));
process.exitCode=uniq.length?2:0;
}catch(e){console.error('失败:',e.message);process.exitCode=1;}
finally{try{ch.kill('SIGKILL');}catch(e){}}
})();
