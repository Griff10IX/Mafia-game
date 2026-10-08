import { HW_SPRITES } from './Decor';

export const SCARES = {
  myers: { src: HW_SPRITES.myersBust, ms: 1300 },
  chucky: { src: HW_SPRITES.chuckyStab, ms: 1900, gore: true },
  freddy: { src: HW_SPRITES.freddyBust, ms: 1800, gore: true },
  jason: { src: HW_SPRITES.jasonFull, ms: 1300, tall: true },
  ghostface: { src: HW_SPRITES.ghostfaceFull, ms: 1300, tall: true },
  ghost: { src: HW_SPRITES.ghost, ms: 1300 },
  spider: { src: HW_SPRITES.spiderHang, ms: 1300 },
  pumpkin: { src: HW_SPRITES.pumpkin, ms: 1300 },
};

export const SCARE_KINDS = Object.keys(SCARES);

export function pickScareKind(kind) {
  if (SCARES[kind]) return kind;
  return SCARE_KINDS[Math.floor(Math.random() * SCARE_KINDS.length)];
}

export function scareDuration(kind) {
  return (SCARES[kind] || SCARES.myers).ms;
}

export function ScareFrame({ kind }) {
  const id = pickScareKind(kind);
  const def = SCARES[id];
  return (
    <div
      className={`hw-scare hw-scare-${id}${def.tall ? ' hw-scare-tall' : ''}`}
      data-halloween-scare="1"
      aria-hidden="true"
    >
      <img src={def.src} alt="" draggable={false} />
      {def.gore ? (
        <>
          <div className="hw-slashes"><i /><i /><i /><i /></div>
          <div className="hw-drips"><i /><i /><i /><i /><i /><i /></div>
        </>
      ) : null}
    </div>
  );
}
