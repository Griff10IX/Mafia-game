import { useState, useEffect } from 'react';
import { Map, CheckCircle2, Circle, User, MessageCircle, X, MapPin, Navigation } from 'lucide-react';
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
    0%, 100% { filter: drop-shadow(0 0 8px rgba(234, 179, 8, 0.3)); }
    50% { filter: drop-shadow(0 0 16px rgba(234, 179, 8, 0.5)); }
  }
  .map-glow { animation: map-glow 3s ease-in-out infinite; }
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
   City Map Data
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
    <Map size={32} className="text-amber-500 animate-pulse" />
    <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
    <span className="text-zinc-300 text-[9px] sm:text-[10px] font-heading uppercase tracking-wider">Loading missions...</span>
  </div>
);

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
          ? 'bg-amber-500/10 border-amber-500/30'
          : 'bg-zinc-800/40 border-zinc-700/40'
      }`}
    >
      {/* Status indicator dot */}
      <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${
        completed ? 'bg-emerald-400' : canComplete ? 'bg-amber-400 pulse-map' : 'bg-zinc-600'
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
                Talk to {characterName}
              </button>
            )}
            {character_id && !characterName && (
              <span className="text-[9px] sm:text-[10px] text-zinc-400 font-heading flex items-center gap-1">
                <User size={10} className="sm:w-3 sm:h-3" />
                Character
              </span>
            )}
          </div>
          
          <p className="text-[10px] sm:text-[11px] text-zinc-400 leading-relaxed">
            {mission.description}
          </p>
          
          {!completed && desc && (
            <p className="text-[10px] sm:text-[11px] text-amber-400 mt-1.5 font-heading font-medium">
              Progress: {desc}
            </p>
          )}
          
          <div className="flex flex-wrap gap-2 mt-2 text-[9px] sm:text-[10px] font-heading">
            <span className="text-emerald-400 font-medium">
              {formatReward(mission.reward_money, mission.reward_points)}
            </span>
            {mission.unlocks_city && (
              <span className="text-amber-400 font-medium">
                · Unlocks {mission.unlocks_city}
              </span>
            )}
          </div>
        </div>
        
        <div className="shrink-0 flex items-center">
          {completed ? (
            <CheckCircle2 size={20} className="text-emerald-400 sm:w-5 sm:h-5" aria-label="Completed" />
          ) : canComplete ? (
            <button
              type="button"
              onClick={() => onComplete(mission.id)}
              disabled={completing === mission.id}
              className="px-2.5 sm:px-3 py-1.5 rounded bg-gradient-to-b from-amber-600 to-amber-700 text-white text-[10px] sm:text-[11px] font-heading font-bold hover:from-amber-500 hover:to-amber-600 disabled:opacity-50 transition-all active:scale-95 shadow-sm"
            >
              {completing === mission.id ? 'Completing...' : 'Complete'}
            </button>
          ) : (
            <Circle size={20} className="text-zinc-600 sm:w-5 sm:h-5" aria-label="Locked" />
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Interactive City Map SVG
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
    return isSelected ? '#f59e0b' : '#71717a';
  };
  
  const getStrokeWidth = (areaName) => {
    return selectedArea === areaName ? 3 : 2;
  };

  return (
    <div className="relative">
      {/* Legend */}
      <div className="absolute top-2 right-2 sm:top-3 sm:right-3 bg-zinc-900/90 border border-zinc-700 rounded p-2 text-[8px] sm:text-[9px] font-heading z-10">
        <div className="flex items-center gap-1.5 mb-1">
          <div className="w-3 h-3 rounded" style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' }} />
          <span className="text-zinc-300">Complete</span>
        </div>
        <div className="flex items-center gap-1.5 mb-1">
          <div className="w-3 h-3 rounded" style={{ background: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)' }} />
          <span className="text-zinc-300">In Progress</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-zinc-700" />
          <span className="text-zinc-300">Locked</span>
        </div>
      </div>
      
      <svg
        viewBox={`0 0 ${MAP_VIEWBOX.w} ${MAP_VIEWBOX.h}`}
        className="w-full rounded-lg border-2 border-amber-500/30 bg-zinc-900 shadow-lg map-glow"
        style={{ minHeight: 200, display: 'block' }}
        aria-label={`Interactive map of ${city}`}
      >
        {/* Gradients */}
        <defs>
          <linearGradient id="selectedGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#d97706" />
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
                  filter: selectedArea === area ? 'drop-shadow(0 0 8px rgba(245, 158, 11, 0.6))' : 'none'
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
        {/* Header */}
        <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
              <User size={16} className="text-amber-400 sm:w-5 sm:h-5" />
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
            aria-label="Close"
          >
            <X size={16} className="sm:w-4 sm:h-4" />
          </button>
        </div>
        
        {/* Dialogue */}
        <div className="bg-zinc-800/50 rounded p-3 sm:p-4 mb-3 border border-zinc-700/50">
          <p className="text-[11px] sm:text-xs text-foreground/90 font-heading leading-relaxed italic">
            &ldquo;{dialogue}&rdquo;
          </p>
        </div>
        
        {/* Close button */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 sm:px-4 py-1.5 sm:py-2 rounded bg-gradient-to-b from-amber-600 to-amber-700 text-white text-[10px] sm:text-[11px] font-heading font-bold hover:from-amber-500 hover:to-amber-600 transition-all active:scale-95 shadow-sm"
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
        if (res.data.unlocked_city) setSelectedCity(res.data.unlocked_city);
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
      <div className="space-y-3 px-3 sm:px-4">
        <style>{MISSION_STYLES}</style>
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4 px-3 sm:px-4 pb-6">
      <style>{MISSION_STYLES}</style>
      
      {/* Page Header */}
      <div className="mission-fade-in">
        <div className="flex items-center gap-2 mb-1">
          <Map size={20} className="text-amber-500 sm:w-5 sm:h-5" />
          <h1 className="text-base sm:text-lg font-heading font-bold text-foreground">Missions</h1>
        </div>
        <p className="text-[10px] sm:text-[11px] text-zinc-400 font-heading leading-relaxed">
          Complete missions in each city to unlock the next. Talk to characters, complete jobs, collect rewards.
        </p>
      </div>

      {/* City Selector */}
      {unlocked.length > 0 && (
        <div className="flex flex-wrap gap-2 mission-fade-in" style={{ animationDelay: '0.1s' }}>
          {unlocked.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setSelectedCity(c)}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded text-[10px] sm:text-[11px] font-heading font-bold border transition-all active:scale-95 ${
                city === c
                  ? 'bg-gradient-to-b from-amber-600 to-amber-700 text-white border-amber-500 shadow-sm'
                  : 'bg-zinc-800/60 text-foreground border-zinc-700 hover:bg-zinc-700/60'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {city && (
        <>
          {/* Interactive Map */}
          {cityAreas.length > 0 && (
            <section className="mission-fade-in" style={{ animationDelay: '0.2s' }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="text-xs sm:text-sm font-heading font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Navigation size={14} className="sm:w-4 sm:h-4" />
                  Map of {city}
                </h2>
                {selectedArea && (
                  <button
                    type="button"
                    onClick={() => setSelectedArea(null)}
                    className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded border border-zinc-600 bg-zinc-800/80 text-[9px] sm:text-[10px] font-heading font-bold hover:bg-zinc-700 transition-all active:scale-95"
                  >
                    Show All
                  </button>
                )}
              </div>
              
              <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading mb-3 leading-relaxed">
                Click an area on the map to filter missions and characters. Green = complete, yellow = in progress, gray = locked.
              </p>
              
              <CityMapSVG
                city={city}
                areasWithCounts={cityAreas}
                selectedArea={selectedArea}
                onSelectArea={(area) => setSelectedArea(selectedArea === area ? null : area)}
              />
            </section>
          )}

          {/* Characters */}
          {charactersToShow.length > 0 && (
            <section className="mission-fade-in" style={{ animationDelay: '0.3s' }}>
              <h2 className="text-xs sm:text-sm font-heading font-bold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <User size={14} className="sm:w-4 sm:h-4" />
                Characters{selectedArea ? ` — ${selectedArea}` : ` — ${city}`}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {charactersToShow.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleTalkToCharacter(c.id)}
                    className="px-2.5 sm:px-3 py-2 sm:py-2.5 rounded border border-zinc-600 bg-zinc-800/50 hover:bg-zinc-700/60 hover:border-amber-500/30 text-left transition-all active:scale-95"
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
            <h2 className="text-xs sm:text-sm font-heading font-bold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <CheckCircle2 size={14} className="sm:w-4 sm:h-4" />
              {selectedArea ? `${city} — ${selectedArea}` : city}
            </h2>
            <div className="space-y-2">
              {missionsToShow.length === 0 ? (
                <div className="rounded-lg border border-zinc-700/40 bg-zinc-800/30 p-4 text-center">
                  <p className="text-[10px] sm:text-[11px] text-zinc-400 font-heading">
                    {selectedArea ? 'No missions in this area.' : 'No missions in this city.'}
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

      {/* No cities unlocked message */}
      {!city && unlocked.length === 0 && (
        <div className="rounded-lg border border-zinc-700/40 bg-zinc-800/30 p-6 text-center mission-fade-in">
          <Map size={32} className="mx-auto mb-3 text-zinc-600" />
          <p className="text-xs sm:text-sm text-zinc-400 font-heading">
            Complete the game to unlock missions.
          </p>
        </div>
      )}
    </div>
  );
}
