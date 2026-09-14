// Valve CS2 recoil, procedurally generated from official scripts/weapons.vdata_c
// parameters (m_nRecoilSeed, m_flRecoilAngle/Variance, m_flRecoilMagnitude/Variance,
// recovery times and transition bullets). Algorithm replicated 1:1 from the leaked
// Source engine code:
//   - CCSWeaponInfo::GenerateRecoilTable  (cs_weapon_parse.cpp)
//   - CCSPlayer::KickBack                 (cs_player_shared.cpp)
//   - CCSGameMovement::DecayAimPunchAngle (cs_gamemovement.cpp)
//   - CWeaponCSBase::UpdateAccuracyPenalty/weapon recoil index decay (weapon_csbase.cpp)
//   - CUniformRandomStream                (vstdlib_random.cpp)
// Convar defaults: weapon_recoil_scale 2.0, view_recoil_tracking 0.45,
// weapon_recoil_view_punch_extra 0.055, weapon_recoil_decay2_exp 8,
// weapon_recoil_decay2_lin 18, weapon_recoil_vel_decay 4.5, view_punch_decay 18,
// weapon_recoil_decay_coefficient 2.0, weapon_recoil_variance 0.55,
// weapon_recoil_suppression_shots 4, weapon_recoil_suppression_factor 0.75.
// Game angle convention (radians): pitch > 0 kicks up, yaw > 0 kicks left.
// Bullet direction = eyeAngles + aimPunch * RECOIL_SCALE.
// Camera view      = eyeAngles + viewPunch + aimPunch * RECOIL_SCALE * VIEW_RECOIL_TRACKING.

export const RECOIL_SCALE = 2.0;
export const VIEW_RECOIL_TRACKING = 0.45;
const VIEW_PUNCH_EXTRA = 0.055;
const DECAY2_EXP = 8;
// Engine works in degrees (QAngle): weapon_recoil_decay2_lin is 18 deg/s.
// This module keeps every angle in radians, so convert the linear term.
const DECAY2_LIN = 18 * Math.PI / 180;
const VEL_DECAY = 4.5;
const VIEW_PUNCH_DECAY = 18;
const INDEX_DECAY = Math.log(10) * 2.0;
export const RECOIL_DECAY_THRESHOLD = 1.10;
const VARIANCE = 0.55;
const SUPPRESSION_SHOTS = 4;
const SUPPRESSION_FACTOR = 0.75;
const DEG2RAD = Math.PI / 180;
const TABLE_SIZE = 64;
const TICK_INTERVAL = 1 / 64;

// CUniformRandomStream (vstdlib/random.cpp). Park-Miller minimal standard with
// Bays-Durham shuffle; identical constants and evaluation order to the engine.
const IA = 16807, IM = 2147483647, IQ = 127773, IR = 2836, NTAB = 32;
const NDIV = 1 + Math.floor((IM - 1) / NTAB);
const AM = 1.0 / IM, RNMX = 1.0 - 1.2e-7;

class UniformRandomStream {
  setSeed(seed) {
    this.idum = seed < 0 ? seed : -seed;
    this.iy = 0;
    this.iv = new Array(NTAB).fill(0);
  }
  gen() {
    let j, k;
    if (this.idum <= 0 || !this.iy) {
      if (-this.idum < 1) this.idum = 1; else this.idum = -this.idum;
      for (j = NTAB + 7; j >= 0; j--) {
        k = Math.floor(this.idum / IQ);
        this.idum = IA * (this.idum - k * IQ) - IR * k;
        if (this.idum < 0) this.idum += IM;
        if (j < NTAB) this.iv[j] = this.idum;
      }
      this.iy = this.iv[0];
    }
    k = Math.floor(this.idum / IQ);
    this.idum = IA * (this.idum - k * IQ) - IR * k;
    if (this.idum < 0) this.idum += IM;
    j = Math.floor(this.iy / NDIV);
    j &= NTAB - 1;
    this.iy = this.iv[j];
    this.iv[j] = this.idum;
    return this.iy;
  }
  randomFloat(lo, hi) {
    let fl = AM * this.gen();
    if (fl > RNMX) fl = RNMX;
    return fl * (hi - lo) + lo;
  }
}

const lerp = (t, a, b) => a + (b - a) * t;

// Official parameters per in-game weapon id. recoilMode selects the vdata array
// index (1 = silenced variant for M4A1-S / USP-S, 0 for everything else).
// fullAuto follows the vdata m_bIsFullAuto flag: it drives table lerp/suppression
// and is independent from the game's trigger semantics.
const WEAPON_PARAMS = {
  ak47:     { seed: 223,   fullAuto: true,  angle: [0, 0], angleVar: [70, 70], magnitude: [30, 30], magVar: [0, 0], recoveryStand: 0.368,    recoveryCrouch: 0.305257, recoveryStandFinal: 0.506,    recoveryCrouchFinal: 0.419728, transStart: 2, transEnd: 5,  inaccuracyFire: [0.0078, 0.0078] },
  m4a4:     { seed: 38965, fullAuto: true,  angle: [0, 0], angleVar: [70, 70], magnitude: [23, 23], magVar: [0, 0], recoveryStand: 0.338941, recoveryCrouch: 0.2421,   recoveryStandFinal: 0.466044, recoveryCrouchFinal: 0.332888, transStart: 2, transEnd: 5,  inaccuracyFire: [0.007, 0.00634] },
  m4a1:     { seed: 38965, fullAuto: true,  angle: [0, 0], angleVar: [65, 65], magnitude: [25, 21], magVar: [3, 0], recoveryStand: 0.338941, recoveryCrouch: 0.2421,   recoveryStandFinal: 0.466044, recoveryCrouchFinal: 0.332888, transStart: 2, transEnd: 5,  inaccuracyFire: [0.012, 0.007], recoilMode: 1 },
  galilar:  { seed: 51191, fullAuto: true,  angle: [0, 0], angleVar: [70, 70], magnitude: [21, 21], magVar: [1, 1], recoveryStand: 0.3,      recoveryCrouch: 0.15,     recoveryStandFinal: 0.5,      recoveryCrouchFinal: 0.47,     transStart: 2, transEnd: 5,  inaccuracyFire: [0.007, 0.00585] },
  sg553:    { seed: 43500, fullAuto: true,  angle: [0, 0], angleVar: [60, 60], magnitude: [28, 19], magVar: [2, 2], recoveryStand: 0.452886, recoveryCrouch: 0.379204, recoveryStandFinal: 0.452886, recoveryCrouchFinal: 0.379204, transStart: 2, transEnd: 5,  inaccuracyFire: [0.00795, 0.0092] },
  mp9:      { seed: 50729, fullAuto: true,  angle: [0, 0], angleVar: [70, 70], magnitude: [21, 21], magVar: [1, 1], recoveryStand: 0.25789,  recoveryCrouch: 0.184207, recoveryStandFinal: 0.25789,  recoveryCrouchFinal: 0.184207, transStart: 2, transEnd: 5,  inaccuracyFire: [0.0037, 0.0037] },
  mac10:    { seed: 34079, fullAuto: true,  angle: [0, 0], angleVar: [70, 70], magnitude: [18, 18], magVar: [1, 1], recoveryStand: 0.399729, recoveryCrouch: 0.285521, recoveryStandFinal: 0.399729, recoveryCrouchFinal: 0.285521, transStart: 2, transEnd: 5,  inaccuracyFire: [0.00476, 0.00476] },
  mp7:      { seed: 61649, fullAuto: true,  angle: [0, 0], angleVar: [70, 70], magnitude: [16, 16], magVar: [1, 1], recoveryStand: 0.437491, recoveryCrouch: 0.312494, recoveryStandFinal: 0.437491, recoveryCrouchFinal: 0.312494, transStart: 2, transEnd: 5,  inaccuracyFire: [0.00218, 0.00218] },
  bizon:    { seed: 36387, fullAuto: true,  angle: [0, 0], angleVar: [70, 70], magnitude: [18, 18], magVar: [1, 1], recoveryStand: 0.331572, recoveryCrouch: 0.236837, recoveryStandFinal: 0.331572, recoveryCrouchFinal: 0.236837, transStart: 2, transEnd: 5,  inaccuracyFire: [0.00288, 0.00288] },
  xm1014:   { seed: 24862, fullAuto: true,  angle: [0, 0], angleVar: [20, 20], magnitude: [80, 80], magVar: [20, 20], recoveryStand: 0.506569, recoveryCrouch: 0.361835, recoveryStandFinal: 0.506569, recoveryCrouchFinal: 0.361835, transStart: 2, transEnd: 5, inaccuracyFire: [0.00883, 0.00883] },
  scar20:   { seed: 19364, fullAuto: true,  angle: [0, 0], angleVar: [30, 30], magnitude: [31, 31], magVar: [4, 4], recoveryStand: 0.544331, recoveryCrouch: 0.388808, recoveryStandFinal: 0.544331, recoveryCrouchFinal: 0.388808, transStart: 2, transEnd: 5,  inaccuracyFire: [0.01861, 0.01861] },
  awp:      { seed: 4100,  fullAuto: false, angle: [0, 0], angleVar: [20, 20], magnitude: [78, 25], magVar: [15, 2], recoveryStand: 0.34539,  recoveryCrouch: 0.24671,  recoveryStandFinal: 0.34539,  recoveryCrouchFinal: 0.24671,  transStart: 2, transEnd: 5,  inaccuracyFire: [0.05385, 0.05385] },
  ssg08:    { seed: 1278,  fullAuto: false, angle: [0, 0], angleVar: [20, 20], magnitude: [33, 25], magVar: [15, 2], recoveryStand: 0.142096, recoveryCrouch: 0.055783, recoveryStandFinal: 0.142096, recoveryCrouchFinal: 0.055783, transStart: 2, transEnd: 5,  inaccuracyFire: [0.02292, 0.02292] },
  deagle:   { seed: 12345, fullAuto: true,  angle: [0, 3], angleVar: [40, 50], magnitude: [20, 45], magVar: [0, 6], recoveryStand: 0.9,      recoveryCrouch: 0.7,      recoveryStandFinal: 0.8112,   recoveryCrouchFinal: 0.449927, transStart: 3, transEnd: 10, inaccuracyFire: [0.05, 0.055] },
  pistol:   { seed: 4484,  fullAuto: false, angle: [0, 0], angleVar: [20, 20], magnitude: [18, 30], magVar: [0, 5], recoveryStand: 0.2,      recoveryCrouch: 0.2,      recoveryStandFinal: 0.33,     recoveryCrouchFinal: 0.33,     transStart: 0, transEnd: 5,  inaccuracyFire: [0.056, 0.045] },
  usp:      { seed: 5426,  fullAuto: false, angle: [0, 0], angleVar: [0, 0],   magnitude: [29, 23], magVar: [0, 0], recoveryStand: 0.349532, recoveryCrouch: 0.291277, recoveryStandFinal: 0.349532, recoveryCrouchFinal: 0.291277, transStart: 3, transEnd: 10, inaccuracyFire: [0.071, 0.052], recoilMode: 1 },
  p250:     { seed: 9788,  fullAuto: false, angle: [0, 0], angleVar: [10, 10], magnitude: [26, 26], magVar: [3, 3], recoveryStand: 0.345388, recoveryCrouch: 0.287823, recoveryStandFinal: 0.345388, recoveryCrouchFinal: 0.287823, transStart: 3, transEnd: 10, inaccuracyFire: [0.05245, 0.05245] },
  fiveseven:{ seed: 33244, fullAuto: false, angle: [0, 0], angleVar: [5, 5],   magnitude: [25, 25], magVar: [4, 4], recoveryStand: 0.2,      recoveryCrouch: 0.2,      recoveryStandFinal: 0.5,      recoveryCrouchFinal: 0.5,      transStart: 0, transEnd: 5,  inaccuracyFire: [0.025, 0.03245] },
  elite:    { seed: 24563, fullAuto: false, angle: [0, 0], angleVar: [20, 20], magnitude: [27, 27], magVar: [4, 4], recoveryStand: 0.524989, recoveryCrouch: 0.437491, recoveryStandFinal: 0.524989, recoveryCrouchFinal: 0.437491, transStart: 3, transEnd: 10, inaccuracyFire: [0.01116, 0.01196] },
  tec9:     { seed: 789,   fullAuto: false, angle: [0, 0], angleVar: [60, 60], magnitude: [23, 23], magVar: [3, 3], recoveryStand: 0.391,    recoveryCrouch: 0.315,    recoveryStandFinal: 0.391,    recoveryCrouchFinal: 0.315,    transStart: 3, transEnd: 10, inaccuracyFire: [0.045, 0.03688] },
  nova:     { seed: 7763,  fullAuto: false, angle: [0, 0], angleVar: [20, 20], magnitude: [143, 143], magVar: [22, 22], recoveryStand: 0.460517, recoveryCrouch: 0.328941, recoveryStandFinal: 0.460517, recoveryCrouchFinal: 0.328941, transStart: 2, transEnd: 5, inaccuracyFire: [0.00972, 0.00972] },
  mag7:     { seed: 12518, fullAuto: false, angle: [0, 0], angleVar: [20, 20], magnitude: [165, 165], magVar: [25, 25], recoveryStand: 0.399729, recoveryCrouch: 0.285521, recoveryStandFinal: 0.399729, recoveryCrouchFinal: 0.285521, transStart: 2, transEnd: 5, inaccuracyFire: [0.01119, 0.01119] },
  sawedoff: { seed: 1089,  fullAuto: false, angle: [0, 0], angleVar: [20, 20], magnitude: [143, 143], magVar: [22, 22], recoveryStand: 0.460517, recoveryCrouch: 0.328941, recoveryStandFinal: 0.460517, recoveryCrouchFinal: 0.328941, transStart: 2, transEnd: 5, inaccuracyFire: [0.00972, 0.00972] },
  knife:    null
};

export function getRecoilParams(weaponId) {
  return WEAPON_PARAMS[weaponId] || WEAPON_PARAMS.ak47;
}

// CCSWeaponInfo::GenerateRecoilTable — one deterministic 64-entry table per mode.
// Entries stored in radians: {angle, magnitude}.
function generateRecoilTable(params, mode) {
  const rng = new UniformRandomStream();
  rng.setSeed(params.seed);
  let angle = 0, magnitude = 0;
  const rows = [];
  for (let j = 0; j < TABLE_SIZE; j++) {
    const angleNew = params.angle[mode] + rng.randomFloat(-params.angleVar[mode], params.angleVar[mode]);
    const magnitudeNew = params.magnitude[mode] + rng.randomFloat(-params.magVar[mode], params.magVar[mode]);
    if (params.fullAuto && j > 0) {
      angle = lerp(VARIANCE, angle, angleNew);
      magnitude = lerp(VARIANCE, magnitude, magnitudeNew);
    } else {
      angle = angleNew;
      magnitude = magnitudeNew;
    }
    if (params.fullAuto && j < SUPPRESSION_SHOTS) {
      magnitude *= lerp(j / SUPPRESSION_SHOTS, SUPPRESSION_FACTOR, 1.0);
    }
    rows.push(Object.freeze({ angle: angle * DEG2RAD, magnitude: magnitude * DEG2RAD }));
  }
  return Object.freeze(rows);
}

const tableCache = new Map();
export function getRecoilTable(weaponId) {
  let table = tableCache.get(weaponId);
  if (!table) {
    const params = getRecoilParams(weaponId);
    table = params ? Object.freeze([generateRecoilTable(params, 0), generateRecoilTable(params, 1)]) : null;
    tableCache.set(weaponId, table);
  }
  return table;
}

// Recoil state carried per player (server authoritative) and mirrored on the
// client for prediction. All angles in radians.
export function createRecoilState() {
  return { index: 0, pitch: 0, yaw: 0, velPitch: 0, velYaw: 0, viewPitch: 0, viewYaw: 0 };
}

// CCSPlayer::KickBack + CWeaponCSBase::Recoil call site: applies the table entry
// for the current (float) recoil index, then advances the index by one bullet.
export function applyRecoilKick(state, weaponId) {
  const params = getRecoilParams(weaponId);
  const table = getRecoilTable(weaponId);
  if (!params || !table) return state;
  const entry = table[params.recoilMode || 0][Math.floor(state.index) % TABLE_SIZE];
  const cos = Math.cos(entry.angle), sin = Math.sin(entry.angle);
  // The engine applies the table angle with the yaw component negated. Verified
  // against real CS2 compensation data (AK: bullets drift slightly left at 7-9,
  // swing right at 10-15, back left at 19-27, tail right at 28-30).
  state.velPitch += cos * entry.magnitude;
  state.velYaw -= sin * entry.magnitude;
  const viewMag = entry.magnitude * VIEW_PUNCH_EXTRA;
  state.viewPitch += cos * viewMag;
  state.viewYaw -= sin * viewMag;
  state.index += 1;
  return state;
}

function hybridDecayStep(state, dt) {
  const f = Math.exp(-DECAY2_EXP * dt);
  state.pitch *= f;
  state.yaw *= f;
  const mag = Math.hypot(state.pitch, state.yaw);
  const lin = DECAY2_LIN * dt;
  if (mag > lin) {
    const s = 1 - lin / mag;
    state.pitch *= s;
    state.yaw *= s;
  } else {
    state.pitch = 0;
    state.yaw = 0;
  }
  state.pitch += state.velPitch * dt * 0.5;
  state.yaw += state.velYaw * dt * 0.5;
  const vf = Math.exp(-VEL_DECAY * dt);
  state.velPitch *= vf;
  state.velYaw *= vf;
  state.pitch += state.velPitch * dt * 0.5;
  state.yaw += state.velYaw * dt * 0.5;
}

// CCSGameMovement::DecayAimPunchAngle + CGameMovement::DecayViewPunchAngle,
// stepped at the engine tick interval for any elapsed dt.
export function decayRecoilState(state, dt) {
  let remaining = Math.min(Math.max(dt, 0), 2);
  while (remaining > 1e-9) {
    const h = Math.min(TICK_INTERVAL, remaining);
    hybridDecayStep(state, h);
    const g = Math.exp(-VIEW_PUNCH_DECAY * h);
    state.viewPitch *= g;
    state.viewYaw *= g;
    remaining -= h;
  }
  if (Math.abs(state.velPitch) < 1e-6 && Math.abs(state.velYaw) < 1e-6) { state.velPitch = 0; state.velYaw = 0; }
  if (Math.abs(state.pitch) < 1e-6 && Math.abs(state.yaw) < 1e-6) { state.pitch = 0; state.yaw = 0; }
  if (Math.abs(state.viewPitch) < 1e-6 && Math.abs(state.viewYaw) < 1e-6) { state.viewPitch = 0; state.viewYaw = 0; }
  return state;
}

// weapon_csbase.cpp: m_flRecoilIndex decays once a little more than one cycle
// has passed since the last shot. `idleSeconds` is the time past that threshold.
export function decayRecoilIndex(state, idleSeconds) {
  if (state.index <= 0) { state.index = 0; return state; }
  state.index *= Math.exp(-INDEX_DECAY * Math.min(Math.max(idleSeconds, 0), 2));
  if (state.index < 1e-3) state.index = 0;
  return state;
}

const remapClamped = (x, a, b, c, d) => {
  if (a === b) return d;
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return c + (d - c) * t;
};

// CWeaponCSBase::GetRecoveryTime: stance selection with recoil-index transition.
export function getRecoveryTime(weaponId, opts = {}) {
  const params = getRecoilParams(weaponId);
  if (!params) return 0.3;
  const { crouch = false, inAir = false, onLadder = false, recoilIndex = 0 } = typeof opts === 'boolean' ? { crouch: opts } : opts;
  if (onLadder) return params.recoveryStand;
  if (inAir) return params.recoveryCrouch * 4;
  const n = Math.floor(recoilIndex);
  if (crouch) return remapClamped(n, params.transStart, params.transEnd, params.recoveryCrouch, params.recoveryCrouchFinal);
  return remapClamped(n, params.transStart, params.transEnd, params.recoveryStand, params.recoveryStandFinal);
}

// CWeaponCSBase::UpdateAccuracyPenalty decay branch:
// penalty decays exponentially toward the stance base with time constant
// recoveryTime / ln(10). The stance/movement base is layered separately by
// accuracyForShot, so here the fire penalty simply decays toward zero.
export function decayAccuracyPenalty(penalty, dt, recoveryTime) {
  if (!penalty || penalty <= 0) return 0;
  const v = penalty * Math.exp(-Math.max(dt, 0) * Math.LN10 / Math.max(0.01, recoveryTime));
  return v < 1e-5 ? 0 : v;
}

// inaccuracyFire for the weapon's active recoil mode (radians per shot).
export function getInaccuracyFire(weaponId) {
  const params = getRecoilParams(weaponId);
  return params ? params.inaccuracyFire[params.recoilMode || 0] : 0;
}

// Compat accessor matching the previous module surface.
export function getRecoilData(weaponId) {
  const params = getRecoilParams(weaponId);
  return Object.freeze({
    recoveryTimeStand: params.recoveryStand,
    recoveryTimeCrouch: params.recoveryCrouch,
    inaccuracyFire: params.inaccuracyFire[params.recoilMode || 0]
  });
}
