import { useState, useRef, useEffect, useCallback } from "react";
import api from '../utils/api';
import { toast } from 'sonner';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS & SHIP CATALOGUE
// ─────────────────────────────────────────────────────────────────────────────
const GRID = 10;
const CELL = 44;
const COLS = ["A","B","C","D","E","F","G","H","I","J"];

const SHIP_CATALOGUE = [
  { id:"carrier",      name:"Aircraft Carrier",  size:5, desc:"Fleet flagship — wide flat deck" },
  { id:"battleship",   name:"Battleship",         size:4, desc:"Heavy guns fore and aft" },
  { id:"cruiser",      name:"Heavy Cruiser",      size:4, desc:"Fast & heavily armed" },
  { id:"destroyer",    name:"Destroyer",          size:3, desc:"Agile escort vessel" },
  { id:"submarine",    name:"Submarine",          size:3, desc:"Stealth torpedo boat" },
  { id:"frigate",      name:"Frigate",            size:3, desc:"Patrol & anti-sub" },
  { id:"gunboat",      name:"Gunboat",            size:2, desc:"Fast attack craft" },
  { id:"minelayer",    name:"Minelayer",          size:2, desc:"Lays traps at sea" },
];

const DEFAULT_SETTINGS = {
  ships: ["carrier","battleship","destroyer","submarine","gunboat"],
  sinkingCutscene: true,
  hitDebris: true,
  aiDelay: 1100,
  gridSize: 10,
};

// ─────────────────────────────────────────────────────────────────────────────
// GRID HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function emptyGrid(size=GRID) {
  return Array.from({length:size},(_,r)=>Array.from({length:size},(_,c)=>({r,c,ship:null,hit:false,miss:false})));
}
function canPlace(grid,ship,r,c,horiz,size=GRID) {
  for (let i=0;i<ship.size;i++) {
    const nr=horiz?r:r+i, nc=horiz?c+i:c;
    if (nr>=size||nc>=size||grid[nr][nc].ship) return false;
  }
  return true;
}
function placeShip(grid,ship,r,c,horiz) {
  const g=grid.map(row=>row.map(cell=>({...cell})));
  for (let i=0;i<ship.size;i++) { const nr=horiz?r:r+i,nc=horiz?c+i:c; g[nr][nc].ship=ship.id; }
  return g;
}
function autoPlaceAll(ships,size=GRID) {
  let grid=emptyGrid(size);
  for (const ship of ships) {
    let placed=false,tries=0;
    while (!placed&&tries++<500) {
      const h=Math.random()<0.5,r=Math.floor(Math.random()*size),c=Math.floor(Math.random()*size);
      if (canPlace(grid,ship,r,c,h,size)) { grid=placeShip(grid,ship,r,c,h); placed=true; }
    }
  }
  return grid;
}
function isShipSunk(grid,shipId) { return grid.every(row=>row.every(c=>c.ship!==shipId||c.hit)); }
function allSunk(grid,ships) { return ships.every(s=>isShipSunk(grid,s.id)); }
function getShipCells(grid,shipId) { return grid.flatMap(row=>row.filter(c=>c.ship===shipId).map(c=>[c.r,c.c])); }

// ─────────────────────────────────────────────────────────────────────────────
// AI
// ─────────────────────────────────────────────────────────────────────────────
function aiShot(aiState,playerGrid,size=GRID) {
  const {mode,targets}=aiState;
  if (mode==="target"&&targets.length>0) {
    const [r,c]=targets[0];
    return {r,c,newTargets:targets.slice(1),newMode:targets.length>1?"target":"hunt"};
  }
  const avail=[];
  for (let i=0;i<size;i++) for (let j=0;j<size;j++)
    if (!playerGrid[i][j].hit&&!playerGrid[i][j].miss&&(i+j)%2===0) avail.push([i,j]);
  if (!avail.length) for (let i=0;i<size;i++) for (let j=0;j<size;j++)
    if (!playerGrid[i][j].hit&&!playerGrid[i][j].miss) avail.push([i,j]);
  const [r,c]=avail[Math.floor(Math.random()*avail.length)];
  return {r,c,newTargets:[],newMode:"hunt"};
}
function addTargets(targets,r,c,grid,size=GRID) {
  return [...targets,...[[-1,0],[1,0],[0,-1],[0,1]].map(([dr,dc])=>[r+dr,c+dc])
    .filter(([nr,nc])=>nr>=0&&nr<size&&nc>=0&&nc<size&&!grid[nr][nc].hit&&!grid[nr][nc].miss)];
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLE FACTORIES
// ─────────────────────────────────────────────────────────────────────────────
function makeHitExplosion(cx,cy) {
  const p=[];
  // Core flash ring
  p.push({kind:"ring",x:cx,y:cy,life:1,decay:0.04,size:2,r:CELL*0.6});
  // Sparks & embers
  for (let i=0;i<60;i++) {
    const angle=(Math.PI*2*i)/60+(Math.random()-0.5)*0.8;
    const spd=2.5+Math.random()*6;
    const kind=i%6===0?"ember":i%4===0?"smoke":"spark";
    p.push({kind,x:cx,y:cy,vx:Math.cos(angle)*spd,vy:Math.sin(angle)*spd-(Math.random()*3),
      life:1,decay:0.012+Math.random()*0.02,
      size:kind==="smoke"?8+Math.random()*10:1.5+Math.random()*3,
      hue:kind==="ember"?15+Math.random()*25:kind==="smoke"?0:35+Math.random()*15});
  }
  // Flying debris chunks
  for (let i=0;i<12;i++) {
    const angle=Math.random()*Math.PI*2;
    const spd=3+Math.random()*8;
    p.push({kind:"chunk",x:cx,y:cy,vx:Math.cos(angle)*spd,vy:Math.sin(angle)*spd-3-Math.random()*4,
      life:1,decay:0.015+Math.random()*0.02,size:2+Math.random()*4,
      rot:Math.random()*Math.PI,rotV:(Math.random()-0.5)*0.3,hue:30+Math.random()*20});
  }
  return p;
}

function makeMissExplosion(cx,cy) {
  const p=[];
  for (let i=0;i<22;i++) {
    const angle=(Math.PI*2*i)/22+(Math.random()-0.5)*0.6;
    const spd=0.8+Math.random()*2.8;
    p.push({kind:"splash",x:cx,y:cy,vx:Math.cos(angle)*spd,vy:Math.sin(angle)*spd-Math.random()*1.2,
      life:1,decay:0.022+Math.random()*0.03,size:2+Math.random()*4,hue:205+Math.random()*30});
  }
  p.push({kind:"ring",x:cx,y:cy,life:1,decay:0.05,size:1,r:CELL*0.4,water:true});
  return p;
}

function makeSunkVolley(cells) {
  const p=[];
  cells.forEach(([r,c],idx)=>{
    const cx=c*CELL+CELL/2, cy=r*CELL+CELL/2;
    const delay=idx*0.08;
    for (let i=0;i<45;i++) {
      const angle=Math.random()*Math.PI*2, spd=2+Math.random()*8;
      const kind=i%5===0?"ember":i%4===0?"smoke":i%7===0?"chunk":"spark";
      p.push({kind,x:cx,y:cy,vx:Math.cos(angle)*spd,vy:Math.sin(angle)*spd-3-Math.random()*5,
        life:1-delay,decay:0.006+Math.random()*0.01,
        size:kind==="smoke"?10+Math.random()*14:kind==="chunk"?3+Math.random()*5:2+Math.random()*3.5,
        hue:kind==="smoke"?0:kind==="ember"?12+Math.random()*20:32+Math.random()*12,
        rot:Math.random()*Math.PI,rotV:(Math.random()-0.5)*0.25});
    }
    // Upward steel debris
    for (let i=0;i<10;i++) {
      p.push({kind:"steel",x:cx+(Math.random()-0.5)*CELL*0.8,y:cy,
        vx:(Math.random()-0.5)*3,vy:-5-Math.random()*7,
        life:1-delay,decay:0.014+Math.random()*0.012,size:1+Math.random()*3,hue:200+Math.random()*30});
    }
    p.push({kind:"ring",x:cx,y:cy,life:1-delay,decay:0.03,size:4,r:CELL*0.8});
  });
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPLOSION CANVAS
// ─────────────────────────────────────────────────────────────────────────────
function ExplosionCanvas({particlesRef,width,height}) {
  const ref=useRef(null), animRef=useRef(null), pRef=useRef([]);
  particlesRef.current={add:(np)=>{pRef.current=[...pRef.current,...np.filter(p=>p.life>0)];kick();}};
  function kick() {
    if (animRef.current) return;
    const canvas=ref.current; if (!canvas) return;
    const ctx=canvas.getContext("2d");
    const tick=()=>{
      ctx.clearRect(0,0,width,height);
      pRef.current=pRef.current.filter(p=>{
        if (p.life<=0) return false;
        draw(ctx,p);
        p.x+=p.vx||0; p.y+=(p.vy||0)+0.09; p.vx=(p.vx||0)*0.965; p.vy=(p.vy||0)*0.965;
        if (p.rot!==undefined) p.rot+=p.rotV||0;
        p.life-=p.decay;
        return true;
      });
      if (pRef.current.length>0) animRef.current=requestAnimationFrame(tick);
      else {ctx.clearRect(0,0,width,height);animRef.current=null;}
    };
    animRef.current=requestAnimationFrame(tick);
  }
  function draw(ctx,p) {
    const a=Math.max(0,p.life);
    if (p.kind==="ring") {
      const rr=(1-p.life)*(p.r||30)+p.size;
      ctx.beginPath();ctx.arc(p.x,p.y,rr,0,Math.PI*2);
      ctx.strokeStyle=p.water?`rgba(100,180,255,${a*0.5})`:`rgba(255,145,20,${a*0.55})`;
      ctx.lineWidth=p.water?1.5:2.5;ctx.stroke();return;
    }
    if (p.kind==="smoke") {
      ctx.beginPath();ctx.arc(p.x,p.y,p.size*(1.7-p.life*0.5),0,Math.PI*2);
      ctx.fillStyle=`rgba(60,45,25,${a*0.24})`;ctx.fill();return;
    }
    if (p.kind==="splash") {
      ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-(p.vx||0)*3.5,p.y-(p.vy||0)*3.5);
      ctx.strokeStyle=`hsla(${p.hue},55%,70%,${a*0.7})`;ctx.lineWidth=p.size*0.4;ctx.stroke();
      ctx.beginPath();ctx.arc(p.x,p.y,p.size*0.32,0,Math.PI*2);
      ctx.fillStyle=`hsla(${p.hue},55%,78%,${a*0.5})`;ctx.fill();return;
    }
    if (p.kind==="chunk"||p.kind==="steel") {
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot||0);
      const s=p.size*a;
      ctx.fillStyle=p.kind==="steel"?`rgba(160,200,220,${a*0.85})`:`hsla(${p.hue},65%,40%,${a*0.9})`;
      ctx.fillRect(-s/2,-s/2,s,s);
      ctx.restore();return;
    }
    ctx.beginPath();ctx.arc(p.x,p.y,Math.max(0.1,p.size*a),0,Math.PI*2);
    ctx.fillStyle=p.kind==="ember"?`hsla(${p.hue},100%,${55+p.life*15}%,${a})`:`hsla(${p.hue},90%,68%,${a*0.88})`;
    ctx.fill();
  }
  useEffect(()=>()=>cancelAnimationFrame(animRef.current),[]);
  return <canvas ref={ref} width={width} height={height} style={{position:"absolute",top:0,left:0,pointerEvents:"none",zIndex:20}}/>;
}

// ─────────────────────────────────────────────────────────────────────────────
// WATER CANVAS
// ─────────────────────────────────────────────────────────────────────────────
function WaterCanvas({width,height,size}) {
  const ref=useRef(null),t=useRef(0);
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");let running=true;
    const loop=()=>{
      if (!running) return;
      t.current+=0.017;ctx.clearRect(0,0,width,height);
      for (let row=0;row<size;row++) for (let col=0;col<size;col++) {
        const x=col*CELL,y=row*CELL;
        const w1=Math.sin(t.current+col*0.44+row*0.31)*0.5+0.5;
        const w2=Math.sin(t.current*0.68+col*0.21+row*0.6)*0.5+0.5;
        ctx.fillStyle=`rgba(10,38,80,${0.04+w1*0.05+w2*0.02})`;ctx.fillRect(x,y,CELL,CELL);
        if (Math.sin(t.current*3+col*1.4+row*0.8)>0.97) {
          ctx.fillStyle="rgba(120,180,255,0.12)";
          ctx.fillRect(x+Math.random()*CELL,y+Math.random()*CELL,2,1);
        }
      }
      ctx.strokeStyle="rgba(30,75,145,0.055)";ctx.lineWidth=1;
      for (let i=0;i<width+height;i+=28){const o=Math.sin(t.current*0.38+i*0.028)*4;ctx.beginPath();ctx.moveTo(i+o,0);ctx.lineTo(0,i+o);ctx.stroke();}
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return()=>{running=false;};
  },[width,height,size]);
  return <canvas ref={ref} width={width} height={height} style={{position:"absolute",top:0,left:0,pointerEvents:"none",zIndex:1}}/>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SINKING CUTSCENE — full canvas animation
// ─────────────────────────────────────────────────────────────────────────────
function SinkingCutscene({ship,cells,onDone}) {
  const ref=useRef(null);
  const frameRef=useRef(null);
  const stateRef=useRef({t:0,particles:[],waterLevel:0,tilt:0,alpha:1,phase:"explode"});

  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");
    const W=canvas.width,H=canvas.height;

    // Seed initial particles
    const initP=[];
    cells.forEach(([r,c])=>{
      const cx=c*80+40,cy=r*80+40;
      for (let i=0;i<60;i++) {
        const angle=Math.random()*Math.PI*2,spd=3+Math.random()*9;
        const kind=i%5===0?"ember":i%4===0?"smoke":i%7===0?"chunk":"spark";
        initP.push({kind,x:cx,y:cy,vx:Math.cos(angle)*spd,vy:Math.sin(angle)*spd-4-Math.random()*6,
          life:1,decay:0.007+Math.random()*0.011,
          size:kind==="smoke"?12+Math.random()*18:kind==="chunk"?4+Math.random()*7:2+Math.random()*4,
          hue:kind==="smoke"?0:kind==="ember"?10+Math.random()*20:30+Math.random()*15,
          rot:Math.random()*Math.PI,rotV:(Math.random()-0.5)*0.25});
      }
    });
    stateRef.current.particles=initP;

    // Ship bounding box in scene coords (each cell = 80px)
    const minC=Math.min(...cells.map(([,c])=>c));
    const maxC=Math.max(...cells.map(([,c])=>c));
    const minR=Math.min(...cells.map(([r])=>r));
    const maxR=Math.max(...cells.map(([r])=>r));
    const shipCX=(minC+maxC+1)*40, shipCY=(minR+maxR+1)*40;
    const shipW=(maxC-minC+1)*80, shipH=(maxR-minR+1)*80;
    const isHoriz=maxC>minC;

    const animate=()=>{
      const s=stateRef.current;
      ctx.clearRect(0,0,W,H);

      // Dark ocean bg
      ctx.fillStyle=`rgba(3,12,28,${s.alpha})`;ctx.fillRect(0,0,W,H);

      // Ocean surface line
      const waterY=H*0.62+s.waterLevel*H*0.25;
      const grd=ctx.createLinearGradient(0,waterY-20,0,H);
      grd.addColorStop(0,"rgba(5,25,65,0.9)");grd.addColorStop(1,"rgba(2,10,30,0.95)");
      ctx.fillStyle=grd;ctx.fillRect(0,waterY,W,H-waterY);

      // Water shimmer
      ctx.strokeStyle="rgba(30,100,180,0.25)";ctx.lineWidth=1;
      for (let i=0;i<5;i++) {
        const y=waterY+i*8+Math.sin(s.t*2+i)*3;
        ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();
      }

      // Ship body — tilting and sinking
      ctx.save();
      ctx.translate(shipCX,Math.min(shipCY+s.waterLevel*shipH*1.8, waterY+shipH*0.3));
      ctx.rotate(s.tilt);
      const gold=`rgba(180,140,40,${0.85-s.waterLevel*0.7})`;
      const dark=`rgba(50,35,0,${0.9-s.waterLevel*0.5})`;
      const bright=`rgba(220,180,50,${0.9-s.waterLevel*0.7})`;

      if (isHoriz) {
        ctx.fillStyle=gold;
        ctx.beginPath();
        ctx.moveTo(-shipW/2+8,-shipH/2+shipH*0.18);
        ctx.lineTo(shipW/2-12,-shipH/2+shipH*0.12);
        ctx.lineTo(shipW/2-2,0);
        ctx.lineTo(shipW/2-12,shipH/2-shipH*0.12);
        ctx.lineTo(-shipW/2+8,shipH/2-shipH*0.18);
        ctx.lineTo(-shipW/2+2,0);
        ctx.closePath();ctx.fill();
        ctx.strokeStyle=bright;ctx.lineWidth=1.5;ctx.stroke();
        // Superstructure
        ctx.fillStyle=dark;
        ctx.fillRect(-shipW*0.2,-shipH/2,shipW*0.4,shipH*0.45);
        ctx.fillRect(-shipW*0.1,-shipH/2-shipH*0.2,shipW*0.18,shipH*0.25);
        // Funnel smoke (early phase)
        if (s.phase==="explode") {
          ctx.fillStyle="rgba(40,30,20,0.6)";
          ctx.beginPath();ctx.ellipse(0,-shipH/2-shipH*0.3,8,18,0,0,Math.PI*2);ctx.fill();
        }
      } else {
        ctx.fillStyle=gold;
        ctx.beginPath();
        ctx.moveTo(-shipH/2+shipH*0.18,-shipW/2+8);
        ctx.lineTo(-shipH/2+shipH*0.12,shipW/2-12);
        ctx.lineTo(0,shipW/2-2);
        ctx.lineTo(shipH/2-shipH*0.12,shipW/2-12);
        ctx.lineTo(shipH/2-shipH*0.18,-shipW/2+8);
        ctx.lineTo(0,-shipW/2+2);
        ctx.closePath();ctx.fill();
        ctx.strokeStyle=bright;ctx.lineWidth=1.5;ctx.stroke();
      }
      ctx.restore();

      // Particles
      ctx.save();
      stateRef.current.particles=stateRef.current.particles.filter(p=>{
        if (p.life<=0) return false;
        const a=Math.max(0,p.life);
        if (p.kind==="smoke"){
          ctx.beginPath();ctx.arc(p.x,p.y,p.size*(1.8-p.life*0.5),0,Math.PI*2);
          ctx.fillStyle=`rgba(55,40,22,${a*0.3})`;ctx.fill();
        } else if (p.kind==="chunk"){
          ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot||0);
          ctx.fillStyle=`hsla(${p.hue},60%,38%,${a*0.9})`;
          const s2=p.size*a;ctx.fillRect(-s2/2,-s2/2,s2,s2);ctx.restore();
        } else if (p.kind==="ember"){
          ctx.beginPath();ctx.arc(p.x,p.y,Math.max(0.1,p.size*a),0,Math.PI*2);
          ctx.fillStyle=`hsla(${p.hue},100%,${55+p.life*15}%,${a})`;ctx.fill();
        } else {
          ctx.beginPath();ctx.arc(p.x,p.y,Math.max(0.1,p.size*a),0,Math.PI*2);
          ctx.fillStyle=`hsla(${p.hue},88%,65%,${a*0.85})`;ctx.fill();
        }
        p.x+=p.vx||0;p.y+=(p.vy||0)+0.1;p.vx=(p.vx||0)*0.962;p.vy=(p.vy||0)*0.962;
        if (p.rot!==undefined)p.rot+=p.rotV||0;p.life-=p.decay;return true;
      });
      ctx.restore();

      // Ship name
      ctx.font=`bold 16px 'Cinzel', serif`;ctx.textAlign="center";
      ctx.fillStyle=`rgba(212,175,55,${0.8-s.waterLevel*0.6})`;
      ctx.fillText(ship.name.toUpperCase(),W/2,H*0.88);

      // Progress text
      if (s.waterLevel>0.5) {
        ctx.font=`italic 13px 'Crimson Text',serif`;
        ctx.fillStyle=`rgba(180,80,40,${(s.waterLevel-0.5)*2})`;
        ctx.fillText("Going down...",W/2,H*0.93);
      }

      // Fade out
      if (s.phase==="fadeout") {
        ctx.fillStyle=`rgba(3,10,22,${Math.min(1,s.fadeAlpha||0)})`;
        ctx.fillRect(0,0,W,H);
      }

      // Advance state
      s.t+=0.04;
      if (s.phase==="explode") {
        if (s.t>1.5) s.phase="sink";
      } else if (s.phase==="sink") {
        s.waterLevel=Math.min(1,(s.t-1.5)/3.5);
        s.tilt+=(0.35-s.tilt)*0.04;
        if (s.waterLevel>=1) { s.phase="fadeout"; s.fadeAlpha=0; }
      } else if (s.phase==="fadeout") {
        s.fadeAlpha=Math.min(1,(s.fadeAlpha||0)+0.03);
        if (s.fadeAlpha>=1) { cancelAnimationFrame(frameRef.current); onDone(); return; }
      }

      frameRef.current=requestAnimationFrame(animate);
    };
    frameRef.current=requestAnimationFrame(animate);
    return()=>cancelAnimationFrame(frameRef.current);
  },[]);

  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.85)"}}>
      <div style={{position:"relative",marginBottom:16}}>
        <div style={{fontSize:11,color:"rgba(212,175,55,0.5)",letterSpacing:"0.3em",
          textTransform:"uppercase",textAlign:"center",marginBottom:8,fontFamily:"'Cinzel',serif"}}>
          — Sinking —
        </div>
        <canvas ref={ref} width={500} height={320}
          style={{border:"1px solid rgba(212,175,55,0.25)",display:"block"}}/>
      </div>
      <button onClick={onDone} style={{background:"transparent",border:"1px solid rgba(212,175,55,0.3)",
        color:"rgba(212,175,55,0.5)",fontFamily:"'Cinzel',serif",fontSize:10,
        letterSpacing:"0.12em",padding:"5px 14px",cursor:"pointer",textTransform:"uppercase"}}>
        Skip
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHIP SVGS — each one unique
// ─────────────────────────────────────────────────────────────────────────────
function ShipSVG({id,w,h,sunk}) {
  const g=sunk?"rgba(70,30,5,0.8)":"rgba(212,175,55,0.88)";
  const d=sunk?"rgba(30,8,0,0.95)":"rgba(65,45,0,0.95)";
  const b=sunk?"rgba(110,50,10,0.7)":"rgba(255,215,65,1)";
  const flt=sunk?"brightness(0.38) saturate(0.12) drop-shadow(0 3px 8px rgba(255,50,0,0.55))":"drop-shadow(0 0 5px rgba(212,175,55,0.5))";

  if (id==="carrier") return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      <path d={`M8,${h*.55} L${w-9},${h*.48} L${w-2},${h*.7} L${w-9},${h*.88} L8,${h*.9} L2,${h*.72} Z`} fill={g} stroke={b} strokeWidth="1"/>
      <rect x={w*.04} y={h*.26} width={w*.9} height={h*.3} rx="1" fill={d} stroke={b} strokeWidth="0.7"/>
      <rect x={w*.7} y={h*.04} width={w*.14} height={h*.26} rx="1.5" fill={d} stroke={b} strokeWidth="0.8"/>
      <line x1={w*.06} y1={h*.4} x2={w*.68} y2={h*.38} stroke={b} strokeWidth="0.6" strokeDasharray="5,3.5" opacity="0.6"/>
      {[.12,.25,.38,.51,.64].map((x,i)=><rect key={i} x={w*x} y={h*.32} width={7} height={4} rx="1" fill={b} opacity="0.4"/>)}
      <rect x={w*.73} y={h*.07} width={5} height={h*.11} rx="1" fill={d} stroke={b} strokeWidth="0.5"/>
      <rect x={w*.8} y={h*.09} width={4} height={h*.09} rx="1" fill={d} stroke={b} strokeWidth="0.5"/>
      <line x1={w*.77} y1={h*.04} x2={w*.77} y2={0} stroke={b} strokeWidth="1"/>
      <line x1={w*.7} y1={h*.02} x2={w*.84} y2={h*.02} stroke={b} strokeWidth="0.7"/>
    </svg>
  );
  if (id==="battleship") return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      <path d={`M9,${h*.28} L${w-10},${h*.2} L${w-3},${h*.5} L${w-10},${h*.8} L9,${h*.72} L2,${h*.5} Z`} fill={g} stroke={b} strokeWidth="1.2"/>
      <rect x={w*.28} y={h*.13} width={w*.37} height={h*.4} rx="2" fill={d} stroke={b} strokeWidth="0.9"/>
      <rect x={w*.37} y={h*.03} width={w*.17} height={h*.18} rx="1.5" fill={d} stroke={b} strokeWidth="0.8"/>
      <rect x={w*.09} y={h*.4} width={w*.14} height={h*.18} rx="2" fill={d} stroke={b} strokeWidth="0.8"/>
      <rect x={w*.06} y={h*.44} width={w*.13} height={4} rx="2" fill={b} opacity="0.8"/>
      <rect x={w*.06} y={h*.51} width={w*.13} height={4} rx="2" fill={b} opacity="0.8"/>
      <rect x={w*.77} y={h*.4} width={w*.13} height={h*.18} rx="2" fill={d} stroke={b} strokeWidth="0.8"/>
      <rect x={w*.77} y={h*.44} width={w*.13} height={4} rx="2" fill={b} opacity="0.8"/>
      <rect x={w*.77} y={h*.51} width={w*.13} height={4} rx="2" fill={b} opacity="0.8"/>
      <rect x={w*.46} y={h*.06} width={7} height={h*.22} rx="1.5" fill={d} stroke={b} strokeWidth="0.7"/>
      <rect x={w*.56} y={h*.08} width={6} height={h*.18} rx="1.5" fill={d} stroke={b} strokeWidth="0.6"/>
      <line x1={w*.41} y1={h*.03} x2={w*.41} y2={0} stroke={b} strokeWidth="1"/>
      <line x1={w*.34} y1={h*.018} x2={w*.48} y2={h*.018} stroke={b} strokeWidth="0.7"/>
      {[.3,.42,.54,.65].map((x,i)=><circle key={i} cx={w*x} cy={h*.62} r="2.5" fill={b} opacity="0.5"/>)}
    </svg>
  );
  if (id==="cruiser") return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      <path d={`M7,${h*.27} L${w-9},${h*.19} L${w-2},${h*.5} L${w-9},${h*.81} L7,${h*.73} L2,${h*.5} Z`} fill={g} stroke={b} strokeWidth="1.1"/>
      <rect x={w*.23} y={h*.15} width={w*.36} height={h*.38} rx="2" fill={d} stroke={b} strokeWidth="0.9"/>
      <rect x={w*.29} y={h*.04} width={w*.19} height={h*.18} rx="1.5" fill={d} stroke={b} strokeWidth="0.8"/>
      <rect x={w*.48} y={h*.08} width={9} height={h*.27} rx="2.5" fill={d} stroke={b} strokeWidth="0.8"/>
      <rect x={w*.07} y={h*.43} width={w*.13} height={5} rx="2.5" fill={b} opacity="0.82"/>
      <rect x={w*.08} y={h*.38} width={w*.11} height={h*.22} rx="1.5" fill={d} stroke={b} strokeWidth="0.7"/>
      <rect x={w*.73} y={h*.43} width={w*.1} height={4} rx="2" fill={b} opacity="0.7"/>
      <line x1={w*.33} y1={h*.04} x2={w*.33} y2={0} stroke={b} strokeWidth="1"/>
      <line x1={w*.26} y1={h*.02} x2={w*.4} y2={h*.02} stroke={b} strokeWidth="0.7"/>
      {[.27,.39,.51].map((x,i)=><circle key={i} cx={w*x} cy={h*.63} r="2.5" fill={b} opacity="0.5"/>)}
    </svg>
  );
  if (id==="destroyer") return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      <path d={`M6,${h*.28} L${w-7},${h*.17} L${w-1},${h*.5} L${w-7},${h*.83} L6,${h*.72} L1,${h*.5} Z`} fill={g} stroke={b} strokeWidth="1.1"/>
      <rect x={w*.28} y={h*.2} width={w*.32} height={h*.36} rx="1.5" fill={d} stroke={b} strokeWidth="0.8"/>
      <rect x={w*.46} y={h*.1} width={5} height={h*.24} rx="1.5" fill={d} stroke={b} strokeWidth="0.7"/>
      <rect x={w*.07} y={h*.42} width={w*.2} height={5} rx="2.5" fill={b} opacity="0.85"/>
      <rect x={w*.08} y={h*.37} width={w*.13} height={h*.22} rx="1.5" fill={d} stroke={b} strokeWidth="0.7"/>
      <line x1={w*.35} y1={h*.2} x2={w*.35} y2={0} stroke={b} strokeWidth="1"/>
      <line x1={w*.28} y1={h*.04} x2={w*.42} y2={h*.04} stroke={b} strokeWidth="0.7"/>
      {[.32,.44].map((x,i)=><circle key={i} cx={w*x} cy={h*.65} r="2" fill={b} opacity="0.5"/>)}
    </svg>
  );
  if (id==="submarine") return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      <path d={`M${w*.08},${h*.4} Q${w*.03},${h*.5} ${w*.08},${h*.6} L${w*.92},${h*.6} Q${w*.97},${h*.5} ${w*.92},${h*.4} Z`} fill={g} stroke={b} strokeWidth="1.2"/>
      <rect x={w*.36} y={h*.1} width={w*.2} height={h*.32} rx="2.5" fill={d} stroke={b} strokeWidth="0.9"/>
      <line x1={w*.47} y1={h*.1} x2={w*.47} y2={0} stroke={b} strokeWidth="2"/>
      <circle cx={w*.47} cy={3} r="3.5" fill={b} opacity="0.9"/>
      <line x1={w*.4} y1={3} x2={w*.54} y2={3} stroke={b} strokeWidth="1"/>
      <line x1={w*.1} y1={h*.4} x2={w*.9} y2={h*.4} stroke={b} strokeWidth="0.7" opacity="0.38"/>
      <circle cx={w*.06} cy={h*.46} r="3" fill={d} stroke={b} strokeWidth="0.8"/>
      <circle cx={w*.06} cy={h*.54} r="3" fill={d} stroke={b} strokeWidth="0.8"/>
      <path d={`M${w*.17},${h*.4} L${w*.11},${h*.29} L${w*.23},${h*.4}`} fill={g} stroke={b} strokeWidth="0.7"/>
      <path d={`M${w*.79},${h*.6} L${w*.73},${h*.71} L${w*.85},${h*.6}`} fill={g} stroke={b} strokeWidth="0.7"/>
      <path d={`M${w*.86},${h*.4} L${w*.92},${h*.3} L${w*.94},${h*.4}`} fill={g} stroke={b} strokeWidth="0.6"/>
    </svg>
  );
  if (id==="frigate") return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      <path d={`M6,${h*.3} L${w-8},${h*.22} L${w-2},${h*.5} L${w-8},${h*.78} L6,${h*.7} L1,${h*.5} Z`} fill={g} stroke={b} strokeWidth="1"/>
      <rect x={w*.22} y={h*.18} width={w*.3} height={h*.36} rx="1.5" fill={d} stroke={b} strokeWidth="0.8"/>
      <rect x={w*.27} y={h*.06} width={w*.14} height={h*.16} rx="1" fill={d} stroke={b} strokeWidth="0.7"/>
      <rect x={w*.44} y={h*.1} width={6} height={h*.22} rx="1.5" fill={d} stroke={b} strokeWidth="0.6"/>
      {/* Helicopter pad aft */}
      <rect x={w*.65} y={h*.38} width={w*.24} height={h*.22} rx="1" fill={d} stroke={b} strokeWidth="0.7" opacity="0.8"/>
      <line x1={w*.66} y1={h*.49} x2={w*.88} y2={h*.49} stroke={b} strokeWidth="0.5" opacity="0.5"/>
      <line x1={w*.77} y1={h*.39} x2={w*.77} y2={h*.6} stroke={b} strokeWidth="0.5" opacity="0.5"/>
      <rect x={w*.06} y={h*.43} width={w*.11} height={4} rx="2" fill={b} opacity="0.8"/>
      <line x1={w*.31} y1={h*.06} x2={w*.31} y2={0} stroke={b} strokeWidth="1"/>
      <line x1={w*.24} y1={h*.02} x2={w*.38} y2={h*.02} stroke={b} strokeWidth="0.7"/>
    </svg>
  );
  if (id==="gunboat") return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      <path d={`M4,${h*.3} L${w-5},${h*.18} L${w-1},${h*.5} L${w-5},${h*.82} L4,${h*.7} L1,${h*.5} Z`} fill={g} stroke={b} strokeWidth="1.1"/>
      <rect x={w*.3} y={h*.22} width={w*.28} height={h*.34} rx="1.5" fill={d} stroke={b} strokeWidth="0.8"/>
      <rect x={w*.44} y={h*.1} width={4} height={h*.2} rx="1" fill={d} stroke={b} strokeWidth="0.6"/>
      <rect x={w*.07} y={h*.4} width={w*.2} height={5} rx="2.5" fill={b} opacity="0.85"/>
      <rect x={w*.7} y={h*.4} width={w*.17} height={5} rx="2.5" fill={b} opacity="0.7"/>
      <line x1={w*.37} y1={h*.22} x2={w*.37} y2={0} stroke={b} strokeWidth="1.2"/>
      <line x1={w*.3} y1={h*.06} x2={w*.44} y2={h*.06} stroke={b} strokeWidth="0.7"/>
    </svg>
  );
  // minelayer
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      <path d={`M5,${h*.32} L${w-6},${h*.24} L${w-2},${h*.5} L${w-6},${h*.76} L5,${h*.68} L1,${h*.5} Z`} fill={g} stroke={b} strokeWidth="1"/>
      <rect x={w*.26} y={h*.22} width={w*.3} height={h*.32} rx="1.5" fill={d} stroke={b} strokeWidth="0.8"/>
      {/* Mine rollers on stern */}
      {[.65,.74,.83].map((x,i)=><circle key={i} cx={w*x} cy={h*.5} r="5" fill={d} stroke={b} strokeWidth="0.8"/>)}
      {[.65,.74,.83].map((x,i)=><circle key={i} cx={w*x} cy={h*.5} r="2" fill={b} opacity="0.6"/>)}
      <rect x={w*.39} y={h*.12} width={5} height={h*.18} rx="1" fill={d} stroke={b} strokeWidth="0.6"/>
      <line x1={w*.33} y1={h*.22} x2={w*.33} y2={0} stroke={b} strokeWidth="1"/>
      <line x1={w*.26} y1={h*.04} x2={w*.4} y2={h*.04} stroke={b} strokeWidth="0.7"/>
    </svg>
  );
}

function ShipRenderer({shipId,isHoriz,isSunk,w,h}) {
  if (isHoriz) return <ShipSVG id={shipId} w={w} h={h} sunk={isSunk}/>;
  // Vertical: render as horizontal then rotate with CSS
  return (
    <div style={{width:w,height:h,position:"relative",overflow:"visible"}}>
      <div style={{position:"absolute",left:0,top:0,width:h,height:w,
        transform:`rotate(90deg)`,transformOrigin:`${w/2}px ${w/2}px`}}>
        <ShipSVG id={shipId} w={h} h={w} sunk={isSunk}/>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function SettingsScreen({settings,onSave}) {
  const [s,setS]=useState({...settings});
  const toggle=(id)=>{
    const sel=s.ships.includes(id)?s.ships.filter(x=>x!==id):[...s.ships,id];
    if (sel.length>=2) setS(p=>({...p,ships:sel}));
  };
  return (
    <div style={{maxWidth:520,margin:"0 auto",padding:"1.5rem 1rem"}}>
      <div style={{fontSize:10,letterSpacing:"0.3em",color:"rgba(212,175,55,0.4)",textTransform:"uppercase",marginBottom:4,textAlign:"center"}}>Pre-Game</div>
      <h2 style={{fontSize:22,fontWeight:700,color:"#d4af37",margin:"0 0 20px",textAlign:"center",letterSpacing:"0.1em"}}>BRIEFING ROOM</h2>

      <div style={{background:"rgba(0,0,0,0.4)",border:"1px solid rgba(212,175,55,0.18)",padding:"1rem 1.25rem",marginBottom:12}}>
        <div style={{fontSize:10,color:"rgba(212,175,55,0.45)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:12}}>Select Fleet Composition</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
          {SHIP_CATALOGUE.map(ship=>{
            const sel=s.ships.includes(ship.id);
            return (
              <div key={ship.id} onClick={()=>toggle(ship.id)} style={{
                display:"flex",alignItems:"center",gap:8,padding:"7px 10px",cursor:"pointer",
                border:`1px solid ${sel?"rgba(212,175,55,0.45)":"rgba(212,175,55,0.1)"}`,
                background:sel?"rgba(212,175,55,0.08)":"transparent",
                transition:"all 0.15s",borderRadius:2,
              }}>
                <div style={{width:14,height:14,borderRadius:2,border:`1px solid ${sel?"#d4af37":"rgba(212,175,55,0.3)"}`,
                  background:sel?"#d4af37":"transparent",flexShrink:0,
                  display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {sel&&<span style={{fontSize:9,color:"#000",fontWeight:700}}>✓</span>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11,color:sel?"rgba(212,175,55,0.9)":"rgba(212,175,55,0.45)",letterSpacing:"0.05em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ship.name}</div>
                  <div style={{display:"flex",gap:2,marginTop:2}}>
                    {Array.from({length:ship.size}).map((_,i)=>(
                      <div key={i} style={{width:7,height:3,borderRadius:1,background:sel?"rgba(212,175,55,0.6)":"rgba(212,175,55,0.2)"}}/>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{fontSize:10,color:"rgba(212,175,55,0.35)",marginTop:8,fontFamily:"'Crimson Text',serif",fontStyle:"italic"}}>
          {s.ships.length} ships selected — min. 2 required
        </div>
      </div>

      <div style={{background:"rgba(0,0,0,0.4)",border:"1px solid rgba(212,175,55,0.18)",padding:"1rem 1.25rem",marginBottom:12}}>
        <div style={{fontSize:10,color:"rgba(212,175,55,0.45)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:12}}>Visual Effects</div>
        {[
          {key:"sinkingCutscene",label:"Sinking Cutscene",desc:"Full-screen animation when a ship sinks"},
          {key:"hitDebris",label:"Hit Debris & Sparks",desc:"Flying metal chunks on direct hits"},
        ].map(({key,label,desc})=>(
          <div key={key} onClick={()=>setS(p=>({...p,[key]:!p[key]}))} style={{
            display:"flex",alignItems:"center",gap:10,padding:"8px 0",cursor:"pointer",
            borderBottom:"1px solid rgba(212,175,55,0.07)",
          }}>
            <div style={{width:36,height:20,borderRadius:10,position:"relative",flexShrink:0,
              background:s[key]?"rgba(212,175,55,0.35)":"rgba(255,255,255,0.08)",
              border:`1px solid ${s[key]?"rgba(212,175,55,0.6)":"rgba(255,255,255,0.15)"}`,
              transition:"all 0.2s"}}>
              <div style={{width:14,height:14,borderRadius:7,background:s[key]?"#d4af37":"rgba(255,255,255,0.25)",
                position:"absolute",top:2,left:s[key]?19:2,transition:"all 0.2s"}}/>
            </div>
            <div>
              <div style={{fontSize:11,color:"rgba(212,175,55,0.85)",letterSpacing:"0.05em"}}>{label}</div>
              <div style={{fontSize:10,color:"rgba(212,175,55,0.35)",fontFamily:"'Crimson Text',serif"}}>{desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{background:"rgba(0,0,0,0.4)",border:"1px solid rgba(212,175,55,0.18)",padding:"1rem 1.25rem",marginBottom:16}}>
        <div style={{fontSize:10,color:"rgba(212,175,55,0.45)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:12}}>Rules of Engagement</div>
        {[
          "Each player deploys their fleet on a 10×10 grid",
          "Players alternate firing at enemy coordinates",
          "A hit is marked ✕ in red — a miss marked in blue",
          "When all cells of a ship are hit, it sinks",
          "First to sink the entire enemy fleet wins",
          "Right-click during placement to rotate a ship",
        ].map((rule,i)=>(
          <div key={i} style={{display:"flex",gap:10,marginBottom:7,alignItems:"flex-start"}}>
            <div style={{width:16,height:16,borderRadius:"50%",background:"rgba(212,175,55,0.12)",
              border:"1px solid rgba(212,175,55,0.25)",display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:9,color:"rgba(212,175,55,0.6)",flexShrink:0,marginTop:1}}>{i+1}</div>
            <div style={{fontSize:11,color:"rgba(212,175,55,0.6)",lineHeight:1.5,fontFamily:"'Crimson Text',serif"}}>{rule}</div>
          </div>
        ))}
      </div>

      <button onClick={()=>onSave(s)} style={{
        width:"100%",padding:"10px 0",background:"rgba(212,175,55,0.1)",
        border:"1px solid rgba(212,175,55,0.45)",color:"#d4af37",
        fontFamily:"'Cinzel',serif",fontSize:12,letterSpacing:"0.15em",
        cursor:"pointer",textTransform:"uppercase",transition:"all 0.2s",
      }}
      onMouseEnter={e=>e.target.style.background="rgba(212,175,55,0.2)"}
      onMouseLeave={e=>e.target.style.background="rgba(212,175,55,0.1)"}>
        ⚔ Deploy Fleet
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BOARD
// ─────────────────────────────────────────────────────────────────────────────
function Board({grid,isAi,interactive,phase,hoverCells,hoverValid,onHover,onLeave,onPlace,onFire,sunkShips,particlesRef,label,size}) {
  const W=size*CELL,H=size*CELL;
  const cols=Array.from({length:size},(_,i)=>COLS[i]||String.fromCharCode(75+i));
  const shipMap={};
  const showShips=!isAi||phase==="won"||phase==="lost";
  if (showShips) grid.forEach(row=>row.forEach(cell=>{if(cell.ship){if(!shipMap[cell.ship])shipMap[cell.ship]=[];shipMap[cell.ship].push([cell.r,cell.c]);}}));

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
      <div style={{fontSize:10,color:isAi?"rgba(200,70,50,0.65)":"rgba(212,175,55,0.45)",letterSpacing:"0.22em",textTransform:"uppercase",marginBottom:5,fontFamily:"'Cinzel',serif"}}>{label}</div>
      <div style={{display:"flex",paddingLeft:20}}>
        {cols.map(c=><div key={c} style={{width:CELL,textAlign:"center",fontSize:9,color:"rgba(212,175,55,0.3)",fontFamily:"'Cinzel',serif",marginBottom:2}}>{c}</div>)}
      </div>
      <div style={{display:"flex"}}>
        <div style={{display:"flex",flexDirection:"column"}}>
          {Array.from({length:size},(_,i)=><div key={i} style={{height:CELL,width:18,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"rgba(212,175,55,0.3)",fontFamily:"'Cinzel',serif"}}>{i+1}</div>)}
        </div>
        <div style={{position:"relative",width:W,height:H,overflow:"hidden"}}>
          <WaterCanvas width={W} height={H} size={size}/>
          <div style={{position:"absolute",inset:0,zIndex:2,background:"rgba(3,12,25,0.52)",border:"1px solid rgba(212,175,55,0.17)",boxSizing:"border-box",pointerEvents:"none"}}/>
          <svg style={{position:"absolute",inset:0,zIndex:3,pointerEvents:"none"}} width={W} height={H}>
            {Array.from({length:size+1}).map((_,i)=>(
              <g key={i}>
                <line x1={i*CELL} y1={0} x2={i*CELL} y2={H} stroke="rgba(212,175,55,0.07)" strokeWidth="0.5"/>
                <line x1={0} y1={i*CELL} x2={W} y2={i*CELL} stroke="rgba(212,175,55,0.07)" strokeWidth="0.5"/>
              </g>
            ))}
          </svg>

          {Object.entries(shipMap).map(([shipId,cells])=>{
            if (!cells.length) return null;
            const minR=Math.min(...cells.map(([r])=>r)),minC=Math.min(...cells.map(([,c])=>c));
            const maxR=Math.max(...cells.map(([r])=>r)),maxC=Math.max(...cells.map(([,c])=>c));
            const isHoriz=maxC>minC||(maxC===minC&&maxR===minR);
            const isSunk=sunkShips.includes(shipId);
            const sw=(maxC-minC+1)*CELL-4,sh=(maxR-minR+1)*CELL-4;
            return (
              <div key={shipId} style={{position:"absolute",left:minC*CELL+2,top:minR*CELL+2,width:sw,height:sh,zIndex:isSunk?6:5,pointerEvents:"none",
                opacity:isSunk?0.35:1,transition:"opacity 1.5s ease",
                filter:isSunk?"saturate(0.1) brightness(0.5)":"none"}}>
                <ShipRenderer shipId={shipId} isHoriz={isHoriz} isSunk={isSunk} w={sw} h={sh}/>
              </div>
            );
          })}

          {!isAi&&phase==="place"&&Array.from(hoverCells).map(key=>{
            const [r,c]=key.split(",").map(Number);
            return <div key={key} style={{position:"absolute",left:c*CELL,top:r*CELL,width:CELL,height:CELL,zIndex:8,
              background:hoverValid?"rgba(212,175,55,0.18)":"rgba(200,50,30,0.22)",
              border:`1px solid ${hoverValid?"rgba(212,175,55,0.55)":"rgba(200,50,30,0.55)"}`}}/>;
          })}

          {grid.map(row=>row.map(cell=>{
            if (!cell.hit&&!cell.miss) return null;
            const sk=cell.ship&&sunkShips.includes(cell.ship);
            return (
              <div key={`m${cell.r},${cell.c}`} style={{position:"absolute",left:cell.c*CELL,top:cell.r*CELL,width:CELL,height:CELL,zIndex:9,display:"flex",alignItems:"center",justifyContent:"center"}}>
                {cell.hit?(
                  <div style={{width:CELL-10,height:CELL-10,borderRadius:"50%",
                    background:sk?"rgba(155,28,6,0.5)":"rgba(195,52,16,0.32)",
                    border:`2px solid ${sk?"rgba(255,65,12,0.95)":"rgba(255,105,32,0.68)"}`,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    boxShadow:sk?"0 0 14px rgba(255,55,0,0.5)":"none"}}>
                    <svg width="14" height="14" viewBox="0 0 14 14">
                      <line x1="2.5" y1="2.5" x2="11.5" y2="11.5" stroke={sk?"#ff4010":"#ff7028"} strokeWidth="2.5" strokeLinecap="round"/>
                      <line x1="11.5" y1="2.5" x2="2.5" y2="11.5" stroke={sk?"#ff4010":"#ff7028"} strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  </div>
                ):(
                  <div style={{width:7,height:7,borderRadius:"50%",background:"rgba(85,140,205,0.45)",border:"1px solid rgba(105,160,225,0.42)"}}/>
                )}
              </div>
            );
          }))}

          {grid.map(row=>row.map(cell=>(
            <div key={`c${cell.r},${cell.c}`} style={{position:"absolute",left:cell.c*CELL,top:cell.r*CELL,width:CELL,height:CELL,zIndex:11,
              cursor:isAi&&interactive&&!cell.hit&&!cell.miss?"crosshair":!isAi&&phase==="place"?"pointer":"default"}}
              onClick={()=>{if(isAi&&interactive)onFire(cell.r,cell.c);if(!isAi&&phase==="place")onPlace(cell.r,cell.c);}}
              onContextMenu={(e)=>{e.preventDefault();if(!isAi&&phase==="place")onPlace(cell.r,cell.c,true);}}
              onMouseEnter={()=>!isAi&&onHover(cell.r,cell.c)}
              onMouseLeave={()=>!isAi&&onLeave()}
            />
          )))}
          <ExplosionCanvas particlesRef={particlesRef} width={W} height={H}/>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
export default function Battleships() {
  const [screen,setScreen]=useState("settings"); // settings | place | battle | won | lost
  const [settings,setSettings]=useState(DEFAULT_SETTINGS);
  const [activeShips,setActiveShips]=useState([]);
  const [playerGrid,setPlayerGrid]=useState(()=>emptyGrid());
  const [aiGrid,setAiGrid]=useState(()=>emptyGrid());
  const [placingIdx,setPlacingIdx]=useState(0);
  const [horiz,setHoriz]=useState(true);
  const [hoverCell,setHoverCell]=useState(null);
  const [placedShips,setPlacedShips]=useState([]);
  const [aiState,setAiState]=useState({mode:"hunt",targets:[],hits:[]});
  const [playerTurn,setPlayerTurn]=useState(true);
  const [sunkByPlayer,setSunkByPlayer]=useState([]);
  const [sunkByAi,setSunkByAi]=useState([]);
  const [events,setEvents]=useState([]);
  const [cutscene,setCutscene]=useState(null); // {ship,cells}
  const [pendingAfterCutscene,setPendingAfterCutscene]=useState(null);
  const [shotsFired,setShotsFired]=useState(0);
  const [gameStartTime,setGameStartTime]=useState(null);
  const [winSubmitted,setWinSubmitted]=useState(false);
  const aiTimerRef=useRef(null);
  const playerFxRef=useRef({add:()=>{}});
  const aiFxRef=useRef({add:()=>{}});

  const pushEvent=(msg,color)=>{
    const id=Date.now()+Math.random();
    setEvents(e=>[...e.slice(-2),{id,msg,color}]);
    setTimeout(()=>setEvents(e=>e.filter(ev=>ev.id!==id)),3500);
  };

  const submitWin=useCallback(async()=>{
    if (winSubmitted) return;
    setWinSubmitted(true);
    const timeSeconds=gameStartTime?Math.floor((Date.now()-gameStartTime)/1000):0;
    try {
      const res=await api.post('/battleships/win',{
        shots_fired:shotsFired,
        ships_lost:sunkByAi.length,
        time_seconds:timeSeconds,
      });
      if (res.data?.reward) {
        toast.success(`Victory! +$${res.data.reward.cash.toLocaleString()} +${res.data.reward.respect} Respect`);
      }
    } catch (err) {
      const msg=err?.response?.data?.detail||'Failed to record win';
      if (!msg.includes('limit')) toast.error(msg);
    }
  },[winSubmitted,gameStartTime,shotsFired,sunkByAi.length]);

  useEffect(()=>{
    if (screen==="won"&&!winSubmitted) submitWin();
  },[screen,winSubmitted,submitWin]);

  const handleSaveSettings=(s)=>{
    const ships=SHIP_CATALOGUE.filter(sh=>s.ships.includes(sh.id));
    setSettings(s); setActiveShips(ships);
    setPlayerGrid(emptyGrid()); setAiGrid(autoPlaceAll(ships));
    setPlacingIdx(0); setHoriz(true); setHoverCell(null); setPlacedShips([]);
    setAiState({mode:"hunt",targets:[],hits:[]}); setPlayerTurn(true);
    setSunkByPlayer([]); setSunkByAi([]); setEvents([]); setCutscene(null);
    setShotsFired(0); setGameStartTime(null); setWinSubmitted(false);
    setScreen("place");
  };

  const currentShip=activeShips[placingIdx];

  const getHoverCells=()=>{
    if (!hoverCell||placingIdx>=activeShips.length) return new Set();
    const cells=new Set();
    for (let i=0;i<currentShip.size;i++) {
      const r=horiz?hoverCell.r:hoverCell.r+i,c=horiz?hoverCell.c+i:hoverCell.c;
      if (r<GRID&&c<GRID) cells.add(`${r},${c}`);
    }
    return cells;
  };
  const hoverValid=hoverCell&&placingIdx<activeShips.length?canPlace(playerGrid,currentShip,hoverCell.r,hoverCell.c,horiz):null;

  const handleAutoPlace=()=>{
    setPlayerGrid(autoPlaceAll(activeShips));
    setPlacedShips(activeShips.map(s=>s.id));
    setPlacingIdx(activeShips.length);
  };
  const handlePlace=(r,c,forceRotate=false)=>{
    if (forceRotate) { setHoriz(h=>!h); return; }
    if (placingIdx>=activeShips.length) return;
    if (!canPlace(playerGrid,currentShip,r,c,horiz)) return;
    setPlayerGrid(placeShip(playerGrid,currentShip,r,c,horiz));
    setPlacedShips(p=>[...p,currentShip.id]);
    setPlacingIdx(i=>i+1);
  };

  const fireAndProcess=(r,c,grid,setGrid,isPlayer,sunkList,setSunk,fxRef,oppGrid,setOppGrid,allShips)=>{
    const cell=grid[r][c]; if (cell.hit||cell.miss) return false;
    const isHit=!!cell.ship;
    if (settings.hitDebris) fxRef.current.add(isHit?makeHitExplosion(c*CELL+CELL/2,r*CELL+CELL/2):makeMissExplosion(c*CELL+CELL/2,r*CELL+CELL/2));
    const ng=grid.map(row=>row.map(cl=>cl.r===r&&cl.c===c?{...cl,hit:isHit,miss:!isHit}:cl));
    setGrid(ng);
    const newSunk=allShips.filter(s=>isShipSunk(ng,s.id)&&!sunkList.includes(s.id));
    if (newSunk.length>0) {
      setSunk(p=>[...p,...newSunk.map(s=>s.id)]);
      newSunk.forEach(ship=>{
        const cells=getShipCells(ng,ship.id);
        setTimeout(()=>fxRef.current.add(makeSunkVolley(cells)),250);
        pushEvent(isPlayer?`You sunk their ${ship.name}!`:`They sunk your ${ship.name}!`, isPlayer?"#d4af37":"#e05050");
        if (settings.sinkingCutscene) {
          const pending={result:allSunk(ng,allShips)?isPlayer?"won":"lost":null};
          setCutscene({ship,cells:cells.map(([rr,cc])=>[rr,cc])});
          setPendingAfterCutscene(pending);
          return; // defer win/lose
        } else if (allSunk(ng,allShips)) { setScreen(isPlayer?"won":"lost"); }
      });
      return "sunk";
    }
    pushEvent(isPlayer?(isHit?"Direct hit!":"Splash — no contact"):(isHit?"They found you!":"They missed!"),
      isHit?isPlayer?"#e08040":"#e05050":isPlayer?"#4080b0":"#50a070");
    if (allSunk(ng,allShips)) { setScreen(isPlayer?"won":"lost"); return "end"; }
    return isHit?"hit":"miss";
  };

  const handleFireAtAi=(r,c)=>{
    if (!playerTurn||screen!=="battle") return;
    const res=fireAndProcess(r,c,aiGrid,setAiGrid,true,sunkByPlayer,setSunkByPlayer,aiFxRef,playerGrid,setPlayerGrid,activeShips);
    if (res===false) return;
    setShotsFired(s=>s+1);
    if (res!=="sunk"||!settings.sinkingCutscene) setPlayerTurn(false);
    else setPlayerTurn(false); // AI goes after cutscene dismiss
  };

  const handleCutsceneDone=()=>{
    const p=pendingAfterCutscene;
    setCutscene(null); setPendingAfterCutscene(null);
    if (p?.result) setScreen(p.result);
  };

  useEffect(()=>{
    if (screen!=="battle"||playerTurn||cutscene) return;
    aiTimerRef.current=setTimeout(()=>{
      const {r,c,newTargets,newMode}=aiShot(aiState,playerGrid);
      const cell=playerGrid[r][c]; const isHit=!!cell.ship;
      if (settings.hitDebris) playerFxRef.current.add(isHit?makeHitExplosion(c*CELL+CELL/2,r*CELL+CELL/2):makeMissExplosion(c*CELL+CELL/2,r*CELL+CELL/2));
      const ng=playerGrid.map(row=>row.map(cl=>cl.r===r&&cl.c===c?{...cl,hit:isHit,miss:!isHit}:cl));
      let ut=newTargets,um=newMode;
      if (isHit){ut=addTargets(newTargets,r,c,playerGrid);um="target";}
      const ns=activeShips.filter(s=>isShipSunk(ng,s.id)&&!sunkByAi.includes(s.id));
      if (ns.length>0) {
        setSunkByAi(p=>[...p,...ns.map(s=>s.id)]);
        ns.forEach(ship=>{
          const cells=getShipCells(ng,ship.id);
          setTimeout(()=>playerFxRef.current.add(makeSunkVolley(cells)),250);
          pushEvent(`They sunk your ${ship.name}!`,"#e05050");
          if (settings.sinkingCutscene) { setCutscene({ship,cells}); setPendingAfterCutscene({result:allSunk(ng,activeShips)?"lost":null}); }
          else if (allSunk(ng,activeShips)) setScreen("lost");
        });
        ut=[];um="hunt";
      } else { pushEvent(isHit?"They found you!":"They missed!",isHit?"#e05050":"#50a070"); }
      setAiState({mode:um,targets:ut,hits:[...aiState.hits,[r,c]]});
      setPlayerGrid(ng);
      if (!settings.sinkingCutscene&&allSunk(ng,activeShips)){setScreen("lost");return;}
      setPlayerTurn(true);
    },settings.aiDelay);
    return()=>clearTimeout(aiTimerRef.current);
  },[playerTurn,screen,cutscene]);

  const resetToSettings=()=>setScreen("settings");

  const playerLeft=activeShips.filter(s=>!sunkByAi.includes(s.id)).length;
  const aiLeft=activeShips.filter(s=>!sunkByPlayer.includes(s.id)).length;

  return (
    <div style={{minHeight:"100vh",background:"var(--noir-background,#060810)",
      backgroundImage:"radial-gradient(ellipse at 50% -10%,rgba(15,45,90,0.38) 0%,transparent 65%)",
      display:"flex",flexDirection:"column",alignItems:"center",
      padding:"1.5rem 1rem 2.5rem",fontFamily:"'Cinzel',serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
        @keyframes ev-in{0%{opacity:0;transform:translateY(-10px)}12%{opacity:1;transform:none}80%{opacity:1}100%{opacity:0}}
        @keyframes tglow{0%,100%{text-shadow:0 0 25px rgba(212,175,55,0.25)}50%{text-shadow:0 0 45px rgba(212,175,55,0.55),0 0 80px rgba(212,175,55,0.18)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        .nb{background:rgba(212,175,55,0.07);border:1px solid rgba(212,175,55,0.32);color:#d4af37;
          font-family:'Cinzel',serif;font-size:11px;letter-spacing:0.1em;padding:7px 16px;
          cursor:pointer;transition:all 0.2s;text-transform:uppercase;}
        .nb:hover{background:rgba(212,175,55,0.16);border-color:rgba(212,175,55,0.6);}
        .nb:disabled{opacity:0.28;cursor:default;}
        .fr{display:flex;align-items:center;gap:8px;padding:4px 8px;margin-bottom:3px;border:1px solid transparent;border-radius:2px;transition:all 0.15s;}
        .fr.active{border-color:rgba(212,175,55,0.38);background:rgba(212,175,55,0.07);}
        .fr.gone{opacity:0.2;}
      `}</style>

      {/* Title */}
      <div style={{textAlign:"center",marginBottom:"1.2rem"}}>
        <div style={{fontSize:10,letterSpacing:"0.35em",color:"rgba(212,175,55,0.38)",marginBottom:4,textTransform:"uppercase"}}>The Family's Navy</div>
        <h1 style={{fontSize:30,fontWeight:900,color:"#d4af37",margin:0,letterSpacing:"0.1em",textTransform:"uppercase",animation:"tglow 4s ease-in-out infinite"}}>Rum Runner</h1>
        <div style={{fontSize:11,color:"rgba(212,175,55,0.28)",letterSpacing:"0.14em",marginTop:4,fontFamily:"'Crimson Text',serif",fontStyle:"italic"}}>Sink the Feds before they sink you</div>
      </div>

      {/* SETTINGS */}
      {screen==="settings"&&<SettingsScreen settings={settings} onSave={handleSaveSettings}/>}

      {/* PLACEMENT */}
      {screen==="place"&&(
        <div style={{display:"flex",gap:24,flexWrap:"wrap",justifyContent:"center",alignItems:"flex-start",animation:"fadeIn 0.3s ease"}}>
          <div>
            <div style={{fontSize:10,color:"rgba(212,175,55,0.5)",letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:8,textAlign:"center"}}>
              {placingIdx<activeShips.length?`Deploy: ${currentShip.name} (${currentShip.size} cells)`:"Fleet Ready — Engage"}
            </div>
            <Board grid={playerGrid} isAi={false} interactive={false} phase="place"
              hoverCells={getHoverCells()} hoverValid={hoverValid}
              onHover={(r,c)=>setHoverCell({r,c})} onLeave={()=>setHoverCell(null)}
              onPlace={handlePlace} onFire={null}
              sunkShips={[]} particlesRef={playerFxRef} label="Your Waters" size={GRID}/>
            <div style={{marginTop:10,display:"flex",gap:8,flexWrap:"wrap"}}>
              <button className="nb" onClick={()=>setHoriz(h=>!h)} disabled={placingIdx>=activeShips.length}>↺ {horiz?"Horiz":"Vert"}</button>
              <button className="nb" onClick={handleAutoPlace}>⚡ Auto</button>
              <button className="nb" disabled={placedShips.length<activeShips.length} onClick={()=>{setScreen("battle");setGameStartTime(Date.now());setShotsFired(0);setWinSubmitted(false);}}>⚔ Go to War</button>
              <button className="nb" onClick={resetToSettings} style={{borderColor:"rgba(212,175,55,0.18)",color:"rgba(212,175,55,0.45)"}}>⚙ Settings</button>
            </div>
          </div>
          <div style={{minWidth:155,paddingTop:22}}>
            <div style={{fontSize:9,color:"rgba(212,175,55,0.38)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:10}}>Your Fleet</div>
            {activeShips.map((ship,i)=>(
              <div key={ship.id} className={`fr${i===placingIdx?" active":""}`}>
                <div style={{flex:1}}>
                  <div style={{fontSize:11,color:placedShips.includes(ship.id)?"rgba(212,175,55,0.3)":"rgba(212,175,55,0.88)",letterSpacing:"0.05em"}}>{ship.name}</div>
                  <div style={{display:"flex",gap:2,marginTop:2}}>
                    {Array.from({length:ship.size}).map((_,j)=>(
                      <div key={j} style={{width:8,height:4,borderRadius:1,background:placedShips.includes(ship.id)?"rgba(212,175,55,0.2)":"rgba(212,175,55,0.6)"}}/>
                    ))}
                  </div>
                </div>
                {placedShips.includes(ship.id)&&<span style={{fontSize:12,color:"#639922"}}>✓</span>}
              </div>
            ))}
            <div style={{marginTop:10,fontSize:10,color:"rgba(212,175,55,0.3)",fontFamily:"'Crimson Text',serif",fontStyle:"italic",lineHeight:1.5}}>
              Right-click to rotate
            </div>
          </div>
        </div>
      )}

      {/* BATTLE */}
      {(screen==="battle"||screen==="won"||screen==="lost")&&(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,width:"100%",maxWidth:1120,animation:"fadeIn 0.3s ease"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",maxWidth:990,
            padding:"7px 18px",background:"rgba(0,0,0,0.55)",border:"1px solid rgba(212,175,55,0.12)"}}>
            <div style={{fontSize:11,color:"rgba(212,175,55,0.55)"}}>Your ships: <span style={{color:"#d4af37",fontWeight:700}}>{playerLeft}</span></div>
            <div style={{fontSize:12,letterSpacing:"0.1em",fontWeight:600,
              color:screen==="won"?"#d4af37":screen==="lost"?"#e05050":playerTurn?"#d4af37":"rgba(212,175,55,0.4)"}}>
              {screen==="won"?"✦ VICTORY":screen==="lost"?"✕ DEFEATED":playerTurn?"▶ YOUR MOVE":"⧗ INCOMING..."}
            </div>
            <div style={{fontSize:11,color:"rgba(212,175,55,0.55)"}}>Fed ships: <span style={{color:"#e05c5c",fontWeight:700}}>{aiLeft}</span></div>
          </div>

          <div style={{minHeight:22,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            {events.map(ev=>(
              <div key={ev.id} style={{fontSize:13,color:ev.color,letterSpacing:"0.08em",fontFamily:"'Crimson Text',serif",fontStyle:"italic",
                animation:"ev-in 3.5s ease forwards",textShadow:`0 0 10px ${ev.color}`}}>{ev.msg}</div>
            ))}
          </div>

          <div style={{display:"flex",gap:16,flexWrap:"wrap",justifyContent:"center",alignItems:"flex-start"}}>
            <Board grid={playerGrid} isAi={false} interactive={false} phase={screen}
              hoverCells={new Set()} hoverValid={false}
              onHover={()=>{}} onLeave={()=>{}} onPlace={()=>{}} onFire={null}
              sunkShips={sunkByAi} particlesRef={playerFxRef} label="Your Waters" size={GRID}/>

            <div style={{minWidth:125,paddingTop:22,display:"flex",flexDirection:"column",gap:14}}>
              <div>
                <div style={{fontSize:9,color:"rgba(212,175,55,0.3)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:6}}>Your Fleet</div>
                {activeShips.map(ship=>(
                  <div key={ship.id} className={`fr${sunkByAi.includes(ship.id)?" gone":""}`}>
                    <div style={{width:6,height:6,borderRadius:"50%",flexShrink:0,background:sunkByAi.includes(ship.id)?"#e05050":"#d4af37"}}/>
                    <span style={{fontSize:10,color:sunkByAi.includes(ship.id)?"rgba(224,80,80,0.4)":"rgba(212,175,55,0.7)"}}>{ship.name}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{fontSize:9,color:"rgba(200,70,50,0.4)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:6}}>Fed Fleet</div>
                {activeShips.map(ship=>(
                  <div key={ship.id} className={`fr${sunkByPlayer.includes(ship.id)?" gone":""}`}>
                    <div style={{width:6,height:6,borderRadius:"50%",flexShrink:0,background:sunkByPlayer.includes(ship.id)?"#639922":"rgba(200,70,50,0.4)"}}/>
                    <span style={{fontSize:10,color:sunkByPlayer.includes(ship.id)?"rgba(99,153,34,0.75)":"rgba(200,70,50,0.4)"}}>{ship.name}</span>
                  </div>
                ))}
              </div>
              {(screen==="won"||screen==="lost")&&(
                <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:4}}>
                  <button className="nb" onClick={()=>handleSaveSettings(settings)}>New Game</button>
                  <button className="nb" onClick={resetToSettings} style={{fontSize:10,opacity:0.6}}>⚙ Settings</button>
                </div>
              )}
            </div>

            <Board grid={aiGrid} isAi={true} interactive={playerTurn&&screen==="battle"} phase={screen}
              hoverCells={new Set()} hoverValid={false}
              onHover={()=>{}} onLeave={()=>{}} onPlace={()=>{}} onFire={handleFireAtAi}
              sunkShips={sunkByPlayer} particlesRef={aiFxRef} label="Fed Waters" size={GRID}/>
          </div>

          {(screen==="won"||screen==="lost")&&(
            <div style={{marginTop:10,textAlign:"center",padding:"1.25rem 2.5rem",background:"rgba(4,7,12,0.97)",
              border:`1px solid ${screen==="won"?"rgba(212,175,55,0.4)":"rgba(192,57,43,0.4)"}`,maxWidth:480}}>
              <div style={{fontSize:22,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",
                color:screen==="won"?"#d4af37":"#c0392b",
                textShadow:`0 0 25px ${screen==="won"?"rgba(212,175,55,0.45)":"rgba(192,57,43,0.45)"}`}}>
                {screen==="won"?"The Feds Are Sunk":"Your Fleet Is Gone"}
              </div>
              <div style={{fontSize:13,marginTop:8,fontFamily:"'Crimson Text',serif",fontStyle:"italic",lineHeight:1.6,
                color:screen==="won"?"rgba(212,175,55,0.55)":"rgba(192,57,43,0.65)"}}>
                {screen==="won"?"The rum runs free tonight. The Don raises a glass to your name."
                  :"Prohibition wins this round. The Feds got their man."}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SINKING CUTSCENE OVERLAY */}
      {cutscene&&<SinkingCutscene ship={cutscene.ship} cells={cutscene.cells} onDone={handleCutsceneDone}/>}
    </div>
  );
}
