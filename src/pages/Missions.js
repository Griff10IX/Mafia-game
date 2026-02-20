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

  const city = selectedCity || mapData?.current_city || mapData?.unlocked_cities?.[0];
  const byCity = mapData?.by_city || {};
  const cityMissions = (city && byCity[city]?.missions) || [];
  const unlocked = mapData?.unlocked_cities || [];

  const characterById = Object.fromEntries((characters || []).map((c) => [c.id, c]));
  const missionByCharacterId = Object.fromEntries((cityMissions || []).filter((m) => m.character_id).map((m) => [m.character_id, m]));

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
          <Map className="w-8 h-8 text-primary/40 animate-pulse" />
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[10px] font-heading uppercase tracking-wider">Loading missions...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Map className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-heading font-bold text-foreground">Missions</h1>
      </div>
      <p className="text-[11px] text-mutedForeground font-heading">
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
          {characters.length > 0 && (
            <section>
              <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-wider mb-2">
                Characters — {city}
              </h2>
              <div className="flex flex-wrap gap-2">
                {characters.map((c) => (
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
              {city}
            </h2>
            <div className="space-y-2">
              {cityMissions.length === 0 ? (
                <p className="text-[11px] text-mutedForeground">No missions in this city.</p>
              ) : (
                cityMissions.map((m) => (
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
