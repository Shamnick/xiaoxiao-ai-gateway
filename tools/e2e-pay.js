'use strict';
/** 支付闭环 + 排行榜 端到端 */
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(__dirname, '../logs/e2e'); const PORT = 9966;
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
  const ch=spawn(CHROME,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir=/tmp/ytk-pay-'+Date.now(),'--no-first-run','--disable-gpu','--hide-scrollbars','--window-size=1440,980','--force-device-scale-factor=2','about:blank'],{stdio:'ignore'});
  const errs=[];
  try{
    let cdp=null;
    for(let i=0;i<60&&!cdp;i++){try{const l=await(await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();const p=l.find(t=>t.type==='page');if(p){cdp=new CDP(p.webSocketDebuggerUrl);await cdp.ready();}}catch(e){}if(!cdp)await sleep(250);}
    cdp.on('Runtime.exceptionThrown',p=>errs.push('EXC '+(p.exceptionDetails.exception&&p.exceptionDetails.exception.description||'').slice(0,140)));
    cdp.on('Network.responseReceived',p=>{ if(p.response.status>=400 && !/favicon/.test(p.response.url)) errs.push('HTTP '+p.response.status+' '+p.response.url.slice(0,90)); });
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:980,deviceScaleFactor:2,mobile:false});
    await cdp.send('Page.navigate',{url:'http://127.0.0.1:8849/?page=login'});await sleep(1200);
    await cdp.eval("fetch('/api/user/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'sham',password:'ioioio000'})}).then(r=>r.status)");
    await cdp.send('Page.navigate',{url:'http://127.0.0.1:8849/?page=recharge'});await sleep(2200);
    await cdp.waitFor("!!document.getElementById('ytkRecharge')");
    console.log('  充值面板：已注入');
    await cdp.shot('09-recharge');
    await cdp.eval("document.querySelector('#ytkRecharge [data-amount=\"100\"]').click(); 1");
    await sleep(1500);
    const hasQr=await cdp.eval("!!document.querySelector('#ytkQr canvas, #ytkQr img')");
    console.log('  二维码：'+(hasQr?'已生成':'未生成'));
    await cdp.shot('10-pay-qr');
    const payUrl=await cdp.eval("document.querySelector('#ytkPayOpen') ? document.querySelector('#ytkPayOpen').getAttribute('href') : ''");
    console.log('  收银台：'+payUrl);
    if(payUrl){
      await cdp.send('Page.navigate',{url:'http://127.0.0.1:8849'+payUrl});await sleep(1500);
      await cdp.eval("document.getElementById('payGo').click(); 1");
      await sleep(2600);
      await cdp.shot('11-pay-done');
      const bal = await cdp.eval("fetch('/api/user/me').then(r=>r.json()).then(d=>d.user.balance)");
      console.log('  支付后余额：'+bal);
      if (!(Number(bal) > 2000)) throw new Error('余额未增加：'+bal);
    }
    await cdp.send('Page.navigate',{url:'http://127.0.0.1:8848/leaderboard'});await sleep(1600);
    console.log('  排行榜行数：'+await cdp.eval("document.querySelectorAll('#lbTable tbody tr').length"));
    await cdp.shot('12-leaderboard');
    console.log('\n错误：'+(errs.length?'\n - '+[...new Set(errs)].slice(0,8).join('\n - '):'无'));
  }catch(e){console.error('失败:',e.message);process.exitCode=1;}
  finally{try{ch.kill('SIGKILL');}catch(e){}}
})();
