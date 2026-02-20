import { useState, useEffect } from 'react';
import { Map, CheckCircle2, Circle, User, MessageCircle, X, MapPin, Navigation, ZoomIn, ZoomOut } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';

const MISSION_STYLES = `
  @keyframes mission-fade-in { 
    from { opacity: 0; transform: translateY(10px); } 
    to { opacity: 1; transform: translateY(0); } 
  }
  .mission-fade-in { animation: mission-fade-in 0.4s ease-out both; }
  
  @keyframes pulse-map {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }
  .pulse-map { animation: pulse-map 2s ease-in-out infinite; }
  
  @keyframes map-glow {
    0%, 100% { 
      filter: drop-shadow(0 0 12px rgba(212, 175, 55, 0.4));
    }
    50% { 
      filter: drop-shadow(0 0 24px rgba(212, 175, 55, 0.6));
    }
  }
  .map-glow { animation: map-glow 3s ease-in-out infinite; }
  
  @keyframes smoke-drift {
    0% { transform: translateY(0) translateX(0) scale(1); opacity: 0.1; }
    50% { transform: translateY(-100px) translateX(20px) scale(1.5); opacity: 0.05; }
    100% { transform: translateY(-200px) translateX(-10px) scale(2); opacity: 0; }
  }
  
  .smoke { animation: smoke-drift 8s ease-out infinite; }
  
  @keyframes territory-pulse {
    0%, 100% { opacity: 0.8; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.02); }
  }
  
  .territory-selected { animation: territory-pulse 2s ease-in-out infinite; }
`;

/* ═══════════════════════════════════════════════════════
   Helper Functions
   ═══════════════════════════════════════════════════════ */
function formatReward(money, points) {
  const parts = [];
  if (money) parts.push(`$${Number(money).toLocaleString()}`);
  if (points) parts.push(`${Number(points).toLocaleString()} RP`);
  return parts.length ? parts.join(' · ') : '—';
}

/* ═══════════════════════════════════════════════════════
   USA Map Regions (Simplified territories for cities)
   ═══════════════════════════════════════════════════════ */
const USA_MAP = {
  viewBox: { w: 960, h: 600 },
  territories: [
    {
      city: 'Chicago',
      // Illinois/Midwest region
      path: 'M 520,200 L 580,200 L 590,240 L 580,280 L 540,290 L 510,270 Z',
      label: { x: 550, y: 245 },
      pin: { x: 555, y: 240 }
    },
    {
      city: 'New York',
      // Northeast region  
      path: 'M 720,140 L 780,150 L 790,180 L 780,210 L 740,220 L 710,200 Z',
      label: { x: 750, y: 180 },
      pin: { x: 755, y: 175 }
    },
    {
      city: 'Las Vegas',
      // Nevada/Southwest
      path: 'M 180,280 L 240,270 L 260,310 L 250,350 L 200,360 L 170,330 Z',
      label: { x: 220, y: 315 },
      pin: { x: 225, y: 310 }
    },
    {
      city: 'Atlantic City',
      // New Jersey coast
      path: 'M 780,180 L 820,185 L 830,210 L 820,235 L 780,240 L 770,215 Z',
      label: { x: 800, y: 210 },
      pin: { x: 805, y: 205 }
    }
  ]
};

/* ═══════════════════════════════════════════════════════
   City Map Regions (District level)
   ═══════════════════════════════════════════════════════ */
const MAP_VIEWBOX = { w: 400, h: 260 };

const cityMapRegions = {
  Chicago: [
    { area: 'Docks', points: '0,0 110,0 110,260 0,260', label: { x: 55, y: 130 } },
    { area: 'South Side', points: '110,180 400,180 400,260 110,260', label: { x: 255, y: 220 } },
    { area: 'Downtown', points: '110,0 400,0 400,180 110,180', label: { x: 255, y: 90 } },
  ],
  'New York': [
    { area: 'Waterfront', points: '0,160 400,160 400,260 0,260', label: { x: 200, y: 210 } },
    { area: 'Downtown', points: '0,0 200,0 200,80 0,80', label: { x: 100, y: 40 } },
    { area: 'Courthouse', points: '200,0 400,0 400,160 200,160', label: { x: 300, y: 80 } },
    { area: 'Garage', points: '0,80 200,80 200,160 0,160', label: { x: 100, y: 120 } },
  ],
  'Las Vegas': [
    { area: 'Desert', points: '0,0 140,0 140,260 0,260', label: { x: 70, y: 130 } },
    { area: 'Card room', points: '140,0 260,0 260,260 140,260', label: { x: 200, y: 130 } },
    { area: 'Downtown', points: '260,0 400,0 400,260 260,260', label: { x: 330, y: 130 } },
  ],
  'Atlantic City': [
    { area: 'Boardwalk', points: '0,0 400,0 400,110 0,110', label: { x: 200, y: 55 } },
    { area: 'Docks', points: '0,110 400,110 400,260 0,260', label: { x: 200, y: 185 } },
  ],
};

/* ═══════════════════════════════════════════════════════
   Loading Spinner
   ═══════════════════════════════════════════════════════ */
const LoadingSpinner = () => (
  <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3">
    <Map size={32} className="text-primary animate-pulse" />
    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    <span className="text-primary text-[9px] sm:text-[10px] font-heading uppercase tracking-wider">Loading territories...</span>
  </div>
);

/* ═══════════════════════════════════════════════════════
   USA Territory Map (Main Overview)
   ═══════════════════════════════════════════════════════ */
function USATerritoryMap({ unlockedCities, currentCity, onSelectCity, cityStats }) {
  const getTerritoryFill = (city) => {
    if (!unlockedCities.includes(city)) return 'url(#lockedGradient)';
    const stats = cityStats[city];
    if (!stats) return 'url(#unlockedGradient)';
    const { done, total } = stats;
    if (total > 0 && done === total) return 'url(#completedGradient)';
    if (done > 0) return 'url(#inProgressGradient)';
    return 'url(#unlockedGradient)';
  };

  const getTerritoryStroke = (city) => {
    if (currentCity === city) return '#d4af37';
    if (!unlockedCities.includes(city)) return '#3f3f46';
    return '#71717a';
  };

  return (
    <div className="relative w-full">
      {/* Atmospheric background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-10 left-20 w-40 h-40 bg-primary/5 rounded-full blur-3xl smoke" style={{ animationDelay: '0s' }} />
        <div className="absolute top-40 right-32 w-32 h-32 bg-primary/5 rounded-full blur-3xl smoke" style={{ animationDelay: '2s' }} />
        <div className="absolute bottom-20 left-1/3 w-36 h-36 bg-primary/5 rounded-full blur-3xl smoke" style={{ animationDelay: '4s' }} />
      </div>

      <svg
        viewBox={`0 0 ${USA_MAP.viewBox.w} ${USA_MAP.viewBox.h}`}
        className="w-full relative z-10"
        style={{ minHeight: 300, maxHeight: 600 }}
        aria-label="USA Territory Map"
      >
        {/* Gradients */}
        <defs>
          <linearGradient id="lockedGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#27272a" />
            <stop offset="100%" stopColor="#18181b" />
          </linearGradient>
          <linearGradient id="unlockedGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#52525b" />
            <stop offset="100%" stopColor="#3f3f46" />
          </linearGradient>
          <linearGradient id="inProgressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#eab308" />
            <stop offset="100%" stopColor="#ca8a04" />
          </linearGradient>
          <linearGradient id="completedGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#16a34a" />
          </linearGradient>
          
          {/* Glow filters */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {/* Territory shapes */}
        {USA_MAP.territories.map(({ city, path, label, pin }) => {
          const isUnlocked = unlockedCities.includes(city);
          const isSelected = currentCity === city;
          const stats = cityStats[city];
          
          return (
            <g key={city}>
              {/* Territory area */}
              <path
                d={path}
                fill={getTerritoryFill(city)}
                stroke={getTerritoryStroke(city)}
                strokeWidth={isSelected ? 3 : 2}
                className={`cursor-pointer transition-all duration-300 ${isSelected ? 'territory-selected' : ''} ${isUnlocked ? 'hover:opacity-80' : ''}`}
                style={{
                  opacity: isUnlocked ? 1 : 0.4,
                  filter: isSelected ? 'url(#glow)' : 'none'
                }}
                onClick={() => isUnlocked && onSelectCity(city)}
                onKeyDown={(e) => {
                  if (isUnlocked && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onSelectCity(city);
                  }
                }}
                role="button"
                tabIndex={isUnlocked ? 0 : -1}
                aria-label={`${city} — ${isUnlocked ? 'unlocked' : 'locked'} — ${stats ? `${stats.done}/${stats.total} missions complete` : 'click to view'}`}
              />
              
              {/* Location pin */}
              {isUnlocked && (
                <g>
                  <circle
                    cx={pin.x}
                    cy={pin.y}
                    r={isSelected ? 8 : 6}
                    fill="#d4af37"
                    stroke="#1a1a1a"
                    strokeWidth="2"
                    className={isSelected ? 'pulse-map' : ''}
                  />
                  <circle
                    cx={pin.x}
                    cy={pin.y}
                    r={3}
                    fill="#1a1a1a"
                  />
                </g>
              )}
              
              {/* City label */}
              <text
                x={label.x}
                y={label.y}
                textAnchor="middle"
                fill={isUnlocked ? '#fafafa' : '#52525b'}
                className="font-heading font-bold pointer-events-none select-none"
                style={{ 
                  fontSize: isSelected ? 18 : 16,
                  textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                  fontWeight: isSelected ? 'bold' : 'normal'
                }}
              >
                {city}
              </text>
              
              {/* Mission count */}
              {stats && isUnlocked && (
                <text
                  x={label.x}
                  y={label.y + 18}
                  textAnchor="middle"
                  fill={stats.done === stats.total ? '#22c55e' : stats.done > 0 ? '#eab308' : '#a1a1aa'}
                  className="font-heading font-bold pointer-events-none select-none"
                  style={{ fontSize: 12, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
                >
                  {stats.done}/{stats.total}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="absolute top-3 right-3 bg-zinc-900/95 border border-zinc-700 rounded-lg p-2.5 text-[9px] sm:text-[10px] font-heading backdrop-blur-sm">
        <div className="flex items-center gap-1.5 mb-1">
          <div className="w-3 h-3 rounded" style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' }} />
          <span className="text-zinc-300">Complete</span>
        </div>
        <div className="flex items-center gap-1.5 mb-1">
          <div className="w-3 h-3 rounded" style={{ background: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)' }} />
          <span className="text-zinc-300">In Progress</span>
        </div>
        <div className="flex items-center gap-1.5 mb-1">
          <div className="w-3 h-3 rounded" style={{ background: 'linear-gradient(135deg, #52525b 0%, #3f3f46 100%)' }} />
          <span className="text-zinc-300">Available</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: 'linear-gradient(135deg, #27272a 0%, #18181b 100%)' }} />
          <span className="text-zinc-300">Locked</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   City District Map (Detailed View)
   ═══════════════════════════════════════════════════════ */
function CityMapSVG({ city, areasWithCounts, selectedArea, onSelectArea }) {
  const regions = cityMapRegions[city];
  if (!regions || regions.length === 0) return null;

  const getFill = (areaName) => {
    const isSelected = selectedArea === areaName;
    const counts = areasWithCounts.find((a) => a.name === areaName);
    const done = counts ? counts.missions.filter((m) => m.completed).length : 0;
    const total = counts ? counts.missions.length : 0;
    
    if (isSelected) return 'url(#selectedGradient)';
    if (total > 0 && done === total) return 'url(#completedGradient)';
    if (total > 0 && done > 0) return 'url(#inProgressGradient)';
    return 'url(#defaultGradient)';
  };
  
  const getStroke = (areaName) => {
    const isSelected = selectedArea === areaName;
    return isSelected ? '#d4af37' : '#71717a';
  };
  
  const getStrokeWidth = (areaName) => {
    return selectedArea === areaName ? 3 : 2;
  };

  return (
    <svg
      viewBox={`0 0 ${MAP_VIEWBOX.w} ${MAP_VIEWBOX.h}`}
      className="w-full rounded-lg border-2 border-primary/30 bg-zinc-900 shadow-xl map-glow"
      style={{ minHeight: 200, display: 'block' }}
      aria-label={`District map of ${city}`}
    >
      {/* Gradients */}
      <defs>
        <linearGradient id="selectedGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#d4af37" />
          <stop offset="100%" stopColor="#b8860b" />
        </linearGradient>
        <linearGradient id="completedGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#16a34a" />
        </linearGradient>
        <linearGradient id="inProgressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#eab308" />
          <stop offset="100%" stopColor="#ca8a04" />
        </linearGradient>
        <linearGradient id="defaultGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#52525b" />
          <stop offset="100%" stopColor="#3f3f46" />
        </linearGradient>
        
        {/* Grid pattern */}
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#3f3f46" strokeWidth="0.5" />
        </pattern>
      </defs>
      
      {/* Background grid */}
      <rect width={MAP_VIEWBOX.w} height={MAP_VIEWBOX.h} fill="url(#grid)" opacity="0.3" />
      
      {/* Map regions */}
      {regions.map(({ area, points, label }) => {
        const counts = areasWithCounts.find((a) => a.name === area);
        const done = counts ? counts.missions.filter((m) => m.completed).length : 0;
        const total = counts ? counts.missions.length : 0;
        
        return (
          <g key={area}>
            <polygon
              points={points}
              fill={getFill(area)}
              stroke={getStroke(area)}
              strokeWidth={getStrokeWidth(area)}
              className="cursor-pointer transition-all duration-200 hover:opacity-80"
              style={{ 
                opacity: selectedArea && selectedArea !== area ? 0.5 : 1,
                filter: selectedArea === area ? 'drop-shadow(0 0 12px rgba(212, 175, 55, 0.6))' : 'none'
              }}
              onClick={() => onSelectArea(area)}
              onKeyDown={(e) => { 
                if (e.key === 'Enter' || e.key === ' ') { 
                  e.preventDefault(); 
                  onSelectArea(area); 
                } 
              }}
              role="button"
              tabIndex={0}
              aria-label={`${area} — ${total > 0 ? `${done}/${total} missions complete` : 'no missions'} — click to view`}
            />
            
            {/* Area label */}
            <text
              x={label.x}
              y={label.y - 8}
              textAnchor="middle"
              fill="#fafafa"
              className="font-heading font-bold pointer-events-none select-none"
              style={{ fontSize: 13, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
            >
              {area}
            </text>
            
            {/* Mission count */}
            {total > 0 && (
              <text
                x={label.x}
                y={label.y + 8}
                textAnchor="middle"
                fill={done === total ? '#22c55e' : done > 0 ? '#eab308' : '#a1a1aa'}
                className="font-heading font-bold pointer-events-none select-none"
                style={{ fontSize: 11, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
              >
                {done}/{total}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════
   Mission Card
   ═══════════════════════════════════════════════════════ */
function MissionCard({ mission, onComplete, completing, characterName, onTalkToCharacter }) {
  const { completed, requirements_met, progress, character_id } = mission;
  const canComplete = !completed && requirements_met;
  const prog = progress || {};
  const desc = prog.description ?? (prog.current != null && prog.target != null ? `${prog.current}/${prog.target}` : '');

  return (
    <div
      className={`relative rounded-lg border p-2.5 sm:p-3 transition-all ${
        completed
          ? 'bg-emerald-500/10 border-emerald-500/30'
          : canComplete
          ? 'bg-primary/10 border-primary/30'
          : 'bg-zinc-800/40 border-zinc-700/40'
      }`}
    >
      <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${
        completed ? 'bg-emerald-400' : canComplete ? 'bg-primary pulse-map' : 'bg-zinc-600'
      }`} />
      
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-xs sm:text-sm font-heading font-bold text-foreground">
              {mission.title}
            </h3>
            {character_id && characterName && (
              <button
                type="button"
                onClick={() => onTalkToCharacter?.(character_id)}
                className="text-[9px] sm:text-[10px] text-primary font-heading flex items-center gap-1 hover:underline transition-colors"
              >
                <MessageCircle size={10} className="sm:w-3 sm:h-3" />
                {characterName}
              </button>
            )}
          </div>
          
          <p className="text-[10px] sm:text-[11px] text-zinc-400 leading-relaxed">
            {mission.description}
          </p>
          
          {!completed && desc && (
            <p className="text-[10px] sm:text-[11px] text-primary mt-1.5 font-heading font-medium">
              Progress: {desc}
            </p>
          )}
          
          <div className="flex flex-wrap gap-2 mt-2 text-[9px] sm:text-[10px] font-heading">
            <span className="text-emerald-400 font-medium">
              {formatReward(mission.reward_money, mission.reward_points)}
            </span>
            {mission.unlocks_city && (
              <span className="text-primary font-medium">
                · Unlocks {mission.unlocks_city}
              </span>
            )}
          </div>
        </div>
        
        <div className="shrink-0 flex items-center">
          {completed ? (
            <CheckCircle2 size={20} className="text-emerald-400 sm:w-5 sm:h-5" />
          ) : canComplete ? (
            <button
              type="button"
              onClick={() => onComplete(mission.id)}
              disabled={completing === mission.id}
              className="px-2.5 sm:px-3 py-1.5 rounded bg-gradient-to-b from-primary to-primary/80 text-zinc-900 text-[10px] sm:text-[11px] font-heading font-bold hover:from-primary/90 hover:to-primary/70 disabled:opacity-50 transition-all active:scale-95 shadow-sm"
            >
              {completing === mission.id ? '...' : 'Complete'}
            </button>
          ) : (
            <Circle size={20} className="text-zinc-600 sm:w-5 sm:h-5" />
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Character Dialogue Modal
   ═══════════════════════════════════════════════════════ */
function DialogueModal({ character, dialogue, onClose }) {
  if (!character) return null;
  
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm" 
      onClick={onClose}
    >
      <div
        className="rounded-lg border border-zinc-600 bg-zinc-900 shadow-2xl max-w-md w-full p-3 sm:p-4 mission-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
              <User size={16} className="text-primary sm:w-5 sm:h-5" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-heading font-bold text-foreground">
                {character.name}
              </h3>
              <span className="text-[9px] sm:text-[10px] text-zinc-400 font-heading flex items-center gap-1">
                <MapPin size={9} className="sm:w-2.5 sm:h-2.5" />
                {character.area}
              </span>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-foreground transition-colors" 
          >
            <X size={16} className="sm:w-4 sm:h-4" />
          </button>
        </div>
        
        <div className="bg-zinc-800/50 rounded p-3 sm:p-4 mb-3 border border-zinc-700/50">
          <p className="text-[11px] sm:text-xs text-foreground/90 font-heading leading-relaxed italic">
            &ldquo;{dialogue}&rdquo;
          </p>
        </div>
        
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 sm:px-4 py-1.5 sm:py-2 rounded bg-gradient-to-b from-primary to-primary/80 text-zinc-900 text-[10px] sm:text-[11px] font-heading font-bold hover:from-primary/90 hover:to-primary/70 transition-all active:scale-95"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Main Missions Component
   ═══════════════════════════════════════════════════════ */
export default function Missions() {
  const [mapData, setMapData] = useState(null);
  const [missions, setMissions] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCity, setSelectedCity] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null);
  const [completing, setCompleting] = useState(null);
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [showDistrictMap, setShowDistrictMap] = useState(false);

  const fetchMap = async () => {
    try {
      const res = await api.get('/missions/map');
      setMapData(res.data);
      if (!selectedCity && res.data?.current_city) setSelectedCity(res.data.current_city);
      if (!selectedCity && res.data?.unlocked_cities?.length) setSelectedCity(res.data.unlocked_cities[0]);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load map');
    }
  };

  const fetchMissions = async () => {
    try {
      const res = await api.get('/missions');
      setMissions(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load missions');
    }
  };

  const fetchCharacters = async (cityFilter) => {
    try {
      const res = await api.get('/missions/characters', { params: cityFilter ? { city: cityFilter } : {} });
      setCharacters(res.data?.characters || []);
    } catch (e) {
      setCharacters([]);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      await Promise.all([fetchMap(), fetchMissions()]);
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const city = selectedCity || mapData?.current_city || (mapData?.unlocked_cities?.length ? mapData.unlocked_cities[0] : 'Chicago');

  useEffect(() => {
    if (city) fetchCharacters(city);
  }, [city]);

  useEffect(() => {
    setSelectedArea(null);
  }, [city]);

  const handleComplete = async (missionId) => {
    setCompleting(missionId);
    try {
      const res = await api.post('/missions/complete', { mission_id: missionId });
      if (res.data?.completed) {
        toast.success(
          res.data.unlocked_city
            ? `Mission complete! ${res.data.unlocked_city} unlocked.`
            : 'Mission complete!'
        );
        refreshUser();
        await Promise.all([fetchMap(), fetchMissions()]);
        if (res.data.unlocked_city) {
          setSelectedCity(res.data.unlocked_city);
          setShowDistrictMap(false);
        }
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not complete mission');
    } finally {
      setCompleting(null);
    }
  };

  const unlocked = mapData?.unlocked_cities?.length ? mapData.unlocked_cities : ['Chicago'];
  const byCity = mapData?.by_city || {};
  const cityMissions = (city && byCity[city]?.missions) || [];

  // Calculate city stats for USA map
  const cityStats = {};
  Object.keys(byCity).forEach(c => {
    const missions = byCity[c]?.missions || [];
    cityStats[c] = {
      done: missions.filter(m => m.completed).length,
      total: missions.length
    };
  });

  const characterById = Object.fromEntries((characters || []).map((c) => [c.id, c]));
  const missionByCharacterId = Object.fromEntries((cityMissions || []).filter((m) => m.character_id).map((m) => [m.character_id, m]));

  const cityAreas = city && byCity[city]?.areas
    ? Object.entries(byCity[city].areas)
        .filter(([name]) => name && name !== '—')
        .map(([name, missions]) => ({ name, missions: missions || [] }))
    : (city && cityMapRegions[city]
        ? cityMapRegions[city].map(({ area }) => ({ name: area, missions: [] }))
        : []);
        
  const missionsToShow = selectedArea
    ? (cityMissions || []).filter((m) => (m.area || '—') === selectedArea)
    : (cityMissions || []);
    
  const charactersToShow = selectedArea
    ? (characters || []).filter((c) => c.area === selectedArea)
    : (characters || []);

  const getDialogueForCharacter = (char) => {
    const mission = missionByCharacterId[char.id];
    if (mission?.completed) return char.dialogue_complete || char.dialogue_intro || 'Done.';
    if (mission?.requirements_met) return char.dialogue_in_progress || char.dialogue_mission_offer || char.dialogue_intro || 'Come back when it\'s done.';
    return char.dialogue_intro || char.dialogue_mission_offer || 'We need to talk.';
  };

  const handleTalkToCharacter = (characterId) => {
    const char = characterById[characterId];
    if (!char) return;
    setSelectedCharacter({ character: char, dialogue: getDialogueForCharacter(char) });
  };

  if (loading && !mapData) {
    return (
      <div className="min-h-screen bg-zinc-950 px-3 sm:px-4">
        <style>{MISSION_STYLES}</style>
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-3 sm:px-4 pb-6">
      <style>{MISSION_STYLES}</style>
      
      {/* Hero Section with USA Map */}
      <div className="relative py-6 sm:py-8 mission-fade-in">
        <div className="mb-4">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-heading font-bold text-foreground mb-2">
            Welcome to America
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 font-heading">
            Take over the nation, one city at a time.
          </p>
        </div>

        {/* USA Territory Map */}
        <div className="rounded-xl border-2 border-primary/30 bg-gradient-to-br from-zinc-900 via-zinc-900/95 to-zinc-900/90 p-4 sm:p-6 shadow-2xl">
          <USATerritoryMap
            unlockedCities={unlocked}
            currentCity={city}
            onSelectCity={(c) => {
              setSelectedCity(c);
              setShowDistrictMap(true);
            }}
            cityStats={cityStats}
          />
        </div>
      </div>

      {city && showDistrictMap && (
        <>
          {/* District Map Section */}
          {cityAreas.length > 0 && (
            <section className="mb-6 mission-fade-in" style={{ animationDelay: '0.2s' }}>
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-sm sm:text-base font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-2">
                  <Navigation size={16} className="sm:w-5 sm:h-5" />
                  {city} Districts
                </h2>
                <button
                  type="button"
                  onClick={() => setShowDistrictMap(false)}
                  className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded border border-zinc-600 bg-zinc-800/80 text-[9px] sm:text-[10px] font-heading font-bold hover:bg-zinc-700 transition-all active:scale-95"
                >
                  Back to USA Map
                </button>
              </div>
              
              <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading mb-3 leading-relaxed">
                Click a district to filter missions by area.
              </p>
              
              <CityMapSVG
                city={city}
                areasWithCounts={cityAreas}
                selectedArea={selectedArea}
                onSelectArea={(area) => setSelectedArea(selectedArea === area ? null : area)}
              />
              
              {selectedArea && (
                <button
                  type="button"
                  onClick={() => setSelectedArea(null)}
                  className="mt-3 px-3 sm:px-4 py-1.5 sm:py-2 rounded border border-primary/40 bg-primary/10 text-primary text-[10px] sm:text-[11px] font-heading font-bold hover:bg-primary/20 transition-all active:scale-95"
                >
                  Show All Districts
                </button>
              )}
            </section>
          )}

          {/* Characters */}
          {charactersToShow.length > 0 && (
            <section className="mb-6 mission-fade-in" style={{ animationDelay: '0.3s' }}>
              <h2 className="text-sm sm:text-base font-heading font-bold text-primary uppercase tracking-wider mb-3 flex items-center gap-2">
                <User size={16} className="sm:w-5 sm:h-5" />
                Characters{selectedArea ? ` — ${selectedArea}` : ''}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {charactersToShow.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleTalkToCharacter(c.id)}
                    className="px-2.5 sm:px-3 py-2 sm:py-2.5 rounded border border-zinc-600 bg-zinc-800/50 hover:bg-zinc-700/60 hover:border-primary/30 text-left transition-all active:scale-95"
                  >
                    <span className="text-[10px] sm:text-[11px] font-heading font-bold text-foreground block truncate">
                      {c.name}
                    </span>
                    <span className="text-[9px] sm:text-[10px] text-zinc-400 font-heading truncate block">
                      {c.area}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Missions List */}
          <section className="mission-fade-in" style={{ animationDelay: '0.4s' }}>
            <h2 className="text-sm sm:text-base font-heading font-bold text-primary uppercase tracking-wider mb-3 flex items-center gap-2">
              <CheckCircle2 size={16} className="sm:w-5 sm:h-5" />
              {selectedArea ? `${city} — ${selectedArea}` : `${city} Missions`}
            </h2>
            <div className="space-y-2">
              {missionsToShow.length === 0 ? (
                <div className="rounded-lg border border-zinc-700/40 bg-zinc-800/30 p-6 text-center">
                  <p className="text-[10px] sm:text-xs text-zinc-400 font-heading">
                    {selectedArea ? 'No missions in this district.' : 'No missions in this city.'}
                  </p>
                </div>
              ) : (
                missionsToShow.map((m) => (
                  <MissionCard
                    key={m.id}
                    mission={m}
                    onComplete={handleComplete}
                    completing={completing}
                    characterName={characterById[m.character_id]?.name}
                    onTalkToCharacter={handleTalkToCharacter}
                  />
                ))
              )}
            </div>
          </section>
        </>
      )}

      {/* Character Dialogue Modal */}
      {selectedCharacter && (
        <DialogueModal
          character={selectedCharacter.character}
          dialogue={selectedCharacter.dialogue}
          onClose={() => setSelectedCharacter(null)}
        />
      )}

      {!city && unlocked.length === 0 && (
        <div className="rounded-lg border border-zinc-700/40 bg-zinc-800/30 p-8 text-center mission-fade-in">
          <Map size={40} className="mx-auto mb-4 text-zinc-600" />
          <p className="text-sm text-zinc-400 font-heading">
            Complete the game to unlock territories.
          </p>
        </div>
      )}
    </div>
  );
}
