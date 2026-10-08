import { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { isHalloweenActive, setHalloweenAccount, subscribeHalloween } from './active';
import { HalloweenDecor } from './Decor';
import { halloweenRoll, prefersReducedMotion } from './roll';
import { ScareFrame } from './Scares';
import { showButtonWeb } from './trigger';
import './halloween.css';

export default function HalloweenLayer() {
  const { halloweenOn } = useTheme();
  const [active, setActive] = useState(() => isHalloweenActive());
  const [scare, setScare] = useState(null);

  useEffect(() => {
    setHalloweenAccount(!!halloweenOn);
  }, [halloweenOn]);

  useEffect(() => subscribeHalloween(() => setActive(isHalloweenActive())), []);

  useEffect(() => {
    if (!active) return undefined;
    const onClick = (event) => {
      if (!isHalloweenActive() || prefersReducedMotion()) return;
      const btn = event.target?.closest?.('button, [role="button"]');
      if (!btn || btn.closest('[data-halloween-scare]')) return;
      if (!halloweenRoll()) return;
      showButtonWeb(btn);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active]);

  useEffect(() => {
    const onScare = (event) => {
      if (prefersReducedMotion()) return;
      const kind = event.detail?.kind || null;
      setScare({ id: Date.now(), kind });
    };
    window.addEventListener('halloween-scare', onScare);
    return () => window.removeEventListener('halloween-scare', onScare);
  }, []);

  useEffect(() => {
    if (!scare) return undefined;
    const timer = window.setTimeout(() => setScare(null), 1100);
    return () => window.clearTimeout(timer);
  }, [scare]);

  return (
    <>
      {active ? <HalloweenDecor /> : null}
      {scare ? <ScareFrame key={scare.id} kind={scare.kind} /> : null}
    </>
  );
}
