'use strict';
const http = require('http');
const BASE='http://127.0.0.1:8848';
let pass=0, fail=0;
const ok=n=>{pass++;console.log('  ✓ '+n);};
const bad=(n,d)=>{fail++;console.log('  ✗ '+n+' → '+d);};
async function api(p,o){o=o||{};const h={'content-type':'application/json'};if(o.cookie)h.cookie=o.cookie;
 const r=await fetch(BASE+p,{method:o.method||'GET',headers:h,body:o.body?JSON.stringify(o.body):undefined});
 const sc=r.headers.get('set-cookie');let d=null;try{d=await r.json();}catch(e){}
 return {status:r.status,data:d,cookie:sc?sc.split(';')[0]:null};}

function sse(res, events, delay=20){
  res.writeHead(200, {'content-type':'text/event-stream','cache-control':'no-cache'});
  let i=0;
  const t=setInterval(()=>{
    if(i>=events.length){clearInterval(t);res.end();return;}
    res.write(events[i++]);
  }, delay);
}

(async()=>{
  const an = http.createServer((req,res)=>{
    let b='';req.on('data',d=>b+=d);req.on('end',()=>{
      const body=JSON.parse(b||'{}');
      if(!body.stream){ res.writeHead(200,{'content-type':'application/json'});
        return res.end(JSON.stringify({id:'m',content:[{type:'text',text:'非流式'}],usage:{input_tokens:3,output_tokens:2}})); }
      sse(res, [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","usage":{"input_tokens":15}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"，世界"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":8}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]);
    });
  }).listen(7201);
  const gm = http.createServer((req,res)=>{
    let b='';req.on('data',d=>b+=d);req.on('end',()=>{
      sse(res, [
        'data: {"candidates":[{"content":{"parts":[{"text":"Gemini"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":" 流式"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":3}}\n\n',
      ]);
    });
  }).listen(7202);

  try{
    const ck=(await api('/api/admin/login',{method:'POST',body:{username:'admin',password:'admin123'}})).cookie;
    const uk=(await api('/api/user/login',{method:'POST',body:{username:'sham',password:'ioioio000'}})).cookie;
    const key=(await api('/api/user/keys',{cookie:uk,method:'POST',body:{name:'流式协议测试'}})).data.key;
    const mk=async(n,t,b,m)=>(await api('/api/admin/channels',{cookie:ck,method:'POST',body:{name:n,type:t,base_url:b,api_key:'k',models:m,priority:200}})).data.channel.id;
    const id1=await mk('流式Anthropic','anthropic','http://127.0.0.1:7201',['Claude-S']);
    const id2=await mk('流式Gemini','gemini','http://127.0.0.1:7202',['Gemini-S']);

    async function streamCall(model){
      const r=await fetch(BASE+'/v1/chat/completions',{method:'POST',
        headers:{'content-type':'application/json',authorization:'Bearer '+key.key},
        body:JSON.stringify({model,stream:true,messages:[{role:'user',content:'hi'}]})});
      const text=await r.text();
      return {status:r.status, text};
    }

    let r=await streamCall('Claude-S');
    const hasDone=r.text.includes('[DONE]');
    const content=(r.text.match(/"content":"([^"]*)"/g)||[]).join('');
    r.status===200 && r.text.includes('你好') && r.text.includes('，世界') && hasDone
      ? ok('Anthropic SSE → OpenAI SSE 转换（含 [DONE]）') : bad('Anthropic 流式', r.text.slice(0,160));

    r=await streamCall('Gemini-S');
    r.status===200 && r.text.includes('Gemini') && r.text.includes(' 流式')
      ? ok('Gemini SSE → OpenAI SSE 转换') : bad('Gemini 流式', r.text.slice(0,160));

    const logs=await api('/api/user/logs?limit=2',{cookie:uk});
    const items=logs.data.items||[];
    const billed=items.filter(l=>l.stream && l.cost>=0);
    billed.length ? ok('流式调用已计费落库（'+billed.length+' 条）') : bad('流式计费', JSON.stringify(items.slice(0,1)));

    for(const id of [id1,id2]) await api('/api/admin/channels/'+id,{cookie:ck,method:'DELETE'});
    await api('/api/user/keys/'+key.id,{cookie:uk,method:'DELETE'});
  }catch(e){ bad('异常', e.message); }
  finally{ an.close(); gm.close(); }
  console.log('\n通过 '+pass+' / 失败 '+fail);
  process.exit(fail?2:0);
})();
