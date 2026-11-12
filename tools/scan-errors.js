'use strict';
/** 全站错误扫描：console 异常 + 失败请求 + 404 资源 */
const { spawn } = require('child_process');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9977;
const sleep = ms => new Promise(r => setTimeout(r, ms));
class CDP { constructor(u){this.ws=new WebSocket(u);this.id=0;this.p=new Map();this.h=new Map();
  this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const q=this.p.get(m.id);this.p.delete(m.id);m.error?q.reject(new Error(m.error.message)):q.resolve(m.result);}else if(m.method)(this.h.get(m.method)||[]).forEach(f=>f(m.params));});}
  ready(){return new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
  on(m,f){if(!this.h.has(m))this.h.set(m,[]);this.h.get(m).push(f);}
  send(m,p){const id=++this.id;return new Promise((res,rej)=>{this.p.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method:m,params:p||{}}));setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('timeout '+m));}},25000);});}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)return 'ERR';return r.result.value;}
}
(async()=>{
  const chrome=spawn(CHROME,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir=/tmp/ytk-scan-'+Date.now(),'--no-first-run','--disable-gpu','--hide-scrollbars','--window-size=1440,980','about:blank'],{stdio:'ignore'});
  try{
    let cdp=null;
    for(let i=0;i<60&&!cdp;i++){try{const l=await(await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();const p=l.find(t=>t.type==='page');if(p){cdp=new CDP(p.webSocketDebuggerUrl);await cdp.ready();}}catch(e){}if(!cdp)await sleep(250);}
    const errs=[]; let cur='';
    cdp.on('Runtime.exceptionThrown',p=>errs.push(cur+' EXC '+(p.exceptionDetails.exception&&p.exceptionDetails.exception.description||p.exceptionDetails.text||'').slice(0,160)));
    cdp.on('Runtime.consoleAPICalled',p=>{ if(p.type==='error') errs.push(cur+' console ' + p.args.map(a=>a.value||a.description||'').join(' ').slice(0,140)); });
    cdp.on('Network.responseReceived',p=>{ if(p.response.status>=400 && !/favicon/.test(p.response.url)) errs.push(cur+' HTTP '+p.response.status+' '+p.response.url.slice(0,110)); });
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Network.enable');
    // 登录
    await cdp.send('Page.navigate',{url:'http://127.0.0.1:8849/?page=login'});await sleep(1200);
    await cdp.eval("fetch('/api/user/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'sham',password:'ioioio000'})}).then(r=>r.status)");
    const pages=[
      'http://127.0.0.1:8848/','http://127.0.0.1:8848/?page=models','http://127.0.0.1:8848/?page=terms',
      'http://127.0.0.1:8848/?page=privacy','http://127.0.0.1:8848/?page=refund','http://127.0.0.1:8848/?page=ip',
      'http://127.0.0.1:8849/','http://127.0.0.1:8849/?page=subscription','http://127.0.0.1:8849/?page=keys',
      'http://127.0.0.1:8849/?page=billing','http://127.0.0.1:8849/?page=recharge','http://127.0.0.1:8849/?page=invite',
      'http://127.0.0.1:8849/?page=settings','http://127.0.0.1:8849/?page=docs','http://127.0.0.1:8849/image/',
      'http://127.0.0.1:8849/video/','http://127.0.0.1:8849/playground','http://127.0.0.1:8849/usage',
      'http://127.0.0.1:8848/admin/',
      'http://127.0.0.1:8848/pricing','http://127.0.0.1:8848/docs'
    ];
    for(const u of pages){
      cur=u.replace(/^https?:\/\/127\.0\.0\.1:\d+/,'');
      const before=errs.length;
      await cdp.send('Page.navigate',{url:u});await sleep(1600);
      const n=errs.length-before;
      console.log((n?'⚠ ':'✓ ')+cur.padEnd(28)+ (n?n+' 个问题':''));
    }
    console.log('\n=== 问题清单 ===');
    const uniq=[...new Set(errs)];
    uniq.slice(0,40).forEach(e=>console.log(' - '+e));
    console.log('合计 '+(uniq.length)+' 条');
  }catch(e){console.error('扫描失败:',e.message);process.exitCode=1;}
  finally{try{chrome.kill('SIGKILL');}catch(e){}}
})();
