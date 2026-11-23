const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const mini = document.getElementById("minimap");
const mctx = mini.getContext("2d");

const WORLD = 2600;
let dpr = 1, w = 0, h = 0, running = false, last = 0;
let keys = {}, mouse = {x:0,y:0,down:false};
let touchMove = {x:0,y:0}, touchFiring = false, joystickPointer = null;
let playerHitFlash = 0;
let player, bots, bullets, particles, loot, zone, alive, kills, elapsed, nextZone;

function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  w = innerWidth; h = innerHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
addEventListener("resize", resize); resize();

function rand(a,b) { return a + Math.random() * (b-a); }
function dist(a,b) { return Math.hypot(a.x-b.x,a.y-b.y); }
function clamp(v,a,b) { return Math.max(a,Math.min(b,v)); }
function segmentDistance(point, start, end) {
  const dx=end.x-start.x, dy=end.y-start.y;
  const lengthSq=dx*dx+dy*dy;
  const t=lengthSq===0?0:clamp(((point.x-start.x)*dx+(point.y-start.y)*dy)/lengthSq,0,1);
  return Math.hypot(point.x-(start.x+t*dx),point.y-(start.y+t*dy));
}

const terrain = [];
for (let i=0;i<180;i++) terrain.push({x:rand(100,WORLD-100),y:rand(100,WORLD-100),r:rand(18,55),tone:Math.random()>.5});

function reset() {
  player = {x:WORLD/2,y:WORLD/2,r:16,hp:100,ammo:30,reserve:120,cooldown:0,reload:0,angle:0,alive:true};
  bots = []; bullets = []; particles = []; loot = [];
  zone = {x:WORLD/2,y:WORLD/2,r:1150,targetR:1150,phase:0};
  alive = 20; kills = 0; elapsed = 0; nextZone = 18;
  for (let i=0;i<19;i++) {
    let a=rand(0,Math.PI*2), d=rand(350,1100);
    bots.push({x:clamp(WORLD/2+Math.cos(a)*d,50,WORLD-50),y:clamp(WORLD/2+Math.sin(a)*d,50,WORLD-50),r:14,hp:rand(55,100),cooldown:rand(0,.8),attackCooldown:rand(0,1),angle:0,alive:true,strafe:rand(-1,1),think:0});
  }
  for(let i=0;i<50;i++) loot.push({x:rand(80,WORLD-80),y:rand(80,WORLD-80),r:8,kind:Math.random()<.5?"ammo":"med"});
  running = true;
  document.getElementById("start").classList.add("hidden");
  document.getElementById("result").classList.add("hidden");
  last = performance.now();
  requestAnimationFrame(loop);
}

function shoot(owner, angle) {
  if (owner.reload > 0) return;
  if (owner === player) {
    if (owner.cooldown>0) return;
    if (owner.ammo<=0) {
      if (owner.reserve>0 && owner.reload<=0) owner.reload=1.4;
      return;
    }
    owner.ammo--; owner.cooldown=.09;
  } else owner.cooldown=rand(.18,.55);
  bullets.push({x:owner.x+Math.cos(angle)*20,y:owner.y+Math.sin(angle)*20,vx:Math.cos(angle)*760,vy:Math.sin(angle)*760,life:1.1,owner});
  for(let i=0;i<4;i++) particles.push({x:owner.x+Math.cos(angle)*22,y:owner.y+Math.sin(angle)*22,vx:Math.cos(angle)*rand(40,120)+rand(-30,30),vy:Math.sin(angle)*rand(40,120)+rand(-30,30),life:.18,color:"#ffe88a"});
}

function damage(entity, amount, shooter) {
  entity.hp -= amount;
  if (entity === player) playerHitFlash = .12;
  if (entity.hp <= 0 && entity.alive) {
    entity.alive=false;
    if (entity !== player) {
      alive--;
      if (shooter===player) kills++;
      for(let i=0;i<16;i++) particles.push({x:entity.x,y:entity.y,vx:rand(-160,160),vy:rand(-160,160),life:rand(.4,1),color:"#d96d4d"});
    } else finish(false);
  }
}

function update(dt) {
  elapsed += dt;
  playerHitFlash = Math.max(0, playerHitFlash-dt);
  zone.phase += dt;
  if (elapsed >= nextZone && zone.targetR > 260) {
    zone.targetR = Math.max(260, zone.targetR*.72);
    zone.phase=0;
    nextZone += 24;
  }
  if (zone.phase < 12) zone.r += (zone.targetR-zone.r)*dt*.12;

  let dx=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0)+touchMove.x;
  let dy=(keys.s||keys.arrowdown?1:0)-(keys.w||keys.arrowup?1:0)+touchMove.y;
  let len=Math.hypot(dx,dy)||1;
  player.x=clamp(player.x+(dx/Math.max(1,len))*210*dt,20,WORLD-20);
  player.y=clamp(player.y+(dy/Math.max(1,len))*210*dt,20,WORLD-20);
  player.cooldown=Math.max(0,player.cooldown-dt);
  if (player.reload>0) {
    player.reload-=dt;
    if (player.reload<=0) { let n=Math.min(30-player.ammo,player.reserve); player.ammo+=n; player.reserve-=n; }
  }
  player.angle=Math.atan2(mouse.y-h/2,mouse.x-w/2);
  if(touchFiring) {
    let target=null, targetDist=Infinity;
    for(const bot of bots) if(bot.alive) {
      const d=dist(player,bot);
      if(d<targetDist) { target=bot; targetDist=d; }
    }
    if(target) player.angle=Math.atan2(target.y-player.y,target.x-player.x);
  }
  if(mouse.down||touchFiring) shoot(player,player.angle);

  for(const b of bots) {
    if(!b.alive) continue;
    b.cooldown=Math.max(0,b.cooldown-dt); b.attackCooldown=Math.max(0,b.attackCooldown-dt); b.think-=dt;
    let target=null, targetDist=Infinity;
    if(player.alive) { target=player; targetDist=dist(b,player); }
    for(const rival of bots) {
      if(rival===b||!rival.alive) continue;
      const rivalDist=dist(b,rival);
      if(rivalDist<targetDist) { target=rival; targetDist=rivalDist; }
    }
    const angle=target?Math.atan2(target.y-b.y,target.x-b.x):0;
    b.angle=angle;
    let moveAngle=angle;
    if(dist(b,zone)>zone.r*.78) moveAngle=Math.atan2(zone.y-b.y,zone.x-b.x);
    else if(!target||targetDist>430) moveAngle=target?angle:Math.atan2(zone.y-b.y,zone.x-b.x);
    else if(targetDist<240) moveAngle=angle+Math.PI/2*b.strafe;
    else moveAngle=angle+Math.PI/2*b.strafe;
    b.x=clamp(b.x+Math.cos(moveAngle)*rand(65,85)*dt,20,WORLD-20);
    b.y=clamp(b.y+Math.sin(moveAngle)*rand(65,85)*dt,20,WORLD-20);
    if(b.think<=0) { b.think=rand(1,3); b.strafe*=Math.random()<.35?-1:1; }
    if(target && targetDist<520 && b.cooldown<=0) shoot(b,angle+rand(-.10,.10));
    if(target && targetDist<42 && b.attackCooldown<=0) {
      damage(target,rand(8,14),b);
      b.attackCooldown=.55;
    }
  }

  for(let i=bullets.length-1;i>=0;i--) {
    const q=bullets[i], start={x:q.x,y:q.y};
    q.x+=q.vx*dt;q.y+=q.vy*dt;q.life-=dt;
    let hit=false;
    if(q.owner===player) {
      for(const b of bots) if(b.alive&&segmentDistance(b,start,q)<b.r+4) { damage(b,34,player);hit=true;break; }
    } else {
      if(player.alive&&segmentDistance(player,start,q)<player.r+4) { damage(player,rand(10,16),q.owner);hit=true; }
      if(!hit) for(const b of bots) if(b!==q.owner&&b.alive&&segmentDistance(b,start,q)<b.r+4) { damage(b,34,q.owner);hit=true;break; }
    }
    if(hit||q.life<=0||q.x<0||q.y<0||q.x>WORLD||q.y>WORLD) bullets.splice(i,1);
  }

  for(let i=particles.length-1;i>=0;i--) { const p=particles[i];p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;if(p.life<=0)particles.splice(i,1); }
  for(let i=loot.length-1;i>=0;i--) {
    const l=loot[i]; if(dist(player,l)<25) { if(l.kind==="ammo")player.reserve=Math.min(180,player.reserve+30);else player.hp=Math.min(100,player.hp+25);loot.splice(i,1); }
  }
  if(dist(player,zone)>zone.r) damage(player,12*dt,null);

  for(let i=0;i<bots.length;i++) for(let j=i+1;j<bots.length;j++) {
    if(!bots[i].alive||!bots[j].alive)continue;
    if(dist(bots[i],bots[j])<35 && Math.random()<.002) damage(bots[i],rand(8,20),bots[j]);
  }
  if(alive===1 && player.alive) finish(true);
  document.getElementById("status").textContent=alive+" ALIVE";
  document.getElementById("health").style.width=clamp(player.hp,0,100)+"%";
  document.getElementById("health-text").textContent=Math.ceil(player.hp);
  document.getElementById("ammo").textContent=player.ammo+" / "+player.reserve;
  document.getElementById("weapon").textContent=player.reload>0?"RELOADING":(player.ammo<=0&&player.reserve<=0?"EMPTY":"RIFLE");
  const warning=document.getElementById("zone-warning");
  warning.style.opacity=dist(player,zone)>zone.r*.9?"1":"0";
  warning.textContent="RETURN TO THE ZONE";
}

function draw() {
  ctx.fillStyle="#1a2417";ctx.fillRect(0,0,w,h);
  const cx=player?player.x-w/2:0,cy=player?player.y-h/2:0;
  ctx.save();ctx.translate(-cx,-cy);
  ctx.fillStyle="#202d1c";ctx.fillRect(0,0,WORLD,WORLD);
  ctx.strokeStyle="rgba(155,180,130,.07)";ctx.lineWidth=1;
  for(let x=0;x<WORLD;x+=100){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,WORLD);ctx.stroke();}
  for(let y=0;y<WORLD;y+=100){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(WORLD,y);ctx.stroke();}
  for(const t of terrain) { ctx.fillStyle=t.tone?"#263820":"#34452b";ctx.beginPath();ctx.arc(t.x,t.y,t.r,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#182217";ctx.lineWidth=3;ctx.stroke(); }
  if(zone) {
    ctx.save();ctx.beginPath();ctx.rect(0,0,WORLD,WORLD);ctx.arc(zone.x,zone.y,zone.r,0,Math.PI*2,true);ctx.fillStyle="rgba(67,104,130,.38)";ctx.fill("evenodd");ctx.restore();
    ctx.strokeStyle="#78b8d6";ctx.lineWidth=5;ctx.beginPath();ctx.arc(zone.x,zone.y,zone.r,0,Math.PI*2);ctx.stroke();
  }
  if(loot) for(const l of loot) { ctx.fillStyle=l.kind==="ammo"?"#ffd45e":"#82e6a2";ctx.save();ctx.translate(l.x,l.y);ctx.rotate(Math.PI/4);ctx.fillRect(-6,-6,12,12);ctx.restore(); }
  if(bots) for(const b of bots) if(b.alive) drawActor(b,"#be6a4e","#1e1612");
  if(bullets) for(const q of bullets) { ctx.fillStyle="#fff5b0";ctx.beginPath();ctx.arc(q.x,q.y,3,0,Math.PI*2);ctx.fill(); }
  if(particles) for(const p of particles) { ctx.globalAlpha=Math.max(0,p.life/.5);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1; }
  if(player) if(player.alive) drawActor(player,"#d8ff58","#1c2418");
  ctx.restore();
  if(playerHitFlash>0) {
    ctx.fillStyle=`rgba(255,70,45,${playerHitFlash*2})`;
    ctx.fillRect(0,0,w,h);
  }
  drawMinimap();
}

function drawActor(a,color,outline) {
  ctx.save();ctx.translate(a.x,a.y);ctx.rotate(a.angle);
  ctx.fillStyle="rgba(0,0,0,.28)";ctx.beginPath();ctx.ellipse(-3,8,18,12,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=outline;ctx.beginPath();ctx.arc(0,0,a.r+3,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=color;ctx.beginPath();ctx.arc(0,0,a.r,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=outline;ctx.fillRect(8,-4,22,8);
  ctx.restore();
}

function drawMinimap() {
  mctx.fillStyle="#151b13";mctx.fillRect(0,0,170,170);
  if(!zone) return;
  const s=170/WORLD;
  mctx.strokeStyle="#7db2cf";mctx.lineWidth=2;mctx.beginPath();mctx.arc(zone.x*s,zone.y*s,zone.r*s,0,Math.PI*2);mctx.stroke();
  if(player) {mctx.fillStyle="#d8ff58";mctx.beginPath();mctx.arc(player.x*s,player.y*s,3,0,Math.PI*2);mctx.fill();}
  if(bots) {mctx.fillStyle="#bc674f";for(const b of bots) if(b.alive){mctx.beginPath();mctx.arc(b.x*s,b.y*s,2,0,Math.PI*2);mctx.fill();}}
}

function finish(win) {
  if(!running)return;
  running=false;
  const result=document.getElementById("result");
  document.getElementById("place").textContent="#"+(win?1:alive);
  document.getElementById("result-title").textContent=win?"VICTORY":"ELIMINATED";
  document.getElementById("result-detail").textContent=kills+" eliminations · "+Math.floor(elapsed)+" seconds";
  result.classList.remove("hidden");
}

function loop(now) {
  if(!running)return;
  let dt=Math.min(.033,(now-last)/1000);last=now;
  update(dt);draw();
  requestAnimationFrame(loop);
}

addEventListener("keydown",e=>{keys[e.key.toLowerCase()]=true;if(e.key.toLowerCase()==="r"&&player&&!player.reload&&player.ammo<30&&player.reserve>0)player.reload=1.4;});
addEventListener("keyup",e=>keys[e.key.toLowerCase()]=false);
canvas.addEventListener("mousemove",e=>{mouse.x=e.clientX;mouse.y=e.clientY;});
canvas.addEventListener("mousedown",()=>mouse.down=true);
addEventListener("mouseup",()=>mouse.down=false);
const joystick=document.getElementById("joystick");
const joystickKnob=document.getElementById("joystick-knob");
function updateJoystick(event) {
  const rect=joystick.getBoundingClientRect();
  const radius=rect.width*.36;
  const x=event.clientX-(rect.left+rect.width/2);
  const y=event.clientY-(rect.top+rect.height/2);
  const length=Math.hypot(x,y);
  const scale=length>radius?radius/length:1;
  const px=x*scale, py=y*scale;
  touchMove={x:px/radius,y:py/radius};
  joystickKnob.style.transform=`translate(${px}px, ${py}px)`;
}
joystick.addEventListener("pointerdown",event=>{
  event.preventDefault();
  joystickPointer=event.pointerId;
  joystick.setPointerCapture(event.pointerId);
  updateJoystick(event);
});
joystick.addEventListener("pointermove",event=>{
  if(event.pointerId===joystickPointer) updateJoystick(event);
});
function releaseJoystick(event) {
  if(event.pointerId!==joystickPointer) return;
  joystickPointer=null;
  touchMove={x:0,y:0};
  joystickKnob.style.transform="";
}
joystick.addEventListener("pointerup",releaseJoystick);
joystick.addEventListener("pointercancel",releaseJoystick);
const fireButton=document.getElementById("touch-fire");
fireButton.addEventListener("pointerdown",event=>{
  event.preventDefault();
  touchFiring=true;
  fireButton.setPointerCapture(event.pointerId);
});
function stopTouchFire() { touchFiring=false; }
fireButton.addEventListener("pointerup",stopTouchFire);
fireButton.addEventListener("pointercancel",stopTouchFire);
fireButton.addEventListener("lostpointercapture",stopTouchFire);
document.getElementById("play").addEventListener("click",reset);
document.getElementById("again").addEventListener("click",reset);
if("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
draw();
