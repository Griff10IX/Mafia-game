import { useEffect, useRef, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Trophy, RefreshCw } from "lucide-react";
import api from "../../utils/api";
import { toast } from "sonner";
import styles from "../../styles/noir.module.css";

const W = 480, H = 600;

const VPY       = 155;
const FLOOR_Y   = H - 30;
const PATH_L_F  = W/2 - 38;
const PATH_R_F  = W/2 + 38;
const PATH_L_N  = 55;
const PATH_R_N  = W - 55;

const LANE_NX = [-0.6, 0, 0.6];

function zToY(z)           { return VPY + (FLOOR_Y - VPY) * z; }
function zToScale(z)       { return 0.08 + 0.92 * z; }
function zToLaneX(lane, z) {
  const t = z;
  const roadL = PATH_L_F + (PATH_L_N - PATH_L_F) * t;
  const roadR = PATH_R_F + (PATH_R_N - PATH_R_F) * t;
  const centre = (roadL + roadR) / 2;
  const halfW  = (roadR - roadL) / 2;
  return centre + LANE_NX[lane] * halfW;
}

const P_STAND_H = 110;
const P_SLIDE_H = 48;
const P_W       = 36;

const BARRIER_FRAC   = 0.40;
const OVERHEAD_FRAC  = 0.58;
const OVERHEAD_THICK = 0.14;

const C = {
  bg:     '#080610',
  sky:    '#0a0818',
  gold:   '#d4af37',
  goldD:  '#7a5e10',
  red:    '#991400',
  redB:   '#ff2200',
  stone1: '#3e3020',
  stone2: '#2e2214',
  flesh:  '#c8a478',
  suit:   '#111111',
  white:  '#e8e0cc',
};

export default function FamilyRun() {
  const canvasRef = useRef(null);
  const G         = useRef(null);
  const raf       = useRef(null);
  const touch     = useRef({ x:0, y:0, t:0 });
  const scoreSubmittedRef = useRef(false);

  const [leaderboard, setLeaderboard] = useState([]);
  const [loadingLb, setLoadingLb] = useState(false);

  const fetchLeaderboard = useCallback(async () => {
    setLoadingLb(true);
    try {
      const res = await api.get('/family-run/leaderboard');
      setLeaderboard(res.data?.leaderboard || []);
    } catch {}
    setLoadingLb(false);
  }, []);

  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);

  function makeState() {
    const hi = G.current?.hi ?? 0;
    return {
      phase: 'title', frame: 0, score: 0, coins: 0, lives: 3, hi,
      speed: 0.009,
      spawnTimer: 0,
      player: {
        lane: 1, laneF: 1.0,
        jumpH: 0, jumpV: 0, jumping: false,
        sliding: false, slideTimer: 0,
        invincible: 0,
        runFrame: 0, runTick: 0,
      },
      obstacles: [],
      coinItems: [],
      particles: [],
      stripes:   Array.from({length:14}, (_,i) => i/14),
      buildings: makeBuildings(),
    };
  }

  function makeBuildings() {
    return Array.from({length:16}, (_,i) => ({
      side: i % 2,
      x: i % 2 === 0
        ? 4  + ((i>>1) * 52) % 110
        : W - 36 - ((i>>1) * 52) % 110,
      w: 28 + (i*17)%36,
      h: 65 + (i*41)%115,
      lit: (i*11)%6,
      cols: 1 + i%3,
      rows: 2 + (i*2)%4,
    }));
  }

  function spawn(g) {
    const z0 = 0.02;
    const r = Math.random();
    if (r < 0.22) {
      g.obstacles.push({ type:'barrier',  lane: ri(0,2), z: z0, hit: false });
    } else if (r < 0.42) {
      g.obstacles.push({ type:'overhead', lane: ri(0,2), z: z0, hit: false });
    } else if (r < 0.58) {
      const free = ri(0,2);
      for (let l=0;l<3;l++) if (l!==free)
        g.obstacles.push({ type:'barrier', lane:l, z:z0, hit:false });
    } else if (r < 0.72) {
      const free = ri(0,2);
      for (let l=0;l<3;l++) if (l!==free)
        g.obstacles.push({ type:'overhead', lane:l, z:z0, hit:false });
    } else if (r < 0.84) {
      const l1=ri(0,2), l2=(l1+1+ri(0,1))%3;
      g.obstacles.push({ type:'barrier', lane:l1, z:z0,        hit:false });
      g.obstacles.push({ type:'barrier', lane:l2, z:z0-0.12,   hit:false });
    } else {
      const lane = ri(0,2);
      for (let i=0;i<7;i++)
        g.coinItems.push({ lane, z: z0 - i*0.055, collected: false });
    }
  }

  function ri(a,b) { return a + Math.floor(Math.random()*(b-a+1)); }

  function burst(g, x, y, col, n=10) {
    for (let i=0;i<n;i++) {
      const a=Math.random()*Math.PI*2, s=2+Math.random()*5;
      g.particles.push({ x, y, vx:Math.cos(a)*s, vy:Math.sin(a)*s-3,
        life:1, decay:0.04+Math.random()*0.03, col, r:2+Math.random()*3 });
    }
  }

  const submitScore = useCallback(async (score, coins) => {
    if (scoreSubmittedRef.current) return;
    scoreSubmittedRef.current = true;
    try {
      const res = await api.post('/family-run/score', { score: Math.floor(score), coins });
      if (res.data?.rewards_applied) {
        const r = res.data.rewards_applied;
        const parts = [];
        if (r.money) parts.push(`$${r.money.toLocaleString()}`);
        if (r.respect_points) parts.push(`${r.respect_points} Respect`);
        if (parts.length) toast.success(`Rewards: ${parts.join(', ')}`);
      }
      fetchLeaderboard();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to submit score');
    }
  }, [fetchLeaderboard]);

  const goLeft  = useCallback(() => { const g=G.current; if(!g||g.phase!=='playing')return; if(g.player.lane>0)g.player.lane--; },[]);
  const goRight = useCallback(() => { const g=G.current; if(!g||g.phase!=='playing')return; if(g.player.lane<2)g.player.lane++; },[]);
  const goJump  = useCallback(() => {
    const g=G.current; if(!g||g.phase!=='playing')return;
    const p=g.player;
    if (!p.jumping) {
      p.sliding=false; p.slideTimer=0;
      p.jumping=true; p.jumpH=0; p.jumpV=16;
    }
  },[]);
  const goSlide = useCallback(() => {
    const g=G.current; if(!g||g.phase!=='playing')return;
    const p=g.player;
    if (!p.jumping) { p.sliding=true; p.slideTimer=22; }
  },[]);

  const startGame = useCallback(() => {
    scoreSubmittedRef.current = false;
    G.current=makeState();
    G.current.phase='playing';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- makeState is stable (uses G.current)
  }, []);

  useEffect(() => {
    const kd = e => {
      if (G.current?.phase !== 'playing') { if(e.key===' '||e.key==='Enter') startGame(); return; }
      if(e.key==='ArrowLeft' ||e.key==='a'){e.preventDefault();goLeft();}
      if(e.key==='ArrowRight'||e.key==='d'){e.preventDefault();goRight();}
      if(e.key==='ArrowUp'   ||e.key==='w'||e.key===' '){e.preventDefault();goJump();}
      if(e.key==='ArrowDown' ||e.key==='s'){e.preventDefault();goSlide();}
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [goLeft, goRight, goJump, goSlide, startGame]);

  function onTS(e) { touch.current={x:e.touches[0].clientX,y:e.touches[0].clientY,t:Date.now()}; e.preventDefault(); }
  function onTE(e) {
    if(G.current?.phase!=='playing'){startGame();return;}
    const dx=e.changedTouches[0].clientX-touch.current.x;
    const dy=e.changedTouches[0].clientY-touch.current.y;
    const dt=Date.now()-touch.current.t;
    if(dt<200&&Math.abs(dx)<15&&Math.abs(dy)<15){goJump();return;}
    if(Math.abs(dx)>Math.abs(dy)){if(dx<-18)goLeft();else if(dx>18)goRight();}
    else{if(dy<-18)goJump();else if(dy>18)goSlide();}
    e.preventDefault();
  }

  useEffect(() => {
    G.current = makeState();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const loop = () => {
      const g = G.current;
      if (g.phase==='playing') tick(g);
      render(ctx, g);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only init; makeState/render/tick are stable
  }, []);

  function tick(g) {
    g.frame++;
    g.score += g.speed * 400;
    g.speed  = Math.min(0.022, 0.009 + Math.floor(g.score/400)*0.0012);

    const p = g.player;
    if (p.invincible>0) p.invincible--;

    p.laneF += (p.lane - p.laneF) * 0.17;

    if (p.jumping) {
      p.jumpH += p.jumpV;
      p.jumpV -= 0.85;
      if (p.jumpH <= 0) { p.jumpH=0; p.jumpV=0; p.jumping=false; }
    }

    if (p.sliding) { p.slideTimer--; if(p.slideTimer<=0) p.sliding=false; }

    p.runTick++;
    if (p.runTick%6===0) p.runFrame=(p.runFrame+1)%4;

    g.spawnTimer++;
    const gap = Math.max(42, 92 - Math.floor(g.score/300)*5);
    if (g.spawnTimer>=gap) { g.spawnTimer=0; spawn(g); }

    const sp = g.speed;
    g.obstacles.forEach(o => { o.z += sp; });
    g.coinItems.forEach(c => { c.z  += sp; });
    g.stripes = g.stripes.map(z => { z+=sp; if(z>1.1) z-=1; return z; });
    g.obstacles = g.obstacles.filter(o => o.z<1.15);
    g.coinItems = g.coinItems.filter(c => c.z<1.15);

    if (p.invincible===0) {
      for (const o of g.obstacles) {
        if (o.hit || o.z<0.88 || o.z>1.06) continue;
        if (Math.abs(p.laneF - o.lane) > 0.62) continue;

        const barrierTopPx  = BARRIER_FRAC  * P_STAND_H;
        const overheadBotPx = OVERHEAD_FRAC * P_STAND_H;

        let safe = false;
        if (o.type==='barrier') {
          safe = p.jumping && p.jumpH > barrierTopPx * 0.55;
        } else {
          safe = p.sliding;
        }

        if (!safe) {
          o.hit = true;
          const ox = zToLaneX(o.lane, 1.0);
          const oy = FLOOR_Y - P_STAND_H * 0.5;
          burst(g, ox, oy, C.redB, 14);
          g.lives--;
          p.invincible = 90;
          if (g.lives<=0) {
            if(g.score>g.hi)g.hi=g.score;
            g.phase='dead';
            submitScore(g.score, g.coins);
          }
        }
      }
    }

    for (const c of g.coinItems) {
      if (c.collected||c.z<0.88||c.z>1.06) continue;
      if (Math.abs(p.laneF-c.lane)<0.6) {
        c.collected = true;
        g.coins += 100;
        burst(g, zToLaneX(Math.round(p.laneF),1), FLOOR_Y-60, C.gold, 6);
      }
    }

    g.particles.forEach(pt => { pt.x+=pt.vx; pt.y+=pt.vy; pt.vy+=0.25; pt.vx*=0.91; pt.life-=pt.decay; });
    g.particles = g.particles.filter(pt=>pt.life>0);
  }

  function render(ctx, g) {
    ctx.fillStyle=C.bg; ctx.fillRect(0,0,W,H);
    drawSky(ctx,g);
    drawBuildings(ctx,g);
    drawRoad(ctx,g);
    drawCoins(ctx,g);
    drawObstacles(ctx,g);
    drawPlayer(ctx,g);
    drawParticles(ctx,g);
    drawFog(ctx);
    drawPursuer(ctx,g);
    drawHUD(ctx,g);
    if(g.phase==='title'||g.phase==='dead') drawOverlay(ctx,g);
  }

  function drawSky(ctx,g) {
    ctx.fillStyle=C.sky; ctx.fillRect(0,0,W,VPY+15);
    ctx.fillStyle='#ffe888'; ctx.globalAlpha=0.9;
    ctx.beginPath(); ctx.arc(W*0.78,40,22,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
    for(let i=0;i<44;i++){
      const sx=(i*137+41)%W, sy=(i*83+14)%(VPY-8);
      ctx.globalAlpha=0.15+0.65*Math.abs(Math.sin(i*1.3+g.frame*0.014));
      ctx.fillStyle='#fff8e0'; ctx.fillRect(sx,sy,1.5,1.5);
    }
    ctx.globalAlpha=1;
  }

  function drawBuildings(ctx,g) {
    g.buildings.forEach((b,i) => {
      const bx = b.side===0
        ? (b.x - g.frame*0.28) % (W*0.55)
        : W - b.w - (b.x + g.frame*0.28) % (W*0.55);
      const by = VPY - b.h;
      ctx.fillStyle='#0f0f28'; ctx.fillRect(bx,by,b.w,b.h);
      ctx.strokeStyle='#1c1c3e'; ctx.lineWidth=0.5; ctx.strokeRect(bx,by,b.w,b.h);
      const gx=(b.w-4)/b.cols;
      for(let r=0;r<b.rows;r++) {
        for(let c=0;c<b.cols;c++){
          const lit=((b.lit+r*3+c*7+Math.floor(g.frame*0.005))%4)>0;
          ctx.fillStyle=lit?'#ffe866':'#07071a';
          ctx.globalAlpha=lit?0.82:0.28;
          ctx.fillRect(bx+2+c*gx,by+5+r*10,gx-2,7);
        }
      }
      ctx.globalAlpha=1;
    });
  }

  function drawRoad(ctx,g) {
    const STRIPS = 48;
    for (let i=STRIPS-1; i>=0; i--) {
      const z0 = i/STRIPS;
      const z1 = (i+1)/STRIPS;
      const t0 = z0*z0, t1 = z1*z1;
      const y0 = VPY + (FLOOR_Y - VPY) * t0;
      const y1 = VPY + (FLOOR_Y - VPY) * t1;

      const l0 = PATH_L_F + (PATH_L_N-PATH_L_F)*t0;
      const r0 = PATH_R_F + (PATH_R_N-PATH_R_F)*t0;
      const l1 = PATH_L_F + (PATH_L_N-PATH_L_F)*t1;
      const r1 = PATH_R_F + (PATH_R_N-PATH_R_F)*t1;

      const row = Math.floor(i*2 - g.frame*g.speed*22) & 1;
      ctx.fillStyle = row ? C.stone1 : C.stone2;
      ctx.beginPath();
      ctx.moveTo(l1,y1); ctx.lineTo(r1,y1);
      ctx.lineTo(r0,y0); ctx.lineTo(l0,y0);
      ctx.closePath(); ctx.fill();

      if (i%2===0) {
        ctx.strokeStyle='rgba(0,0,0,0.45)'; ctx.lineWidth=0.7;
        ctx.beginPath(); ctx.moveTo(l1,y1); ctx.lineTo(r1,y1); ctx.stroke();
      }
    }

    ctx.strokeStyle='rgba(212,175,55,0.72)'; ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(PATH_L_N, FLOOR_Y); ctx.lineTo(PATH_L_F, VPY);
    ctx.moveTo(PATH_R_N, FLOOR_Y); ctx.lineTo(PATH_R_F, VPY);
    ctx.stroke();

    for (let l=1;l<3;l++) {
      const lxN = zToLaneX(l-1, 1.0) + (zToLaneX(l,1.0)-zToLaneX(l-1,1.0))/2;
      const lxF = zToLaneX(l-1, 0.0) + (zToLaneX(l,0.0)-zToLaneX(l-1,0.0))/2;
      ctx.strokeStyle='rgba(212,175,55,0.28)'; ctx.lineWidth=1; ctx.setLineDash([9,15]);
      ctx.beginPath(); ctx.moveTo(lxN,FLOOR_Y); ctx.lineTo(lxF,VPY); ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.strokeStyle='rgba(212,175,55,0.55)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(PATH_L_F,VPY); ctx.lineTo(PATH_R_F,VPY); ctx.stroke();

    ctx.strokeStyle='rgba(200,155,25,0.18)'; ctx.lineWidth=0.8;
    g.stripes.forEach(z => {
      if(z<0.02||z>1) return;
      const t=z*z;
      const y  = VPY+(FLOOR_Y-VPY)*t;
      const lx = PATH_L_F+(PATH_L_N-PATH_L_F)*t;
      const rx = PATH_R_F+(PATH_R_N-PATH_R_F)*t;
      ctx.beginPath(); ctx.moveTo(lx+1,y); ctx.lineTo(rx-1,y); ctx.stroke();
    });
  }

  function drawCoins(ctx,g) {
    [...g.coinItems].sort((a,b)=>a.z-b.z).forEach(c => {
      if(c.collected||c.z<0.01||c.z>1.05) return;
      const sc=zToScale(c.z);
      const cx2=zToLaneX(c.lane, c.z);
      const cy2=zToY(c.z) - 18*sc;
      const r=Math.max(3,10*sc);
      const pulse=0.88+0.12*Math.sin(g.frame*0.13+c.z*8);
      ctx.save(); ctx.translate(cx2,cy2); ctx.scale(pulse,pulse);
      ctx.fillStyle=C.gold; ctx.strokeStyle='#ffe060'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill(); ctx.stroke();
      if(r>6){ ctx.fillStyle='#fff8a0'; ctx.font=`bold ${Math.round(11*sc)}px monospace`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('$',0,0); }
      ctx.restore();
    });
  }

  function drawObstacles(ctx,g) {
    [...g.obstacles].sort((a,b)=>a.z-b.z).forEach(o => {
      if(o.hit||o.z<0.02||o.z>1.08) return;

      const sc = zToScale(o.z);
      const cx = zToLaneX(o.lane, o.z);
      const gy = zToY(o.z);

      const pH = P_STAND_H * sc;

      if (o.type==='barrier') {
        const bh = pH * BARRIER_FRAC;
        const bw = Math.max(12, pH * 0.62);
        const topY = gy - bh;

        ctx.fillStyle='rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.ellipse(cx, gy+2, bw*0.6, Math.max(2,3*sc), 0,0,Math.PI*2); ctx.fill();

        ctx.fillStyle='#4a3820';
        ctx.fillRect(cx-bw/2, topY, bw, bh);

        for(let row=0;row<3;row++){
          ctx.fillStyle=row%2===0?'#5e4830':'#3a2a14';
          ctx.fillRect(cx-bw/2+1, topY+row*(bh/3)+1, bw-2, bh/3-2);
        }

        const sh = Math.max(3, bh*0.22);
        const sw = bw/6;
        for(let i=0;i<6;i++){
          ctx.fillStyle=i%2===0?'#ffcc00':'#cc2200';
          ctx.fillRect(cx-bw/2+i*sw, topY, sw, sh);
        }

        ctx.strokeStyle='#ffaa00'; ctx.lineWidth=Math.max(1, 1.5*sc);
        ctx.strokeRect(cx-bw/2, topY, bw, bh);

        ctx.fillStyle='#ffee00';
        ctx.font=`bold ${Math.max(10,Math.round(13*sc))}px monospace`;
        ctx.textAlign='center';
        ctx.fillText('JUMP', cx, topY - Math.max(4,6*sc));

      } else {
        const barBotY = gy - pH * OVERHEAD_FRAC;
        const barTopY = barBotY - pH * OVERHEAD_THICK;
        const bw = Math.max(14, pH * 0.78);
        const bh = barBotY - barTopY;
        const postH = gy - barTopY;
        const postW = Math.max(3, bw*0.1);

        ctx.fillStyle='rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(cx, gy+2, bw*0.55, Math.max(2,3*sc), 0,0,Math.PI*2); ctx.fill();

        ctx.fillStyle='#3a4a5e';
        ctx.fillRect(cx-bw/2,       barTopY, postW, postH);
        ctx.fillRect(cx+bw/2-postW, barTopY, postW, postH);
        ctx.fillStyle='#5a7090';
        ctx.fillRect(cx-bw/2+1,       barTopY, Math.max(1,postW*0.35), postH);
        ctx.fillRect(cx+bw/2-postW+1, barTopY, Math.max(1,postW*0.35), postH);

        ctx.fillStyle='#2c3c50';
        ctx.fillRect(cx-bw/2, barTopY, bw, bh);
        ctx.fillStyle='#4a688a';
        ctx.fillRect(cx-bw/2+1, barTopY+1, bw-2, Math.max(1,bh*0.38));

        ctx.save();
        ctx.beginPath(); ctx.rect(cx-bw/2, barTopY, bw, bh); ctx.clip();
        ctx.strokeStyle='#ffcc00'; ctx.lineWidth=Math.max(1,1.5*sc);
        for(let xi=-1;xi<6;xi++){
          const x1=cx-bw/2+xi*(bw*0.28);
          ctx.beginPath(); ctx.moveTo(x1,barTopY); ctx.lineTo(x1+bh*1.2,barTopY+bh); ctx.stroke();
        }
        ctx.restore();

        ctx.strokeStyle='#8aabcc'; ctx.lineWidth=Math.max(0.5,0.8*sc);
        ctx.strokeRect(cx-bw/2, barTopY, bw, bh);

        const pulse=0.5+0.5*Math.sin(g.frame*0.18);
        const lr=Math.max(2,4*sc);
        ctx.fillStyle=`rgba(255,20,0,${0.6+0.4*pulse})`;
        ctx.beginPath(); ctx.arc(cx-bw/2+lr, barTopY+bh/2, lr, 0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx+bw/2-lr, barTopY+bh/2, lr, 0,Math.PI*2); ctx.fill();
        ctx.fillStyle=`rgba(255,60,0,${0.25*pulse})`;
        ctx.beginPath(); ctx.arc(cx-bw/2+lr, barTopY+bh/2, lr*2.8, 0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx+bw/2-lr, barTopY+bh/2, lr*2.8, 0,Math.PI*2); ctx.fill();

        ctx.fillStyle='#44ddff';
        ctx.font=`bold ${Math.max(10,Math.round(13*sc))}px monospace`;
        ctx.textAlign='center';
        ctx.fillText('SLIDE', cx, barTopY - Math.max(4,6*sc));
      }
    });
  }

  function drawPlayer(ctx,g) {
    const p = g.player;
    if(p.invincible>0 && Math.floor(g.frame/4)%2===0) return;

    const lx = zToLaneX(0,1), rx = zToLaneX(2,1);
    const pcx = lx + (p.laneF/2 + 0.5) * (rx - lx);

    const groundPY = FLOOR_Y;
    const drawPY   = groundPY - p.jumpH;

    const bh  = p.sliding ? P_SLIDE_H : P_STAND_H;
    const bw  = P_W;
    const legH= P_STAND_H * 0.38;
    const ls  = Math.sin(p.runFrame*Math.PI/2) * 9;
    const bob = (p.jumping||p.sliding)?0:Math.sin(p.runFrame*Math.PI/2)*2.5;

    const shA=Math.max(0,0.5-p.jumpH/200);
    ctx.fillStyle=`rgba(0,0,0,${shA})`;
    ctx.beginPath(); ctx.ellipse(pcx,groundPY+4,20,5,0,0,Math.PI*2); ctx.fill();

    ctx.save();
    ctx.translate(pcx, drawPY+bob);

    if (p.sliding) {
      const sw=bw*1.7, sh=bh;
      ctx.fillStyle=C.suit;
      ctx.beginPath(); ctx.roundRect(-sw/2,-sh,sw,sh,5); ctx.fill();
      ctx.fillStyle=C.flesh;
      ctx.beginPath(); ctx.arc(sw*0.28,-sh*0.52,sh*0.42,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=C.suit;
      ctx.fillRect(sw*0.06,-sh-sh*0.28,sh*1.0,sh*0.14);
      ctx.fillRect(sw*0.16,-sh-sh*0.65,sh*0.7,sh*0.42);
      ctx.fillStyle=C.goldD; ctx.fillRect(sw*0.16,-sh-sh*0.28,sh*0.7,sh*0.1);

    } else {
      ctx.fillStyle='#0c0c0c';
      ctx.fillRect(-bw/2+1    -ls*0.38, -legH, bw/2-2, legH);
      ctx.fillRect( bw/4      +ls*0.38, -legH, bw/2-2, legH);
      ctx.fillStyle='#050505';
      ctx.fillRect(-bw/2-4-ls*0.35, -3, bw/2+4, 7);
      ctx.fillRect( bw/4+ls*0.35,   -3, bw/2+4, 7);

      ctx.fillStyle='#191919';
      ctx.fillRect(-bw/2-10, -P_STAND_H+legH+ls*0.4, 9, P_STAND_H*0.38);
      ctx.fillRect( bw/2+1,  -P_STAND_H+legH-ls*0.4, 9, P_STAND_H*0.38);

      ctx.fillStyle=C.suit;
      ctx.beginPath();
      ctx.roundRect(-bw/2, -P_STAND_H+legH, bw, P_STAND_H-legH-P_STAND_H*0.18, 4);
      ctx.fill();

      ctx.fillStyle='#202020';
      ctx.beginPath();
      ctx.moveTo(-bw*0.14,-P_STAND_H+legH+2); ctx.lineTo(0,-P_STAND_H+legH+P_STAND_H*0.22); ctx.lineTo(-bw/2+2,-P_STAND_H+legH+2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo( bw*0.14,-P_STAND_H+legH+2); ctx.lineTo(0,-P_STAND_H+legH+P_STAND_H*0.22); ctx.lineTo( bw/2-2,-P_STAND_H+legH+2);
      ctx.fill();

      ctx.fillStyle=C.white; ctx.fillRect(-5,-P_STAND_H+legH+2,10,P_STAND_H*0.15);
      ctx.fillStyle=C.red;
      ctx.beginPath();
      ctx.moveTo(-5,-P_STAND_H+legH+P_STAND_H*0.12); ctx.lineTo(5,-P_STAND_H+legH+P_STAND_H*0.12);
      ctx.lineTo(3.5,-P_STAND_H+legH+P_STAND_H*0.46); ctx.lineTo(0,-P_STAND_H+legH+P_STAND_H*0.52);
      ctx.lineTo(-3.5,-P_STAND_H+legH+P_STAND_H*0.46); ctx.closePath(); ctx.fill();

      const hR=P_STAND_H*0.16;
      ctx.fillStyle=C.flesh;
      ctx.beginPath(); ctx.arc(0,-P_STAND_H+legH-hR,hR,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#1a1a1a';
      ctx.fillRect(-hR*0.55,-P_STAND_H+legH-hR*1.25,hR*0.32,hR*0.28);
      ctx.fillRect( hR*0.24,-P_STAND_H+legH-hR*1.25,hR*0.32,hR*0.28);
      ctx.strokeStyle='#4a1010'; ctx.lineWidth=1.5;
      ctx.beginPath();
      ctx.moveTo(-hR*0.4,-P_STAND_H+legH-hR*0.6);
      ctx.lineTo( hR*0.4,-P_STAND_H+legH-hR*0.6); ctx.stroke();

      const brimW=hR*2.6, crownW=hR*1.7, crownH=hR*1.6, brimH=hR*0.42;
      ctx.fillStyle=C.suit;
      ctx.fillRect(-brimW/2, -P_STAND_H+legH-hR*2-brimH, brimW, brimH);
      ctx.fillRect(-crownW/2,-P_STAND_H+legH-hR*2-brimH-crownH, crownW, crownH);
      ctx.fillStyle=C.goldD;
      ctx.fillRect(-crownW/2,-P_STAND_H+legH-hR*2-brimH, crownW, brimH*0.3);
    }

    ctx.restore();
  }

  function drawPursuer(ctx,g) {
    if(g.phase!=='playing') return;
    const cx=W/2+Math.sin(g.frame*0.04)*8, cy=VPY+5;
    const sc=0.3+0.025*Math.sin(g.frame*0.05);
    ctx.save(); ctx.translate(cx,cy); ctx.scale(sc,sc);
    ctx.globalAlpha=0.38+0.16*Math.sin(g.frame*0.04);
    ctx.fillStyle='#280000'; ctx.fillRect(-14,-58,28,58);
    ctx.fillStyle='#1c0000'; ctx.beginPath(); ctx.arc(0,-68,16,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=0.85; ctx.fillStyle='#ff0000';
    ctx.beginPath(); ctx.arc(-6,-68,4,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc( 6,-68,4,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1; ctx.restore();
  }

  function drawParticles(ctx,g) {
    g.particles.forEach(p => {
      ctx.globalAlpha=Math.max(0,p.life);
      ctx.fillStyle=p.col;
      ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(0.5,p.r*p.life),0,Math.PI*2); ctx.fill();
    });
    ctx.globalAlpha=1;
  }

  function drawFog(ctx) {
    const fg=ctx.createLinearGradient(0,VPY-12,0,VPY+55);
    fg.addColorStop(0,'rgba(8,6,16,0.95)');
    fg.addColorStop(1,'rgba(8,6,16,0)');
    ctx.fillStyle=fg; ctx.fillRect(0,VPY-12,W,68);
  }

  function drawHUD(ctx,g) {
    if(g.phase!=='playing') return;
    ctx.fillStyle='rgba(0,0,0,0.62)'; ctx.fillRect(0,0,W,36);
    ctx.fillStyle=C.gold; ctx.font='bold 14px monospace';
    ctx.textAlign='left';  ctx.fillText(Math.floor(g.score)+' m',12,24);
    ctx.textAlign='center';ctx.fillText('$'+g.coins,W/2,24);
    ctx.textAlign='right';
    ctx.fillStyle=g.lives===1?'#ff3300':C.gold;
    ctx.fillText('I'.repeat(Math.max(0,g.lives))+'·'.repeat(Math.max(0,3-g.lives)),W-12,24);
    const spd=(g.speed-0.009)/(0.022-0.009);
    ctx.fillStyle='#181818'; ctx.fillRect(12,29,W-24,5);
    ctx.fillStyle=spd>0.7?'#ff3300':spd>0.4?'#ff8800':C.gold;
    ctx.fillRect(12,29,(W-24)*Math.min(1,Math.max(0,spd)),5);
  }

  function drawOverlay(ctx,g) {
    ctx.fillStyle='rgba(0,0,0,0.82)'; ctx.fillRect(0,0,W,H);
    ctx.textAlign='center';
    if(g.phase==='title'){
      ctx.fillStyle=C.gold; ctx.font='bold 50px Georgia,serif'; ctx.fillText('FAMILY',W/2,H/2-112);
      ctx.fillStyle='#f0e8cc'; ctx.font='bold 58px Georgia,serif'; ctx.fillText('RUN',W/2,H/2-54);
      ctx.strokeStyle=C.goldD; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(W/2-118,H/2-33); ctx.lineTo(W/2+118,H/2-33); ctx.stroke();
      ctx.fillStyle='rgba(212,175,55,0.52)'; ctx.font='italic 13px Georgia,serif';
      ctx.fillText('"Nobody runs from the family."',W/2,H/2-14);
      ctx.fillStyle='#999'; ctx.font='12px monospace';
      ['← →  /  swipe  —  change lane','↑  /  swipe up  —  jump over barriers','↓  /  swipe down  —  slide under bars']
        .forEach((t,i)=>ctx.fillText(t,W/2,H/2+14+i*22));
      if(g.hi>0){ctx.fillStyle=C.goldD;ctx.font='13px monospace';ctx.fillText('BEST  '+Math.floor(g.hi)+' m',W/2,H/2+92);}
      ctx.fillStyle=C.gold; ctx.font='bold 16px Georgia,serif';
      ctx.globalAlpha=0.65+0.35*Math.sin(Date.now()*0.0024);
      ctx.fillText('— TAP OR PRESS SPACE —',W/2,H/2+130); ctx.globalAlpha=1;
    } else {
      ctx.fillStyle=C.redB; ctx.font='bold 50px Georgia,serif'; ctx.fillText('WHACKED',W/2,H/2-105);
      ctx.strokeStyle=C.red; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(W/2-132,H/2-80); ctx.lineTo(W/2+132,H/2-80); ctx.stroke();
      ctx.fillStyle=C.gold; ctx.font='bold 30px monospace'; ctx.fillText(Math.floor(g.score)+' m',W/2,H/2-40);
      ctx.fillStyle='#00cc44'; ctx.font='18px monospace'; ctx.fillText('$'+g.coins,W/2,H/2-12);
      if(g.hi>0){ctx.fillStyle=C.goldD;ctx.font='13px monospace';ctx.fillText('BEST  '+Math.floor(g.hi)+' m',W/2,H/2+14);}
      const qq=['"Should\'ve paid your debts."','"The Don sends his regards."','"Sleep with the fishes."','"Can\'t outrun the family."'];
      ctx.fillStyle='rgba(180,140,30,0.5)'; ctx.font='italic 12px Georgia,serif';
      ctx.fillText(qq[Math.floor(Date.now()/3200)%qq.length],W/2,H/2+44);
      ctx.fillStyle=C.gold; ctx.font='bold 15px Georgia,serif';
      ctx.globalAlpha=0.65+0.35*Math.sin(Date.now()*0.0028);
      ctx.fillText('— TAP TO RUN AGAIN —',W/2,H/2+94); ctx.globalAlpha=1;
    }
  }

  const btn = {
    flex:1, padding:'13px 0',
    background:'rgba(212,175,55,0.07)',
    border:'1px solid rgba(212,175,55,0.28)',
    color:'#d4af37', fontFamily:'monospace', fontSize:12,
    letterSpacing:'0.04em', cursor:'pointer', borderRadius:4,
    WebkitTapHighlightColor:'transparent', touchAction:'manipulation',
  };

  return (
    <div className={`${styles.pageContent} space-y-3`}>
      <header className="flex items-center gap-2 mb-2">
        <Link to="/casino/mini-games/leaderboard" className="p-1 rounded hover:bg-primary/10 transition-colors">
          <ArrowLeft size={16} className="text-primary" />
        </Link>
        <h1 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">Family Run</h1>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <div style={{background:'#060410',borderRadius:8,overflow:'hidden'}}>
            <canvas ref={canvasRef} width={W} height={H}
              style={{display:'block',width:'100%',maxWidth:W,cursor:'pointer',touchAction:'none',margin:'0 auto'}}
              onClick={()=>{if(G.current?.phase!=='playing')startGame();}}
              onTouchStart={onTS} onTouchEnd={onTE}/>
            <div style={{width:'100%',maxWidth:W,display:'flex',gap:5,padding:'6px 8px 0',boxSizing:'border-box',margin:'0 auto'}}>
              <button style={btn} onPointerDown={e=>{e.preventDefault();G.current?.phase==='playing'?goLeft():startGame();}}>← LEFT</button>
              <button style={btn} onPointerDown={e=>{e.preventDefault();G.current?.phase==='playing'?goJump():startGame();}}>↑ JUMP</button>
              <button style={btn} onPointerDown={e=>{e.preventDefault();G.current?.phase==='playing'?goSlide():startGame();}}>↓ SLIDE</button>
              <button style={btn} onPointerDown={e=>{e.preventDefault();G.current?.phase==='playing'?goRight():startGame();}}>RIGHT →</button>
            </div>
            <div style={{color:'rgba(212,175,55,0.28)',fontSize:11,marginTop:7,fontFamily:'monospace',letterSpacing:'0.07em',textAlign:'center',paddingBottom:10}}>
              jump barriers · slide under bars · dodge lanes
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <section className={`${styles.panel} rounded-lg overflow-hidden`}>
            <div className="px-3 py-2 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy size={14} className="text-primary" />
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Top 10</h2>
              </div>
              <button onClick={fetchLeaderboard} disabled={loadingLb} className="p-1 rounded hover:bg-primary/10">
                <RefreshCw size={12} className={`text-primary ${loadingLb ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="p-2 space-y-1 max-h-[320px] overflow-y-auto">
              {leaderboard.length === 0 ? (
                <p className="text-[10px] text-mutedForeground italic py-4 text-center font-heading">No scores yet</p>
              ) : (
                leaderboard.map((entry, i) => (
                  <div
                    key={entry.user_id + '-' + i}
                    className={`flex items-center gap-2 p-2 rounded-sm border ${
                      entry.is_me
                        ? 'bg-primary/15 border-primary/40'
                        : `${styles.surfaceMuted} border-primary/10`
                    }`}
                  >
                    <div className={`w-6 h-6 flex items-center justify-center rounded-sm font-heading font-bold text-xs ${
                      i === 0 ? 'bg-yellow-500/20 text-yellow-500' :
                      i === 1 ? 'bg-zinc-400/20 text-zinc-400' :
                      i === 2 ? 'bg-amber-600/20 text-amber-500' :
                      'bg-primary/10 text-mutedForeground'
                    }`}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <Link to={`/profile/${encodeURIComponent(entry.username)}`} className="font-heading text-xs text-foreground hover:text-primary truncate block">
                        {entry.username} {entry.is_me && <span className="text-primary text-[9px]">(You)</span>}
                      </Link>
                    </div>
                    <div className="text-xs font-heading text-primary font-bold">{entry.score.toLocaleString()} m</div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className={`${styles.panel} rounded-lg p-3`}>
            <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider mb-2">Rewards</h3>
            <ul className="text-[10px] text-mutedForeground font-heading space-y-1">
              <li>• Cash: <span className="text-green-400">$10 per 100m</span></li>
              <li>• Respect: <span className="text-pink-400">+1 per 200m</span></li>
              <li>• Coins collected add bonus cash</li>
              <li>• Weekly leaderboard points earned</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
