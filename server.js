const express = require('express');
const path = require('path');
const cors = require('cors');
const { exec } = require('child_process');
const dndManager = require('./dnd_manager');
const windowTracker = require('./window_tracker');
const roadmapGenerator = require('./roadmap_generator');
const db = require('./db');
const jobSearch = require('./job_search');

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
    const { goalText, forceRefresh = false } = req.body;
    if (!goalText) return res.status(400).json({ error: 'Goal text required' });

    // 1. Check SQLite DB Cache first (Save Gemini API Tokens!)
    if (!forceRefresh) {
      const cached = await db.findSavedRoadmap(goalText);
      if (cached && cached.roadmap && cached.roadmap.stages) {
        console.log(`[RoadmapGenerator] Found cached roadmap in SQLite DB for "${goalText}". 0 API tokens consumed!`);
        return res.json({
          success: true,
          fromCache: true,
          roadmapId: cached.id,
          roadmap: cached.roadmap
        });
      }
    }

    // 2. If not found in DB cache, call Gemini AI
    const settings = await db.getSettings();
    let userKeys = ['AQ.Ab8RN6KXhQLRqnMzs_5JI9OkKrmFTiVX9NMlGTS4REgnoCHxSA'];
    if (settings.gemini_api_keys) {
      try { userKeys = JSON.parse(settings.gemini_api_keys); } catch(e) {}
    }

    const roadmap = await roadmapGenerator.generateRoadmap(goalText, userKeys);
    const savedRecord = await db.saveRoadmap(goalText, roadmap);

    res.json({
      success: true,
      fromCache: false,
      roadmapId: savedRecord.id,
      roadmap
    });
  } catch (err) {
    console.error('Error generating roadmap:', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 6. JOB SEARCH / JOB NOTIFICATION MODE APIS
// -------------------------------------------------------------

app.get('/api/jobs/search', async (req, res) => {
  try {
    const forceRefresh = req.query.forceRefresh === 'true' || req.query.forceRefresh === true;
    const settings = await db.getSettings();
    const goal = (settings.profile_future_goal || '').trim();
    const location = (settings.preferred_location || '').trim();

    if (!goal || !location) return res.status(400).json({ error: 'Complete your profile first' });

    const queryKey = `${goal.toLowerCase().trim()}|${location.toLowerCase().trim()}`;

    const urls = jobSearch.buildExternalSearchUrls(goal, location);

    if (!forceRefresh) {
      const cached = await db.findCachedJobs(queryKey, 48);
      if (cached && cached.results) {
        console.log(`[JobSearch] Cache hit for '${queryKey}' — 0 Adzuna calls used`);
        return res.json({ success: true, fromCache: true, jobs: cached.results, linkedinUrl: urls.linkedinUrl, naukriUrl: urls.naukriUrl, callsUsed: await db.getAdzunaCallCount() });
      }
    }

    // Ensure monthly counters are correct
    await db.resetAdzunaCallCountIfNewMonth();
    const callsUsed = await db.getAdzunaCallCount();
    if (callsUsed >= 950) {
      return res.json({ success: true, warning: 'Approaching monthly limit, showing LinkedIn/Naukri links only', jobs: [], linkedinUrl: urls.linkedinUrl, naukriUrl: urls.naukriUrl, callsUsed });
    }

    const appId = settings.adzuna_app_id || '';
    const appKey = settings.adzuna_app_key || '';
    if (!appId || !appKey) return res.status(400).json({ error: 'Add Adzuna app_id and app_key in Settings' });

    const result = await jobSearch.searchJobs(goal, location, appId, appKey);
    if (result.error) {
      // Save empty cache with error note? We'll return error info but not throw
      return res.json({ success: false, error: result.error, linkedinUrl: urls.linkedinUrl, naukriUrl: urls.naukriUrl, callsUsed });
    }

    // Save cache and increment call count
    await db.saveJobCache(queryKey, result.jobs || []);
    await db.incrementAdzunaCallCount();

    res.json({ success: true, fromCache: false, jobs: result.jobs || [], linkedinUrl: urls.linkedinUrl, naukriUrl: urls.naukriUrl, callsUsed: await db.getAdzunaCallCount() });
  } catch (err) {
    console.error('Error searching jobs:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/jobkeys', async (req, res) => {
  try {
    const { appId, appKey } = req.body || {};
    await db.saveSetting('adzuna_app_id', appId || '');
    await db.saveSetting('adzuna_app_key', appKey || '');
    res.json({ success: true, message: 'Adzuna keys saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save preferred location independently (used by Jobs inline modal)
app.post('/api/settings/preferred-location', async (req, res) => {
  try {
    const { preferred_location } = req.body || {};
    await db.saveSetting('preferred_location', preferred_location || '');
    res.json({ success: true, message: 'Preferred location saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/jobs/quota', async (req, res) => {
  try {
    const callsUsed = await db.getAdzunaCallCount();
    const settings = await db.getSettings();
    const resetDate = settings.adzuna_quota_reset_date || '';
    res.json({ success: true, callsUsed, callsRemaining: Math.max(0, 1000 - callsUsed), resetDate });
  } catch (err) {
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
// 4. APPLICATION SETTINGS & API KEYS APIS
// -------------------------------------------------------------

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await db.getSettings();
    let apiKeys = ['AQ.Ab8RN6KXhQLRqnMzs_5JI9OkKrmFTiVX9NMlGTS4REgnoCHxSA'];
    
    if (settings.gemini_api_keys) {
      try {
        apiKeys = JSON.parse(settings.gemini_api_keys);
      } catch (e) {}
    }

    res.json({
      success: true,
      settings: {
        profile_completed: settings.profile_completed || 'false',
        profile_name: settings.profile_name || '',
        profile_education: settings.profile_education || '',
        profile_future_goal: settings.profile_future_goal || '',
        preferred_location: settings.preferred_location || '',
        profile_gmail_1: settings.profile_gmail_1 || '',
        profile_gmail_2: settings.profile_gmail_2 || '',
        profile_gmail_3: settings.profile_gmail_3 || '',
        educational_focus_topic: settings.educational_focus_topic || '',
        active_theme: settings.active_theme || 'slate',
        gemini_api_keys: apiKeys,
        adzuna_app_id: settings.adzuna_app_id || '',
        adzuna_app_key: settings.adzuna_app_key || ''
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/profile', async (req, res) => {
  try {
    const { name, education, futureGoal, gmail1, gmail2, gmail3, preferred_location } = req.body;
    await db.saveSetting('profile_name', name || '');
    await db.saveSetting('profile_education', education || '');
    await db.saveSetting('profile_future_goal', futureGoal || '');
    await db.saveSetting('profile_gmail_1', gmail1 || '');
    await db.saveSetting('profile_gmail_2', gmail2 || '');
    await db.saveSetting('profile_gmail_3', gmail3 || '');
    await db.saveSetting('profile_completed', 'true');
    await db.saveSetting('preferred_location', preferred_location || '');

    if (futureGoal) {
      await db.saveSetting('profile_goal', futureGoal);
    }

    res.json({ success: true, message: 'Profile details saved successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/theme', async (req, res) => {
  try {
    const { theme } = req.body;
    await db.saveSetting('active_theme', theme || 'slate');
    res.json({ success: true, message: `Theme '${theme}' saved successfully!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/apikeys', async (req, res) => {
  try {
    const { keys } = req.body; // Array of key strings
    const validKeys = Array.isArray(keys) ? keys.map(k => (k || '').trim()).filter(k => k.length > 0) : [];
    await db.saveSetting('gemini_api_keys', JSON.stringify(validKeys));
    res.json({ success: true, message: `${validKeys.length} Gemini API Keys saved successfully!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 5. EDUCATIONAL SOCIAL MEDIA (SHORTS & REELS) APIS
// -------------------------------------------------------------

app.get('/api/social/topic', async (req, res) => {
  try {
    const settings = await db.getSettings();
    res.json({
      success: true,
      topic: settings.educational_focus_topic || ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/social/topic', async (req, res) => {
  try {
    const { topic } = req.body;
    await db.saveSetting('educational_focus_topic', topic || '');
    res.json({ success: true, message: `Educational focus topic set to "${topic}"` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/social/curated', async (req, res) => {
  try {
    const settings = await db.getSettings();
    const topic = req.query.topic || settings.educational_focus_topic || 'Cybersecurity';
    const cleanTopic = topic.trim();
    const tag = cleanTopic.replace(/\s+/g, '').toLowerCase();

    const curatedData = {
      topic: cleanTopic,
      youtubeEmbedUrl: `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(cleanTopic + ' shorts tutorial coding')}`,
      shortsSearchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanTopic + ' shorts educational')}`,
      instagramHashtagUrl: `https://www.instagram.com/explore/tags/${tag}/`,
      curatedCreators: [
        { name: `freeCodeCamp ${cleanTopic} Shorts`, platform: 'YouTube Shorts', url: `https://www.youtube.com/results?search_query=freecodecamp+${encodeURIComponent(cleanTopic)}+shorts`, type: 'free', badge: 'Educational Creator' },
        { name: `Fireship 100s ${cleanTopic} Shorts`, platform: 'YouTube Shorts', url: `https://www.youtube.com/results?search_query=fireship+${encodeURIComponent(cleanTopic)}+shorts`, type: 'free', badge: 'High Value' },
        { name: `#${tag} Educational Reels`, platform: 'Instagram Reels', url: `https://www.instagram.com/explore/tags/${tag}/`, type: 'free', badge: 'Curated Reels' },
        { name: `#learn${tag} Reels`, platform: 'Instagram Reels', url: `https://www.instagram.com/explore/tags/learn${tag}/`, type: 'free', badge: 'Study Reels' }
      ]
    };

    res.json({ success: true, data: curatedData });
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
