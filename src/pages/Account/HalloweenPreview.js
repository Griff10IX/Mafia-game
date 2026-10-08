import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthUser } from '../../context/AuthContext';
import { setHalloweenPreview } from '../../halloween/active';
import { maybeHalloweenScare, requestHalloweenScare, showButtonWeb } from '../../halloween/trigger';

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
          This is the optional overlay. Pumpkins and corner webs stay put. A button press grows a spiderweb about 1 time in 20. Opening a loot box or committing a crime can flash a scare at the same rate. Turning it on in the theme picker keeps the layout you already use, and turning it off puts that theme back.
        </p>
        <p className="text-[11px] text-zinc-400">{note}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="px-3 py-2 rounded border border-primary/40 text-[11px] font-heading uppercase"
          onClick={(event) => {
            showButtonWeb(event.currentTarget);
            setNote('Web forced on that button.');
          }}
        >
          Force a web
        </button>
        <button type="button" className="px-3 py-2 rounded border border-primary/40 text-[11px] font-heading uppercase" onClick={() => { requestHalloweenScare('face'); setNote('Face.'); }}>
          Face
        </button>
        <button type="button" className="px-3 py-2 rounded border border-primary/40 text-[11px] font-heading uppercase" onClick={() => { requestHalloweenScare('lantern'); setNote('Lantern.'); }}>
          Lantern
        </button>
        <button type="button" className="px-3 py-2 rounded border border-primary/40 text-[11px] font-heading uppercase" onClick={() => { requestHalloweenScare('spider'); setNote('Spider.'); }}>
          Spider
        </button>
        <button type="button" className="px-3 py-2 rounded border border-primary/40 text-[11px] font-heading uppercase" onClick={() => { requestHalloweenScare('hand'); setNote('Hand.'); }}>
          Hand
        </button>
        <button type="button" className="px-3 py-2 rounded border border-primary/40 text-[11px] font-heading uppercase" onClick={() => { requestHalloweenScare('eyes'); setNote('Eyes.'); }}>
          Eyes
        </button>
        <button
          type="button"
          className="px-3 py-2 rounded border border-primary/40 text-[11px] font-heading uppercase"
          onClick={() => {
            const hit = maybeHalloweenScare();
            setNote(hit ? 'The 1 in 20 hit.' : 'Nothing this time. That is the 1 in 20.');
          }}
        >
          Roll 1 in 20
        </button>
      </div>
    </div>
  );
}
