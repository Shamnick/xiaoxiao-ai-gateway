/* 宇天科技 新版首页脚本②：双互动宠物引擎（独立 IIFE，须在脚本①之后加载）。由交付包内联外置。 */
(function(){
'use strict';
var fxCv=document.getElementById('ytbFx');if(!fxCv)return;
/* 移动端(<=560px)不初始化宠物：CSS 已 display:none，这里再跳过 JS/rAF，省 CPU 与电量。
   仅首次加载判定；旋屏/缩放跨越阈值不动态出现（宠物为非核心装饰，无需实时切换）。 */
if(window.matchMedia&&window.matchMedia('(max-width:560px)').matches)return;
var fx=fxCv.getContext('2d');
function clamp(v,a,b){return v<a?a:(v>b?b:v)}
function rand(a,b){return a+Math.random()*(b-a)}
function easeIO(t){return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2}
var W=window.innerWidth,H=window.innerHeight,DPR=Math.min(window.devicePixelRatio||1,2);
function fit(){
  W=window.innerWidth;H=window.innerHeight;
  fxCv.width=Math.round(W*DPR);fxCv.height=Math.round(H*DPR);
  fxCv.style.width=W+'px';fxCv.style.height=H+'px';
  fx.setTransform(DPR,0,0,DPR,0,0);
}
fit();
/* 顶部两个"座位"：紧挨品牌 LOGO 右侧 */
var logoEl=document.querySelector('.logo');
var perches=[{x:130,y:40},{x:196,y:40}];
function computePerches(){
  if(!logoEl)return;
  var r=logoEl.getBoundingClientRect();
  var cy=r.top+r.height/2+10;
  perches[0].x=r.right+46;perches[0].y=cy;
  perches[1].x=r.right+112;perches[1].y=cy;
}
computePerches();
/* 页面锚点：用于触发板块台词 */
var SEC=['#home','#models','#about','#ability','#security','#contact'];
var wpEls=SEC.map(function(s){return document.querySelector(s)});
var anchors=[];
function computeAnchors(){
  var sy=window.scrollY;
  anchors=wpEls.map(function(el){return el.getBoundingClientRect().top+sy});
}
computeAnchors();
function pathF(){
  var sy=window.scrollY+H*0.42,last=anchors.length-1;
  if(sy<=anchors[0])return 0;
  if(sy>=anchors[last])return last;
  var k=0;
  while(k<last-1&&sy>=anchors[k+1])k++;
  var span=Math.max(1,anchors[k+1]-anchors[k]);
  return k+clamp((sy-anchors[k])/span,0,1);
}
/* 首屏引导，和 hero 里的主按钮呼应：出场打完招呼、回到首屏时，
   先说一句按时段轮换的台词（slotMsg），再说这句 */
var PROMO_MSG='想无限用全站模型？点粉色按钮，限时最低6折！';
var CRAB_MSGS=[
  '你好！我是小蟹 Clawd，本班巡航由我负责 🦀',
  '99.9% 稳定性目标——这是推理 10⁶ 次后的答案 🧠',
  '记忆库检索完毕：使命 · 愿景 · 价值观，全部加载 ◈',
  '四大核心能力挂载成功，推理延迟仅 12ms！',
  '防火墙巡逻中… 0 threats detected 🔐',
  '想合作？点右下角「在线客服」，我帮你接通商务神经元 🚀'
];
var ROBO_MSGS=[
  '机体上线！小宇接管巡航，各系统绿灯 ⚡',
  '实测 SLA 99.9%，此指标已写入固件 ✔',
  '档案调取完成：使命 · 愿景 · 价值观 ◈',
  '四大核心能力模块自检通过，功率充沛！',
  '安全协议 TLS1.3 全程护航，零威胁 🔐',
  '合作请点右下角「在线客服」，商务链路即刻接通 🚀'
];
var mx=W/2,my=H*.4,lastScrollAt=-1e9;
var trails=[],stars=[],MAXT=110,MAXS=140;
function starPath(c,x,y,r,rot){
  c.beginPath();
  for(var i=0;i<10;i++){
    var rr=(i%2)?r*.45:r,a=rot+i*Math.PI/5;
    var qx=x+Math.cos(a)*rr,qy=y+Math.sin(a)*rr;
    if(i)c.lineTo(qx,qy);else c.moveTo(qx,qy);
  }
  c.closePath();
}
function burst(x,y,n,scale,cA,cB){
  for(var i=0;i<n;i++){
    if(stars.length>=MAXS)break;
    var a=rand(0,6.28),sp=rand(1.5,5.5)*scale;
    stars.push({
      x:x,y:y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-rand(.5,2)*scale,
      r:rand(3,8)*scale,rot:rand(0,6.28),vr:rand(-.2,.2),
      life:1,dec:rand(.012,.026),
      c:Math.random()<.5?cA:(Math.random()<.6?cB:'#fff7ed')
    });
  }
}
/* ---------- 宠物工厂 ---------- */
function makePet(id,opts){
  var root=document.getElementById(id);
  if(!root)return null;
  var pet={
    root:root,
    svg:root.querySelector('svg'),
    eyesN:root.querySelector('.ytb-eyes-n'),
    blinkG:root.querySelector('.ytb-blink'),
    bubble:root.querySelector('.ytb-bubble'),
    bubbleText:root.querySelector('.ytb-bubble span'),
    hud:root.querySelector('.ytb-hud'),
    perchIdx:opts.perchIdx,eyeCY:opts.eyeCY,
    msgs:opts.msgs,hiMsg:opts.hiMsg,sitMsg:opts.sitMsg,
    grabMsg:opts.grabMsg,dropMsg:opts.dropMsg,throwMsg:opts.throwMsg,
    dizzyMsg:opts.dizzyMsg,flipMsg:opts.flipMsg,wakeMsg:opts.wakeMsg,
    hudIco:opts.hudIco,trailA:opts.trailA,trailB:opts.trailB,
    px:perches[opts.perchIdx].x,py:perches[opts.perchIdx].y,
    prevX:0,prevY:0,sc:.42,sitting:true,
    typeTimer:0,hideTimer:0
  };
  pet.prevX=pet.px;pet.prevY=pet.py;
  root.classList.add('is-perch','is-sit');
  return pet;
}
function showBubble(pet,text){
  clearInterval(pet.typeTimer);clearTimeout(pet.hideTimer);
  pet.bubble.classList.remove('left','right');
  pet.bubble.classList.add(pet.px<W/2?'right':'left');
  pet.bubble.classList.add('show','typing');
  pet.bubbleText.textContent='';
  var i=0;
  pet.typeTimer=setInterval(function(){
    i++;
    pet.bubbleText.textContent=text.slice(0,i);
    if(i>=text.length){
      clearInterval(pet.typeTimer);
      pet.bubble.classList.remove('typing');
      pet.hideTimer=setTimeout(function(){hideBubble(pet)},3800);
    }
  },42);
}
function hideBubble(pet){
  clearInterval(pet.typeTimer);clearTimeout(pet.hideTimer);
  pet.bubble.classList.remove('show','typing');
}
var crab=makePet('ytbBot',{
  perchIdx:0,eyeCY:66,msgs:CRAB_MSGS,hudIco:'🧠',
  hiMsg:'该我巡航啦！小蟹 Clawd 出勤 🦀',
  sitMsg:'换班咯～我上去坐会儿，钳子放假 🦀',
  grabMsg:'唔哇！被抓住啦，快放我下来～(>﹏<)',
  dropMsg:'呼…降落成功，那我就在这待着啦 🦀',
  throwMsg:'哇啊啊啊——🦀💨',
  dizzyMsg:'转…转晕了 @_@ 蟹生第一次坐过山车',
  flipMsg:'后空翻！全脑放电风暴成功 ✨',
  wakeMsg:'哇！我醒啦，神经元重新上线 (>ᴗ<)',
  trailA:'#f97316',trailB:'#fbbf24'
});
var robo=makePet('ytbBot2',{
  perchIdx:1,eyeCY:47,msgs:ROBO_MSGS,hudIco:'🤖',
  hiMsg:'机体接管巡航！各系统绿灯 ⚡',
  sitMsg:'交接完成，我回充电位坐着待命 ⚡',
  grabMsg:'警报！机体被外力捕获 ⚠ 请放开我～',
  dropMsg:'姿态稳定，悬停于此 ✔',
  throwMsg:'离心过载！陀螺仪要坏啦——⚠',
  dizzyMsg:'陀螺仪紊乱中… @_@ 正在重新校准',
  flipMsg:'空翻机动完成，姿态评分 100 ✨',
  wakeMsg:'休眠解除，重新上线 ⚡',
  trailA:'#22d3ee',trailB:'#ff4df6'
});
var pets=[crab,robo].filter(Boolean);
/* ---------- 活跃宠物引擎（同一时间只有一只在下面） ---------- */
var act=null;
var state='perch',launchAt=performance.now()+1000;
var wx=W*.6,wy=H*.5,nextWanderAt=0;
function pickWander(now){
  wx=rand(120,W-120);
  wy=rand(160,H-180);
  nextWanderAt=now+1300;
}
var grabbed=false,dragMoved=false,gx=0,gy=0,grabDX=0,grabDY=0,hist=[];
var thrown=false,tvx=0,tvy=0,spin=0;
var sleeping=false,lastActive=performance.now(),happyUntil=0;
var flipping=false,flipStart=0,blinkStart=0,nextBlink=performance.now()+2200;
var lastIdx=0,pendT=0,promoT=0,promoQueue=[];
/* 按访客本地时段轮换的引导台词，每轮先说时段这句，再说 PROMO_MSG */
function slotMsg(){
  var h=new Date().getHours();
  if(h>=23||h<5)return '熬夜写代码？全站模型随时可用';
  if(h<9)return '早起写代码？充点积分，一整天都够用';
  if(h<12)return '上午效率拉满，全站模型随便调';
  if(h<14)return '午休让 Agent 接着跑，额度还够用';
  if(h<18)return '下午赶需求？积分额度提前充好';
  return '下班继续肝项目？全站模型随时可用';
}
function promoLater(ms){
  clearTimeout(promoT);
  promoT=setTimeout(function(){
    if(!(act&&!sleeping&&!grabbed&&!thrown&&lastIdx===0))return;
    if(!promoQueue.length)promoQueue=[slotMsg(),PROMO_MSG];
    showBubble(act,promoQueue.shift());
    if(promoQueue.length)promoLater(5200);
  },ms);
}
function setActive(pet,now){
  act=pet;
  pet.sitting=false;
  pet.root.classList.remove('is-perch','is-sit','is-grab','is-sleep','is-dizzy');
  grabbed=false;thrown=false;flipping=false;sleeping=false;spin=0;
  lastActive=now;happyUntil=now+1800;
  pickWander(now);
  burst(pet.px,pet.py,18,.85,pet.trailA,pet.trailB);
  showBubble(pet,pet.hiMsg);
  promoLater(5200);
}
function sitDown(pet){
  pet.sitting=true;
  pet.root.classList.add('is-perch','is-sit');
  pet.root.classList.remove('is-grab','is-sleep','is-dizzy','is-happy');
  showBubble(pet,pet.sitMsg);
}
function swapTo(pet){
  if(act===pet)return;
  var now=performance.now();
  if(act)sitDown(act);
  setActive(pet,now);
}
function goSleep(){
  if(sleeping||!act)return;
  sleeping=true;
  act.root.classList.add('is-sleep');
  act.root.classList.remove('is-happy');
  hideBubble(act);
}
function wake(){
  lastActive=performance.now();
  if(sleeping&&act){
    sleeping=false;
    act.root.classList.remove('is-sleep');
    happyUntil=performance.now()+1800;
    showBubble(act,act.wakeMsg);
  }
}
document.addEventListener('mousemove',function(e){mx=e.clientX;my=e.clientY;wake()},{passive:true});
window.addEventListener('scroll',function(){lastScrollAt=performance.now();wake()},{passive:true});
document.addEventListener('keydown',wake);
document.addEventListener('touchstart',function(e){
  if(e.touches&&e.touches[0]){mx=e.touches[0].clientX;my=e.touches[0].clientY}
  wake();
},{passive:true});
/* ---------- 每只宠物的抓取 / 甩抛 / 点击 ---------- */
pets.forEach(function(pet){
  var sv=pet.svg;
  sv.addEventListener('pointerdown',function(e){
    e.stopPropagation();e.preventDefault();
    wake();
    if(pet.sitting||state==='perch')return;
    if(act!==pet)return;
    grabbed=true;dragMoved=false;thrown=false;
    pet.root.classList.remove('is-dizzy');
    gx=e.clientX;gy=e.clientY;
    grabDX=pet.px-gx;grabDY=pet.py-gy;
    hist=[{x:gx,y:gy,t:performance.now()}];
    pet.root.classList.add('is-grab');
    try{sv.setPointerCapture(e.pointerId)}catch(_){}
    showBubble(pet,pet.grabMsg);
  });
  sv.addEventListener('pointermove',function(e){
    if(!grabbed||act!==pet)return;
    if(Math.abs(e.clientX-gx)+Math.abs(e.clientY-gy)>6)dragMoved=true;
    gx=e.clientX;gy=e.clientY;
    mx=gx;my=gy;
    hist.push({x:gx,y:gy,t:performance.now()});
    if(hist.length>7)hist.shift();
    wake();
  });
  function release(){
    if(!grabbed||act!==pet)return;
    grabbed=false;
    pet.root.classList.remove('is-grab');
    var now=performance.now();
    /* 甩出判定：按最近轨迹估算释放速度 */
    var vx=0,vy=0;
    if(hist.length>1){
      var a=hist[0],b=hist[hist.length-1],dt=Math.max(16,b.t-a.t);
      vx=(b.x-a.x)/dt*16.7;
      vy=(b.y-a.y)/dt*16.7;
    }
    var sp=Math.sqrt(vx*vx+vy*vy);
    if(sp>13){
      thrown=true;
      tvx=clamp(vx*1.15,-52,52);
      tvy=clamp(vy*1.15,-52,52);
      pet.root.classList.add('is-dizzy');
      hideBubble(pet);
    }else{
      wx=pet.px;wy=pet.py;nextWanderAt=now+800;
      if(dragMoved){
        happyUntil=now+1600;
        showBubble(pet,pet.dropMsg);
      }
    }
  }
  sv.addEventListener('pointerup',release);
  sv.addEventListener('pointercancel',release);
  sv.addEventListener('click',function(e){
    e.stopPropagation();
    wake();
    if(pet.sitting){swapTo(pet);return}
    if(act!==pet)return;
    if(dragMoved){dragMoved=false;return}
    if(thrown||flipping)return;
    flipping=true;flipStart=performance.now();
    burst(pet.px,pet.py,22,1,pet.trailA,pet.trailB);
    happyUntil=performance.now()+2000;
    showBubble(pet,pet.flipMsg);
  });
});
/* HUD 假数据跳动 */
setInterval(function(){
  pets.forEach(function(pet){
    if(!pet.hud)return;
    if(act===pet&&sleeping){
      pet.hud.innerHTML='<span>😴 <b>休眠</b></span><span>⚡ <b>--</b></span>';
    }else{
      pet.hud.innerHTML='<span>'+pet.hudIco+' <b>'+Math.round(rand(90,99))+'%</b></span><span>⚡ <b>'+Math.round(rand(8,24))+'ms</b></span>';
    }
  });
},900);
/* ---------- 主循环 ---------- */
function frame(now){
  if(!crab||!crab.root.offsetWidth){requestAnimationFrame(frame);return}
  computePerches();
  if(state==='perch'&&now>=launchAt){
    state='fly';
    setActive(crab,now);
  }
  if(act&&!sleeping&&!grabbed&&!thrown&&now-lastActive>10000)goSleep();
  var f=pathF();
  var idx=clamp(Math.round(f),0,SEC.length-1);
  if(act&&state!=='perch'&&idx!==lastIdx){
    lastIdx=idx;
    clearTimeout(pendT);
    pendT=setTimeout(function(){
      if(act&&!sleeping&&!grabbed&&!thrown){
        showBubble(act,act.msgs[idx]);
        if(idx===0)promoLater(5200);
      }
    },500);
  }
  pets.forEach(function(pet){
    var isAct=(act===pet&&state!=='perch');
    var tx,ty,ease=.028,scT;
    if(!isAct){
      var pp=perches[pet.perchIdx];
      tx=pp.x;ty=pp.y;ease=.14;scT=.42;
    }else{
      scT=1;
      if(grabbed){
        tx=clamp(gx+grabDX,60,W-60);
        ty=clamp(gy+grabDY,80,H-90);
        ease=.42;
      }else if(thrown){
        /* 抛掷物理：重力 + 边缘弹跳 + 旋转 */
        pet.px+=tvx;pet.py+=tvy;
        tvy+=.55;tvx*=.996;
        spin+=tvx*.55;
        var bounced=false;
        if(pet.px<60){pet.px=60;tvx=-tvx*.55;bounced=true}
        if(pet.px>W-60){pet.px=W-60;tvx=-tvx*.55;bounced=true}
        if(pet.py<80){pet.py=80;tvy=-tvy*.5;bounced=true}
        if(pet.py>H-95){pet.py=H-95;tvy=-tvy*.55;tvx*=.85;bounced=true}
        if(bounced)burst(pet.px,pet.py,9,.7,pet.trailA,pet.trailB);
        if(Math.abs(tvx)+Math.abs(tvy)<2.4&&pet.py>H-150){
          thrown=false;
          wx=pet.px;wy=pet.py;nextWanderAt=now+1200;
          setTimeout(function(){pet.root.classList.remove('is-dizzy')},1700);
        }
        tx=pet.px;ty=pet.py;
      }else{
        var scrolling=now-lastScrollAt<320;
        if(!sleeping&&scrolling&&now>=nextWanderAt)pickWander(now);
        if(sleeping){tx=pet.px;ty=pet.py}
        else{tx=wx;ty=wy}
      }
    }
    if(!(isAct&&thrown)){
      pet.px+=(tx-pet.px)*ease;
      pet.py+=(ty-pet.py)*ease;
    }
    pet.sc+=(scT-pet.sc)*.08;
    var vx=pet.px-pet.prevX,vy=pet.py-pet.prevY;
    var speed=Math.sqrt(vx*vx+vy*vy);
    pet.prevX=pet.px;pet.prevY=pet.py;
    var flipRot=0;
    if(isAct&&flipping){
      var ft=(now-flipStart)/900;
      if(ft>=1){flipping=false}
      else{flipRot=-360*easeIO(ft)}
    }
    var happy=isAct&&!sleeping&&!grabbed&&!thrown&&
      (Math.sqrt((mx-pet.px)*(mx-pet.px)+(my-pet.py)*(my-pet.py))<150||now<happyUntil);
    pet.root.classList.toggle('is-happy',happy);
    var wobble=happy?Math.sin(now/95)*5.5:0;
    var struggle=(isAct&&grabbed)?Math.sin(now/45)*7:0;
    var spinR=0;
    if(isAct){
      if(!thrown)spin*=.9;
      spinR=spin;
    }
    var tilt=clamp(vx*2.1,-26,26);
    var bob;
    if(!isAct)bob=Math.sin(now/700)*1.5;
    else if(grabbed)bob=0;
    else bob=Math.sin(now/(sleeping?900:540))*(sleeping?4:8);
    pet.root.style.transform='translate3d('+pet.px.toFixed(1)+'px,'+(pet.py+bob).toFixed(1)+'px,0) rotate('+(tilt+wobble+flipRot+struggle+spinR).toFixed(1)+'deg) scale('+pet.sc.toFixed(3)+')';
    if(isAct){
      var ang=Math.atan2(my-pet.py,mx-pet.px);
      pet.eyesN.setAttribute('transform','translate('+(Math.cos(ang)*4.2).toFixed(2)+' '+(Math.sin(ang)*3.2).toFixed(2)+')');
      if(!sleeping&&now>nextBlink){blinkStart=now;nextBlink=now+(happy?900:2000)+Math.random()*2800}
      var b=1;
      if(blinkStart){
        var q=(now-blinkStart)/240;
        if(q>=1)blinkStart=0;
        else b=Math.max(.06,q<.5?1-q*2:(q-.5)*2);
      }
      pet.blinkG.setAttribute('transform','translate(0 '+(pet.eyeCY*(1-b)).toFixed(2)+') scale(1 '+b.toFixed(3)+')');
      if(!sleeping&&speed>1.4&&trails.length<MAXT){
        var rad=(tilt+wobble+flipRot)*Math.PI/180;
        var d=pet.root.offsetHeight*.42*pet.sc;
        trails.push({
          x:pet.px-d*Math.sin(rad),y:pet.py+bob+d*Math.cos(rad),
          vx:-vx*.35+rand(-.5,.5),vy:-vy*.35+rand(.3,1.4),
          r:rand(2,5),life:1,dec:rand(.02,.045),
          c:Math.random()<.55?pet.trailA:pet.trailB
        });
      }
    }else{
      pet.eyesN.setAttribute('transform','translate(0 0)');
      pet.blinkG.setAttribute('transform','translate(0 0)');
    }
  });
  fx.clearRect(0,0,W,H);
  var i,p;
  for(i=trails.length-1;i>=0;i--){
    p=trails[i];
    p.x+=p.vx;p.y+=p.vy;p.life-=p.dec;
    if(p.life<=0){trails.splice(i,1);continue}
    fx.globalAlpha=p.life*.85;
    fx.fillStyle=p.c;
    fx.beginPath();fx.arc(p.x,p.y,p.r*p.life,0,6.28);fx.fill();
  }
  for(i=stars.length-1;i>=0;i--){
    var st=stars[i];
    st.x+=st.vx;st.y+=st.vy;st.vy+=.11;st.rot+=st.vr;st.life-=st.dec;
    if(st.life<=0){stars.splice(i,1);continue}
    fx.globalAlpha=st.life;
    fx.fillStyle=st.c;
    starPath(fx,st.x,st.y,st.r*(.5+st.life*.5),st.rot);
    fx.fill();
  }
  fx.globalAlpha=1;
  requestAnimationFrame(frame);
}
var rsT2=0;
window.addEventListener('resize',function(){
  clearTimeout(rsT2);
  rsT2=setTimeout(function(){fit();computeAnchors();computePerches()},180);
});
window.addEventListener('load',computeAnchors);
/* 首屏优先：宠物是装饰，推迟到首屏渲染完成后再启动动画循环，避免和粒子背景/首屏抢主线程。
   载入完成 → 空闲时(或兜底 800ms)再起 rAF；出场延迟 launchAt 基于启动时刻重算，观感不变。 */
function startPets(){
  launchAt=performance.now()+1000;
  computeAnchors();computePerches();
  requestAnimationFrame(frame);
}
function kickPets(){
  if(window.requestIdleCallback){
    requestIdleCallback(startPets,{timeout:800});
  }else{
    setTimeout(startPets,300);
  }
}
if(document.readyState==='complete'){kickPets();}
else{window.addEventListener('load',kickPets,{once:true});}
})();
