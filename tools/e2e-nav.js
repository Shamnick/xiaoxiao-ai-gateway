'use strict';
/** 导航点击验证：官网 → 控制台 / Playground / 价格 / 文档 */
const { spawn } = require('child_process');
const fs=require('fs'); const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT=9992; const OUT='/Users/sdnt/Documents/deepseek-harness/default-workspace/clone-ytkj/logs/e2e';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class CDP{constructor(u){this.ws=new WebSocket(u);this.id=0;this.p=new Map();this.h=new Map();
this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const q=this.p.get(m.id);this.p.delete(m.id);m.error?q.reject(new Error(m.error.message)):q.resolve(m.result);}else if(m.method)(this.h.get(m.method)||[]).forEach(f=>f(m.params));});}
ready(){return new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
send(m,p){const id=++this.id;return new Promise((res,rej)=>{this.p.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method:m,params:p||{}}));setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('timeout '+m));}},25000);});}
async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)return 'ERR';return r.result.value;}
async shot(n){const r=await this.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(OUT+'/'+n+'.png',Buffer.from(r.data,'base64'));}
}
(async()=>{
const ch=spawn(CHROME,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir=/tmp/nav'+Date.now(),'--no-first-run','--disable-gpu','--hide-scrollbars','--window-size=1440,900','--force-device-scale-factor=2','about:blank'],{stdio:'ignore'});
try{
let cdp=null;
for(let i=0;i<60&&!cdp;i++){try{const l=await(await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();const p=l.find(t=>t.type==='page');if(p){cdp=new CDP(p.webSocketDebuggerUrl);await cdp.ready();}}catch(e){}if(!cdp)await sleep(250);}
await cdp.send('Page.enable');await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:2,mobile:false});

// 1. 未登录点「控制台」
await cdp.send('Page.navigate',{url:'http://127.0.0.1:8848/'});await sleep(1800);
await cdp.eval("document.querySelector('#navLinks .cta').click(); 1");await sleep(2000);
console.log('未登录点控制台 → '+await cdp.eval('location.href'));

// 2. 登录
await cdp.eval("document.querySelector('input[name=username]').value='sham';document.querySelector('input[name=password]').value='ioioio000';document.querySelector('form[data-auth-pane=pwd] button[type=submit]').click();1");
await sleep(2500);
console.log('登录后 → '+await cdp.eval('location.href'));

// 3. 回官网点 Playground
await cdp.send('Page.navigate',{url:'http://127.0.0.1:8848/'});await sleep(1600);
await cdp.eval("[...document.querySelectorAll('#navLinks a')].find(a=>a.textContent.includes('Playground')).click(); 1");
await sleep(2200);
console.log('点 Playground → '+await cdp.eval('location.href')+' 有模型选项：'+await cdp.eval("document.querySelectorAll('#pfModel option').length"));
await cdp.shot('13-playground');

// 4. 点控制台（已登录）
await cdp.send('Page.navigate',{url:'http://127.0.0.1:8848/'});await sleep(1600);
await cdp.eval("document.querySelector('#navLinks .cta').click(); 1");await sleep(2200);
console.log('已登录点控制台 → '+await cdp.eval('location.href')+' 标题：'+await cdp.eval("document.querySelector('h1') ? document.querySelector('h1').textContent : ''"));

// 5. 价格 / 文档
await cdp.eval("location.href='http://127.0.0.1:8848/pricing'; 1");await sleep(1800);
console.log('价格页行数：'+await cdp.eval("document.querySelectorAll('#pTable tbody tr').length"));
await cdp.eval("location.href='http://127.0.0.1:8848/docs'; 1");await sleep(1600);
console.log('文档页示例模型：'+await cdp.eval("document.getElementById('dModel') ? document.getElementById('dModel').textContent : ''"));
}catch(e){console.error('失败:',e.message);process.exitCode=1;}
finally{try{ch.kill('SIGKILL');}catch(e){}}
})();
