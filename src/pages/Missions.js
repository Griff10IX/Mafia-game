import { useState, useEffect } from 'react';
import { BookOpen, X, Crown, Users, Shield, Clock, Lock, CheckCircle } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';

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
    complete: { icon: CheckCircle, text: 'Under Our Protection', color: '#2d5016', bg: 'rgba(45, 80, 22, 0.15)' },
    progress: { icon: Clock, text: 'Negotiations in Progress', color: '#b8860b', bg: 'rgba(184, 134, 11, 0.15)' },
    locked: { icon: Lock, text: 'Awaiting Family Approval', color: '#71717a', bg: 'rgba(113, 113, 122, 0.15)' }
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

// Wax seal component for completed territories
function WaxSeal() {
  return (
    <div className="wax-seal" style={{
      position: 'absolute',
      top: '-15px',
      right: '-15px',
      width: '50px',
      height: '50px',
      background: 'radial-gradient(circle, #8b1a1a 0%, #660000 70%)',
      borderRadius: '50%',
      border: '3px solid #4a0000',
      boxShadow: '0 4px 15px rgba(139, 26, 26, 0.6), inset 0 2px 5px rgba(255,255,255,0.2)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#ffd700',
      fontSize: '1.5rem',
      fontWeight: 'bold',
      fontFamily: 'Crimson Text, serif',
      transform: 'rotate(-15deg)'
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
      className="fade-in"
      style={{
        animationDelay: `${index * 0.1}s`,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.7) 0%, rgba(232,220,200,0.6) 100%)',
        border: '2.5px solid #654321',
        borderRadius: '8px',
        padding: '25px',
        marginBottom: '25px',
        position: 'relative',
        boxShadow: '0 6px 20px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.5)',
        cursor: isLocked && total === 0 ? 'default' : 'pointer',
        transition: 'all 0.3s ease',
        opacity: isLocked && total === 0 ? 0.6 : 1
      }}
      onClick={() => total > 0 && onClick(territory.name)}
      onMouseEnter={(e) => {
        if (total > 0) {
          e.currentTarget.style.transform = 'translateX(3px)';
          e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.5)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateX(0)';
        e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.5)';
      }}
    >
      {isComplete && <WaxSeal />}
      
      <div style={{
        fontSize: '1.5rem',
        fontWeight: 700,
        color: '#2d1810',
        marginBottom: '15px',
        borderBottom: '2px solid #d4af37',
        paddingBottom: '10px',
        fontFamily: 'Crimson Text, serif',
        letterSpacing: '0.5px'
      }}>
        {territory.name} — {territory.description || 'Territory'}
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '10px 0',
          borderBottom: '1px dashed #c9a668',
          color: '#3e2723',
          fontSize: '1.05rem',
          fontFamily: 'Cormorant Garamond, serif'
        }}>
          <span style={{ fontWeight: 600, color: '#654321' }}>Status:</span>
          <StatusBadge status={status} />
        </div>
        
        {territory.weeklyTribute && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '10px 0',
            borderBottom: '1px dashed #c9a668',
            color: '#3e2723',
            fontSize: '1.05rem',
            fontFamily: 'Cormorant Garamond, serif'
          }}>
            <span style={{ fontWeight: 600, color: '#654321' }}>Weekly Tribute:</span>
            <span style={{ fontWeight: 700, color: isComplete ? '#2d5016' : '#b8860b' }}>
              {fmt(territory.weeklyTribute)}
            </span>
          </div>
        )}
        
        {territory.capo && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '10px 0',
            borderBottom: '1px dashed #c9a668',
            color: '#3e2723',
            fontSize: '1.05rem',
            fontFamily: 'Cormorant Garamond, serif'
          }}>
            <span style={{ fontWeight: 600, color: '#654321' }}>Capo:</span>
            <span style={{ fontWeight: 600 }}>{territory.capo}</span>
          </div>
        )}
        
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '10px 0',
          color: '#3e2723',
          fontSize: '1.05rem',
          fontFamily: 'Cormorant Garamond, serif'
        }}>
          <span style={{ fontWeight: 600, color: '#654321' }}>Operations:</span>
          <span style={{ fontWeight: 600 }}>
            {completed}/{total} Complete
            {total > 0 && !isComplete && !isLocked && (
              <span style={{ marginLeft: '10px', color: '#d4af37', fontSize: '0.9rem' }}>
                [Sit-Down Available]
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
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(4px)',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div 
        className="fade-in"
        style={{
          width: '100%',
          maxWidth: '600px',
          maxHeight: '85vh',
          overflowY: 'auto',
          background: 'linear-gradient(135deg, #f5f1e8 0%, #e8dcc8 100%)',
          border: '4px double #654321',
          borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          fontFamily: 'Cormorant Garamond, serif'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '25px 30px',
          background: 'linear-gradient(135deg, #654321 0%, #4a3428 100%)',
          borderBottom: '3px double #d4af37',
          position: 'relative'
        }}>
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '15px',
              right: '15px',
              padding: '8px',
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid #d4af37',
              borderRadius: '4px',
              color: '#d4af37',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#d4af37';
              e.currentTarget.style.color = '#1a1410';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(0,0,0,0.3)';
              e.currentTarget.style.color = '#d4af37';
            }}
          >
            <X size={18} />
          </button>
          
          <div style={{
            fontSize: '1.6rem',
            fontWeight: 700,
            color: '#d4af37',
            marginBottom: '8px',
            fontFamily: 'Crimson Text, serif',
            paddingRight: '50px'
          }}>
            {territory}
          </div>
          <div style={{
            fontSize: '1rem',
            color: '#c9a668',
            fontStyle: 'italic'
          }}>
            {city}
          </div>
        </div>
        
        {/* Mission list */}
        <div style={{ padding: '25px 30px' }}>
          {territoryMissions.map((mission, idx) => (
            <div
              key={mission.id}
              style={{
                padding: '15px',
                marginBottom: '15px',
                background: mission.completed 
                  ? 'rgba(45, 80, 22, 0.1)' 
                  : 'rgba(101, 67, 33, 0.05)',
                border: mission.completed 
                  ? '2px solid #2d5016' 
                  : '1px solid #c9a668',
                borderRadius: '6px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'start', gap: '12px' }}>
                <div style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  border: mission.completed ? '2px solid #2d5016' : '2px solid #654321',
                  background: mission.completed ? '#2d5016' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: '2px'
                }}>
                  {mission.completed && <CheckCircle size={12} color="#fff" />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontWeight: 700,
                    fontSize: '1.1rem',
                    color: mission.completed ? '#2d5016' : '#2d1810',
                    marginBottom: '6px'
                  }}>
                    {mission.title}
                  </div>
                  {!mission.completed && mission.description && (
                    <div style={{
                      fontSize: '0.95rem',
                      color: '#654321',
                      lineHeight: 1.6,
                      fontStyle: 'italic'
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
            padding: '25px 30px',
            borderTop: '2px solid #c9a668',
            background: 'rgba(212, 175, 55, 0.08)'
          }}>
            <div style={{
              fontSize: '1.2rem',
              fontWeight: 700,
              color: '#654321',
              marginBottom: '15px',
              fontFamily: 'Crimson Text, serif'
            }}>
              Consigliere's Brief:
            </div>
            
            {currentMission.description && (
              <div style={{
                fontSize: '1rem',
                color: '#3e2723',
                fontStyle: 'italic',
                lineHeight: 1.7,
                marginBottom: '15px',
                paddingLeft: '15px',
                borderLeft: '3px solid #d4af37'
              }}>
                "{currentMission.description}"
              </div>
            )}
            
            {currentMission.progress?.description && !currentMission.completed && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.95rem',
                padding: '10px 0',
                borderBottom: '1px dashed #c9a668'
              }}>
                <span style={{ color: '#654321', fontWeight: 600 }}>Progress:</span>
                <span style={{ color: '#3e2723', fontWeight: 600 }}>{currentMission.progress.description}</span>
              </div>
            )}
            
            {currentMission.reward_money > 0 && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.95rem',
                padding: '10px 0',
                borderBottom: '1px dashed #c9a668'
              }}>
                <span style={{ color: '#654321', fontWeight: 600 }}>Weekly Tribute:</span>
                <span style={{ color: '#2d5016', fontWeight: 700 }}>
                  Adds {fmt(currentMission.reward_money)} to family coffers
                </span>
              </div>
            )}
            
            {currentMission.reward_points > 0 && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.95rem',
                padding: '10px 0',
                borderBottom: '1px dashed #c9a668'
              }}>
                <span style={{ color: '#654321', fontWeight: 600 }}>Respect Points:</span>
                <span style={{ color: '#d4af37', fontWeight: 700 }}>+{currentMission.reward_points} RP</span>
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
                <span style={{ color: '#654321', fontWeight: 600 }}>Unlocks Territory:</span>
                <span style={{ color: '#d4af37', fontWeight: 700 }}>{currentMission.unlocks_city}</span>
              </div>
            )}
            
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.95rem',
              padding: '10px 0'
            }}>
              <span style={{ color: '#654321', fontWeight: 600 }}>Difficulty:</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[...Array(3)].map((_, i) => (
                  <Crown
                    key={i}
                    size={14}
                    fill={i < stars ? '#d4af37' : 'none'}
                    color={i < stars ? '#d4af37' : '#c9a668'}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        
        {/* Action button */}
        <div style={{
          padding: '20px 30px',
          borderTop: '2px solid #c9a668'
        }}>
          {currentMission?.completed ? (
            <div style={{
              textAlign: 'center',
              padding: '15px',
              color: '#2d5016',
              fontWeight: 700,
              fontSize: '1.1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px'
            }}>
              <CheckCircle size={20} />
              Operation Complete
            </div>
          ) : canStart ? (
            <button
              onClick={() => onStart(currentMission.id)}
              disabled={starting}
              style={{
                width: '100%',
                padding: '16px',
                background: 'linear-gradient(135deg, #d4af37 0%, #b8860b 100%)',
                border: '2px solid #8b6914',
                borderRadius: '8px',
                color: '#1a1410',
                fontWeight: 700,
                fontSize: '1.1rem',
                fontFamily: 'Crimson Text, serif',
                cursor: starting ? 'not-allowed' : 'pointer',
                transition: 'all 0.3s ease',
                letterSpacing: '0.5px',
                boxShadow: '0 4px 15px rgba(212, 175, 55, 0.3)',
                opacity: starting ? 0.6 : 1
              }}
              onMouseEnter={(e) => {
                if (!starting) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(212, 175, 55, 0.5)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 15px rgba(212, 175, 55, 0.3)';
              }}
            >
              {starting ? 'Arranging...' : 'Arrange Sit-Down'}
            </button>
          ) : (
            <div style={{
              textAlign: 'center',
              padding: '15px',
              color: '#71717a',
              fontWeight: 600,
              fontSize: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px'
            }}>
              <Lock size={18} />
              Requires Family Approval
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
        if (!cancel) toast.error('Failed to load family business records');
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
        if (res.data.reward_money > 0) rewards.push(`+${fmt(res.data.reward_money)} weekly tribute`);
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
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1a1410 0%, #2d1810 100%)',
        padding: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <style>{STYLES}</style>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px'
        }}>
          <BookOpen size={40} color="#d4af37" />
          <div style={{
            width: '50px',
            height: '50px',
            border: '3px solid #d4af37',
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
    weeklyTribute: Math.floor(Math.random() * 30000) + 20000, // Placeholder
    capo: null,
    soldiers: 0
  }));

  const completedCount = cityMissions.filter(m => m.completed).length;
  const totalTribute = territories.reduce((sum, t) => {
    const territoryMissions = cityMissions.filter(m => m.area === t.name);
    const allComplete = territoryMissions.length > 0 && territoryMissions.every(m => m.completed);
    return sum + (allComplete ? t.weeklyTribute : 0);
  }, 0);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a1410 0%, #2d1810 100%)',
      padding: '20px',
      fontFamily: 'Cormorant Garamond, serif',
      position: 'relative'
    }}>
      <style>{STYLES}</style>
      
      {/* Atmospheric cigar smoke */}
      <div className="cigar-smoke" style={{ top: '10%', left: '5%', animationDelay: '0s' }} />
      <div className="cigar-smoke" style={{ top: '60%', right: '8%', animationDelay: '2s' }} />
      <div className="cigar-smoke" style={{ bottom: '20%', left: '15%', animationDelay: '4s' }} />
      
      {/* Header */}
      <div className="fade-in" style={{
        maxWidth: '900px',
        margin: '0 auto 30px',
        padding: '35px 40px',
        background: 'linear-gradient(135deg, #f5f1e8 0%, #e8dcc8 100%)',
        border: '4px double #654321',
        borderRadius: '12px',
        boxShadow: '0 15px 50px rgba(0,0,0,0.6)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Ledger lines texture */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 30px, rgba(101, 67, 33, 0.08) 30px, rgba(101, 67, 33, 0.08) 31px)',
          pointerEvents: 'none'
        }} />
        
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
          <div style={{
            fontSize: '2.5rem',
            fontWeight: 700,
            color: '#2d1810',
            marginBottom: '12px',
            fontFamily: 'Crimson Text, serif',
            letterSpacing: '1px',
            textShadow: '2px 2px 0 rgba(212, 175, 55, 0.2)'
          }}>
            🤵 THE CORLEONE FAMILY BUSINESS LEDGER 🤵
          </div>
          <div style={{
            fontSize: '1.2rem',
            color: '#654321',
            fontStyle: 'italic',
            marginBottom: '8px'
          }}>
            Consigliere's Office — Private Records
          </div>
          <div style={{
            fontSize: '0.95rem',
            color: '#8b6914',
            fontWeight: 600
          }}>
            "This is the business we've chosen"
          </div>
        </div>
      </div>
      
      {/* City selector */}
      {unlocked.length > 1 && (
        <div className="fade-in" style={{
          maxWidth: '900px',
          margin: '0 auto 25px',
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
          justifyContent: 'center',
          animationDelay: '0.1s'
        }}>
          {unlocked.map(c => (
            <button
              key={c}
              onClick={() => setCity(c)}
              style={{
                padding: '12px 28px',
                background: city === c 
                  ? 'linear-gradient(135deg, #d4af37 0%, #b8860b 100%)'
                  : 'linear-gradient(135deg, #3e2723 0%, #2d1810 100%)',
                border: `2px solid ${city === c ? '#8b6914' : '#654321'}`,
                borderRadius: '8px',
                color: city === c ? '#1a1410' : '#d4af37',
                fontWeight: 700,
                fontSize: '1.05rem',
                fontFamily: 'Crimson Text, serif',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                boxShadow: city === c 
                  ? '0 4px 15px rgba(212, 175, 55, 0.4)'
                  : '0 2px 8px rgba(0,0,0,0.3)',
                letterSpacing: '0.5px'
              }}
              onMouseEnter={(e) => {
                if (city !== c) {
                  e.currentTarget.style.borderColor = '#d4af37';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }
              }}
              onMouseLeave={(e) => {
                if (city !== c) {
                  e.currentTarget.style.borderColor = '#654321';
                  e.currentTarget.style.transform = 'translateY(0)';
                }
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      
      {/* Family status summary */}
      <div className="fade-in" style={{
        maxWidth: '900px',
        margin: '0 auto 30px',
        padding: '25px 30px',
        background: 'linear-gradient(135deg, rgba(212, 175, 55, 0.15) 0%, rgba(139, 105, 20, 0.1) 100%)',
        border: '2px solid #d4af37',
        borderRadius: '10px',
        animationDelay: '0.2s'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '20px',
          color: '#f5f1e8'
        }}>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#c9a668', marginBottom: '6px', fontWeight: 600 }}>
              OPERATIONS COMPLETE
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#d4af37', fontFamily: 'Crimson Text, serif' }}>
              {completedCount}/{cityMissions.length}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#c9a668', marginBottom: '6px', fontWeight: 600 }}>
              WEEKLY TRIBUTE
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#2d5016', fontFamily: 'Crimson Text, serif' }}>
              {fmt(totalTribute)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#c9a668', marginBottom: '6px', fontWeight: 600 }}>
              CURRENT TERRITORY
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#d4af37', fontFamily: 'Crimson Text, serif' }}>
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
      
      {/* Consigliere's note */}
      <div className="fade-in ink-drop" style={{
        maxWidth: '900px',
        margin: '40px auto 0',
        padding: '30px',
        background: 'rgba(212, 175, 55, 0.12)',
        borderLeft: '5px solid #d4af37',
        borderRadius: '6px',
        fontStyle: 'italic',
        lineHeight: 1.8,
        color: '#f5f1e8',
        fontSize: '1.05rem',
        animationDelay: '0.8s',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
      }}>
        <div style={{ marginBottom: '15px', fontSize: '1.15rem', fontWeight: 600, color: '#d4af37' }}>
          Consigliere's Notes:
        </div>
        <div>
          "Don Corleone, the family's interests continue to expand across {city}. Our operations bring in {fmt(totalTribute)} weekly, 
          strengthening the family's position with each passing day.
          <br /><br />
          {completedCount < cityMissions.length 
            ? 'Several territories still require your personal attention. I recommend we proceed with the sit-downs carefully - each arrangement must show both our strength and our respect for tradition.'
            : 'You have secured all available operations in this territory. The family grows stronger. Perhaps it is time to consider expansion into new cities.'}
          <br /><br />
          Remember, Don Corleone: in this business, we keep our friends close, but our enemies closer."
        </div>
        <div style={{
          marginTop: '20px',
          textAlign: 'right',
          fontWeight: 700,
          color: '#d4af37',
          fontSize: '1.1rem',
          fontFamily: 'Crimson Text, serif'
        }}>
          — Tom Hagen, Consigliere
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
