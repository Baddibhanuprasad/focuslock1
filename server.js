const express = require('express');
const path = require('path');
const cors = require('cors');
const { exec } = require('child_process');
const dndManager = require('./dnd_manager');
const windowTracker = require('./window_tracker');
const roadmapGenerator = require('./roadmap_generator');
const db = require('./db');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global state for live monitoring & Chrome Extension signal
let currentSessionState = {
  sessionId: null,
  startTime: null,
  durationMinutes: 0,
  goalTag: 'General Focus',
  isPaused: false,
  isUserPresent: true,
  isDrowsy: false,
  pauseYouTube: false,
  pauseReason: '',
  activeDistraction: null,
  distractionEvents: [],
  drowsyEvents: []
};

// Play native Windows system alert sound via PowerShell
function playSystemAlertSound() {
  const psCmd = `powershell -NoProfile -Command "[System.Media.SystemSounds]::Exclamation.Play(); Start-Sleep -Milliseconds 200; [System.Media.SystemSounds]::Beep.Play()"`;
  exec(psCmd, (err) => {
    if (err) console.warn('[Sound] OS sound error:', err.message);
  });
}

// Show native Windows taskbar notification balloon
function showWindowsNotification(title, message) {
  const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(__dirname, 'notify.ps1')}" -Title "${title.replace(/"/g, '')}" -Message "${message.replace(/"/g, '')}"`;
  exec(psCmd, (err) => {
    if (err) console.warn('[Notification] OS notification error:', err.message);
  });
}

// -------------------------------------------------------------
// 1. FOCUS MODE (DESKTOP) APIS
// -------------------------------------------------------------

app.post('/api/focus/start', async (req, res) => {
  try {
    const { durationMinutes = 25, goalTag = 'Learning Goal' } = req.body;
    
    await dndManager.muteNotifications();
    const session = await db.createSession(durationMinutes, goalTag);
    
    currentSessionState = {
      sessionId: session.sessionId,
      startTime: Date.now(),
      durationMinutes,
      goalTag,
      isPaused: false,
      isUserPresent: true,
      isDrowsy: false,
      pauseYouTube: false,
      pauseReason: '',
      activeDistraction: null,
      distractionEvents: [],
      drowsyEvents: []
    };

    await db.logEvent(session.sessionId, 'SESSION_START', `Started ${durationMinutes}m focus session: ${goalTag}`);

    res.json({
      success: true,
      message: `Focus session started for ${durationMinutes} minutes.`,
      session: currentSessionState,
      dnd: dndManager.getStatus()
    });
  } catch (err) {
    console.error('Error starting focus session:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/focus/end', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const activeId = sessionId || currentSessionState.sessionId;

    await dndManager.restoreNotifications();

    if (activeId) {
      await db.endSession(
        activeId, 
        currentSessionState.distractionEvents.length, 
        currentSessionState.drowsyEvents.length,
        0
      );
      await db.logEvent(activeId, 'SESSION_END', 'Focus session ended');
    }

    const summary = {
      sessionId: activeId,
      durationMinutes: currentSessionState.durationMinutes,
      distractionCount: currentSessionState.distractionEvents.length,
      drowsyCount: currentSessionState.drowsyEvents.length,
      goalTag: currentSessionState.goalTag
    };

    currentSessionState.sessionId = null;
    currentSessionState.pauseYouTube = false;
    currentSessionState.activeDistraction = null;

    res.json({
      success: true,
      message: 'Focus session completed!',
      summary,
      dnd: dndManager.getStatus()
    });
  } catch (err) {
    console.error('Error ending focus session:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/focus/status', (req, res) => {
  let timeRemaining = 0;
  if (currentSessionState.sessionId && currentSessionState.startTime) {
    const elapsedSeconds = Math.floor((Date.now() - currentSessionState.startTime) / 1000);
    const totalSeconds = currentSessionState.durationMinutes * 60;
    timeRemaining = Math.max(0, totalSeconds - elapsedSeconds);
  }

  res.json({
    sessionId: currentSessionState.sessionId,
    goalTag: currentSessionState.goalTag,
    timeRemaining,
    durationMinutes: currentSessionState.durationMinutes,
    isPaused: currentSessionState.isPaused,
    isUserPresent: currentSessionState.isUserPresent,
    isDrowsy: currentSessionState.isDrowsy,
    pauseYouTube: currentSessionState.pauseYouTube,
    pauseReason: currentSessionState.pauseReason,
    activeDistraction: currentSessionState.activeDistraction,
    isDNDMuted: dndManager.getStatus().isMuted,
    distractionEvents: currentSessionState.distractionEvents,
    drowsyEvents: currentSessionState.drowsyEvents
  });
});

app.post('/api/focus/presence', async (req, res) => {
  const { isUserPresent, isDrowsy } = req.body;
  
  currentSessionState.isUserPresent = isUserPresent;
  currentSessionState.isDrowsy = isDrowsy;

  if (currentSessionState.sessionId) {
    if (!isUserPresent) {
      currentSessionState.pauseYouTube = true;
      currentSessionState.pauseReason = 'User away from desk';
      await db.logEvent(currentSessionState.sessionId, 'ABSENT', 'User stepped away');
    } else if (isDrowsy) {
      currentSessionState.pauseYouTube = true;
      currentSessionState.pauseReason = 'Drowsiness detected';
      playSystemAlertSound();
      await db.logEvent(currentSessionState.sessionId, 'DROWSY', 'Drowsiness detected');
    } else {
      if (!currentSessionState.activeDistraction) {
        currentSessionState.pauseYouTube = false;
        currentSessionState.pauseReason = '';
      }
    }
  } else {
    currentSessionState.pauseYouTube = false;
  }

  res.json({ success: true, pauseYouTube: currentSessionState.pauseYouTube });
});

// -------------------------------------------------------------
// 2. SCREEN & WEBCAM MONITORING APIS
// -------------------------------------------------------------

app.get('/api/window/active', async (req, res) => {
  try {
    const windowInfo = await windowTracker.getActiveWindowInfo();
    const category = await windowTracker.classifyContent(windowInfo);

    if (currentSessionState.sessionId && category === 'distracting') {
      const event = {
        timestamp: new Date().toLocaleTimeString(),
        windowTitle: windowInfo.windowTitle,
        processName: windowInfo.processName
      };
      
      const lastEvent = currentSessionState.distractionEvents[currentSessionState.distractionEvents.length - 1];
      if (!lastEvent || (Date.now() - (lastEvent.timeMs || 0)) > 4000) {
        event.timeMs = Date.now();
        currentSessionState.distractionEvents.push(event);
        currentSessionState.activeDistraction = {
          title: windowInfo.windowTitle,
          process: windowInfo.processName,
          timestamp: event.timestamp
        };
        currentSessionState.pauseYouTube = true;
        currentSessionState.pauseReason = `Distraction (${windowInfo.windowTitle})`;
        
        playSystemAlertSound();
        showWindowsNotification("Focus Mode Alert 🚨", `Distraction Detected: ${windowInfo.windowTitle}`);
        await db.logEvent(currentSessionState.sessionId, 'DISTRACTION', `${windowInfo.processName}: ${windowInfo.windowTitle}`);
      }
    } else {
      currentSessionState.activeDistraction = null;
    }

    res.json({
      processName: windowInfo.processName,
      windowTitle: windowInfo.windowTitle,
      category
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Direct distraction report endpoint from Chrome Extension
app.post('/api/distraction/report', async (req, res) => {
  const { url, title } = req.body;
  
  if (currentSessionState.sessionId) {
    const event = {
      timestamp: new Date().toLocaleTimeString(),
      windowTitle: title || url,
      processName: 'Chrome/Edge Tab'
    };

    const lastEvent = currentSessionState.distractionEvents[currentSessionState.distractionEvents.length - 1];
    if (!lastEvent || (Date.now() - (lastEvent.timeMs || 0)) > 3000) {
      event.timeMs = Date.now();
      currentSessionState.distractionEvents.push(event);
      currentSessionState.activeDistraction = {
        title: title || url,
        process: 'Browser Extension Shield',
        timestamp: event.timestamp
      };
      currentSessionState.pauseYouTube = true;
      currentSessionState.pauseReason = `Distracting Site (${url})`;

      playSystemAlertSound();
      showWindowsNotification("Focus Mode Shield 🚨", `Distracting site opened: ${title || url}`);
      await db.logEvent(currentSessionState.sessionId, 'DISTRACTION', `Tab URL: ${url}`);
    }
  }

  res.json({ success: true, pauseYouTube: currentSessionState.pauseYouTube });
});

app.post('/api/events/log', async (req, res) => {
  const { type, details } = req.body;
  if (currentSessionState.sessionId) {
    if (type === 'DROWSY') {
      currentSessionState.drowsyEvents.push({ timestamp: new Date().toLocaleTimeString(), details });
    }
    await db.logEvent(currentSessionState.sessionId, type, details);
  }
  res.json({ success: true });
});

// -------------------------------------------------------------
// 3. SKILL ROADMAP GENERATOR APIS
// -------------------------------------------------------------

app.post('/api/roadmap/generate', async (req, res) => {
  try {
    const { goalText } = req.body;
    if (!goalText) return res.status(400).json({ error: 'Goal text required' });

    const roadmap = await roadmapGenerator.generateRoadmap(goalText);
    const savedRecord = await db.saveRoadmap(goalText, roadmap);

    res.json({
      success: true,
      roadmapId: savedRecord.id,
      roadmap
    });
  } catch (err) {
    console.error('Error generating roadmap:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/roadmap/history', async (req, res) => {
  try {
    const roadmaps = await db.getSavedRoadmaps();
    res.json(roadmaps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 4. CHROME EXTENSION SIGNAL API
// -------------------------------------------------------------

app.get('/api/extension/signal', (req, res) => {
  res.json({
    pauseYouTube: currentSessionState.pauseYouTube,
    reason: currentSessionState.pauseReason,
    isFocusSessionActive: Boolean(currentSessionState.sessionId),
    isUserPresent: currentSessionState.isUserPresent,
    isDrowsy: currentSessionState.isDrowsy,
    activeDistraction: currentSessionState.activeDistraction
  });
});

app.get('/api/history', async (req, res) => {
  try {
    const history = await db.getSessionHistory();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(` Focus Mode v1 Server running on http://localhost:${PORT}`);
  console.log(`===================================================`);
});
