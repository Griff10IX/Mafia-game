import { useEffect, useRef, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Trophy, RefreshCw } from "lucide-react";
import api from "../../utils/api";
import { startMinigameRun } from "../../utils/minigameRunSession";
import useMinigamePlaysLeft from "../../hooks/useMinigamePlaysLeft";
import { toast } from "sonner";
import styles from "../../styles/noir.module.css";

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════
const TS=24, MW=64, MH=64, NW=600, NH=460;
const PLAYER_SPD=2.8, CAR_MAX=3.8, CAR_ACCEL=0.10, CAR_FRIC=0.90, CAR_STEER=0.055;
const BULLET_SPD=11, SHOOT_CD=18;
const T={ROAD:0,WALK:1,BLDG:2,SPEAKEASY:3,CAPO:4,PARK:5,WATER:6,DOCK:7,CROSS:8};
const SOLID=new Set([T.BLDG,T.SPEAKEASY,T.CAPO,T.WATER]);

function mkRng(seed){let s=(seed*1664525+1013904223)>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/0x100000000;};}
function tileAt(map,wx,wy){const tx=wx/TS|0,ty=wy/TS|0;if(tx<0||ty<0||tx>=MW||ty>=MH)return T.BLDG;return map[ty][tx];}
// Cars should only drive on road/cross tiles
const ROAD_TILES=new Set([T.ROAD,T.CROSS]);
function isRoad(map,wx,wy){const t=tileAt(map,wx,wy);return ROAD_TILES.has(t);}
// A car position is valid if ALL 4 corners are on road tiles
function carOnRoad(map,cx,cy,r=14){
  return isRoad(map,cx-r,cy-r)&&isRoad(map,cx+r,cy-r)&&
         isRoad(map,cx-r,cy+r)&&isRoad(map,cx+r,cy+r);
}
function isSolid(map,wx,wy){return SOLID.has(tileAt(map,wx,wy));}
function canMove(map,nx,ny,r){return!isSolid(map,nx-r,ny-r)&&!isSolid(map,nx+r,ny-r)&&!isSolid(map,nx-r,ny+r)&&!isSolid(map,nx+r,ny+r);}

// ═══════════════════════════════════════════════════════════════════
// GROUND TILE SPRITES  (48px, for road/walk/park/water/dock)
// ═══════════════════════════════════════════════════════════════════
const SZ=48;
function makeGroundTile(type,variant){
  const oc=document.createElement("canvas");oc.width=oc.height=SZ;
  const g=oc.getContext("2d");const rng=mkRng(type*997+variant*131);
  const px=(x,y,w,h,c)=>{g.fillStyle=c;g.fillRect(x,y,w,h);};
  switch(type){
    case T.ROAD:{
      px(0,0,SZ,SZ,"#1a1a18");
      // Tarmac texture
      for(let i=0;i<30;i++){const tx=rng()*SZ|0,ty=rng()*SZ|0;px(tx,ty,1+(rng()*2|0),1,rng()>.5?"#1e1e1c":"#141412");}
      // Aggregate speckle
      for(let i=0;i<8;i++){px(rng()*SZ|0,rng()*SZ|0,1,1,"#28281e");}
      // Kerb lines
      px(0,0,SZ,2,"#252422");px(0,1,SZ,1,"#2e2c28");
      px(0,SZ-2,SZ,2,"#202020");px(0,SZ-1,SZ,1,"#2a2826");
      // Double centre-line dashes
      px(SZ/2-3,2,2,SZ/2-6,"#3c3a12");px(SZ/2+1,2,2,SZ/2-6,"#3c3a12");
      px(SZ/2-3,SZ/2+4,2,SZ/2-6,"#3c3a12");px(SZ/2+1,SZ/2+4,2,SZ/2-6,"#3c3a12");
      px(SZ/2-2,3,1,SZ/2-8,"#545228");px(SZ/2+2,3,1,SZ/2-8,"#545228");
      break;}
    case T.CROSS:{
      px(0,0,SZ,SZ,"#1a1a18");
      for(let i=0;i<10;i++){px(rng()*SZ|0,rng()*SZ|0,2,1,"#1e1e1c");}
      for(let s=2;s<SZ-2;s+=6){
        const w=rng()>.3?2:3;
        px(s,0,w,7,"#2e2e2a");px(s,SZ-7,w,7,"#2e2e2a");
        px(0,s,7,w,"#2e2e2a");px(SZ-7,s,7,w,"#2e2e2a");
      }
      break;}
    case T.WALK:{
      // Warm limestone cobblestones — NOT dark brown
      const bases=["#9a8870","#928070","#a09080","#8c7a68"];
      px(0,0,SZ,SZ,bases[variant%4]);
      const sw=11,sh=9;
      for(let row=0;row<SZ;row+=sh){
        const off=((row/sh|0)%2)*5;
        px(0,row,SZ,1,"#5a5040");// mortar h
        for(let col=-5+off;col<SZ;col+=sw){
          const f=rng()>.6?"#a08e78":rng()>.5?"#988878":"#ac9882";
          px(col+1,row+1,sw-2,sh-2,f);
          px(col+1,row+1,sw-2,1,"#c0ae98");// top highlight
          px(col+1,row+1,1,sh-2,"#b8a088");// left highlight
          px(col+1,row+sh-2,sw-2,1,"#706050");// bottom shadow
          px(col+sw-2,row+1,1,sh-2,"#786858");// right shadow
          px(col,row,1,sh,"#4e4438");// mortar v
          if(rng()>.85){px(col+3,row+3,2,1,"#887868");px(col+4,row+4,1,1,"#90806e");}
        }
      }
      px(0,0,1,SZ,"#4a3c30");px(SZ-1,0,1,SZ,"#4a3c30");
      break;}
    case T.PARK:{
      const gr=["#3a5a20","#345218","#406020","#2e4e18"];
      px(0,0,SZ,SZ,gr[variant%4]);
      for(let i=0;i<30;i++){px(rng()*SZ|0,rng()*SZ|0,1+(rng()*3|0),1,gr[rng()*4|0]);}
      if(rng()>.5)px(SZ/2-2,0,4,SZ,"#2a3c10");
      if(rng()>.4){
        const tx=rng()*(SZ-18)|0+2,ty=rng()*(SZ-22)|0+2;
        px(tx+6,ty+16,5,10,"#4a3018");px(tx+7,ty+16,3,10,"#5a3820");
        px(tx+2,ty+10,14,8,"#264010");px(tx,ty+6,17,6,"#2a4814");
        px(tx+2,ty+2,13,6,"#244010");px(tx+4,ty,10,4,"#284412");
        px(tx+2,ty+2,4,3,"#3a5818");
      }
      if(rng()>.68){px(3,SZ-10,SZ-6,3,"#6a5838");px(3,SZ-8,2,5,"#6a5838");px(SZ-6,SZ-8,2,5,"#6a5838");}
      break;}
    case T.WATER:{
      px(0,0,SZ,SZ,"#1c3850");
      for(let i=0;i<8;i++){const wy=rng()*SZ|0,wx=rng()*(SZ-10)|0;px(wx,wy,10+(rng()*8|0),1,rng()>.5?"#22405c":"#182e44");}
      px(0,0,SZ,2,"#284860");px(0,1,SZ,1,"#1e3850");
      if(rng()>.5)px(4,SZ/2,16,2,"#2a4a62");
      break;}
    case T.DOCK:{
      px(0,0,SZ,SZ,"#3c2e1a");
      for(let plank=0;plank<SZ;plank+=5){
        const c=rng()>.5?"#4a3820":"#443218";
        px(0,plank,SZ,4,c);px(0,plank+4,SZ,1,"#281e0e");
        for(let i=0;i<4;i++)px(rng()*SZ|0,plank+1,1,2,"#342810");
        px(3,plank+1,2,2,"#2a2010");px(SZ-5,plank+1,2,2,"#2a2010");
      }
      px(0,0,SZ,2,"#584030");px(0,0,2,SZ,"#584030");
      break;}
  }
  return oc;
}

// ═══════════════════════════════════════════════════════════════════
// BUILDING FACADE PAINTER  — draws a full 9×9-tile building face
// as one large canvas.  Much more realistic than tiling.
// ═══════════════════════════════════════════════════════════════════
function paintBuilding(type,blockW,blockH,seed){
  const W=blockW*TS,H=blockH*TS;
  const oc=document.createElement("canvas");oc.width=W;oc.height=H;
  const g=oc.getContext("2d");
  const rng=mkRng(seed);
  const px=(x,y,w,h,c)=>{if(w>0&&h>0){g.fillStyle=c;g.fillRect(x,y,w,h);}};
  const line=(x1,y1,x2,y2,c,lw=1)=>{g.strokeStyle=c;g.lineWidth=lw;g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.stroke();};

  if(type===T.BLDG){
    // ── Brownstone / brick apartment block ──
    const brickCols=["#7a4a2c","#724428","#804e30","#6e4026","#784c2e"];
    const wallCol=brickCols[seed%5];
    px(0,0,W,H,wallCol);
    // Brick pattern — horizontal courses
    const bH=7,bW=18;
    for(let row=0;row<H;row+=bH){
      const off=((row/bH|0)%2)*(bW/2);
      g.fillStyle="#3a2010";g.fillRect(0,row,W,1);// mortar h
      for(let col=-bW+off;col<W+bW;col+=bW){
        const shade=rng()>.55?wallCol:rng()>.5?"#6e3e24":"#8a5234";
        px(col+1,row+1,bW-2,bH-2,shade);
        px(col+1,row+1,bW-2,1,"#9a6040");// brick top highlight
        px(col+1,row+bH-2,bW-2,1,"#3a1e0c");// brick bottom shadow
        g.fillStyle="#2e180a";g.fillRect(col,row,1,bH);// mortar v
      }
    }
    // Stone cornice band at top
    px(0,0,W,14,"#584030");px(0,0,W,2,"#705040");px(0,2,W,1,"#806050");
    px(0,12,W,2,"#402818");
    // Decorative string course at 1/3 and 2/3 height
    [Math.floor(H*0.33),Math.floor(H*0.66)].forEach(sy=>{
      px(0,sy,W,6,"#604838");px(0,sy,W,1,"#806050");px(0,sy+5,W,1,"#301808");
    });
    // Stoop / base
    px(0,H-10,W,10,"#4a3420");px(0,H-10,W,2,"#5a4030");px(0,H-2,W,2,"#382010");

    // ── Windows — proper 1920s double-hung style ──
    const winW=28,winH=38,winCols=Math.max(2,Math.floor((W-30)/50));
    const winRows=Math.max(2,Math.floor((H-40)/55));
    const hPad=Math.floor((W-winCols*winW)/(winCols+1));
    const vPad=Math.floor((H-winRows*winH-20)/(winRows+1))+14;
    for(let wr=0;wr<winRows;wr++){
      for(let wc=0;wc<winCols;wc++){
        const wx=hPad+wc*(winW+hPad);
        const wy=vPad+wr*(winH+Math.floor((H-40-winRows*winH)/(winRows+1)));
        const lit=rng()>.25;
        // Outer stone surround
        px(wx-4,wy-4,winW+8,winH+8,"#4e3018");
        px(wx-4,wy-4,winW+8,2,"#604030");// lintel
        px(wx-4,wy+winH+2,winW+8,4,"#3e2410");// sill
        px(wx-4,wy+winH+4,winW+8,2,"#5a3820");// sill lip
        // Window frame
        px(wx,wy,winW,winH,"#1a1008");
        // Glass panes (4-pane double hung)
        const glassCol=lit?"#c8920c":"#0a0806";
        const glassLight=lit?"#f0b828":"#0e0c08";
        // Upper sash
        px(wx+2,wy+2,winW/2-3,winH/2-2,glassCol);
        px(wx+winW/2,wy+2,winW/2-2,winH/2-2,glassCol);
        // Lower sash
        px(wx+2,wy+winH/2+1,winW/2-3,winH/2-3,glassCol);
        px(wx+winW/2,wy+winH/2+1,winW/2-2,winH/2-3,glassCol);
        if(lit){
          // Warm inner glow
          px(wx+2,wy+2,winW-4,4,glassLight);
          px(wx+2,wy+2,2,winH-4,"#a07020");// left curtain
          px(wx+winW-4,wy+2,2,winH-4,"#a07020");// right curtain
        }
        // Glazing bars (mullions)
        px(wx+winW/2-1,wy+2,2,winH-4,"#1a1008");// vertical centre
        px(wx+2,wy+winH/2-1,winW-4,2,"#1a1008");// horizontal centre
        // Meeting rail (thicker middle bar)
        px(wx+2,wy+winH/2-2,winW-4,4,"#201408");
      }
    }
    // Entrance door at bottom centre
    const dw=32,dh=48,dx=W/2-dw/2;
    px(dx-4,H-dh-14,dw+8,dh+14,"#3e2810");// surround
    px(dx-4,H-dh-14,dw+8,4,"#584030");// arch top
    px(dx,H-dh-10,dw,dh+10,"#0e0804");// door opening
    px(dx+2,H-dh-8,dw-4,dh,"#140e06");// door
    px(dx+4,H-dh-6,dw/2-6,dh-8,"#180e06");// left panel
    px(dx+dw/2+2,H-dh-6,dw/2-6,dh-8,"#180e06");// right panel
    px(dx+dw/2-2,H-dh-10,4,dh,"#100a04");// centre stile
    px(dx+dw/2-1,H-dh/2,3,3,"#b49650");// knob

  } else if(type===T.SPEAKEASY){
    // ── Dark brick speakeasy / jazz club ──
    px(0,0,W,H,"#2a1608");
    // Dark brick
    const sbH=6,sbW=16;
    for(let row=0;row<H;row+=sbH){
      const off=((row/sbH|0)%2)*8;
      g.fillStyle="#16090400";g.fillRect(0,row,W,1);
      for(let col=-sbW+off;col<W+sbW;col+=sbW){
        px(col+1,row+1,sbW-2,sbH-2,"#301a0c");
        px(col+1,row+1,sbW-2,1,"#3c2010");
        px(col+1,row+sbH-2,sbW-2,1,"#1a0c04");
        g.fillStyle="#120804";g.fillRect(col,row,1,sbH);
      }
    }
    // Neon-style sign at top
    px(4,4,W-8,18,"#1a0a04");
    px(4,4,W-8,1,"#b49650");px(4,21,W-8,1,"#b49650");
    px(5,5,W-10,16,"#8a6020");
    px(6,6,W-12,14,"#5a3c10");
    // Neon letters hint (red glow)
    for(let nx=10;nx<W-10;nx+=12){px(nx,8,8,10,"#2a0808");px(nx+1,9,6,8,"#440c0c");}
    // Red lamp
    px(W/2-5,1,10,5,"#600808");px(W/2-4,2,8,4,"#c01010");px(W/2-3,3,6,3,"#ff2020");
    // Arched double doors
    const adx=W/2-22;
    px(adx-5,18,54,H-18,"#1e1008");// doorway bg
    px(adx-5,18,54,2,"#b49650");// gold lintel
    // Left door
    px(adx,20,20,H-22,"#140c06");
    px(adx+2,22,7,H-28,"#1c1008");px(adx+11,22,7,H-28,"#1c1008");
    px(adx+9,H*0.5,3,3,"#b49650");
    // Right door
    px(adx+24,20,20,H-22,"#140c06");
    px(adx+26,22,7,H-28,"#1c1008");px(adx+35,22,7,H-28,"#1c1008");
    px(adx+33,H*0.5,3,3,"#b49650");
    // Arch above doors
    px(adx+2,14,16,6,"#140c06");px(adx+6,10,8,6,"#140c06");
    px(adx+26,14,16,6,"#140c06");px(adx+30,10,8,6,"#140c06");
    // Pilasters
    [[2,14],[W-8,14]].forEach(([cx])=>{
      px(cx,14,6,H-14,"#342010");px(cx+1,12,4,3,"#403018");px(cx,12,6,2,"#504028");
    });
    // Side windows — small porthole style
    if(W>100){
      [[12,H*0.45],[W-20,H*0.45]].forEach(([wx,wy])=>{
        g.fillStyle="#300808";g.beginPath();g.arc(wx,wy,10,0,Math.PI*2);g.fill();
        g.fillStyle="#500c0c";g.beginPath();g.arc(wx,wy,7,0,Math.PI*2);g.fill();
        g.fillStyle="#ff181828";g.beginPath();g.arc(wx,wy,7,0,Math.PI*2);g.fill();
      });
    }

  } else if(type===T.CAPO){
    // ── Grand marble mansion / capo HQ ──
    px(0,0,W,H,"#d4c8a8");// cream marble base
    // Marble veining
    for(let i=0;i<20;i++){
      const mx=rng()*W|0,my=rng()*H|0,ml=20+rng()*60|0;
      g.strokeStyle=`rgba(180,160,120,0.3)`;g.lineWidth=0.5;
      g.beginPath();g.moveTo(mx,my);g.lineTo(mx+ml*(rng()-.5),my+ml*(rng()-.5));g.stroke();
    }
    // Stone block coursing (large ashlar)
    const cH=20,cW=48;
    for(let row=0;row<H;row+=cH){
      const off=((row/cH|0)%2)*(cW/2);
      g.fillStyle="#a09070";g.fillRect(0,row,W,1);
      for(let col=-cW+off;col<W+cW;col+=cW){
        const shade=rng()>.5?"#cec0a0":"#c8b898";
        px(col+1,row+1,cW-2,cH-2,shade);
        px(col+1,row+1,cW-2,2,"#ddd0b0");
        px(col+1,row+cH-2,cW-2,2,"#a09070");
        g.fillStyle="#9a8860";g.fillRect(col,row,1,cH);
      }
    }
    // Gold top entablature
    px(0,0,W,20,"#b49650");px(0,0,W,2,"#d4af37");px(0,2,W,2,"#c8a040");
    px(0,18,W,4,"#7a6020");
    // Decorative frieze
    for(let fx=4;fx<W-4;fx+=16){px(fx,3,10,13,"#c8a838");px(fx+1,4,8,11,"#b49030");px(fx+2,5,6,9,"#a08028");}
    // Classical columns — full height
    const nCols=Math.max(2,Math.floor(W/50));
    const colSpacing=W/nCols;
    for(let ci=0;ci<nCols;ci++){
      const cx=colSpacing*ci+colSpacing/2-7;
      // Shaft (fluted)
      px(cx,20,14,H-30,"#d0c4a4");
      for(let fl=cx+2;fl<cx+13;fl+=3){px(fl,20,1,H-30,"#beb090");}
      px(cx,20,2,H-30,"#ddd0b0");// left highlight
      px(cx+12,20,2,H-30,"#a89870");// right shadow
      // Capital
      px(cx-3,18,20,4,"#c4b490");px(cx-4,17,22,2,"#b4a480");
      // Base
      px(cx-3,H-12,20,5,"#c4b490");px(cx-4,H-8,22,5,"#a89870");
    }
    // Grand entrance portal
    const pw=W*0.42|0,pdx=(W-pw)/2|0;
    // Pilasters flanking door
    px(pdx-12,20,10,H-20,"#b4a880");px(pdx+pw+2,20,10,H-20,"#b4a880");
    // Pediment / triangular gable
    g.fillStyle="#c8b890";
    g.beginPath();g.moveTo(pdx-16,24);g.lineTo(pdx+pw/2,8);g.lineTo(pdx+pw+16,24);g.closePath();g.fill();
    g.fillStyle="#a89860";g.lineWidth=2;
    g.beginPath();g.moveTo(pdx-16,24);g.lineTo(pdx+pw/2,8);g.lineTo(pdx+pw+16,24);g.stroke();
    // Door arch
    px(pdx,24,pw,H-26,"#2a2010");
    px(pdx,24,pw,3,"#b49650");// gold top
    // Arch shape
    g.fillStyle="#1e1808";
    g.beginPath();g.arc(pdx+pw/2,26,pw/2,Math.PI,0);g.fill();
    // Double doors
    const hw=pw/2-4|0;
    px(pdx+2,28,hw,H-32,"#2e2010");
    px(pdx+pw/2+2,28,hw,H-32,"#2e2010");
    // Door panels
    for(let dp=0;dp<3;dp++){
      px(pdx+4,32+dp*22,hw-4,18,"#221808");
      px(pdx+pw/2+4,32+dp*22,hw-4,18,"#221808");
    }
    // Knobs
    px(pdx+pw/2-4,H/2,4,4,"#b49650");px(pdx+pw/2+2,H/2,4,4,"#b49650");
    // Windows flanking door
    const fwW=24,fwH=44;
    [[pdx-46,H*0.35],[pdx+pw+22,H*0.35],[pdx-46,H*0.65],[pdx+pw+22,H*0.65]].forEach(([fx,fy])=>{
      if(fx<4||fx+fwW>W-4)return;
      px(fx-4,fy-4,fwW+8,fwH+8,"#a89860");
      px(fx-4,fy-6,fwW+8,4,"#b8a870");// lintel
      px(fx,fy,fwW,fwH,"#1a1408");
      const lit=rng()>.2;
      px(fx+2,fy+2,fwW/2-3,fwH/2-2,lit?"#c8920c":"#0a0806");
      px(fx+fwW/2,fy+2,fwW/2-2,fwH/2-2,lit?"#c8920c":"#0a0806");
      px(fx+2,fy+fwH/2+1,fwW-4,fwH/2-3,lit?"#b08008":"#0a0806");
      px(fx+fwW/2-1,fy+2,2,fwH-4,"#1a1408");// mullion
      px(fx+2,fy+fwH/2-1,fwW-4,2,"#1a1408");
      if(lit){px(fx+2,fy+2,fwW-4,3,"#e0a820");px(fx+2,fy+2,2,fwH-4,"#906010");}
      px(fx-4,fy+fwH+2,fwW+8,5,"#9a8858");// sill
    });
    // Steps at base
    for(let s=0;s<4;s++){px(pdx-s*5,H-8+s*2,pw+s*10,2-s/2,"#c0b090");}
  }
  return oc;
}

// ═══════════════════════════════════════════════════════════════════
// MAP BUILDER
// ═══════════════════════════════════════════════════════════════════
function buildMap(){
  const map=Array.from({length:MH},()=>new Uint8Array(MW));
  const variant=Array.from({length:MH},(_,ty)=>Uint8Array.from({length:MW},(_,tx)=>(tx*7+ty*13)%4));
  const fill=(x,y,w,h,t)=>{for(let j=Math.max(0,y);j<Math.min(y+h,MH);j++)for(let i=Math.max(0,x);i<Math.min(x+w,MW);i++)map[j][i]=t;};
  fill(0,0,MW,MH,T.WALK);
  const RDS=[0,14,28,42,56];
  RDS.forEach(r=>{fill(r,0,3,MH,T.ROAD);fill(0,r,MW,3,T.ROAD);});
  RDS.forEach(ry=>RDS.forEach(cx=>fill(cx,ry,3,3,T.CROSS)));
  const BLK=[3,17,31,45];
  const blockTypes=[];
  BLK.forEach((bx,bi)=>{
    BLK.forEach((by,bj)=>{
      const roll=(bi*3+bj*7+bi*bj)%14;
      const bt=roll===0?T.CAPO:roll<4?T.SPEAKEASY:T.BLDG;
      fill(bx+1,by+1,9,9,bt);
      blockTypes.push({bx,by,bi,bj,bt});
      const ct=(bi+bj)%3===0?T.PARK:T.WALK;
      fill(bx+3,by+3,5,5,ct);
    });
  });
  fill(45,3,11,11,T.PARK);fill(47,5,7,5,T.WATER);
  fill(0,59,MW,5,T.DOCK);fill(3,61,MW-6,2,T.WATER);
  return{map,variant,blockTypes};
}

// ═══════════════════════════════════════════════════════════════════
// BAKE TILE LAYER — draws ground tiles, then paints building facades
// ═══════════════════════════════════════════════════════════════════
function bakeTileLayer(map,variant,blockTypes){
  const tileCache={};
  Object.values(T).forEach(id=>{tileCache[id]=[];for(let v=0;v<4;v++)tileCache[id].push(makeGroundTile(id,v));});
  const oc=document.createElement("canvas");oc.width=MW*TS;oc.height=MH*TS;
  const g=oc.getContext("2d");
  // Ground pass
  for(let ty=0;ty<MH;ty++)for(let tx=0;tx<MW;tx++){
    const t=map[ty][tx],v=variant[ty][tx];
    const spr=tileCache[t]?.[v];
    if(spr)g.drawImage(spr,tx*TS,ty*TS,TS,TS);
  }
  // Building facade pass — paint each block as one large image
  blockTypes.forEach(({bx,by,bi,bj,bt})=>{
    const seed=bi*31+bj*97+bt*7;
    const facade=paintBuilding(bt,9,9,seed);
    g.drawImage(facade,(bx+1)*TS,(by+1)*TS,9*TS,9*TS);
  });
  return oc;
}

// ═══════════════════════════════════════════════════════════════════
// CHARACTER SPRITES  (16×24 source, drawn 20×28 on screen)
// ═══════════════════════════════════════════════════════════════════
const CHAR_W=16,CHAR_H=24;
const CHAR_CFGS={
  player:{coat:"#1c1810",hat:"#080808",face:"#c8a068",leg:"#0c0c1e",shoe:"#0a0808",tie:"#b49650",badge:null},
  fence:{coat:"#3a2010",hat:"#1a1008",face:"#b89060",leg:"#181008",shoe:"#0a0808",tie:null,badge:null},
  boss:{coat:"#060606",hat:"#040404",face:"#b08050",leg:"#050505",shoe:"#060808",tie:"#8a1010",badge:"#b49650"},
  cop:{coat:"#0c1c3c",hat:"#081228",face:"#c4a068",leg:"#0a1630",shoe:"#0a0a0a",tie:null,badge:"#88aaee"},
  civilian:{coat:"#283018",hat:"#1a1a16",face:"#c09068",leg:"#181824",shoe:"#18120a",tie:null,badge:null},
  thug:{coat:"#1a0808",hat:"#080808",face:"#9a7050",leg:"#0a0808",shoe:"#080808",tie:"#880000",badge:null},
};
function buildCharSprites(){
  const W=CHAR_W,H=CHAR_H,res={};
  Object.entries(CHAR_CFGS).forEach(([type,c])=>{
    const frames=[];
    for(let dir=0;dir<4;dir++){for(let wf=0;wf<3;wf++){
      const oc=document.createElement("canvas");oc.width=W;oc.height=H;
      const g=oc.getContext("2d");
      const px=(x,y,w,h,col)=>{if(w>0&&h>0){g.fillStyle=col;g.fillRect(x,y,w,h);}};
      const ll=wf===0?1:wf===1?0:-1;const rl=-ll;
      if(dir===0){// SOUTH
        px(3+ll,17,4,5,c.leg);px(9+rl,17,4,5,c.leg);
        px(2+ll,21,5,3,c.shoe);px(8+rl,21,5,3,c.shoe);
        px(2+ll,20,5,1,"#ffffff18");px(8+rl,20,5,1,"#ffffff18");
        px(2,8,12,10,c.coat);px(2,8,2,10,"#00000030");px(12,8,2,10,"#00000018");
        px(2,8,3,6,"#0a0808");px(11,8,3,6,"#0a0808");
        px(6,9,4,8,"#ddd8c8");if(c.tie){px(7,9,2,6,c.tie);}
        if(c.badge){px(3,11,3,3,c.badge);px(3,11,3,1,"#ffffff40");}
        px(5,8,6,2,"#ddd8c8");px(6,6,4,3,c.face);
        px(3,1,10,7,c.face);px(2,3,2,3,c.face);px(12,3,2,3,c.face);
        px(5,3,2,2,"#1a1010");px(9,3,2,2,"#1a1010");
        px(5,3,1,1,"#ffffff60");px(9,3,1,1,"#ffffff60");
        px(7,5,2,1,"#9a7040");px(6,6,4,1,"#6a3818");
        px(4,0,8,4,c.hat);px(2,3,12,2,c.hat);px(4,3,8,1,"#1a1608");
      }else if(dir===1){// NORTH
        px(3+ll,17,4,5,c.leg);px(9+rl,17,4,5,c.leg);
        px(2+ll,21,5,3,c.shoe);px(8+rl,21,5,3,c.shoe);
        px(2,8,12,10,c.coat);px(7,8,2,10,"#00000020");
        px(6,6,4,2,c.face);px(3,2,10,6,c.hat);
        px(2,7,12,1,c.hat);px(2,7,12,2,c.hat);
      }else if(dir===2){// WEST
        const ly=16+(ll>0?0:1);
        px(4+ll,ly,6,5,c.leg);px(3+ll,20,7,3,c.shoe);
        px(3,8,10,10,c.coat);px(3,8,2,10,"#00000025");px(12,9,3,8,c.coat);
        const ay=10+(wf===1?-1:wf===2?1:0);px(1,ay,3,5,c.coat);
        if(c.badge){px(4,11,3,2,c.badge);}
        px(2,1,8,7,c.face);px(3,3,2,2,"#1a1010");px(3,3,1,1,"#ffffff60");
        px(2,5,2,1,"#9a7040");px(2,6,3,1,"#6a3818");px(10,3,2,3,c.face);
        px(2,0,10,4,c.hat);px(1,3,12,2,c.hat);px(2,3,10,1,"#1a1608");
      }else{// EAST
        const ly2=16+(ll>0?0:1);
        px(6-ll,ly2,6,5,c.leg);px(6-ll,20,7,3,c.shoe);
        px(3,8,10,10,c.coat);px(11,8,2,10,"#00000025");px(1,9,3,8,c.coat);
        const ay2=10+(wf===1?-1:wf===2?1:0);px(12,ay2,3,5,c.coat);
        if(c.badge){px(9,11,3,2,c.badge);}
        px(6,1,8,7,c.face);px(11,3,2,2,"#1a1010");px(12,3,1,1,"#ffffff60");
        px(12,5,2,1,"#9a7040");px(11,6,3,1,"#6a3818");px(4,3,2,3,c.face);
        px(4,0,10,4,c.hat);px(3,3,12,2,c.hat);px(4,3,10,1,"#1a1608");
      }
      frames.push(oc);
    }}
    res[type]=frames;
  });
  return res;
}

// ═══════════════════════════════════════════════════════════════════
// CAR SPRITE  (east-facing 52×30, rotated on draw)
// ═══════════════════════════════════════════════════════════════════
function buildCarSprite(col1,col2,col3,upgLevel=0){
  const W=52,H=30;
  const oc=document.createElement("canvas");oc.width=W;oc.height=H;
  const g=oc.getContext("2d");
  const px=(x,y,w,h,c)=>{g.fillStyle=c;g.fillRect(x,y,w,h);};
  // Shadow
  g.fillStyle="rgba(0,0,0,0.35)";g.beginPath();g.ellipse(W/2,H-1,W/2-2,3,0,0,Math.PI*2);g.fill();
  // Body
  px(4,6,W-8,H-12,col1);
  // Hood/trunk
  px(W-13,7,11,H-14,col2);px(2,7,11,H-14,col3);
  // Roof
  px(14,2,W-28,H-6,col2);px(14,2,W-28,2,col1+"99");
  // Upgrade stripe (gold for higher levels)
  if(upgLevel>0){px(14,2,W-28,1,upgLevel>1?"#d4af37":"#b49650");}
  else px(14,2,W-28,1,"#b49650");
  // Windshields
  g.fillStyle="#88ccee";g.globalAlpha=0.85;g.fillRect(W-15,4,9,H-10);g.fillRect(6,4,9,H-10);g.globalAlpha=1;
  g.fillStyle="#ffffff22";g.fillRect(W-14,4,3,7);g.fillRect(7,4,3,6);
  // Pillars
  px(W-15,3,2,H-7,col2);px(W-7,3,2,H-7,col2);px(6,3,2,H-7,col2);px(13,3,2,H-7,col2);
  // Wheels
  [[2,3],[2,H-9],[W-10,3],[W-10,H-9]].forEach(([wx,wy])=>{
    px(wx,wy,8,7,"#0a0a0a");px(wx+1,wy+1,6,5,"#1c1a18");px(wx+2,wy+2,4,3,"#28261e");
    px(wx+3,wy+2,2,3,upgLevel>1?"#888870":"#585450");// chrome hub
    px(wx+2,wy+1,4,1,"#48464080");px(wx+2,wy+5,4,1,"#48464080");
  });
  // Lights
  px(W-5,7,4,4,"#ffe8a0");px(W-5,H-11,4,4,"#ffe8a0");px(W-4,8,2,2,"#fffce8");
  px(1,7,4,4,"#cc1a1a");px(1,H-11,4,4,"#cc1a1a");px(2,8,2,2,"#ff3030");
  // Bumpers
  px(W-4,8,3,H-17,upgLevel>0?"#c8c0a0":"#9a9080");px(1,8,3,H-17,upgLevel>0?"#c8c0a0":"#9a9080");
  // Door lines/handles
  px(14,5,1,H-10,"#00000028");px(W-15,5,1,H-10,"#00000028");
  px(18,H/2-1,5,3,"#9a9080");px(W-23,H/2-1,5,3,"#9a9080");
  return oc;
}
const CAR_DEFS=[
  {col1:"#8B1a1a",col2:"#6a1010",col3:"#4e0e0e",name:"Packard",speed:1,accel:1,armor:1},
  {col1:"#1a2a5c",col2:"#10203e",col3:"#0c1830",name:"Duesenberg",speed:1.3,accel:0.8,armor:1.2},
  {col1:"#1a3c1a",col2:"#122a10",col3:"#0e200c",name:"Stutz",speed:1.1,accel:1.2,armor:0.9},
  {col1:"#3e3222",col2:"#2c2418",col3:"#201a10",name:"Ford",speed:0.9,accel:1.1,armor:1.3},
  {col1:"#5c3012",col2:"#3e200a",col3:"#2a1608",name:"Hudson",speed:1.2,accel:0.9,armor:1.1},
];

// ═══════════════════════════════════════════════════════════════════
// WEAPONS
// ═══════════════════════════════════════════════════════════════════
const WEAPONS={
  fists:    {name:"Fists",     dmg:1,cd:25,range:20, icon:"✊"},
  revolver: {name:"Revolver",  dmg:1,cd:18,range:200,icon:"🔫"},
  tommy:    {name:"Tommy Gun", dmg:1,cd:6, range:180,icon:"⚙️"},
  shotgun:  {name:"Shotgun",   dmg:2,cd:30,range:80, icon:"💥"},
  molotov:  {name:"Molotov",   dmg:3,cd:60,range:100,icon:"🍾"},
};

// ═══════════════════════════════════════════════════════════════════
// BUSINESSES
// ═══════════════════════════════════════════════════════════════════
const BUSINESSES=[
  {id:"speakeasy",  name:"The Rusty Nail",     icon:"🍺", cost:5000,  income:120, incomeMs:8000,
   desc:"A speakeasy on Mulberry St. Steady booze money.",
   raidChance:0.15, worldX:3*24,  worldY:17*24, npcId:"fence"},
  {id:"numbers",    name:"Numbers Racket",      icon:"🎲", cost:3000,  income:60,  incomeMs:6000,
   desc:"Street gambling. Low risk, steady return.",
   raidChance:0.05, worldX:29*24, worldY:1*24,  npcId:null},
  {id:"docks",      name:"Dockside Warehouse",  icon:"⚓", cost:8000,  income:200, incomeMs:10000,
   desc:"Smuggling hub at the docks. High reward.",
   raidChance:0.25, worldX:43*24, worldY:60*24, npcId:"fence"},
  {id:"taxi",       name:"Benedetto Cabs",      icon:"🚕", cost:4000,  income:80,  incomeMs:7000,
   desc:"Legit front business. Cops look the other way.",
   raidChance:0,    worldX:15*24, worldY:1*24,  npcId:null},
  {id:"casino",     name:"The Golden Ace",      icon:"🃏", cost:12000, income:400, incomeMs:12000,
   desc:"Illegal casino backroom. Huge profits, huge risk.",
   raidChance:0.35, worldX:29*24, worldY:15*24, npcId:"boss"},
];

// ═══════════════════════════════════════════════════════════════════
// PAY-N-SPRAY LOCATIONS
// ═══════════════════════════════════════════════════════════════════
const SPRAY_SHOPS=[
  {id:0, x:13*24, y:13*24, cost:500,  name:"Tony's Garage"},
  {id:1, x:27*24, y:27*24, cost:500,  name:"Mick's Motors"},
  {id:2, x:41*24, y:13*24, cost:500,  name:"Riverside Respray"},
];

// ═══════════════════════════════════════════════════════════════════
// CHARACTER CUSTOMISATION
// ═══════════════════════════════════════════════════════════════════
const COAT_COLS =["#1c1810","#0a1a0a","#1a0a0a","#0a0a1a","#2a1a00","#1a1a1a","#3a1a08"];
const HAT_COLS  =["#080808","#1a0808","#081808","#08081a","#1a1000","#2a1a08","#3a2010"];
const FACE_COLS =["#c8a068","#b89060","#d4b890","#8a6040","#c8b898","#a07850","#c09878"];
const TIE_COLS  =["#b49650","#8a1010","#104888","#1a6818","#880888","#888","#cc8020"];

// ═══════════════════════════════════════════════════════════════════
// DISTRICTS / MAPS
// ═══════════════════════════════════════════════════════════════════
const DISTRICTS=[
  {id:"city",    name:"New Corleone",   subtitle:"Downtown · 1928",     portalX:57*24+12, portalY:57*24+12, bgColor:"#0a0806"},
  {id:"beach",   name:"Sunset Beach",  subtitle:"Miami Strip · 1928",   portalX:2*24,     portalY:57*24+12, bgColor:"#0a0e14"},
  {id:"docks",   name:"Havana Docks",  subtitle:"Industrial Port",      portalX:57*24+12, portalY:2*24,     bgColor:"#080a0a"},
  {id:"airport", name:"Corleone Airport",subtitle:"Private Airfield",   portalX:2*24,     portalY:2*24,     bgColor:"#0a0808"},
];

// Travel portals — pairs of (from district, world pos) → (to district, spawn pos)
const TRAVEL_PORTALS=[
  // City ↔ Beach (bottom-right of city → bottom-left of beach)
  {fromDist:"city",  fx:57*24+12,fy:56*24,   toDist:"beach",  tx:2*24,  ty:56*24},
  // City ↔ Docks  (top-right → top-left of docks)
  {fromDist:"city",  fx:57*24+12,fy:2*24,    toDist:"docks",  tx:2*24,  ty:2*24},
  // City ↔ Airport (top-left → top-right of airport)
  {fromDist:"city",  fx:2*24,    fy:2*24,    toDist:"airport",tx:57*24, ty:2*24},
];

// Gang territory definitions
const GANGS=[
  {id:"corleone", name:"Corleone Family",  col:"#b49650", tileCol:"#2a1e08", blocks:[[0,0],[1,0],[0,1],[1,1]]},
  {id:"morelli",  name:"Morelli Brothers", col:"#cc3030", tileCol:"#2a0808", blocks:[[2,0],[3,0],[2,1]]},
  {id:"sforza",   name:"Sforza Gang",      col:"#3060cc", tileCol:"#080a2a", blocks:[[0,2],[0,3],[1,3]]},
  {id:"neutral",  name:"Neutral",          col:"#444",    tileCol:null,      blocks:[[3,1],[1,2],[2,2],[3,2],[2,3],[3,3]]},
];
// Map block index = bi*4+bj (4×4 grid of blocks in city)

// ═══════════════════════════════════════════════════════════════════
// NEW NPC TYPES & GARAGE
// ═══════════════════════════════════════════════════════════════════
const GARAGE_SERVICES=[
  {id:"repair",   name:"Full Repair",      cost:400,  desc:"Restore your health to max"},
  {id:"paint_red",name:"Red Paint Job",    cost:200,  desc:"Respray — lose heat"},
  {id:"paint_blk",name:"Black Paint Job",  cost:200,  desc:"Respray — lose heat"},
  {id:"paint_grn",name:"Green Paint Job",  cost:200,  desc:"Respray — lose heat"},
  {id:"tune",     name:"Full Tune-Up",     cost:800,  desc:"Max all car upgrades"},
  {id:"store",    name:"Store Car",        cost:0,    desc:"Store this car in your garage"},
];

// ═══════════════════════════════════════════════════════════════════
// MISSIONS
// ═══════════════════════════════════════════════════════════════════
// POI markers (minimap + compass)
// ─── POI HELPERS ──────────────────────────────────────────────────
// All world positions use TS=24
const POIS=[
  {id:"fence",    label:"Sal's Hardware",     x:1*24,   y:1*24,   col:"#b49650",icon:"🔫",hint:"Buy weapons & car upgrades"},
  {id:"boss",     label:"Don Benedetto",      x:15*24,  y:15*24,  col:"#d4af37",icon:"👔",hint:"Get missions & collect pay"},
  {id:"thug",     label:"Big Eddie",          x:1*24,   y:15*24,  col:"#cc4040",icon:"💪",hint:"Street missions"},
  {id:"docks",    label:"The Docks",          x:43*24,  y:61*24,  col:"#4488cc",icon:"⚓",hint:"Rum pickup zone"},
  {id:"park",     label:"Park District",      x:49*24,  y:7*24,   col:"#4a8a40",icon:"🌳",hint:"Courier target"},
  {id:"courier",  label:"Courier",            x:43*24,  y:1*24,   col:"#e84040",icon:"💼",hint:"Rob for The Heist"},
  {id:"mechanic", label:"Vinnie's Garage",    x:13*24,  y:13*24,  col:"#60aaff",icon:"🔧",hint:"Car repair & upgrades"},
  {id:"doctor",   label:"Doc Pescatore",      x:27*24,  y:1*24,   col:"#ff6060",icon:"💊",hint:"Full health restore $500"},
  {id:"rival",    label:"Morelli Turf",       x:31*24,  y:1*24,   col:"#cc3030",icon:"⚔️",hint:"Enemy gang territory"},
  {id:"portal_beach",   label:"→ Sunset Beach",   x:57*24,y:56*24, col:"#40c8c8",icon:"🌊",hint:"Travel to Sunset Beach"},
  {id:"portal_docks",   label:"→ Havana Docks",   x:57*24,y:2*24,  col:"#40c860",icon:"🚢",hint:"Travel to Havana Docks"},
  {id:"portal_airport", label:"→ Airport",         x:2*24, y:2*24,  col:"#c8c040",icon:"✈️", hint:"Travel to Corleone Airport"},
];

const MISSIONS=[
  // ─── ACT 1: GETTING STARTED ──────────────────────────────
  {id:0,name:"The First Job",district:"city",respMin:0,
   giver:"boss",icon:"👔",
   desc:"Don Benedetto needs you to prove yourself. Collect the rum shipment.",
   steps:[
     {text:"Talk to Don Benedetto",poiId:"boss",hint:"Head south to Little Italy — tile 15,15"},
     {text:"Drive to the Docks",poiId:"docks",hint:"Go far south — the docks are at the bottom of the map"},
     {text:"Collect from Dock Boss",poiId:"docks",hint:"Press E near the Dock Boss"},
     {text:"Return to Don Benedetto",poiId:"boss",hint:"Head back north to Little Italy"},
   ],reward:1500,wantedGain:0},

  {id:1,name:"Street Tax",district:"city",respMin:0,
   giver:"thug",icon:"💪",
   desc:"Big Eddie collects protection money. Make three examples.",
   steps:[{text:"Rob 3 civilians (0/3)",poiId:"courier",hint:"Press E near civilians — they're on the streets"}],
   robsNeeded:3,reward:800,wantedGain:1},

  {id:2,name:"Greased Palms",district:"city",respMin:0,
   giver:"fence",icon:"🔫",
   desc:"Two officers have been asking questions. Deal with it.",
   steps:[{text:"Bribe 2 cops (0/2)",poiId:"fence",hint:"Find officers patrolling — press E and pay $600 each"}],
   bribesNeeded:2,reward:600,wantedGain:-1},

  {id:3,name:"The Payroll Job",district:"city",respMin:10,
   giver:"boss",icon:"👔",
   desc:"The bank courier carries the weekly payroll near the Park.",
   steps:[
     {text:"Find the Courier near the Park",poiId:"courier",hint:"Northeast — Park District at tiles 43,1"},
     {text:"Rob the Courier",poiId:"courier",hint:"Press E when close"},
     {text:"Lose the heat (0 stars)",poiId:"boss",hint:"Hide in an alley until heat cools"},
     {text:"Report to Don Benedetto",poiId:"boss",hint:"Return to Little Italy"},
   ],reward:3000,wantedGain:2},

  // ─── ACT 2: MAKING YOUR NAME ─────────────────────────────
  {id:4,name:"Gang War",district:"city",respMin:15,
   giver:"thug",icon:"💪",
   desc:"The Morelli Brothers are moving into our turf. Hit their operation.",
   steps:[
     {text:"Go to Morelli turf (East side)",poiId:"rival",hint:"Head east — their men are in the far blocks"},
     {text:"Rob 2 Morelli gang members (0/2)",poiId:"rival",hint:"Gang rivals wear red — press E near them"},
     {text:"Escape the area",poiId:"boss",hint:"Get out before backup arrives"},
     {text:"Report to Big Eddie",poiId:"thug",hint:"Return to Little Italy"},
   ],robsNeeded:2,reward:2000,wantedGain:2},

  {id:5,name:"The Safe House",district:"city",respMin:20,
   giver:"boss",icon:"👔",
   desc:"We need a safe place to store the merchandise. Buy the Dockside Warehouse.",
   steps:[
     {text:"Earn $8,000 cash",poiId:"fence",hint:"Complete missions and rob civilians to raise funds"},
     {text:"Buy the Dockside Warehouse via Phone",poiId:"boss",hint:"Open Phone menu (P) → Businesses → Dockside Warehouse"},
     {text:"Report to Don Benedetto",poiId:"boss",hint:"The Don needs confirmation"},
   ],cashNeeded:8000,reward:2500,wantedGain:0},

  {id:6,name:"Hot Merchandise",district:"city",respMin:20,
   giver:"fence",icon:"🔫",
   desc:"A shipment of stolen goods needs moving fast. Five civilians are carrying them.",
   steps:[
     {text:"Rob 5 civilians (0/5)",poiId:"courier",hint:"Find and rob civilians across the city"},
     {text:"Sell to Sal the Fence",poiId:"fence",hint:"Return to Sal's Hardware in Downtown"},
   ],robsNeeded:5,reward:1800,wantedGain:2},

  {id:7,name:"Protection Racket",district:"city",respMin:25,
   giver:"thug",icon:"💪",
   desc:"Three speakeasies on our patch haven't paid their dues. Remind them.",
   steps:[
     {text:"Rob 3 businesses (rob 3 targets)",poiId:"thug",hint:"Rob 3 people across Little Italy and Downtown"},
     {text:"Return to Big Eddie",poiId:"thug",hint:"Head back to Big Eddie in Little Italy"},
   ],robsNeeded:3,reward:2200,wantedGain:1},

  {id:8,name:"The Rat",district:"city",respMin:30,
   giver:"boss",icon:"👔",
   desc:"Someone is talking to the Feds. Find the informant and silence them.",
   steps:[
     {text:"Find the informant (Courier)",poiId:"courier",hint:"The Courier has been seen near the Park District"},
     {text:"Confront the informant",poiId:"courier",hint:"Press E near the Courier"},
     {text:"Escape 3-star pursuit",poiId:"boss",hint:"The Feds will be watching — lose 3 stars"},
     {text:"Report to Don Benedetto",poiId:"boss",hint:"The Don is waiting in Little Italy"},
   ],reward:4000,wantedGain:3},

  // ─── ACT 3: EXPANDING THE EMPIRE ─────────────────────────
  {id:9,name:"Cop on the Take",district:"city",respMin:35,
   giver:"fence",icon:"🔫",
   desc:"Officer O'Malley wants a bigger cut. Pay him or take him down.",
   steps:[
     {text:"Find Officer O'Malley",poiId:"fence",hint:"He patrols Downtown near tile 15,1"},
     {text:"Bribe him ($600) or rob him",poiId:"fence",hint:"Press E near the officer"},
     {text:"Report back to Sal",poiId:"fence",hint:"Return to Sal's Hardware"},
   ],bribesNeeded:1,reward:1500,wantedGain:-1},

  {id:10,name:"Drive or Die",district:"city",respMin:35,
   giver:"thug",icon:"💪",
   desc:"The Morellis hired a hitman. He's in a car — ram him off the road.",
   steps:[
     {text:"Get in a car",poiId:"mechanic",hint:"Press E near any parked car — jack it"},
     {text:"Find and ram the hitman's car",poiId:"rival",hint:"A red car near the east side — ram it at speed"},
     {text:"Escape to the Garage",poiId:"mechanic",hint:"Head to Vinnie's Garage at tiles 13,13"},
   ],reward:3500,wantedGain:2},

  {id:11,name:"The Numbers Game",district:"city",respMin:40,
   giver:"boss",icon:"👔",
   desc:"Buy the Numbers Racket to fund our expansion. Then collect the first week's earnings.",
   steps:[
     {text:"Buy the Numbers Racket via Phone",poiId:"boss",hint:"Phone menu → Businesses → Numbers Racket ($3,000)"},
     {text:"Wait for first income payment",poiId:"boss",hint:"Business income arrives every 3 seconds"},
     {text:"Collect $500 from passive income",poiId:"boss",hint:"Wait for business to generate $500"},
     {text:"Report to Don Benedetto",poiId:"boss",hint:"Return to Little Italy"},
   ],cashNeeded:3000,reward:3000,wantedGain:0},

  // ─── ACT 4: THE LONG GAME ────────────────────────────────
  {id:12,name:"Airport Run",district:"city",respMin:45,
   giver:"boss",icon:"👔",
   desc:"A contact at the airport has a package. Travel there and collect it.",
   steps:[
     {text:"Travel to the Airport",poiId:"portal_airport",hint:"Head to the northwest corner of the map — travel portal"},
     {text:"Collect from the contact",poiId:"portal_airport",hint:"You'll find the contact near the terminal"},
     {text:"Return to New Corleone",poiId:"boss",hint:"Use the portal to travel back"},
     {text:"Deliver to Don Benedetto",poiId:"boss",hint:"Return to Little Italy"},
   ],reward:5000,wantedGain:1},

  {id:13,name:"Beach Front",district:"city",respMin:45,
   giver:"thug",icon:"💪",
   desc:"The Sforza gang controls the beach district. Establish our presence.",
   steps:[
     {text:"Travel to Sunset Beach",poiId:"portal_beach",hint:"Southeast corner of the map — travel portal"},
     {text:"Rob 3 Sforza gang members",poiId:"portal_beach",hint:"Rob 3 people in the beach district"},
     {text:"Return to New Corleone",poiId:"thug",hint:"Use the portal to return"},
     {text:"Report to Big Eddie",poiId:"thug",hint:"Little Italy"},
   ],robsNeeded:3,reward:4000,wantedGain:2},

  {id:14,name:"The Golden Ace",district:"city",respMin:50,
   giver:"boss",icon:"👔",
   desc:"Buy the casino and launder our earnings through it.",
   steps:[
     {text:"Buy The Golden Ace via Phone",poiId:"boss",hint:"Phone menu → Businesses → The Golden Ace ($12,000)"},
     {text:"Protect it — survive a raid",poiId:"boss",hint:"A raid will come — maintain wanted level below 3"},
     {text:"Report to Don Benedetto",poiId:"boss",hint:"The Don celebrates in Little Italy"},
   ],cashNeeded:12000,reward:8000,wantedGain:0},

  {id:15,name:"Full House",district:"city",respMin:55,
   giver:"fence",icon:"🔫",
   desc:"Own all 5 businesses. The city will be ours.",
   steps:[
     {text:"Own all 5 businesses",poiId:"boss",hint:"Phone menu → Businesses — buy all 5"},
     {text:"Report to Sal the Fence",poiId:"fence",hint:"Return to Sal's Hardware downtown"},
   ],reward:10000,wantedGain:0},

  // ─── ACT 5: FINAL CAMPAIGN ───────────────────────────────
  {id:16,name:"The Commission",district:"city",respMin:60,
   giver:"boss",icon:"👔",
   desc:"The five families want to meet. You must attend — but the Feds are watching.",
   steps:[
     {text:"Get a clean car from Vinnie's",poiId:"mechanic",hint:"Visit the garage and get repaired"},
     {text:"Drive to the meeting point (Park)",poiId:"park",hint:"Head to the Park District"},
     {text:"Survive the FBI ambush",poiId:"park",hint:"4-star pursuit — fight or flee"},
     {text:"Escape with 0 wanted stars",poiId:"boss",hint:"Lose all heat before reporting"},
     {text:"Report to Don Benedetto",poiId:"boss",hint:"The Commission is waiting"},
   ],reward:7500,wantedGain:4},

  {id:17,name:"Hit the Morellis",district:"city",respMin:65,
   giver:"thug",icon:"💪",
   desc:"Time to end the Morelli Brothers. Rob their operation clean.",
   steps:[
     {text:"Go to Morelli turf",poiId:"rival",hint:"East side of the city"},
     {text:"Rob 5 gang members (0/5)",poiId:"rival",hint:"Rob 5 people in the east blocks"},
     {text:"Survive 4-star pursuit",poiId:"thug",hint:"They'll call in every cop in the city"},
     {text:"Report to Big Eddie",poiId:"thug",hint:"Back to Little Italy"},
   ],robsNeeded:5,reward:8000,wantedGain:4},

  {id:18,name:"The Don's Legacy",district:"city",respMin:70,
   giver:"boss",icon:"👔",
   desc:"Buy Benedetto Cabs and open The Golden Ace. Create a legitimate empire.",
   steps:[
     {text:"Own Benedetto Cabs",poiId:"boss",hint:"Phone menu → Businesses → Benedetto Cabs ($4,000)"},
     {text:"Earn $20,000 total",poiId:"boss",hint:"Complete missions and collect business income"},
     {text:"Report to Don Benedetto",poiId:"boss",hint:"The Don is proud — return to Little Italy"},
   ],reward:15000,wantedGain:0},

  {id:19,name:"King of New Corleone",district:"city",respMin:80,
   giver:"boss",icon:"👔",
   desc:"You've built an empire. One last job seals your legacy — and the city is yours.",
   steps:[
     {text:"Bribe 3 cops",poiId:"fence",hint:"Pay off the last honest officers in the city"},
     {text:"Rob the Federal courier",poiId:"courier",hint:"The FBI courier patrols the park — rob him"},
     {text:"Escape 5-star pursuit",poiId:"boss",hint:"Maximum heat — every cop and SWAT unit in the city"},
     {text:"Reach Don Benedetto",poiId:"boss",hint:"Get to Little Italy alive"},
     {text:"Claim the city",poiId:"boss",hint:"The city of New Corleone belongs to you"},
   ],bribesNeeded:3,reward:25000,wantedGain:5},

  // ─── BEACH DISTRICT ──────────────────────────────────────
  {id:20,name:"Rum on the Beach",district:"beach",respMin:20,
   giver:"fence",icon:"🔫",
   desc:"A rum shipment arrived by boat. Collect it before the coastguard wakes up.",
   steps:[
     {text:"Travel to Sunset Beach",poiId:"portal_beach",hint:"Southeast corner portal"},
     {text:"Collect 3 shipments (rob 3)",poiId:"portal_beach",hint:"Rob 3 people near the beach"},
     {text:"Return to New Corleone",poiId:"fence",hint:"Return via portal"},
     {text:"Deliver to Sal",poiId:"fence",hint:"Report back"},
   ],robsNeeded:3,reward:3000,wantedGain:1},

  // ─── DOCKS DISTRICT ──────────────────────────────────────
  {id:21,name:"Cargo Heist",district:"docks",respMin:30,
   giver:"thug",icon:"💪",
   desc:"A cargo container at Havana Docks holds a fortune. Steal it.",
   steps:[
     {text:"Travel to Havana Docks",poiId:"portal_docks",hint:"Northeast corner portal"},
     {text:"Rob the dock workers (rob 4)",poiId:"portal_docks",hint:"4 dock workers carry the goods"},
     {text:"Escape to New Corleone",poiId:"thug",hint:"Dock security will respond"},
     {text:"Report to Big Eddie",poiId:"thug",hint:"Back in Little Italy"},
   ],robsNeeded:4,reward:4500,wantedGain:2},

  // ─── AIRPORT DISTRICT ────────────────────────────────────
  {id:22,name:"The Package",district:"airport",respMin:40,
   giver:"boss",icon:"👔",
   desc:"A VIP is landing at the airport with a briefcase. Intercept it.",
   steps:[
     {text:"Travel to the Airport",poiId:"portal_airport",hint:"Northwest corner portal"},
     {text:"Find and rob the VIP",poiId:"portal_airport",hint:"Rob 2 people near the terminal"},
     {text:"Escape airport security",poiId:"boss",hint:"Airport security is well-armed"},
     {text:"Return to Don Benedetto",poiId:"boss",hint:"Back to Little Italy"},
   ],robsNeeded:2,reward:6000,wantedGain:3},

  // ─── BONUS MISSIONS ──────────────────────────────────────
  {id:23,name:"Joyride",district:"city",respMin:0,
   giver:"thug",icon:"💪",
   desc:"Big Eddie needs a stolen car delivered. Get in a car and go.",
   steps:[
     {text:"Jack any car",poiId:"mechanic",hint:"Press E near any parked car"},
     {text:"Drive to the delivery point (Docks)",poiId:"docks",hint:"Head south to the docks"},
     {text:"Park near the Dock Boss",poiId:"docks",hint:"Exit the car near the Dock Boss"},
     {text:"Report to Big Eddie",poiId:"thug",hint:"Return to Little Italy on foot"},
   ],reward:1200,wantedGain:0},
];

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
function FamigliaGameInner(){
  const canvasRef=useRef(null),mmRef=useRef(null),gsRef=useRef(null);
  const rafRef=useRef(null),keysRef=useRef({});
  const execNPCRef=useRef(null);
  const advanceMissionStepRef=useRef(null);
  const saveGameRef=useRef(null);
  const toggleRadioRef=useRef(null);
  const joyRef=useRef({id:null,origin:null,vec:{x:0,y:0},base:null});
  const uiRef=useRef({showShop:false,showMissions:false,activeMission:null,missionProgress:{}});
  const famigliaRunSessionRef=useRef(null);
  const lastFamigliaSubmitRef=useRef(0);
  const submitFamigliaSession=useCallback(async()=>{
    const gs=gsRef.current;if(!gs?.player)return;
    const sid=famigliaRunSessionRef.current;
    if(!sid)return;
    const now=Date.now();
    if(now-lastFamigliaSubmitRef.current<45_000)return;
    lastFamigliaSubmitRef.current=now;
    try{
      await api.post("/mafia-rpg/session",{
        respect:gs.player.respect||0,
        missions_complete:gs.player.missionsComplete||0,
        total_earned:gs.player.totalEarned||0,
        session_id:sid,
      });
    }catch(_e){}
  },[]);


  const initGame=useCallback(async ()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    try{
      const run=await startMinigameRun("mafia_rpg");
      famigliaRunSessionRef.current=run.session_id;
    }catch(e){
      toast.error(e?.response?.data?.detail||e?.message||"Could not start game session");
      return;
    }
    canvas.width=NW;canvas.height=NH;
    const{map,variant,blockTypes}=buildMap();
    const bakedTiles=bakeTileLayer(map,variant,blockTypes);
    const charSprites=buildCharSprites();
    const carSprites=CAR_DEFS.map(d=>buildCarSprite(d.col1,d.col2,d.col3));

    const gs={
      started:false,frame:0,map,bakedTiles,charSprites,carSprites,
      camX:0,camY:0,msgTimer:0,
      timeOfDay:0.35,// start mid-morning
      daySpeed:1/18000,
      player:{
        x:15*TS,y:1*TS,dir:0,walkF:0,walkT:0,
        health:5,maxHealth:5,cash:2400,wanted:0,heat:0.08,
        inCar:false,car:null,shootCD:0,invincible:0,
        weapon:"revolver",weapons:["fists","revolver"],
        robs:0,bribes:0,
        // Respect / progression
        respect:0,       // 0-100, unlocks better missions
        // Character appearance
        coatIdx:0, hatIdx:0, faceIdx:0, tieIdx:0,
        // Businesses owned
        businesses:[],   // array of business ids
        businessTimers:{}, // id -> ms remaining until next payout
        // Stats
        totalEarned:0, kills:0, missionsComplete:0,
      },
      npcs:[
        // ── Key characters ──
        {id:0, x:1*TS,  y:1*TS,  type:"fence",   dir:0,wf:0,wt:0,vx:0,vy:0,action:"shop",     pr:0,  name:"Sal the Fence",   icon:"🔫"},
        {id:1, x:15*TS, y:15*TS, type:"boss",    dir:2,wf:0,wt:0,vx:0,vy:0,action:"missions",  pr:0,  name:"Don Benedetto",   icon:"👔"},
        {id:2, x:29*TS, y:1*TS,  type:"civilian",dir:1,wf:0,wt:0,vx:0,vy:0,action:"rob",       pr:3*TS,name:"Civilian",       icon:"🧍"},
        {id:3, x:15*TS, y:1*TS,  type:"cop",     dir:3,wf:0,wt:0,vx:0,vy:0,action:"bribe",     pr:4*TS,name:"Officer O'Malley",icon:"🚔",aggro:false},
        {id:4, x:1*TS,  y:15*TS, type:"thug",    dir:0,wf:0,wt:0,vx:0,vy:0,action:"missions",  pr:0,  name:"Big Eddie",       icon:"💪",aggro:false},
        {id:5, x:43*TS, y:15*TS, type:"fence",   dir:1,wf:0,wt:0,vx:0,vy:0,action:"collect",   pr:2*TS,name:"Dock Boss",      icon:"⚓"},
        {id:6, x:29*TS, y:15*TS, type:"cop",     dir:2,wf:0,wt:0,vx:0,vy:0,action:"bribe",     pr:4*TS,name:"Officer Burns",  icon:"🚔",aggro:false},
        {id:7, x:43*TS, y:1*TS,  type:"civilian",dir:3,wf:0,wt:0,vx:0,vy:0,action:"rob",       pr:3*TS,name:"Courier",        icon:"💼"},
        // ── Mechanic (garage) ──
        {id:8, x:13*TS, y:13*TS, type:"civilian",dir:0,wf:0,wt:0,vx:0,vy:0,action:"garage",    pr:0,  name:"Vinnie the Mechanic",icon:"🔧"},
        // ── Doctor ──
        {id:9, x:27*TS, y:1*TS,  type:"civilian",dir:0,wf:0,wt:0,vx:0,vy:0,action:"doctor",    pr:0,  name:"Doc Pescatore",  icon:"💊"},
        // ── Rival gang members (Morelli Brothers — red-coated thugs, east side) ──
        {id:10,x:31*TS, y:1*TS,  type:"thug",    dir:2,wf:0,wt:0,vx:0,vy:0,action:"rob",       pr:4*TS,name:"Morelli Soldier",icon:"⚔️",isRival:true,aggro:false},
        {id:11,x:33*TS, y:3*TS,  type:"thug",    dir:1,wf:0,wt:0,vx:0,vy:0,action:"rob",       pr:4*TS,name:"Morelli Enforcer",icon:"⚔️",isRival:true,aggro:false},
        {id:12,x:35*TS, y:1*TS,  type:"thug",    dir:3,wf:0,wt:0,vx:0,vy:0,action:"rob",       pr:4*TS,name:"Morelli Boss",   icon:"⚔️",isRival:true,aggro:false},
        // ── Extra civilians for missions ──
        {id:13,x:21*TS, y:1*TS,  type:"civilian",dir:0,wf:0,wt:0,vx:0,vy:0,action:"rob",       pr:3*TS,name:"Bystander",     icon:"🧍"},
        {id:14,x:7*TS,  y:3*TS,  type:"civilian",dir:1,wf:0,wt:0,vx:0,vy:0,action:"rob",       pr:3*TS,name:"Shop Keeper",   icon:"🧍"},
        {id:15,x:21*TS, y:15*TS, type:"cop",     dir:0,wf:0,wt:0,vx:0,vy:0,action:"bribe",     pr:4*TS,name:"Officer Vitale",icon:"🚔",aggro:false},
        // ── Travel portal NPCs (appear at map edges) ──
        {id:16,x:57*TS, y:56*TS, type:"civilian",dir:2,wf:0,wt:0,vx:0,vy:0,action:"travel_beach",  pr:0,name:"Beach Taxi",    icon:"🌊"},
        {id:17,x:57*TS, y:2*TS,  type:"civilian",dir:2,wf:0,wt:0,vx:0,vy:0,action:"travel_docks",  pr:0,name:"Harbour Taxi",  icon:"🚢"},
        {id:18,x:2*TS,  y:2*TS,  type:"civilian",dir:3,wf:0,wt:0,vx:0,vy:0,action:"travel_airport",pr:0,name:"Airport Bus",   icon:"✈️"},
      ],
      // Cars spawn at ROAD tile centres (road cols/rows: 0,14,28,42,56 — centre = +1.5 tiles)
      // We use tile*TS+TS*1.5 so the car starts perfectly centred on a road
      cars:CAR_DEFS.map((d,i)=>({
        id:i,defIdx:i,name:d.name,
        cx:[0,14,28,42,56][i]*TS+TS*1.5,  // road col centres
        cy:[0,14,0,28,42][i]*TS+TS*1.5,   // road row centres
        heading:[0,Math.PI/2,Math.PI,-Math.PI/2,0][i], // start facing a cardinal
        carSpd:0,active:false,
        aiSpd:[1.0,0.9,1.1,0.8,1.0][i],  // slower AI speeds (px/frame)
        stuckT:0,turnT:120+i*40,pcx:0,pcy:0,
        upgrades:{engine:0,armor:0,tires:0},
      })),
      lamps:(()=>{
        const L=[];
        [0,14,28,42,56].forEach(rx=>{
          [3,13,17,27,31,41,45,55].forEach(wy=>L.push({x:(rx+1.5)*TS,y:(wy+0.5)*TS}));
        });
        [3,13,17,27,31,41,45,55].forEach(wx=>{
          [0,14,28,42,56].forEach(ry=>L.push({x:(wx+0.5)*TS,y:(ry+1.5)*TS}));
        });
        return L;
      })(),
      bullets:[],particles:[],
      // Radio
      radioOn:false, radioStation:0, // 0=jazz,1=blues,2=swing
      // Dynamic cops — spawned by wanted level, pursue player
      activeCops:[],          // [{x,y,vx,vy,dir,wf,wt,inCar,car,shootCD,health,state:'chase'|'search'|'blocked'}]
      copSpawnTimer:0,
      lastKnownPlayerX:0,
      lastKnownPlayerY:0,
      lastKnownFrame:0,
      // Hiding spots — dark alleys between blocks (always walkable)
      hidingSpots:[
        {x:10*TS,y:7*TS},{x:10*TS,y:21*TS},{x:10*TS,y:35*TS},
        {x:24*TS,y:7*TS},{x:24*TS,y:21*TS},{x:38*TS,y:7*TS},
        {x:24*TS,y:35*TS},{x:38*TS,y:21*TS},
      ],
      // Pedestrian damage
      runOverCooldown:0,
      // Mission tracking
      activeMissionId: null,
      missionStepIdx: 0,
      completedMissions: [],
      missionCounters: {robs:0, bribes:0},
      // District / map travel
      currentDistrict: "city",
      // Gang territory — which gang owns which block index (bi*4+bj)
      gangTerritory: {
        0:"corleone",1:"corleone",4:"corleone",5:"corleone",  // NW blocks
        2:"morelli",3:"morelli",6:"morelli",                   // NE blocks
        8:"sforza",12:"sforza",13:"sforza",                    // SW blocks
        7:"neutral",9:"neutral",10:"neutral",11:"neutral",14:"neutral",15:"neutral",
      },
      // Garage
      storedCars:[],           // car defIdx values stored
      // Inventory (loot carried by player)
      inventory:[],            // [{id,name,value}]
      maxInventory:5,
    };
    gsRef.current=gs;refreshHUD(gs);refreshObjective(gs);
  },[]);

  const refreshHUD=(gs)=>{
    const p=gs.player;
    const $=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
    const $s=(id,k,v)=>{const e=document.getElementById(id);if(e)e.style[k]=v;};
    $("rpg-cash","$"+p.cash.toLocaleString());
    $("rpg-hp","❤".repeat(Math.max(0,p.health))+"♡".repeat(Math.max(0,p.maxHealth-p.health)));
    $("rpg-stars","★".repeat(p.wanted)+"☆".repeat(5-p.wanted));
    $s("rpg-stars","color",p.wanted>=4?"#e84040":p.wanted>=2?"#e8a040":"#b49650");
    $s("rpg-heat","width",(p.heat*100)+"%");
    $s("rpg-heat","background",p.heat>.7?"#e03030":p.heat>.4?"#e07030":"#b49650");
    const w=WEAPONS[p.weapon];$("rpg-weapon",w?w.icon+w.name:"");
    const tx=p.x/TS|0,ty=p.y/TS|0;
    const distLabel={city:"",beach:"🌊 ",docks:"🚢 ",airport:"✈️ "}[gs?.currentDistrict||"city"]||"";
    $("rpg-zone",distLabel+(ty>58?"The Docks":tx>44?"Park District":tx<14&&ty>28?"Rail Yards":ty<14?"Downtown":"Little Italy"));
    // Respect/stats (phone menu elements may not be visible)
    const rv=document.getElementById("rpg-respect-val");if(rv)rv.textContent=`${p.respect||0} / 100`;
    const rb=document.getElementById("rpg-respect-bar");if(rb)rb.style.width=`${p.respect||0}%`;
    const sm2=document.getElementById("rpg-stat-missions");if(sm2)sm2.textContent=p.missionsComplete||0;
    const sk2=document.getElementById("rpg-stat-kills");if(sk2)sk2.textContent=p.kills||0;
    const se2=document.getElementById("rpg-stat-earned");if(se2)se2.textContent="$"+(p.totalEarned||0).toLocaleString();
  };

  const refreshObjective=(gs)=>{
    if(!gs) return;
    const el=document.getElementById("rpg-objective"); if(!el) return;
    const mid=gs.activeMissionId;
    if(mid===null||mid===undefined){el.innerHTML='<span style="color:#666;font-size:9px">No active mission — talk to Don Benedetto or Big Eddie</span>';return;}
    const m=MISSIONS.find(m=>m.id===mid); if(!m) return;
    const step=m.steps[gs.missionStepIdx];
    // Update counter text dynamically
    let stepText=step?.text||"";
    if(m.robsNeeded) stepText=stepText.replace(/\d\/\d/,`${Math.min(gs.missionCounters.robs,m.robsNeeded)}/${m.robsNeeded}`);
    if(m.bribesNeeded) stepText=stepText.replace(/\d\/\d/,`${Math.min(gs.missionCounters.bribes,m.bribesNeeded)}/${m.bribesNeeded}`);
    el.innerHTML=`
      <div style="color:#b49650;font-size:9px;letter-spacing:1px;margin-bottom:2px">${m.name.toUpperCase()}</div>
      <div style="color:#e8d5a0;font-size:10px;margin-bottom:2px">▶ ${stepText}</div>
      ${step?.hint?`<div style="color:#888;font-size:8px;font-style:italic">${step.hint}</div>`:''}
    `;
  };

  const startMission=(gs,missionId)=>{
    const m=MISSIONS.find(m=>m.id===missionId);
    if(!m){showMsg("No mission available.");return;}
    if(gs.completedMissions.includes(missionId)){showMsg(`Already completed: ${m.name}`);return;}
    if((m.respMin||0)>(gs.player.respect||0)){showMsg(`Need ${m.respMin} Respect to unlock this.`);return;}
    gs.activeMissionId=missionId;
    gs.missionStepIdx=0;
    gs.missionCounters={robs:0,bribes:0};
    showMsg(`Mission started: ${m.name}`);
    refreshObjective(gs);
    // Close mission screen
    const el=document.getElementById("rpg-missions");if(el)el.style.display="none";
  };

  const advanceMissionStep=(gs)=>{
    const mid=gs.activeMissionId; if(mid===null||mid===undefined) return;
    const m=MISSIONS.find(m=>m.id===mid); if(!m) return;
    // Cash-required steps — don't advance unless player has enough
    const step=m.steps[gs.missionStepIdx];
    if(m.cashNeeded&&gs.missionStepIdx===0&&gs.player.cash<m.cashNeeded){
      showMsg(`Need $${m.cashNeeded.toLocaleString()} to progress this mission.`);return;
    }
    gs.missionStepIdx++;
    if(gs.missionStepIdx>=m.steps.length){
      // Mission complete
      gs.player.cash+=m.reward;
      gs.player.wanted=Math.max(0,gs.player.wanted+(m.wantedGain||0));
      gs.completedMissions.push(mid);
      gs.activeMissionId=null;
      gs.missionStepIdx=0;
      gs.player.missionsComplete=(gs.player.missionsComplete||0)+1;
      gs.player.respect=Math.min(100,(gs.player.respect||0)+15);
      gs.player.totalEarned=(gs.player.totalEarned||0)+m.reward;
      showMsg(`✓ Mission complete: ${m.name} — +$${m.reward.toLocaleString()} · +15 Respect!`,400);
      refreshHUD(gs);
      submitFamigliaSession();
    }
    refreshObjective(gs);
  };
  advanceMissionStepRef.current=advanceMissionStep;

  const showMsg=(txt,dur=260)=>{
    if(!gsRef.current)return;gsRef.current.msgTimer=dur;
    const e=document.getElementById("rpg-msg");if(e){e.textContent=txt;e.style.display="block";}
  };
  const hideMsg=()=>{const e=document.getElementById("rpg-msg");if(e)e.style.display="none";};

  const doShoot=useCallback(()=>{
    const gs=gsRef.current;if(!gs?.started)return;
    const p=gs.player;if(p.shootCD>0)return;
    const w=WEAPONS[p.weapon]||WEAPONS.revolver;
    p.shootCD=w.cd;
    if(p.weapon==="fists"){
      // Melee — damage nearby NPCs
      gs.npcs.forEach(n=>{if(Math.hypot(p.x-n.x,p.y-n.y)<w.range){spawnPts(gs,n.x,n.y,"#e84040",5);showMsg("Hit!");}});
      return;
    }
    const DIRS=[[0,1],[0,-1],[-1,0],[1,0]];
    const[bx,by]=DIRS[p.dir];
    const spread=p.weapon==="shotgun"?3:1;
    for(let s=0;s<spread;s++){
      const angle=(s-1)*0.15;
      const vx=(bx*Math.cos(angle)-by*Math.sin(angle))*BULLET_SPD;
      const vy=(bx*Math.sin(angle)+by*Math.cos(angle))*BULLET_SPD;
      gs.bullets.push({x:p.x,y:p.y,vx,vy,life:p.weapon==="shotgun"?30:55,dmg:w.dmg,weapon:p.weapon});
    }
    if(p.weapon==="molotov"){
      // Fire patches
      for(let i=0;i<6;i++)spawnPts(gs,p.x+bx*60+Math.random()*40-20,p.y+by*60+Math.random()*40-20,"#ff6010",12);
    }
    p.heat=Math.min(1,p.heat+0.06);refreshHUD(gs);
  },[]);

  const doInteract=useCallback(()=>{
    const gs=gsRef.current;if(!gs?.started)return;
    const p=gs.player;
    for(const car of gs.cars){
      if(Math.hypot(p.x-car.cx,p.y-car.cy)<42){
        if(!p.inCar){
          p.inCar=true;p.car=car;car.active=true;
          car.carSpd=0; // always start from rest
          // Snap heading to nearest cardinal so car doesn't lurch diagonally
          const snapCards=[0,Math.PI/2,Math.PI,-Math.PI/2];
          let snapBest=car.heading,snapMin=Infinity;
          snapCards.forEach(c=>{let d2=Math.abs(car.heading-c);if(d2>Math.PI)d2=Math.PI*2-d2;if(d2<snapMin){snapMin=d2;snapBest=c;}});
          car.heading=snapBest;
          const d=CAR_DEFS[car.defIdx];
          showMsg(`${d.name} jacked — W/S=throttle · A/D=steer · E=exit`);
        }else if(p.car===car){
          p.x=car.cx+Math.cos(car.heading)*36;p.y=car.cy+Math.sin(car.heading)*36;
          p.inCar=false;car.active=false;car.carSpd=0;p.car=null;showMsg("Stepped out");
        }
        return;
      }
    }
    // Pay-n-spray
    for(const shop of SPRAY_SHOPS){
      if(Math.hypot(p.x-shop.x,p.y-shop.y)<40){
        if(p.wanted>0){
          if(p.cash>=shop.cost){
            p.cash-=shop.cost; p.wanted=0; p.heat=0;
            gs.activeCops&&(gs.activeCops.length=0);
            showMsg(`🎨 Sprayed — heat gone! -$${shop.cost}`);
            refreshHUD(gs);
          }else showMsg("Not enough cash for the respray.");
        }else showMsg(`${shop.name} — no heat to lose.`);
        return;
      }
    }
    for(const n of gs.npcs){
      if(Math.hypot(p.x-n.x,p.y-n.y)<32){execNPCRef.current?.(gs,n);return;}
    }
    showMsg("Get closer to a person, car, or garage");
  },[]);

  // ── SAVE / LOAD ─────────────────────────────────────────────────
  const saveGame=()=>{
    const gs=gsRef.current; if(!gs)return;
    const p=gs.player;
    const save={
      cash:p.cash, health:p.health, wanted:p.wanted, heat:p.heat,
      weapon:p.weapon, weapons:p.weapons,
      respect:p.respect||0, totalEarned:p.totalEarned||0,
      kills:p.kills||0, missionsComplete:p.missionsComplete||0,
      businesses:p.businesses||[],
      coatIdx:p.coatIdx||0, hatIdx:p.hatIdx||0, faceIdx:p.faceIdx||0, tieIdx:p.tieIdx||0,
      activeMissionId:gs.activeMissionId,
      missionStepIdx:gs.missionStepIdx,
      completedMissions:gs.completedMissions||[],
      timeOfDay:gs.timeOfDay,
      savedAt:Date.now(),
    };
    try{localStorage.setItem("famiglia_save",JSON.stringify(save));showMsg("💾 Game saved.");submitFamigliaSession();}
    catch(e){showMsg("Save failed.");}
  };
  saveGameRef.current=saveGame;

  const loadGame=()=>{
    const gs=gsRef.current; if(!gs)return;
    try{
      const raw=localStorage.getItem("famiglia_save");
      if(!raw){showMsg("No save found.");return;}
      const save=JSON.parse(raw);
      const p=gs.player;
      p.cash=save.cash||2400; p.health=save.health||5; p.wanted=save.wanted||0;
      p.heat=save.heat||0; p.weapon=save.weapon||"revolver";
      p.weapons=save.weapons||["fists","revolver"];
      p.respect=save.respect||0; p.totalEarned=save.totalEarned||0;
      p.kills=save.kills||0; p.missionsComplete=save.missionsComplete||0;
      p.businesses=save.businesses||[];
      p.coatIdx=save.coatIdx||0; p.hatIdx=save.hatIdx||0;
      p.faceIdx=save.faceIdx||0; p.tieIdx=save.tieIdx||0;
      gs.activeMissionId=save.activeMissionId??null;
      gs.missionStepIdx=save.missionStepIdx||0;
      gs.completedMissions=save.completedMissions||[];
      gs.timeOfDay=save.timeOfDay||0.35;
      // Rebuild player sprite with saved look
      rebuildPlayerSprite(gs);
      refreshHUD(gs); refreshObjective(gs);
      showMsg("💾 Game loaded.");
    }catch(e){showMsg("Load failed.");}
  };

  const rebuildPlayerSprite=(gs)=>{
    const p=gs.player;
    const customCfg={
      coat:COAT_COLS[p.coatIdx||0], hat:HAT_COLS[p.hatIdx||0],
      face:FACE_COLS[p.faceIdx||0], tie:TIE_COLS[p.tieIdx||0], badge:null,
    };
    // Rebuild only player frames using custom colours
    const frames=[];
    const W=16,H=24;
    for(let dir=0;dir<4;dir++){for(let wf=0;wf<3;wf++){
      const oc=document.createElement("canvas");oc.width=W;oc.height=H;
      const g=oc.getContext("2d");
      const px=(x,y,w,h,col)=>{if(w>0&&h>0){g.fillStyle=col;g.fillRect(x,y,w,h);}};
      const ll=wf===0?1:wf===1?0:-1;const rl=-ll;
      const c=customCfg;
      if(dir===0){
        px(3+ll,17,4,5,c.coat);px(9+rl,17,4,5,c.coat);
        px(2+ll,21,5,3,"#0a0808");px(8+rl,21,5,3,"#0a0808");
        px(2,8,12,10,c.coat);px(2,8,3,6,"#0a0808");px(11,8,3,6,"#0a0808");
        px(6,9,4,8,"#ddd8c8");if(c.tie)px(7,9,2,6,c.tie);
        px(5,8,6,2,"#ddd8c8");px(6,6,4,3,c.face);
        px(3,1,10,7,c.face);px(2,3,2,3,c.face);px(12,3,2,3,c.face);
        px(5,3,2,2,"#1a1010");px(9,3,2,2,"#1a1010");
        px(5,3,1,1,"#ffffff60");px(9,3,1,1,"#ffffff60");
        px(7,5,2,1,"#9a7040");px(6,6,4,1,"#6a3818");
        px(4,0,8,4,c.hat);px(2,3,12,2,c.hat);px(4,3,8,1,"#1a1608");
      }else if(dir===1){
        px(3+ll,17,4,5,c.coat);px(9+rl,17,4,5,c.coat);
        px(2+ll,21,5,3,"#0a0808");px(8+rl,21,5,3,"#0a0808");
        px(2,8,12,10,c.coat);px(7,8,2,10,"#00000020");
        px(6,6,4,2,c.face);px(3,2,10,6,c.hat);px(2,7,12,2,c.hat);
      }else if(dir===2){
        const ly=16+(ll>0?0:1);
        px(4+ll,ly,6,5,c.coat);px(3+ll,20,7,3,"#0a0808");
        px(3,8,10,10,c.coat);px(12,9,3,8,c.coat);
        const ay=10+(wf===1?-1:wf===2?1:0);px(1,ay,3,5,c.coat);
        px(2,1,8,7,c.face);px(3,3,2,2,"#1a1010");px(10,3,2,3,c.face);
        px(2,0,10,4,c.hat);px(1,3,12,2,c.hat);
      }else{
        const ly2=16+(ll>0?0:1);
        px(6-ll,ly2,6,5,c.coat);px(6-ll,20,7,3,"#0a0808");
        px(3,8,10,10,c.coat);px(1,9,3,8,c.coat);
        const ay2=10+(wf===1?-1:wf===2?1:0);px(12,ay2,3,5,c.coat);
        px(6,1,8,7,c.face);px(11,3,2,2,"#1a1010");px(3,3,2,3,c.face);
        px(4,0,10,4,c.hat);px(3,3,12,2,c.hat);
      }
      frames.push(oc);
    }}
    gs.charSprites.player=frames;
  };

  // ── RADIO (Web Audio API) ────────────────────────────────────────
  const radioRef=useRef({ctx:null,osc:null,on:false});
  const toggleRadio=()=>{
    const gs=gsRef.current; if(!gs)return;
    const R=radioRef.current;
    if(!R.on){
      try{
        if(!R.ctx) R.ctx=new(window.AudioContext||window.webkitAudioContext)();
        const ctx=R.ctx;
        // Generate jazzy chord loop with oscillators
        const master=ctx.createGain(); master.gain.value=0.08; master.connect(ctx.destination);
        const notes=[261.6,329.6,392,523.2,659.2]; // C major pentatonic
        const swingNotes=[293.7,349.2,440,587.3]; // D minor jazz
        const station=gs.radioStation||0;
        const scale=station===0?notes:station===1?swingNotes:[220,277.2,329.6,415.3];
        // Create rhythmic plucked sound loop
        let step=0;
        const interval=setInterval(()=>{
          if(!R.on){clearInterval(interval);return;}
          const osc=ctx.createOscillator();
          const gain=ctx.createGain();
          osc.type=station===2?"sawtooth":"triangle";
          const note=scale[step%scale.length];
          osc.frequency.value=note*(station===1?1:0.5);
          gain.gain.setValueAtTime(0.15,ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.4);
          osc.connect(gain);gain.connect(master);
          osc.start();osc.stop(ctx.currentTime+0.45);
          step++;
        },station===0?350:station===1?280:200);
        R.interval=interval;
        R.on=true; gs.radioOn=true;
        const stationNames=["🎷 Hot Jazz FM","🎸 Delta Blues","🎺 Swing Station"];
        showMsg(stationNames[gs.radioStation||0]+" — on air");
      }catch(e){showMsg("Radio unavailable.");}
    }else{
      if(R.interval)clearInterval(R.interval);
      R.on=false; gs.radioOn=false; showMsg("Radio off.");
    }
    const btn=document.getElementById("rpg-radio-btn");
    if(btn)btn.textContent=gs.radioOn?"🎷 ON":"🎷 OFF";
  };
  toggleRadioRef.current=toggleRadio;
  const nextStation=()=>{
    const gs=gsRef.current; if(!gs)return;
    const R=radioRef.current;
    if(R.on){// restart on new station
      if(R.interval)clearInterval(R.interval);R.on=false;gs.radioOn=false;
      gs.radioStation=((gs.radioStation||0)+1)%3;
      setTimeout(toggleRadio,100);
    }else{
      gs.radioStation=((gs.radioStation||0)+1)%3;
    }
  };

  const openGarage=()=>{
    const e=document.getElementById("rpg-garage");if(e)e.style.display="flex";
    // Populate garage UI
    const gs=gsRef.current;if(!gs)return;
    const p=gs.player;
    const carName=document.getElementById("rpg-garage-car");
    if(carName){
      if(p.inCar&&p.car)carName.textContent=`Current car: ${CAR_DEFS[p.car.defIdx].name}`;
      else carName.textContent="No car — walk in with a jacked car to upgrade it";
    }
  };
  const closeGarage=()=>{const e=document.getElementById("rpg-garage");if(e)e.style.display="none";};
  const buyGarageService=(serviceId)=>{
    const gs=gsRef.current;if(!gs)return;
    const p=gs.player;
    const svc=GARAGE_SERVICES.find(s=>s.id===serviceId);if(!svc)return;
    if(serviceId==="repair"){
      if(p.cash<svc.cost){showMsg("Not enough cash for repair.");return;}
      p.cash-=svc.cost;p.health=p.maxHealth;
      showMsg(`🔧 Fully repaired — health restored!`);refreshHUD(gs);closeGarage();
    }else if(serviceId.startsWith("paint_")){
      if(p.cash<svc.cost){showMsg("Not enough cash.");return;}
      p.cash-=svc.cost;p.wanted=0;p.heat=0;gs.activeCops&&(gs.activeCops.length=0);
      showMsg(`🎨 Resprayed — heat gone!`);refreshHUD(gs);closeGarage();
    }else if(serviceId==="tune"){
      if(p.cash<svc.cost){showMsg("Not enough cash for tune-up.");return;}
      if(!p.inCar||!p.car){showMsg("Drive a car into the garage first.");return;}
      p.cash-=svc.cost;
      p.car.upgrades={engine:3,armor:3,tires:3};
      showMsg(`🔧 Full tune-up — all upgrades maxed!`);refreshHUD(gs);closeGarage();
    }else if(serviceId==="store"){
      if(!p.inCar||!p.car){showMsg("Drive a car in to store it.");return;}
      if((gs.storedCars||[]).length>=3){showMsg("Garage full — 3 car max.");return;}
      gs.storedCars=gs.storedCars||[];
      gs.storedCars.push(p.car.defIdx);
      p.inCar=false;p.car.active=false;p.car=null;
      showMsg(`🚗 Car stored in your garage.`);refreshHUD(gs);closeGarage();
    }
  };

  const openShop=()=>{
    const e=document.getElementById("rpg-shop");if(e)e.style.display="flex";
  };
  const closeShop=()=>{const e=document.getElementById("rpg-shop");if(e)e.style.display="none";};
  const openMissions=()=>{
    const e=document.getElementById("rpg-missions");if(e)e.style.display="flex";
  };
  const closeMissions=()=>{const e=document.getElementById("rpg-missions");if(e)e.style.display="none";};

  const buyItem=(gs,item)=>{
    const p=gs.player;
    const prices={tommy:1000,shotgun:800,molotov:200,health:300,engine:1500,armor:1200,tires:900};
    const cost=prices[item]||999;
    if(p.cash<cost){showMsg("Not enough scratch.");return;}
    p.cash-=cost;
    if(item==="health"){p.health=Math.min(p.maxHealth,p.health+3);showMsg("Health restored +3 ❤");}
    else if(["tommy","shotgun","molotov"].includes(item)){
      if(!p.weapons.includes(item))p.weapons.push(item);
      p.weapon=item;showMsg(`${WEAPONS[item].name} equipped!`);
    } else if(["engine","armor","tires"].includes(item)&&p.inCar&&p.car){
      p.car.upgrades[item]=Math.min(3,(p.car.upgrades[item]||0)+1);
      showMsg(`Car ${item} upgraded to level ${p.car.upgrades[item]}!`);
    }
    refreshHUD(gs);closeShop();
  };

  const execNPC=(gs,n)=>{
    const p=gs.player;
    const mid=gs.activeMissionId;
    const m=mid!==null&&mid!==undefined?MISSIONS.find(m=>m.id===mid):null;
    const step=m?.steps?.[gs.missionStepIdx];
    const stepPoiId=step?.poiId;

    if(n.action==="shop"){
      // Also sell inventory when visiting fence
      if(gs.inventory&&gs.inventory.length>0){
        const sellVal=gs.inventory.reduce((a,i)=>a+i.value,0);
        p.cash+=sellVal;gs.inventory=[];
        showMsg(`Sold inventory at Sal's — +$${sellVal}`);refreshHUD(gs);
      }
      openShop();return;
    }
    if(n.action==="missions"){openMissions();return;}
    if(n.action==="garage"){openGarage();return;}

    if(n.action==="doctor"){
      if(p.cash>=500){
        p.cash-=500;p.health=p.maxHealth;
        showMsg("💊 Doc Pescatore patched you up. Full health! -$500");refreshHUD(gs);
      }else showMsg("Doc needs $500. Get the money first.");
      return;
    }

    if(n.action==="travel_beach"||n.action==="travel_docks"||n.action==="travel_airport"){
      const dest=n.action.replace("travel_","");
      gs.currentDistrict=dest;
      // Teleport player to arrival spot
      const portals={beach:{x:2*TS,y:56*TS},docks:{x:2*TS,y:2*TS},airport:{x:57*TS,y:2*TS}};
      const pt=portals[dest]||{x:15*TS,y:15*TS};
      p.x=pt.x;p.y=pt.y;p.inCar=false;if(p.car){p.car.active=false;p.car=null;}
      gs.activeCops&&(gs.activeCops.length=0);p.wanted=0;p.heat=0;
      const dname={beach:"Sunset Beach",docks:"Havana Docks",airport:"Corleone Airport"}[dest];
      showMsg(`✈️ Arrived at ${dname}`);refreshHUD(gs);return;
    }

    if(n.action==="rob"){
      const lootVal=n.isRival?400:250;
      p.cash+=lootVal;p.heat=Math.min(1,p.heat+(n.isRival?0.25:0.18));
      p.wanted=Math.min(5,p.wanted+(n.isRival?2:1));
      gs.missionCounters.robs=(gs.missionCounters.robs||0)+1;
      // Rivals become aggressive after being robbed
      if(n.isRival){
        n.aggro=true;
        // Alert nearby rivals
        gs.npcs.forEach(other=>{if(other.isRival&&Math.hypot(n.x-other.x,n.y-other.y)<200)other.aggro=true;});
        showMsg(`⚔️ Robbed ${n.name} — +$${lootVal}. Rivals are coming!`);
      }else{
        showMsg(`Robbed ${n.name} — +$${lootVal}. Heat rising.`);
      }
      // Add to inventory
      if((gs.inventory||[]).length<(gs.maxInventory||5)){
        gs.inventory=gs.inventory||[];
        gs.inventory.push({id:Date.now(),name:"Stolen Goods",value:100});
      }
      spawnPts(gs,n.x,n.y,"#e84040",6);
      // Mission 1 progress
      if(m?.robsNeeded && gs.missionCounters.robs>=m.robsNeeded) advanceMissionStep(gs);
      // Mission 3 step 1: rob courier
      if(m?.id===3 && gs.missionStepIdx===1 && n.name==="Courier") advanceMissionStep(gs);
    }else if(n.action==="bribe"){
      if(p.cash>=600){
        p.cash-=600;p.heat=Math.max(0,p.heat-.25);p.wanted=Math.max(0,p.wanted-1);
        gs.missionCounters.bribes=(gs.missionCounters.bribes||0)+1;
        showMsg(`${n.name} greased. -$600`);
        if(m?.bribesNeeded && gs.missionCounters.bribes>=m.bribesNeeded) advanceMissionStep(gs);
      }else showMsg("Can't afford the bribe. Run.");
    }else if(n.action==="collect"){
      p.cash+=1500;showMsg("Rum collected. +$1,500");
      // Sell inventory at docks/fence
      if(gs.inventory&&gs.inventory.length>0){
        const sellVal=gs.inventory.reduce((a,i)=>a+i.value,0);
        p.cash+=sellVal;gs.inventory=[];showMsg(`Rum + goods sold. +$${(1500+sellVal).toLocaleString()}`);
      }
      // Mission 0 step 2: collect from docks
      if(m?.id===0 && gs.missionStepIdx===2) advanceMissionStep(gs);
    }else if(n.action==="missions"){
      // Mission 0 step 0: talk to boss first time
      if(m?.id===0 && gs.missionStepIdx===0) advanceMissionStep(gs);
      // Mission 0 step 3: return to boss
      if(m?.id===0 && gs.missionStepIdx===3) advanceMissionStep(gs);
      // Mission 3 step 3: report back
      if(m?.id===3 && gs.missionStepIdx===3) advanceMissionStep(gs);
      openMissions();return;
    }
    // Escape heat step for mission 3
    if(m?.id===3 && gs.missionStepIdx===2 && p.wanted===0) advanceMissionStep(gs);
    refreshHUD(gs);refreshObjective(gs);
  };
  execNPCRef.current=execNPC;

  const spawnPts=(gs,x,y,col,n=6)=>{
    for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,s=1.5+Math.random()*3;gs.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:24,col,sz:1+Math.random()*2});}
  };

  const update=useCallback(()=>{
    const gs=gsRef.current;if(!gs?.started)return;
    const{player:p,npcs,cars,bullets,particles,map,activeCops}=gs;
    const keys=keysRef.current,joy=joyRef.current;
    gs.frame++;const f=gs.frame;

    // ── Input ────────────────────────────────────────────────────────
    let rdx=(keys["ArrowLeft"]||keys["KeyA"]?-1:0)+(keys["ArrowRight"]||keys["KeyD"]?1:0);
    let rdy=(keys["ArrowUp"]  ||keys["KeyW"]?-1:0)+(keys["ArrowDown"] ||keys["KeyS"]?1:0);
    rdx=Math.max(-1,Math.min(1,rdx+(joy.vec.x||0)));
    rdy=Math.max(-1,Math.min(1,rdy+(joy.vec.y||0)));

    // ── Player / car movement ────────────────────────────────────────
    if(p.inCar&&p.car){
      const car=p.car,d=CAR_DEFS[car.defIdx];
      const engBoost=1+(car.upgrades.engine||0)*0.15;
      const tireBoost=1+(car.upgrades.tires||0)*0.06;
      car.carSpd+=(-rdy)*CAR_ACCEL*d.accel*engBoost;
      // Friction: tireBoost INCREASES grip (higher friction value = less slip = more control)
      // base fric 0.90, each tire level adds 0.01 grip
      car.carSpd*=(CAR_FRIC+tireBoost*0.1);
      const maxSpd=CAR_MAX*d.speed*(1+(car.upgrades.engine||0)*0.15);
      car.carSpd=Math.max(-maxSpd*0.5,Math.min(maxSpd,car.carSpd));
      // Screen-consistent turn: no sign(carSpd) — avoids reverse feeling like inverted stick
      if(Math.abs(car.carSpd)>0.2)car.heading+=rdx*CAR_STEER;
      const R=18+(car.upgrades.armor||0)*2;
      const vx=Math.sin(car.heading)*car.carSpd,vy=-Math.cos(car.heading)*car.carSpd;
      // Solid-wall collision (buildings)
      const nxc=car.cx+vx, nyc=car.cy+vy;
      if(canMove(map,nxc,car.cy,R)){car.cx=nxc;}else{car.carSpd*=-0.2;car.heading+=0.05;}
      if(canMove(map,car.cx,nyc,R)){car.cy=nyc;}else{car.carSpd*=-0.2;car.heading-=0.05;}
      // Soft road-edge resistance: if car drifts onto pavement, gentle correction
      if(!isRoad(map,car.cx,car.cy)){
        // Find nearest road direction and nudge back
        const nx2=(Math.round(car.cx/TS))*TS+TS/2;
        const ny2=(Math.round(car.cy/TS))*TS+TS/2;
        if(isRoad(map,nx2,ny2)){car.cx+=(nx2-car.cx)*0.08;car.cy+=(ny2-car.cy)*0.08;}
        car.carSpd*=0.92; // extra friction off-road
      }
      car.cx=Math.max(R,Math.min(car.cx,(MW-1)*TS-R));
      car.cy=Math.max(R,Math.min(car.cy,(MH-1)*TS-R));
      p.x=car.cx;p.y=car.cy;

      // ── Car vs Car collisions ──────────────────────────────────────
      const speed=Math.abs(car.carSpd);
      if(speed>0.5){
        cars.forEach(other=>{
          if(other===car||other.active)return;
          const dist=Math.hypot(car.cx-other.cx,car.cy-other.cy);
          if(dist<32){
            // Push other car away
            const ang=Math.atan2(other.cy-car.cy,other.cx-car.cx);
            const push=speed*0.6;
            other.cx+=Math.cos(ang)*push*3;other.cy+=Math.sin(ang)*push*3;
            car.carSpd*=-0.35;
            spawnPts(gs,car.cx,car.cy,"#888888",8);
            // Damage player car at high speed
            if(speed>3&&p.invincible<=0){p.health=Math.max(0,p.health-1);p.invincible=40;refreshHUD(gs);showMsg("Crash!");}
          }
        });
        // ── Run over pedestrians & NPCs ───────────────────────────────
        if(gs.runOverCooldown<=0){
          npcs.forEach(n=>{
            if(n.type==="cop"||n.type==="boss")return;// protected
            if(Math.hypot(p.x-n.x,p.y-n.y)<22&&speed>1.5){
              spawnPts(gs,n.x,n.y,"#e84040",10);
              n.x+=Math.sin(car.heading)*40;n.y-=Math.cos(car.heading)*40;
              p.cash+=100;p.heat=Math.min(1,p.heat+0.2);p.wanted=Math.min(5,p.wanted+1);
              gs.runOverCooldown=90;showMsg("Run over — +$100 | Heat rising!");refreshHUD(gs);
            }
          });
        }
        // Run over active cops on foot
        if(gs.runOverCooldown<=0){
          activeCops.forEach(cop=>{
            if(!cop.inCar&&Math.hypot(p.x-cop.x,p.y-cop.y)<22&&speed>1.5){
              spawnPts(gs,cop.x,cop.y,"#4488cc",10);
              cop.health=Math.max(0,cop.health-3);
              gs.runOverCooldown=60;p.wanted=Math.min(5,p.wanted+1);
              showMsg("Ran over a cop!");refreshHUD(gs);
            }
          });
        }
      }
      if(gs.runOverCooldown>0)gs.runOverCooldown--;

      // ── Car vs active-cop cars ─────────────────────────────────────
      activeCops.forEach(cop=>{
        if(!cop.inCar||!cop.copCar)return;
        const cc=cop.copCar;
        const dist2=Math.hypot(car.cx-cc.cx,car.cy-cc.cy);
        if(dist2<30&&speed>0.5){
          const ang2=Math.atan2(cc.cy-car.cy,cc.cx-car.cx);
          cc.cx+=Math.cos(ang2)*speed*2;cc.cy+=Math.sin(ang2)*speed*2;
          car.carSpd*=-0.3;cop.health=Math.max(0,cop.health-1);
          spawnPts(gs,car.cx,car.cy,"#888888",6);
        }
      });
    }else{
      // ── On foot movement ──────────────────────────────────────────
      const mag=Math.sqrt(rdx*rdx+rdy*rdy),spd=PLAYER_SPD;
      const nx=rdx/(mag||1),ny=rdy/(mag||1);
      if(Math.abs(rdx)>Math.abs(rdy))p.dir=rdx>0?3:2;else if(Math.abs(rdy)>.05)p.dir=rdy>0?0:1;
      const moving=mag>0.05;
      if(moving){p.walkT++;if(p.walkT>5){p.walkT=0;p.walkF=(p.walkF+1)%3;}}else p.walkF=0;
      const pr=5;
      if(canMove(map,p.x+nx*spd,p.y,pr))p.x+=nx*spd;
      else if(canMove(map,p.x+nx*spd,p.y+ny*spd*.3,pr))p.x+=nx*spd;
      if(canMove(map,p.x,p.y+ny*spd,pr))p.y+=ny*spd;
      else if(canMove(map,p.x+nx*spd*.3,p.y+ny*spd,pr))p.y+=ny*spd;
      p.x=Math.max(pr,Math.min(p.x,(MW-1)*TS-pr));
      p.y=Math.max(pr,Math.min(p.y,(MH-1)*TS-pr));
    }
    gs.camX=Math.max(0,Math.min(p.x-NW/2,MW*TS-NW));
    gs.camY=Math.max(0,Math.min(p.y-NH/2,MH*TS-NH));

    // ── Wanted level: spawn dynamic cops ────────────────────────────
    // Stars 1-2: 1-2 foot cops; Stars 3-4: cop cars added; Star 5: SWAT vans
    const maxCops=[0,1,2,3,4,6][Math.min(5,p.wanted)];
    gs.copSpawnTimer=Math.max(0,(gs.copSpawnTimer||0)-1);
    if(p.wanted>0&&activeCops.length<maxCops&&gs.copSpawnTimer<=0){
      // Spawn a cop just off-screen in the direction of the player
      const spawnAngle=Math.random()*Math.PI*2;
      const spawnDist=280+Math.random()*100;
      const sx=p.x+Math.cos(spawnAngle)*spawnDist;
      const sy=p.y+Math.sin(spawnAngle)*spawnDist;
      const isCopCar=p.wanted>=3&&Math.random()<0.5;
      const swat=p.wanted>=5&&Math.random()<0.3;
      const newCop={
        x:Math.max(TS,Math.min(sx,(MW-1)*TS)),
        y:Math.max(TS,Math.min(sy,(MH-1)*TS)),
        vx:0,vy:0,dir:0,wf:0,wt:0,health:swat?3:2,
        shootCD:0,state:"chase",
        isSwat:swat,
        inCar:isCopCar,
        copCar:isCopCar?{
          cx:Math.max(TS,Math.min(sx,(MW-1)*TS)),
          cy:Math.max(TS,Math.min(sy,(MH-1)*TS)),
          heading:Math.random()*Math.PI*2,
          carSpd:0,
          col:swat?"#2a2a2a":"#0c1838",
        }:null,
        searchX:p.x,searchY:p.y,searchTimer:0,
      };
      activeCops.push(newCop);
      gs.copSpawnTimer=180;// 3 seconds between spawns
      if(p.wanted===5&&swat)showMsg("⚠ SWAT DEPLOYED — hide NOW!");
      else if(p.wanted>=3)showMsg("🚔 Cop car in pursuit!");
      else showMsg("🚔 Police responding!");
    }
    // Remove cops when wanted drops to 0
    if(p.wanted===0&&activeCops.length>0){
      activeCops.length=0;showMsg("Heat cooled — cops called off.");
    }

    // ── Hiding mechanic ─────────────────────────────────────────────
    // Check if player is in a hiding spot (alley tile) and out of cop sight
    {
      const playerTile=tileAt(map,p.x,p.y);
      const inAlley=playerTile===T.WALK&&!p.inCar;
      const copsSeePlayer=activeCops.some(cop=>{
        const dist=Math.hypot(p.x-cop.x,p.y-cop.y);
        return dist<100&&cop.state==="chase";
      });
      // If in alley and no cop has direct LoS within 100px: hide mode
      if(inAlley&&!copsSeePlayer&&p.wanted>0){
        if(!gs._hidingFrames)gs._hidingFrames=0;
        gs._hidingFrames++;
        if(gs._hidingFrames===1)showMsg("🫥 Hiding in the shadows — stay out of sight...");
        // Accelerate heat cooldown while hiding
        if(gs._hidingFrames%40===0){
          p.heat=Math.max(0,p.heat-0.04);
          if(p.heat<0.2&&p.wanted>0){p.wanted--;refreshHUD(gs);showMsg("Stars dropping — keep hiding!");}
        }
      }else{
        gs._hidingFrames=0;
      }
      gs._isHiding=inAlley&&!copsSeePlayer&&p.wanted>0&&gs._hidingFrames>0;
    }

    // ── Update active cops AI ────────────────────────────────────────
    for(let ci=activeCops.length-1;ci>=0;ci--){
      const cop=activeCops[ci];
      if(cop.health<=0){spawnPts(gs,cop.x,cop.y,"#4488cc",10);activeCops.splice(ci,1);continue;}

      const distToPlayer=Math.hypot(p.x-cop.x,p.y-cop.y);
      const canSeePlayer=distToPlayer<120&&!gs._isHiding;

      if(canSeePlayer){
        cop.state="chase";
        gs.lastKnownPlayerX=p.x;gs.lastKnownPlayerY=p.y;gs.lastKnownFrame=f;
        cop.searchX=p.x;cop.searchY=p.y;
      }else if(cop.state==="chase"&&!canSeePlayer){
        cop.state="search";cop.searchTimer=300;// search for 5s
      }

      if(cop.inCar&&cop.copCar){
        const cc=cop.copCar;
        if(cop.state==="chase"||cop.state==="search"){
          const tx=cop.state==="chase"?p.x:cop.searchX;
          const ty=cop.state==="chase"?p.y:cop.searchY;
          const targetAngle=Math.atan2(tx-cc.cx,-(ty-cc.cy));
          let angleDiff=targetAngle-cc.heading;
          while(angleDiff>Math.PI)angleDiff-=Math.PI*2;
          while(angleDiff<-Math.PI)angleDiff+=Math.PI*2;
          cc.heading+=Math.sign(angleDiff)*Math.min(0.08,Math.abs(angleDiff));
          const targetDist=Math.hypot(tx-cc.cx,ty-cc.cy);
          const targetSpd=cop.state==="search"?2.0:Math.min(5.2,targetDist*0.05+1.5);
          cc.carSpd+=(targetSpd-cc.carSpd)*0.15;
          cc.carSpd=Math.max(-1,Math.min(5.5,cc.carSpd));
          const cvx=Math.sin(cc.heading)*cc.carSpd,cvy=-Math.cos(cc.heading)*cc.carSpd;
          if(canMove(map,cc.cx+cvx,cc.cy,16))cc.cx+=cvx;else{cc.carSpd*=-0.3;cc.heading+=0.4;}
          if(canMove(map,cc.cx,cc.cy+cvy,16))cc.cy+=cvy;else{cc.carSpd*=-0.3;cc.heading+=0.4;}
          cc.cx=Math.max(16,Math.min(cc.cx,(MW-1)*TS-16));
          cc.cy=Math.max(16,Math.min(cc.cy,(MH-1)*TS-16));
        }
        cop.x=cc.cx;cop.y=cc.cy;
        // Ram player car
        if(p.inCar&&p.car){
          const ram=Math.hypot(cc.cx-p.car.cx,cc.cy-p.car.cy);
          if(ram<28&&Math.abs(cc.carSpd)>1.5){
            if(p.invincible<=0){p.health=Math.max(0,p.health-1);p.invincible=50;showMsg("PIT manoeuvre!");refreshHUD(gs);}
            spawnPts(gs,cc.cx,cc.cy,"#888",8);p.car.carSpd*=-0.4;
          }
        }
        // Shoot at player car from cop car (high wanted)
        if(p.wanted>=4&&cop.shootCD<=0&&distToPlayer<150){
          const a2=Math.atan2(p.y-cc.cy,p.x-cc.cx);
          gs.bullets.push({x:cc.cx,y:cc.cy,vx:Math.cos(a2)*10,vy:Math.sin(a2)*10,life:40,dmg:1,owner:"cop"});
          cop.shootCD=60;
        }
      }else{
        // On-foot cop
        const tx=cop.state==="chase"?p.x:cop.searchX;
        const ty=cop.state==="chase"?p.y:cop.searchY;
        const a=Math.atan2(ty-cop.y,tx-cop.x);
        const footSpd=cop.isSwat?2.0:1.6;
        if(cop.state==="chase"||cop.state==="search"){
          const stepVx=Math.cos(a)*footSpd,stepVy=Math.sin(a)*footSpd;
          if(canMove(map,cop.x+stepVx,cop.y,4))cop.x+=stepVx;else cop.x-=stepVx*0.2;
          if(canMove(map,cop.x,cop.y+stepVy,4))cop.y+=stepVy;else cop.y-=stepVy*0.2;
        }
        // Dir & walk anim
        if(Math.abs(cop.vx||0)>.1)cop.dir=(cop.vx||0)>0?3:2;else if(Math.abs(cop.vy||0)>.1)cop.dir=(cop.vy||0)>0?0:1;
        cop.vx=Math.cos(a)*footSpd;cop.vy=Math.sin(a)*footSpd;
        cop.wt=(cop.wt||0)+1;if(cop.wt>5){cop.wt=0;cop.wf=(cop.wf+1)%3;}
        // Shoot at player (stars 2+)
        if(p.wanted>=2&&cop.shootCD<=0&&distToPlayer<140&&cop.state==="chase"){
          const a2=Math.atan2(p.y-cop.y,p.x-cop.x);
          gs.bullets.push({x:cop.x,y:cop.y,vx:Math.cos(a2)*9,vy:Math.sin(a2)*9,life:40,dmg:1,owner:"cop"});
          cop.shootCD=cop.isSwat?25:45;
        }
        // Melee arrest
        if(distToPlayer<16&&cop.state==="chase"&&f%70===0){
          if(p.invincible<=0){p.health=Math.max(0,p.health-1);p.invincible=60;
          spawnPts(gs,p.x,p.y,"#4488cc",8);showMsg("Busted! -1 HP");refreshHUD(gs);}
        }
        // Search: give up after timer
        if(cop.state==="search"){cop.searchTimer--;if(cop.searchTimer<=0)cop.state="patrol";}
      }
      if(cop.shootCD>0)cop.shootCD--;
    }

    // ── AI ambient cars — road-following ─────────────────────────────
    // Cars snap to cardinal directions (N/E/S/W) and only move on road tiles.
    // At an intersection they may turn; if they hit a wall they turn at the next
    // road tile. This keeps them reliably on roads.
    cars.forEach(car=>{
      if(car.active)return;

      // Snap heading to nearest cardinal (0=N, π/2=E, π=S, -π/2=W)
      // This prevents diagonal drift that puts cars on pavements
      const cardinals=[0,Math.PI/2,Math.PI,-Math.PI/2];
      let nearest=car.heading;
      let minDiff=Infinity;
      cardinals.forEach(c=>{
        let d=Math.abs(car.heading-c); if(d>Math.PI)d=Math.PI*2-d;
        if(d<minDiff){minDiff=d;nearest=c;}
      });
      // Gradually snap toward nearest cardinal (smooth, not instant)
      let diff=nearest-car.heading;
      if(diff>Math.PI)diff-=Math.PI*2;
      if(diff<-Math.PI)diff+=Math.PI*2;
      car.heading+=diff*0.12;

      const vx=Math.sin(car.heading)*car.aiSpd;
      const vy=-Math.cos(car.heading)*car.aiSpd;
      const nx=car.cx+vx, ny=car.cy+vy;

      // Check next position is still on road
      const nextOnRoad=carOnRoad(map,nx,ny,12);
      const nextWalkable=canMove(map,nx,ny,14);

      if(nextOnRoad&&nextWalkable){
        car.cx=nx; car.cy=ny;
        car.stuckT=0;
        // Random turn at intersections (every ~3-6 seconds on road)
        // Only turn if current tile is a cross/intersection
        const curTile=tileAt(map,car.cx,car.cy);
        if(curTile===T.CROSS&&f%(car.id*17+90)===0&&Math.random()<0.4){
          // Try a right or left turn, prefer ones that stay on road
          const turns=[Math.PI/2,-Math.PI/2]; // right, left — no U-turn at intersections
          for(const dt of turns){
            const nh=nearest+dt;
            const tvx=Math.sin(nh)*car.aiSpd*4, tvy=-Math.cos(nh)*car.aiSpd*4;
            if(carOnRoad(map,car.cx+tvx,car.cy+tvy,12)){
              car.heading=nh; break;
            }
          }
        }
      }else{
        // Can't go forward on road — find a valid cardinal direction
        car.stuckT++;
        if(car.stuckT>8){
          // Try right turn first (natural traffic flow), then left, then reverse
          let turned=false;
          for(const dt of[Math.PI/2,-Math.PI/2,Math.PI]){
            const nh=nearest+dt;
            const tvx=Math.sin(nh)*car.aiSpd*6, tvy=-Math.cos(nh)*car.aiSpd*6;
            if(carOnRoad(map,car.cx+tvx,car.cy+tvy,12)){
              car.heading=nh; turned=true; car.stuckT=0; break;
            }
          }
          // If completely stuck, nudge back onto nearest road tile
          if(!turned){
            // Find closest road tile and move toward it
            const directions=[[0,-1],[1,0],[0,1],[-1,0]];
            for(const[dx,dy]of directions){
              const tx=(Math.round(car.cx/TS)+dx)*TS+TS/2;
              const ty=(Math.round(car.cy/TS)+dy)*TS+TS/2;
              if(isRoad(map,tx,ty)){
                car.cx+=(tx-car.cx)*0.15;
                car.cy+=(ty-car.cy)*0.15;
                car.heading=Math.atan2(tx-car.cx,-(ty-car.cy));
                car.stuckT=0; break;
              }
            }
          }
        }
      }

      // Car vs car ambient nudge (gentle, no stucking)
      cars.forEach(other=>{
        if(other===car)return;
        const dd=Math.hypot(car.cx-other.cx,car.cy-other.cy);
        if(dd<26&&dd>0){
          const ang3=Math.atan2(other.cy-car.cy,other.cx-car.cx);
          other.cx+=Math.cos(ang3)*0.8;other.cy+=Math.sin(ang3)*0.8;
        }
      });
    });

    // ── Ambient NPCs ─────────────────────────────────────────────────
    npcs.forEach((n,ni)=>{
      const dist=Math.hypot(p.x-n.x,p.y-n.y);
      // Rival gang — chase and attack when aggro
      if(n.isRival&&n.aggro){
        const ra=Math.atan2(p.y-n.y,p.x-n.x);
        n.vx=Math.cos(ra)*1.8;n.vy=Math.sin(ra)*1.8;
        // Melee attack
        if(dist<20&&p.invincible<=0&&f%60===0){
          p.health=Math.max(0,p.health-1);p.invincible=50;
          spawnPts(gs,p.x,p.y,"#cc3030",6);showMsg("⚔️ Morelli soldier hit you! -1 HP");refreshHUD(gs);
        }
        // Shoot at player if close
        if(dist<120&&n.shootCD<=0){
          const ba=Math.atan2(p.y-n.y,p.x-n.x);
          gs.bullets.push({x:n.x,y:n.y,vx:Math.cos(ba)*8,vy:Math.sin(ba)*8,life:40,dmg:1,owner:"rival"});
          n.shootCD=50;
        }
        if(n.shootCD>0)n.shootCD--;
      }
      // Civilian flee from wanted player
      else if(n.type==="civilian"&&p.wanted>=2&&dist<80){
        const fa=Math.atan2(n.y-p.y,n.x-p.x);
        n.vx=Math.cos(fa)*1.6;n.vy=Math.sin(fa)*1.6;
      }else if(n.pr>0&&f%(78+ni*11)===0){
        Math.random()>.45?(()=>{const a=Math.random()*Math.PI*2;n.vx=Math.cos(a)*.9;n.vy=Math.sin(a)*.9;})():(()=>{n.vx=n.vy=0;})();
      }
      if(canMove(map,n.x+n.vx,n.y,4))n.x+=n.vx;else n.vx*=-.5;
      if(canMove(map,n.x,n.y+n.vy,4))n.y+=n.vy;else n.vy*=-.5;
      const mv=n.vx!==0||n.vy!==0;
      if(mv){n.wt++;if(n.wt>5){n.wt=0;n.wf=(n.wf+1)%3;}}else n.wf=0;
      if(n.vx>0.1)n.dir=3;else if(n.vx<-0.1)n.dir=2;else if(n.vy<-0.1)n.dir=1;else if(n.vy>0.1)n.dir=0;
    });

    // ── Bullets ──────────────────────────────────────────────────────
    for(let i=bullets.length-1;i>=0;i--){
      const b=bullets[i];b.x+=b.vx;b.y+=b.vy;b.life--;
      if(b.life<=0||isSolid(map,b.x,b.y)){spawnPts(gs,b.x,b.y,"#ffe080",3);bullets.splice(i,1);continue;}
      // Hit player
      if((b.owner==="cop"||b.owner==="rival")&&!p.inCar&&p.invincible<=0&&Math.hypot(b.x-p.x,b.y-p.y)<12){
        p.health=Math.max(0,p.health-1);p.invincible=45;spawnPts(gs,p.x,p.y,"#e84040",6);
        showMsg("You were shot!");refreshHUD(gs);bullets.splice(i,1);continue;
      }
      if(b.owner==="cop"&&p.inCar&&p.car&&Math.hypot(b.x-p.car.cx,b.y-p.car.cy)<20){
        if(p.invincible<=0){p.health=Math.max(0,p.health-1);p.invincible=30;refreshHUD(gs);}
        bullets.splice(i,1);continue;
      }
      // Player bullets hit active cops
      if(b.owner!=="cop"){
        let hit=false;
        for(const cop of activeCops){
          if(Math.hypot(b.x-cop.x,b.y-cop.y)<14){
            cop.health=Math.max(0,cop.health-1);
            spawnPts(gs,b.x,b.y,"#4488cc",8);
            p.wanted=Math.min(5,p.wanted+1);p.heat=Math.min(1,p.heat+0.2);
            showMsg(cop.health<=0?"Cop down! Heat +1":"Cop hit! Heat rising.");
            refreshHUD(gs);bullets.splice(i,1);hit=true;break;
          }
        }
        if(hit)continue;
        // Hit ambient NPCs
        for(const n of npcs){
          if(Math.hypot(b.x-n.x,b.y-n.y)<14){
            spawnPts(gs,b.x,b.y,"#e84040",8);
            if(n.type==="cop"){p.wanted=Math.min(5,p.wanted+2);p.heat=Math.min(1,p.heat+.25);}
            showMsg(n.type==="cop"?"Shot a cop! Heat +2":"Target down.");refreshHUD(gs);bullets.splice(i,1);break;
          }
        }
      }
    }

    // ── Particles ────────────────────────────────────────────────────
    for(let i=particles.length-1;i>=0;i--){
      const pt=particles[i];pt.x+=pt.vx;pt.y+=pt.vy;pt.vx*=.88;pt.vy*=.88;pt.life--;
      if(pt.life<=0)particles.splice(i,1);
    }

    // ── Heat / wanted cooldown ────────────────────────────────────────
    // ── Business income ticks ────────────────────────────────────────
    if(f%180===0&&p.businesses&&p.businesses.length>0){
      p.businesses.forEach(bid=>{
        const bdef=BUSINESSES.find(b=>b.id===bid); if(!bdef)return;
        // Tick every ~3s (180 frames). Income is per interval defined in def.
        // Scale: incomeMs/1000*3 per tick ≈ correct per-second rate
        const perTick=Math.round(bdef.income*3);
        p.cash+=perTick; p.totalEarned=(p.totalEarned||0)+perTick;
        // Raid chance per tick (very low)
        if(bdef.raidChance>0&&Math.random()<bdef.raidChance*0.02){
          p.wanted=Math.min(5,p.wanted+1); p.heat=Math.min(1,p.heat+0.15);
          showMsg(`⚠ Raid on ${bdef.name}! Heat rising.`);
        }
      });
      refreshHUD(gs);
      // Update business income display
      const biEl=document.getElementById("rpg-biz-income");
      if(biEl){
        const total=p.businesses.reduce((a,bid)=>{const b=BUSINESSES.find(x=>x.id===bid);return a+(b?b.income:0);},0);
        biEl.textContent=total>0?"+$"+total+"/3s":"";
      }
    }

    // ── Pay-n-spray proximity ─────────────────────────────────────────
    if(!p.inCar){
      SPRAY_SHOPS.forEach(shop=>{
        if(Math.hypot(p.x-shop.x,p.y-shop.y)<36&&p.wanted>0){
          if(!gs._sprayPrompted){
            gs._sprayPrompted=true;
            showMsg(`🎨 ${shop.name} nearby — press E to lose heat ($${shop.cost})`);
          }
        }else if(gs._sprayPrompted&&Math.hypot(p.x-shop.x,p.y-shop.y)>60){
          gs._sprayPrompted=false;
        }
      });
    }

    // ── Respect gain from actions ─────────────────────────────────────
    if(f%600===0&&(p.respect||0)<100){
      if((p.missionsComplete||0)>0) p.respect=Math.min(100,(p.respect||0)+1);
    }

    if(p.shootCD>0)p.shootCD--;if(p.invincible>0)p.invincible--;
    // Base cooldown rate — slowed if cops can still see player
    const copsSeeingNow=activeCops.filter(c=>Math.hypot(p.x-c.x,p.y-c.y)<100).length;
    const coolRate=gs._isHiding?0.045:copsSeeingNow>0?0:0.012;
    if(f%40===0&&p.heat>0&&coolRate>0){
      p.heat=Math.max(0,p.heat-coolRate);
      if(p.wanted>0&&p.heat<0.12){
        const prev=p.wanted;p.wanted--;refreshHUD(gs);
        if(prev!==p.wanted){gs._wantedFlash=30;showMsg(p.wanted===0?"★ Heat gone — you're clear":"★ One less star");}
      }
    }
    if(p.health<=0&&!gs._dead){
      gs._dead=true;p.cash=Math.max(0,Math.floor(p.cash*0.5));
      p.health=3;p.wanted=0;p.heat=0;activeCops.length=0;
      p.x=15*TS;p.y=1*TS;p.inCar=false;p.car=null;
      showMsg("💀 Busted! Lost 50% cash. Respawned Downtown.",500);refreshHUD(gs);
      setTimeout(()=>{gs._dead=false;},3000);
    }
    const emid=gs.activeMissionId;
    if(emid===3&&gs.missionStepIdx===2&&p.wanted===0){advanceMissionStepRef.current?.(gs);}
    if(gs.msgTimer>0){gs.msgTimer--;if(gs.msgTimer===0)hideMsg();}
    gs.timeOfDay=(gs.timeOfDay+gs.daySpeed)%1;
  },[]);

  const draw=useCallback(()=>{
    const gs=gsRef.current,canvas=canvasRef.current;if(!gs||!canvas)return;
    const{player:p,npcs,cars,bullets,particles,camX,camY,bakedTiles,charSprites,carSprites,lamps}=gs;
    const ctx=canvas.getContext("2d");
    const S=(wx,wy)=>({x:Math.round(wx-camX),y:Math.round(wy-camY)});

    // Tile layer
    ctx.drawImage(bakedTiles,-Math.round(camX),-Math.round(camY));

    // ── Gang territory tint overlay ───────────────────────────────────
    if(gs.gangTerritory){
      const BLK=[3,17,31,45];
      ctx.save();ctx.globalAlpha=0.08;
      BLK.forEach((bx,bi)=>BLK.forEach((by,bj)=>{
        const idx=bi*4+bj;
        const gangId=gs.gangTerritory[idx]||"neutral";
        const g2=GANGS.find(g=>g.id===gangId);
        if(!g2||gangId==="neutral")return;
        ctx.fillStyle=g2.col;
        const wx=bx*TS-camX,wy=by*TS-camY;
        ctx.fillRect(wx,wy,11*TS,11*TS);
        // Gang name label
        ctx.globalAlpha=0.25;ctx.font="bold 8px monospace";ctx.textAlign="center";
        ctx.fillText(g2.name,wx+5.5*TS,wy+5.5*TS);
        ctx.globalAlpha=0.08;
      }));
      ctx.globalAlpha=1;ctx.restore();
    }

    // Street lamps — warm glow before overlay
    {
      const t=gs.timeOfDay;
      const nightAmt=t<0.25?Math.max(0,(0.25-t)/0.12):t>0.7?Math.max(0,(t-0.7)/0.12):0;
      const na=Math.min(1,nightAmt);
      if(na>0.02){
        lamps.forEach(lp=>{
          const ls=S(lp.x,lp.y);
          if(ls.x<NW+80&&ls.x>-80&&ls.y<NH+80&&ls.y>-80){
            const grd=ctx.createRadialGradient(ls.x,ls.y+6,1,ls.x,ls.y+10,52);
            grd.addColorStop(0,`rgba(255,210,100,${(na*.55).toFixed(2)})`);
            grd.addColorStop(0.35,`rgba(220,150,40,${(na*.22).toFixed(2)})`);
            grd.addColorStop(1,"rgba(160,90,10,0)");
            ctx.fillStyle=grd;ctx.beginPath();ctx.arc(ls.x,ls.y+10,52,0,Math.PI*2);ctx.fill();
            ctx.fillStyle=`rgba(255,240,160,${Math.min(1,na*1.3).toFixed(2)})`;
            ctx.beginPath();ctx.arc(ls.x,ls.y,3,0,Math.PI*2);ctx.fill();
            ctx.fillStyle=`rgba(255,255,220,${Math.min(1,na).toFixed(2)})`;
            ctx.beginPath();ctx.arc(ls.x,ls.y,1.5,0,Math.PI*2);ctx.fill();
          }
        });
      }
    }

    // Pay-n-spray shop markers
    {
      ctx.save();
      SPRAY_SHOPS.forEach(shop=>{
        const s=S(shop.x,shop.y);
        if(s.x<-40||s.x>NW+40||s.y<-20||s.y>NH+20) return;
        const pulse=0.6+0.4*Math.sin(gs.frame*0.1);
        ctx.globalAlpha=pulse*0.85;
        ctx.fillStyle="#20c060";ctx.beginPath();ctx.arc(s.x,s.y,6,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle="#40ff90";ctx.lineWidth=1.5;ctx.stroke();
        ctx.globalAlpha=0.9;ctx.fillStyle="#40ff90";
        ctx.font="bold 7px monospace";ctx.textAlign="center";
        ctx.fillText("🎨",s.x,s.y-9);
        ctx.font="7px monospace";ctx.fillStyle="#e8d5a0";
        ctx.fillText(shop.name,s.x,s.y-18);
      });
      ctx.globalAlpha=1;ctx.restore();
    }

    // POI world markers — small persistent labels
    {
      ctx.save();ctx.font="bold 8px monospace";ctx.textAlign="center";
      POIS.forEach(poi=>{
        const s=S(poi.x,poi.y);
        if(s.x<-60||s.x>NW+60||s.y<-20||s.y>NH+20) return;
        // Only show if not the active target (avoids double-labelling)
        const mid2=gs.activeMissionId;
        const m2=mid2!==null&&mid2!==undefined?MISSIONS.find(m=>m.id===mid2):null;
        const activePoiId=m2?.steps?.[gs.missionStepIdx]?.poiId;
        if(activePoiId===poi.id) return;// active target has its own bigger label
        ctx.globalAlpha=0.55;
        // Small coloured dot
        ctx.fillStyle=poi.col;ctx.beginPath();ctx.arc(s.x,s.y,4,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle="rgba(0,0,0,0.5)";ctx.lineWidth=1;ctx.stroke();
        // Label
        ctx.globalAlpha=0.7;ctx.fillStyle="#e8d5a0";
        ctx.fillText(poi.label,s.x,s.y-9);
      });
      ctx.globalAlpha=1;ctx.restore();
    }

    // Zone labels
    ctx.save();ctx.font="bold 9px monospace";ctx.textAlign="center";ctx.globalAlpha=0.14;ctx.fillStyle="#c8b078";
    [{x:7*TS,y:7*TS,t:"DOWNTOWN"},{x:21*TS,y:7*TS,t:"MIDTOWN"},{x:35*TS,y:7*TS,t:"UPTOWN"},
     {x:49*TS,y:7*TS,t:"PARK DISTRICT"},{x:7*TS,y:21*TS,t:"LITTLE ITALY"},{x:30*TS,y:62*TS,t:"THE DOCKS"}]
    .forEach(z=>{const s=S(z.x,z.y);if(s.x>-140&&s.x<NW+140&&s.y>-20&&s.y<NH+20)ctx.fillText(z.t,s.x,s.y);});
    ctx.globalAlpha=1;ctx.restore();

    // ── Mission waypoint: compass arrow + world blip ─────────────────
    {
      const mid=gs.activeMissionId;
      if(mid!==null&&mid!==undefined){
        const m=MISSIONS.find(m=>m.id===mid);
        const step=m?.steps?.[gs.missionStepIdx];
        const poi=POIS.find(p=>p.id===step?.poiId);
        if(poi){
          const tx=poi.x,ty=poi.y;
          const ws=S(tx,ty);
          // World blip — pulsing yellow circle at target
          const pulse=0.5+0.5*Math.sin(gs.frame*0.12);
          ctx.save();
          ctx.strokeStyle=`rgba(255,220,80,${0.5+pulse*0.5})`;
          ctx.lineWidth=2;
          ctx.beginPath();ctx.arc(ws.x,ws.y,14+pulse*6,0,Math.PI*2);ctx.stroke();
          ctx.fillStyle=`rgba(255,220,80,${0.25+pulse*0.2})`;
          ctx.beginPath();ctx.arc(ws.x,ws.y,8,0,Math.PI*2);ctx.fill();
          // Target label
          ctx.fillStyle="rgba(0,0,0,0.7)";ctx.fillRect(ws.x-36,ws.y-36,72,13);
          ctx.fillStyle="#ffe080";ctx.font="bold 8px monospace";ctx.textAlign="center";
          ctx.fillText("▼ "+poi.label,ws.x,ws.y-26);
          ctx.restore();

          // Edge compass arrow (when target is off-screen)
          const margin=48;
          const inView=ws.x>margin&&ws.x<NW-margin&&ws.y>margin&&ws.y<NH-margin;
          if(!inView){
            const angle=Math.atan2(ty-p.y,tx-p.x);
            const ex=NW/2+Math.cos(angle)*Math.min(NW/2-margin,NH/2-margin);
            const ey=NH/2+Math.sin(angle)*Math.min(NW/2-margin,NH/2-margin);
            const dist=Math.hypot(tx-p.x,ty-p.y);
            const distLabel=dist>1000?`${(dist/TS/14).toFixed(1)}blk`:`${Math.round(dist/TS)}t`;
            ctx.save();
            ctx.translate(ex,ey);ctx.rotate(angle+Math.PI/2);
            // Arrow shape
            ctx.fillStyle=`rgba(255,220,80,${0.75+pulse*0.25})`;
            ctx.beginPath();ctx.moveTo(0,-12);ctx.lineTo(7,8);ctx.lineTo(-7,8);ctx.closePath();ctx.fill();
            ctx.strokeStyle="rgba(0,0,0,0.6)";ctx.lineWidth=1.5;ctx.stroke();
            ctx.restore();
            // Distance label next to arrow
            ctx.save();
            ctx.fillStyle="rgba(0,0,0,0.65)";
            const lx=ex+Math.cos(angle)*24,ly=ey+Math.sin(angle)*24;
            ctx.fillRect(lx-20,ly-8,40,13);
            ctx.fillStyle="#ffe080";ctx.font="bold 8px monospace";ctx.textAlign="center";
            ctx.fillText(distLabel,lx,ly+2);
            ctx.restore();
          }
        }
      }
    }

    const SW=20,SH=28;// sprite draw size
    const drawables=[];

    // Cars
    cars.forEach(car=>{
      const s=S(car.cx,car.cy);
      if(s.x<NW+80&&s.x>-80&&s.y<NH+60&&s.y>-60){
        drawables.push({y:car.cy,draw:()=>{
          const spr=carSprites[car.defIdx];
          if(spr){ctx.save();ctx.translate(s.x,s.y);ctx.rotate(car.heading-Math.PI/2);ctx.drawImage(spr,-spr.width/2,-spr.height/2);ctx.restore();}
          if(!p.inCar&&Math.hypot(p.x-car.cx,p.y-car.cy)<44){
            ctx.save();ctx.font="8px monospace";ctx.textAlign="center";ctx.fillStyle="#b49650";
            ctx.fillText("[E] JACK — "+CAR_DEFS[car.defIdx].name,s.x,s.y-(spr?spr.height/2+8:20));ctx.restore();
          }
        }});
      }
    });

    // NPCs
    npcs.forEach(n=>{
      const s=S(n.x,n.y);
      if(s.x>-40&&s.x<NW+40&&s.y>-40&&s.y<NH+20){
        const near=Math.hypot(p.x-n.x,p.y-n.y)<36;
        drawables.push({y:n.y,draw:()=>{
          ctx.save();ctx.globalAlpha=0.32;ctx.fillStyle="#000";
          ctx.beginPath();ctx.ellipse(s.x,s.y+1,7,2.5,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
          const spr=charSprites[n.type];const fi=n.dir*3+n.wf;
          if(spr?.[fi]){
            if(n.isRival){ctx.filter="hue-rotate(330deg) saturate(2)";}
            else if(n.action==="garage"){ctx.filter="hue-rotate(200deg) saturate(1.5)";}
            else if(n.action==="doctor"){ctx.filter="hue-rotate(120deg) saturate(1.5)";}
            ctx.drawImage(spr[fi],s.x-SW/2,s.y-SH,SW,SH);
            ctx.filter="none";
          }
          ctx.restore();
          const nameCol=n.isRival?"#cc3030":n.type==="cop"?"#6688ff":n.type==="boss"?"#b49650":n.action==="garage"?"#60aaff":n.action==="doctor"?"#ff6060":n.aggro?"#e84040":"#aaa";
          ctx.save();ctx.font="7px monospace";ctx.textAlign="center";ctx.fillStyle=nameCol;
          ctx.fillText((n.icon||"")+" "+(n.name||n.type.toUpperCase()),s.x,s.y-SH-3);
          if(near){
            const prompt=n.action==="shop"?"SHOP":n.action==="missions"?"MISSIONS":n.action==="garage"?"GARAGE":n.action==="doctor"?"HEAL ($500)":n.action==="bribe"?"BRIBE ($600)":n.action?.startsWith("travel")?"TRAVEL":n.isRival&&n.aggro?"ENEMY":"TALK";
            ctx.fillStyle="#b49650";ctx.fillText("[E] "+prompt,s.x,s.y-SH-13);
          }
          ctx.restore();
        }});
      }
    });

    // Active cops
    if(gs.activeCops){
      gs.activeCops.forEach(cop=>{
        const s=S(cop.x,cop.y);
        if(s.x>-60&&s.x<NW+60&&s.y>-60&&s.y<NH+30){
          // Cop car
          if(cop.inCar&&cop.copCar){
            const cc=cop.copCar;const cs=S(cc.cx,cc.cy);
            drawables.push({y:cc.cy,draw:()=>{
              const spr=carSprites[0];// use first car sprite, recoloured below
              if(spr){
                ctx.save();ctx.translate(cs.x,cs.y);ctx.rotate(cc.heading-Math.PI/2);
                // Tint blue for cop car
                ctx.filter="hue-rotate(180deg) saturate(2)";
                ctx.drawImage(spr,-spr.width/2,-spr.height/2);
                ctx.filter="none";
                // Flashing lights
                const flash=(gs.frame/8|0)%2===0;
                ctx.fillStyle=flash?"#ff2020":"#2020ff";
                ctx.beginPath();ctx.arc(-8,-spr.height/2-4,4,0,Math.PI*2);ctx.fill();
                ctx.fillStyle=flash?"#2020ff":"#ff2020";
                ctx.beginPath();ctx.arc(8,-spr.height/2-4,4,0,Math.PI*2);ctx.fill();
                if(cop.isSwat){ctx.fillStyle="rgba(0,0,0,0.5)";ctx.fillRect(-spr.width/2,-spr.height/2,spr.width,spr.height);}
                ctx.restore();
              }
            }});
          } else {
            // Cop on foot
            drawables.push({y:cop.y,draw:()=>{
              ctx.save();ctx.globalAlpha=0.3;ctx.fillStyle="#000";
              ctx.beginPath();ctx.ellipse(s.x,s.y+1,7,2.5,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
              const spr=charSprites[cop.isSwat?"thug":"cop"];
              const fi=(cop.dir||0)*3+(cop.wf||0);
              if(spr?.[fi]){
                if(cop.isSwat){ctx.filter="sepia(1) hue-rotate(180deg)";}
                ctx.drawImage(spr[fi],s.x-SW/2,s.y-SH,SW,SH);
                ctx.filter="none";
              }
              // Aggro indicator
              const pulse2=(gs.frame/6|0)%2===0;
              ctx.fillStyle=pulse2?"#ff2020":"#ff6060";
              ctx.beginPath();ctx.arc(s.x,s.y-SH-4,3,0,Math.PI*2);ctx.fill();
              ctx.restore();
            }});
          }
        }
      });
    }

    // Player
    if(!p.inCar){
      const s=S(p.x,p.y);
      const flicker=p.invincible>0&&(gs.frame/3|0)%2===0;
      if(!flicker){
        drawables.push({y:p.y,draw:()=>{
          ctx.save();ctx.globalAlpha=0.35;ctx.fillStyle="#000";
          ctx.beginPath();ctx.ellipse(s.x,s.y+1,7,2.5,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
          const spr=charSprites.player;const fi=p.dir*3+p.walkF;
          if(spr?.[fi])ctx.drawImage(spr[fi],s.x-SW/2,s.y-SH,SW,SH);
          if(p.shootCD>SHOOT_CD-4){
            const offs=[[0,SH*.4],[0,-SH*.7],[-SW*.8,-SH*.3],[SW*.8,-SH*.3]];
            const[fx,fy]=offs[p.dir]||[0,0];
            ctx.globalAlpha=.9;ctx.fillStyle="#ffe080";
            ctx.beginPath();ctx.arc(s.x+fx,s.y-SH/2+fy,6,0,Math.PI*2);ctx.fill();
            ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(s.x+fx,s.y-SH/2+fy,3,0,Math.PI*2);ctx.fill();
          }
          ctx.restore();
        }});
      }
    }
    drawables.sort((a,b)=>a.y-b.y);drawables.forEach(d=>d.draw());

    // Bullets
    bullets.forEach(b=>{const s=S(b.x,b.y);ctx.fillStyle="#ffe080";ctx.beginPath();ctx.arc(s.x,s.y,3,0,Math.PI*2);ctx.fill();ctx.fillStyle="#ff9020";ctx.beginPath();ctx.arc(s.x,s.y,1.5,0,Math.PI*2);ctx.fill();});
    // Particles
    particles.forEach(pt=>{const s=S(pt.x,pt.y);ctx.save();ctx.globalAlpha=Math.min(1,pt.life/18);ctx.fillStyle=pt.col;ctx.fillRect(s.x-pt.sz/2,s.y-pt.sz/2,pt.sz,pt.sz);ctx.restore();});

    // Joystick
    const joy=joyRef.current;
    if(joy.base){ctx.save();ctx.strokeStyle="#b49650";ctx.lineWidth=2;ctx.globalAlpha=.28;ctx.beginPath();ctx.arc(joy.base.x,joy.base.y,46,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=.52;ctx.fillStyle="#b49650";ctx.beginPath();ctx.arc(joy.base.x+joy.vec.x*36,joy.base.y+joy.vec.y*36,20,0,Math.PI*2);ctx.fill();ctx.restore();}

    // ── Day/Night overlay (smooth keyframe lerp) ──────────────────
    {
      const t=gs.timeOfDay;
      const KF=[
        [0.000,  4,  4,18,0.80],[0.083,  6,  5,22,0.82],[0.167,  8,  6,20,0.78],
        [0.208, 30, 15,40,0.62],[0.250, 90, 40,20,0.32],[0.292, 60, 25,10,0.10],
        [0.333,  0,  0, 0,0.00],[0.500,  0,  0, 0,0.00],[0.667,  0,  0, 0,0.00],
        [0.708, 80, 35,10,0.08],[0.750,120, 50,15,0.26],[0.792,100, 25,30,0.44],
        [0.833, 18,  8,32,0.58],[0.875,  6,  5,22,0.72],[0.958,  4,  4,18,0.80],[1.000,4,4,18,0.80],
      ];
      let i=0;while(i<KF.length-2&&t>KF[i+1][0])i++;
      const[t0,r0,g0,b0,a0]=KF[i],[t1,r1,g1,b1,a1]=KF[i+1];
      const k=t1>t0?(t-t0)/(t1-t0):0;
      const r=r0+(r1-r0)*k|0,g=g0+(g1-g0)*k|0,b=b0+(b1-b0)*k|0,a=+(a0+(a1-a0)*k).toFixed(3);
      if(a>0.005){ctx.fillStyle=`rgba(${r},${g},${b},${a})`;ctx.fillRect(0,0,NW,NH);}
      const nightAmt=Math.max(0,a-0.25)/0.55;
      if(nightAmt>0){ctx.fillStyle=`rgba(255,140,20,${(nightAmt*0.055).toFixed(3)})`;ctx.fillRect(0,0,NW,NH);}
      if(r>40&&a>0.04){
        const sg=ctx.createLinearGradient(0,0,0,NH*.45);
        sg.addColorStop(0,`rgba(${r},${g},${b},${(a*.45).toFixed(3)})`);sg.addColorStop(1,"rgba(0,0,0,0)");
        ctx.fillStyle=sg;ctx.fillRect(0,0,NW,NH);
      }
      // Clock
      const h24=t*24|0,mn=(t*24-h24)*60|0,h12=h24%12||12,suf=h24>=12?"PM":"AM";
      const te=document.getElementById("rpg-time");if(te)te.textContent=`${h12}:${String(mn).padStart(2,"0")}${suf}`;
      const icons=["🌙","🌙","🌙","🌙","🌙","🌅","🌅","☀️","☀️","☀️","☀️","☀️","☀️","☀️","☀️","☀️","☀️","🌇","🌇","🌆","🌃","🌃","🌙","🌙"];
      const ie=document.getElementById("rpg-timeicon");if(ie)ie.textContent=icons[h24]||"☀️";
    }

    // Vignette
    {
      const t=gs.timeOfDay,isNight=t>0.7||t<0.25;
      const vs=isNight?.70:.50;
      const vig=ctx.createRadialGradient(NW/2,NH/2,NH*.18,NW/2,NH/2,NH*.82);
      vig.addColorStop(0,"rgba(0,0,0,0)");vig.addColorStop(0.6,"rgba(0,0,0,0.1)");vig.addColorStop(1,`rgba(0,0,0,${vs})`);
      ctx.fillStyle=vig;ctx.fillRect(0,0,NW,NH);
    }
    ctx.fillStyle="rgba(0,0,0,0.04)";for(let y=0;y<NH;y+=2)ctx.fillRect(0,y,NW,1);
    if(gs.frame%3===0){ctx.fillStyle="rgba(255,255,255,0.012)";for(let i=0;i<35;i++)ctx.fillRect(Math.random()*NW|0,Math.random()*NH|0,1,1);}

    // ── Wanted-level screen tint ────────────────────────────────────
    if(p.wanted>=4){
      const pulse=0.5+0.5*Math.sin(gs.frame*0.15);
      ctx.fillStyle=`rgba(180,0,0,${(0.04+pulse*0.04).toFixed(3)})`;
      ctx.fillRect(0,0,NW,NH);
    }
    if(p.wanted===5){
      // SWAT red flash border
      const fp=(gs.frame/12|0)%2===0;
      if(fp){ctx.strokeStyle="rgba(255,0,0,0.6)";ctx.lineWidth=8;ctx.strokeRect(4,4,NW-8,NH-8);}
    }

    // ── Hiding vignette: cool blue darkness ─────────────────────────
    if(gs._isHiding){
      const hf=(gs._hidingFrames||0);const hAlpha=Math.min(0.45,hf/120*0.45);
      const hv=ctx.createRadialGradient(NW/2,NH/2,30,NW/2,NH/2,NH*.6);
      hv.addColorStop(0,"rgba(0,0,0,0)");hv.addColorStop(1,`rgba(0,10,30,${hAlpha})`);
      ctx.fillStyle=hv;ctx.fillRect(0,0,NW,NH);
      // Hiding text
      ctx.save();ctx.globalAlpha=Math.min(1,hf/60)*0.8;
      ctx.fillStyle="#88aaff";ctx.font="bold 9px monospace";ctx.textAlign="center";
      ctx.fillText("🫥 HIDING — heat cooling faster",NW/2,NH-80);
      ctx.restore();
    }

    // ── Wanted level star overlay (top-right near heat bar) ─────────
    // Already in HUD, but show big stars as status flash on star gain
    if(gs._wantedFlash&&gs._wantedFlash>0){
      gs._wantedFlash--;
      const wf2=gs._wantedFlash/30;
      ctx.save();ctx.globalAlpha=wf2;ctx.font="bold 28px monospace";ctx.textAlign="center";
      ctx.fillStyle=p.wanted>=4?"#ff2020":"#e8a040";
      ctx.fillText("★".repeat(p.wanted),NW/2,NH/2-40);
      ctx.restore();
    }

    // Minimap
    const mm=mmRef.current;
    if(mm){
      const mc=mm.getContext("2d");mc.fillStyle="#0a0806";mc.fillRect(0,0,88,88);
      const sc=88/(Math.max(MW,MH)*TS);
      const MC={[T.ROAD]:"#222",[T.WALK]:"#6e5a44",[T.BLDG]:"#5a3820",[T.SPEAKEASY]:"#4a2008",[T.CAPO]:"#c8b070",[T.PARK]:"#2a5010",[T.WATER]:"#1a3a58",[T.DOCK]:"#3a2808",[T.CROSS]:"#1c1c1c"};
      const{map}=gs;
      for(let ty=0;ty<MH;ty+=2)for(let tx=0;tx<MW;tx+=2){mc.fillStyle=MC[map[ty][tx]]||"#111";mc.fillRect(Math.round(tx*TS*sc),Math.round(ty*TS*sc),Math.ceil(2*TS*sc)+1,Math.ceil(2*TS*sc)+1);}
      // POI blips on minimap
      POIS.forEach(poi=>{
        mc.fillStyle=poi.col;
        mc.beginPath();mc.arc(Math.round(poi.x*sc),Math.round(poi.y*sc),3,0,Math.PI*2);mc.fill();
      });
      // Travel portals on minimap
      [{x:57*24,y:56*24,col:"#40c8c8"},{x:57*24,y:2*24,col:"#40c860"},{x:2*24,y:2*24,col:"#c8c040"}].forEach(pt=>{
        mc.fillStyle=pt.col;mc.fillRect(Math.round(pt.x*sc)-2,Math.round(pt.y*sc)-2,5,5);
      });
      // District label on minimap
      mc.fillStyle="#b49650";mc.font="6px monospace";mc.textAlign="left";
      const distName={city:"New Corleone",beach:"Sunset Beach",docks:"Havana Docks",airport:"Airport"}[gs.currentDistrict||"city"]||"";
      mc.fillText(distName,2,7);
      // Active mission target — flashing
      const mmid=gs.activeMissionId;
      if(mmid!==null&&mmid!==undefined){
        const mm2=MISSIONS.find(m=>m.id===mmid);
        const mstep=mm2?.steps?.[gs.missionStepIdx];
        const mpoi=POIS.find(p=>p.id===mstep?.poiId);
        if(mpoi&&(gs.frame/20|0)%2===0){
          mc.fillStyle="#ffe080";mc.strokeStyle="#fff";mc.lineWidth=1;
          mc.beginPath();mc.arc(Math.round(mpoi.x*sc),Math.round(mpoi.y*sc),5,0,Math.PI*2);mc.fill();mc.stroke();
        }
      }
      cars.forEach(c=>{mc.fillStyle="#888";mc.fillRect(Math.round(c.cx*sc),Math.round(c.cy*sc),3,2);});
      npcs.forEach(n=>{mc.fillStyle=n.type==="cop"?"#4488ff":n.type==="boss"?"#b49650":"#666";mc.fillRect(Math.round(n.x*sc),Math.round(n.y*sc),2,2);});
      mc.fillStyle="#fff";mc.fillRect(Math.round(p.x*sc)-1,Math.round(p.y*sc)-1,3,3);
      mc.strokeStyle="rgba(180,150,80,.5)";mc.lineWidth=.5;
      mc.strokeRect(Math.round(camX*sc),Math.round(camY*sc),Math.round(NW*sc),Math.round(NH*sc));
    }
  },[]);

  const loop=useCallback(()=>{update();draw();rafRef.current=requestAnimationFrame(loop);},[update,draw]);

  // Touch
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const xy=(t)=>{const r=canvas.getBoundingClientRect();return{x:(t.clientX-r.left)/r.width*NW,y:(t.clientY-r.top)/r.height*NH};};
    const onTS=(e)=>{e.preventDefault();Array.from(e.changedTouches).forEach(t=>{const{x,y}=xy(t);if(x<NW*.55){if(joyRef.current.id===null)joyRef.current={id:t.identifier,origin:{x,y},vec:{x:0,y:0},base:{x,y}};}else{doShoot();if(y>NH*.6)doInteract();}});};
    const onTM=(e)=>{e.preventDefault();
      const j=joyRef.current;if(j.id==null||!j.origin)return;
      for(let i=0;i<e.touches.length;i++){
        const t=e.touches[i];if(t.identifier!==j.id)continue;
        const{x,y}=xy(t);const o=j.origin;
        let dx=(x-o.x)/54,dy=(y-o.y)/54;const m=Math.hypot(dx,dy);if(m>1){dx/=m;dy/=m;}
        j.vec={x:dx,y:dy};j.base={x:o.x,y:o.y};break;
      }};
    const onTE=(e)=>{e.preventDefault();Array.from(e.changedTouches).forEach(t=>{if(t.identifier===joyRef.current.id)joyRef.current={id:null,origin:null,vec:{x:0,y:0},base:null};});};
    canvas.addEventListener("touchstart",onTS,{passive:false});canvas.addEventListener("touchmove",onTM,{passive:false});
    canvas.addEventListener("touchend",onTE,{passive:false});canvas.addEventListener("touchcancel",onTE,{passive:false});
    return()=>{canvas.removeEventListener("touchstart",onTS);canvas.removeEventListener("touchmove",onTM);canvas.removeEventListener("touchend",onTE);canvas.removeEventListener("touchcancel",onTE);};
  },[doShoot,doInteract]);

  // Keyboard
  useEffect(()=>{
    const kd=(e)=>{
      keysRef.current[e.code]=true;
      if(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code))e.preventDefault();
      if(e.code==="Space")doShoot();
      if(e.code==="KeyE"||e.code==="KeyF")doInteract();
      if(e.code==="KeyQ"){const gs=gsRef.current;if(gs){const p=gs.player;const wi=p.weapons.indexOf(p.weapon);p.weapon=p.weapons[(wi+1)%p.weapons.length];refreshHUD(gs);showMsg("Weapon: "+WEAPONS[p.weapon].name);}}
      if(e.code==="KeyP"){const el=document.getElementById("rpg-phone");if(el){const vis=el.style.display==="flex";el.style.display=vis?"none":"flex";}}
      if(e.code==="KeyR"){toggleRadioRef.current?.();}
      if(e.code==="KeyS"&&(e.ctrlKey||e.metaKey)){e.preventDefault();saveGameRef.current?.();}
    };
    const ku=(e)=>{keysRef.current[e.code]=false;};
    window.addEventListener("keydown",kd);window.addEventListener("keyup",ku);
    return()=>{window.removeEventListener("keydown",kd);window.removeEventListener("keyup",ku);};
  },[doShoot,doInteract]);

  useEffect(()=>{initGame();return()=>cancelAnimationFrame(rafRef.current);},[initGame]);

  const startGame=()=>{
    const gs=gsRef.current;if(!gs)return;gs.started=true;
    document.getElementById("rpg-splash").style.display="none";
    rafRef.current=requestAnimationFrame(loop);
    setTimeout(()=>showMsg("Welcome to New Corleone — find Don Benedetto or Big Eddie for missions"),600);
    refreshHUD(gs);refreshObjective(gs);
  };

  const gs=gsRef.current;

  return(
    <div
      className="
        relative mx-auto w-full max-w-[600px] bg-[#0a0806] rounded-lg overflow-hidden
        max-xl:rounded-none max-xl:w-[min(100%,calc((100dvh-5.75rem)*600/460))]
        max-xl:aspect-[600/460] max-xl:max-w-none
        touch-none select-none
      "
      style={{ touchAction: "none", userSelect: "none" }}
    >
      <canvas
        ref={canvasRef}
        className="block w-full max-xl:absolute max-xl:inset-0 max-xl:h-full xl:h-auto"
        style={{ display: "block", width: "100%", height: "auto", aspectRatio: `${NW} / ${NH}`, imageRendering: "pixelated" }}
      />
      <canvas ref={mmRef} width={88} height={88} className="absolute top-1.5 right-1.5 md:top-2 md:right-2 w-14 h-14 md:w-[88px] md:h-[88px] border border-[#b49650] bg-[#0a0806] rounded" style={{imageRendering:"pixelated"}}/>

      {/* HUD — compact on mobile (emoji/hearts scale with font-size) */}
      <div className="absolute top-1.5 left-1.5 md:top-2 md:left-2 flex flex-wrap gap-1 md:gap-[5px] max-w-[calc(100%-5.5rem)] md:max-w-none">
        {[
          {l:"CASH",  c:<span id="rpg-cash" className="text-[10px] md:text-xs font-bold text-white leading-tight">$2,400</span>},
          {l:"WANTED",c:<><div className="w-[52px] md:w-16 h-1 md:h-[5px] bg-[#111] border border-[#444] mt-0.5 md:mt-0.5"><div id="rpg-heat" className="h-full w-[8%] bg-[#b49650] transition-[width] duration-300"/></div><div id="rpg-stars" className="text-[8px] md:text-[10px] text-[#b49650] mt-0.5 tracking-wide leading-none">☆☆☆☆☆</div></>},
          {l:"HP",    c:<span id="rpg-hp" className="text-[8px] md:text-[10px] text-white leading-none">❤❤❤❤❤</span>},
          {l:"GUN",   c:<span id="rpg-weapon" className="text-[7px] md:text-[9px] text-[#e8d5a0] leading-tight block max-w-[4.5rem] md:max-w-none truncate">🔫Revolver</span>},
          {l:"TIME",  c:<span className="flex items-center gap-0.5 md:gap-[3px]"><span id="rpg-timeicon" className="text-[9px] md:text-[11px] leading-none">☀️</span><span id="rpg-time" className="text-[7px] md:text-[9px] text-[#e8d5a0] leading-tight">9:00AM</span></span>},
        ].map(({l,c})=>(
          <div key={l} className="bg-black/84 border border-[#b49650] px-1 py-0.5 md:px-1.5 md:py-[3px] rounded-sm shrink-0">
            <div className="text-[6px] md:text-[7px] text-[#b49650] tracking-wide mb-px leading-none">{l}</div>{c}
          </div>
        ))}
      </div>

      {/* Message */}
      <div id="rpg-msg" style={{display:"none",position:"absolute",bottom:52,left:"50%",transform:"translateX(-50%)",background:"rgba(0,0,0,0.9)",border:"1px solid #b49650",color:"#e8d5a0",padding:"7px 16px",fontSize:11,textAlign:"center",borderRadius:3,whiteSpace:"nowrap",letterSpacing:.5,pointerEvents:"none",zIndex:5}}/>

      {/* GARAGE OVERLAY */}
      <div id="rpg-garage" style={{display:"none",position:"absolute",inset:0,background:"rgba(0,0,0,0.92)",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:15,padding:16}}>
        <div style={{color:"#60aaff",fontSize:18,letterSpacing:4,fontFamily:"serif",marginBottom:2}}>🔧 VINNIE'S GARAGE</div>
        <div style={{color:"#444",fontSize:8,marginBottom:4,letterSpacing:2}}>REPAIRS · RESPRAY · STORAGE · UPGRADES</div>
        <div id="rpg-garage-car" style={{color:"#888",fontSize:9,marginBottom:14}}>No car</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,width:"100%",maxWidth:380,marginBottom:14}}>
          {GARAGE_SERVICES.map(svc=>(
            <button key={svc.id} onClick={()=>buyGarageService(svc.id)}
              style={{background:"rgba(10,20,40,0.9)",border:"1px solid #60aaff",padding:"10px 12px",borderRadius:4,cursor:"pointer",textAlign:"left",color:"#e8d5a0"}}>
              <div style={{fontSize:11,fontWeight:"bold",color:"#60aaff"}}>{svc.name}</div>
              <div style={{fontSize:9,color:"#888",marginTop:2}}>{svc.desc}</div>
              <div style={{fontSize:11,color:"#e8d5a0",marginTop:4}}>{svc.cost>0?"$"+svc.cost.toLocaleString():"Free"}</div>
            </button>
          ))}
        </div>
        {/* Stored cars */}
        <div style={{width:"100%",maxWidth:380,marginBottom:10}}>
          <div style={{color:"#60aaff",fontSize:9,letterSpacing:1,marginBottom:6}}>STORED CARS</div>
          <div style={{display:"flex",gap:8}}>
            {[0,1,2].map(slot=>{
              const gs2=gsRef.current;
              const stored=gs2?.storedCars?.[slot];
              return(
                <div key={slot} style={{flex:1,background:"rgba(10,20,40,0.8)",border:"1px solid #334",borderRadius:4,padding:"8px",textAlign:"center"}}>
                  {stored!=null?(
                    <>
                      <div style={{color:"#b49650",fontSize:10}}>{CAR_DEFS[stored]?.name||"Car"}</div>
                      <button onClick={()=>{
                        const gs3=gsRef.current;if(!gs3)return;
                        // Retrieve stored car — find nearest matching car on map and give to player
                        const car=gs3.cars.find(c=>c.defIdx===stored&&!c.active);
                        if(car){gs3.player.inCar=true;gs3.player.car=car;car.active=true;car.carSpd=0;car.cx=gs3.player.x+40;car.cy=gs3.player.y;gs3.storedCars.splice(slot,1);showMsg(`${CAR_DEFS[stored].name} retrieved!`);closeGarage();}
                        else showMsg("Car not available — drive one here first.");
                      }} style={{background:"rgba(180,150,80,0.2)",border:"1px solid #b49650",color:"#b49650",padding:"3px 8px",cursor:"pointer",fontSize:8,borderRadius:2,marginTop:4}}>RETRIEVE</button>
                    </>
                  ):(
                    <div style={{color:"#333",fontSize:9}}>Empty</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <button onClick={closeGarage} style={{background:"transparent",border:"1px solid #444",color:"#666",padding:"7px 22px",cursor:"pointer",fontSize:9,letterSpacing:2,borderRadius:3}}>CLOSE</button>
      </div>

      {/* SHOP OVERLAY */}
      <div id="rpg-shop" style={{display:"none",position:"absolute",inset:0,background:"rgba(0,0,0,0.88)",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:15,padding:20}}>
        <div style={{color:"#b49650",fontSize:18,letterSpacing:4,fontFamily:"serif",marginBottom:4}}>SAL'S HARDWARE</div>
        <div style={{color:"#666",fontSize:9,marginBottom:16,letterSpacing:2}}>WEAPONS · SUPPLIES · NO QUESTIONS ASKED</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,width:"100%",maxWidth:360}}>
          {[
            {id:"tommy",   label:"Tommy Gun",  price:"$1,000",desc:"Full auto · 6rnd/s"},
            {id:"shotgun", label:"Shotgun",    price:"$800", desc:"3-pellet spread"},
            {id:"molotov", label:"Molotov",    price:"$200", desc:"Area fire"},
            {id:"health",  label:"Doc's Stash",price:"$300", desc:"Restore 3 HP"},
            {id:"engine",  label:"Engine Upg.",price:"$1,500",desc:"Car speed +15%"},
            {id:"armor",   label:"Armor Plating",price:"$1,200",desc:"Car durability"},
            {id:"tires",   label:"Racing Tires",price:"$900",desc:"Car handling"},
          ].map(item=>(
            <button key={item.id}
              onClick={()=>{const gs=gsRef.current;if(gs)buyItem(gs,item.id);}}
              style={{background:"rgba(20,12,4,0.9)",border:"1px solid #b49650",padding:"10px 12px",borderRadius:4,cursor:"pointer",textAlign:"left",color:"#e8d5a0"}}>
              <div style={{fontSize:11,fontWeight:"bold",color:"#b49650"}}>{item.label}</div>
              <div style={{fontSize:9,color:"#888",marginTop:2}}>{item.desc}</div>
              <div style={{fontSize:11,color:"#e8d5a0",marginTop:4}}>{item.price}</div>
            </button>
          ))}
        </div>
        <button onClick={closeShop} style={{marginTop:16,background:"transparent",border:"1px solid #555",color:"#888",padding:"8px 24px",cursor:"pointer",fontSize:10,letterSpacing:2}}>CLOSE</button>
      </div>

      {/* MISSIONS OVERLAY */}
      <div id="rpg-missions" style={{display:"none",position:"absolute",inset:0,background:"rgba(0,0,0,0.92)",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:15,padding:16,overflowY:"auto"}}>
        <div style={{color:"#b49650",fontSize:18,letterSpacing:4,fontFamily:"serif",marginBottom:2}}>CONSIGLIERE'S LEDGER</div>
        <div style={{color:"#555",fontSize:8,marginBottom:14,letterSpacing:2}}>SELECT A CONTRACT TO ACTIVATE</div>
        <div style={{display:"flex",flexDirection:"column",gap:8,width:"100%",maxWidth:420}}>
          {MISSIONS.map(m=>{
            const gs2=gsRef.current;
            const isActive=gs2?.activeMissionId===m.id;
            const isDone=gs2?.completedMissions?.includes(m.id);
            const respect=gs2?.player?.respect||0;
            const locked=(m.respMin||0)>respect&&!isDone&&!isActive;
            return(
            <div key={m.id} style={{background:"rgba(20,12,4,0.95)",border:`1px solid ${isActive?"#ffe080":isDone?"#4a8a40":locked?"#333":"#b49650"}`,padding:"10px 12px",borderRadius:4,color:"#e8d5a0",opacity:isDone?0.5:locked?0.4:1}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                <div style={{fontSize:11,fontWeight:"bold",color:isActive?"#ffe080":isDone?"#4a8a40":"#b49650"}}>
                  {isDone?"✓ ":isActive?"▶ ":""}{m.name}
                </div>
                <div style={{fontSize:10,color:"#4a8a40",whiteSpace:"nowrap"}}>+${m.reward.toLocaleString()}</div>
              </div>
              <div style={{fontSize:9,color:"#aaa",marginBottom:6}}>{m.desc}</div>
              <div style={{fontSize:8,color:"#666",marginBottom:8,lineHeight:1.6}}>
                {m.steps.map((s,i)=>(
                  <div key={i} style={{color:isActive&&i===gs2?.missionStepIdx?"#ffe080":s.done?"#4a8a40":"#555"}}>
                    {isActive&&i===gs2?.missionStepIdx?"▶ ":s.done?"✓ ":"• "}{s.text}
                    {isActive&&i===gs2?.missionStepIdx&&s.hint&&<span style={{color:"#666",fontStyle:"italic"}}> — {s.hint}</span>}
                  </div>
                ))}
              </div>
              {!isDone&&!isActive&&!locked&&(
                <button onClick={()=>{const gs3=gsRef.current;if(gs3)startMission(gs3,m.id);}}
                  style={{background:"rgba(180,150,80,0.15)",border:"1px solid #b49650",color:"#b49650",padding:"5px 14px",cursor:"pointer",fontSize:9,letterSpacing:1,borderRadius:3}}>
                  ACCEPT CONTRACT
                </button>
              )}
              {locked&&<div style={{fontSize:8,color:"#555"}}>🔒 Requires {m.respMin} Respect (you have {Math.round(respect)})</div>}
              {isActive&&<div style={{fontSize:8,color:"#ffe080"}}>▶ ACTIVE — check the compass arrow for your target</div>}
            </div>
          );})}
        </div>
        <button onClick={closeMissions} style={{marginTop:14,background:"transparent",border:"1px solid #444",color:"#666",padding:"7px 22px",cursor:"pointer",fontSize:9,letterSpacing:2,borderRadius:3}}>CLOSE</button>
      </div>

      {/* Mobile buttons */}
      <div className="absolute bottom-2 right-2 md:bottom-2.5 md:right-2.5 flex flex-col gap-1.5 md:gap-2 pointer-events-auto">
        <button type="button" onPointerDown={e=>{e.preventDefault();doShoot();}} className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-[rgba(160,20,20,0.78)] border-2 border-[#cc4040] text-white text-base md:text-xl cursor-pointer touch-none">🔫</button>
        <button type="button" onPointerDown={e=>{e.preventDefault();doInteract();}} className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-[rgba(150,130,50,0.68)] border-2 border-[#b49650] text-white text-[8px] md:text-[9px] font-bold cursor-pointer touch-none leading-tight">TALK<br/>/CAR</button>
      </div>

      {/* Objective panel */}
      <div className="absolute bottom-[6.5rem] left-1.5 md:bottom-[72px] md:left-2 max-w-[200px] md:max-w-[220px] bg-[rgba(0,0,0,0.78)] border border-[#b4965055] rounded p-1.5 md:p-2.5 pointer-events-none">
        <div className="text-[6px] md:text-[7px] text-[#b49650] tracking-wide mb-0.5 md:mb-[3px]">OBJECTIVE</div>
        <div id="rpg-objective" className="text-[8px] md:text-[9px] text-[#e8d5a0] leading-snug">
          <span className="text-[#555] text-[8px] md:text-[9px]">No active mission</span>
        </div>
      </div>

      {/* Phone button — offset clears minimap (smaller on mobile) */}
      <button type="button" id="rpg-phone-btn" onClick={()=>{const el=document.getElementById("rpg-phone");if(el)el.style.display=el.style.display==="flex"?"none":"flex";}}
        className="absolute top-1.5 right-[4.25rem] md:top-2 md:right-[104px] z-[8] pointer-events-auto bg-[rgba(0,0,0,0.82)] border border-[#b49650] rounded px-1.5 py-0.5 md:px-2 md:py-1 text-[#b49650] text-[8px] md:text-[10px] cursor-pointer">
        📱 PHONE
      </button>

      {/* PHONE MENU OVERLAY */}
      <div id="rpg-phone" style={{display:"none",position:"absolute",inset:0,background:"rgba(0,0,0,0.92)",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:18,padding:16,overflowY:"auto"}}>
        <div style={{color:"#b49650",fontSize:16,letterSpacing:4,fontFamily:"serif",marginBottom:2}}>📱 FAMIGLIA</div>
        <div style={{color:"#444",fontSize:8,marginBottom:14,letterSpacing:2}}>YOUR OPERATIONS</div>

        {/* Respect meter */}
        <div style={{width:"100%",maxWidth:400,marginBottom:14,background:"rgba(20,12,4,0.9)",border:"1px solid #b49650",borderRadius:4,padding:"10px 14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{color:"#b49650",fontSize:10,letterSpacing:1}}>RESPECT</span>
            <span style={{color:"#e8d5a0",fontSize:10}} id="rpg-respect-val">0 / 100</span>
          </div>
          <div style={{height:6,background:"#111",borderRadius:3,border:"1px solid #333"}}>
            <div id="rpg-respect-bar" style={{height:"100%",width:"0%",background:"linear-gradient(90deg,#b49650,#d4af37)",borderRadius:3,transition:"width .5s"}}/>
          </div>
          <div style={{color:"#666",fontSize:8,marginTop:4}}>Earn respect by completing missions · Unlocks better contracts</div>
          <div style={{display:"flex",gap:12,marginTop:8,fontSize:9,color:"#888"}}>
            <span>Missions: <span id="rpg-stat-missions" style={{color:"#b49650"}}>0</span></span>
            <span>Kills: <span id="rpg-stat-kills" style={{color:"#b49650"}}>0</span></span>
            <span>Earned: <span id="rpg-stat-earned" style={{color:"#b49650"}}>$0</span></span>
          </div>
        </div>

        {/* Businesses */}
        <div style={{width:"100%",maxWidth:400,marginBottom:10}}>
          <div style={{color:"#b49650",fontSize:10,letterSpacing:2,marginBottom:8}}>EMPIRE — <span id="rpg-biz-income" style={{color:"#4a8a40",fontSize:9}}>No income yet</span></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            {BUSINESSES.map(biz=>{
              const gs2=gsRef.current;
              const owned=gs2?.player?.businesses?.includes(biz.id);
              const canAfford=(gs2?.player?.cash||0)>=biz.cost;
              return(
                <div key={biz.id} style={{background:"rgba(20,12,4,0.95)",border:`1px solid ${owned?"#4a8a40":"#b49650"}`,padding:"8px 10px",borderRadius:4,opacity:(!owned&&!canAfford)?0.5:1}}>
                  <div style={{fontSize:13,marginBottom:2}}>{biz.icon}</div>
                  <div style={{fontSize:10,color:owned?"#4a8a40":"#b49650",fontWeight:"bold"}}>{biz.name}</div>
                  <div style={{fontSize:8,color:"#888",marginTop:2}}>{biz.desc}</div>
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:6,alignItems:"center"}}>
                    <span style={{fontSize:9,color:"#4a8a40"}}>+${biz.income}/3s</span>
                    {owned
                      ? <span style={{fontSize:8,color:"#4a8a40"}}>✓ OWNED</span>
                      : <button onClick={()=>{
                          const gs3=gsRef.current;if(!gs3)return;
                          const p3=gs3.player;
                          if(p3.cash<biz.cost){showMsg("Not enough cash.");return;}
                          p3.cash-=biz.cost;
                          if(!p3.businesses)p3.businesses=[];
                          p3.businesses.push(biz.id);
                          p3.respect=Math.min(100,(p3.respect||0)+10);
                          showMsg(`${biz.icon} ${biz.name} acquired! +10 Respect`);
                          refreshHUD(gs3);
                        }}
                        style={{background:"rgba(180,150,80,0.15)",border:"1px solid #b49650",color:"#b49650",padding:"3px 8px",cursor:"pointer",fontSize:8,borderRadius:3}}>
                        ${biz.cost.toLocaleString()}
                      </button>
                    }
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Character customisation */}
        <div style={{width:"100%",maxWidth:400,marginBottom:10,background:"rgba(20,12,4,0.9)",border:"1px solid #b49650",borderRadius:4,padding:"10px 14px"}}>
          <div style={{color:"#b49650",fontSize:10,letterSpacing:2,marginBottom:8}}>CHARACTER LOOK</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[
              {label:"Coat",     key:"coatIdx",  cols:COAT_COLS},
              {label:"Hat",      key:"hatIdx",   cols:HAT_COLS},
              {label:"Skin",     key:"faceIdx",  cols:FACE_COLS},
              {label:"Tie",      key:"tieIdx",   cols:TIE_COLS},
            ].map(({label,key,cols})=>(
              <div key={key}>
                <div style={{fontSize:8,color:"#888",marginBottom:4}}>{label}</div>
                <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                  {cols.map((col,i)=>{
                    const gs3=gsRef.current;
                    const active=(gs3?.player?.[key]||0)===i;
                    return(
                      <button key={i} onClick={()=>{
                        const gs4=gsRef.current;if(!gs4)return;
                        gs4.player[key]=i;
                        rebuildPlayerSprite(gs4);
                        showMsg("Look updated!");
                      }}
                        style={{width:18,height:18,background:col,border:active?"2px solid #ffe080":"1px solid #444",borderRadius:2,cursor:"pointer",padding:0}}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Inventory */}
        <div style={{width:"100%",maxWidth:400,marginBottom:10,background:"rgba(20,12,4,0.9)",border:"1px solid #b49650",borderRadius:4,padding:"10px 14px"}}>
          <div style={{color:"#b49650",fontSize:10,letterSpacing:2,marginBottom:6}}>INVENTORY ({Math.min(gsRef.current?.inventory?.length||0,gsRef.current?.maxInventory||5)}/{gsRef.current?.maxInventory||5})</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {(gsRef.current?.inventory||[]).map((item,i)=>(
              <div key={i} style={{background:"rgba(40,30,10,0.9)",border:"1px solid #665520",borderRadius:3,padding:"4px 8px",fontSize:9}}>
                <span style={{color:"#b49650"}}>{item.name}</span>
                <span style={{color:"#4a8a40",marginLeft:6}}>${item.value}</span>
              </div>
            ))}
            {(!gsRef.current?.inventory||gsRef.current.inventory.length===0)&&
              <span style={{color:"#444",fontSize:9}}>Empty — rob civilians to collect goods</span>}
          </div>
          {(gsRef.current?.inventory||[]).length>0&&(
            <div style={{color:"#666",fontSize:8,marginTop:6}}>Sell at Sal the Fence or the Dock Boss</div>
          )}
        </div>

        {/* Gang Territory */}
        <div style={{width:"100%",maxWidth:400,marginBottom:10,background:"rgba(20,12,4,0.9)",border:"1px solid #b49650",borderRadius:4,padding:"10px 14px"}}>
          <div style={{color:"#b49650",fontSize:10,letterSpacing:2,marginBottom:6}}>GANG TERRITORY</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {GANGS.filter(g=>g.id!=="neutral").map(g=>{
              const territory=gsRef.current?.gangTerritory||{};
              const owned=Object.values(territory).filter(v=>v===g.id).length;
              return(
                <div key={g.id} style={{flex:1,minWidth:80,background:"rgba(10,8,4,0.8)",border:`1px solid ${g.col}`,borderRadius:3,padding:"6px 8px"}}>
                  <div style={{fontSize:9,color:g.col,fontWeight:"bold"}}>{g.name}</div>
                  <div style={{fontSize:8,color:"#666",marginTop:2}}>{owned} blocks</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Radio */}
        <div style={{width:"100%",maxWidth:400,marginBottom:10,background:"rgba(20,12,4,0.9)",border:"1px solid #b49650",borderRadius:4,padding:"10px 14px"}}>
          <div style={{color:"#b49650",fontSize:10,letterSpacing:2,marginBottom:8}}>RADIO</div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button id="rpg-radio-btn" onClick={toggleRadio}
              style={{background:"rgba(180,150,80,0.2)",border:"1px solid #b49650",color:"#b49650",padding:"6px 14px",cursor:"pointer",fontSize:10,borderRadius:3}}>
              🎷 OFF
            </button>
            <button onClick={nextStation}
              style={{background:"rgba(60,60,60,0.5)",border:"1px solid #555",color:"#aaa",padding:"6px 12px",cursor:"pointer",fontSize:9,borderRadius:3}}>
              ⏭ NEXT STATION
            </button>
            <span style={{fontSize:8,color:"#666"}}>P to toggle · R for radio</span>
          </div>
          <div style={{color:"#555",fontSize:8,marginTop:6}}>🎷 Hot Jazz FM · 🎸 Delta Blues · 🎺 Swing Station</div>
        </div>

        {/* Save/Load */}
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <button onClick={saveGame} style={{background:"rgba(60,120,60,0.3)",border:"1px solid #4a8a40",color:"#4a8a40",padding:"7px 18px",cursor:"pointer",fontSize:9,borderRadius:3,letterSpacing:1}}>💾 SAVE GAME</button>
          <button onClick={loadGame} style={{background:"rgba(60,60,120,0.3)",border:"1px solid #4060aa",color:"#8090cc",padding:"7px 18px",cursor:"pointer",fontSize:9,borderRadius:3,letterSpacing:1}}>📂 LOAD GAME</button>
        </div>

        <button onClick={()=>{
          const el=document.getElementById("rpg-phone");if(el)el.style.display="none";
          // Refresh respect bar when closing
          const gs5=gsRef.current;if(gs5){
            const p5=gs5.player;
            const rv=document.getElementById("rpg-respect-val");if(rv)rv.textContent=`${p5.respect||0} / 100`;
            const rb=document.getElementById("rpg-respect-bar");if(rb)rb.style.width=`${p5.respect||0}%`;
            const sm=document.getElementById("rpg-stat-missions");if(sm)sm.textContent=p5.missionsComplete||0;
            const sk=document.getElementById("rpg-stat-kills");if(sk)sk.textContent=p5.kills||0;
            const se=document.getElementById("rpg-stat-earned");if(se)se.textContent="$"+(p5.totalEarned||0).toLocaleString();
          }
        }} style={{background:"transparent",border:"1px solid #444",color:"#666",padding:"7px 22px",cursor:"pointer",fontSize:9,letterSpacing:2,borderRadius:3}}>
          CLOSE
        </button>
      </div>

      {/* Controls */}
      <div style={{position:"absolute",bottom:6,left:8,color:"#b4965060",fontSize:8,letterSpacing:1,pointerEvents:"none"}}>
        WASD·MOVE &nbsp;E·INTERACT &nbsp;Q·GUN &nbsp;P·PHONE &nbsp;R·RADIO &nbsp;SPACE·SHOOT
      </div>

      {/* Splash */}
      <div id="rpg-splash" onClick={startGame} style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.93)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",zIndex:20}}>
        <div style={{color:"#b49650",fontSize:28,letterSpacing:8,fontFamily:"serif",marginBottom:6}}>FAMIGLIA</div>
        <div style={{color:"#555",fontSize:10,letterSpacing:4,marginBottom:6}}>NEW CORLEONE · 1928</div>
        <div style={{color:"#444",fontSize:8,letterSpacing:1,marginBottom:24,textAlign:"center",maxWidth:300}}>
          24 Missions · 4 Districts · Gang Rivals · FBI · Garage · Businesses · Wanted System · Day &amp; Night
        </div>
        <div style={{color:"#b49650",fontSize:11,border:"1px solid #b49650",padding:"10px 26px",letterSpacing:3}}>TAP TO ENTER</div>
        <div style={{color:"#333",fontSize:8,marginTop:16,letterSpacing:.8,textAlign:"center",padding:"0 28px"}}>
          WASD/D-PAD · MOVE &nbsp;·&nbsp; E · INTERACT &nbsp;·&nbsp; Q · SWITCH WEAPON &nbsp;·&nbsp; SPACE/🔫 · SHOOT
        </div>
      </div>
    </div>
  );
}

export default function Famiglia(){
  const [leaderboard,setLeaderboard]=useState([]);
  const [loadingLb,setLoadingLb]=useState(false);
  const fetchLeaderboard=useCallback(async()=>{
    setLoadingLb(true);
    try{
      const res=await api.get("/mafia-rpg/leaderboard");
      setLeaderboard(res.data?.leaderboard||[]);
    }catch(_e){
      toast.error("Could not load Famiglia leaderboard");
    }finally{
      setLoadingLb(false);
    }
  },[]);
  useEffect(()=>{fetchLeaderboard();},[fetchLeaderboard]);

  return(
    <div
      className={`
        ${styles.pageContent} mobile-page-root space-y-3
        max-xl:space-y-2
        max-xl:w-[100dvw] max-xl:max-w-[100dvw] max-xl:box-border
        max-xl:relative max-xl:left-1/2 max-xl:-translate-x-1/2
        max-xl:px-2 max-xl:pt-1
        max-xl:pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]
        xl:w-full xl:left-0 xl:translate-x-0 xl:max-w-none xl:px-0
      `}
    >
      <header className="flex items-center gap-2 mb-1 max-xl:mb-0 max-xl:min-h-0">
        <Link to="/casino/mini-games/leaderboard" className="p-1 rounded hover:bg-primary/10 transition-colors shrink-0" title="Mini games leaderboard">
          <ArrowLeft size={16} className="text-primary" />
        </Link>
        <h1 className="text-xs max-xl:text-[11px] font-heading font-bold text-primary uppercase tracking-wider truncate">Famiglia</h1>
      </header>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-2 max-xl:gap-2 xl:gap-3">
        <div className="xl:col-span-2 flex justify-center w-full min-w-0">
          <FamigliaGameInner />
        </div>
        <div className="space-y-2 max-xl:space-y-2 xl:space-y-3 max-xl:px-0">
          <section className={`${styles.panel} mobile-panel rounded-lg overflow-hidden`}>
            <div className="px-3 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy size={14} className="text-primary shrink-0" />
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Top 10</h2>
              </div>
              <button type="button" onClick={()=>fetchLeaderboard()} disabled={loadingLb} className="p-1 rounded hover:bg-primary/10">
                <RefreshCw size={12} className={`text-primary ${loadingLb?"animate-spin":""}`} />
              </button>
            </div>
            <div className="p-2 space-y-1 max-h-[200px] sm:max-h-[240px] md:max-h-[280px] xl:max-h-[360px] overflow-y-auto">
              {leaderboard.length===0?(
                <p className="text-[10px] text-mutedForeground italic py-4 text-center font-heading">No scores yet</p>
              ):(
                leaderboard.map((entry,i)=>(
                  <div key={entry.user_id+"-"+i} className={`flex items-center gap-2 p-2 rounded-sm border ${
                    entry.is_me?"bg-primary/15 border-primary/40":`${styles.surfaceMuted} border-primary/10`
                  }`}>
                    <div className={`w-6 h-6 flex items-center justify-center rounded-sm font-heading font-bold text-xs ${
                      i===0?"bg-yellow-500/20 text-yellow-500":
                      i===1?"bg-zinc-400/20 text-zinc-400":
                      i===2?"bg-amber-600/20 text-amber-500":
                      "bg-primary/10 text-mutedForeground"
                    }`}>{i+1}</div>
                    <div className="flex-1 min-w-0">
                      <Link to={`/profile/${encodeURIComponent(entry.username)}`} className="font-heading text-xs text-foreground hover:text-primary truncate block">
                        {entry.username}{entry.is_me&&<span className="text-primary text-[9px]"> (You)</span>}
                      </Link>
                      <div className="text-[8px] text-zinc-500 font-heading">R {entry.respect} · M {entry.missions_complete} · ${Number(entry.total_earned||0).toLocaleString()}</div>
                    </div>
                    <div className="text-xs font-heading text-primary font-bold">{Number(entry.score||0).toLocaleString()}</div>
                  </div>
                ))
              )}
            </div>
          </section>
          <section className={`${styles.panel} mobile-panel rounded-lg p-2.5 max-xl:p-2 xl:p-3`}>
            <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider mb-1 xl:mb-2">Leaderboard</h3>
            <p className="text-[8px] max-xl:text-[8px] xl:text-[10px] text-mutedForeground font-heading leading-snug">
              Complete missions or save your game to sync stats (rate-limited). Score combines respect, missions finished, and career earnings. Earns weekly mini-game points and a small cash bonus.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
