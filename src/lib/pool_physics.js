// Client-side pool physics — exact port of backend mp_8ball._simulate_shot so
// the aim preview matches the authoritative server result.

export const TABLE_W = 2.2;
export const TABLE_H = 1.1;
export const BALL_R = 0.028;
export const POCKET_R = 0.058;
export const CORNER_POCKET_R = 0.066;
const RESTITUTION = 0.985;
const FRICTION = 0.994;
const STOP_SPEED = 0.012;
const SIM_DT = 0.016;
const MAX_SIM_STEPS = 1200;
const COLLISION_PASSES = 4;
const SPIN_SWERVE = 0.045;
const SPIN_DECAY = 0.988;
const SPIN_CARRY = 0.03;
const RAIL_SPIN_THROW = 0.085;
const SLEEP_EPS = 0.006;
const POS_EPS = 1e-5;

export function pockets() {
  return [
    { x: 0, y: 0, r: CORNER_POCKET_R },
    { x: TABLE_W / 2, y: 0, r: POCKET_R },
    { x: TABLE_W, y: 0, r: CORNER_POCKET_R },
    { x: 0, y: TABLE_H, r: CORNER_POCKET_R },
    { x: TABLE_W / 2, y: TABLE_H, r: POCKET_R },
    { x: TABLE_W, y: TABLE_H, r: CORNER_POCKET_R },
  ];
}

function hypot(a, b) {
  return Math.sqrt(a * a + b * b);
}

function segCircleIntersect(x0, y0, x1, y1, cx, cy, r) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-20) return hypot(fx, fy) <= r ? 0 : -1;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  const t2 = (-b + disc) / (2 * a);
  if (t2 >= 0 && t2 <= 1) return t2;
  if (hypot(x0 - cx, y0 - cy) <= r) return 0;
  return -1;
}

function tryPocketBalls(balls, pocketedNumbers, events, tMs) {
  const pks = pockets();
  for (const b of balls) {
    if (b.pocketed) continue;
    for (const pk of pks) {
      const prevX = b._px !== undefined ? b._px : b.x;
      const prevY = b._py !== undefined ? b._py : b.y;
      const t = segCircleIntersect(prevX, prevY, b.x, b.y, pk.x, pk.y, pk.r);
      if (t >= 0) {
        b.pocketed = true;
        b.vx = 0;
        b.vy = 0;
        pocketedNumbers.push(b.number);
        events.push({ type: 'pocket', t_ms: tMs, number: b.number, x: pk.x, y: pk.y });
        break;
      }
    }
  }
}

function applyPocketGravity(balls) {
  const pks = pockets();
  for (const b of balls) {
    if (b.pocketed) continue;
    for (const pk of pks) {
      const dx = pk.x - b.x;
      const dy = pk.y - b.y;
      const dist = hypot(dx, dy);
      const threshold = pk.r * 1.75;
      if (dist < threshold && dist > 0.001) {
        const strength = 0.00135 * (1 - dist / threshold);
        b.vx += (dx / dist) * strength;
        b.vy += (dy / dist) * strength;
      }
    }
  }
}

function activeBalls(balls) {
  return balls.filter((b) => !b.pocketed);
}

/**
 * Run the full physics simulation for a shot. Returns the cue-ball trajectory
 * and first-contacted object ball trajectory for aim preview rendering.
 *
 * @param {Array} balls - current ball state [{number, x, y, vx, vy, pocketed, id, kind}, ...]
 * @param {number} angle - shot angle in radians
 * @param {number} power - 0..1
 * @param {number} spinX - -1..1 side spin
 * @param {number} spinY - -1..1 top/back spin
 * @returns {{ cuePath: {x,y}[], objectPath: {x,y}[]|null, objectBallNumber: number|null, firstContact: number|null, pocketedNumbers: number[] }}
 */
export function simulatePreview(balls, angle, power, spinX = 0, spinY = 0) {
  const out = balls.map((b) => ({
    number: b.number,
    id: b.id,
    kind: b.kind,
    x: Number(b.x),
    y: Number(b.y),
    vx: Number(b.vx || 0),
    vy: Number(b.vy || 0),
    pocketed: !!b.pocketed,
  }));

  const cue = out.find((b) => b.number === 0);
  if (!cue || cue.pocketed) {
    return { cuePath: [], objectPath: null, objectBallNumber: null, firstContact: null, pocketedNumbers: [] };
  }

  const p = Math.max(0, Math.min(1, power));
  const speed = 2.2 * p;
  cue.vx = Math.cos(angle) * speed + spinX * 0.05;
  cue.vy = Math.sin(angle) * speed + spinY * 0.05;

  let cueSpinX = Math.max(-1, Math.min(1, spinX));
  let cueSpinY = Math.max(-1, Math.min(1, spinY));

  const impactedIds = new Set([cue.id]);
  let firstContact = null;
  const pocketedNumbers = [];
  const events = [];

  const cuePath = [{ x: cue.x, y: cue.y }];
  let objectBallNumber = null;
  let objectPath = null;
  let trackingObjectId = null;

  for (let step = 0; step < MAX_SIM_STEPS; step++) {
    const tMs = Math.round((step + 1) * SIM_DT * 1000);
    const active = activeBalls(out);

    for (const b of active) {
      b._px = b.x;
      b._py = b.y;
    }

    for (const b of active) {
      if (b.number === 0) {
        const sn = hypot(b.vx, b.vy);
        if (sn > STOP_SPEED) {
          const px = -b.vy / Math.max(sn, 1e-6);
          const py = b.vx / Math.max(sn, 1e-6);
          const swerve = cueSpinX * SPIN_SWERVE * SIM_DT;
          b.vx += px * swerve;
          b.vy += py * swerve;
          const speedBias = cueSpinY * 0.035 * SIM_DT;
          b.vx += (b.vx / Math.max(sn, 1e-6)) * speedBias;
          b.vy += (b.vy / Math.max(sn, 1e-6)) * speedBias;
        }
        cueSpinX *= SPIN_DECAY;
        cueSpinY *= SPIN_DECAY;
      }
      b.x += b.vx * SIM_DT;
      b.y += b.vy * SIM_DT;
    }

    tryPocketBalls(out, pocketedNumbers, events, tMs);
    applyPocketGravity(activeBalls(out));

    for (const b of activeBalls(out)) {
      if (b.x <= BALL_R) {
        b.x = BALL_R;
        b.vx = Math.abs(b.vx) * RESTITUTION;
        if (b.number === 0) b.vy += cueSpinX * RAIL_SPIN_THROW;
      } else if (b.x >= TABLE_W - BALL_R) {
        b.x = TABLE_W - BALL_R;
        b.vx = -Math.abs(b.vx) * RESTITUTION;
        if (b.number === 0) b.vy -= cueSpinX * RAIL_SPIN_THROW;
      }
      if (b.y <= BALL_R) {
        b.y = BALL_R;
        b.vy = Math.abs(b.vy) * RESTITUTION;
        if (b.number === 0) b.vx -= cueSpinX * RAIL_SPIN_THROW;
      } else if (b.y >= TABLE_H - BALL_R) {
        b.y = TABLE_H - BALL_R;
        b.vy = -Math.abs(b.vy) * RESTITUTION;
        if (b.number === 0) b.vx += cueSpinX * RAIL_SPIN_THROW;
      }
    }

    const minDist = BALL_R * 2;
    for (let pass = 0; pass < COLLISION_PASSES; pass++) {
      const act = activeBalls(out);
      let pairIter;
      if (pass === 0) {
        const cueIdx = act.findIndex((b) => b.number === 0);
        if (cueIdx >= 0) {
          const cb = act[cueIdx];
          const cuePairs = [];
          for (let j = 0; j < act.length; j++) {
            if (j === cueIdx) continue;
            const d = hypot(act[j].x - cb.x, act[j].y - cb.y);
            const i0 = Math.min(cueIdx, j);
            const j0 = Math.max(cueIdx, j);
            cuePairs.push({ d, i: i0, j: j0 });
          }
          cuePairs.sort((a, b) => a.d - b.d);
          const ordered = cuePairs.map((p) => [p.i, p.j]);
          const seen = new Set(ordered.map((p) => `${p[0]},${p[1]}`));
          for (let i = 0; i < act.length; i++) {
            for (let j = i + 1; j < act.length; j++) {
              if (!seen.has(`${i},${j}`)) ordered.push([i, j]);
            }
          }
          pairIter = ordered;
        } else {
          pairIter = [];
          for (let i = 0; i < act.length; i++)
            for (let j = i + 1; j < act.length; j++) pairIter.push([i, j]);
        }
      } else {
        pairIter = [];
        for (let i = 0; i < act.length; i++)
          for (let j = i + 1; j < act.length; j++) pairIter.push([i, j]);
      }

      for (const [ii, jj] of pairIter) {
        const a = act[ii];
        const b = act[jj];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = hypot(dx, dy);
        let nx = dist < 1e-12 ? 1 : dx / dist;
        let ny = dist < 1e-12 ? 0 : dy / dist;

        if (dist < minDist) {
          const overlap = (minDist - dist) * 0.5;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
          dx = b.x - a.x;
          dy = b.y - a.y;
          dist = hypot(dx, dy);
          if (dist > 1e-12) {
            nx = dx / dist;
            ny = dy / dist;
          }
        }

        if (pass > 0) continue;
        if (dist > minDist + 1e-7) continue;

        const aImp = impactedIds.has(a.id);
        const bImp = impactedIds.has(b.id);
        if (!aImp && !bImp) continue;

        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const velAlongNormal = rvx * nx + rvy * ny;
        if (velAlongNormal >= -1e-9) continue;

        const impulse = -(1 + RESTITUTION) * velAlongNormal * 0.5;
        const ix = impulse * nx;
        const iy = impulse * ny;
        a.vx -= ix;
        a.vy -= iy;
        b.vx += ix;
        b.vy += iy;
        impactedIds.add(a.id);
        impactedIds.add(b.id);

        if (a.number === 0) {
          a.vx += nx * SPIN_CARRY;
          a.vy += ny * SPIN_CARRY;
        }
        if (b.number === 0) {
          b.vx -= nx * SPIN_CARRY;
          b.vy -= ny * SPIN_CARRY;
        }

        if (firstContact === null && (a.number === 0 || b.number === 0)) {
          const other = a.number === 0 ? b : a;
          firstContact = other.number;
          objectBallNumber = other.number;
          trackingObjectId = other.id;
          objectPath = [{ x: other.x, y: other.y }];
        }
      }
    }

    for (const b of activeBalls(out)) {
      const sn = hypot(b.vx, b.vy);
      const drag = FRICTION - (sn < 0.18 ? 0.0015 : 0);
      b.vx *= Math.max(0.975, drag);
      b.vy *= Math.max(0.975, drag);
      if (Math.abs(b.vx) < SLEEP_EPS) b.vx = 0;
      if (Math.abs(b.vy) < SLEEP_EPS) b.vy = 0;
      if (Math.abs(b.vx) < POS_EPS && Math.abs(b.vy) < POS_EPS) {
        b.vx = 0;
        b.vy = 0;
      }
    }

    tryPocketBalls(out, pocketedNumbers, events, tMs);

    if (!cue.pocketed) cuePath.push({ x: cue.x, y: cue.y });
    if (trackingObjectId !== null) {
      const ob = out.find((b) => b.id === trackingObjectId);
      if (ob && !ob.pocketed) objectPath.push({ x: ob.x, y: ob.y });
    }

    let moving = false;
    for (const b of activeBalls(out)) {
      if (hypot(b.vx, b.vy) > STOP_SPEED) {
        moving = true;
        break;
      }
    }
    if (!moving) break;
  }

  return { cuePath, objectPath, objectBallNumber, firstContact, pocketedNumbers };
}
