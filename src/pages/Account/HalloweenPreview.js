import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthUser } from '../../context/AuthContext';
import { setHalloweenPreview } from '../../halloween/active';
import {
  maybeHalloweenScare,
  requestHalloweenKill,
  requestHalloweenLurk,
  requestHalloweenRunner,
  requestHalloweenScare,
  requestHalloweenStalk,
  showButtonWeb,
} from '../../halloween/trigger';

const BTN = 'px-3 py-2 rounded border border-primary/40 text-[11px] font-heading uppercase';

const SCARE_BUTTONS = [
  ['myers', 'Michael Myers'],
  ['chucky', 'Chucky stab'],
  ['freddy', 'Freddy'],
  ['jason', 'Jason'],
  ['ghostface', 'Ghostface'],
  ['ghost', 'Ghost'],
  ['spider', 'Spider drop'],
  ['pumpkin', 'Pumpkin'],
];

const KILLER_BUTTONS = [
  ['myers', 'Myers'],
  ['jason', 'Jason'],
  ['ghostface', 'Ghostface'],
  ['chucky', 'Chucky'],
];

export default function HalloweenPreview() {
  const user = useAuthUser();
  const staff = !!(user?.is_admin || user?.is_moderator);
  const [note, setNote] = useState('About 1 in 20. The buttons below can force one so you can see it.');

  useEffect(() => {
    if (!staff) return undefined;
    setHalloweenPreview(true);
    return () => setHalloweenPreview(false);
  }, [staff]);

  if (user && !staff) {
    return <Navigate to="/account/dashboard" replace />;
  }

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <div className="rounded-md border border-primary/30 bg-zinc-950/80 p-4 space-y-2">
        <h1 className="text-sm font-heading font-bold uppercase tracking-wide text-primary">Halloween preview</h1>
        <p className="text-[11px] text-zinc-300 leading-relaxed">
          This is the optional overlay. Pumpkins, corner webs, a hanging spider and bats stay on screen. Now and again a spider runs across the bottom, a killer peeks in from an edge or walks across the middle, and once in a while one of them catches someone. A button press grows a web about 1 time in 20. A menu link, or a button people hit all the time such as Bust, Commit or Steal, can flash a scare at the same rate. Opening a loot box or committing a crime can too. Turning it on in the theme picker keeps the layout you already use, and turning it off puts that theme back.
        </p>
        <p className="text-[11px] text-zinc-400">{note}</p>
      </div>
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Scares</div>
        <div className="flex flex-wrap gap-2">
          {SCARE_BUTTONS.map(([kind, label]) => (
            <button key={kind} type="button" className={BTN} onClick={() => { requestHalloweenScare(kind); setNote(`${label}.`); }}>
              {label}
            </button>
          ))}
          <button
            type="button"
            className={BTN}
            onClick={() => {
              const hit = maybeHalloweenScare();
              setNote(hit ? 'The 1 in 20 hit.' : 'Nothing this time. That is the 1 in 20.');
            }}
          >
            Roll 1 in 20
          </button>
        </div>

        <div className="text-[10px] uppercase tracking-wide text-zinc-500 pt-2">Peek from an edge</div>
        <div className="flex flex-wrap gap-2">
          {KILLER_BUTTONS.map(([id, label]) => (
            <button key={id} type="button" className={BTN} onClick={() => { requestHalloweenLurk(id, null); setNote(`${label} is at the edge.`); }}>
              {label}
            </button>
          ))}
        </div>

        <div className="text-[10px] uppercase tracking-wide text-zinc-500 pt-2">Walk across the middle</div>
        <div className="flex flex-wrap gap-2">
          {KILLER_BUTTONS.map(([id, label]) => (
            <button key={id} type="button" className={BTN} onClick={() => { requestHalloweenStalk(id, null); setNote(`${label} is walking through.`); }}>
              {label}
            </button>
          ))}
        </div>

        <div className="text-[10px] uppercase tracking-wide text-zinc-500 pt-2">The kill</div>
        <div className="flex flex-wrap gap-2">
          {KILLER_BUTTONS.map(([id, label]) => (
            <button key={id} type="button" className={BTN} onClick={() => { requestHalloweenKill(id); setNote(`${label} gets someone.`); }}>
              {label}
            </button>
          ))}
        </div>

        <div className="text-[10px] uppercase tracking-wide text-zinc-500 pt-2">Other</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN} onClick={() => { requestHalloweenRunner('right'); setNote('Spider running right.'); }}>
            Spider run right
          </button>
          <button type="button" className={BTN} onClick={() => { requestHalloweenRunner('left'); setNote('Spider running left.'); }}>
            Spider run left
          </button>
          <button
            type="button"
            className={BTN}
            onClick={(event) => {
              showButtonWeb(event.currentTarget);
              setNote('Web forced on that button.');
            }}
          >
            Force a web
          </button>
        </div>
      </div>
    </div>
  );
}
