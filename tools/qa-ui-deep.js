'use strict';
/** 后台深度交互：每个菜单点开全部「编辑/新建」类按钮，校验弹窗与表单，记录异常 */
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(__dirname, '../logs/qa'); const PORT = 9978;
const sleep = ms => new Promise(r => setTimeout(r, ms));
class CDP { constructor(u){this.ws=new WebSocket(u);this.id=0;this.p=new Map();this.h=new Map();
  this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const q=this.p.get(m.id);this.p.delete(m.id);m.error?q.reject(new Error(m.error.message)):q.resolve(m.result);}else if(m.method)(this.h.get(m.method)||[]).forEach(f=>f(m.params));});}
  ready(){return new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
  on(m,f){if(!this.h.has(m))this.h.set(m,[]);this.h.get(m).push(f);}
  send(m,p){const id=++this.id;return new Promise((res,rej)=>{this.p.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method:m,params:p||{}}));setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('timeout '+m));}},30000);});}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)return {__err:(r.exceptionDetails.exception&&r.exceptionDetails.exception.description)||r.exceptionDetails.text};return r.result.value;}
  async shot(n){const r=await this.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(path.join(OUT,n+'.png'),Buffer.from(r.data,'base64'));}
}
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const ch=spawn(CHROME,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir=/tmp/qa'+Date.now(),'--no-first-run','--disable-gpu','--hide-scrollbars','--window-size=1440,1000','about:blank'],{stdio:'ignore'});
  const errs=[]; let cur='';
  try{
    let cdp=null;
    for(let i=0;i<60&&!cdp;i++){try{const l=await(await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();const p=l.find(t=>t.type==='page');if(p){cdp=new CDP(p.webSocketDebuggerUrl);await cdp.ready();}}catch(e){}if(!cdp)await sleep(250);}
    cdp.on('Runtime.exceptionThrown',p=>errs.push(cur+' EXC '+((p.exceptionDetails.exception&&p.exceptionDetails.exception.description)||'').slice(0,120)));
    cdp.on('Runtime.consoleAPICalled',p=>{ if(p.type==='error') errs.push(cur+' console '+p.args.map(a=>a.value||a.description||'').join(' ').slice(0,120)); });
    cdp.on('Network.responseReceived',p=>{ if(p.response.status>=400 && !/favicon/.test(p.response.url)) errs.push(cur+' HTTP '+p.response.status+' '+p.response.url.slice(0,90)); });
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Network.enable');

    await cdp.send('Page.navigate',{url:'http://127.0.0.1:8848/admin/'});await sleep(1200);
    await cdp.eval(`(()=>{document.querySelector('#loginUser').value='admin';document.querySelector('#loginPass').value='admin123';
      document.querySelector('#loginForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));return 1;})()`);
    await sleep(2500);

    const menus=['models','brands','notice','pages','ucPlans','ucPages','ucRedeem','ucProfile','channels','tokens','groups','logs','support','users','orders','tickets','leads','settings','backups','security','audit'];
    const SAFE=/-(edit|new|open|query|check)(-|$)|^ch-check$|^group-(edit|new)$|^token-(quota)$|^uc-plan-edit$|^uc-redeem-new$|^uc-page-pick$/;
    let clicked=0, modals=0;
    for(const m of menus){
      cur=m;
      await cdp.eval("location.hash='#/"+m+"'; 1"); await sleep(1100);
      const acts=await cdp.eval("JSON.stringify([...new Set([...document.querySelectorAll('#content [data-act]')].map(e=>e.dataset.act))])");
      let list=[]; try{ list=JSON.parse(acts);}catch(e){}
      const safe=list.filter(a=>SAFE.test(a) && !/del|delete|toggle|bulk|restore|save|send|close|sup-/.test(a));
      console.log('  ['+m+'] 可点动作: '+(safe.join(', ')||'—'));
      for(const a of safe.slice(0,3)){
        const before=errs.length;
        const r=await cdp.eval(`(()=>{const b=document.querySelector('#content [data-act="${a}"]'); if(!b) return 'none'; b.click(); return 'clicked';})()`);
        if(r==='clicked'){ clicked++; await sleep(600);
          const open=await cdp.eval("!document.querySelector('#modalMask').hidden");
          if(open){ modals++;
            const fields=await cdp.eval("document.querySelectorAll('#modalBody input, #modalBody select, #modalBody textarea').length");
            if(!fields) errs.push(cur+' 弹窗 '+a+' 无表单字段');
            await cdp.eval("document.querySelector('#modalX').click(); 1"); await sleep(250);
          }
        }
        if(errs.length>before) { /* 已记录 */ }
      }
    }
    console.log('\n点击动作 '+clicked+' 次，打开弹窗 '+modals+' 个');
    const uniq=[...new Set(errs)];
    console.log('异常/失败请求：'+(uniq.length?'\n - '+uniq.slice(0,15).join('\n - '):'无'));
    process.exitCode=uniq.length?2:0;
  }catch(e){console.error('失败:',e.message);process.exitCode=1;}
  finally{try{ch.kill('SIGKILL');}catch(e){}}
})();
