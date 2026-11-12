'use strict';
/** Playground / 用量页 端到端 */
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(__dirname, '../logs/e2e'); const PORT = 9955;
const sleep = ms => new Promise(r => setTimeout(r, ms));
class CDP { constructor(u){this.ws=new WebSocket(u);this.id=0;this.p=new Map();this.h=new Map();
  this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const q=this.p.get(m.id);this.p.delete(m.id);m.error?q.reject(new Error(m.error.message)):q.resolve(m.result);}else if(m.method)(this.h.get(m.method)||[]).forEach(f=>f(m.params));});}
  ready(){return new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
  on(m,f){if(!this.h.has(m))this.h.set(m,[]);this.h.get(m).push(f);}
  send(m,p){const id=++this.id;return new Promise((res,rej)=>{this.p.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method:m,params:p||{}}));setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('timeout '+m));}},30000);});}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)return 'ERR '+(r.exceptionDetails.exception&&r.exceptionDetails.exception.description);return r.result.value;}
  async waitFor(e,t=15000){const t0=Date.now();while(Date.now()-t0<t){try{if(await this.eval(e))return true;}catch(err){}await sleep(150);}throw new Error('timeout '+e);}
  async shot(n){const r=await this.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(path.join(OUT,n+'.png'),Buffer.from(r.data,'base64'));console.log('  ✓ '+n);}
}
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const chrome=spawn(CHROME,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir=/tmp/ytk-or-'+Date.now(),'--no-first-run','--disable-gpu','--hide-scrollbars','--window-size=1440,980','--force-device-scale-factor=2','about:blank'],{stdio:'ignore'});
  try{
    let cdp=null;
    for(let i=0;i<60&&!cdp;i++){try{const l=await(await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();const p=l.find(t=>t.type==='page');if(p){cdp=new CDP(p.webSocketDebuggerUrl);await cdp.ready();}}catch(e){}if(!cdp)await sleep(250);}
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:980,deviceScaleFactor:2,mobile:false});
    await cdp.send('Page.navigate',{url:'http://127.0.0.1:8849/?page=login'});await sleep(1200);
    await cdp.eval("fetch('/api/user/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'sham',password:'ioioio000'})}).then(r=>r.status)");
    await cdp.send('Page.navigate',{url:'http://127.0.0.1:8849/playground'});await sleep(1800);
    await cdp.waitFor("document.querySelectorAll('#pfModel option').length > 10");
    console.log('  模型数：' + await cdp.eval("document.querySelectorAll('#pfModel option').length"));
    await cdp.eval("document.querySelector('#pfPrompt').value='用一句话介绍你自己';document.querySelector('#pfSend').click();1");
    await cdp.waitFor("document.querySelector('#pfOut').textContent.length > 10", 20000);
    await sleep(800);
    console.log('  输出：' + (await cdp.eval("document.querySelector('#pfOut').textContent")).slice(0, 60));
    console.log('  元信息：' + (await cdp.eval("document.querySelector('#pfMeta').textContent")).slice(0, 90));
    await cdp.shot('07-playground');
    await cdp.send('Page.navigate',{url:'http://127.0.0.1:8849/usage'});await sleep(1600);
    await cdp.waitFor("document.querySelector('#kCalls').textContent !== '—'");
    console.log('  用量：' + await cdp.eval("document.querySelector('#kCalls').textContent + ' 次 / ' + document.querySelector('#kCost').textContent + ' 积分'"));
    await cdp.shot('08-usage');
  }catch(e){console.error('失败:',e.message);process.exitCode=1;}
  finally{try{chrome.kill('SIGKILL');}catch(e){}}
})();
