"""Patch ChickenCrossPage.js to Betway-style board (barriers, coins, kill car)."""
from pathlib import Path

PAGE = Path(__file__).resolve().parents[2] / "src" / "pages" / "Casinos" / "ChickenCrossPage.js"
text = PAGE.read_text(encoding="utf-8")

NEW_HEAD = r'''const ASSET = {
  idle: publicAsset('/images/chicken-cross/chicken-idle.png'),
  hop: publicAsset('/images/chicken-cross/chicken-hop.png'),
  hit: publicAsset('/images/chicken-cross/chicken-hit.png'),
  coin: publicAsset('/images/chicken-cross/coin.png'),
  barrier: publicAsset('/images/chicken-cross/barrier.png'),
  bush: publicAsset('/images/chicken-cross/bush.png'),
  cars: [
    publicAsset('/images/chicken-cross/car-sedan.png'),
    publicAsset('/images/chicken-cross/car-taxi.png'),
    publicAsset('/images/chicken-cross/car-truck.png'),
    publicAsset('/images/chicken-cross/car-sport.png'),
  ],
};

const HOP_MS = 300;
const HIT_MS = 520;
const VISIBLE_AHEAD = 6;
const CLEARED_KEEP = 2;
const QUICK_BETS = [1_000_000, 100_000_000, 1_000_000_000];

const PAGE_STYLES = `
  .cc-fade-in { animation: cc-fade-in 0.45s ease-out both; }
  @keyframes cc-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes cc-shine { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
  .cc-title {
    background: linear-gradient(105deg, var(--noir-primary-dark) 0%, var(--noir-primary-bright) 35%, #fff8d6 48%, var(--noir-primary-bright) 58%, var(--noir-primary-dark) 100%);
    background-size: 200% auto;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: cc-shine 8s ease-in-out infinite alternate;
  }
  .cc-touch { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  .cc-stage { display: grid; gap: 1rem; align-items: stretch; }
  .cc-controls { order: 2; }
  .cc-board-wrap { order: 1; min-width: 0; }
  @media (min-width: 1024px) {
    .cc-stage { grid-template-columns: minmax(17rem, 19.5rem) minmax(0, 1fr); }
    .cc-controls { order: 1; }
    .cc-board-wrap { order: 2; }
  }
  .cc-board {
    position: relative; width: 100%; min-height: 20rem; height: clamp(20rem, 52vw, 28rem);
    overflow: hidden; border-radius: 1rem; isolation: isolate;
    background:
      radial-gradient(ellipse at 50% 0%, rgba(80,100,160,0.22), transparent 50%),
      linear-gradient(180deg, #1a2450 0%, #141c3c 40%, #0e1430 100%);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06), 0 18px 40px rgba(0,0,0,0.35);
  }
  @media (min-width: 1024px) { .cc-board { min-height: 28rem; height: 28rem; } }
  .cc-strip {
    position: absolute; inset: 0; display: grid; grid-auto-flow: column;
    grid-auto-columns: 1fr; width: 100%; height: 100%;
  }
  .cc-cell { position: relative; height: 100%; min-width: 0; overflow: hidden; container-type: size; background: #1a2450; }
  .cc-cell.cc-road {
    background:
      linear-gradient(90deg, rgba(255,255,255,0.07) 0 1px, transparent 1px),
      linear-gradient(90deg, transparent calc(50% - 1.5px), rgba(255,255,255,0.55) calc(50% - 1.5px) calc(50% + 1.5px), transparent calc(50% + 1.5px)),
      repeating-linear-gradient(180deg, transparent 0 26px, rgba(255,255,255,0.5) 26px 42px, transparent 42px 68px),
      linear-gradient(180deg, #243062 0%, #1a2450 50%, #151c42 100%);
    background-size: 100% 100%, 100% 100%, 4px 100%, 100% 100%;
    background-position: right top, center, center, center;
    background-repeat: no-repeat, no-repeat, repeat-y, no-repeat;
  }
  .cc-cell.cc-sidewalk {
    background: linear-gradient(90deg, rgba(0,0,0,0.25), transparent 40%), linear-gradient(180deg, #5a6578 0%, #4a5466 100%);
  }
  .cc-bush {
    position: absolute; width: 72%; max-width: 4.5rem; left: 50%; transform: translateX(-50%);
    z-index: 2; pointer-events: none; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.35));
  }
  .cc-bush-a { top: 12%; } .cc-bush-b { bottom: 14%; }
  .cc-barrier {
    position: absolute; top: 10%; left: 50%; width: min(86%, 5.5rem); transform: translateX(-50%);
    z-index: 4; pointer-events: none; filter: drop-shadow(0 6px 8px rgba(0,0,0,0.4));
    animation: cc-pop-in 220ms cubic-bezier(.2,.85,.25,1) both;
  }
  .cc-coin {
    position: absolute; bottom: 12%; left: 50%; width: min(58%, 3.6rem); transform: translateX(-50%);
    z-index: 4; pointer-events: none; filter: drop-shadow(0 6px 10px rgba(0,0,0,0.45));
    animation: cc-pop-in 260ms cubic-bezier(.2,.85,.25,1) both;
  }
  @keyframes cc-pop-in {
    0% { opacity: 0; transform: translateX(-50%) scale(0.6); }
    100% { opacity: 1; transform: translateX(-50%) scale(1); }
  }
  .cc-mult {
    position: absolute; bottom: 11%; left: 50%; transform: translateX(-50%); z-index: 4;
    width: min(78%, 4.4rem); aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
    border-radius: 999px; border: 2px solid rgba(255,255,255,0.55); background: rgba(12, 18, 40, 0.42);
    font-family: var(--font-heading, serif); font-size: clamp(0.55rem, 1.7cqw, 0.85rem); font-weight: 900; color: #f4f7ff;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 8px 16px rgba(0,0,0,0.25);
  }
  .cc-chicken {
    position: absolute; left: 0; right: 0; top: 0; bottom: 0; width: min(78%, 6rem); max-width: 6.25rem;
    max-height: 58%; aspect-ratio: 1; height: auto; margin: auto; z-index: 8; transform: translate3d(0,0,0);
    will-change: transform; pointer-events: none; filter: drop-shadow(0 12px 14px rgba(0,0,0,0.55));
  }
  .cc-chicken img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .cc-chicken.cc-hopping { animation: cc-hop-fwd ${HOP_MS}ms cubic-bezier(.2,.85,.25,1) forwards; }
  @keyframes cc-hop-fwd {
    0% { transform: translate3d(0, 0, 0) scale(1); }
    40% { transform: translate3d(50cqw, -20%, 0) scale(1.14); }
    100% { transform: translate3d(100cqw, 0, 0) scale(1); }
  }
  .cc-kill-car {
    position: absolute; left: 50%; width: min(72%, 4.2rem); z-index: 9; pointer-events: none;
    transform: translate3d(-50%, -120%, 0); filter: drop-shadow(0 10px 12px rgba(0,0,0,0.5));
  }
  .cc-kill-car.cc-run { animation: cc-run-over ${HIT_MS}ms cubic-bezier(.25,.7,.2,1) forwards; }
  @keyframes cc-run-over {
    0% { transform: translate3d(-50%, -130%, 0); }
    55% { transform: translate3d(-50%, 18%, 0); }
    100% { transform: translate3d(-50%, 160%, 0); }
  }
  .cc-splat {
    position: absolute; inset: 0; pointer-events: none; z-index: 7; opacity: 0;
    background: radial-gradient(circle at 50% 52%, rgba(220,50,50,0.35), transparent 46%);
  }
  .cc-splat.on { opacity: 1; transition: opacity 120ms ease; }
  .cc-board-label {
    position: absolute; left: 0.75rem; bottom: 0.55rem; z-index: 6;
    font-family: var(--font-heading, serif); font-size: 0.62rem; letter-spacing: 0.18em;
    text-transform: uppercase; color: rgba(226,232,240,0.48); pointer-events: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .cc-chicken.cc-hopping, .cc-kill-car.cc-run, .cc-barrier, .cc-coin { animation: none !important; }
    .cc-chicken.cc-hopping { transform: none !important; }
    .cc-kill-car.cc-run { transform: translate3d(-50%, 20%, 0) !important; }
    .cc-fade-in { animation: none !important; opacity: 1 !important; transform: none !important; }
  }
`;

'''

start = text.index("const ASSET = {")
end = text.index("function formatMoney(n)")
text = text[:start] + NEW_HEAD + text[end:]

# Remove trafficSeed helper if present
if "function trafficSeed(laneIndex)" in text:
    ts = text.index("function trafficSeed(laneIndex)")
    te = text.index("let _introPlayed = false;")
    text = text[:ts] + text[te:]

# State: replace hopAnim/hitFlash with killCar
text = text.replace(
    "  const [hopAnim, setHopAnim] = useState(''); // '' | 'fwd' | 'hit'\n  const [lastRound, setLastRound] = useState(null);\n  const [hitFlash, setHitFlash] = useState(false);",
    "  const [hopAnim, setHopAnim] = useState(''); // '' | 'fwd'\n  const [lastRound, setLastRound] = useState(null);\n  const [hitFlash, setHitFlash] = useState(false);\n  const [killCar, setKillCar] = useState(false);\n  const [killCarSrc, setKillCarSrc] = useState(ASSET.cars[0]);",
)

OLD_BOARD = """  const boardLanes = useMemo(() => {
    const rows = [];
    const catalog = offered.length
      ? offered
      : ((config.difficulties || []).find((d) => d.id === difficulty)?.lanes || []);
    const multByLane = new Map(catalog.map((r) => [Number(r.lane), r]));
    const maxLane = catalog.length
      ? Number(catalog[catalog.length - 1].lane)
      : (lastOffered || VISIBLE_AHEAD);
    if (!active || lane === 0) {
      rows.push({ kind: 'sidewalk', key: 'sidewalk', lane: 0 });
    }
    const from = active && lane > 0 ? lane : 1;
    const to = Math.min(maxLane, from + VISIBLE_AHEAD - (rows.length ? 1 : 0));
    for (let i = from; i <= to; i += 1) {
      const info = multByLane.get(i);
      rows.push({
        kind: 'lane',
        key: `lane-${i}`,
        lane: i,
        mult: info?.multiplier || '',
        traffic: trafficSeed(i),
      });
    }
    return rows;
  }, [active, lane, lastOffered, offered, config.difficulties, difficulty]);"""

NEW_BOARD = """  const boardLanes = useMemo(() => {
    const rows = [];
    const catalog = offered.length
      ? offered
      : ((config.difficulties || []).find((d) => d.id === difficulty)?.lanes || []);
    const multByLane = new Map(catalog.map((r) => [Number(r.lane), r]));
    const maxLane = catalog.length
      ? Number(catalog[catalog.length - 1].lane)
      : (lastOffered || VISIBLE_AHEAD);

    rows.push({ kind: 'sidewalk', key: 'sidewalk', lane: 0, hasChicken: !active || lane === 0 });

    if (active && lane > 0) {
      const clearedFrom = Math.max(1, lane - CLEARED_KEEP);
      for (let i = clearedFrom; i < lane; i += 1) {
        const info = multByLane.get(i);
        rows.push({ kind: 'cleared', key: `cleared-${i}`, lane: i, mult: info?.multiplier || '' });
      }
      const cur = multByLane.get(lane);
      rows.push({ kind: 'current', key: `current-${lane}`, lane, mult: cur?.multiplier || '', hasChicken: true });
      const aheadTo = Math.min(maxLane, lane + VISIBLE_AHEAD);
      for (let i = lane + 1; i <= aheadTo; i += 1) {
        const info = multByLane.get(i);
        rows.push({ kind: 'ahead', key: `ahead-${i}`, lane: i, mult: info?.multiplier || '' });
      }
    } else {
      const aheadTo = Math.min(maxLane, VISIBLE_AHEAD);
      for (let i = 1; i <= aheadTo; i += 1) {
        const info = multByLane.get(i);
        rows.push({ kind: 'ahead', key: `ahead-${i}`, lane: i, mult: info?.multiplier || '' });
      }
    }
    return rows;
  }, [active, lane, lastOffered, offered, config.difficulties, difficulty]);"""

if OLD_BOARD not in text:
    raise SystemExit("boardLanes block not found")
text = text.replace(OLD_BOARD, NEW_BOARD)

text = text.replace(
    "    ASSET.cars.concat([ASSET.idle, ASSET.hop, ASSET.hit, ASSET.lane, ASSET.sidewalk, ASSET.coin]).forEach((src) => {",
    "    ASSET.cars.concat([ASSET.idle, ASSET.hop, ASSET.hit, ASSET.coin, ASSET.barrier, ASSET.bush]).forEach((src) => {",
)

OLD_STEP = """  const step = async () => {
    if (busyRef.current || loading || !canStep) return;
    busyRef.current = true;
    setLoading(true);
    setHitFlash(false);
    try {
      const res = await apiRequestWith429Retry(() => api.post('/casino/chicken-cross/step'));
      const isHit = res.data?.settled?.result === 'hit';
      setPose('hop');
      setHopAnim(isHit ? 'hit' : 'fwd');
      await waitHop();
      if (res.data?.active && res.data?.game) {
        setHopAnim('');
        setGame(res.data.game);
        setPose('idle');
      } else if (res.data?.settled) {
        setHitFlash(isHit);
        setHopAnim('');
        afterSettle(res.data.settled);
        if (isHit) toast.message('Squashed. Stake lost.');
      } else {
        setHopAnim('');
        setPose('idle');
      }
    } catch (e) {
      setHopAnim('');
      setPose('idle');
      toast.error(getApiErrorMessage(e) || 'Hop failed');
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  };"""

NEW_STEP = """  const waitHit = () => new Promise((resolve) => {
    if (prefersReducedMotion()) {
      resolve();
      return;
    }
    setTimeout(resolve, HIT_MS);
  });

  const step = async () => {
    if (busyRef.current || loading || !canStep) return;
    busyRef.current = true;
    setLoading(true);
    setHitFlash(false);
    setKillCar(false);
    try {
      const res = await apiRequestWith429Retry(() => api.post('/casino/chicken-cross/step'));
      const isHit = res.data?.settled?.result === 'hit';
      if (isHit) {
        setKillCarSrc(ASSET.cars[Math.floor(Math.random() * ASSET.cars.length)]);
        setPose('hop');
        setHopAnim('fwd');
        await waitHop();
        setHopAnim('');
        setPose('hit');
        setKillCar(true);
        setHitFlash(true);
        await waitHit();
        setKillCar(false);
        afterSettle(res.data.settled);
        toast.message('Squashed. Stake lost.');
      } else if (res.data?.active && res.data?.game) {
        setPose('hop');
        setHopAnim('fwd');
        await waitHop();
        setHopAnim('');
        setGame(res.data.game);
        setPose('idle');
      } else if (res.data?.settled) {
        setPose('hop');
        setHopAnim('fwd');
        await waitHop();
        setHopAnim('');
        afterSettle(res.data.settled);
      } else {
        setHopAnim('');
        setPose('idle');
      }
    } catch (e) {
      setHopAnim('');
      setKillCar(false);
      setPose('idle');
      toast.error(getApiErrorMessage(e) || 'Hop failed');
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  };"""

if OLD_STEP not in text:
    raise SystemExit("step block not found")
text = text.replace(OLD_STEP, NEW_STEP)

text = text.replace(
    "    setHitFlash(false);\n    setPose('idle');\n    setHopAnim('');\n    try {\n      const res = await apiRequestWith429Retry(() => api.post('/casino/chicken-cross/start'",
    "    setHitFlash(false);\n    setKillCar(false);\n    setPose('idle');\n    setHopAnim('');\n    try {\n      const res = await apiRequestWith429Retry(() => api.post('/casino/chicken-cross/start'",
)

OLD_BOARD_JSX = """              <div className=\"cc-board border border-primary/20\" data-testid=\"chicken-cross-board\">
                <div className={`cc-hit-flash ${hitFlash ? 'on' : ''}`} />
                <div className=\"cc-strip\">
                  {boardLanes.map((cell, idx) => {
                    const isCurrent = idx === 0;
                    return (
                      <div
                        key={cell.key}
                        className={`cc-cell ${cell.kind === 'sidewalk' ? 'cc-sidewalk' : 'cc-road'}${isCurrent ? ' cc-current' : ''}`}
                      >
                        {cell.kind === 'lane' && cell.mult ? (
                          <div className=\"cc-mult\">x{cell.mult}</div>
                        ) : null}
                        {cell.kind === 'lane' && cell.traffic ? (
                          <>
                            <img
                              src={cell.traffic.cars[0]}
                              alt=\"\"
                              className={`cc-car ${cell.traffic.rev ? 'cc-rev' : ''}`}
                              style={{ '--cc-dur': cell.traffic.durs[0], '--cc-delay': cell.traffic.delays[0] }}
                              draggable={false}
                            />
                            <img
                              src={cell.traffic.cars[1]}
                              alt=\"\"
                              className={`cc-car ${cell.traffic.rev ? '' : 'cc-rev'}`}
                              style={{ '--cc-dur': cell.traffic.durs[1], '--cc-delay': cell.traffic.delays[1] }}
                              draggable={false}
                            />
                          </>
                        ) : null}
                        {isCurrent ? (
                          <div
                            className={`cc-chicken ${hopAnim === 'fwd' ? 'cc-hopping' : ''} ${hopAnim === 'hit' ? 'cc-hop-hit' : ''}`}
                            aria-hidden
                          >
                            <img src={chickenSrc} alt=\"\" draggable={false} />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div className=\"cc-board-label\">{active ? (lane > 0 ? `Lane ${lane}` : 'Sidewalk') : 'Ready'}</div>
              </div>"""

NEW_BOARD_JSX = """              <div className=\"cc-board border border-primary/20\" data-testid=\"chicken-cross-board\">
                <div className={`cc-splat ${hitFlash ? 'on' : ''}`} />
                <div className=\"cc-strip\">
                  {boardLanes.map((cell) => (
                    <div
                      key={cell.key}
                      className={`cc-cell ${cell.kind === 'sidewalk' ? 'cc-sidewalk' : 'cc-road'}`}
                    >
                      {cell.kind === 'sidewalk' ? (
                        <>
                          <img src={ASSET.bush} alt=\"\" className=\"cc-bush cc-bush-a\" draggable={false} />
                          <img src={ASSET.bush} alt=\"\" className=\"cc-bush cc-bush-b\" draggable={false} />
                        </>
                      ) : null}
                      {cell.kind === 'cleared' ? (
                        <>
                          <img src={ASSET.barrier} alt=\"\" className=\"cc-barrier\" draggable={false} />
                          <img src={ASSET.coin} alt=\"\" className=\"cc-coin\" draggable={false} />
                        </>
                      ) : null}
                      {cell.kind === 'ahead' && cell.mult ? (
                        <div className=\"cc-mult\">{cell.mult}</div>
                      ) : null}
                      {cell.hasChicken ? (
                        <div className={`cc-chicken ${hopAnim === 'fwd' ? 'cc-hopping' : ''}`} aria-hidden>
                          <img src={chickenSrc} alt=\"\" draggable={false} />
                        </div>
                      ) : null}
                      {cell.kind === 'current' && killCar ? (
                        <img src={killCarSrc} alt=\"\" className=\"cc-kill-car cc-run\" draggable={false} />
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className=\"cc-board-label\">{active ? (lane > 0 ? `Lane ${lane}` : 'Sidewalk') : 'Ready'}</div>
              </div>"""

if OLD_BOARD_JSX not in text:
    raise SystemExit("board JSX not found")
text = text.replace(OLD_BOARD_JSX, NEW_BOARD_JSX)

PAGE.write_text(text, encoding="utf-8")
print("patched", PAGE)
