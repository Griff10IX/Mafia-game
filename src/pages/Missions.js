import { useState, useEffect } from 'react';
import { Map, CheckCircle2, Circle, User, MessageCircle, X } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function formatReward(money, points) {
  const parts = [];
  if (money) parts.push(`$${Number(money).toLocaleString()}`);
  if (points) parts.push(`${Number(points).toLocaleString()} RP`);
  return parts.length ? parts.join(' · ') : '—';
}

function MissionCard({ mission, onComplete, completing, characterName, onTalkToCharacter }) {
  const { completed, requirements_met, progress, character_id } = mission;
  const canComplete = !completed && requirements_met;
  const prog = progress || {};
  const desc = prog.description ?? (prog.current != null && prog.target != null ? `${prog.current}/${prog.target}` : '');

  return (
    <div
      className={`rounded-lg border p-3 ${
        completed
          ? 'bg-primary/10 border-primary/30'
          : 'bg-zinc-800/30 border-zinc-700/40'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-heading font-bold text-foreground">{mission.title}</h3>
            {character_id && characterName && (
              <button
                type="button"
                onClick={() => onTalkToCharacter?.(character_id)}
                className="text-[10px] text-primary font-heading flex items-center gap-1 hover:underline"
              >
                <MessageCircle className="w-3 h-3" /> Talk to {characterName}
              </button>
            )}
            {character_id && !characterName && (
              <span className="text-[10px] text-mutedForeground font-heading flex items-center gap-1">
                <User className="w-3 h-3" /> Character
              </span>
            )}
          </div>
          <p className="text-[11px] text-mutedForeground mt-1">{mission.description}</p>
          {!completed && desc && (
            <p className="text-[11px] text-primary mt-1.5 font-heading">
              Progress: {desc}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-2 text-[10px] font-heading text-primary/80">
            {formatReward(mission.reward_money, mission.reward_points)}
            {mission.unlocks_city && (
              <span className="text-primary">· Unlocks {mission.unlocks_city}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {completed ? (
            <CheckCircle2 className="w-5 h-5 text-primary" aria-label="Completed" />
          ) : canComplete ? (
            <button
              type="button"
              onClick={() => onComplete(mission.id)}
              disabled={completing === mission.id}
              className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-[11px] font-heading font-bold hover:bg-primary/90 disabled:opacity-50"
            >
              {completing === mission.id ? 'Completing...' : 'Complete'}
            </button>
          ) : (
            <Circle className="w-5 h-5 text-mutedForeground" aria-label="Locked" />
          )}
        </div>
      </div>
    </div>
  );
}

// Stylized 2D map of each city — clickable regions (SVG)
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

function CityMapSVG({ city, areasWithCounts, selectedArea, onSelectArea }) {
  const regions = cityMapRegions[city];
  if (!regions || regions.length === 0) return null;

  const getFill = (areaName) => {
    const isSelected = selectedArea === areaName;
    const counts = areasWithCounts.find((a) => a.name === areaName);
    const done = counts ? counts.missions.filter((m) => m.completed).length : 0;
    const total = counts ? counts.missions.length : 0;
    if (isSelected) return '#b45309';
    if (total > 0 && done === total) return '#92400e';
    return '#52525b';
  };
  const getStroke = (areaName) => (selectedArea === areaName ? '#ea580c' : '#71717a');

  return (
    <svg
      viewBox={`0 0 ${MAP_VIEWBOX.w} ${MAP_VIEWBOX.h}`}
      className="w-full max-w-2xl rounded-lg border-2 border-zinc-500 bg-zinc-800"
      style={{ minHeight: 220, display: 'block' }}
      aria-label={`Map of ${city}`}
    >
      {regions.map(({ area, points, label }) => (
        <g key={area}>
          <polygon
            points={points}
            fill={getFill(area)}
            stroke={getStroke(area)}
            strokeWidth={2.5}
            className="cursor-pointer transition-all duration-150 hover:opacity-90"
            style={{ opacity: selectedArea && selectedArea !== area ? 0.6 : 1 }}
            onClick={() => onSelectArea(area)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectArea(area); } }}
            role="button"
            tabIndex={0}
            aria-label={`${area} — click to view missions`}
          />
          <text
            x={label.x}
            y={label.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#fafafa"
            className="font-heading font-bold pointer-events-none select-none"
            style={{ fontSize: 14 }}
          >
            {area}
          </text>
        </g>
      ))}
    </svg>
  );
}

function DialogueModal({ character, dialogue, onClose }) {
  if (!character) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="rounded-lg border border-zinc-600 bg-zinc-900 shadow-xl max-w-md w-full p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-primary" />
            <h3 className="text-sm font-heading font-bold text-foreground">{character.name}</h3>
            <span className="text-[10px] text-mutedForeground font-heading">({character.area})</span>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-zinc-700 text-mutedForeground" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[12px] text-foreground/90 font-heading leading-relaxed italic">&ldquo;{dialogue}&rdquo;</p>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-[11px] font-heading font-bold hover:bg-primary/90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const city = selectedCity || mapData?.current_city || unlocked[0];
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
      <div className={`space-y-3 ${styles.pageContent}`}>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <Map className="w-8 h-8 text-amber-500 animate-pulse" />
          <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-zinc-300 text-[10px] font-heading uppercase tracking-wider">Loading missions...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent} min-h-[60vh] bg-zinc-950/50`}>
      <div className="flex flex-wrap items-center gap-2">
        <Map className="w-5 h-5 text-amber-500" />
        <h1 className="text-lg font-heading font-bold text-foreground">Missions</h1>
      </div>
      <p className="text-[11px] text-zinc-400 font-heading">
        Complete missions in each city to unlock the next. Talk to the characters, do the jobs, report back.
      </p>

      {unlocked.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {unlocked.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setSelectedCity(c)}
              className={`px-3 py-1.5 rounded text-[11px] font-heading font-bold border ${
                city === c
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-zinc-800/50 text-foreground border-zinc-600 hover:bg-zinc-700/50'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {city && (
        <>
          {cityAreas.length > 0 && (
            <section>
              <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-wider mb-2">
                Map of {city}
              </h2>
              <p className="text-[11px] text-mutedForeground font-heading mb-2">
                Click an area on the map to view missions and characters there. Accept and complete missions from the list below.
              </p>
              <div className="flex flex-wrap items-center gap-2 mb-2">
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
                    className="self-start px-3 py-1.5 rounded border border-zinc-600 bg-zinc-800/80 text-[11px] font-heading font-bold hover:bg-zinc-700"
                  >
                    Show all areas
                  </button>
                )}
              </div>
            </section>
          )}

          {charactersToShow.length > 0 && (
            <section>
              <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-wider mb-2">
                Characters{selectedArea ? ` — ${selectedArea}` : ` — ${city}`}
              </h2>
              <div className="flex flex-wrap gap-2">
                {charactersToShow.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleTalkToCharacter(c.id)}
                    className="px-3 py-2 rounded border border-zinc-600 bg-zinc-800/50 hover:bg-zinc-700/50 text-left"
                  >
                    <span className="text-[11px] font-heading font-bold text-foreground block">{c.name}</span>
                    <span className="text-[10px] text-mutedForeground font-heading">{c.area}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <section>
            <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-wider mb-2">
              {selectedArea ? `${city} — ${selectedArea}` : city}
            </h2>
            <div className="space-y-2">
              {missionsToShow.length === 0 ? (
                <p className="text-[11px] text-mutedForeground">
                  {selectedArea ? 'No missions in this district.' : 'No missions in this city.'}
                </p>
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

      {selectedCharacter && (
        <DialogueModal
          character={selectedCharacter.character}
          dialogue={selectedCharacter.dialogue}
          onClose={() => setSelectedCharacter(null)}
        />
      )}

      {!city && unlocked.length === 0 && (
        <p className="text-[11px] text-mutedForeground">Complete the game to unlock missions.</p>
      )}
    </div>
  );
}
