import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const KTS_POINTS_KEY = 'ktsPoints';
const KES_POINTS_KEY = 'kesPoints';
const PRIZE_THRESHOLD = 100;

const cheerNearPrize = [
    'So close — keep going!',
    'Almost legendary!',
    'Finish strong!',
];

const supabaseUrl = typeof window.SUPABASE_URL === 'string' ? window.SUPABASE_URL.trim() : '';
const supabaseAnonKey =
    typeof window.SUPABASE_ANON_KEY === 'string' ? window.SUPABASE_ANON_KEY.trim() : '';
const wantsRemote = Boolean(supabaseUrl && supabaseAnonKey);
/** True only after a successful load from Supabase (so failed init still uses localStorage). */
let dbEnabled = false;

let supabase = null;

let ktsPoints = 0;
let kesPoints = 0;

let ktsPointsElement;
let kesPointsElement;
let ktsPrizeMessage;
let kesPrizeMessage;
let resetAllButton;
let ktsCard;
let kesCard;
let ktsProgressFill;
let kesProgressFill;
let ktsProgressLabel;
let kesProgressLabel;
let ktsProgressbar;
let kesProgressbar;
let syncStatusEl;

let uiLocked = false;
let realtimeChannel = null;

function setSyncStatus(message, variant = '') {
    if (!syncStatusEl) return;
    syncStatusEl.textContent = message;
    syncStatusEl.className = 'sync-status' + (variant ? ` sync-status--${variant}` : '');
}

function progressPercent(points) {
    return Math.min(100, Math.max(0, (points / PRIZE_THRESHOLD) * 100));
}

function cheerForPoints(points) {
    if (points >= 80 && points < PRIZE_THRESHOLD) {
        return cheerNearPrize[points % cheerNearPrize.length];
    }
    if (points >= 50 && points < 80) {
        return 'Halfway hero energy!';
    }
    if (points >= 25 && points < 50) {
        return 'Nice momentum!';
    }
    if (points > 0 && points < 25) {
        return 'Every point counts!';
    }
    return '';
}

function updateProgressUI(kid, points) {
    const pct = progressPercent(points);
    const labelText = `${Math.min(points, PRIZE_THRESHOLD)} / ${PRIZE_THRESHOLD} to prize`;

    if (kid === 'kts') {
        ktsProgressFill.style.width = `${pct}%`;
        ktsProgressLabel.textContent = labelText;
        ktsProgressbar.setAttribute('aria-valuenow', String(Math.min(points, PRIZE_THRESHOLD)));
    } else {
        kesProgressFill.style.width = `${pct}%`;
        kesProgressLabel.textContent = labelText;
        kesProgressbar.setAttribute('aria-valuenow', String(Math.min(points, PRIZE_THRESHOLD)));
    }
}

function pulseCard(kid) {
    const card = kid === 'kts' ? ktsCard : kesCard;
    card.classList.remove('pop');
    void card.offsetWidth;
    card.classList.add('pop');
}

function checkPrizeStatus(kid, points, previousPoints, options = {}) {
    const { isInitial = false } = options;
    const prizeMessageElement = kid === 'kts' ? ktsPrizeMessage : kesPrizeMessage;

    const crossedPrize =
        !isInitial &&
        typeof previousPoints === 'number' &&
        previousPoints < PRIZE_THRESHOLD &&
        points >= PRIZE_THRESHOLD;

    if (points >= PRIZE_THRESHOLD) {
        prizeMessageElement.innerHTML = '🎉 PRIZE UNLOCKED! You did it! 🎉';
        if (crossedPrize) {
            triggerConfetti();
        }
    } else {
        const cheer = cheerForPoints(points);
        prizeMessageElement.textContent = cheer;
    }
}

/**
 * @param {string} kid
 * @param {number} points
 * @param {number | undefined} previousPoints
 * @param {{ persist?: boolean; isInitial?: boolean }} [options]
 */
function applyKidPoints(kid, points, previousPoints, options = {}) {
    const { persist = false, isInitial = false } = options;

    if (kid === 'kts') {
        ktsPoints = points;
        ktsPointsElement.textContent = String(points);
        if (persist && !dbEnabled) {
            localStorage.setItem(KTS_POINTS_KEY, String(points));
        }
    } else if (kid === 'kes') {
        kesPoints = points;
        kesPointsElement.textContent = String(points);
        if (persist && !dbEnabled) {
            localStorage.setItem(KES_POINTS_KEY, String(points));
        }
    }

    updateProgressUI(kid, points);
    checkPrizeStatus(kid, points, previousPoints, { isInitial });
}

function triggerConfetti() {
    const colors = ['#ffeb3b', '#ff4081', '#2196f3', '#4caf50', '#ff9800'];
    for (let i = 0; i < 50; i++) {
        const confetti = document.createElement('div');
        confetti.classList.add('confetti');
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.animationDuration = Math.random() * 2 + 3 + 's';
        confetti.style.animationDelay = Math.random() * 0.5 + 's';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        document.body.appendChild(confetti);

        confetti.addEventListener('animationend', () => {
            confetti.remove();
        });
    }
}

function setUiLocked(locked) {
    uiLocked = locked;
    document.querySelectorAll('button').forEach((btn) => {
        btn.disabled = locked;
    });
}

function rowToPoints(rows, kid) {
    const row = rows.find((r) => r.kid_id === kid);
    return row ? Math.max(0, parseInt(String(row.points), 10) || 0) : 0;
}

async function fetchPointsFromSupabase() {
    const { data, error } = await supabase.from('kid_points').select('kid_id, points');
    if (error) throw error;
    if (!data || data.length === 0) {
        throw new Error('No rows in kid_points');
    }
    return {
        kts: rowToPoints(data, 'kts'),
        kes: rowToPoints(data, 'kes'),
    };
}

function applyRowsFromServer(rows, isInitial) {
    const nextKts = rowToPoints(rows, 'kts');
    const nextKes = rowToPoints(rows, 'kes');
    const prevKts = ktsPoints;
    const prevKes = kesPoints;
    applyKidPoints('kts', nextKts, prevKts, { isInitial });
    applyKidPoints('kes', nextKes, prevKes, { isInitial });
}

function subscribeRealtime() {
    if (!supabase || realtimeChannel) return;

    realtimeChannel = supabase
        .channel('kid-points-changes')
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'kid_points' },
            (payload) => {
                const row = payload.new;
                if (!row || !row.kid_id) return;
                const kid = row.kid_id;
                const next = Math.max(0, parseInt(String(row.points), 10) || 0);
                const prev = kid === 'kts' ? ktsPoints : kesPoints;
                applyKidPoints(kid, next, prev, { isInitial: false });
            },
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                setSyncStatus('Live sync on', 'ok');
            }
        });
}

async function handlePointChange(event) {
    if (uiLocked) return;

    const button = event.currentTarget;
    const kid = button.dataset.kid;
    const delta = parseInt(button.dataset.points, 10);

    if (!kid || Number.isNaN(delta)) {
        return;
    }

    pulseCard(kid);

    if (dbEnabled && supabase) {
        setUiLocked(true);
        setSyncStatus('Saving…', 'warn');
        try {
            const { data, error } = await supabase.rpc('increment_kid_points', {
                p_kid_id: kid,
                p_delta: delta,
            });
            if (error) throw error;
            const next = Math.max(0, parseInt(String(data), 10) || 0);
            const prev = kid === 'kts' ? ktsPoints : kesPoints;
            applyKidPoints(kid, next, prev, { isInitial: false });
            setSyncStatus('Saved to Supabase', 'ok');
        } catch (e) {
            console.error(e);
            setSyncStatus('Could not save — check console / project keys', 'error');
        } finally {
            setUiLocked(false);
        }
        return;
    }

    if (kid === 'kts') {
        const prev = ktsPoints;
        ktsPoints += delta;
        if (ktsPoints < 0) ktsPoints = 0;
        applyKidPoints('kts', ktsPoints, prev, { persist: true, isInitial: false });
    } else if (kid === 'kes') {
        const prev = kesPoints;
        kesPoints += delta;
        if (kesPoints < 0) kesPoints = 0;
        applyKidPoints('kes', kesPoints, prev, { persist: true, isInitial: false });
    }
}

async function handleReset() {
    if (!confirm('Reset everyone to zero?')) {
        return;
    }

    if (dbEnabled && supabase) {
        setUiLocked(true);
        setSyncStatus('Resetting…', 'warn');
        try {
            const { error: rpcError } = await supabase.rpc('reset_all_kid_points');
            if (rpcError) throw rpcError;
            const { data, error } = await supabase.from('kid_points').select('kid_id, points');
            if (error) throw error;
            applyRowsFromServer(data || [], false);
            setSyncStatus('Reset saved', 'ok');
        } catch (e) {
            console.error(e);
            setSyncStatus('Reset failed — see console', 'error');
        } finally {
            setUiLocked(false);
        }
        return;
    }

    const prevKts = ktsPoints;
    const prevKes = kesPoints;
    ktsPoints = 0;
    kesPoints = 0;
    applyKidPoints('kts', 0, prevKts, { persist: true, isInitial: false });
    applyKidPoints('kes', 0, prevKes, { persist: true, isInitial: false });
}

async function init() {
    ktsPointsElement = document.getElementById('kts-points');
    kesPointsElement = document.getElementById('kes-points');
    ktsPrizeMessage = document.getElementById('kts-prize');
    kesPrizeMessage = document.getElementById('kes-prize');
    resetAllButton = document.getElementById('reset-all');
    ktsCard = document.getElementById('kts-card');
    kesCard = document.getElementById('kes-card');
    ktsProgressFill = document.getElementById('kts-progress-fill');
    kesProgressFill = document.getElementById('kes-progress-fill');
    ktsProgressLabel = document.getElementById('kts-progress-label');
    kesProgressLabel = document.getElementById('kes-progress-label');
    ktsProgressbar = document.getElementById('kts-progressbar');
    kesProgressbar = document.getElementById('kes-progressbar');
    syncStatusEl = document.getElementById('sync-status');

    if (wantsRemote) {
        supabase = createClient(supabaseUrl, supabaseAnonKey);
        setSyncStatus('Loading scores…', 'warn');
        setUiLocked(true);
        try {
            const { kts, kes } = await fetchPointsFromSupabase();
            applyKidPoints('kts', kts, undefined, { isInitial: true });
            applyKidPoints('kes', kes, undefined, { isInitial: true });
            dbEnabled = true;
            setSyncStatus('Connected to Supabase', 'ok');
            subscribeRealtime();
        } catch (e) {
            console.error(e);
            setSyncStatus('Supabase load failed — using this device only', 'error');
            dbEnabled = false;
            supabase = null;
            ktsPoints = parseInt(localStorage.getItem(KTS_POINTS_KEY) || '0', 10);
            kesPoints = parseInt(localStorage.getItem(KES_POINTS_KEY) || '0', 10);
            applyKidPoints('kts', ktsPoints, undefined, { isInitial: true });
            applyKidPoints('kes', kesPoints, undefined, { isInitial: true });
        } finally {
            setUiLocked(false);
        }
    } else {
        setSyncStatus('Local only — add config.js for cloud sync', 'warn');
        ktsPoints = parseInt(localStorage.getItem(KTS_POINTS_KEY) || '0', 10);
        kesPoints = parseInt(localStorage.getItem(KES_POINTS_KEY) || '0', 10);
        applyKidPoints('kts', ktsPoints, undefined, { isInitial: true });
        applyKidPoints('kes', kesPoints, undefined, { isInitial: true });
    }

    document.querySelectorAll('.add-btn').forEach((button) => {
        button.addEventListener('click', handlePointChange);
    });

    document.querySelectorAll('.subtract-btn').forEach((button) => {
        button.addEventListener('click', handlePointChange);
    });

    resetAllButton.addEventListener('click', handleReset);
}

document.addEventListener('DOMContentLoaded', () => {
    init();
});
