import { useState, useRef, useEffect, useCallback } from "react";
import api from '../../utils/api';
import { toast } from 'sonner';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS & SHIP CATALOGUE
// ─────────────────────────────────────────────────────────────────────────────
const GRID = 10;
// CELL size is now dynamic — computed at runtime via useCellSize()
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
  difficulty: "normal",
};

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSIVE CELL SIZE HOOK
// ─────────────────────────────────────────────────────────────────────────────
function useCellSize() {
  const [cell, setCell] = useState(44);
  useEffect(() => {
    const update = () => {
      // On mobile (<= 600px), fit two grids side by side with labels & padding
      // On tablet (601–900px), slightly smaller
      // On desktop, keep 44
      const w = window.innerWidth;
      if (w <= 480) {
        // Single grid = (w - 48px padding - 20px row-label) / 10 cols, but
        // we show grids stacked so use full width for one grid
        setCell(Math.floor((w - 48 - 22) / 10));
      } else if (w <= 700) {
        setCell(Math.floor((w - 48 - 22) / 10));
      } else if (w <= 1000) {
        // Two grids side by side — each gets roughly half
        setCell(Math.floor((w / 2 - 48) / 10));
      } else {
        setCell(44);
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return Math.max(28, Math.min(44, cell)); // clamp 28–44
}

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
// AI — difficulty-aware (easy / normal / hard)
// ─────────────────────────────────────────────────────────────────────────────
function aiShot(aiState, playerGrid, difficulty="normal", size=GRID) {
  const {mode,targets,direction}=aiState;

  // Easy: purely random, no target tracking
  if (difficulty==="easy") {
    const avail=[];
    for (let i=0;i<size;i++) for (let j=0;j<size;j++)
      if (!playerGrid[i][j].hit&&!playerGrid[i][j].miss) avail.push([i,j]);
    if (!avail.length) return {r:0,c:0,newTargets:[],newMode:"hunt"};
    // Easy occasionally skips good shots — 25% chance to pick from non-checkerboard
    const pick=avail[Math.floor(Math.random()*avail.length)];
    return {r:pick[0],c:pick[1],newTargets:[],newMode:"hunt"};
  }

  // Normal & Hard: target-mode with queued cells
  if (mode==="target"&&targets.length>0) {
    const [r,c]=targets[0];
    return {r,c,newTargets:targets.slice(1),newMode:targets.length>1?"target":"hunt",direction};
  }

  // Hunt mode
  const avail=[];
  if (difficulty==="hard") {
    // Hard: use smallest unsunk ship size for optimal spacing
    const unsunkSizes=[];
    for (let i=0;i<size;i++) for (let j=0;j<size;j++) {
      const s=playerGrid[i][j].ship;
      if (s&&!playerGrid[i][j].hit) {
        const shipCat=SHIP_CATALOGUE.find(sh=>sh.id===s);
        if (shipCat&&!unsunkSizes.includes(shipCat.size)) unsunkSizes.push(shipCat.size);
      }
    }
    const minSize=unsunkSizes.length>0?Math.min(...unsunkSizes):2;
    for (let i=0;i<size;i++) for (let j=0;j<size;j++)
      if (!playerGrid[i][j].hit&&!playerGrid[i][j].miss&&(i+j)%minSize===0) avail.push([i,j]);
  } else {
    for (let i=0;i<size;i++) for (let j=0;j<size;j++)
      if (!playerGrid[i][j].hit&&!playerGrid[i][j].miss&&(i+j)%2===0) avail.push([i,j]);
  }
  if (!avail.length) for (let i=0;i<size;i++) for (let j=0;j<size;j++)
    if (!playerGrid[i][j].hit&&!playerGrid[i][j].miss) avail.push([i,j]);
  if (!avail.length) return {r:0,c:0,newTargets:[],newMode:"hunt"};
  const [r,c]=avail[Math.floor(Math.random()*avail.length)];
  return {r,c,newTargets:[],newMode:"hunt"};
}

function addTargets(targets, r, c, grid, difficulty="normal", firstHit=null, size=GRID) {
  const dirs=[[-1,0],[1,0],[0,-1],[0,1]];
  let candidates=dirs.map(([dr,dc])=>[r+dr,c+dc])
    .filter(([nr,nc])=>nr>=0&&nr<size&&nc>=0&&nc<size&&!grid[nr][nc].hit&&!grid[nr][nc].miss);

  if (difficulty==="hard"&&firstHit) {
    // Lock onto the detected axis when we have 2+ hits in a line
    const dr=r-firstHit[0], dc=c-firstHit[1];
    if (dr!==0||dc!==0) {
      const axis=Math.abs(dr)>0?"v":"h";
      candidates=candidates.filter(([nr,nc])=>
        axis==="v"?nc===c:nr===r
      );
      if (candidates.length===0) {
        candidates=dirs.map(([ddr,ddc])=>[r+ddr,c+ddc])
          .filter(([nr,nc])=>nr>=0&&nr<size&&nc>=0&&nc<size&&!grid[nr][nc].hit&&!grid[nr][nc].miss);
      }
    }
  }
  return [...targets,...candidates];
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLE FACTORIES — accept CELL as argument
// ─────────────────────────────────────────────────────────────────────────────
function makeHitExplosion(cx,cy,CELL) {
  const p=[];
  p.push({kind:"ring",x:cx,y:cy,life:1,decay:0.04,size:2,r:CELL*0.6});
  for (let i=0;i<60;i++) {
    const angle=(Math.PI*2*i)/60+(Math.random()-0.5)*0.8;
    const spd=2.5+Math.random()*6;
    const kind=i%6===0?"ember":i%4===0?"smoke":"spark";
    p.push({kind,x:cx,y:cy,vx:Math.cos(angle)*spd,vy:Math.sin(angle)*spd-(Math.random()*3),
      life:1,decay:0.012+Math.random()*0.02,
      size:kind==="smoke"?8+Math.random()*10:1.5+Math.random()*3,
      hue:kind==="ember"?15+Math.random()*25:kind==="smoke"?0:35+Math.random()*15});
  }
  for (let i=0;i<12;i++) {
    const angle=Math.random()*Math.PI*2;
    const spd=3+Math.random()*8;
    p.push({kind:"chunk",x:cx,y:cy,vx:Math.cos(angle)*spd,vy:Math.sin(angle)*spd-3-Math.random()*4,
      life:1,decay:0.015+Math.random()*0.02,size:2+Math.random()*4,
      rot:Math.random()*Math.PI,rotV:(Math.random()-0.5)*0.3,hue:30+Math.random()*20});
  }
  return p;
}

function makeMissExplosion(cx,cy,CELL) {
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

function makeSunkVolley(cells,CELL) {
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
function WaterCanvas({width,height,size,CELL}) {
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
  },[width,height,size,CELL]);
  return <canvas ref={ref} width={width} height={height} style={{position:"absolute",top:0,left:0,pointerEvents:"none",zIndex:1}}/>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SINKING CUTSCENE - Enhanced with proper ship rendering and smooth animations
// ─────────────────────────────────────────────────────────────────────────────
function SinkingCutscene({ship,cells,onDone}) {
  const ref=useRef(null);
  const frameRef=useRef(null);
  const stateRef=useRef({
    t:0,particles:[],bubbles:[],splashes:[],
    waterLevel:0,tilt:0,tiltVel:0,shipY:0,shipYVel:0,
    alpha:1,phase:"explode",smokeTrails:[]
  });

  // Easing functions for smooth animations
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
  const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);

  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");
    const W=canvas.width,H=canvas.height;

    // Calculate ship dimensions - center in canvas
    const minC=Math.min(...cells.map(([,c])=>c));
    const maxC=Math.max(...cells.map(([,c])=>c));
    const minR=Math.min(...cells.map(([r])=>r));
    const maxR=Math.max(...cells.map(([r])=>r));
    const isHoriz=maxC>minC||(maxC===minC&&maxR===minR);
    const shipSize = ship.size;
    
    // Ship dimensions scaled to fit nicely in the canvas
    const shipScale = Math.min(W*0.7, H*0.5) / (shipSize * 40);
    const shipW = isHoriz ? shipSize * 40 * shipScale : 40 * shipScale;
    const shipH = isHoriz ? 40 * shipScale : shipSize * 40 * shipScale;
    const shipCX = W/2;
    const waterBaseY = H * 0.48; // Water starts near middle
    const shipStartY = waterBaseY - shipH * 0.3; // Ship starts floating ON the water

    // Initialize explosion particles centered on ship
    const initP=[];
    for (let i=0;i<100;i++) {
      const ox = (Math.random()-0.5) * shipW * 0.8;
      const oy = (Math.random()-0.5) * shipH * 0.8;
      const angle=Math.random()*Math.PI*2;
      const spd=1.5+Math.random()*6;
      const kind=i%6===0?"ember":i%5===0?"smoke":i%8===0?"chunk":"spark";
      initP.push({
        kind,x:shipCX+ox,y:shipStartY+oy,
        vx:Math.cos(angle)*spd,vy:Math.sin(angle)*spd-2-Math.random()*4,
        life:1,decay:0.004+Math.random()*0.008, // Slower decay for longer-lasting particles
        size:kind==="smoke"?16+Math.random()*24:kind==="chunk"?5+Math.random()*8:2+Math.random()*4,
        hue:kind==="smoke"?0:kind==="ember"?8+Math.random()*25:28+Math.random()*18,
        rot:Math.random()*Math.PI,rotV:(Math.random()-0.5)*0.15
      });
    }
    stateRef.current.particles=initP;
    stateRef.current.shipY = shipStartY;

    // Draw detailed ship based on ship type
    function drawShip(ctx, cx, cy, w, h, horiz, shipId, alpha, damage) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalAlpha = alpha;
      
      const gold = `rgb(${180-damage*60},${140-damage*40},${40-damage*20})`;
      const dark = `rgb(${50-damage*20},${35-damage*15},0)`;
      const bright = `rgb(${220-damage*70},${180-damage*50},${50-damage*25})`;
      const fireGlow = damage > 0 ? `rgba(255,${100-damage*50},0,${damage*0.4})` : 'transparent';
      
      if (horiz) {
        // Hull
        ctx.fillStyle = gold;
        ctx.beginPath();
        ctx.moveTo(-w/2+w*0.05, -h*0.35);
        ctx.lineTo(w/2-w*0.08, -h*0.4);
        ctx.quadraticCurveTo(w/2+w*0.02, 0, w/2-w*0.08, h*0.4);
        ctx.lineTo(-w/2+w*0.05, h*0.35);
        ctx.quadraticCurveTo(-w/2-w*0.02, 0, -w/2+w*0.05, -h*0.35);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = bright;
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Deck details
        ctx.fillStyle = dark;
        const deckW = w * 0.5;
        const deckH = h * 0.5;
        ctx.fillRect(-deckW/2, -deckH/2, deckW, deckH);
        ctx.strokeStyle = bright;
        ctx.lineWidth = 1;
        ctx.strokeRect(-deckW/2, -deckH/2, deckW, deckH);
        
        // Bridge/superstructure
        if (shipId === "carrier" || shipId === "battleship" || shipId === "cruiser") {
          ctx.fillStyle = dark;
          ctx.fillRect(w*0.1, -h*0.6, w*0.15, h*0.35);
          ctx.strokeStyle = bright;
          ctx.strokeRect(w*0.1, -h*0.6, w*0.15, h*0.35);
          // Mast
          ctx.beginPath();
          ctx.moveTo(w*0.175, -h*0.6);
          ctx.lineTo(w*0.175, -h*0.9);
          ctx.strokeStyle = bright;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        
        // Gun turrets for battleships
        if (shipId === "battleship" || shipId === "cruiser" || shipId === "destroyer") {
          ctx.fillStyle = dark;
          ctx.beginPath();
          ctx.arc(-w*0.25, 0, h*0.2, 0, Math.PI*2);
          ctx.fill();
          ctx.strokeStyle = bright;
          ctx.stroke();
          // Gun barrel
          ctx.fillStyle = bright;
          ctx.fillRect(-w*0.25, -h*0.05, w*0.15, h*0.1);
        }
        
        // Submarine conning tower
        if (shipId === "submarine") {
          ctx.fillStyle = dark;
          ctx.fillRect(-w*0.05, -h*0.7, w*0.1, h*0.4);
          ctx.strokeStyle = bright;
          ctx.strokeRect(-w*0.05, -h*0.7, w*0.1, h*0.4);
          // Periscope
          ctx.beginPath();
          ctx.moveTo(0, -h*0.7);
          ctx.lineTo(0, -h*1.0);
          ctx.strokeStyle = bright;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        
        // Fire/damage glow
        if (damage > 0.1) {
          ctx.fillStyle = fireGlow;
          ctx.beginPath();
          ctx.ellipse(0, -h*0.3, w*0.3*damage, h*0.5*damage, 0, 0, Math.PI*2);
          ctx.fill();
        }
      } else {
        // Vertical orientation - rotate the ship
        ctx.rotate(Math.PI/2);
        // Same hull but swapped dimensions
        ctx.fillStyle = gold;
        ctx.beginPath();
        ctx.moveTo(-h/2+h*0.05, -w*0.35);
        ctx.lineTo(h/2-h*0.08, -w*0.4);
        ctx.quadraticCurveTo(h/2+h*0.02, 0, h/2-h*0.08, w*0.4);
        ctx.lineTo(-h/2+h*0.05, w*0.35);
        ctx.quadraticCurveTo(-h/2-h*0.02, 0, -h/2+h*0.05, -w*0.35);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = bright;
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.fillStyle = dark;
        ctx.fillRect(-h*0.25, -w*0.25, h*0.5, w*0.5);
      }
      
      ctx.restore();
    }

    // Add bubble particle
    function addBubble(x, y) {
      stateRef.current.bubbles.push({
        x, y,
        vx: (Math.random()-0.5)*0.4,
        vy: -0.8-Math.random()*1.5,
        size: 2+Math.random()*5,
        life: 1,
        decay: 0.01+Math.random()*0.008 // Slower decay
      });
    }

    // Add splash particle
    function addSplash(x, y) {
      const angle = -Math.PI/2 + (Math.random()-0.5)*1.2;
      const spd = 1.5+Math.random()*3;
      stateRef.current.splashes.push({
        x, y,
        vx: Math.cos(angle)*spd,
        vy: Math.sin(angle)*spd,
        size: 3+Math.random()*6,
        life: 1,
        decay: 0.018+Math.random()*0.015 // Slower decay
      });
    }

    // Add smoke trail
    function addSmokeTrail(x, y) {
      stateRef.current.smokeTrails.push({
        x, y,
        vx: (Math.random()-0.5)*0.25,
        vy: -0.4-Math.random()*0.8,
        size: 10+Math.random()*15,
        life: 1,
        decay: 0.006+Math.random()*0.004 // Slower decay
      });
    }

    const animate=()=>{
      const s=stateRef.current;
      ctx.clearRect(0,0,W,H);
      
      // Sky gradient
      const skyGrad = ctx.createLinearGradient(0,0,0,H*0.6);
      skyGrad.addColorStop(0, "rgb(3,8,20)");
      skyGrad.addColorStop(1, "rgb(8,20,45)");
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0,0,W,H);
      
      // Water level rises during sink phase
      const waterY = waterBaseY - s.waterLevel * H * 0.15;
      
      // Water gradient
      const waterGrad=ctx.createLinearGradient(0,waterY,0,H);
      waterGrad.addColorStop(0,"rgba(10,40,80,0.95)");
      waterGrad.addColorStop(0.3,"rgba(5,25,60,0.97)");
      waterGrad.addColorStop(1,"rgba(2,12,35,0.99)");
      ctx.fillStyle=waterGrad;
      ctx.fillRect(0,waterY,W,H-waterY);
      
      // Animated waves
      ctx.strokeStyle="rgba(40,120,200,0.2)";
      ctx.lineWidth=1.5;
      for (let i=0;i<6;i++) {
        const waveY = waterY + i*12;
        ctx.beginPath();
        for (let x=0;x<=W;x+=10) {
          const y = waveY + Math.sin(s.t*1.5 + x*0.02 + i*0.8)*4;
          if (x===0) ctx.moveTo(x,y);
          else ctx.lineTo(x,y);
        }
        ctx.stroke();
      }
      
      // Calculate ship position with smooth physics
      // Sink progress: starts after explosion (t > 1.5), takes about 3.5 seconds to complete
      const sinkProgress = s.phase === "sink" ? easeInOutSine(Math.min(1, (s.t - 1.5) / 3.5)) : 0;
      const targetY = shipStartY + sinkProgress * H * 0.45; // Sink into the water
      
      // Smooth ship movement
      s.shipYVel += (targetY - s.shipY) * 0.02;
      s.shipYVel *= 0.92;
      s.shipY += s.shipYVel;
      
      // Smooth tilt with slight oscillation
      const targetTilt = s.phase === "sink" ? 0.3 + Math.sin(s.t*0.8)*0.05 : Math.sin(s.t*2)*0.02;
      s.tiltVel += (targetTilt - s.tilt) * 0.03;
      s.tiltVel *= 0.9;
      s.tilt += s.tiltVel;
      
      // Draw ship
      const shipAlpha = Math.max(0, 1 - sinkProgress * 0.7);
      const damage = Math.min(1, s.t * 0.15);
      ctx.save();
      ctx.translate(shipCX, s.shipY);
      ctx.rotate(s.tilt);
      drawShip(ctx, 0, 0, shipW, shipH, isHoriz, ship.id, shipAlpha, damage);
      ctx.restore();
      
      // Generate bubbles during sinking
      if (s.phase === "sink" && s.shipY > waterY && Math.random() < 0.4) {
        addBubble(shipCX + (Math.random()-0.5)*shipW*0.6, s.shipY + shipH*0.3);
      }
      
      // Generate splashes when ship hits water
      if (s.phase === "sink" && s.shipY > waterY - 10 && s.shipY < waterY + 30 && Math.random() < 0.3) {
        addSplash(shipCX + (Math.random()-0.5)*shipW, waterY);
      }
      
      // Generate smoke trails
      if (s.phase === "explode" || (s.phase === "sink" && s.t < 4)) {
        if (Math.random() < 0.25) {
          addSmokeTrail(shipCX + (Math.random()-0.5)*shipW*0.5, s.shipY - shipH*0.3);
        }
      }
      
      // Draw and update bubbles (behind water surface)
      s.bubbles = s.bubbles.filter(b => {
        if (b.life <= 0 || b.y < waterY - 20) return false;
        const a = b.life * 0.6;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size, 0, Math.PI*2);
        ctx.fillStyle = `rgba(100,180,255,${a*0.3})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(150,200,255,${a*0.5})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        b.x += b.vx + Math.sin(s.t*3+b.x*0.1)*0.3;
        b.y += b.vy;
        b.life -= b.decay;
        return true;
      });
      
      // Draw and update explosion particles
      s.particles = s.particles.filter(p=>{
        if (p.life<=0) return false;
        const a=Math.max(0,p.life);
        if (p.kind==="smoke"){
          const r = p.size*(1.8-p.life*0.5);
          ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);
          ctx.fillStyle=`rgba(50,35,20,${a*0.35})`;ctx.fill();
        } else if (p.kind==="chunk"){
          ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot||0);
          ctx.fillStyle=`hsla(${p.hue},55%,35%,${a*0.9})`;
          const sz=p.size*a;ctx.fillRect(-sz/2,-sz/2,sz,sz);
          ctx.restore();
        } else if (p.kind==="ember"){
          ctx.beginPath();ctx.arc(p.x,p.y,Math.max(0.1,p.size*a),0,Math.PI*2);
          ctx.fillStyle=`hsla(${p.hue},100%,${50+p.life*20}%,${a})`;ctx.fill();
          // Glow
          ctx.beginPath();ctx.arc(p.x,p.y,p.size*a*2,0,Math.PI*2);
          ctx.fillStyle=`hsla(${p.hue},100%,50%,${a*0.2})`;ctx.fill();
        } else {
          ctx.beginPath();ctx.arc(p.x,p.y,Math.max(0.1,p.size*a),0,Math.PI*2);
          ctx.fillStyle=`hsla(${p.hue},85%,60%,${a*0.85})`;ctx.fill();
        }
        p.x+=p.vx||0;p.y+=(p.vy||0)+0.12;
        p.vx=(p.vx||0)*0.97;p.vy=(p.vy||0)*0.97;
        if (p.rot!==undefined)p.rot+=p.rotV||0;
        p.life-=p.decay;
        return true;
      });
      
      // Draw smoke trails
      s.smokeTrails = s.smokeTrails.filter(sm => {
        if (sm.life <= 0) return false;
        const a = sm.life;
        const r = sm.size * (2 - sm.life * 0.7);
        ctx.beginPath();ctx.arc(sm.x, sm.y, r, 0, Math.PI*2);
        ctx.fillStyle = `rgba(40,30,25,${a*0.25})`;ctx.fill();
        sm.x += sm.vx;
        sm.y += sm.vy;
        sm.life -= sm.decay;
        return true;
      });
      
      // Draw splashes (on top of water)
      s.splashes = s.splashes.filter(sp => {
        if (sp.life <= 0) return false;
        const a = sp.life;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(sp.x - sp.vx*3, sp.y - sp.vy*3);
        ctx.strokeStyle = `rgba(150,200,255,${a*0.7})`;
        ctx.lineWidth = sp.size * 0.5;
        ctx.stroke();
        ctx.beginPath();ctx.arc(sp.x, sp.y, sp.size*0.4, 0, Math.PI*2);
        ctx.fillStyle = `rgba(180,220,255,${a*0.5})`;ctx.fill();
        sp.x += sp.vx;
        sp.y += sp.vy + 0.15;
        sp.vy *= 0.96;
        sp.life -= sp.decay;
        return true;
      });
      
      // Ship name with glow
      ctx.save();
      ctx.font = `bold ${Math.round(W*0.04)}px 'Cinzel', serif`;
      ctx.textAlign = "center";
      const textAlpha = Math.max(0, 0.9 - sinkProgress * 0.6);
      ctx.shadowColor = "rgba(212,175,55,0.5)";
      ctx.shadowBlur = 10;
      ctx.fillStyle = `rgba(212,175,55,${textAlpha})`;
      ctx.fillText(ship.name.toUpperCase(), W/2, H*0.88);
      ctx.restore();
      
      // "Going down..." text with fade in
      if (sinkProgress > 0.3) {
        const msgAlpha = easeOutQuad(Math.min(1, (sinkProgress - 0.3) * 2));
        ctx.font = `italic ${Math.round(W*0.03)}px 'Crimson Text', serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = `rgba(180,80,40,${msgAlpha})`;
        ctx.fillText("Going down...", W/2, H*0.93);
      }
      
      // Fadeout overlay
      if (s.phase === "fadeout") {
        ctx.fillStyle = `rgba(3,10,22,${easeOutCubic(Math.min(1, s.fadeAlpha||0))})`;
        ctx.fillRect(0,0,W,H);
      }
      
      // Phase transitions - total ~6 seconds
      // At 60fps: 0.017 per frame = 1.0 per second of real time
      s.t += 0.017;
      if (s.phase === "explode") {
        // Explosion phase: ~1.5 seconds
        if (s.t > 1.5) s.phase = "sink";
      } else if (s.phase === "sink") {
        // Sink phase: ~3.5 seconds (sinkProgress goes from 0 to 1 over t=1.5 to t=5.0)
        const sinkProg = Math.min(1, (s.t - 1.5) / 3.5);
        if (sinkProg >= 0.98) { s.phase = "fadeout"; s.fadeAlpha = 0; }
      } else if (s.phase === "fadeout") {
        // Fadeout: ~1 second
        s.fadeAlpha = (s.fadeAlpha||0) + 0.018;
        if (s.fadeAlpha >= 1) { cancelAnimationFrame(frameRef.current); onDone(); return; }
      }
      
      frameRef.current = requestAnimationFrame(animate);
    };
    
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  },[ship, cells, onDone]);

  // Responsive canvas size
  const cw = Math.min(520, window.innerWidth - 32);
  const ch = Math.round(cw * 0.68);

  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.92)",
      padding:"0 16px",backdropFilter:"blur(4px)"}}>
      <div style={{position:"relative",marginBottom:16}}>
        <div style={{fontSize:12,color:"rgba(212,175,55,0.6)",letterSpacing:"0.35em",
          textTransform:"uppercase",textAlign:"center",marginBottom:10,fontFamily:"'Cinzel',serif",
          textShadow:"0 0 20px rgba(212,175,55,0.3)"}}>
          — Ship Sinking —
        </div>
        <canvas ref={ref} width={cw} height={ch}
          style={{border:"1px solid rgba(212,175,55,0.3)",borderRadius:4,
            display:"block",width:cw,height:ch,
            boxShadow:"0 0 40px rgba(0,0,0,0.5), inset 0 0 60px rgba(0,0,0,0.3)"}}/>
      </div>
      <button onClick={onDone} style={{background:"rgba(212,175,55,0.08)",
        border:"1px solid rgba(212,175,55,0.35)",borderRadius:4,
        color:"rgba(212,175,55,0.7)",fontFamily:"'Cinzel',serif",fontSize:11,
        letterSpacing:"0.15em",padding:"10px 28px",cursor:"pointer",textTransform:"uppercase",
        WebkitTapHighlightColor:"transparent",transition:"all 0.2s",
        boxShadow:"0 2px 10px rgba(0,0,0,0.3)"}}>
        Skip
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHIP SVGS - Enhanced with realistic details, gradients, and effects
// ─────────────────────────────────────────────────────────────────────────────
function ShipSVG({id,w,h,sunk}) {
  const gradId = `hull-grad-${id}-${Math.random().toString(36).substr(2,9)}`;
  const deckGradId = `deck-grad-${id}-${Math.random().toString(36).substr(2,9)}`;
  const fireGradId = `fire-grad-${id}-${Math.random().toString(36).substr(2,9)}`;
  
  const gold = sunk ? "rgb(70,30,5)" : "rgb(200,165,45)";
  const goldLight = sunk ? "rgb(90,45,10)" : "rgb(235,200,80)";
  const goldDark = sunk ? "rgb(45,18,0)" : "rgb(145,110,20)";
  const dark = sunk ? "rgb(30,8,0)" : "rgb(55,40,0)";
  const darkLight = sunk ? "rgb(50,20,5)" : "rgb(80,60,10)";
  const bright = sunk ? "rgb(110,50,10)" : "rgb(255,215,65)";
  const flt = sunk 
    ? "brightness(0.42) saturate(0.15) drop-shadow(0 4px 12px rgba(255,60,0,0.6))"
    : "drop-shadow(0 2px 6px rgba(0,0,0,0.4)) drop-shadow(0 0 8px rgba(212,175,55,0.35))";

  const waveColor = sunk ? "rgba(60,30,10,0.4)" : "rgba(100,180,220,0.35)";
  const portHoleColor = sunk ? "rgba(80,30,5,0.8)" : "rgba(30,60,90,0.7)";

  // Common defs for gradients
  const commonDefs = (
    <defs>
      <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor={goldLight}/>
        <stop offset="50%" stopColor={gold}/>
        <stop offset="100%" stopColor={goldDark}/>
      </linearGradient>
      <linearGradient id={deckGradId} x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor={darkLight}/>
        <stop offset="100%" stopColor={dark}/>
      </linearGradient>
      {sunk && (
        <radialGradient id={fireGradId} cx="50%" cy="30%" r="60%">
          <stop offset="0%" stopColor="rgba(255,200,50,0.8)"/>
          <stop offset="40%" stopColor="rgba(255,100,20,0.6)"/>
          <stop offset="100%" stopColor="rgba(180,40,0,0)"/>
        </radialGradient>
      )}
    </defs>
  );

  // Wave ripples component
  const WaveRipples = ({cx, w: rw}) => (
    <g opacity="0.5">
      <ellipse cx={cx} cy={h*0.75} rx={rw*0.5} ry={h*0.08} fill="none" stroke={waveColor} strokeWidth="0.8"/>
      <ellipse cx={cx} cy={h*0.8} rx={rw*0.6} ry={h*0.06} fill="none" stroke={waveColor} strokeWidth="0.6"/>
      <ellipse cx={cx} cy={h*0.84} rx={rw*0.7} ry={h*0.04} fill="none" stroke={waveColor} strokeWidth="0.4"/>
    </g>
  );

  // Fire effect for sunk ships
  const FireEffect = () => sunk ? (
    <g>
      <ellipse cx={w*0.35} cy={h*0.15} rx={w*0.15} ry={h*0.25} fill={`url(#${fireGradId})`}/>
      <ellipse cx={w*0.55} cy={h*0.2} rx={w*0.12} ry={h*0.2} fill={`url(#${fireGradId})`}/>
      <ellipse cx={w*0.45} cy={h*0.1} rx={w*0.08} ry={h*0.15} fill="rgba(255,220,100,0.5)"/>
    </g>
  ) : null;

  if (id==="carrier") return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      {commonDefs}
      <WaveRipples cx={w*0.5} w={w*0.9}/>
      {/* Hull with gradient */}
      <path d={`M8,${h*.52} Q4,${h*.65} 8,${h*.88} L${w-9},${h*.85} Q${w-2},${h*.68} ${w-9},${h*.5} Z`} 
        fill={`url(#${gradId})`} stroke={bright} strokeWidth="1.2"/>
      {/* Hull waterline detail */}
      <path d={`M10,${h*.7} L${w-10},${h*.68}`} stroke={goldDark} strokeWidth="1" opacity="0.6"/>
      {/* Flight deck */}
      <rect x={w*.03} y={h*.24} width={w*.92} height={h*.32} rx="1" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.8"/>
      {/* Deck markings - runway lines */}
      <line x1={w*.05} y1={h*.4} x2={w*.7} y2={h*.38} stroke={bright} strokeWidth="0.8" strokeDasharray="8,4" opacity="0.5"/>
      <line x1={w*.08} y1={h*.32} x2={w*.65} y2={h*.3} stroke={bright} strokeWidth="0.5" opacity="0.3"/>
      {/* Aircraft spots */}
      {[.1,.22,.35,.48,.61].map((x,i)=>(
        <g key={i}>
          <rect x={w*x} y={h*.3} width={9} height={5} rx="1" fill={bright} opacity="0.35"/>
          <rect x={w*x+2} y={h*.31} width={5} height={3} rx="0.5" fill={dark} opacity="0.5"/>
        </g>
      ))}
      {/* Island/superstructure */}
      <rect x={w*.68} y={h*.02} width={w*.16} height={h*.28} rx="2" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.9"/>
      <rect x={w*.71} y={h*.05} width={6} height={h*.12} rx="1" fill={dark} stroke={bright} strokeWidth="0.5"/>
      <rect x={w*.78} y={h*.07} width={5} height={h*.1} rx="1" fill={dark} stroke={bright} strokeWidth="0.5"/>
      {/* Radar/antenna array */}
      <line x1={w*.755} y1={h*.02} x2={w*.755} y2={-2} stroke={bright} strokeWidth="1.2"/>
      <line x1={w*.68} y1={0} x2={w*.83} y2={0} stroke={bright} strokeWidth="0.8"/>
      <circle cx={w*.755} cy={-4} r="2" fill={bright} opacity="0.7"/>
      {/* Bridge windows */}
      {[.06,.11,.16].map((y,i)=>(
        <rect key={i} x={w*.72} y={h*y} width={3} height={2} rx="0.5" fill={portHoleColor}/>
      ))}
      {/* Portholes along hull */}
      {[.15,.28,.42,.55,.68].map((x,i)=>(
        <circle key={i} cx={w*x} cy={h*.62} r="2" fill={portHoleColor} stroke={bright} strokeWidth="0.4"/>
      ))}
      <FireEffect/>
    </svg>
  );

  if (id==="battleship") return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      {commonDefs}
      <WaveRipples cx={w*0.5} w={w*0.85}/>
      {/* Hull */}
      <path d={`M9,${h*.25} Q3,${h*.5} 9,${h*.75} L${w-10},${h*.78} Q${w-2},${h*.5} ${w-10},${h*.22} Z`} 
        fill={`url(#${gradId})`} stroke={bright} strokeWidth="1.4"/>
      <path d={`M12,${h*.52} L${w-12},${h*.5}`} stroke={goldDark} strokeWidth="1.2" opacity="0.5"/>
      {/* Main superstructure */}
      <rect x={w*.26} y={h*.1} width={w*.4} height={h*.45} rx="2.5" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="1"/>
      {/* Bridge tower */}
      <rect x={w*.35} y={h*.01} width={w*.2} height={h*.2} rx="2" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.9"/>
      <rect x={w*.39} y={h*.04} width={w*.12} height={h*.08} rx="1" fill={dark}/>
      {/* Bridge windows */}
      {[.38,.43,.48,.52].map((x,i)=>(
        <rect key={i} x={w*x} y={h*.05} width={3} height={2} rx="0.5" fill={portHoleColor}/>
      ))}
      {/* Forward turret */}
      <ellipse cx={w*.12} cy={h*.48} rx={w*.08} ry={h*.12} fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="1"/>
      <rect x={w*.04} y={h*.44} width={w*.16} height={h*.08} rx="2" fill={bright} opacity="0.85"/>
      <rect x={w*.02} y={h*.46} width={w*.08} height={h*.04} rx="1" fill={goldDark}/>
      {/* Aft turret */}
      <ellipse cx={w*.82} cy={h*.48} rx={w*.08} ry={h*.12} fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="1"/>
      <rect x={w*.74} y={h*.44} width={w*.16} height={h*.08} rx="2" fill={bright} opacity="0.85"/>
      <rect x={w*.84} y={h*.46} width={w*.08} height={h*.04} rx="1" fill={goldDark}/>
      {/* Secondary turrets */}
      <rect x={w*.44} y={h*.04} width={8} height={h*.25} rx="2" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.8"/>
      <rect x={w*.55} y={h*.06} width={7} height={h*.2} rx="1.5" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.7"/>
      {/* Mast */}
      <line x1={w*.39} y1={h*.01} x2={w*.39} y2={-4} stroke={bright} strokeWidth="1.5"/>
      <line x1={w*.32} y1={-2} x2={w*.46} y2={-2} stroke={bright} strokeWidth="0.8"/>
      {/* Portholes */}
      {[.18,.3,.42,.54,.66,.78].map((x,i)=>(
        <circle key={i} cx={w*x} cy={h*.66} r="2.5" fill={portHoleColor} stroke={bright} strokeWidth="0.4"/>
      ))}
      {/* Deck details */}
      {[.28,.38,.48,.58].map((x,i)=>(
        <rect key={i} x={w*x} y={h*.56} width={4} height={2} rx="0.5" fill={bright} opacity="0.4"/>
      ))}
      <FireEffect/>
    </svg>
  );

  if (id==="cruiser") return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      {commonDefs}
      <WaveRipples cx={w*0.5} w={w*0.8}/>
      {/* Hull */}
      <path d={`M7,${h*.24} Q2,${h*.5} 7,${h*.76} L${w-9},${h*.8} Q${w-2},${h*.5} ${w-9},${h*.2} Z`} 
        fill={`url(#${gradId})`} stroke={bright} strokeWidth="1.2"/>
      <path d={`M10,${h*.52} L${w-10},${h*.5}`} stroke={goldDark} strokeWidth="1" opacity="0.5"/>
      {/* Superstructure */}
      <rect x={w*.21} y={h*.12} width={w*.4} height={h*.42} rx="2" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="1"/>
      {/* Bridge */}
      <rect x={w*.27} y={h*.02} width={w*.22} height={h*.2} rx="1.5" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.9"/>
      {/* Bridge windows */}
      {[.29,.35,.41,.46].map((x,i)=>(
        <rect key={i} x={w*x} y={h*.05} width={2.5} height={2} rx="0.5" fill={portHoleColor}/>
      ))}
      {/* Funnel/stack */}
      <rect x={w*.46} y={h*.06} width={10} height={h*.3} rx="3" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.9"/>
      <ellipse cx={w*.49} cy={h*.06} rx={5} ry={2} fill={dark} stroke={bright} strokeWidth="0.5"/>
      {/* Forward gun */}
      <ellipse cx={w*.1} cy={h*.46} rx={w*.07} ry={h*.1} fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.9"/>
      <rect x={w*.05} y={h*.43} width={w*.12} height={5} rx="2.5" fill={bright} opacity="0.85"/>
      {/* Aft guns */}
      <rect x={w*.72} y={h*.42} width={w*.12} height={4} rx="2" fill={bright} opacity="0.75"/>
      {/* Mast */}
      <line x1={w*.31} y1={h*.02} x2={w*.31} y2={-3} stroke={bright} strokeWidth="1.2"/>
      <line x1={w*.24} y1={-1} x2={w*.38} y2={-1} stroke={bright} strokeWidth="0.8"/>
      {/* Portholes */}
      {[.15,.28,.42,.55,.68,.8].map((x,i)=>(
        <circle key={i} cx={w*x} cy={h*.64} r="2" fill={portHoleColor} stroke={bright} strokeWidth="0.4"/>
      ))}
      {/* Railings */}
      <line x1={w*.08} y1={h*.22} x2={w*.18} y2={h*.22} stroke={bright} strokeWidth="0.4" opacity="0.5"/>
      <line x1={w*.75} y1={h*.24} x2={w*.9} y2={h*.24} stroke={bright} strokeWidth="0.4" opacity="0.5"/>
      <FireEffect/>
    </svg>
  );

  if (id==="destroyer") return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      {commonDefs}
      <WaveRipples cx={w*0.5} w={w*0.75}/>
      {/* Hull - sleek destroyer shape */}
      <path d={`M6,${h*.25} Q1,${h*.5} 6,${h*.75} L${w-7},${h*.82} Q${w-1},${h*.5} ${w-7},${h*.18} Z`} 
        fill={`url(#${gradId})`} stroke={bright} strokeWidth="1.2"/>
      <path d={`M9,${h*.52} L${w-9},${h*.5}`} stroke={goldDark} strokeWidth="0.9" opacity="0.5"/>
      {/* Superstructure */}
      <rect x={w*.26} y={h*.16} width={w*.36} height={h*.4} rx="2" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.9"/>
      {/* Bridge */}
      <rect x={w*.32} y={h*.04} width={w*.18} height={h*.18} rx="1.5" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.8"/>
      {/* Bridge windows */}
      {[.34,.4,.46].map((x,i)=>(
        <rect key={i} x={w*x} y={h*.07} width={2} height={1.5} rx="0.4" fill={portHoleColor}/>
      ))}
      {/* Funnel */}
      <rect x={w*.44} y={h*.08} width={6} height={h*.26} rx="1.5" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.7"/>
      {/* Forward gun mount */}
      <ellipse cx={w*.12} cy={h*.44} rx={w*.08} ry={h*.1} fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.8"/>
      <rect x={w*.05} y={h*.41} width={w*.22} height={5} rx="2.5" fill={bright} opacity="0.88"/>
      {/* Aft torpedo tubes */}
      <rect x={w*.65} y={h*.38} width={w*.18} height={h*.2} rx="1" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.7"/>
      {[.67,.73,.79].map((x,i)=>(
        <rect key={i} x={w*x} y={h*.42} width={3} height={h*.12} rx="1" fill={dark} stroke={bright} strokeWidth="0.4"/>
      ))}
      {/* Mast */}
      <line x1={w*.35} y1={h*.04} x2={w*.35} y2={-2} stroke={bright} strokeWidth="1.1"/>
      <line x1={w*.28} y1={h*.02} x2={w*.42} y2={h*.02} stroke={bright} strokeWidth="0.7"/>
      {/* Portholes */}
      {[.18,.35,.52,.7].map((x,i)=>(
        <circle key={i} cx={w*x} cy={h*.62} r="1.8" fill={portHoleColor} stroke={bright} strokeWidth="0.3"/>
      ))}
      <FireEffect/>
    </svg>
  );

  if (id==="submarine") return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      {commonDefs}
      {/* Underwater effect - subtle waves */}
      <ellipse cx={w*0.5} cy={h*0.7} rx={w*0.45} ry={h*0.06} fill="none" stroke={waveColor} strokeWidth="0.6" opacity="0.4"/>
      {/* Main hull - smooth submarine shape */}
      <ellipse cx={w*0.5} cy={h*0.5} rx={w*0.44} ry={h*0.22} fill={`url(#${gradId})`} stroke={bright} strokeWidth="1.3"/>
      {/* Hull details - horizontal lines */}
      <path d={`M${w*.08},${h*.5} L${w*.92},${h*.5}`} stroke={goldDark} strokeWidth="0.8" opacity="0.4"/>
      <path d={`M${w*.12},${h*.38} L${w*.88},${h*.38}`} stroke={bright} strokeWidth="0.5" opacity="0.3"/>
      <path d={`M${w*.12},${h*.62} L${w*.88},${h*.62}`} stroke={bright} strokeWidth="0.5" opacity="0.3"/>
      {/* Conning tower */}
      <rect x={w*.34} y={h*.08} width={w*.24} height={h*.35} rx="3" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="1"/>
      <rect x={w*.38} y={h*.12} width={w*.16} height={h*.18} rx="2" fill={dark}/>
      {/* Periscope */}
      <line x1={w*.46} y1={h*.08} x2={w*.46} y2={-3} stroke={bright} strokeWidth="2.5"/>
      <ellipse cx={w*.46} cy={-5} rx="4" ry="3" fill={bright} opacity="0.9"/>
      <line x1={w*.38} y1={-3} x2={w*.54} y2={-3} stroke={bright} strokeWidth="1"/>
      {/* Conning tower windows */}
      {[.14,.2,.26].map((y,i)=>(
        <rect key={i} x={w*.44} y={h*y} width={4} height={2} rx="0.5" fill={portHoleColor}/>
      ))}
      {/* Bow torpedo tubes */}
      <circle cx={w*.06} cy={h*.46} r="3.5" fill={dark} stroke={bright} strokeWidth="0.9"/>
      <circle cx={w*.06} cy={h*.54} r="3.5" fill={dark} stroke={bright} strokeWidth="0.9"/>
      <circle cx={w*.06} cy={h*.46} r="1.5" fill={goldDark}/>
      <circle cx={w*.06} cy={h*.54} r="1.5" fill={goldDark}/>
      {/* Diving planes */}
      <path d={`M${w*.15},${h*.38} L${w*.08},${h*.28} L${w*.22},${h*.38}`} fill={`url(#${gradId})`} stroke={bright} strokeWidth="0.8"/>
      <path d={`M${w*.78},${h*.62} L${w*.72},${h*.72} L${w*.84},${h*.62}`} fill={`url(#${gradId})`} stroke={bright} strokeWidth="0.8"/>
      {/* Stern planes and rudder */}
      <path d={`M${w*.88},${h*.38} L${w*.95},${h*.3} L${w*.96},${h*.5} L${w*.95},${h*.7} L${w*.88},${h*.62}`} 
        fill={`url(#${gradId})`} stroke={bright} strokeWidth="0.7"/>
      {/* Propeller */}
      <ellipse cx={w*.96} cy={h*.5} rx="3" ry="6" fill={dark} stroke={bright} strokeWidth="0.6"/>
      <FireEffect/>
    </svg>
  );

  if (id==="frigate") return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      {commonDefs}
      <WaveRipples cx={w*0.5} w={w*0.7}/>
      {/* Hull */}
      <path d={`M6,${h*.28} Q1,${h*.5} 6,${h*.72} L${w-8},${h*.78} Q${w-2},${h*.5} ${w-8},${h*.22} Z`} 
        fill={`url(#${gradId})`} stroke={bright} strokeWidth="1.1"/>
      <path d={`M9,${h*.52} L${w-9},${h*.5}`} stroke={goldDark} strokeWidth="0.9" opacity="0.5"/>
      {/* Superstructure */}
      <rect x={w*.2} y={h*.14} width={w*.34} height={h*.4} rx="1.5" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.9"/>
      {/* Bridge */}
      <rect x={w*.25} y={h*.04} width={w*.16} height={h*.18} rx="1" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.8"/>
      {/* Bridge windows */}
      {[.27,.32,.37].map((x,i)=>(
        <rect key={i} x={w*x} y={h*.07} width={2} height={1.5} rx="0.4" fill={portHoleColor}/>
      ))}
      {/* Funnel */}
      <rect x={w*.42} y={h*.08} width={7} height={h*.24} rx="2" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.7"/>
      {/* Helipad */}
      <rect x={w*.63} y={h*.36} width={w*.26} height={h*.26} rx="1" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.7"/>
      <circle cx={w*.76} cy={h*.49} r={h*.1} fill="none" stroke={bright} strokeWidth="0.6" strokeDasharray="3,2"/>
      <line x1={w*.72} y1={h*.49} x2={w*.8} y2={h*.49} stroke={bright} strokeWidth="0.4"/>
      <line x1={w*.76} y1={h*.42} x2={w*.76} y2={h*.56} stroke={bright} strokeWidth="0.4"/>
      {/* Forward gun */}
      <ellipse cx={w*.1} cy={h*.44} rx={w*.06} ry={h*.08} fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.8"/>
      <rect x={w*.05} y={h*.42} width={w*.12} height={4} rx="2" fill={bright} opacity="0.82"/>
      {/* Mast */}
      <line x1={w*.3} y1={h*.04} x2={w*.3} y2={-2} stroke={bright} strokeWidth="1"/>
      <line x1={w*.23} y1={h*.01} x2={w*.37} y2={h*.01} stroke={bright} strokeWidth="0.7"/>
      {/* Portholes */}
      {[.15,.3,.45,.6].map((x,i)=>(
        <circle key={i} cx={w*x} cy={h*.62} r="1.8" fill={portHoleColor} stroke={bright} strokeWidth="0.3"/>
      ))}
      <FireEffect/>
    </svg>
  );

  if (id==="gunboat") return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      {commonDefs}
      <WaveRipples cx={w*0.5} w={w*0.65}/>
      {/* Hull - small fast attack craft */}
      <path d={`M4,${h*.28} Q1,${h*.5} 4,${h*.72} L${w-5},${h*.8} Q${w-1},${h*.5} ${w-5},${h*.2} Z`} 
        fill={`url(#${gradId})`} stroke={bright} strokeWidth="1.2"/>
      <path d={`M8,${h*.52} L${w-8},${h*.5}`} stroke={goldDark} strokeWidth="0.8" opacity="0.5"/>
      {/* Pilot house */}
      <rect x={w*.28} y={h*.18} width={w*.32} height={h*.38} rx="2" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.9"/>
      <rect x={w*.32} y={h*.22} width={w*.24} height={h*.12} rx="1" fill={dark}/>
      {/* Bridge windows */}
      {[.34,.42,.5].map((x,i)=>(
        <rect key={i} x={w*x} y={h*.24} width={2} height={1.5} rx="0.4" fill={portHoleColor}/>
      ))}
      {/* Mast */}
      <rect x={w*.42} y={h*.06} width={5} height={h*.22} rx="1" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.6"/>
      <line x1={w*.44} y1={h*.06} x2={w*.44} y2={-1} stroke={bright} strokeWidth="1.3"/>
      <line x1={w*.36} y1={h*.04} x2={w*.52} y2={h*.04} stroke={bright} strokeWidth="0.7"/>
      {/* Forward gun */}
      <rect x={w*.05} y={h*.38} width={w*.22} height={5} rx="2.5" fill={bright} opacity="0.88"/>
      <ellipse cx={w*.12} cy={h*.44} rx={w*.05} ry={h*.08} fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.7"/>
      {/* Aft gun */}
      <rect x={w*.68} y={h*.38} width={w*.18} height={5} rx="2.5" fill={bright} opacity="0.75"/>
      {/* Portholes */}
      {[.2,.38,.58,.76].map((x,i)=>(
        <circle key={i} cx={w*x} cy={h*.62} r="1.5" fill={portHoleColor} stroke={bright} strokeWidth="0.3"/>
      ))}
      <FireEffect/>
    </svg>
  );

  // Default/patrol boat
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",filter:flt}}>
      {commonDefs}
      <WaveRipples cx={w*0.5} w={w*0.6}/>
      {/* Hull */}
      <path d={`M5,${h*.3} Q1,${h*.5} 5,${h*.7} L${w-6},${h*.76} Q${w-2},${h*.5} ${w-6},${h*.24} Z`} 
        fill={`url(#${gradId})`} stroke={bright} strokeWidth="1.1"/>
      <path d={`M8,${h*.52} L${w-8},${h*.5}`} stroke={goldDark} strokeWidth="0.8" opacity="0.5"/>
      {/* Cabin */}
      <rect x={w*.24} y={h*.2} width={w*.34} height={h*.36} rx="1.5" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.9"/>
      <rect x={w*.28} y={h*.24} width={w*.26} height={h*.1} rx="1" fill={dark}/>
      {/* Windows */}
      {[.3,.38,.46].map((x,i)=>(
        <rect key={i} x={w*x} y={h*.26} width={2.5} height={1.5} rx="0.4" fill={portHoleColor}/>
      ))}
      {/* Cargo/equipment pods */}
      {[.65,.74,.83].map((x,i)=>(
        <g key={i}>
          <circle cx={w*x} cy={h*.5} r="6" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.8"/>
          <circle cx={w*x} cy={h*.5} r="2.5" fill={bright} opacity="0.5"/>
        </g>
      ))}
      {/* Mast */}
      <rect x={w*.37} y={h*.1} width={5} height={h*.2} rx="1" fill={`url(#${deckGradId})`} stroke={bright} strokeWidth="0.6"/>
      <line x1={w*.39} y1={h*.1} x2={w*.39} y2={0} stroke={bright} strokeWidth="1.1"/>
      <line x1={w*.32} y1={h*.03} x2={w*.46} y2={h*.03} stroke={bright} strokeWidth="0.7"/>
      {/* Portholes */}
      {[.14,.32,.5].map((x,i)=>(
        <circle key={i} cx={w*x} cy={h*.58} r="1.5" fill={portHoleColor} stroke={bright} strokeWidth="0.3"/>
      ))}
      <FireEffect/>
    </svg>
  );
}

function ShipRenderer({shipId,isHoriz,isSunk,w,h}) {
  if (isHoriz) return <ShipSVG id={shipId} w={w} h={h} sunk={isSunk}/>;
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
// SETTINGS SCREEN — mobile-first layout
// ─────────────────────────────────────────────────────────────────────────────
function SettingsScreen({settings,onSave}) {
  const [s,setS]=useState({...settings});
  const toggle=(id)=>{
    const sel=s.ships.includes(id)?s.ships.filter(x=>x!==id):[...s.ships,id];
    if (sel.length>=2) setS(p=>({...p,ships:sel}));
  };
  return (
    <div className="mobile-page-root" style={{width:"100%",maxWidth:520,margin:"0 auto",padding:"0 0 1rem"}}>
      <div style={{fontSize:10,letterSpacing:"0.3em",color:"rgba(212,175,55,0.4)",textTransform:"uppercase",marginBottom:4,textAlign:"center"}}>Pre-Game</div>
      <h2 style={{fontSize:20,fontWeight:700,color:"var(--noir-primary)",margin:"0 0 16px",textAlign:"center",letterSpacing:"0.1em"}}>BRIEFING ROOM</h2>

      <div style={{background:"rgba(0,0,0,0.4)",border:"1px solid rgba(212,175,55,0.18)",padding:"0.85rem 1rem",marginBottom:10}}>
        <div style={{fontSize:10,color:"rgba(212,175,55,0.45)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:10}}>Fleet Composition</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
          {SHIP_CATALOGUE.map(ship=>{
            const sel=s.ships.includes(ship.id);
            return (
              <div key={ship.id} onClick={()=>toggle(ship.id)} style={{
                display:"flex",alignItems:"center",gap:7,padding:"8px 9px",cursor:"pointer",
                border:`1px solid ${sel?"rgba(212,175,55,0.45)":"rgba(212,175,55,0.1)"}`,
                background:sel?"rgba(212,175,55,0.08)":"transparent",
                borderRadius:2,WebkitTapHighlightColor:"transparent",
                minHeight:44, // touch-friendly tap target
              }}>
                <div style={{width:14,height:14,borderRadius:2,border:`1px solid ${sel?"var(--noir-primary)":"rgba(212,175,55,0.3)"}`,
                  background:sel?"var(--noir-primary)":"transparent",flexShrink:0,
                  display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {sel&&<span style={{fontSize:9,color:"#000",fontWeight:700}}>✓</span>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11,color:sel?"rgba(212,175,55,0.9)":"rgba(212,175,55,0.45)",letterSpacing:"0.04em",
                    whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ship.name}</div>
                  <div style={{display:"flex",gap:2,marginTop:2}}>
                    {Array.from({length:ship.size}).map((_,i)=>(
                      <div key={i} style={{width:6,height:3,borderRadius:1,background:sel?"rgba(212,175,55,0.6)":"rgba(212,175,55,0.2)"}}/>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{fontSize:10,color:"rgba(212,175,55,0.35)",marginTop:7,fontFamily:"'Crimson Text',serif",fontStyle:"italic"}}>
          {s.ships.length} ships selected — min. 2 required
        </div>
      </div>

      <div style={{background:"rgba(0,0,0,0.4)",border:"1px solid rgba(212,175,55,0.18)",padding:"0.85rem 1rem",marginBottom:10}}>
        <div style={{fontSize:10,color:"rgba(212,175,55,0.45)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:10}}>Difficulty</div>
        <div style={{display:"flex",gap:6}}>
          {[{k:"easy",label:"Easy",desc:"Random fire, no tracking"},{k:"normal",label:"Normal",desc:"Checkerboard hunt + targeting"},{k:"hard",label:"Hard",desc:"Smart spacing + axis lock"}].map(d=>(
            <div key={d.k} onClick={()=>setS(p=>({...p,difficulty:d.k}))} style={{
              flex:1,padding:"10px 8px",cursor:"pointer",textAlign:"center",
              border:`1px solid ${s.difficulty===d.k?"rgba(212,175,55,0.55)":"rgba(212,175,55,0.1)"}`,
              background:s.difficulty===d.k?"rgba(212,175,55,0.1)":"transparent",
              borderRadius:2,WebkitTapHighlightColor:"transparent",minHeight:44,
            }}>
              <div style={{fontSize:11,color:s.difficulty===d.k?"var(--noir-primary)":"rgba(212,175,55,0.5)",fontWeight:s.difficulty===d.k?700:400,letterSpacing:"0.05em"}}>{d.label}</div>
              <div style={{fontSize:9,color:"rgba(212,175,55,0.3)",fontFamily:"'Crimson Text',serif",marginTop:3}}>{d.desc}</div>
              {d.k!=="normal"&&<div style={{fontSize:8,color:d.k==="easy"?"rgba(100,180,100,0.6)":"rgba(255,150,50,0.6)",marginTop:3}}>
                {d.k==="easy"?"×0.6 rewards":"×1.5 rewards"}
              </div>}
            </div>
          ))}
        </div>
      </div>

      <div style={{background:"rgba(0,0,0,0.4)",border:"1px solid rgba(212,175,55,0.18)",padding:"0.85rem 1rem",marginBottom:10}}>
        <div style={{fontSize:10,color:"rgba(212,175,55,0.45)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:10}}>Visual Effects</div>
        {[
          {key:"sinkingCutscene",label:"Sinking Cutscene",desc:"Full-screen animation when a ship sinks"},
          {key:"hitDebris",label:"Hit Debris & Sparks",desc:"Flying metal chunks on direct hits"},
        ].map(({key,label,desc})=>(
          <div key={key} onClick={()=>setS(p=>({...p,[key]:!p[key]}))} style={{
            display:"flex",alignItems:"center",gap:10,padding:"10px 0",cursor:"pointer",
            borderBottom:"1px solid rgba(212,175,55,0.07)",WebkitTapHighlightColor:"transparent",
            minHeight:44,
          }}>
            <div style={{width:36,height:20,borderRadius:10,position:"relative",flexShrink:0,
              background:s[key]?"rgba(212,175,55,0.35)":"rgba(255,255,255,0.08)",
              border:`1px solid ${s[key]?"rgba(212,175,55,0.6)":"rgba(255,255,255,0.15)"}`,}}>
              <div style={{width:14,height:14,borderRadius:7,background:s[key]?"var(--noir-primary)":"rgba(255,255,255,0.25)",
                position:"absolute",top:2,left:s[key]?19:2,transition:"all 0.2s"}}/>
            </div>
            <div>
              <div style={{fontSize:11,color:"rgba(212,175,55,0.85)",letterSpacing:"0.05em"}}>{label}</div>
              <div style={{fontSize:10,color:"rgba(212,175,55,0.35)",fontFamily:"'Crimson Text',serif"}}>{desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{background:"rgba(0,0,0,0.4)",border:"1px solid rgba(212,175,55,0.18)",padding:"0.85rem 1rem",marginBottom:14}}>
        <div style={{fontSize:10,color:"rgba(212,175,55,0.45)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:10}}>Rules</div>
        {[
          "Each player deploys their fleet on a 10×10 grid",
          "Players alternate firing at enemy coordinates",
          "A hit is marked ✕ in red — a miss marked in blue",
          "When all cells of a ship are hit, it sinks",
          "First to sink the entire enemy fleet wins",
          "Tap rotate button or right-click to rotate a ship",
        ].map((rule,i)=>(
          <div key={i} style={{display:"flex",gap:9,marginBottom:6,alignItems:"flex-start"}}>
            <div style={{width:15,height:15,borderRadius:"50%",background:"rgba(212,175,55,0.12)",
              border:"1px solid rgba(212,175,55,0.25)",display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:9,color:"rgba(212,175,55,0.6)",flexShrink:0,marginTop:1}}>{i+1}</div>
            <div style={{fontSize:11,color:"rgba(212,175,55,0.6)",lineHeight:1.5,fontFamily:"'Crimson Text',serif"}}>{rule}</div>
          </div>
        ))}
      </div>

      <button onClick={()=>onSave(s)} style={{
        width:"100%",padding:"12px 0",background:"rgba(212,175,55,0.1)",
        border:"1px solid rgba(212,175,55,0.45)",color:"var(--noir-primary)",
        fontFamily:"'Cinzel',serif",fontSize:12,letterSpacing:"0.15em",
        cursor:"pointer",textTransform:"uppercase",WebkitTapHighlightColor:"transparent",
      }}>
        ⚔ Deploy Fleet
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BOARD — now receives CELL as prop
// ─────────────────────────────────────────────────────────────────────────────
function Board({grid,isAi,interactive,phase,hoverCells,hoverValid,onHover,onLeave,onPlace,onFire,sunkShips,particlesRef,label,size,CELL}) {
  const W=size*CELL,H=size*CELL;
  const cols=Array.from({length:size},(_,i)=>COLS[i]||String.fromCharCode(75+i));
  const shipMap={};
  const showShips=!isAi||phase==="won"||phase==="lost";
  if (showShips) grid.forEach(row=>row.forEach(cell=>{if(cell.ship){if(!shipMap[cell.ship])shipMap[cell.ship]=[];shipMap[cell.ship].push([cell.r,cell.c]);}}));
  const labelFontSize = CELL < 32 ? 8 : 9;
  const rowLabelW = CELL < 32 ? 14 : 18;

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
      <div style={{fontSize:labelFontSize,color:isAi?"rgba(200,70,50,0.65)":"rgba(212,175,55,0.45)",letterSpacing:"0.22em",textTransform:"uppercase",marginBottom:4,fontFamily:"'Cinzel',serif"}}>{label}</div>
      <div style={{display:"flex",paddingLeft:rowLabelW}}>
        {cols.map(c=><div key={c} style={{width:CELL,textAlign:"center",fontSize:labelFontSize,color:"rgba(212,175,55,0.3)",fontFamily:"'Cinzel',serif",marginBottom:2}}>{c}</div>)}
      </div>
      <div style={{display:"flex"}}>
        <div style={{display:"flex",flexDirection:"column"}}>
          {Array.from({length:size},(_,i)=><div key={i} style={{height:CELL,width:rowLabelW,display:"flex",alignItems:"center",justifyContent:"center",fontSize:labelFontSize,color:"rgba(212,175,55,0.3)",fontFamily:"'Cinzel',serif"}}>{i+1}</div>)}
        </div>
        <div style={{position:"relative",width:W,height:H,overflow:"hidden"}}>
          <WaterCanvas width={W} height={H} size={size} CELL={CELL}/>
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
            const iconSize = Math.max(8, CELL * 0.32);
            return (
              <div key={`m${cell.r},${cell.c}`} style={{position:"absolute",left:cell.c*CELL,top:cell.r*CELL,width:CELL,height:CELL,zIndex:9,display:"flex",alignItems:"center",justifyContent:"center"}}>
                {cell.hit?(
                  <div style={{width:CELL-Math.max(4,CELL*0.18),height:CELL-Math.max(4,CELL*0.18),borderRadius:"50%",
                    background:sk?"rgba(155,28,6,0.5)":"rgba(195,52,16,0.32)",
                    border:`2px solid ${sk?"rgba(255,65,12,0.95)":"rgba(255,105,32,0.68)"}`,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    boxShadow:sk?"0 0 14px rgba(255,55,0,0.5)":"none"}}>
                    <svg width={iconSize} height={iconSize} viewBox="0 0 14 14">
                      <line x1="2.5" y1="2.5" x2="11.5" y2="11.5" stroke={sk?"#ff4010":"#ff7028"} strokeWidth="2.5" strokeLinecap="round"/>
                      <line x1="11.5" y1="2.5" x2="2.5" y2="11.5" stroke={sk?"#ff4010":"#ff7028"} strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  </div>
                ):(
                  <div style={{width:Math.max(4,CELL*0.18),height:Math.max(4,CELL*0.18),borderRadius:"50%",background:"rgba(85,140,205,0.45)",border:"1px solid rgba(105,160,225,0.42)"}}/>
                )}
              </div>
            );
          }))}

          {grid.map(row=>row.map(cell=>(
            <div key={`c${cell.r},${cell.c}`} style={{position:"absolute",left:cell.c*CELL,top:cell.r*CELL,width:CELL,height:CELL,zIndex:11,
              cursor:isAi&&interactive&&!cell.hit&&!cell.miss?"crosshair":!isAi&&phase==="place"?"pointer":"default",
              WebkitTapHighlightColor:"transparent",touchAction:"manipulation"}}
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
// FLEET ROSTER — compact horizontal strip for mobile battle view
// ─────────────────────────────────────────────────────────────────────────────
function FleetRoster({ships, sunkList, label, accent}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:2,minWidth:0}}>
      <div style={{fontSize:8,color:accent,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:3}}>{label}</div>
      {ships.map(ship=>{
        const gone = sunkList.includes(ship.id);
        return (
          <div key={ship.id} style={{display:"flex",alignItems:"center",gap:5,opacity:gone?0.22:1,transition:"opacity 0.8s"}}>
            <div style={{width:5,height:5,borderRadius:"50%",flexShrink:0,background:gone?"#e05050":accent}}/>
            <span style={{fontSize:9,color:gone?"rgba(224,80,80,0.4)":accent,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:80}}>{ship.name}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
export default function Battleships() {
  const CELL = useCellSize();
  const isMobile = CELL < 38;

  const [screen,setScreen]=useState("settings");
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
  const [cutscene,setCutscene]=useState(null);
  const [pendingAfterCutscene,setPendingAfterCutscene]=useState(null);
  const [shotsFired,setShotsFired]=useState(0);
  const [gameStartTime,setGameStartTime]=useState(null);
  const [winSubmitted,setWinSubmitted]=useState(false);
  const [battleTab, setBattleTab] = useState("enemy");
  const [consecutiveHits,setConsecutiveHits]=useState(0);
  const [bonusShotActive,setBonusShotActive]=useState(false);
  const [elapsedTime,setElapsedTime]=useState(0);
  const [winReward,setWinReward]=useState(null);
  // Special abilities — one use per game each
  const [abilities,setAbilities]=useState({airRecon:false,sonarPing:false,salvo:false});
  const [abilityMode,setAbilityMode]=useState(null); // "airRecon"|"sonarPing"|"salvo"|null
  const [salvoShots,setSalvoShots]=useState(0);
  const [sonarResult,setSonarResult]=useState(null);
  const [screenShake,setScreenShake]=useState(false);
  // Leaderboard / stats
  const [leaderboard,setLeaderboard]=useState(null);
  const [myStats,setMyStats]=useState(null);
  const [showStats,setShowStats]=useState(false);
  const aiTimerRef=useRef(null);
  const playerFxRef=useRef({add:()=>{}});
  const aiFxRef=useRef({add:()=>{}});

  const pushEvent=(msg,color)=>{
    const id=Date.now()+Math.random();
    setEvents(e=>[...e.slice(-2),{id,msg,color}]);
    setTimeout(()=>setEvents(e=>e.filter(ev=>ev.id!==id)),3500);
  };

  // Timer tick
  useEffect(()=>{
    if (screen!=="battle"||!gameStartTime) return;
    const iv=setInterval(()=>setElapsedTime(Math.floor((Date.now()-gameStartTime)/1000)),1000);
    return()=>clearInterval(iv);
  },[screen,gameStartTime]);

  // Fetch leaderboard + stats on mount and after wins
  useEffect(()=>{
    const fetchStats=async()=>{
      try {
        const [lb,st]=await Promise.all([
          api.get('/battleships/leaderboard'),
          api.get('/battleships/my-stats'),
        ]);
        if (lb.data?.leaderboard) setLeaderboard(lb.data.leaderboard);
        if (st.data?.stats) setMyStats(st.data.stats);
      } catch {}
    };
    fetchStats();
  },[winSubmitted]);

  // Screen shake helper
  const triggerShake=useCallback(()=>{
    setScreenShake(true);
    setTimeout(()=>setScreenShake(false),300);
  },[]);

  const submitWin=useCallback(async()=>{
    if (winSubmitted) return;
    setWinSubmitted(true);
    const timeSeconds=gameStartTime?Math.floor((Date.now()-gameStartTime)/1000):0;
    try {
      const res=await api.post('/battleships/win',{
        shots_fired:shotsFired,
        ships_lost:sunkByAi.length,
        time_seconds:timeSeconds,
        fleet_size:activeShips.length,
        difficulty:settings.difficulty,
      });
      if (res.data?.reward) {
        setWinReward(res.data.reward);
        toast.success(`Victory! +$${res.data.reward.cash.toLocaleString()} +${res.data.reward.respect} Respect`);
      }
    } catch (err) {
      const msg=err?.response?.data?.detail||'Failed to record win';
      if (!msg.includes('limit')) toast.error(msg);
    }
  },[winSubmitted,gameStartTime,shotsFired,sunkByAi.length,activeShips.length,settings.difficulty]);

  useEffect(()=>{
    if (screen==="won"&&!winSubmitted) submitWin();
  },[screen,winSubmitted,submitWin]);

  const handleSaveSettings=(s)=>{
    const ships=SHIP_CATALOGUE.filter(sh=>s.ships.includes(sh.id));
    setSettings(s); setActiveShips(ships);
    setPlayerGrid(emptyGrid()); setAiGrid(autoPlaceAll(ships));
    setPlacingIdx(0); setHoriz(true); setHoverCell(null); setPlacedShips([]);
    setAiState({mode:"hunt",targets:[],hits:[],firstHit:null}); setPlayerTurn(true);
    setSunkByPlayer([]); setSunkByAi([]); setEvents([]); setCutscene(null);
    setShotsFired(0); setGameStartTime(null); setWinSubmitted(false);
    setBattleTab("enemy"); setConsecutiveHits(0); setBonusShotActive(false);
    setElapsedTime(0); setWinReward(null);
    setAbilities({airRecon:false,sonarPing:false,salvo:false});
    setAbilityMode(null); setSalvoShots(0); setSonarResult(null);
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
    if (settings.hitDebris) fxRef.current.add(isHit?makeHitExplosion(c*CELL+CELL/2,r*CELL+CELL/2,CELL):makeMissExplosion(c*CELL+CELL/2,r*CELL+CELL/2,CELL));
    const ng=grid.map(row=>row.map(cl=>cl.r===r&&cl.c===c?{...cl,hit:isHit,miss:!isHit}:cl));
    setGrid(ng);
    const newSunk=allShips.filter(s=>isShipSunk(ng,s.id)&&!sunkList.includes(s.id));
    if (newSunk.length>0) {
      setSunk(p=>[...p,...newSunk.map(s=>s.id)]);
      newSunk.forEach(ship=>{
        const cells=getShipCells(ng,ship.id);
        setTimeout(()=>fxRef.current.add(makeSunkVolley(cells,CELL)),250);
        pushEvent(isPlayer?`You sunk their ${ship.name}!`:`They sunk your ${ship.name}!`, isPlayer?"var(--noir-primary)":"#e05050");
        if (settings.sinkingCutscene) {
          const pending={result:allSunk(ng,allShips)?isPlayer?"won":"lost":null};
          setCutscene({ship,cells:cells.map(([rr,cc])=>[rr,cc])});
          setPendingAfterCutscene(pending);
          return;
        } else if (allSunk(ng,allShips)) { setScreen(isPlayer?"won":"lost"); }
      });
      return "sunk";
    }
    pushEvent(isPlayer?(isHit?"Direct hit!":"Splash — no contact"):(isHit?"They found you!":"They missed!"),
      isHit?isPlayer?"#e08040":"#e05050":isPlayer?"#4080b0":"#50a070");
    if (allSunk(ng,allShips)) { setScreen(isPlayer?"won":"lost"); return "end"; }
    return isHit?"hit":"miss";
  };

  // Air Recon: reveal a 3×3 area on the AI grid
  const handleAirRecon=(r,c)=>{
    if (abilities.airRecon) return;
    setAbilities(a=>({...a,airRecon:true}));
    setAbilityMode(null);
    const ng=aiGrid.map(row=>row.map(cl=>({...cl})));
    for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
      const nr=r+dr,nc=c+dc;
      if (nr>=0&&nr<GRID&&nc>=0&&nc<GRID&&!ng[nr][nc].hit&&!ng[nr][nc].miss) {
        ng[nr][nc]=ng[nr][nc].ship?{...ng[nr][nc],hit:true}:{...ng[nr][nc],miss:true};
        if (ng[nr][nc].ship) {
          if (settings.hitDebris) aiFxRef.current.add(makeHitExplosion(nc*CELL+CELL/2,nr*CELL+CELL/2,CELL));
          triggerShake();
        } else {
          if (settings.hitDebris) aiFxRef.current.add(makeMissExplosion(nc*CELL+CELL/2,nr*CELL+CELL/2,CELL));
        }
      }
    }
    setAiGrid(ng);
    setShotsFired(s=>s+1);
    const newSunk=activeShips.filter(s=>isShipSunk(ng,s.id)&&!sunkByPlayer.includes(s.id));
    if (newSunk.length>0) {
      setSunkByPlayer(p=>[...p,...newSunk.map(s=>s.id)]);
      newSunk.forEach(ship=>{
        const cells=getShipCells(ng,ship.id);
        setTimeout(()=>aiFxRef.current.add(makeSunkVolley(cells,CELL)),250);
        pushEvent(`You sunk their ${ship.name}!`,"var(--noir-primary)");
      });
      if (allSunk(ng,activeShips)) { setScreen("won"); return; }
    }
    pushEvent("✈ Air Recon — area scanned!","#60b0ff");
    setPlayerTurn(false);
  };

  // Sonar Ping: reveal whether ships exist in a 5×5 area
  const handleSonarPing=(r,c)=>{
    if (abilities.sonarPing) return;
    setAbilities(a=>({...a,sonarPing:true}));
    setAbilityMode(null);
    let shipCount=0;
    for (let dr=-2;dr<=2;dr++) for (let dc=-2;dc<=2;dc++) {
      const nr=r+dr,nc=c+dc;
      if (nr>=0&&nr<GRID&&nc>=0&&nc<GRID&&aiGrid[nr][nc].ship&&!aiGrid[nr][nc].hit) shipCount++;
    }
    setSonarResult({r,c,count:shipCount});
    pushEvent(shipCount>0?`🔊 Sonar: ${shipCount} cell${shipCount>1?"s":""} detected nearby!`:"🔊 Sonar: All clear in this area.","#50c8ff");
    setTimeout(()=>setSonarResult(null),3000);
    setPlayerTurn(false);
  };

  const handleFireAtAi=(r,c)=>{
    if (!playerTurn||screen!=="battle") return;

    // Handle ability modes
    if (abilityMode==="airRecon") { handleAirRecon(r,c); return; }
    if (abilityMode==="sonarPing") { handleSonarPing(r,c); return; }

    const res=fireAndProcess(r,c,aiGrid,setAiGrid,true,sunkByPlayer,setSunkByPlayer,aiFxRef,playerGrid,setPlayerGrid,activeShips);
    if (res===false) return;
    setShotsFired(s=>s+1);

    // Salvo mode — get 3 shots
    if (abilityMode==="salvo") {
      const next=salvoShots+1;
      setSalvoShots(next);
      if (next>=3) { setAbilityMode(null); setSalvoShots(0); setPlayerTurn(false); }
      return;
    }

    // Streak: 3+ consecutive hits grants a bonus shot
    if (res==="hit") {
      const newStreak=consecutiveHits+1;
      setConsecutiveHits(newStreak);
      if (newStreak>=3&&!bonusShotActive) {
        setBonusShotActive(true);
        pushEvent("🔥 Hot streak — BONUS SHOT!","#ffa500");
        return;
      }
      if (bonusShotActive) { setBonusShotActive(false); setConsecutiveHits(0); }
    } else {
      setConsecutiveHits(0);
      setBonusShotActive(false);
    }

    if (res==="hit") triggerShake();
    if (res!=="sunk"||!settings.sinkingCutscene) setPlayerTurn(false);
    else setPlayerTurn(false);
  };

  const handleCutsceneDone=()=>{
    const p=pendingAfterCutscene;
    setCutscene(null); setPendingAfterCutscene(null);
    if (p?.result) setScreen(p.result);
  };

  const aiStateRef=useRef(aiState);
  aiStateRef.current=aiState;
  const playerGridRef=useRef(playerGrid);
  playerGridRef.current=playerGrid;
  const activeShipsRef=useRef(activeShips);
  activeShipsRef.current=activeShips;
  const sunkByAiRef=useRef(sunkByAi);
  sunkByAiRef.current=sunkByAi;
  const settingsRef=useRef(settings);
  settingsRef.current=settings;

  useEffect(()=>{
    if (screen!=="battle"||playerTurn||cutscene) return;
    aiTimerRef.current=setTimeout(()=>{
      const _aiState=aiStateRef.current;
      const _playerGrid=playerGridRef.current;
      const _activeShips=activeShipsRef.current;
      const _sunkByAi=sunkByAiRef.current;
      const _settings=settingsRef.current;

      const {r,c,newTargets,newMode}=aiShot(_aiState,_playerGrid,_settings.difficulty);
      const cell=_playerGrid[r][c]; const isHit=!!cell.ship;
      if (_settings.hitDebris) playerFxRef.current.add(isHit?makeHitExplosion(c*CELL+CELL/2,r*CELL+CELL/2,CELL):makeMissExplosion(c*CELL+CELL/2,r*CELL+CELL/2,CELL));
      if (isHit) triggerShake();
      const ng=_playerGrid.map(row=>row.map(cl=>cl.r===r&&cl.c===c?{...cl,hit:isHit,miss:!isHit}:cl));
      let ut=newTargets,um=newMode;
      const fh=isHit?(_aiState.firstHit||[r,c]):_aiState.firstHit;
      if (isHit){ut=addTargets(newTargets,r,c,_playerGrid,_settings.difficulty,fh);um="target";}
      const ns=_activeShips.filter(s=>isShipSunk(ng,s.id)&&!_sunkByAi.includes(s.id));
      if (ns.length>0) {
        setSunkByAi(p=>[...p,...ns.map(s=>s.id)]);
        ns.forEach(ship=>{
          const cells=getShipCells(ng,ship.id);
          setTimeout(()=>playerFxRef.current.add(makeSunkVolley(cells,CELL)),250);
          pushEvent(`They sunk your ${ship.name}!`,"#e05050");
          if (_settings.sinkingCutscene) { setCutscene({ship,cells}); setPendingAfterCutscene({result:allSunk(ng,_activeShips)?"lost":null}); }
          else if (allSunk(ng,_activeShips)) setScreen("lost");
        });
        ut=[];um="hunt";
      } else { pushEvent(isHit?"They found you!":"They missed!",isHit?"#e05050":"#50a070"); }
      setAiState({mode:um,targets:ut,hits:[..._aiState.hits,[r,c]],firstHit:um==="hunt"?null:fh});
      setPlayerGrid(ng);
      if (!_settings.sinkingCutscene&&allSunk(ng,_activeShips)){setScreen("lost");return;}
      setPlayerTurn(true);
      if (isMobile && isHit) { setBattleTab("yours"); setTimeout(()=>setBattleTab("enemy"),1800); }
    },settings.aiDelay);
    return()=>clearTimeout(aiTimerRef.current);
  },[playerTurn,screen,cutscene,CELL,isMobile,settings.aiDelay,triggerShake]);

  const resetToSettings=()=>setScreen("settings");

  const playerLeft=activeShips.filter(s=>!sunkByAi.includes(s.id)).length;
  const aiLeft=activeShips.filter(s=>!sunkByPlayer.includes(s.id)).length;

  const inGame = screen==="battle"||screen==="won"||screen==="lost";

  return (
    <div className="mobile-page-root md:px-3" style={{minHeight:"100vh",background:"var(--noir-background,#060810)",
      backgroundImage:"radial-gradient(ellipse at 50% -10%,rgba(15,45,90,0.38) 0%,transparent 65%)",
      display:"flex",flexDirection:"column",alignItems:"center",
      paddingTop:"1rem",paddingBottom:"2.5rem",fontFamily:"'Cinzel',serif",
      WebkitTextSizeAdjust:"100%",overflowX:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
        @keyframes ev-in{0%{opacity:0;transform:translateY(-10px)}12%{opacity:1;transform:none}80%{opacity:1}100%{opacity:0}}
        @keyframes tglow{0%,100%{text-shadow:0 0 25px rgba(212,175,55,0.25)}50%{text-shadow:0 0 45px rgba(212,175,55,0.55),0 0 80px rgba(212,175,55,0.18)}}
        @keyframes screenShake{0%{transform:translate(0)}20%{transform:translate(-3px,2px)}40%{transform:translate(3px,-2px)}60%{transform:translate(-2px,1px)}80%{transform:translate(2px,-1px)}100%{transform:translate(0)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        .nb{background:rgba(212,175,55,0.07);border:1px solid rgba(212,175,55,0.32);color:var(--noir-primary);
          font-family:'Cinzel',serif;font-size:11px;letter-spacing:0.1em;padding:9px 14px;
          cursor:pointer;transition:all 0.2s;text-transform:uppercase;
          -webkit-tap-highlight-color:transparent;touch-action:manipulation;}
        .nb:hover{background:rgba(212,175,55,0.16);border-color:rgba(212,175,55,0.6);}
        .nb:disabled{opacity:0.28;cursor:default;}
        .fr{display:flex;align-items:center;gap:8px;padding:3px 7px;margin-bottom:2px;border:1px solid transparent;border-radius:2px;transition:all 0.15s;}
        .fr.active{border-color:rgba(212,175,55,0.38);background:rgba(212,175,55,0.07);}
        .fr.gone{opacity:0.2;}
        /* Tab buttons on mobile */
        .tab-btn{flex:1;padding:8px 0;background:transparent;border:1px solid rgba(212,175,55,0.2);
          color:rgba(212,175,55,0.45);font-family:'Cinzel',serif;font-size:10px;letter-spacing:0.08em;
          cursor:pointer;-webkit-tap-highlight-color:transparent;transition:all 0.2s;}
        .tab-btn.active{background:rgba(212,175,55,0.12);border-color:rgba(212,175,55,0.5);color:var(--noir-primary);}
        * { box-sizing: border-box; }
      `}</style>

      {/* Title */}
      <div style={{textAlign:"center",marginBottom:"0.9rem"}}>
        <div style={{fontSize:9,letterSpacing:"0.35em",color:"rgba(212,175,55,0.38)",marginBottom:3,textTransform:"uppercase"}}>The Family's Navy</div>
        <h1 style={{fontSize:isMobile?22:28,fontWeight:900,color:"var(--noir-primary)",margin:0,letterSpacing:"0.1em",textTransform:"uppercase",animation:"tglow 4s ease-in-out infinite"}}>Rum Runner</h1>
        <div style={{fontSize:10,color:"rgba(212,175,55,0.28)",letterSpacing:"0.12em",marginTop:3,fontFamily:"'Crimson Text',serif",fontStyle:"italic"}}>Sink the Feds before they sink you</div>
      </div>

      {/* SETTINGS */}
      {screen==="settings"&&(
        <>
          <SettingsScreen settings={settings} onSave={handleSaveSettings}/>
          <button className="nb" onClick={()=>setShowStats(true)} style={{marginTop:8,fontSize:10,opacity:0.6}}>📊 Stats & Leaderboard</button>
        </>
      )}

      {/* PLACEMENT */}
      {screen==="place"&&(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,width:"100%",animation:"fadeIn 0.3s ease"}}>
          <div style={{fontSize:10,color:"rgba(212,175,55,0.5)",letterSpacing:"0.15em",textTransform:"uppercase",textAlign:"center"}}>
            {placingIdx<activeShips.length?`Deploy: ${currentShip.name} (${currentShip.size} cells)`:"Fleet Ready — Engage"}
          </div>
          <Board grid={playerGrid} isAi={false} interactive={false} phase="place"
            hoverCells={getHoverCells()} hoverValid={hoverValid}
            onHover={(r,c)=>setHoverCell({r,c})} onLeave={()=>setHoverCell(null)}
            onPlace={handlePlace} onFire={null}
            sunkShips={[]} particlesRef={playerFxRef} label="Your Waters" size={GRID} CELL={CELL}/>
          {/* Controls row */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"center",width:"100%",maxWidth:GRID*CELL+20}}>
            <button className="nb" onClick={()=>setHoriz(h=>!h)} disabled={placingIdx>=activeShips.length}>↺ {horiz?"Horiz":"Vert"}</button>
            <button className="nb" onClick={handleAutoPlace}>⚡ Auto</button>
            <button className="nb" disabled={placedShips.length<activeShips.length} onClick={()=>{setScreen("battle");setGameStartTime(Date.now());setShotsFired(0);setWinSubmitted(false);}}>⚔ Go to War</button>
            <button className="nb" onClick={resetToSettings} style={{borderColor:"rgba(212,175,55,0.18)",color:"rgba(212,175,55,0.45)"}}>⚙</button>
          </div>
          {/* Fleet list — horizontal scrolling on mobile */}
          <div style={{width:"100%",maxWidth:GRID*CELL+20,overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
            <div style={{display:"flex",gap:6,paddingBottom:4,minWidth:"min-content"}}>
              {activeShips.map((ship,i)=>(
                <div key={ship.id} className={`fr${i===placingIdx?" active":""}`} style={{flexShrink:0}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:10,color:placedShips.includes(ship.id)?"rgba(212,175,55,0.3)":"rgba(212,175,55,0.88)",letterSpacing:"0.04em",whiteSpace:"nowrap"}}>{ship.name}</div>
                    <div style={{display:"flex",gap:2,marginTop:2}}>
                      {Array.from({length:ship.size}).map((_,j)=>(
                        <div key={j} style={{width:7,height:3,borderRadius:1,background:placedShips.includes(ship.id)?"rgba(212,175,55,0.2)":"rgba(212,175,55,0.6)"}}/>
                      ))}
                    </div>
                  </div>
                  {placedShips.includes(ship.id)&&<span style={{fontSize:11,color:"#639922"}}>✓</span>}
                </div>
              ))}
            </div>
          </div>
          {isMobile&&<div style={{fontSize:10,color:"rgba(212,175,55,0.3)",fontFamily:"'Crimson Text',serif",fontStyle:"italic"}}>Tap to place · Use ↺ to rotate</div>}
        </div>
      )}

      {/* BATTLE */}
      {inGame&&(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,width:"100%",maxWidth:1120,animation:"fadeIn 0.3s ease"}}>
          {/* Status bar */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",
            maxWidth:isMobile?GRID*CELL+20:990,
            padding:"6px 12px",background:"rgba(0,0,0,0.55)",border:"1px solid rgba(212,175,55,0.12)"}}>
            <div style={{fontSize:10,color:"rgba(212,175,55,0.55)"}}>Yours: <span style={{color:"var(--noir-primary)",fontWeight:700}}>{playerLeft}</span></div>
            <div style={{fontSize:isMobile?10:12,letterSpacing:"0.08em",fontWeight:600,
              color:screen==="won"?"var(--noir-primary)":screen==="lost"?"#e05050":playerTurn?"var(--noir-primary)":"rgba(212,175,55,0.4)"}}>
              {screen==="won"?"✦ VICTORY":screen==="lost"?"✕ DEFEATED":playerTurn?(abilityMode?`⚡ ${abilityMode==="airRecon"?"AIR RECON":"SONAR PING"} — pick target`:"▶ YOUR MOVE"):"⧗ INCOMING..."}
            </div>
            <div style={{fontSize:10,color:"rgba(212,175,55,0.55)"}}>Feds: <span style={{color:"#e05c5c",fontWeight:700}}>{aiLeft}</span></div>
          </div>

          {/* HUD — shots / time / accuracy */}
          <div style={{display:"flex",gap:isMobile?10:20,justifyContent:"center",alignItems:"center",
            padding:"4px 14px",background:"rgba(0,0,0,0.35)",border:"1px solid rgba(212,175,55,0.08)",
            width:"100%",maxWidth:isMobile?GRID*CELL+20:990}}>
            <div style={{fontSize:10,color:"rgba(212,175,55,0.5)"}}>Shots: <span style={{color:"var(--noir-primary)",fontWeight:600}}>{shotsFired}</span></div>
            <div style={{fontSize:10,color:"rgba(212,175,55,0.5)"}}>Time: <span style={{color:"var(--noir-primary)",fontWeight:600}}>
              {Math.floor(elapsedTime/60)}:{String(elapsedTime%60).padStart(2,'0')}</span></div>
            {shotsFired>0&&<div style={{fontSize:10,color:"rgba(212,175,55,0.5)"}}>Accuracy: <span style={{color:"var(--noir-primary)",fontWeight:600}}>
              {Math.round((sunkByPlayer.reduce((a,id)=>{const sh=activeShips.find(s=>s.id===id);return a+(sh?sh.size:0);},0)+(()=>{let h=0;aiGrid.forEach(row=>row.forEach(c=>{if(c.hit&&c.ship&&!sunkByPlayer.includes(c.ship))h++;}));return h;})())/shotsFired*100)}%
            </span></div>}
            {consecutiveHits>=2&&<div style={{fontSize:10,color:"#ffa500",fontWeight:600}}>🔥 ×{consecutiveHits}</div>}
          </div>

          {/* Ability buttons */}
          {screen==="battle"&&playerTurn&&(
            <div style={{display:"flex",gap:6,justifyContent:"center",flexWrap:"wrap",width:"100%",maxWidth:isMobile?GRID*CELL+20:990}}>
              {activeShips.some(s=>s.id==="carrier")&&!abilities.airRecon&&(
                <button className="nb" onClick={()=>setAbilityMode(m=>m==="airRecon"?null:"airRecon")}
                  style={{fontSize:9,padding:"6px 10px",background:abilityMode==="airRecon"?"rgba(100,170,255,0.15)":"rgba(212,175,55,0.07)",
                    borderColor:abilityMode==="airRecon"?"rgba(100,170,255,0.5)":"rgba(212,175,55,0.32)"}}>
                  ✈ Air Recon
                </button>
              )}
              {activeShips.some(s=>s.id==="submarine")&&!abilities.sonarPing&&(
                <button className="nb" onClick={()=>setAbilityMode(m=>m==="sonarPing"?null:"sonarPing")}
                  style={{fontSize:9,padding:"6px 10px",background:abilityMode==="sonarPing"?"rgba(80,200,255,0.15)":"rgba(212,175,55,0.07)",
                    borderColor:abilityMode==="sonarPing"?"rgba(80,200,255,0.5)":"rgba(212,175,55,0.32)"}}>
                  🔊 Sonar Ping
                </button>
              )}
              {activeShips.some(s=>s.id==="battleship")&&!abilities.salvo&&(
                <button className="nb" onClick={()=>{
                  if (abilityMode==="salvo") { setAbilityMode(null); setSalvoShots(0); }
                  else { setAbilityMode("salvo"); setSalvoShots(0); setAbilities(a=>({...a,salvo:true})); pushEvent("💣 SALVO — fire 3 shots!","#ff8c00"); }
                }}
                  style={{fontSize:9,padding:"6px 10px",background:abilityMode==="salvo"?"rgba(255,140,0,0.15)":"rgba(212,175,55,0.07)",
                    borderColor:abilityMode==="salvo"?"rgba(255,140,0,0.5)":"rgba(212,175,55,0.32)"}}>
                  💣 Salvo {abilityMode==="salvo"?`(${3-salvoShots} left)`:"(×3)"}
                </button>
              )}
              {abilityMode&&<button className="nb" onClick={()=>{setAbilityMode(null);setSalvoShots(0);}} style={{fontSize:9,padding:"6px 10px",opacity:0.5}}>✕ Cancel</button>}
            </div>
          )}

          {/* Events */}
          <div style={{minHeight:20,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            {events.map(ev=>(
              <div key={ev.id} style={{fontSize:12,color:ev.color,letterSpacing:"0.07em",fontFamily:"'Crimson Text',serif",fontStyle:"italic",
                animation:"ev-in 3.5s ease forwards",textShadow:`0 0 10px ${ev.color}`,textAlign:"center"}}>{ev.msg}</div>
            ))}
          </div>

          {/* MOBILE: tab switcher + single board with swipe */}
          {isMobile ? (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,width:"100%",
              animation:screenShake?"screenShake 0.3s ease":"none"}}
              onTouchStart={e=>{e.currentTarget._touchX=e.touches[0].clientX;}}
              onTouchEnd={e=>{
                const dx=e.changedTouches[0].clientX-(e.currentTarget._touchX||0);
                if (Math.abs(dx)>50) setBattleTab(dx<0?"yours":"enemy");
              }}>
              {/* Tab buttons */}
              <div style={{display:"flex",width:"100%",maxWidth:GRID*CELL+20,gap:0,border:"1px solid rgba(212,175,55,0.2)"}}>
                <button className={`tab-btn${battleTab==="enemy"?" active":""}`} onClick={()=>setBattleTab("enemy")}>
                  ⚔ Fed Waters
                </button>
                <button className={`tab-btn${battleTab==="yours"?" active":""}`} onClick={()=>setBattleTab("yours")}>
                  🛡 Your Waters
                </button>
              </div>

              {battleTab==="enemy"&&(
                <Board grid={aiGrid} isAi={true} interactive={playerTurn&&screen==="battle"} phase={screen}
                  hoverCells={new Set()} hoverValid={false}
                  onHover={()=>{}} onLeave={()=>{}} onPlace={()=>{}} onFire={handleFireAtAi}
                  sunkShips={sunkByPlayer} particlesRef={aiFxRef} label="Fed Waters" size={GRID} CELL={CELL}/>
              )}
              {battleTab==="yours"&&(
                <Board grid={playerGrid} isAi={false} interactive={false} phase={screen}
                  hoverCells={new Set()} hoverValid={false}
                  onHover={()=>{}} onLeave={()=>{}} onPlace={()=>{}} onFire={null}
                  sunkShips={sunkByAi} particlesRef={playerFxRef} label="Your Waters" size={GRID} CELL={CELL}/>
              )}

              {/* Compact fleet strips */}
              <div style={{display:"flex",gap:16,justifyContent:"center",padding:"4px 8px",
                background:"rgba(0,0,0,0.3)",border:"1px solid rgba(212,175,55,0.1)",width:"100%",maxWidth:GRID*CELL+20}}>
                <FleetRoster ships={activeShips} sunkList={sunkByAi} label="Your Fleet" accent="rgba(212,175,55,0.7)"/>
                <div style={{width:1,background:"rgba(212,175,55,0.1)"}}/>
                <FleetRoster ships={activeShips} sunkList={sunkByPlayer} label="Fed Fleet" accent="rgba(200,70,50,0.55)"/>
              </div>
            </div>
          ) : (
            /* DESKTOP: original side-by-side layout */
            <div style={{display:"flex",gap:16,flexWrap:"wrap",justifyContent:"center",alignItems:"flex-start",
              animation:screenShake?"screenShake 0.3s ease":"none"}}>
              <Board grid={playerGrid} isAi={false} interactive={false} phase={screen}
                hoverCells={new Set()} hoverValid={false}
                onHover={()=>{}} onLeave={()=>{}} onPlace={()=>{}} onFire={null}
                sunkShips={sunkByAi} particlesRef={playerFxRef} label="Your Waters" size={GRID} CELL={CELL}/>

              <div style={{minWidth:125,paddingTop:22,display:"flex",flexDirection:"column",gap:14}}>
                <div>
                  <div style={{fontSize:9,color:"rgba(212,175,55,0.3)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:6}}>Your Fleet</div>
                  {activeShips.map(ship=>(
                    <div key={ship.id} className={`fr${sunkByAi.includes(ship.id)?" gone":""}`}>
                      <div style={{width:6,height:6,borderRadius:"50%",flexShrink:0,background:sunkByAi.includes(ship.id)?"#e05050":"var(--noir-primary)"}}/>
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
                sunkShips={sunkByPlayer} particlesRef={aiFxRef} label="Fed Waters" size={GRID} CELL={CELL}/>
            </div>
          )}

          {/* End game panel — detailed stats card */}
          {(screen==="won"||screen==="lost")&&(()=>{
            const totalEnemyCells=activeShips.reduce((a,s)=>a+s.size,0);
            const hitCells=aiGrid.flat().filter(c=>c.hit).length;
            const accuracy=shotsFired>0?Math.round(hitCells/shotsFired*100):0;
            const timeStr=`${Math.floor(elapsedTime/60)}:${String(elapsedTime%60).padStart(2,'0')}`;
            return (
              <div style={{marginTop:8,textAlign:"center",padding:"1.2rem 1.5rem",background:"rgba(4,7,12,0.97)",
                border:`1px solid ${screen==="won"?"rgba(212,175,55,0.4)":"rgba(192,57,43,0.4)"}`,
                maxWidth:isMobile?"100%":480,width:"100%",animation:"fadeIn 0.4s ease"}}>
                <div style={{fontSize:isMobile?18:22,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
                  color:screen==="won"?"var(--noir-primary)":"#c0392b",
                  textShadow:`0 0 25px ${screen==="won"?"rgba(212,175,55,0.45)":"rgba(192,57,43,0.45)"}`}}>
                  {screen==="won"?"The Feds Are Sunk":"Your Fleet Is Gone"}
                </div>
                <div style={{fontSize:12,marginTop:7,fontFamily:"'Crimson Text',serif",fontStyle:"italic",lineHeight:1.6,
                  color:screen==="won"?"rgba(212,175,55,0.55)":"rgba(192,57,43,0.65)"}}>
                  {screen==="won"?"The rum runs free tonight. The Don raises a glass to your name."
                    :"Prohibition wins this round. The Feds got their man."}
                </div>

                {/* Stats grid */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,margin:"14px 0",
                  padding:"10px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(212,175,55,0.1)"}}>
                  {[
                    {label:"Shots Fired",val:shotsFired},
                    {label:"Accuracy",val:`${accuracy}%`},
                    {label:"Time",val:timeStr},
                    {label:"Ships Lost",val:sunkByAi.length},
                    {label:"Ships Sunk",val:sunkByPlayer.length},
                    {label:"Difficulty",val:settings.difficulty.charAt(0).toUpperCase()+settings.difficulty.slice(1)},
                  ].map(s=>(
                    <div key={s.label}>
                      <div style={{fontSize:8,color:"rgba(212,175,55,0.35)",letterSpacing:"0.15em",textTransform:"uppercase"}}>{s.label}</div>
                      <div style={{fontSize:16,fontWeight:700,color:"var(--noir-primary)",marginTop:2}}>{s.val}</div>
                    </div>
                  ))}
                </div>

                {/* Rewards (win only) */}
                {screen==="won"&&winReward&&(
                  <div style={{display:"flex",gap:16,justifyContent:"center",padding:"8px 0",
                    borderTop:"1px solid rgba(212,175,55,0.1)",borderBottom:"1px solid rgba(212,175,55,0.1)",margin:"6px 0"}}>
                    <div style={{fontSize:14,color:"#4caf50",fontWeight:700}}>+${winReward.cash?.toLocaleString()}</div>
                    <div style={{fontSize:14,color:"#ff9800",fontWeight:700}}>+{winReward.respect} Respect</div>
                  </div>
                )}

                <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:12}}>
                  <button className="nb" onClick={()=>handleSaveSettings(settings)}>New Game</button>
                  <button className="nb" onClick={()=>setShowStats(true)} style={{fontSize:10}}>📊 Stats</button>
                  <button className="nb" onClick={resetToSettings} style={{fontSize:10,opacity:0.6}}>⚙ Settings</button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Sonar ping overlay */}
      {sonarResult&&inGame&&(
        <div style={{position:"fixed",inset:0,zIndex:500,pointerEvents:"none",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{fontSize:28,fontWeight:700,color:sonarResult.count>0?"#50c8ff":"#50a070",
            textShadow:sonarResult.count>0?"0 0 30px rgba(80,200,255,0.6)":"0 0 20px rgba(80,160,110,0.5)",
            animation:"fadeIn 0.3s ease",fontFamily:"'Cinzel',serif"}}>
            {sonarResult.count>0?`🔊 ${sonarResult.count} target${sonarResult.count>1?"s":""} detected`:"🔊 Area clear"}
          </div>
        </div>
      )}

      {/* Stats & Leaderboard modal */}
      {showStats&&(
        <div style={{position:"fixed",inset:0,zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",
          background:"rgba(0,0,0,0.85)",backdropFilter:"blur(4px)",padding:16}}
          onClick={()=>setShowStats(false)}>
          <div onClick={e=>e.stopPropagation()} style={{background:"rgba(6,8,16,0.98)",border:"1px solid rgba(212,175,55,0.3)",
            padding:"1.5rem",maxWidth:520,width:"100%",maxHeight:"80vh",overflowY:"auto",animation:"fadeIn 0.3s ease"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <h3 style={{margin:0,fontSize:16,color:"var(--noir-primary)",letterSpacing:"0.1em"}}>CAPTAIN'S LOG</h3>
              <button onClick={()=>setShowStats(false)} style={{background:"none",border:"none",color:"rgba(212,175,55,0.5)",
                fontSize:18,cursor:"pointer",padding:4}}>✕</button>
            </div>

            {/* Personal stats */}
            {myStats&&(
              <div style={{marginBottom:16}}>
                <div style={{fontSize:9,color:"rgba(212,175,55,0.4)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:8}}>Your Record</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                  {[
                    {l:"Total Wins",v:myStats.total_wins},
                    {l:"Best Shots",v:myStats.best_shots||"—"},
                    {l:"Avg Shots",v:myStats.avg_shots||"—"},
                    {l:"Perfect Games",v:myStats.perfect_games},
                    {l:"Ships Lost",v:myStats.total_ships_lost},
                    {l:"Best Time",v:myStats.best_time?`${Math.floor(myStats.best_time/60)}:${String(myStats.best_time%60).padStart(2,'0')}`:"—"},
                    {l:"Total Cash",v:myStats.total_cash?`$${myStats.total_cash.toLocaleString()}`:"$0"},
                    {l:"Total Respect",v:myStats.total_respect||0},
                  ].map(s=>(
                    <div key={s.l} style={{padding:"6px 8px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(212,175,55,0.08)"}}>
                      <div style={{fontSize:8,color:"rgba(212,175,55,0.35)",letterSpacing:"0.1em",textTransform:"uppercase"}}>{s.l}</div>
                      <div style={{fontSize:14,fontWeight:700,color:"var(--noir-primary)",marginTop:2}}>{s.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Leaderboard */}
            {leaderboard&&leaderboard.length>0&&(
              <div>
                <div style={{fontSize:9,color:"rgba(212,175,55,0.4)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:8}}>Top Captains</div>
                <div style={{border:"1px solid rgba(212,175,55,0.1)"}}>
                  <div style={{display:"grid",gridTemplateColumns:"30px 1fr 60px 60px",gap:0,padding:"6px 8px",
                    background:"rgba(212,175,55,0.05)",borderBottom:"1px solid rgba(212,175,55,0.1)"}}>
                    <div style={{fontSize:8,color:"rgba(212,175,55,0.4)"}}>#</div>
                    <div style={{fontSize:8,color:"rgba(212,175,55,0.4)"}}>Captain</div>
                    <div style={{fontSize:8,color:"rgba(212,175,55,0.4)",textAlign:"right"}}>Shots</div>
                    <div style={{fontSize:8,color:"rgba(212,175,55,0.4)",textAlign:"right"}}>Time</div>
                  </div>
                  {leaderboard.map((row,i)=>(
                    <div key={i} style={{display:"grid",gridTemplateColumns:"30px 1fr 60px 60px",gap:0,padding:"5px 8px",
                      borderBottom:i<leaderboard.length-1?"1px solid rgba(212,175,55,0.06)":"none"}}>
                      <div style={{fontSize:10,color:i<3?"var(--noir-primary)":"rgba(212,175,55,0.4)",fontWeight:i<3?700:400}}>{i+1}</div>
                      <div style={{fontSize:10,color:"rgba(212,175,55,0.7)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.username}</div>
                      <div style={{fontSize:10,color:"var(--noir-primary)",textAlign:"right",fontWeight:600}}>{row.shots_fired}</div>
                      <div style={{fontSize:10,color:"rgba(212,175,55,0.5)",textAlign:"right"}}>
                        {row.time_seconds?`${Math.floor(row.time_seconds/60)}:${String(row.time_seconds%60).padStart(2,'0')}`:"—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(!leaderboard||leaderboard.length===0)&&!myStats&&(
              <div style={{fontSize:11,color:"rgba(212,175,55,0.35)",fontStyle:"italic",textAlign:"center",padding:20}}>No stats recorded yet. Win a game to get started!</div>
            )}
          </div>
        </div>
      )}

      {cutscene&&<SinkingCutscene ship={cutscene.ship} cells={cutscene.cells} onDone={handleCutsceneDone}/>}
    </div>
  );
}
