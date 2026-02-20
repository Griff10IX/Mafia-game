import { useState, useEffect } from 'react';
import { Map, X, Target, Star, DollarSign, Award, Crosshair, Briefcase, Lock } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';

const MISSION_STYLES = `
  @keyframes mission-fade-in { 
    from { opacity: 0; transform: translateY(10px); } 
    to { opacity: 1; transform: translateY(0); } 
  }
  .mission-fade-in { animation: mission-fade-in 0.4s ease-out both; }
  
  @keyframes pulse-territory {
    0%, 100% { opacity: 0.8; }
    50% { opacity: 1; }
  }
  .pulse-territory { animation: pulse-territory 2s ease-in-out infinite; }
  
  @keyframes smoke-drift {
    0% { transform: translateY(0) translateX(0) scale(1); opacity: 0.08; }
    50% { transform: translateY(-100px) translateX(20px) scale(1.5); opacity: 0.04; }
    100% { transform: translateY(-200px) translateX(-10px) scale(2); opacity: 0; }
  }
  .smoke { animation: smoke-drift 10s ease-out infinite; }
  
  @keyframes glow-pulse {
    0%, 100% { filter: drop-shadow(0 0 8px rgba(212, 175, 55, 0.3)); }
    50% { filter: drop-shadow(0 0 16px rgba(212, 175, 55, 0.5)); }
  }
  .territory-glow { animation: glow-pulse 3s ease-in-out infinite; }
`;

const formatMoney = (n) => `$${Number(n ?? 0).toLocaleString()}`;

/* ═══════════════════════════════════════════════════════
   Real City District Maps (Authentic Neighborhoods)
   ═══════════════════════════════════════════════════════ */
const CITY_MAPS = {
  // CHICAGO - 6 Districts (Starter City)
  Chicago: {
    viewBox: { w: 500, h: 700 },
    districts: [
      {
        name: 'The Loop',
        // Downtown core
        path: 'M 200,250 L 300,250 L 300,350 L 200,350 Z',
        label: { x: 250, y: 300 }
      },
      {
        name: 'South Side',
        // Southern area
        path: 'M 150,350 L 350,350 L 350,550 L 150,550 Z',
        label: { x: 250, y: 450 }
      },
      {
        name: 'West Side',
        // West neighborhoods
        path: 'M 50,200 L 200,200 L 200,400 L 50,400 Z',
        label: { x: 125, y: 300 }
      },
      {
        name: 'North Side',
        // North area (Lincoln Park, Lakeview)
        path: 'M 200,50 L 350,50 L 350,250 L 200,250 Z',
        label: { x: 275, y: 150 }
      },
      {
        name: 'Near North',
        // Gold Coast, River North
        path: 'M 250,150 L 450,150 L 450,300 L 300,300 L 300,250 Z',
        label: { x: 360, y: 220 }
      },
      {
        name: 'Stockyards',
        // Historic industrial area
        path: 'M 50,400 L 200,400 L 200,550 L 50,550 Z',
        label: { x: 125, y: 475 }
      }
    ]
  },

  // NEW YORK - 12 Districts (Second City)
  'New York': {
    viewBox: { w: 600, h: 800 },
    districts: [
      {
        name: 'Financial District',
        // Lower Manhattan tip
        path: 'M 200,650 L 280,650 L 300,700 L 250,750 L 200,720 Z',
        label: { x: 250, y: 700 }
      },
      {
        name: 'Chinatown',
        // Lower East Side area
        path: 'M 200,580 L 280,580 L 280,650 L 200,650 Z',
        label: { x: 240, y: 615 }
      },
      {
        name: 'Greenwich Village',
        // West Village
        path: 'M 150,500 L 250,500 L 250,580 L 150,580 Z',
        label: { x: 200, y: 540 }
      },
      {
        name: 'Midtown',
        // Times Square area
        path: 'M 150,400 L 300,400 L 300,500 L 150,500 Z',
        label: { x: 225, y: 450 }
      },
      {
        name: 'Upper West Side',
        // West of Central Park
        path: 'M 150,280 L 250,280 L 250,400 L 150,400 Z',
        label: { x: 200, y: 340 }
      },
      {
        name: 'Upper East Side',
        // East of Central Park
        path: 'M 250,280 L 350,280 L 350,400 L 250,400 Z',
        label: { x: 300, y: 340 }
      },
      {
        name: 'Harlem',
        // Upper Manhattan
        path: 'M 150,150 L 300,150 L 300,280 L 150,280 Z',
        label: { x: 225, y: 215 }
      },
      {
        name: 'Bronx',
        // North
        path: 'M 150,50 L 350,50 L 350,150 L 150,150 Z',
        label: { x: 250, y: 100 }
      },
      {
        name: 'Brooklyn Heights',
        // Brooklyn waterfront
        path: 'M 300,550 L 450,550 L 450,650 L 300,650 Z',
        label: { x: 375, y: 600 }
      },
      {
        name: 'Williamsburg',
        // Brooklyn north
        path: 'M 350,450 L 500,450 L 500,550 L 350,550 Z',
        label: { x: 425, y: 500 }
      },
      {
        name: 'Queens',
        // East side
        path: 'M 350,280 L 550,280 L 550,450 L 350,450 Z',
        label: { x: 450, y: 365 }
      },
      {
        name: 'Staten Island',
        // Southwest corner
        path: 'M 50,600 L 150,600 L 150,750 L 50,750 Z',
        label: { x: 100, y: 675 }
      }
    ]
  },

  // LAS VEGAS - 8 Districts (Third City)
  'Las Vegas': {
    viewBox: { w: 500, h: 700 },
    districts: [
      {
        name: 'The Strip',
        // Central corridor
        path: 'M 180,200 L 320,200 L 320,500 L 180,500 Z',
        label: { x: 250, y: 350 }
      },
      {
        name: 'Downtown',
        // Fremont Street area
        path: 'M 180,50 L 320,50 L 320,200 L 180,200 Z',
        label: { x: 250, y: 125 }
      },
      {
        name: 'Paradise',
        // East of Strip (Hard Rock area)
        path: 'M 320,200 L 450,200 L 450,500 L 320,500 Z',
        label: { x: 385, y: 350 }
      },
      {
        name: 'Summerlin',
        // West side (upscale)
        path: 'M 50,150 L 180,150 L 180,400 L 50,400 Z',
        label: { x: 115, y: 275 }
      },
      {
        name: 'Henderson',
        // Southeast
        path: 'M 280,500 L 450,500 L 450,650 L 280,650 Z',
        label: { x: 365, y: 575 }
      },
      {
        name: 'North Las Vegas',
        // North area
        path: 'M 150,50 L 350,50 L 280,150 L 180,150 Z',
        label: { x: 250, y: 90 }
      },
      {
        name: 'Arts District',
        // Downtown arts area
        path: 'M 50,400 L 180,400 L 180,550 L 50,550 Z',
        label: { x: 115, y: 475 }
      },
      {
        name: 'Boulder Strip',
        // East side
        path: 'M 320,50 L 450,50 L 450,200 L 320,200 Z',
        label: { x: 385, y: 125 }
      }
    ]
  },

  // ATLANTIC CITY - 4 Districts (Final City, smaller)
  'Atlantic City': {
    viewBox: { w: 500, h: 600 },
    districts: [
      {
        name: 'Boardwalk',
        // Famous boardwalk strip
        path: 'M 50,100 L 450,100 L 450,250 L 50,250 Z',
        label: { x: 250, y: 175 }
      },
      {
        name: 'Marina District',
        // Harbor/casino area
        path: 'M 50,250 L 450,250 L 450,400 L 50,400 Z',
        label: { x: 250, y: 325 }
      },
      {
        name: 'Inlet',
        // North inlet area
        path: 'M 50,400 L 250,400 L 250,550 L 50,550 Z',
        label: { x: 150, y: 475 }
      },
      {
        name: 'Chelsea',
        // South neighborhood
        path: 'M 250,400 L 450,400 L 450,550 L 250,550 Z',
        label: { x: 350, y: 475 }
      }
    ]
  }
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
   Mission Detail Modal
   ═══════════════════════════════════════════════════════ */
function MissionDetailModal({ city, district, missions, onClose, onStartMission, starting }) {
  if (!district) return null;

  const districtMissions = missions.filter(m => m.area === district);
  const totalObjectives = districtMissions.length;
  const completedObjectives = districtMissions.filter(m => m.completed).length;
  
  const primaryMission = districtMissions.find(m => !m.completed) || districtMissions[0];
  
  const getDifficulty = () => {
    if (!primaryMission?.difficulty) return 1;
    const diff = primaryMission.difficulty;
    if (diff >= 8) return 3;
    if (diff >= 5) return 2;
    return 1;
  };
  
  const difficultyStars = getDifficulty();
  const canStart = primaryMission && !primaryMission.completed && primaryMission.requirements_met;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm" 
      onClick={onClose}
    >
      <div
        className="rounded-xl border-2 border-primary/40 bg-gradient-to-br from-zinc-900 via-zinc-900/98 to-zinc-800 shadow-2xl w-full max-w-md mission-fade-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: '0 0 40px rgba(212, 175, 55, 0.15)' }}
      >
        {/* Header */}
        <div className="relative px-4 py-4 bg-gradient-to-r from-primary/10 to-primary/5 border-b border-primary/20">
          <button 
            type="button" 
            onClick={onClose} 
            className="absolute top-3 right-3 p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-foreground transition-colors" 
          >
            <X size={20} />
          </button>
          
          <h2 className="text-lg sm:text-xl font-heading font-bold text-primary mb-1 pr-8">
            {district}
          </h2>
          <p className="text-[10px] sm:text-xs text-zinc-400 font-heading">
            {city} District
          </p>
        </div>

        {/* Mission Objectives */}
        <div className="px-4 py-4 space-y-2 max-h-[50vh] overflow-y-auto">
          {districtMissions.length === 0 ? (
            <div className="text-center py-8">
              <Target size={32} className="mx-auto mb-2 text-zinc-600" />
              <p className="text-xs text-zinc-400 font-heading">No missions available</p>
            </div>
          ) : (
            districtMissions.map((mission) => {
              const prog = mission.progress || {};
              const desc = prog.description ?? (prog.current != null && prog.target != null ? `${prog.current}/${prog.target}` : '');
              
              return (
                <div
                  key={mission.id}
                  className={`p-2.5 rounded border ${
                    mission.completed
                      ? 'bg-emerald-500/10 border-emerald-500/30'
                      : 'bg-zinc-800/60 border-zinc-700/50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {mission.completed ? (
                      <div className="shrink-0 w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mt-0.5">
                        <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    ) : (
                      <div className="shrink-0 w-5 h-5 rounded-full bg-zinc-700/50 border border-zinc-600/50 mt-0.5" />
                    )}
                    
                    <div className="flex-1 min-w-0">
                      <p className={`text-[11px] sm:text-xs font-heading font-medium ${
                        mission.completed ? 'text-emerald-400' : 'text-foreground'
                      }`}>
                        {mission.title}
                      </p>
                      {!mission.completed && desc && (
                        <p className="text-[10px] text-zinc-400 mt-0.5">
                          {desc}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Rewards & Info */}
        {primaryMission && (
          <div className="px-4 py-3 border-t border-zinc-700/50 bg-zinc-900/50">
            <div className="space-y-2">
              {(primaryMission.reward_money || primaryMission.reward_points || primaryMission.unlocks_city) && (
                <div className="space-y-1.5">
                  {primaryMission.reward_money > 0 && (
                    <div className="flex items-center justify-between text-[11px] font-heading">
                      <span className="text-zinc-400">Earn Interest Bank Profit</span>
                      <span className="text-emerald-400 font-bold">{formatMoney(primaryMission.reward_money)}</span>
                    </div>
                  )}
                  {primaryMission.reward_points > 0 && (
                    <div className="flex items-center justify-between text-[11px] font-heading">
                      <span className="text-zinc-400">Empire Reward</span>
                      <span className="text-primary font-bold">{primaryMission.reward_points} Points</span>
                    </div>
                  )}
                  {primaryMission.unlocks_city && (
                    <div className="flex items-center justify-between text-[11px] font-heading">
                      <span className="text-zinc-400">Unlocks</span>
                      <span className="text-primary font-bold">{primaryMission.unlocks_city}</span>
                    </div>
                  )}
                </div>
              )}
              
              <div className="flex items-center justify-between text-[11px] font-heading">
                <span className="text-zinc-400">Difficulty</span>
                <div className="flex gap-0.5">
                  {[...Array(3)].map((_, i) => (
                    <Star
                      key={i}
                      size={14}
                      className={i < difficultyStars ? 'fill-primary text-primary' : 'text-zinc-600'}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action Button */}
        {primaryMission && (
          <div className="px-4 py-4 border-t border-zinc-700/50">
            {primaryMission.completed ? (
              <div className="text-center py-2">
                <div className="inline-flex items-center gap-2 text-emerald-400 font-heading text-sm">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  District Complete
                </div>
              </div>
            ) : canStart ? (
              <button
                type="button"
                onClick={() => onStartMission(primaryMission.id)}
                disabled={starting}
                className="w-full py-3 rounded-lg bg-gradient-to-b from-primary to-primary/80 text-zinc-900 font-heading font-bold text-sm uppercase tracking-wide hover:from-primary/90 hover:to-primary/70 disabled:opacity-50 transition-all active:scale-95 shadow-lg shadow-primary/20"
              >
                {starting ? 'Starting...' : 'Start Mission'}
              </button>
            ) : (
              <div className="text-center py-2">
                <div className="inline-flex items-center gap-2 text-zinc-500 font-heading text-xs">
                  <Lock size={14} />
                  Requirements Not Met
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   City Territory Map
   ═══════════════════════════════════════════════════════ */
function CityTerritoryMap({ city, missions, onDistrictClick }) {
  const mapData = CITY_MAPS[city];
  if (!mapData) return null;

  const getDistrictStats = (districtName) => {
    const districtMissions = missions.filter(m => m.area === districtName);
    const completed = districtMissions.filter(m => m.completed).length;
    const total = districtMissions.length;
    return { completed, total };
  };

  const getDistrictFill = (districtName) => {
    const { completed, total } = getDistrictStats(districtName);
    if (total === 0) return 'url(#noMissionsGrad)';
    if (completed === total) return 'url(#completeGrad)';
    if (completed > 0) return 'url(#progressGrad)';
    return 'url(#availableGrad)';
  };

  return (
    <div className="relative">
      {/* Atmospheric effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-xl">
        <div className="absolute top-10 left-20 w-40 h-40 bg-primary/5 rounded-full blur-3xl smoke" style={{ animationDelay: '0s' }} />
        <div className="absolute top-40 right-32 w-32 h-32 bg-primary/5 rounded-full blur-3xl smoke" style={{ animationDelay: '3s' }} />
        <div className="absolute bottom-20 left-1/3 w-36 h-36 bg-primary/5 rounded-full blur-3xl smoke" style={{ animationDelay: '6s' }} />
      </div>

      <svg
        viewBox={`0 0 ${mapData.viewBox.w} ${mapData.viewBox.h}`}
        className="w-full territory-glow"
        style={{ maxHeight: 600 }}
      >
        <defs>
          <linearGradient id="completeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#16a34a" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#eab308" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#ca8a04" stopOpacity="0.8" />
          </linearGradient>
          <linearGradient id="availableGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#52525b" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#3f3f46" stopOpacity="0.7" />
          </linearGradient>
          <linearGradient id="noMissionsGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#27272a" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#18181b" stopOpacity="0.5" />
          </linearGradient>
          
          <pattern id="territoryGrid" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#3f3f46" strokeWidth="0.5" opacity="0.2" />
          </pattern>
          
          <filter id="districtGlow">
            <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        <rect width={mapData.viewBox.w} height={mapData.viewBox.h} fill="#0a0a0a" />
        <rect width={mapData.viewBox.w} height={mapData.viewBox.h} fill="url(#territoryGrid)" />

        {mapData.districts.map((district) => {
          const stats = getDistrictStats(district.name);
          
          return (
            <g key={district.name}>
              <path
                d={district.path}
                fill={getDistrictFill(district.name)}
                stroke="#71717a"
                strokeWidth="2"
                className="cursor-pointer transition-all duration-300 hover:opacity-90"
                style={{ filter: 'url(#districtGlow)' }}
                onClick={() => onDistrictClick(district.name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onDistrictClick(district.name);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={`${district.name} — ${stats.completed}/${stats.total} missions complete`}
              />
              
              <text
                x={district.label.x}
                y={district.label.y - 10}
                textAnchor="middle"
                fill="#fafafa"
                className="font-heading font-bold pointer-events-none select-none"
                style={{ fontSize: 14, textShadow: '0 2px 4px rgba(0,0,0,0.9)' }}
              >
                {district.name}
              </text>
              
              {stats.total > 0 && (
                <text
                  x={district.label.x}
                  y={district.label.y + 10}
                  textAnchor="middle"
                  fill={stats.completed === stats.total ? '#22c55e' : stats.completed > 0 ? '#eab308' : '#a1a1aa'}
                  className="font-heading font-bold pointer-events-none select-none"
                  style={{ fontSize: 13, textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
                >
                  {stats.completed}/{stats.total}
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
   Empire Stats & Mission Guide
   ═══════════════════════════════════════════════════════ */
function EmpireStatsSection({ stats }) {
  const StatCard = ({ icon: Icon, label, value, color = 'text-foreground' }) => (
    <div className="rounded-lg border border-zinc-700/50 bg-gradient-to-br from-zinc-800/60 to-zinc-900/60 p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} className="text-zinc-500 sm:w-4 sm:h-4" />
        <span className="text-[10px] sm:text-xs text-zinc-400 font-heading uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className={`text-lg sm:text-xl font-heading font-bold ${color}`}>
        {value}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard icon={DollarSign} label="Cash" value={`${formatMoney(stats.cash_per_day)} per day`} color="text-emerald-400" />
      <StatCard icon={Award} label="Points" value={`${stats.points_per_day} per day`} color="text-primary" />
      <StatCard icon={Crosshair} label="Bullets" value={`${stats.bullets_per_day} per day`} color="text-foreground" />
      <StatCard icon={Briefcase} label="Auto Ranks" value={`${stats.auto_ranks_per_day} per day`} color="text-foreground" />
    </div>
  );
}

function MissionGuide() {
  return (
    <div className="rounded-lg border border-zinc-700/50 bg-gradient-to-br from-zinc-800/60 to-zinc-900/60 p-4">
      <h3 className="text-sm sm:text-base font-heading font-bold text-primary mb-2">Mission Guide</h3>
      <p className="text-[11px] sm:text-xs text-zinc-400 font-heading leading-relaxed mb-3">
        A guide to missions and your empire.
      </p>
      
      <div className="space-y-2 text-[10px] sm:text-[11px] text-zinc-400 font-heading leading-relaxed">
        <p>
          Navigate your way through the map, taking over each district one by one. Each district has 3 tasks to complete, and once completed, you will receive daily income from that district (Empire).
        </p>
        <p>
          Once you have completed 10+ districts, you will be able to sell your empire for a large points reward.{' '}
          <strong className="text-amber-400">Note:</strong> selling your empire will stop you from receiving daily income from your empire, and you won't be able to complete any more districts.
        </p>
        <p className="text-red-400">
          <strong>Mission Retrieval:</strong> Your mission progress is not protected in the event of death.
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════ */
export default function Missions() {
  const [mapData, setMapData] = useState(null);
  const [missions, setMissions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCity, setSelectedCity] = useState(null);
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [starting, setStarting] = useState(false);
  const [empireStats, setEmpireStats] = useState({
    cash_per_day: 0,
    points_per_day: 0,
    bullets_per_day: 0,
    auto_ranks_per_day: 0
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [mapRes, missionsRes] = await Promise.all([
          api.get('/missions/map'),
          api.get('/missions')
        ]);
        
        if (!cancelled) {
          setMapData(mapRes.data);
          setMissions(missionsRes.data);
          
          if (mapRes.data?.current_city) {
            setSelectedCity(mapRes.data.current_city);
          } else if (mapRes.data?.unlocked_cities?.length) {
            setSelectedCity(mapRes.data.unlocked_cities[0]);
          } else {
            setSelectedCity('Chicago');
          }
          
          setEmpireStats({
            cash_per_day: 0,
            points_per_day: 0,
            bullets_per_day: 0,
            auto_ranks_per_day: 0
          });
        }
      } catch (e) {
        if (!cancelled) {
          toast.error(e.response?.data?.detail || 'Failed to load missions');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const handleStartMission = async (missionId) => {
    setStarting(true);
    try {
      const res = await api.post('/missions/complete', { mission_id: missionId });
      if (res.data?.completed) {
        toast.success(
          res.data.unlocked_city
            ? `Mission complete! ${res.data.unlocked_city} unlocked.`
            : 'Mission complete!'
        );
        refreshUser();
        
        const [mapRes, missionsRes] = await Promise.all([
          api.get('/missions/map'),
          api.get('/missions')
        ]);
        setMapData(mapRes.data);
        setMissions(missionsRes.data);
        
        if (res.data.unlocked_city) {
          setSelectedCity(res.data.unlocked_city);
          setSelectedDistrict(null);
        }
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not complete mission');
    } finally {
      setStarting(false);
    }
  };

  if (loading || !mapData) {
    return (
      <div className="min-h-screen bg-zinc-950 px-3 sm:px-4 py-6">
        <style>{MISSION_STYLES}</style>
        <LoadingSpinner />
      </div>
    );
  }

  const unlocked = mapData?.unlocked_cities?.length ? mapData.unlocked_cities : ['Chicago'];
  const byCity = mapData?.by_city || {};
  const cityMissions = (selectedCity && byCity[selectedCity]?.missions) || [];

  // Get district count for display
  const districtCount = CITY_MAPS[selectedCity]?.districts?.length || 0;

  return (
    <div className="min-h-screen bg-zinc-950 px-3 sm:px-4 py-6">
      <style>{MISSION_STYLES}</style>
      
      {/* Hero */}
      <div className="mb-6 mission-fade-in">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-heading font-bold text-foreground mb-2">
          Welcome to America
        </h1>
        <p className="text-xs sm:text-sm text-zinc-400 font-heading">
          Take over the nation, one district at a time.
        </p>
      </div>

      {/* City Selector */}
      {unlocked.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6 mission-fade-in" style={{ animationDelay: '0.1s' }}>
          {unlocked.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setSelectedCity(c)}
              className={`px-3 sm:px-4 py-2 rounded-lg text-[11px] sm:text-xs font-heading font-bold border transition-all active:scale-95 ${
                selectedCity === c
                  ? 'bg-gradient-to-b from-primary to-primary/80 text-zinc-900 border-primary shadow-lg shadow-primary/20'
                  : 'bg-zinc-800/60 text-foreground border-zinc-700 hover:bg-zinc-700/60'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Territory Map */}
      {selectedCity && (
        <div className="rounded-xl border-2 border-primary/30 bg-gradient-to-br from-zinc-900 via-zinc-900/95 to-zinc-900/90 p-4 sm:p-6 mb-6 shadow-2xl mission-fade-in" style={{ animationDelay: '0.2s' }}>
          <div className="mb-3">
            <h2 className="text-base sm:text-lg font-heading font-bold text-primary mb-1">
              {selectedCity}
            </h2>
            <p className="text-[10px] sm:text-xs text-zinc-400 font-heading">
              {districtCount} Districts • Click to view missions
            </p>
          </div>
          <CityTerritoryMap
            city={selectedCity}
            missions={cityMissions}
            onDistrictClick={(district) => setSelectedDistrict(district)}
          />
        </div>
      )}

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 mission-fade-in" style={{ animationDelay: '0.3s' }}>
          <MissionGuide />
        </div>
        
        <div className="mission-fade-in" style={{ animationDelay: '0.35s' }}>
          <div className="space-y-3">
            <div className="rounded-lg border border-zinc-700/50 bg-gradient-to-br from-zinc-800/60 to-zinc-900/60 p-3">
              <h4 className="text-xs font-heading font-bold text-zinc-400 uppercase tracking-wider mb-2">
                Common Scraps
              </h4>
              <p className="text-xs text-zinc-500 font-heading">Coming soon</p>
            </div>
            <div className="rounded-lg border border-zinc-700/50 bg-gradient-to-br from-zinc-800/60 to-zinc-900/60 p-3">
              <h4 className="text-xs font-heading font-bold text-zinc-400 uppercase tracking-wider mb-2">
                Rare Scraps
              </h4>
              <p className="text-xs text-zinc-500 font-heading">Coming soon</p>
            </div>
          </div>
        </div>
      </div>

      {/* Empire Stats */}
      <div className="mission-fade-in" style={{ animationDelay: '0.4s' }}>
        <EmpireStatsSection stats={empireStats} />
      </div>

      {/* Modal */}
      {selectedDistrict && (
        <MissionDetailModal
          city={selectedCity}
          district={selectedDistrict}
          missions={cityMissions}
          onClose={() => setSelectedDistrict(null)}
          onStartMission={handleStartMission}
          starting={starting}
        />
      )}
    </div>
  );
}
