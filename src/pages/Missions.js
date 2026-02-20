import { useState, useEffect } from 'react';
import { Map, X, Star, Lock } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';

const STYLES = `
  @keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .fade { animation: fade 0.25s ease-out both; }
  @keyframes glow { 0%, 100% { filter: drop-shadow(0 0 4px rgba(212,175,55,0.2)); } 50% { filter: drop-shadow(0 0 8px rgba(212,175,55,0.35)); } }
  .glow { animation: glow 3s ease-in-out infinite; }
`;

const fmt = (n) => `$${Number(n ?? 0).toLocaleString()}`;

/* ULTRA-REALISTIC CITY MAPS */
const MAPS = {
  Chicago: {
    vb: { w: 400, h: 600 },
    lakePath: 'M 280,0 L 320,0 L 320,600 L 280,600 L 280,550 L 265,480 L 270,400 L 280,320 L 285,240 L 280,160 L 275,80 Z',
    districts: [
      { name: 'The Loop', path: 'M 160,300 L 230,300 L 230,350 L 160,350 Z', lbl: { x: 195, y: 325 } },
      { name: 'South Side', path: 'M 140,350 L 265,350 L 265,530 L 140,550 L 120,480 Z', lbl: { x: 190, y: 440 } },
      { name: 'West Side', path: 'M 40,240 L 160,240 L 160,400 L 50,410 Z', lbl: { x: 105, y: 325 } },
      { name: 'North Side', path: 'M 180,100 L 280,80 L 280,300 L 160,300 Z', lbl: { x: 220, y: 200 } },
      { name: 'Near North', path: 'M 230,220 L 285,210 L 285,300 L 230,300 Z', lbl: { x: 257, y: 255 } },
      { name: 'Stockyards', path: 'M 50,410 L 140,400 L 140,520 L 60,530 Z', lbl: { x: 100, y: 465 } }
    ]
  },
  'New York': {
    vb: { w: 450, h: 650 },
    hudsonPath: 'M 120,0 L 135,180 L 140,360 L 135,500 L 125,650',
    eastPath: 'M 240,0 L 245,180 L 250,360 L 255,500 L 260,650',
    districts: [
      { name: 'Financial District', path: 'M 135,530 L 180,530 L 190,580 L 170,605 L 135,590 Z', lbl: { x: 162, y: 570 } },
      { name: 'Chinatown', path: 'M 135,490 L 190,490 L 190,530 L 135,530 Z', lbl: { x: 162, y: 510 } },
      { name: 'Greenwich Village', path: 'M 135,445 L 200,445 L 200,490 L 135,490 Z', lbl: { x: 167, y: 467 } },
      { name: 'Midtown', path: 'M 140,360 L 210,360 L 210,445 L 135,445 Z', lbl: { x: 172, y: 402 } },
      { name: 'Upper West Side', path: 'M 135,270 L 185,270 L 185,360 L 140,360 Z', lbl: { x: 160, y: 315 } },
      { name: 'Upper East Side', path: 'M 185,270 L 235,270 L 235,360 L 185,360 Z', lbl: { x: 210, y: 315 } },
      { name: 'Harlem', path: 'M 135,180 L 245,180 L 245,270 L 135,270 Z', lbl: { x: 190, y: 225 } },
      { name: 'Bronx', path: 'M 140,70 L 260,70 L 265,160 L 245,180 L 135,180 Z', lbl: { x: 200, y: 125 } },
      { name: 'Brooklyn Heights', path: 'M 200,445 L 285,435 L 295,530 L 190,530 Z', lbl: { x: 247, y: 487 } },
      { name: 'Williamsburg', path: 'M 210,360 L 315,350 L 315,435 L 285,435 L 200,445 Z', lbl: { x: 262, y: 397 } },
      { name: 'Queens', path: 'M 235,180 L 385,170 L 395,350 L 315,350 L 210,360 Z', lbl: { x: 305, y: 265 } },
      { name: 'Staten Island', path: 'M 30,470 L 95,460 L 105,570 L 50,580 Z', lbl: { x: 67, y: 520 } }
    ]
  },
  'Las Vegas': {
    vb: { w: 350, h: 500 },
    mountainPath: 'M 0,100 L 70,85 L 110,120 L 0,135 M 330,70 L 350,120 L 330,170',
    districts: [
      { name: 'The Strip', path: 'M 145,180 L 205,180 L 205,380 L 145,380 Z', lbl: { x: 175, y: 280 } },
      { name: 'Downtown', path: 'M 135,85 L 215,85 L 215,180 L 145,180 Z', lbl: { x: 175, y: 132 } },
      { name: 'Paradise', path: 'M 205,180 L 295,170 L 305,380 L 205,380 Z', lbl: { x: 255, y: 280 } },
      { name: 'Summerlin', path: 'M 35,150 L 145,160 L 145,330 L 45,320 Z', lbl: { x: 95, y: 245 } },
      { name: 'Henderson', path: 'M 205,380 L 305,380 L 315,465 L 195,465 Z', lbl: { x: 255, y: 422 } },
      { name: 'North Las Vegas', path: 'M 110,35 L 240,35 L 230,85 L 215,85 L 135,85 Z', lbl: { x: 175, y: 60 } },
      { name: 'Arts District', path: 'M 45,160 L 145,160 L 145,240 L 55,235 Z', lbl: { x: 100, y: 200 } },
      { name: 'Boulder Strip', path: 'M 295,90 L 330,90 L 340,170 L 295,170 Z', lbl: { x: 317, y: 130 } }
    ]
  },
  'Atlantic City': {
    vb: { w: 350, h: 450 },
    oceanPath: 'M 270,0 L 290,90 L 310,180 L 330,270 L 350,360 L 350,450',
    districts: [
      { name: 'Boardwalk', path: 'M 70,85 L 290,70 L 310,180 L 90,195 Z', lbl: { x: 190, y: 132 } },
      { name: 'Marina District', path: 'M 90,195 L 310,180 L 330,315 L 110,330 Z', lbl: { x: 220, y: 252 } },
      { name: 'Inlet', path: 'M 70,330 L 220,320 L 220,400 L 90,410 Z', lbl: { x: 145, y: 365 } },
      { name: 'Chelsea', path: 'M 220,320 L 330,315 L 340,400 L 220,400 Z', lbl: { x: 280, y: 360 } }
    ]
  }
};

/* Modal */
function Modal({ city, dist, missions, onClose, onStart, starting }) {
  if (!dist) return null;
  const list = missions.filter(m => m.area === dist);
  const prim = list.find(m => !m.completed) || list[0];
  const stars = prim?.difficulty >= 8 ? 3 : prim?.difficulty >= 5 ? 2 : 1;
  const can = prim && !prim.completed && prim.requirements_met;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/90" onClick={onClose}>
      <div className="w-full sm:max-w-md sm:rounded-xl rounded-t-2xl border-2 border-primary/40 bg-zinc-900 shadow-2xl fade" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '80vh' }}>
        <div className="relative px-3 py-2.5 bg-primary/10 border-b border-primary/20">
          <button onClick={onClose} className="absolute top-2 right-2 p-1 rounded hover:bg-zinc-800 text-zinc-400">
            <X size={16} />
          </button>
          <h3 className="text-sm font-heading font-bold text-primary pr-7">{dist}</h3>
          <p className="text-[8px] text-zinc-400 font-heading uppercase">{city}</p>
        </div>

        <div className="px-3 py-2.5 space-y-1.5 max-h-[40vh] overflow-y-auto">
          {list.map(m => (
            <div key={m.id} className={`p-2 rounded border text-[9px] ${m.completed ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-zinc-800/60 border-zinc-700/50'}`}>
              <div className="flex gap-1.5">
                {m.completed ? (
                  <div className="shrink-0 w-3.5 h-3.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                    <svg className="w-2 h-2 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <div className="shrink-0 w-3.5 h-3.5 rounded-full bg-zinc-700/50 border border-zinc-600/50" />
                )}
                <span className={`font-heading font-medium ${m.completed ? 'text-emerald-400' : 'text-foreground'}`}>{m.title}</span>
              </div>
            </div>
          ))}
        </div>

        {prim && (
          <div className="px-3 py-2 border-t border-zinc-700/50 bg-zinc-900/50 space-y-1">
            {prim.reward_money > 0 && (
              <div className="flex justify-between text-[9px] font-heading">
                <span className="text-zinc-400">Bank Profit</span>
                <span className="text-emerald-400 font-bold">{fmt(prim.reward_money)}</span>
              </div>
            )}
            <div className="flex justify-between text-[9px] font-heading">
              <span className="text-zinc-400">Difficulty</span>
              <div className="flex gap-0.5">
                {[...Array(3)].map((_, i) => (
                  <Star key={i} size={10} className={i < stars ? 'fill-primary text-primary' : 'text-zinc-600'} />
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="px-3 py-2.5 border-t border-zinc-700/50">
          {prim?.completed ? (
            <div className="text-center py-1 text-emerald-400 font-heading text-[10px] flex items-center justify-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Complete
            </div>
          ) : can ? (
            <button
              onClick={() => onStart(prim.id)}
              disabled={starting}
              className="w-full py-2 rounded-lg bg-gradient-to-b from-primary to-primary/80 text-zinc-900 font-heading font-bold text-[10px] uppercase tracking-wide hover:from-primary/90 disabled:opacity-50 transition-all active:scale-95"
            >
              {starting ? '...' : 'Start Mission'}
            </button>
          ) : (
            <div className="text-center py-1 text-zinc-500 font-heading text-[9px] flex items-center justify-center gap-1">
              <Lock size={12} /> Locked
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* City Map */
function CityMap({ city, missions, onClick }) {
  const map = MAPS[city];
  if (!map) return null;

  const stats = (dist) => {
    const list = missions.filter(m => m.area === dist);
    return { done: list.filter(m => m.completed).length, total: list.length };
  };

  const fill = (dist) => {
    const { done, total } = stats(dist);
    if (!total) return 'url(#none)';
    if (done === total) return 'url(#done)';
    if (done > 0) return 'url(#prog)';
    return 'url(#avail)';
  };

  return (
    <svg viewBox={`0 0 ${map.vb.w} ${map.vb.h}`} className="w-full glow" style={{ maxHeight: 500 }}>
      <defs>
        <linearGradient id="done" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#16a34a" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="prog" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#eab308" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#ca8a04" stopOpacity="0.75" />
        </linearGradient>
        <linearGradient id="avail" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#52525b" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#3f3f46" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id="none" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#27272a" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#18181b" stopOpacity="0.4" />
        </linearGradient>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#3f3f46" strokeWidth="0.3" opacity="0.15" />
        </pattern>
      </defs>

      <rect width={map.vb.w} height={map.vb.h} fill="#0a0a0a" />
      <rect width={map.vb.w} height={map.vb.h} fill="url(#grid)" />

      {map.lakePath && <path d={map.lakePath} fill="#1e3a5f" fillOpacity="0.3" stroke="#2563eb" strokeWidth="1" strokeOpacity="0.2" />}
      {map.hudsonPath && <path d={map.hudsonPath} fill="none" stroke="#2563eb" strokeWidth="2" opacity="0.2" />}
      {map.eastPath && <path d={map.eastPath} fill="none" stroke="#2563eb" strokeWidth="2" opacity="0.2" />}
      {map.oceanPath && <path d={map.oceanPath} fill="none" stroke="#2563eb" strokeWidth="3" opacity="0.25" />}
      {map.mountainPath && <path d={map.mountainPath} fill="none" stroke="#52525b" strokeWidth="1.5" opacity="0.15" />}

      {map.districts.map(d => {
        const st = stats(d.name);
        return (
          <g key={d.name}>
            <path
              d={d.path}
              fill={fill(d.name)}
              stroke="#71717a"
              strokeWidth="1.5"
              className="cursor-pointer transition-all duration-200 hover:opacity-80"
              onClick={() => onClick(d.name)}
              role="button"
              tabIndex={0}
            />
            <text
              x={d.lbl.x} y={d.lbl.y - 6}
              textAnchor="middle"
              fill="#fafafa"
              className="font-heading font-bold pointer-events-none select-none"
              style={{ fontSize: 11, textShadow: '0 1px 3px #000' }}
            >
              {d.name}
            </text>
            {st.total > 0 && (
              <text
                x={d.lbl.x} y={d.lbl.y + 8}
                textAnchor="middle"
                fill={st.done === st.total ? '#22c55e' : st.done > 0 ? '#eab308' : '#a1a1aa'}
                className="font-heading font-bold pointer-events-none select-none"
                style={{ fontSize: 10, textShadow: '0 1px 2px #000' }}
              >
                {st.done}/{st.total}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* Main */
export default function Missions() {
  const [data, setData] = useState(null);
  const [missions, setMissions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState(null);
  const [dist, setDist] = useState(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const [m, d] = await Promise.all([api.get('/missions/map'), api.get('/missions')]);
        if (!cancel) {
          setData(m.data);
          setMissions(d.data);
          setCity(m.data?.current_city || m.data?.unlocked_cities?.[0] || 'Chicago');
        }
      } catch (e) {
        if (!cancel) toast.error('Failed to load');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  const start = async (id) => {
    setStarting(true);
    try {
      const r = await api.post('/missions/complete', { mission_id: id });
      if (r.data?.completed) {
        toast.success(r.data.unlocked_city ? `${r.data.unlocked_city} unlocked!` : 'Complete!');
        refreshUser();
        const [m, d] = await Promise.all([api.get('/missions/map'), api.get('/missions')]);
        setData(m.data);
        setMissions(d.data);
        if (r.data.unlocked_city) {
          setCity(r.data.unlocked_city);
          setDist(null);
        }
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setStarting(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-zinc-950 px-2 sm:px-3 py-4 flex items-center justify-center">
        <style>{STYLES}</style>
        <div className="flex flex-col items-center gap-2">
          <Map size={28} className="text-primary animate-pulse" />
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const unlocked = data?.unlocked_cities?.length ? data.unlocked_cities : ['Chicago'];
  const byCity = data?.by_city || {};
  const cityMissions = (city && byCity[city]?.missions) || [];
  const distCount = MAPS[city]?.districts?.length || 0;

  return (
    <div className="min-h-screen bg-zinc-950 px-2 sm:px-3 py-3 sm:py-4">
      <style>{STYLES}</style>
      
      <div className="mb-3 fade">
        <h1 className="text-lg sm:text-xl font-heading font-bold text-foreground mb-1">Welcome to America</h1>
        <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading">Expand your empire, district by district.</p>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3 fade" style={{ animationDelay: '0.1s' }}>
        {unlocked.map(c => (
          <button
            key={c}
            onClick={() => setCity(c)}
            className={`px-2.5 py-1.5 rounded text-[10px] font-heading font-bold border transition-all active:scale-95 ${
              city === c
                ? 'bg-gradient-to-b from-primary to-primary/80 text-zinc-900 border-primary'
                : 'bg-zinc-800/60 text-foreground border-zinc-700 hover:bg-zinc-700/60'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {city && (
        <div className="rounded-lg border-2 border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90 p-2.5 sm:p-3 mb-3 fade" style={{ animationDelay: '0.2s' }}>
          <div className="mb-2">
            <h2 className="text-xs sm:text-sm font-heading font-bold text-primary">{city}</h2>
            <p className="text-[8px] sm:text-[9px] text-zinc-400 font-heading">{distCount} Districts</p>
          </div>
          <CityMap city={city} missions={cityMissions} onClick={setDist} />
        </div>
      )}

      <div className="rounded-lg border border-zinc-700/50 bg-gradient-to-br from-zinc-800/50 to-zinc-900/50 p-2.5 sm:p-3 mb-3 fade" style={{ animationDelay: '0.3s' }}>
        <h3 className="text-xs font-heading font-bold text-primary mb-1.5">Mission Guide</h3>
        <p className="text-[9px] text-zinc-400 font-heading leading-relaxed">
          Complete missions in each district to earn daily empire income. Click districts on the map to view objectives and rewards.
        </p>
      </div>

      {dist && <Modal city={city} dist={dist} missions={cityMissions} onClose={() => setDist(null)} onStart={start} starting={starting} />}
    </div>
  );
}
