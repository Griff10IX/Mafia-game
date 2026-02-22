import { useState, useEffect } from 'react';
import { BookOpen, X, Crown, Clock, Lock, CheckCircle } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400&display=swap');
  
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  @keyframes pageFlip {
    0% { transform: perspective(1000px) rotateY(0deg); }
    50% { transform: perspective(1000px) rotateY(-10deg); }
    100% { transform: perspective(1000px) rotateY(0deg); }
  }
  
  @keyframes inkDrop {
    0% { transform: scale(0); opacity: 0; }
    50% { transform: scale(1.2); opacity: 0.5; }
    100% { transform: scale(1); opacity: 0.3; }
  }
  
  @keyframes waxSeal {
    0% { transform: scale(0) rotate(-45deg); opacity: 0; }
    60% { transform: scale(1.1) rotate(0deg); opacity: 1; }
    100% { transform: scale(1) rotate(0deg); opacity: 1; }
  }
  
  .fade-in { animation: fadeIn 0.6s ease-out both; }
  .page-flip { animation: pageFlip 0.8s ease-out; }
  .ink-drop { animation: inkDrop 1s ease-out both; }
  .wax-seal { animation: waxSeal 0.5s ease-out both; }
  
  @keyframes smoke {
    0% { transform: translateY(0) scale(1); opacity: 0.3; }
    100% { transform: translateY(-40px) scale(1.5); opacity: 0; }
  }
  
  .cigar-smoke {
    position: absolute;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(200, 180, 160, 0.4) 0%, transparent 70%);
    animation: smoke 4s ease-out infinite;
  }
`;

const fmt = (n) => `$${Number(n ?? 0).toLocaleString()}`;

// Territory status badge component
function StatusBadge({ status }) {
  const configs = {
    complete: { icon: CheckCircle, text: 'Complete', color: 'var(--noir-profit)', bg: 'rgba(92, 184, 92, 0.15)' },
    progress: { icon: Clock, text: 'In Progress', color: 'var(--noir-primary)', bg: 'rgba(var(--noir-primary-rgb), 0.12)' },
    locked: { icon: Lock, text: 'Locked', color: 'var(--noir-muted)', bg: 'rgba(113, 113, 122, 0.15)' }
  };
  
  const config = configs[status] || configs.locked;
  const Icon = config.icon;
  
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 12px',
      background: config.bg,
      border: `1.5px solid ${config.color}`,
      borderRadius: '4px',
      color: config.color,
      fontSize: '0.85rem',
      fontWeight: 600
    }}>
      <Icon size={14} />
      <span>{config.text}</span>
    </div>
  );
}

// Seal for completed territories
function WaxSeal() {
  return (
    <div style={{
      position: 'absolute',
      top: '-8px',
      right: '-8px',
      width: '32px',
      height: '32px',
      background: 'var(--noir-profit)',
      borderRadius: '50%',
      border: '2px solid rgba(255,255,255,0.3)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      fontSize: '0.9rem',
      fontWeight: 'bold'
    }}>
      ✓
    </div>
  );
}

// Territory entry component
function TerritoryEntry({ territory, missions, onClick, index }) {
  const territoryMissions = missions.filter(m => m.area === territory.name);
  const completed = territoryMissions.filter(m => m.completed).length;
  const total = territoryMissions.length;
  const isComplete = completed === total && total > 0;
  const inProgress = completed > 0 && completed < total;
  const isLocked = !territoryMissions.some(m => m.requirements_met && !m.completed);
  
  const status = isComplete ? 'complete' : inProgress ? 'progress' : 'locked';
  
  return (
    <div 
      className={`fade-in ${styles.panel}`}
      style={{
        animationDelay: `${index * 0.1}s`,
        padding: '20px',
        marginBottom: '16px',
        position: 'relative',
        cursor: isLocked && total === 0 ? 'default' : 'pointer',
        transition: 'all 0.2s ease',
        opacity: isLocked && total === 0 ? 0.7 : 1
      }}
      onClick={() => total > 0 && onClick(territory.name)}
      onMouseEnter={(e) => {
        if (total > 0) e.currentTarget.style.borderColor = 'rgba(var(--noir-primary-rgb), 0.5)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '';
      }}
    >
      {isComplete && <WaxSeal />}
      
      <div style={{
        fontSize: '1.15rem',
        fontWeight: 700,
        color: 'var(--noir-foreground)',
        marginBottom: '12px',
        borderBottom: '1px solid var(--noir-border-mid)',
        paddingBottom: '8px'
      }}>
        {territory.name} — {territory.description || 'Area'}
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '8px 0',
          borderBottom: '1px dashed rgba(var(--noir-primary-rgb), 0.25)',
          color: 'var(--noir-foreground)',
          fontSize: '0.9rem'
        }}>
          <span style={{ fontWeight: 600, color: 'var(--noir-primary)' }}>Status:</span>
          <StatusBadge status={status} />
        </div>
        
        {territory.dailyTribute != null && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '10px 0',
            borderBottom: '1px dashed rgba(var(--noir-primary-rgb), 0.3)',
            color: 'var(--noir-foreground)',
            fontSize: '0.95rem'
          }}>
            <span style={{ fontWeight: 600, color: 'var(--noir-primary)' }}>Daily Tribute:</span>
            <span style={{ fontWeight: 700, color: isComplete ? 'var(--noir-profit)' : 'var(--noir-primary)' }}>
              {fmt(territory.dailyTribute)}
            </span>
          </div>
        )}
        
        {territory.capo && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '8px 0',
            borderBottom: '1px dashed rgba(var(--noir-primary-rgb), 0.25)',
            color: 'var(--noir-foreground)',
            fontSize: '0.9rem'
          }}>
            <span style={{ fontWeight: 600, color: 'var(--noir-primary)' }}>Capo:</span>
            <span style={{ fontWeight: 600 }}>{territory.capo}</span>
          </div>
        )}
        
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '8px 0',
          color: 'var(--noir-foreground)',
          fontSize: '0.9rem'
        }}>
          <span style={{ fontWeight: 600, color: 'var(--noir-primary)' }}>Missions:</span>
          <span style={{ fontWeight: 600 }}>
            {completed}/{total} Complete
            {total > 0 && !isComplete && !isLocked && (
              <span style={{ marginLeft: '10px', color: 'var(--noir-primary)', fontSize: '0.9rem' }}>
                [Ready to complete]
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

// Mission modal component
function MissionModal({ city, territory, missions, onClose, onStart, starting }) {
  const territoryMissions = missions.filter(m => m.area === territory);
  const currentMission = territoryMissions.find(m => !m.completed && m.requirements_met) || territoryMissions[0];
  
  if (!currentMission) return null;
  
  const stars = currentMission.difficulty >= 8 ? 3 : currentMission.difficulty >= 5 ? 2 : 1;
  const canStart = currentMission && !currentMission.completed && currentMission.requirements_met;
  
  return (
    <div 
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.8)',
        backdropFilter: 'blur(4px)',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div 
        className={`fade-in ${styles.panel}`}
        style={{
          width: '100%',
          maxWidth: '600px',
          maxHeight: '85vh',
          overflowY: 'auto',
          borderRadius: '6px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          background: 'rgba(var(--noir-primary-rgb), 0.1)',
          borderBottom: '1px solid var(--noir-border-mid)',
          position: 'relative'
        }}>
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              padding: '6px',
              background: 'transparent',
              border: '1px solid var(--noir-border-mid)',
              borderRadius: '4px',
              color: 'var(--noir-foreground)',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(var(--noir-primary-rgb), 0.2)';
              e.currentTarget.style.borderColor = 'var(--noir-primary)';
              e.currentTarget.style.color = 'var(--noir-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = '';
              e.currentTarget.style.color = '';
            }}
          >
            <X size={18} />
          </button>
          
          <div style={{
            fontSize: '1.25rem',
            fontWeight: 700,
            color: 'var(--noir-primary)',
            marginBottom: '4px',
            paddingRight: '40px'
          }}>
            {territory}
          </div>
          <div style={{
            fontSize: '0.9rem',
            color: 'var(--noir-muted)'
          }}>
            {city}
          </div>
        </div>
        
        {/* Mission list */}
        <div style={{ padding: '20px 24px' }}>
          {territoryMissions.map((mission, idx) => (
            <div
              key={mission.id}
              style={{
                padding: '12px 14px',
                marginBottom: '10px',
                background: mission.completed 
                  ? 'rgba(92, 184, 92, 0.08)' 
                  : 'rgba(var(--noir-primary-rgb), 0.04)',
                border: mission.completed 
                  ? '1px solid var(--noir-profit)' 
                  : '1px solid var(--noir-border-mid)',
                borderRadius: '4px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'start', gap: '10px' }}>
                <div style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  border: mission.completed ? '2px solid var(--noir-profit)' : '2px solid var(--noir-border-mid)',
                  background: mission.completed ? 'var(--noir-profit)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: '2px'
                }}>
                  {mission.completed && <CheckCircle size={10} color="#fff" />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontWeight: 600,
                    fontSize: '0.95rem',
                    color: mission.completed ? 'var(--noir-profit)' : 'var(--noir-foreground)',
                    marginBottom: '4px'
                  }}>
                    {mission.title}
                  </div>
                  {!mission.completed && mission.description && (
                    <div style={{
                      fontSize: '0.85rem',
                      color: 'var(--noir-muted)',
                      lineHeight: 1.5
                    }}>
                      {mission.description}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        
        {/* Current mission details */}
        {currentMission && (
          <div style={{
            padding: '20px 24px',
            borderTop: '1px solid var(--noir-border-mid)',
            background: 'rgba(var(--noir-primary-rgb), 0.06)'
          }}>
            <div style={{
              fontSize: '0.85rem',
              fontWeight: 700,
              color: 'var(--noir-primary)',
              marginBottom: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em'
            }}>
              Mission Brief
            </div>
            
            {currentMission.description && (
              <div style={{
                fontSize: '0.9rem',
                color: 'var(--noir-foreground)',
                lineHeight: 1.6,
                marginBottom: '12px',
                paddingLeft: '12px',
                borderLeft: '3px solid var(--noir-primary)'
              }}>
                {currentMission.description}
              </div>
            )}
            
            {currentMission.progress?.description && !currentMission.completed && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.9rem',
                padding: '8px 0',
                borderBottom: '1px dashed rgba(var(--noir-primary-rgb), 0.3)'
              }}>
                <span style={{ color: 'var(--noir-primary)', fontWeight: 600 }}>Progress:</span>
                <span style={{ color: 'var(--noir-foreground)', fontWeight: 500 }}>{currentMission.progress.description}</span>
              </div>
            )}
            
            {currentMission.reward_money > 0 && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.95rem',
                padding: '10px 0',
                borderBottom: '1px dashed rgba(var(--noir-primary-rgb), 0.3)'
              }}>
                <span style={{ color: 'var(--noir-primary)', fontWeight: 600 }}>Daily Tribute:</span>
                <span style={{ color: 'var(--noir-profit)', fontWeight: 700 }}>
                  {fmt(currentMission.reward_money)} cash
                </span>
              </div>
            )}
            
            {currentMission.reward_points > 0 && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.9rem',
                padding: '8px 0',
                borderBottom: '1px dashed rgba(var(--noir-primary-rgb), 0.3)'
              }}>
                <span style={{ color: 'var(--noir-primary)', fontWeight: 600 }}>Rank Points:</span>
                <span style={{ color: 'var(--noir-primary)', fontWeight: 700 }}>+{currentMission.reward_points} RP</span>
              </div>
            )}
            
            {currentMission.unlocks_city && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.95rem',
                padding: '10px 0',
                borderBottom: '1px dashed #c9a668'
              }}>
                <span style={{ color: 'var(--noir-primary)', fontWeight: 600 }}>Unlocks City:</span>
                <span style={{ color: 'var(--noir-primary)', fontWeight: 700 }}>{currentMission.unlocks_city}</span>
              </div>
            )}
            
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.9rem',
              padding: '8px 0'
            }}>
              <span style={{ color: 'var(--noir-primary)', fontWeight: 600 }}>Difficulty:</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[...Array(3)].map((_, i) => (
                  <Crown
                    key={i}
                    size={14}
                    fill={i < stars ? 'var(--noir-primary)' : 'none'}
                    color={i < stars ? 'var(--noir-primary)' : 'var(--noir-muted)'}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        
        {/* Action button */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid var(--noir-border-mid)'
        }}>
          {currentMission?.completed ? (
            <div style={{
              textAlign: 'center',
              padding: '12px',
              color: 'var(--noir-profit)',
              fontWeight: 600,
              fontSize: '0.95rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}>
              <CheckCircle size={18} />
              Complete
            </div>
          ) : canStart ? (
            <button
              onClick={() => onStart(currentMission.id)}
              disabled={starting}
              className={styles.panel}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: 'rgba(var(--noir-primary-rgb), 0.2)',
                border: '1px solid var(--noir-primary)',
                borderRadius: '4px',
                color: 'var(--noir-primary)',
                fontWeight: 600,
                fontSize: '0.95rem',
                cursor: starting ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
                opacity: starting ? 0.6 : 1
              }}
              onMouseEnter={(e) => {
                if (!starting) {
                  e.currentTarget.style.background = 'rgba(var(--noir-primary-rgb), 0.3)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(var(--noir-primary-rgb), 0.2)';
              }}
            >
              {starting ? 'Completing...' : 'Complete Mission'}
            </button>
          ) : (
            <div style={{
              textAlign: 'center',
              padding: '12px',
              color: 'var(--noir-muted)',
              fontWeight: 500,
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}>
              <Lock size={16} />
              Meet requirements to unlock
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Main component
export default function Missions() {
  const [data, setData] = useState(null);
  const [missions, setMissions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState(null);
  const [selectedTerritory, setSelectedTerritory] = useState(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const [mapData, missionsData] = await Promise.all([
          api.get('/missions/map'),
          api.get('/missions')
        ]);
        if (!cancel) {
          setData(mapData.data);
          setMissions(missionsData.data);
          setCity(mapData.data?.current_city || mapData.data?.unlocked_cities?.[0] || 'Chicago');
        }
      } catch (e) {
        if (!cancel) toast.error('Failed to load missions');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  const startMission = async (missionId) => {
    setStarting(true);
    try {
      const res = await api.post('/missions/complete', { mission_id: missionId });
      if (res.data?.completed) {
        const rewards = [];
        if (res.data.reward_money > 0) rewards.push(`+${fmt(res.data.reward_money)} daily tribute`);
        if (res.data.reward_points > 0) rewards.push(`+${res.data.reward_points} respect`);
        if (res.data.unlocked_city) rewards.push(`${res.data.unlocked_city} territory unlocked`);
        
        toast.success(rewards.length ? rewards.join(' • ') : 'Operation complete');
        refreshUser();
        
        const [mapData, missionsData] = await Promise.all([
          api.get('/missions/map'),
          api.get('/missions')
        ]);
        setData(mapData.data);
        setMissions(missionsData.data);
        
        if (res.data.unlocked_city) {
          setCity(res.data.unlocked_city);
          setSelectedTerritory(null);
        }
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Operation failed');
    } finally {
      setStarting(false);
    }
  };

  if (loading || !data) {
    return (
      <div className={styles.pageContent} style={{ minHeight: '100vh', padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{STYLES}</style>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px'
        }}>
          <BookOpen size={40} className="text-primary" style={{ color: 'var(--noir-primary)' }} />
          <div style={{
            width: '50px',
            height: '50px',
            border: '3px solid var(--noir-primary)',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  const unlocked = data?.unlocked_cities?.length ? data.unlocked_cities : ['Chicago'];
  const byCity = data?.by_city || {};
  const cityMissions = (city && byCity[city]?.missions) || [];
  
  // Map districts from actual mission data
  const districtNames = [...new Set(cityMissions.map(m => m.area))];
  const territories = districtNames.map(name => ({
    name,
    description: name.includes('Loop') ? 'Downtown Operations' :
                 name.includes('South') ? 'Industrial District' :
                 name.includes('North') ? 'Expansion Territory' :
                 name.includes('West') ? 'Contested Territory' :
                 name.includes('Stock') ? 'Meatpacking District' :
                 name.includes('Near') ? 'Lakefront Territory' : 'Territory',
    dailyTribute: cityMissions.filter(m => m.area === name).reduce((s, m) => s + (m.reward_money || 0), 0),
    capo: null,
    soldiers: 0
  }));

  const completedCount = cityMissions.filter(m => m.completed).length;
  const totalTribute = territories.reduce((sum, t) => {
    const territoryMissions = cityMissions.filter(m => m.area === t.name);
    const allComplete = territoryMissions.length > 0 && territoryMissions.every(m => m.completed);
    return sum + (allComplete ? (t.dailyTribute || 0) : 0);
  }, 0);

  return (
    <div className={styles.pageContent} style={{ minHeight: '100vh', padding: '20px', position: 'relative' }}>
      <style>{STYLES}</style>
      
      {/* Header */}
      <div className={`fade-in ${styles.panel}`} style={{
        maxWidth: '900px',
        margin: '0 auto 24px',
        padding: '24px 28px',
        position: 'relative'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: '1.5rem',
            fontWeight: 700,
            color: 'var(--noir-primary)',
            marginBottom: '6px',
            letterSpacing: '0.05em',
            textTransform: 'uppercase'
          }}>
            Missions — Daily Tribute
          </div>
          <div style={{
            fontSize: '0.9rem',
            color: 'var(--noir-muted)',
            marginTop: '4px'
          }}>
            Complete operations in each area to earn cash and RP. Rewards are your daily tribute.
          </div>
        </div>
      </div>
      
      {/* City selector */}
      {unlocked.length > 1 && (
        <div className="fade-in" style={{
          maxWidth: '900px',
          margin: '0 auto 20px',
          display: 'flex',
          gap: '10px',
          flexWrap: 'wrap',
          justifyContent: 'center',
          animationDelay: '0.1s'
        }}>
          {unlocked.map(c => (
            <button
              key={c}
              onClick={() => setCity(c)}
              className={styles.panel}
              style={{
                padding: '10px 22px',
                background: city === c ? 'rgba(var(--noir-primary-rgb), 0.2)' : 'transparent',
                border: `1px solid ${city === c ? 'var(--noir-primary)' : 'var(--noir-border-mid)'}`,
                borderRadius: '4px',
                color: city === c ? 'var(--noir-primary)' : 'var(--noir-foreground)',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                if (city !== c) {
                  e.currentTarget.style.borderColor = 'var(--noir-primary)';
                  e.currentTarget.style.color = 'var(--noir-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (city !== c) {
                  e.currentTarget.style.borderColor = '';
                  e.currentTarget.style.color = '';
                }
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      
      {/* Status summary */}
      <div className={`fade-in ${styles.panel}`} style={{
        maxWidth: '900px',
        margin: '0 auto 24px',
        padding: '20px 24px',
        animationDelay: '0.2s'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '20px',
          color: 'var(--noir-foreground)'
        }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--noir-muted)', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Missions Complete
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--noir-primary)' }}>
              {completedCount}/{cityMissions.length}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--noir-muted)', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Daily Tribute
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--noir-profit)' }}>
              {fmt(totalTribute)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--noir-muted)', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Current City
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--noir-primary)' }}>
              {city}
            </div>
          </div>
        </div>
      </div>
      
      {/* Ledger pages */}
      <div className="page-flip" style={{
        maxWidth: '900px',
        margin: '0 auto'
      }}>
        {territories.map((territory, index) => (
          <TerritoryEntry
            key={territory.name}
            territory={territory}
            missions={cityMissions}
            onClick={setSelectedTerritory}
            index={index}
          />
        ))}
      </div>
      
      {/* Summary */}
      <div className={`fade-in ${styles.panel}`} style={{
        maxWidth: '900px',
        margin: '40px auto 0',
        padding: '24px',
        borderLeft: '4px solid var(--noir-primary)',
        animationDelay: '0.8s'
      }}>
        <div style={{ marginBottom: '10px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--noir-primary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Summary
        </div>
        <div style={{ color: 'var(--noir-foreground)', fontSize: '0.95rem', lineHeight: 1.6 }}>
          {city}: {completedCount}/{cityMissions.length} missions complete.
          {totalTribute > 0 && <> Total daily tribute from this city: {fmt(totalTribute)} cash.</>}
          {completedCount < cityMissions.length
            ? ' Complete missions in each area to earn your tribute and unlock the next city.'
            : ' All operations here are complete. Unlock more cities by finishing the final mission.'}
        </div>
      </div>
      
      {/* Mission modal */}
      {selectedTerritory && (
        <MissionModal
          city={city}
          territory={selectedTerritory}
          missions={cityMissions}
          onClose={() => setSelectedTerritory(null)}
          onStart={startMission}
          starting={starting}
        />
      )}
    </div>
  );
}
