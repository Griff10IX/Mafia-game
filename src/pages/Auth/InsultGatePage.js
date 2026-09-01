import { useMemo, useState } from "react";
import { pickInsultCopy } from "./kickedCopy";

export default function InsultGatePage({ label, lines, primaryHref, primaryLabel }) {
  const first = useMemo(() => pickInsultCopy(lines), [lines]);
  const [copy, setCopy] = useState(first);

  return (
    <div className="kicked-page">
      <style>{KICKED_CSS}</style>
      <div className="kicked-page__glow" />
      <div className="kicked-page__card">
        <p className="kicked-page__eyebrow">System AI</p>
        <p className="kicked-page__label">{label}</p>
        <h1 className="kicked-page__insult">{copy.insult}</h1>
        <p className="kicked-page__line">{copy.line}</p>
        <div className="kicked-page__actions">
          {primaryHref && primaryLabel ? (
            <a className="kicked-page__btn" href={primaryHref}>
              {primaryLabel}
            </a>
          ) : null}
          <button type="button" className="kicked-page__ghost" onClick={() => setCopy(pickInsultCopy(lines))}>
            Another one
          </button>
        </div>
      </div>
    </div>
  );
}

const KICKED_CSS = `
.kicked-page {
  min-height: 100vh;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(ellipse at 50% 0%, #3a1a08 0%, #0a0908 55%, #050403 100%);
  color: #f5e6c8;
  font-family: "Cinzel", "Times New Roman", serif;
}
.kicked-page__glow {
  position: fixed;
  inset: auto 0 18% 0;
  height: 280px;
  background: radial-gradient(circle, rgba(251,191,36,0.18), transparent 70%);
  pointer-events: none;
}
.kicked-page__card {
  position: relative;
  width: 100%;
  max-width: 560px;
  text-align: center;
  padding: 40px 28px 32px;
  border: 1px solid rgba(251,191,36,0.45);
  background: rgba(12, 10, 8, 0.88);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.6), 0 24px 80px rgba(0,0,0,0.55);
}
.kicked-page__eyebrow {
  margin: 0 0 10px;
  font-size: 11px;
  letter-spacing: 0.42em;
  text-transform: uppercase;
  color: #fbbf24;
}
.kicked-page__label {
  margin: 0 0 18px;
  font-size: 12px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #c4b08a;
}
.kicked-page__insult {
  margin: 0 0 18px;
  font-size: clamp(34px, 8vw, 64px);
  line-height: 0.95;
  letter-spacing: 0.04em;
  color: #fff4d4;
  text-shadow: 0 0 28px rgba(251,191,36,0.35);
}
.kicked-page__line {
  margin: 0 0 28px;
  font-size: 16px;
  color: #e8d7a8;
}
.kicked-page__actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}
.kicked-page__btn,
.kicked-page__ghost {
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 12px 18px;
  cursor: pointer;
  text-decoration: none;
}
.kicked-page__btn {
  background: #fbbf24;
  color: #1a1208;
  border: 0;
  font-weight: 700;
}
.kicked-page__ghost {
  background: transparent;
  color: #fbbf24;
  border: 1px solid rgba(251,191,36,0.55);
}
`;
