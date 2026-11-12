/* 宇天科技 新版首页脚本①：神经粒子背景 + 滚动/数字/终端/导航。由交付包内联外置。 */
(function(){
"use strict";
/* ================= 全屏 3D 神经元大脑 ================= */
var cv=document.getElementById("brain"),ctx=cv.getContext("2d");
var W=0,H=0,DPR=1,narrow=false;
var nodes=[],edges=[],pulses=[],rings=[];
var px=[],py=[],ps=[],pz=[];
var mouse={x:-1e4,y:-1e4};
var scrollP=0,scrollSm=0,autoRot=0,rotY=0,flashV=0,timeT=0;
var lastTime=performance.now(),pulseCap=360;
var flashEl=document.getElementById("flash");

function makeSprite(color){
  var c=document.createElement("canvas");c.width=c.height=64;
  var g=c.getContext("2d");
  var grd=g.createRadialGradient(32,32,0,32,32,32);
  grd.addColorStop(0,"rgba(255,255,255,1)");
  grd.addColorStop(.28,color);
  grd.addColorStop(1,"rgba(0,0,0,0)");
  g.fillStyle=grd;g.fillRect(0,0,64,64);
  return c;
}
var spCyan=makeSprite("rgba(34,211,238,.85)");
var spMag=makeSprite("rgba(255,0,255,.85)");
var spWhite=makeSprite("rgba(215,250,255,.95)");

function build(){
  var n=Math.round(W*H/4200);
  n=Math.max(130,Math.min(320,n));
  if(W<560){n=Math.round(n*.5);pulseCap=150;}
  else if(W<900){n=Math.round(n*.72);pulseCap=240;}
  else{pulseCap=360;}
  nodes=[];edges=[];pulses=[];rings=[];
  var i,j,k;
  for(i=0;i<n;i++){
    var u=Math.random()*2-1,ph=Math.random()*Math.PI*2,s=Math.sqrt(1-u*u);
    var r=Math.random()<.72?(.72+Math.random()*.3):(.28+Math.random()*.42);
    var x=s*Math.cos(ph)*r,y=u*r,z=s*Math.sin(ph)*r;
    x*=1.28;y*=.92;z*=1.02;
    if(Math.abs(x)<.16&&y>-.05)x+=(x>=0?1:-1)*.15;   /* 中央脑沟 */
    if(y<-.6)y=-.6-(y+.6)*.35;                        /* 底部收平 */
    nodes.push({x:x,y:y,z:z,act:0,cool:0,mag:Math.random()<.14,nb:[]});
  }
  var seen={};
  for(i=0;i<n;i++){
    var d=[];
    for(j=0;j<n;j++){
      if(i===j)continue;
      var dx=nodes[i].x-nodes[j].x,dy=nodes[i].y-nodes[j].y,dz=nodes[i].z-nodes[j].z;
      d.push([dx*dx+dy*dy+dz*dz,j]);
    }
    d.sort(function(a,b){return a[0]-b[0];});
    for(k=0;k<3;k++){
      j=d[k][1];
      var key=i<j?i+"_"+j:j+"_"+i;
      if(!seen[key]){
        seen[key]=1;edges.push([i,j]);
        nodes[i].nb.push(j);nodes[j].nb.push(i);
      }
    }
  }
  px=new Array(n);py=new Array(n);ps=new Array(n);pz=new Array(n);
}

function resize(){
  DPR=Math.min(window.devicePixelRatio||1,2);
  W=window.innerWidth;H=window.innerHeight;narrow=W<900;
  cv.width=Math.round(W*DPR);cv.height=Math.round(H*DPR);
  cv.style.width=W+"px";cv.style.height=H+"px";
  ctx.setTransform(DPR,0,0,DPR,0,0);
  build();
}

function fire(i,energy){
  var nd=nodes[i];nd.act=1;
  if(pulses.length>=pulseCap)return;
  var p=energy>=3?.9:.65;
  for(var k=0;k<nd.nb.length;k++){
    if(Math.random()<p&&pulses.length<pulseCap){
      pulses.push({a:i,b:nd.nb[k],t:0,sp:1.5+Math.random()*1.5,e:energy});
    }
  }
}

function storm(x,y){
  flashV=1;
  var cnt=narrow?10:20;
  for(var i=0;i<cnt;i++)fire((Math.random()*nodes.length)|0,3);
  rings.push({x:x,y:y,r:6,a:1});
}

function frame(now){
  var dt=Math.min(.05,(now-lastTime)/1000);lastTime=now;timeT+=dt;
  scrollSm+=(scrollP-scrollSm)*.06;
  autoRot+=dt*.13*(1+scrollSm*.8);
  var targetRot=autoRot+scrollSm*Math.PI*2.1;   /* 滚动驱动旋转 */
  rotY+=(targetRot-rotY)*.08;
  var rotX=-.3+((mouse.y>-9000?(mouse.y/H-.5):0))*.16;

  /* 滚动驱动放电频率 */
  var rate=1.6+scrollSm*7;
  if(Math.random()<rate*dt)fire((Math.random()*nodes.length)|0,Math.random()<.3?3:2);

  ctx.clearRect(0,0,W,H);
  var cx=W*.5+((mouse.x>-9000?(mouse.x/W-.5):0))*26;
  var cy=H*.46+((mouse.y>-9000?(mouse.y/H-.5):0))*20;
  var R=Math.min(W,H)*(narrow?.36:.42)*(1+.015*Math.sin(timeT*1.3));
  var cyr=Math.cos(rotY),syr=Math.sin(rotY);
  var cxr=Math.cos(rotX),sxr=Math.sin(rotX);
  var i,j,nd;

  for(i=0;i<nodes.length;i++){
    nd=nodes[i];
    var x=nd.x*cyr-nd.z*syr;
    var z0=nd.x*syr+nd.z*cyr;
    var y=nd.y*cxr-z0*sxr;
    var z=nd.y*sxr+z0*cxr;
    var pers=2.6/(2.6+z);
    px[i]=cx+x*pers*R;py[i]=cy+y*pers*R;ps[i]=pers;pz[i]=z;
    nd.act*=Math.exp(-dt*3.1);
    if(nd.cool>0)nd.cool-=dt;
  }

  /* 鼠标靠近 → 激活 + 向外放电 */
  if(mouse.x>-9000){
    var rad=narrow?80:110;
    for(i=0;i<nodes.length;i++){
      var mdx=px[i]-mouse.x,mdy=py[i]-mouse.y;
      var dist=Math.sqrt(mdx*mdx+mdy*mdy);
      if(dist<rad){
        nd=nodes[i];
        var kk=1-dist/rad;
        if(kk>nd.act)nd.act=kk;
        if(kk>.55&&nd.cool<=0&&Math.random()<.14){nd.cool=.45;fire(i,2);}
      }
    }
  }

  ctx.globalCompositeOperation="lighter";

  /* 突触连线：底层批量 + 活跃单独描 */
  var mix=Math.min(1,scrollSm*1.1);
  ctx.lineWidth=1;
  ctx.strokeStyle="rgba(34,211,238,.07)";
  ctx.beginPath();
  for(i=0;i<edges.length;i++){
    var e=edges[i];
    ctx.moveTo(px[e[0]],py[e[0]]);
    ctx.lineTo(px[e[1]],py[e[1]]);
  }
  ctx.stroke();
  for(i=0;i<edges.length;i++){
    var e2=edges[i];
    var act=Math.max(nodes[e2[0]].act,nodes[e2[1]].act);
    if(act>.1){
      var cr=Math.round(34+(255-34)*mix*.7);
      var cg=Math.round(211-211*mix*.7);
      var cb=Math.round(238+(255-238)*mix*.3);
      ctx.strokeStyle="rgba("+cr+","+cg+","+cb+","+(act*.55).toFixed(3)+")";
      ctx.lineWidth=1+act*1.4;
      ctx.beginPath();
      ctx.moveTo(px[e2[0]],py[e2[0]]);
      ctx.lineTo(px[e2[1]],py[e2[1]]);
      ctx.stroke();
    }
  }

  /* 神经元节点 */
  for(i=0;i<nodes.length;i++){
    nd=nodes[i];
    var base=(nd.mag?2.4:1.7)*ps[i];
    var size=base*(1+nd.act*2.4);
    ctx.globalAlpha=Math.min(1,.3+.28*ps[i]+.6*nd.act);
    ctx.drawImage(nd.mag?spMag:spCyan,px[i]-size*2,py[i]-size*2,size*4,size*4);
    if(nd.act>.45){
      ctx.globalAlpha=nd.act;
      ctx.drawImage(spWhite,px[i]-size,py[i]-size,size*2,size*2);
    }
  }
  ctx.globalAlpha=1;

  /* 思维脉冲：沿连线传播，抵达后链式放电 */
  for(i=pulses.length-1;i>=0;i--){
    var pu=pulses[i];
    pu.t+=pu.sp*dt*(1+scrollSm*.5);
    if(pu.t>=1){
      var nb=nodes[pu.b];nb.act=1;
      if(pu.e>1&&nb.cool<=0){
        nb.cool=.4;
        for(j=0;j<nb.nb.length;j++){
          if(Math.random()<.5&&pulses.length<pulseCap){
            pulses.push({a:pu.b,b:nb.nb[j],t:0,sp:1.5+Math.random()*1.5,e:pu.e-1});
          }
        }
      }
      pulses.splice(i,1);continue;
    }
    var na=nodes[pu.a],nbb=nodes[pu.b],tt=pu.t;
    var x3=na.x+(nbb.x-na.x)*tt,y3=na.y+(nbb.y-na.y)*tt,z3=na.z+(nbb.z-na.z)*tt;
    var rx=x3*cyr-z3*syr,rz0=x3*syr+z3*cyr;
    var ry=y3*cxr-rz0*sxr,rz=y3*sxr+rz0*cxr;
    var pp=2.6/(2.6+rz);
    var sx=cx+rx*pp*R,sy=cy+ry*pp*R;
    var pulseSize=(2.4+2.2*Math.sin(tt*Math.PI))*pp;
    ctx.globalAlpha=.9;
    ctx.drawImage(pu.e>=3?spMag:spCyan,sx-pulseSize*2,sy-pulseSize*2,pulseSize*4,pulseSize*4);
    ctx.globalAlpha=1;
    ctx.drawImage(spWhite,sx-pulseSize,sy-pulseSize,pulseSize*2,pulseSize*2);
  }
  ctx.globalAlpha=1;

  /* 点击冲击环 */
  for(i=rings.length-1;i>=0;i--){
    var rg=rings[i];
    rg.r+=(700+300*rg.a)*dt;rg.a-=dt*1.6;
    if(rg.a<=0){rings.splice(i,1);continue;}
    ctx.strokeStyle="rgba(34,211,238,"+(rg.a*.6).toFixed(3)+")";
    ctx.lineWidth=2+rg.a*2;
    ctx.beginPath();ctx.arc(rg.x,rg.y,rg.r,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle="rgba(255,0,255,"+(rg.a*.3).toFixed(3)+")";
    ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(rg.x,rg.y,rg.r*.7,0,Math.PI*2);ctx.stroke();
  }

  ctx.globalCompositeOperation="source-over";

  /* 屏幕闪光 */
  if(flashV>.005){flashV*=.88;flashEl.style.opacity=(flashV*.38).toFixed(3);}
  else if(flashV!==0){flashV=0;flashEl.style.opacity="0";}

  requestAnimationFrame(frame);
}

var rsTimer=null;
window.addEventListener("resize",function(){
  clearTimeout(rsTimer);rsTimer=setTimeout(resize,150);
});
window.addEventListener("mousemove",function(e){mouse.x=e.clientX;mouse.y=e.clientY;});
window.addEventListener("mouseout",function(){mouse.x=-1e4;mouse.y=-1e4;});
window.addEventListener("pointerdown",function(e){storm(e.clientX,e.clientY);});

/* ================= 滚动：进度 / 导航 / 进度条 ================= */
var hd=document.getElementById("hd"),prog=document.getElementById("prog");
function onScroll(){
  var doc=document.documentElement;
  var max=Math.max(1,doc.scrollHeight-window.innerHeight);
  scrollP=Math.min(1,Math.max(0,window.scrollY/max));
  prog.style.transform="scaleX("+scrollP.toFixed(4)+")";
  if(window.scrollY>40)hd.classList.add("scrolled");else hd.classList.remove("scrolled");
}
window.addEventListener("scroll",onScroll,{passive:true});

/* ================= 汉堡菜单 ================= */
var burger=document.getElementById("burger");
burger.addEventListener("click",function(e){
  e.stopPropagation();hd.classList.toggle("open");
});
document.getElementById("navLinks").addEventListener("click",function(e){
  if(e.target.tagName==="A")hd.classList.remove("open");
});

/* ================= 滚动渐显 ================= */
var io=new IntersectionObserver(function(entries){
  entries.forEach(function(en){
    if(en.isIntersecting){en.target.classList.add("in");io.unobserve(en.target);}
  });
},{threshold:.15});
document.querySelectorAll(".reveal").forEach(function(el){io.observe(el);});

/* ================= 数字滚动 ================= */
function animateCount(el){
  var target=parseFloat(el.getAttribute("data-count"));
  var dec=parseInt(el.getAttribute("data-dec")||"0",10);
  var t0=performance.now(),dur=1800;
  (function step(t){
    var p=Math.min(1,(t-t0)/dur);
    p=1-Math.pow(1-p,3);
    el.textContent=(target*p).toFixed(dec);
    if(p<1)requestAnimationFrame(step);
  })(t0);
}
var cntDone=false;
var io2=new IntersectionObserver(function(entries){
  entries.forEach(function(en){
    if(en.isIntersecting&&!cntDone){
      cntDone=true;
      document.querySelectorAll("[data-count]").forEach(animateCount);
      io2.disconnect();
    }
  });
},{threshold:.3});
io2.observe(document.getElementById("models"));

/* ================= 卡片 3D 倾斜 ================= */
document.querySelectorAll(".tilt").forEach(function(card){
  card.addEventListener("mousemove",function(e){
    var r=card.getBoundingClientRect();
    var x=(e.clientX-r.left)/r.width-.5;
    var y=(e.clientY-r.top)/r.height-.5;
    card.style.transform="perspective(800px) rotateY("+(x*14).toFixed(2)+"deg) rotateX("+(-y*12).toFixed(2)+"deg) translateY(-8px) scale(1.03)";
    card.style.setProperty("--mx",(e.clientX-r.left)+"px");
    card.style.setProperty("--my",(e.clientY-r.top)+"px");
  });
  card.addEventListener("mouseleave",function(){card.style.transform="";});
});

/* ================= AI 推理流终端 ================= */
var termOut=document.getElementById("termOut");
function ri(a,b){return a+Math.floor(Math.random()*(b-a+1));}
var T=[
  function(){return "analyzing request stream ... ok · 置信度 "+(90+Math.random()*9.8).toFixed(1)+"%";},
  function(){return "neural pathway #"+ri(1024,9999)+" activated · latency "+ri(6,24)+"ms";},
  function(){return "synaptic avalanche: "+ri(96,860)+" nodes firing in chain";},
  function(){return "reasoning depth="+ri(3,9)+" · entropy "+(Math.random()*.92).toFixed(3)+" · stable";},
  function(){return "throughput "+ri(38,52)+"k tokens/s · GPU cluster nominal";},
  function(){return "memory recall ... hit "+(92+Math.random()*7.9).toFixed(1)+"% · cache warm";},
  function(){return "安全策略自检通过 · TLS1.3 · 0 threats detected";},
  function(){return "load-balancer rerouted "+ri(2,18)+" sessions · 0 drops";},
  function(){return "思维脉冲同步率 "+(95+Math.random()*4.9).toFixed(1)+"% · phase-lock ✓";},
  function(){return "inference #"+ri(10000,99999)+" resolved in "+ri(9,38)+"ms ✓";}
];
var lineEl=null,lineTxt="",lineIdx=0,lineWait=6;
setInterval(function(){
  if(lineWait>0){lineWait--;return;}
  if(!lineEl){
    lineEl=document.createElement("div");
    lineEl.className="tl typing";
    var tp=document.createElement("span");tp.className="tp";tp.textContent=">";
    var body=document.createElement("span");
    lineEl.appendChild(tp);lineEl.appendChild(body);
    lineEl._body=body;
    termOut.appendChild(lineEl);
    while(termOut.children.length>9)termOut.removeChild(termOut.firstChild);
    lineTxt=T[(Math.random()*T.length)|0]();
    lineIdx=0;
    return;
  }
  if(lineIdx<lineTxt.length){
    lineIdx+=(Math.random()<.35?2:1);
    if(lineIdx>lineTxt.length)lineIdx=lineTxt.length;
    lineEl._body.textContent=lineTxt.slice(0,lineIdx);
  }else{
    lineEl.classList.remove("typing");
    lineEl=null;
    lineWait=ri(8,24);
  }
},34);

/* 实时假数据仪表 */
var mLat=document.getElementById("mLat"),mNode=document.getElementById("mNode"),mTok=document.getElementById("mTok");
setInterval(function(){
  mLat.textContent=ri(8,19)+"ms";
  mNode.textContent=String(ri(312,344));
  mTok.textContent=ri(41000,52000).toLocaleString();
},1100);

/* ================= 启动 ================= */
resize();
onScroll();
requestAnimationFrame(frame);
})();
