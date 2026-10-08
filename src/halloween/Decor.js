export const HW_IMG = '/images/halloween';

export const HW_SPRITES = {
  pumpkin: `${HW_IMG}/pumpkin.webp`,
  myersBust: `${HW_IMG}/myers-bust.webp`,
  myersFull: `${HW_IMG}/myers-full.webp`,
  chuckyFull: `${HW_IMG}/chucky-full.webp`,
  chuckyStab: `${HW_IMG}/chucky-stab.webp`,
  jasonFull: `${HW_IMG}/jason-full.webp`,
  ghostfaceFull: `${HW_IMG}/ghostface-full.webp`,
  freddyBust: `${HW_IMG}/freddy-bust.webp`,
  victim: `${HW_IMG}/victim.webp`,
  blood1: `${HW_IMG}/blood-1.webp`,
  blood2: `${HW_IMG}/blood-2.webp`,
  blood3: `${HW_IMG}/blood-3.webp`,
  spiderHang: `${HW_IMG}/spider-hang.webp`,
  ghost: `${HW_IMG}/ghost.webp`,
  web: `${HW_IMG}/web.webp`,
  spiderRun: `${HW_IMG}/spider-run.webp`,
  bat: `${HW_IMG}/bat.webp`,
};

export const HW_SHEET_VARS = {
  '--hw-bat': `url("${HW_SPRITES.bat}")`,
  '--hw-spider-run': `url("${HW_SPRITES.spiderRun}")`,
};

// full-body killers used for peeks, walks and the kill
export const KILLERS = [
  { id: 'myers', src: HW_SPRITES.myersFull, small: false },
  { id: 'jason', src: HW_SPRITES.jasonFull, small: false },
  { id: 'ghostface', src: HW_SPRITES.ghostfaceFull, small: false },
  { id: 'chucky', src: HW_SPRITES.chuckyFull, small: true },
];

export function pickKiller(id) {
  const found = KILLERS.find((k) => k.id === id);
  return found || KILLERS[Math.floor(Math.random() * KILLERS.length)];
}

export function preloadHalloweenSprites() {
  if (typeof Image === 'undefined') return;
  Object.values(HW_SPRITES).forEach((src) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  });
}

export function HalloweenDecor() {
  return (
    <div className="hw-decor" aria-hidden="true" style={HW_SHEET_VARS}>
      <div className="hw-vignette" />
      <div className="hw-fog" />
      <div className="hw-moon" />
      <div className="hw-bats">
        <i className="hw-bat" />
        <i className="hw-bat" />
        <i className="hw-bat" />
      </div>
      <img className="hw-web hw-web-tl" src={HW_SPRITES.web} alt="" draggable={false} />
      <img className="hw-web hw-web-br" src={HW_SPRITES.web} alt="" draggable={false} />
      <div className="hw-hang">
        <img src={HW_SPRITES.spiderHang} alt="" draggable={false} />
      </div>
      <img className="hw-pumpkin hw-pumpkin-top" src={HW_SPRITES.pumpkin} alt="" draggable={false} />
      <img className="hw-pumpkin hw-pumpkin-side" src={HW_SPRITES.pumpkin} alt="" draggable={false} />
    </div>
  );
}

export function SpiderRunner({ dir }) {
  return <i className={`hw-runner${dir === 'left' ? ' hw-runner-left' : ''}`} aria-hidden="true" style={HW_SHEET_VARS} />;
}

export function KillerLurk({ killer, side }) {
  const k = pickKiller(killer);
  const cls = `hw-lurk ${side === 'left' ? 'hw-lurk-left' : 'hw-lurk-right'}${k.small ? ' hw-lurk-small' : ''}`;
  return <img className={cls} src={k.src} alt="" aria-hidden="true" draggable={false} />;
}

export function KillerStalk({ killer, dir }) {
  const k = pickKiller(killer);
  const cls = `hw-stalk${dir === 'left' ? ' hw-stalk-left' : ''}${k.small ? ' hw-stalk-small' : ''}`;
  return <img className={cls} src={k.src} alt="" aria-hidden="true" draggable={false} />;
}

export function KillScene({ killer }) {
  const k = pickKiller(killer);
  return (
    <div className="hw-kill" aria-hidden="true">
      <i className="hw-kill-flash" />
      <img className={`hw-kill-killer${k.small ? ' hw-kill-small' : ''}`} src={k.src} alt="" draggable={false} />
      <img className="hw-kill-victim" src={HW_SPRITES.victim} alt="" draggable={false} />
      <img className="hw-kill-splat" src={HW_SPRITES.blood1} alt="" draggable={false} />
      <img className="hw-kill-splat" src={HW_SPRITES.blood2} alt="" draggable={false} />
      <img className="hw-kill-splat" src={HW_SPRITES.blood3} alt="" draggable={false} />
      <img className="hw-kill-screen" src={HW_SPRITES.blood2} alt="" draggable={false} />
    </div>
  );
}
