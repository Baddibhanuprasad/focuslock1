const db = require('./db');

const DAILY_LIMIT_SEC = 30 * 60;
const WARNING_START_SEC = 20 * 60;
const WARNING_EVERY_SEC = 5 * 60;
const FOCUS_UNLOCK_SEC = 60 * 60;
const BONUS_ACCESS_SEC = 15 * 60;

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIntSafe(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseWarned(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

async function loadState() {
  const settings = await db.getSettings();
  const day = todayKey();
  let dayKey = settings.shorts_day_key || '';
  let dailyUsed = parseIntSafe(settings.shorts_daily_used_seconds, 0);
  let locked = settings.shorts_locked === 'true';
  let bonus = parseIntSafe(settings.shorts_bonus_seconds, 0);
  let focusCredit = parseIntSafe(settings.shorts_focus_credit_seconds, 0);
  let warned = parseWarned(settings.shorts_warned_json);

  // New calendar day → reset daily allotment + lock (fresh 30 minutes)
  if (dayKey !== day) {
    dayKey = day;
    dailyUsed = 0;
    locked = false;
    bonus = 0;
    focusCredit = 0;
    warned = [];
    await persist({ dayKey, dailyUsed, locked, bonus, focusCredit, warned });
  }

  return { dayKey, dailyUsed, locked, bonus, focusCredit, warned };
}

async function persist(state) {
  await db.saveSetting('shorts_day_key', state.dayKey);
  await db.saveSetting('shorts_daily_used_seconds', String(state.dailyUsed));
  await db.saveSetting('shorts_locked', state.locked ? 'true' : 'false');
  await db.saveSetting('shorts_bonus_seconds', String(Math.max(0, state.bonus)));
  await db.saveSetting('shorts_focus_credit_seconds', String(Math.max(0, state.focusCredit)));
  await db.saveSetting('shorts_warned_json', JSON.stringify(state.warned || []));
}

function buildStatus(state, extras = {}) {
  const dailyRemaining = Math.max(0, DAILY_LIMIT_SEC - state.dailyUsed);
  const canUseDaily = !state.locked && dailyRemaining > 0;
  const canUseBonus = state.bonus > 0;
  const allowed = canUseDaily || canUseBonus;

  let remainingSeconds = 0;
  let pool = 'none';
  if (canUseDaily) {
    remainingSeconds = dailyRemaining;
    pool = 'daily';
  } else if (canUseBonus) {
    remainingSeconds = state.bonus;
    pool = 'bonus';
  }

  const focusNeeded = state.locked && state.bonus <= 0
    ? Math.max(0, FOCUS_UNLOCK_SEC - state.focusCredit)
    : 0;

  return {
    allowed,
    locked: !allowed,
    pool,
    remainingSeconds,
    dailyLimitSeconds: DAILY_LIMIT_SEC,
    dailyUsedSeconds: state.dailyUsed,
    dailyRemainingSeconds: dailyRemaining,
    bonusSeconds: state.bonus,
    focusCreditSeconds: state.focusCredit,
    focusNeededSeconds: focusNeeded,
    focusUnlockSeconds: FOCUS_UNLOCK_SEC,
    bonusGrantSeconds: BONUS_ACCESS_SEC,
    warningStartSeconds: WARNING_START_SEC,
    ...extras
  };
}

/**
 * Which warning milestones have been crossed (20, 25, …) for daily usage.
 */
function computeNewWarnings(prevWarned, dailyUsed) {
  const warnings = [];
  const updated = [...prevWarned];
  if (dailyUsed < WARNING_START_SEC) return { warnings, warned: updated };

  for (let t = WARNING_START_SEC; t < DAILY_LIMIT_SEC; t += WARNING_EVERY_SEC) {
    if (dailyUsed >= t && !updated.includes(t)) {
      updated.push(t);
      const minsLeft = Math.max(0, Math.ceil((DAILY_LIMIT_SEC - dailyUsed) / 60));
      warnings.push({
        atSeconds: t,
        message:
          minsLeft > 0
            ? `Curated Shorts: ${Math.floor(t / 60)} minutes used. About ${minsLeft} minute(s) left today — then this mode locks.`
            : 'Curated Shorts daily limit reached. Mode will lock.'
      });
    }
  }
  return { warnings, warned: updated };
}

async function getStatus() {
  const state = await loadState();
  return buildStatus(state);
}

/**
 * Tick usage while user is in Curated Shorts (heartbeat).
 * @param {number} seconds - elapsed since last heartbeat (clamped)
 */
async function heartbeat(seconds = 5) {
  const add = Math.max(0, Math.min(30, Math.floor(Number(seconds) || 0)));
  const state = await loadState();
  const warnings = [];
  let justLocked = false;
  let lockMessage = null;

  const dailyRemaining = Math.max(0, DAILY_LIMIT_SEC - state.dailyUsed);
  const allowed = (!state.locked && dailyRemaining > 0) || state.bonus > 0;

  if (!allowed || add <= 0) {
    return buildStatus(state, { warnings, justLocked, lockMessage, ticked: 0 });
  }

  let left = add;

  // Prefer daily pool while unlocked; otherwise burn bonus
  if (!state.locked && dailyRemaining > 0) {
    const take = Math.min(left, dailyRemaining);
    state.dailyUsed += take;
    left -= take;

    const w = computeNewWarnings(state.warned, state.dailyUsed);
    state.warned = w.warned;
    warnings.push(...w.warnings);

    if (state.dailyUsed >= DAILY_LIMIT_SEC) {
      state.locked = true;
      state.dailyUsed = DAILY_LIMIT_SEC;
      justLocked = true;
      lockMessage =
        'Curated Shorts locked for today (30 minutes used). Complete 60 minutes of Focus Mode to unlock 15 more minutes.';
    }
  }

  if (left > 0 && state.bonus > 0) {
    const take = Math.min(left, state.bonus);
    state.bonus -= take;
    left -= take;
    if (state.bonus <= 0) {
      state.bonus = 0;
      state.locked = true;
      justLocked = true;
      lockMessage =
        'Bonus Curated Shorts time finished. Complete another 60 minutes of Focus Mode to unlock 15 more minutes.';
    }
  }

  await persist(state);
  return buildStatus(state, { warnings, justLocked, lockMessage, ticked: add - left });
}

/**
 * Credit completed focus time toward unlock when shorts are locked.
 * @param {number} focusSeconds - actual focused seconds this session
 */
async function creditFocusTime(focusSeconds) {
  const add = Math.max(0, Math.floor(Number(focusSeconds) || 0));
  const state = await loadState();
  let unlocked = false;
  let unlockMessage = null;

  // Only accumulate toward unlock when daily limit is exhausted and no bonus left
  const needsUnlock = state.locked && state.bonus <= 0;
  if (!needsUnlock || add <= 0) {
    return buildStatus(state, { unlocked, unlockMessage, creditedSeconds: 0 });
  }

  state.focusCredit += add;

  if (state.focusCredit >= FOCUS_UNLOCK_SEC) {
    state.focusCredit = state.focusCredit - FOCUS_UNLOCK_SEC;
    state.bonus += BONUS_ACCESS_SEC;
    state.locked = false; // allowed via bonus
    unlocked = true;
    unlockMessage = `Focus goal met! You unlocked ${BONUS_ACCESS_SEC / 60} minutes of Curated Shorts.`;
  }

  await persist(state);
  return buildStatus(state, { unlocked, unlockMessage, creditedSeconds: add });
}

module.exports = {
  DAILY_LIMIT_SEC,
  WARNING_START_SEC,
  WARNING_EVERY_SEC,
  FOCUS_UNLOCK_SEC,
  BONUS_ACCESS_SEC,
  getStatus,
  heartbeat,
  creditFocusTime
};
