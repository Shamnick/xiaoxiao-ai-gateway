'use strict';
/** 移动端布局检查：横向溢出、侧栏抽屉、表格滚动 */
const { spawn } = require('child_process');
const fs=require('fs'); const path=require('path');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT=path.resolve(__dirname,'../logs/qa'); const PORT=9983;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class CDP{constructor(u){this.ws=new WebSocket(u);this.id=0;this.p=new Map();this.h=new Map();
this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const q=this.p.get(m.id);this.p.delete(m.id);m.error?q.reject(new Error(m.error.message)):q.resolve(m.result);}else if(m.method)(this.h.get(m.method)||[]).forEach(f=>f(m.params));});}
ready(){return new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
send(m,p){const id=++this.id;return new Promise((res,rej)=>{this.p.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method:m,params:p||{}}));setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('timeout '+m));}},25000);});}
async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)return 'ERR';return r.result.value;}
async shot(n){const r=await this.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(path.join(OUT,n+'.png'),Buffer.from(r.data,'base64'));}
}
(async()=>{
fs.mkdirSync(OUT,{recursive:true});
const ch=spawn(CHROME,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir=/tmp/qm'+Date.now(),'--no-first-run','--disable-gpu','--hide-scrollbars','about:blank'],{stdio:'ignore'});
let cdp=null;
for(let i=0;i<60&&!cdp;i++){try{const l=await(await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();const p=l.find(t=>t.type==='page');if(p){cdp=new CDP(p.webSocketDebuggerUrl);await cdp.ready();}}catch(e){}if(!cdp)await sleep(250);}
await cdp.send('Page.enable');await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await cdp.send('Page.navigate',{url:'http://127.0.0.1:8849/?page=login'});await sleep(1000);
await cdp.eval("fetch('/api/user/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'sham',password:'ioioio000'})}).then(r=>r.status)");

for (const [n,u] of [['m-home','http://127.0.0.1:8848/'],['m-models','http://127.0.0.1:8848/?page=models'],['m-pricing','http://127.0.0.1:8848/pricing'],['m-console','http://127.0.0.1:8849/'],['m-keys','http://127.0.0.1:8849/?page=keys']]) {
  await cdp.send('Page.navigate',{url:u}); await sleep(1800);
  const info=await cdp.eval(`(()=>{const d=document.documentElement;
    return JSON.stringify({scrollW:d.scrollWidth, clientW:d.clientWidth, overflow:d.scrollWidth>d.clientWidth+2, h:d.scrollHeight})})()`);
  console.log('  '+n+' '+info);
  await cdp.shot(n);
}
// 后台移动端
await cdp.send('Page.navigate',{url:'http://127.0.0.1:8848/admin/'});await sleep(1400);
await cdp.eval(`(()=>{document.querySelector('#loginUser').value='admin';document.querySelector('#loginPass').value='admin123';
 document.querySelector('#loginForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));return 1;})()`);
await sleep(2500);
const admin=await cdp.eval(`(()=>{const d=document.documentElement;const s=document.querySelector('.side');
 return JSON.stringify({overflow:d.scrollWidth>d.clientWidth+2, sideOpen:s.classList.contains('open')})})()`);
console.log('  m-admin '+admin);
await cdp.eval("document.getElementById('btnMenu').click();1");await sleep(500);
console.log('  抽屉打开: '+await cdp.eval("document.querySelector('.side').classList.contains('open')"));
await cdp.shot('m-admin');
ch.kill('SIGKILL');
})();
