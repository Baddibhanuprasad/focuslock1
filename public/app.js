// FOCUS MODE CLIENT APPLICATION SCRIPT

let activeSession = null;
let isSessionStartedByUser = false;
let currentEAR = 0.0;
let isUserPresent = true;
let isDrowsy = false;
let drowsyCounter = 0;
let absenceCounter = 0;
let currentMathAnswer = null;
let soundFXEnabled = true;
let lastDistractionAudioTime = 0;
let drowsyCooldownUntil = 0;
let audioCtx = null;

// MediaPipe FaceMesh Setup
let faceMesh = null;
let camera = null;

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', initAudioContext, { once: true });
  document.addEventListener('keydown', initAudioContext, { once: true });

  const mathInput = document.getElementById('math-answer-input');
  if (mathInput) {
    mathInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') submitWakeUpTask();
    });
  }

  initWebcamMonitoring();
  startWindowTracker();
  syncStatus();
  setInterval(syncStatus, 1000);
  loadHistory();
  generateNewMathProblem(); // Initialize random math problem and currentMathAnswer immediately on load!
});

// TAB NAVIGATION CONTROLLER
function switchTab(tabId) {
  // Update sidebar active button
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`nav-${tabId}`).classList.add('active');

  // Update view section visibility
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
  document.getElementById(`view-${tabId}`).classList.remove('hidden');

  // Update top bar titles
  const titleElem = document.getElementById('page-title');
  const subElem = document.getElementById('page-subtitle');

  if (tabId === 'focus') {
    titleElem.textContent = 'Focus Session & Shield';
    subElem.textContent = 'Set your timer, silence notifications, and stay alert.';
  } else if (tabId === 'roadmap') {
    titleElem.textContent = 'Skill Roadmap Generator';
    subElem.textContent = 'Structured learning paths with free courses first and paid certs second.';
  } else if (tabId === 'history') {
    titleElem.textContent = 'Session Analytics & History';
    subElem.textContent = 'Track your focus duration and distraction history over time.';
  }
}

function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function toggleSoundFX() {
  soundFXEnabled = !soundFXEnabled;
  const lbl = document.getElementById('sound-status-lbl');
  const icon = document.getElementById('sound-icon');
  if (soundFXEnabled) {
    lbl.textContent = 'ON';
    icon.textContent = '🔊';
  } else {
    lbl.textContent = 'OFF';
    icon.textContent = '🔇';
  }
}

function selectPresetGoal(goal) {
  document.getElementById('goal-input').value = goal;
}

// ------------------------------------------------------------------
// 1. FOCUS MODE (DESKTOP SHELL)
// ------------------------------------------------------------------

function handleDurationChange() {
  const sel = document.getElementById('duration-select');
  const customInput = document.getElementById('custom-duration-input');
  if (sel.value === 'custom') {
    customInput.classList.remove('hidden');
    customInput.focus();
  } else {
    customInput.classList.add('hidden');
  }
}

async function startFocusSession() {
  initAudioContext();
  const goalTag = document.getElementById('goal-input').value.trim() || 'General Focus';
  
  const selVal = document.getElementById('duration-select').value;
  let durationMinutes = 25;

  if (selVal === 'custom') {
    const customVal = parseInt(document.getElementById('custom-duration-input').value, 10);
    durationMinutes = (!isNaN(customVal) && customVal > 0) ? customVal : 25;
  } else {
    durationMinutes = parseInt(selVal, 10);
  }

  try {
    const res = await fetch('/api/focus/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationMinutes, goalTag })
    });
    const data = await res.json();

    if (data.success) {
      activeSession = data.session;
      isSessionStartedByUser = true;
      updateUIForActiveSession(true);
      generateNewMathProblem(); // Guarantee a fresh math question for the new session!
      if (soundFXEnabled) playChimeTone(660, 0.4);
    }
  } catch (err) {
    console.error('Error starting focus session:', err);
  }
}

async function endFocusSession() {
  try {
    const res = await fetch('/api/focus/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: activeSession ? activeSession.sessionId : null })
    });
    const data = await res.json();

    if (data.success) {
      activeSession = null;
      isSessionStartedByUser = false;
      updateUIForActiveSession(false);
      if (soundFXEnabled) playChimeTone(440, 0.5);
      alert(`Focus Session Completed!\n\nGoal: ${data.summary.goalTag}\nDuration: ${data.summary.durationMinutes} minutes\nDistraction Count: ${data.summary.distractionCount}\nDrowsy Alerts: ${data.summary.drowsyCount}`);
      loadHistory();
    }
  } catch (err) {
    console.error('Error ending focus session:', err);
  }
}

function updateUIForActiveSession(isActive) {
  const badge = document.getElementById('session-status-badge');
  const btnStart = document.getElementById('btn-start-focus');
  const btnEnd = document.getElementById('btn-end-focus');
  const dndBadge = document.getElementById('dnd-badge');

  if (isActive) {
    badge.textContent = 'Active Focus';
    badge.className = 'status-badge badge-active';
    btnStart.classList.add('hidden');
    btnEnd.classList.remove('hidden');
    
    dndBadge.className = 'pill pill-ready';
    dndBadge.innerHTML = '<span class="dot"></span> OS DND: ACTIVE';
  } else {
    badge.textContent = 'Inactive';
    badge.className = 'status-badge badge-inactive';
    btnStart.classList.remove('hidden');
    btnEnd.classList.add('hidden');

    dndBadge.className = 'pill pill-off';
    dndBadge.innerHTML = '<span class="dot"></span> OS DND: OFF';
    
    document.getElementById('timer-text').textContent = '25:00';
    document.getElementById('timer-goal-label').textContent = 'Select a Goal to Begin';
    updateProgressRing(1, 1);
    dismissDistractionAlert();
  }
}

function updateProgressRing(timeRemaining, totalDurationMinutes) {
  const circle = document.getElementById('timer-progress-bar');
  if (!circle) return;
  const circumference = 534;
  const totalSeconds = (totalDurationMinutes || 25) * 60;
  const fraction = Math.max(0, Math.min(1, timeRemaining / totalSeconds));
  const offset = circumference - (fraction * circumference);
  circle.style.strokeDashoffset = offset;
}

async function syncStatus() {
  try {
    const res = await fetch('/api/focus/status');
    const data = await res.json();

    const dndBadge = document.getElementById('dnd-badge');
    const ytBadge = document.getElementById('yt-badge');

    if (data.isDNDMuted) {
      dndBadge.className = 'pill pill-ready';
      dndBadge.innerHTML = '<span class="dot"></span> OS DND: ACTIVE';
    } else {
      dndBadge.className = 'pill pill-off';
      dndBadge.innerHTML = '<span class="dot"></span> OS DND: OFF';
    }

    if (data.pauseYouTube) {
      ytBadge.className = 'pill pill-off';
      ytBadge.innerHTML = `<span class="dot"></span> Shield Active`;
    } else {
      ytBadge.className = 'pill pill-ready';
      ytBadge.innerHTML = '<span class="dot"></span> Distraction Shield: Ready';
    }

    if (data.activeDistraction && activeSession) {
      showDistractionAlert(`Opened distracting page: "${data.activeDistraction.title}"`);
      playDistractionSound();
    } else if (!data.activeDistraction) {
      dismissDistractionAlert();
    }

    if (data.sessionId && isSessionStartedByUser) {
      activeSession = data;
      updateUIForActiveSession(true);

      const mins = Math.floor(data.timeRemaining / 60);
      const secs = data.timeRemaining % 60;
      document.getElementById('timer-text').textContent = 
        `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      document.getElementById('timer-goal-label').textContent = data.goalTag;

      updateProgressRing(data.timeRemaining, data.durationMinutes);

      document.getElementById('metric-distractions').textContent = data.distractionEvents.length;
      document.getElementById('metric-drowsy').textContent = data.drowsyEvents.length;
      document.getElementById('metric-presence').textContent = data.isUserPresent ? (data.isDrowsy ? 'Drowsy 😴' : 'Focused 🎯') : 'Away 🚶';
    } else if (!isSessionStartedByUser) {
      activeSession = null;
      updateUIForActiveSession(false);
    }
  } catch (err) {}
}

// ------------------------------------------------------------------
// 2. SCREEN & WEBCAM MONITORING
// ------------------------------------------------------------------

function initWebcamMonitoring() {
  const videoElement = document.getElementById('webcam-video');
  const canvasElement = document.getElementById('webcam-canvas');
  const canvasCtx = canvasElement.getContext('2d');
  const webcamStatusChip = document.getElementById('webcam-status-chip');

  if (typeof FaceMesh === 'undefined') {
    webcamStatusChip.textContent = 'Simulated Camera';
    webcamStatusChip.className = 'status-badge badge-neutral';
    startSimulatedCamera(canvasCtx, canvasElement);
    return;
  }

  faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
  });

  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  faceMesh.onResults((results) => {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const landmarks = results.multiFaceLandmarks[0];
      
      currentEAR = calculateEAR(landmarks);
      isUserPresent = true;
      absenceCounter = 0;

      if (isSessionStartedByUser && activeSession && activeSession.sessionId) {
        if (Date.now() < drowsyCooldownUntil) {
          drowsyCounter = 0;
          isDrowsy = false;
        } else if (currentEAR < 0.21) {
          drowsyCounter++;
          if (drowsyCounter > 8) {
            isDrowsy = true;
            triggerDrowsinessAlert();
          }
        } else {
          drowsyCounter = 0;
          isDrowsy = false;
        }
      } else {
        drowsyCounter = 0;
        isDrowsy = false;
      }
    } else {
      absenceCounter++;
      if (absenceCounter > 10) {
        isUserPresent = false;
        isDrowsy = false;
      }
    }
    canvasCtx.restore();

    updateCleanStatusCards();
    sendPresenceSignal();
  });

  if (typeof Camera !== 'undefined') {
    camera = new Camera(videoElement, {
      onFrame: async () => {
        await faceMesh.send({ image: videoElement });
      },
      width: 360,
      height: 220
    });
    camera.start().then(() => {
      webcamStatusChip.textContent = 'Camera Active';
      webcamStatusChip.className = 'status-badge badge-active';
    }).catch(() => {
      webcamStatusChip.textContent = 'Simulated Monitor';
      startSimulatedCamera(canvasCtx, canvasElement);
    });
  } else {
    startSimulatedCamera(canvasCtx, canvasElement);
  }
}

function startSimulatedCamera(canvasCtx, canvasElement) {
  setInterval(() => {
    canvasCtx.fillStyle = '#0F172A';
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
    
    canvasCtx.fillStyle = '#38BDF8';
    canvasCtx.font = '14px Inter';
    canvasCtx.fillText('Camera Active', 130, 105);
    canvasCtx.fillText(`Presence: ${isUserPresent ? 'Present' : 'Absent'}`, 120, 125);

    currentEAR = 0.28 + (Math.random() * 0.04 - 0.02);
    updateCleanStatusCards();
    sendPresenceSignal();
  }, 1000);
}

function calculateEAR(landmarks) {
  const p1 = landmarks[33], p2 = landmarks[160], p3 = landmarks[158];
  const p4 = landmarks[133], p5 = landmarks[153], p6 = landmarks[144];

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  
  const vertical1 = dist(p2, p6);
  const vertical2 = dist(p3, p5);
  const horizontal = dist(p1, p4);

  return (vertical1 + vertical2) / (2.0 * horizontal);
}

function updateCleanStatusCards() {
  const earStatusText = document.getElementById('ear-status-text');
  const presBadge = document.getElementById('presence-badge');

  if (isUserPresent) {
    if (isDrowsy) {
      earStatusText.textContent = 'Drowsy 😴';
      earStatusText.className = 'box-value value-drowsy';
      presBadge.textContent = '😴 Drowsy';
      presBadge.style.color = '#EF4444';
    } else {
      earStatusText.textContent = 'Normal & Alert 🎯';
      earStatusText.className = 'box-value value-good';
      presBadge.textContent = '🎯 Alert & Focused';
      presBadge.style.color = '#22C55E';
    }
  } else {
    earStatusText.textContent = 'Away from Desk';
    earStatusText.className = 'box-value';
    presBadge.textContent = '🚶 Away';
    presBadge.style.color = '#94A3B8';
  }
}

async function sendPresenceSignal() {
  try {
    await fetch('/api/focus/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isUserPresent, isDrowsy })
    });
  } catch (e) {}
}

function startWindowTracker() {
  setInterval(async () => {
    try {
      const res = await fetch('/api/window/active');
      const data = await res.json();

      document.getElementById('active-proc-name').textContent = data.processName || 'System';
      document.getElementById('active-win-title').textContent = data.windowTitle || 'Desktop Workspace';
      
      const catPill = document.getElementById('active-category-pill');
      catPill.textContent = data.category;
      catPill.className = `cat-pill pill-${data.category}`;

      if (data.category === 'distracting' && activeSession) {
        showDistractionAlert(`Opened distracting window: "${data.windowTitle}"`);
        playDistractionSound();
      }
    } catch (e) {}
  }, 1000);
}

function playDistractionSound() {
  if (!soundFXEnabled) return;
  const now = Date.now();
  if (now - lastDistractionAudioTime < 4000) return;
  lastDistractionAudioTime = now;

  try {
    initAudioContext();
    if (!audioCtx) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.6);

    gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.6);
  } catch (e) {}
}

function playChimeTone(freq = 520, duration = 0.3) {
  try {
    initAudioContext();
    if (!audioCtx) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {}
}

function showDistractionAlert(msg) {
  const alertBanner = document.getElementById('distraction-alert-banner');
  document.getElementById('distraction-alert-msg').textContent = msg;
  alertBanner.classList.remove('hidden');
}

function dismissDistractionAlert() {
  document.getElementById('distraction-alert-banner').classList.add('hidden');
}

function generateNewMathProblem() {
  const num1 = Math.floor(Math.random() * 58) + 12;
  const num2 = Math.floor(Math.random() * 58) + 12;
  currentMathAnswer = num1 + num2;

  const textElem = document.getElementById('math-problem-text');
  if (textElem) textElem.textContent = `${num1} + ${num2} = ?`;

  const inputElem = document.getElementById('math-answer-input');
  if (inputElem) {
    inputElem.value = '';
    setTimeout(() => inputElem.focus(), 150);
  }

  const errElem = document.getElementById('math-error-msg');
  if (errElem) errElem.classList.add('hidden');
}

function triggerDrowsinessAlert() {
  if (!isSessionStartedByUser || !activeSession || !activeSession.sessionId) return;
  if (Date.now() < drowsyCooldownUntil) return;

  const modal = document.getElementById('wakeup-modal');
  if (modal && modal.classList.contains('hidden')) {
    generateNewMathProblem();
    modal.classList.remove('hidden');
    playDistractionSound();

    fetch('/api/events/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'DROWSY', details: 'Drowsiness wake-up prompt triggered' })
    });
  }
}

function submitWakeUpTask() {
  const inputElem = document.getElementById('math-answer-input');
  const input = parseInt(inputElem.value, 10);

  if (input === currentMathAnswer) {
    document.getElementById('wakeup-modal').classList.add('hidden');
    isDrowsy = false;
    drowsyCounter = 0;
    drowsyCooldownUntil = Date.now() + 25000;
    
    // Pre-generate fresh problem for next time
    generateNewMathProblem();

    sendPresenceSignal();
    if (soundFXEnabled) playChimeTone(880, 0.4);
  } else {
    document.getElementById('math-error-msg').classList.remove('hidden');
  }
}

// ------------------------------------------------------------------
// 3. SKILL ROADMAP GENERATOR
// ------------------------------------------------------------------

async function generateRoadmap() {
  const goalText = document.getElementById('roadmap-goal-input').value.trim();
  if (!goalText) return;

  const btn = document.getElementById('btn-gen-roadmap');
  const container = document.getElementById('roadmap-results-container');
  
  btn.textContent = '⏳ Generating...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/roadmap/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalText })
    });
    const data = await res.json();

    if (data.success && data.roadmap) {
      renderRoadmapUI(data.roadmap);
      if (soundFXEnabled) playChimeTone(700, 0.3);
    }
  } catch (err) {
    console.error('Roadmap error:', err);
  } finally {
    btn.textContent = '✨ Generate Roadmap';
    btn.disabled = false;
  }
}

function renderRoadmapUI(roadmapJson) {
  const container = document.getElementById('roadmap-results-container');
  container.innerHTML = '';

  if (!roadmapJson.stages || roadmapJson.stages.length === 0) {
    container.innerHTML = '<p>No stages generated.</p>';
    return;
  }

  roadmapJson.stages.forEach((stage, idx) => {
    const stageCard = document.createElement('div');
    stageCard.className = 'stage-card';

    let resourcesHtml = '';
    stage.resources.forEach((res) => {
      const badgeClass = res.type === 'free' ? 'badge-free' : 'badge-paid';
      const label = res.badgeLabel || (res.type === 'free' ? 'Free Resource' : 'Boosts Resume');

      resourcesHtml += `
        <div class="resource-item">
          <div>
            <a href="${res.url}" target="_blank" rel="noopener">${res.name}</a>
          </div>
          <div>
            <span class="${badgeClass}">${label}</span>
          </div>
        </div>
      `;
    });

    stageCard.innerHTML = `
      <div class="stage-head">
        <span class="stage-title">${stage.title || `Stage ${idx + 1}`}</span>
        <button class="btn btn-sm btn-primary" onclick="setGoalAndStartFocus('${roadmapJson.goal} - Stage ${idx + 1}')">🎯 Focus on Stage</button>
      </div>
      <p class="stage-desc">${stage.description || ''}</p>
      <div class="resource-list">
        ${resourcesHtml}
      </div>
    `;

    container.appendChild(stageCard);
  });
}

function setGoalAndStartFocus(goalTag) {
  switchTab('focus');
  document.getElementById('goal-input').value = goalTag;
  startFocusSession();
}

// ------------------------------------------------------------------
// 4. HISTORY DASHBOARD
// ------------------------------------------------------------------

async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    const sessions = await res.json();

    const tbody = document.getElementById('history-table-body');
    if (!sessions || sessions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center">No past focus sessions logged yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = sessions.map(s => `
      <tr>
        <td>#${s.id}</td>
        <td><strong>${s.goal_tag}</strong></td>
        <td>${s.duration_minutes}m</td>
        <td>${s.distraction_count}</td>
        <td>${s.drowsy_count}</td>
        <td><span class="status-badge ${s.status === 'COMPLETED' ? 'badge-active' : 'badge-neutral'}">${s.status}</span></td>
      </tr>
    `).join('');
  } catch (e) {}
}
