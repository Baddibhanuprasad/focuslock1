const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { exec, execFile } = require('child_process');
const multer = require('multer');
const dndManager = require('./dnd_manager');
const windowTracker = require('./window_tracker');
const roadmapGenerator = require('./roadmap_generator');
const db = require('./db');
const jobSearch = require('./job_search');
const speechService = require('./speech_service');
const communicationService = require('./communication_service');
const shortsAccess = require('./shorts_access');
const Diff = require('diff');

const app = express();
const PORT = 3000;
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(__dirname, 'tmp')),
    filename: (_req, file, cb) => {
      const originalExt = path.extname(file.originalname || '').toLowerCase();
      const mime = String(file.mimetype || '').toLowerCase();
      let ext = originalExt;
      if (!ext) {
        if (mime.includes('webm')) ext = '.webm';
        else if (mime.includes('ogg')) ext = '.ogg';
        else if (mime.includes('wav')) ext = '.wav';
        else if (mime.includes('mpeg') || mime.includes('mp3')) ext = '.mp3';
        else if (mime.includes('mp4') || mime.includes('m4a')) ext = '.m4a';
        else ext = '.webm';
      }
      cb(null, `upload_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);
    }
  })
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/tmp', express.static(path.join(__dirname, 'tmp')));
app.use('/assests', express.static(path.join(__dirname, 'assests')));
app.use('/recordings', express.static(path.join(__dirname, 'recordings')));

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

    // Actual time focused (capped at planned duration)
    let elapsedFocusSeconds = 0;
    if (currentSessionState.startTime) {
      const planned = (currentSessionState.durationMinutes || 0) * 60;
      const raw = Math.floor((Date.now() - currentSessionState.startTime) / 1000);
      elapsedFocusSeconds = Math.max(0, Math.min(raw, planned || raw));
    }

    if (activeId) {
      await db.endSession(
        activeId, 
        currentSessionState.distractionEvents.length, 
        currentSessionState.drowsyEvents.length,
        0
      );
      await db.logEvent(activeId, 'SESSION_END', 'Focus session ended');
    }

    const shortsUnlock = await shortsAccess.creditFocusTime(elapsedFocusSeconds);

    const summary = {
      sessionId: activeId,
      durationMinutes: currentSessionState.durationMinutes,
      elapsedFocusSeconds,
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
      shortsAccess: shortsUnlock,
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

// YouTube Caption-Based Entertainment Detection
app.post('/api/youtube/caption-check', async (req, res) => {
  try {
    const { title, captions, url } = req.body;

    if (!currentSessionState.sessionId) {
      return res.json({ isEntertainment: false, reason: 'No active focus session' });
    }

    const videoTitle = (title || '').trim();
    const captionText = (captions || '').trim();
    const combinedText = `${videoTitle} ${captionText}`.toLowerCase();

    if (!videoTitle && !captionText) {
      return res.json({ isEntertainment: false, reason: 'No content to classify' });
    }

    let classification = null;

    // Try Gemini API classification first
    try {
      const settings = await db.getSettings();
      let apiKeys = [];
      if (settings.gemini_api_keys) {
        try { apiKeys = JSON.parse(settings.gemini_api_keys); } catch (e) {}
      }
      apiKeys = (Array.isArray(apiKeys) ? apiKeys : []).map(k => (k || '').trim()).filter(k => k.length > 5);

      if (apiKeys.length > 0) {
        const geminiModels = ['gemini-2.0-flash-lite', 'gemini-flash-latest'];

        for (const apiKey of apiKeys) {
          if (classification) break;
          for (const model of geminiModels) {
            try {
              const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
              const prompt = `You are a content classifier for a student focus app. Based on the YouTube video title and caption text below, classify this video as either "educational" or "entertainment".

Educational = tutorials, lectures, courses, programming, science, math, history, language learning, documentaries, exam prep, skill building, coding, engineering, academic content.
Entertainment = music videos, vlogs, pranks, gaming, memes, reaction videos, comedy, movies, trailers, unboxing, challenges, drama, gossip, sports highlights, ASMR, funny compilations.

Video Title: "${videoTitle}"
Caption Text: "${captionText.substring(0, 500)}"

Respond with ONLY one word: "educational" or "entertainment". Nothing else.`;

              const response = await axios.post(geminiUrl, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 10 }
              }, { timeout: 5000 });

              const aiResult = (response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().toLowerCase();
              if (aiResult.includes('entertainment')) {
                classification = 'entertainment';
              } else if (aiResult.includes('educational')) {
                classification = 'educational';
              }
              if (classification) break;
            } catch (geminiErr) {
              console.warn(`[CaptionCheck] Gemini ${model} error:`, geminiErr.message);
            }
          }
        }
      }
    } catch (apiErr) {
      console.warn('[CaptionCheck] Gemini API fallback:', apiErr.message);
    }

    // Fallback: keyword-based classification
    if (!classification) {
      const entertainmentKeywords = [
        'music video', 'official video', 'official audio', 'lyrics', 'song',
        'vlog', 'prank', 'challenge', 'reaction', 'funny', 'comedy', 'meme',
        'gaming', 'gameplay', 'lets play', 'let\'s play', 'fortnite', 'minecraft',
        'movie', 'trailer', 'teaser', 'unboxing', 'haul', 'asmr',
        'drama', 'gossip', 'roast', 'diss', 'beef', 'fight',
        'highlights', 'best moments', 'compilation', 'try not to laugh',
        'mukbang', 'eating', 'cooking show', 'reality', 'behind the scenes',
        'ft.', 'feat.', 'remix', 'mashup', 'cover song', 'parody',
        'tiktok', 'shorts', 'reels', 'trending', 'viral',
        'subscriber', 'giveaway', 'q&a', 'storytime', 'grwm', 'get ready with me'
      ];
      const educationalKeywords = [
        'tutorial', 'course', 'lecture', 'lesson', 'learn', 'learning',
        'programming', 'coding', 'code', 'python', 'javascript', 'java', 'c++',
        'algorithm', 'data structure', 'machine learning', 'ai ', 'artificial intelligence',
        'math', 'calculus', 'algebra', 'physics', 'chemistry', 'biology',
        'science', 'engineering', 'computer science', 'web development',
        'explanation', 'explained', 'how to', 'guide', 'documentation',
        'exam', 'test prep', 'study', 'revision', 'notes',
        'research', 'paper', 'thesis', 'academic', 'university', 'college',
        'certification', 'certificate', 'skill', 'training',
        'history', 'geography', 'economics', 'psychology',
        'freecodecamp', 'khan academy', 'mit ', 'stanford', 'harvard'
      ];

      let entertainmentScore = 0;
      let educationalScore = 0;

      for (const kw of entertainmentKeywords) {
        if (combinedText.includes(kw)) entertainmentScore++;
      }
      for (const kw of educationalKeywords) {
        if (combinedText.includes(kw)) educationalScore++;
      }

      if (entertainmentScore > educationalScore && entertainmentScore >= 1) {
        classification = 'entertainment';
      } else {
        classification = 'educational';
      }
    }

    // Act on classification result
    if (classification === 'entertainment') {
      currentSessionState.pauseYouTube = true;
      currentSessionState.pauseReason = 'Entertainment video detected';

      const event = {
        timestamp: new Date().toLocaleTimeString(),
        windowTitle: videoTitle || url,
        processName: 'YouTube Caption Monitor'
      };
      event.timeMs = Date.now();
      currentSessionState.distractionEvents.push(event);
      currentSessionState.activeDistraction = {
        title: videoTitle || url,
        process: 'YouTube Entertainment',
        timestamp: event.timestamp
      };

      playSystemAlertSound();
      showWindowsNotification('🚨 Entertainment Detected!', `"${videoTitle}" is not educational. Get back to studying!`);
      await db.logEvent(currentSessionState.sessionId, 'ENTERTAINMENT_VIDEO', `Title: ${videoTitle} | URL: ${url}`);

      console.log(`[CaptionCheck] ENTERTAINMENT detected: "${videoTitle}"`);
      return res.json({ isEntertainment: true, reason: `"${videoTitle}" classified as entertainment content` });
    }

    console.log(`[CaptionCheck] Educational content: "${videoTitle}"`);
    return res.json({ isEntertainment: false, reason: 'Content classified as educational' });
  } catch (err) {
    console.error('[CaptionCheck] Error:', err.message);
    res.status(500).json({ isEntertainment: false, error: err.message });
  }
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
    const education = (settings.profile_education || '').trim();
    const location = (settings.preferred_location || '').trim() || 'India';

    if (!education) {
      return res.status(400).json({
        error: 'Set your education in Settings / Profile first'
      });
    }

    // Cache key versioned: education + location (10 field internships + 10 fresher)
    const queryKey = `g20f:${education.toLowerCase().trim()}|${location.toLowerCase().trim()}`;
    const urls = jobSearch.buildExternalSearchUrls(education, location);
    const fieldLabel = urls.fieldLabel || education;

    // Keep cached results until the user clicks Refresh
    if (!forceRefresh) {
      const cached = await db.findCachedJobs(queryKey, null);
      if (cached && Array.isArray(cached.results) && cached.results.length > 0) {
        console.log(`[JobSearch] Cache hit for '${queryKey}'`);
        const jobs = cached.results;
        return res.json({
          success: true,
          fromCache: true,
          jobs,
          internships: jobs.filter(j => j.kind === 'internship'),
          fresherJobs: jobs.filter(j => j.kind === 'fresher'),
          education,
          location,
          fieldLabel,
          ...urls,
          cachedAt: cached.created_at
        });
      }
    } else {
      await db.clearJobCache(queryKey);
      // Also clear older cache key format
      await db.clearJobCache(`g20:${education.toLowerCase().trim()}|${location.toLowerCase().trim()}`);
    }

    const result = await jobSearch.searchJobs(education, location);
    if (result.error && !(result.jobs && result.jobs.length)) {
      return res.json({
        success: false,
        error: result.error,
        education,
        location,
        fieldLabel: result.fieldLabel || fieldLabel,
        ...urls
      });
    }

    await db.saveJobCache(queryKey, result.jobs || []);

    res.json({
      success: true,
      fromCache: false,
      jobs: result.jobs || [],
      internships: result.internships || [],
      fresherJobs: result.fresherJobs || [],
      education,
      location,
      fieldLabel: result.fieldLabel || fieldLabel,
      ...urls
    });
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
        adzuna_app_key: settings.adzuna_app_key || '',
        fish_audio_api_key: settings.fish_audio_api_key || '',
        fish_audio_voice_id: settings.fish_audio_voice_id || '',
        fish_audio_model: settings.fish_audio_model || 's2.1-pro-free',
        whisper_model_path: settings.whisper_model_path || '',
        whisper_binary_path: settings.whisper_binary_path || '',
        communication_language: settings.communication_language || 'english'
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

app.post('/api/settings/communication', async (req, res) => {
  try {
    const { fish_audio_api_key, fish_audio_voice_id, fish_audio_model, whisper_model_path, whisper_binary_path, communication_language } = req.body || {};
    if (fish_audio_api_key !== undefined) await db.saveSetting('fish_audio_api_key', fish_audio_api_key || '');
    if (fish_audio_voice_id !== undefined) await db.saveSetting('fish_audio_voice_id', fish_audio_voice_id || '');
    if (fish_audio_model !== undefined) await db.saveSetting('fish_audio_model', fish_audio_model || 's2.1-pro-free');
    if (whisper_model_path !== undefined) await db.saveSetting('whisper_model_path', whisper_model_path || '');
    if (whisper_binary_path !== undefined) await db.saveSetting('whisper_binary_path', whisper_binary_path || '');
    if (communication_language !== undefined) await db.saveSetting('communication_language', communication_language || 'english');
    res.json({ success: true, message: 'Communication settings saved successfully' });
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

app.get('/api/social/access', async (req, res) => {
  try {
    const status = await shortsAccess.getStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/social/access/heartbeat', async (req, res) => {
  try {
    const seconds = req.body && req.body.seconds != null ? req.body.seconds : 5;
    const status = await shortsAccess.heartbeat(seconds);
    res.json({ success: true, ...status });
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
    const tag = cleanTopic.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'learning';
    const shortsQuery = `${cleanTopic} shorts educational tutorial`;
    // sp=EgIYAQ%253D%253D filters YouTube results to Shorts
    const shortsSearchUrl =
      `https://www.youtube.com/results?search_query=${encodeURIComponent(shortsQuery)}&sp=EgIYAQ%253D%253D`;

    const curatedData = {
      topic: cleanTopic,
      youtubeEmbedUrl: `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(shortsQuery)}`,
      shortsSearchUrl,
      instagramHashtagUrl: `https://www.instagram.com/explore/tags/${tag}/`,
      instagramSearchUrl: `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(cleanTopic + ' reels')}`,
      curatedCreators: [
        {
          name: `${cleanTopic} Shorts`,
          platform: 'YouTube Shorts',
          url: shortsSearchUrl,
          type: 'free',
          badge: 'Topic Shorts'
        },
        {
          name: `#${tag} Reels`,
          platform: 'Instagram Reels',
          url: `https://www.instagram.com/explore/tags/${tag}/`,
          type: 'free',
          badge: 'Topic Reels'
        }
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
    activeDistraction: currentSessionState.activeDistraction,
    isEntertainmentAlert: currentSessionState.pauseReason === 'Entertainment video detected'
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

// -------------------------------------------------------------
// 7. COMMUNICATION MODE APIS
// -------------------------------------------------------------

async function getGeminiKeysFromSettings() {
  const settings = await db.getSettings();
  let userKeys = [];
  if (settings.gemini_api_keys) {
    try { userKeys = JSON.parse(settings.gemini_api_keys); } catch (e) { userKeys = []; }
  }
  return (Array.isArray(userKeys) ? userKeys : []).map(k => (k || '').trim()).filter(k => k.length > 0);
}

async function getCommunicationSpeechConfig() {
  const settings = await db.getSettings();
  return {
    fishApiKey: (settings.fish_audio_api_key || '').trim(),
    fishVoiceId: (settings.fish_audio_voice_id || '').trim(),
    fishModel: (settings.fish_audio_model || 's2.1-pro-free').trim(),
    whisperModelPath: (settings.whisper_model_path || '').trim(),
    whisperBinaryPath: (settings.whisper_binary_path || '').trim(),
    language: (settings.communication_language || 'english').trim()
  };
}

function toPublicAudioUrl(audioFilePath) {
  if (!audioFilePath) return '';
  return `/tmp/${path.basename(audioFilePath)}`;
}

function toPublicRecordingUrl(recordingPath) {
  if (!recordingPath) return '';
  const rel = path.relative(path.join(__dirname, 'recordings'), recordingPath);
  if (!rel || rel.startsWith('..')) return '';
  return `/recordings/${rel.split(path.sep).join('/')}`;
}

function saveCommunicationRecording(sessionId, sourcePath, kind = 'user') {
  if (!sourcePath || !fs.existsSync(sourcePath)) return '';
  const dir = path.join(__dirname, 'recordings', 'communication', String(sessionId));
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(sourcePath) || '.webm';
  const dest = path.join(dir, `${kind}_${Date.now()}${ext}`);
  fs.copyFileSync(sourcePath, dest);
  try { fs.unlinkSync(sourcePath); } catch (e) {}
  return dest;
}

app.post('/api/communication/start', async (req, res) => {
  try {
    const mode = String(req.body.mode || 'conversation').toLowerCase();
    const speechCfg = await getCommunicationSpeechConfig();
    const geminiKeys = await getGeminiKeysFromSettings();

    if (geminiKeys.length === 0) {
      return res.status(400).json({ error: 'Add at least one Gemini API key in Settings' });
    }

    // Conversation + practice work better with Fish TTS, but practice can still show text without it
    if (mode === 'conversation' && !speechCfg.fishApiKey) {
      return res.status(400).json({ error: 'Add Fish Audio API key in Settings before starting Conversation' });
    }

    const session = await db.createCommunicationSession();

    if (mode === 'practice') {
      const passage = await communicationService.generateReadingPassage(geminiKeys, speechCfg.language);
      if (!passage.success || !passage.text) {
        return res.status(500).json({ error: passage.error || 'Failed to generate reading passage' });
      }

      const intro = await communicationService.generatePracticeIntro(geminiKeys, speechCfg.language);
      const introText = intro.success && intro.text
        ? intro.text
        : 'Please read this passage aloud clearly.';

      let audioUrl = '';
      if (speechCfg.fishApiKey) {
        const tts = await speechService.synthesizeSpeech(
          introText,
          speechCfg.fishApiKey,
          speechCfg.fishVoiceId,
          speechCfg.fishModel
        );
        if (tts.success) audioUrl = toPublicAudioUrl(tts.audioFilePath);
      }

      await db.setReadingPassage(session.sessionId, passage.text);
      await db.appendTurn(session.sessionId, 'assistant', `${introText}`);

      return res.json({
        success: true,
        mode: 'practice',
        sessionId: session.sessionId,
        greetingText: introText,
        passageText: passage.text,
        audioUrl
      });
    }

    if (mode === 'singing') {
      const videoIndex = Number.parseInt(req.body.videoIndex, 10);
      const demo = communicationService.getSingingDemo(Number.isFinite(videoIndex) ? videoIndex : 0);
      await db.setReadingPassage(session.sessionId, demo.title || 'Singing demo');
      await db.appendTurn(session.sessionId, 'assistant', `Sing along: ${demo.title || 'Demo track'}`);

      return res.json({
        success: true,
        mode: 'singing',
        sessionId: session.sessionId,
        greetingText: demo.videos.length
          ? 'Pick a karaoke video, press play, and sing along for this demo.'
          : 'Add karaoke .mp4 files to the assests folder and restart.',
        videoUrl: demo.videoUrl,
        videoIndex: demo.index,
        videos: demo.videos,
        lyrics: demo.lyrics,
        title: demo.title,
        audioUrl: ''
      });
    }

    // Default: conversation
    const greeting = await communicationService.generateGreeting(geminiKeys, speechCfg.language);
    if (!greeting.success || !greeting.text) {
      return res.status(500).json({ error: greeting.error || 'Failed to generate greeting' });
    }

    let audioUrl = '';
    const tts = await speechService.synthesizeSpeech(
      greeting.text,
      speechCfg.fishApiKey,
      speechCfg.fishVoiceId,
      speechCfg.fishModel
    );
    if (tts.success) {
      audioUrl = toPublicAudioUrl(tts.audioFilePath);
    } else {
      console.warn('[Communication] Greeting TTS failed:', tts.error);
    }

    await db.appendTurn(session.sessionId, 'assistant', greeting.text);

    res.json({
      success: true,
      mode: 'conversation',
      sessionId: session.sessionId,
      greetingText: greeting.text,
      audioUrl,
      ttsWarning: tts.success ? null : tts.error
    });
  } catch (err) {
    console.error('Error starting communication session:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/communication/reply', upload.single('audio'), async (req, res) => {
  try {
    const sessionId = parseInt(req.body.sessionId, 10);
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    const speechCfg = await getCommunicationSpeechConfig();
    const session = await db.getCommunicationSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const geminiKeys = await getGeminiKeysFromSettings();
    let userTranscript = String(req.body.transcript || '').trim();
    let asrEngine = 'client';
    let savedRecordingPath = '';

    if (req.file) {
      savedRecordingPath = saveCommunicationRecording(sessionId, req.file.path, 'user');
    }

    // Prefer server transcription from saved audio — more reliable in Electron than browser speech text
    if (savedRecordingPath) {
      const asr = await speechService.transcribeAudio(savedRecordingPath, speechCfg.whisperModelPath, {
        binaryPath: speechCfg.whisperBinaryPath,
        geminiKeys,
        language: speechCfg.language,
        originalName: req.file?.originalname || path.basename(savedRecordingPath),
        mimeType: req.file?.mimetype || '',
        keepSource: true
      });
      if (asr.success && String(asr.transcript || '').trim()) {
        userTranscript = String(asr.transcript).trim();
        asrEngine = asr.engine || 'server';
      } else if (!userTranscript) {
        return res.status(500).json({ error: asr.error || 'Transcription failed' });
      } else {
        asrEngine = 'client-fallback';
      }
    } else if (!userTranscript) {
      return res.status(400).json({ error: 'audio file or transcript required' });
    }

    const userAudioUrl = toPublicRecordingUrl(savedRecordingPath);
    await db.appendTurn(sessionId, 'user', userTranscript, userAudioUrl || null);

    let transcript = [];
    try { transcript = JSON.parse(session.transcript_json || '[]'); } catch (e) { transcript = []; }
    transcript.push({ speaker: 'user', text: userTranscript, timestamp: new Date().toISOString(), audioUrl: userAudioUrl || null });

    const reply = await communicationService.generateReply(
      transcript,
      geminiKeys,
      speechCfg.language,
      false
    );
    if (!reply.success || !reply.replyText) {
      return res.status(500).json({ error: reply.error || 'Failed to generate reply' });
    }

    let audioUrl = '';
    if (speechCfg.fishApiKey) {
      const tts = await speechService.synthesizeSpeech(
        reply.replyText,
        speechCfg.fishApiKey,
        speechCfg.fishVoiceId,
        speechCfg.fishModel
      );
      if (tts.success) {
        audioUrl = toPublicAudioUrl(tts.audioFilePath);
      } else {
        console.warn('[Communication] Reply TTS failed:', tts.error);
      }
    }

    await db.appendTurn(sessionId, 'assistant', reply.replyText);

    res.json({
      success: true,
      userTranscript,
      replyText: reply.replyText,
      audioUrl,
      userAudioUrl,
      shouldMoveToReading: false,
      asrEngine,
      ttsWarning: audioUrl ? null : 'TTS unavailable'
    });
  } catch (err) {
    console.error('Error in communication reply:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/communication/start-reading', async (req, res) => {
  try {
    const sessionId = parseInt(req.body.sessionId, 10);
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    const speechCfg = await getCommunicationSpeechConfig();
    const geminiKeys = await getGeminiKeysFromSettings();
    const passage = await communicationService.generateReadingPassage(geminiKeys, speechCfg.language);
    if (!passage.success || !passage.text) {
      return res.status(500).json({ error: passage.error || 'Failed to generate reading passage' });
    }

    const intro = await communicationService.generatePracticeIntro(geminiKeys, speechCfg.language);
    const transitionText = intro.success && intro.text
      ? intro.text
      : 'Please read this short passage aloud.';

    let audioUrl = '';
    if (speechCfg.fishApiKey) {
      const tts = await speechService.synthesizeSpeech(
        transitionText,
        speechCfg.fishApiKey,
        speechCfg.fishVoiceId,
        speechCfg.fishModel
      );
      if (tts.success) audioUrl = toPublicAudioUrl(tts.audioFilePath);
    }

    await db.setReadingPassage(sessionId, passage.text);
    await db.appendTurn(sessionId, 'assistant', `${transitionText} Passage: ${passage.text}`);

    res.json({
      success: true,
      passageText: passage.text,
      transitionText,
      audioUrl
    });
  } catch (err) {
    console.error('Error starting reading:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/communication/submit-reading', upload.single('audio'), async (req, res) => {
  try {
    const sessionId = parseInt(req.body.sessionId, 10);
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    const speechCfg = await getCommunicationSpeechConfig();
    const session = await db.getCommunicationSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const expectedPassage = session.reading_passage || req.body.expectedPassage || '';
    if (!expectedPassage) {
      return res.status(400).json({ error: 'No reading passage on session' });
    }

    const geminiKeys = await getGeminiKeysFromSettings();
    let userTranscript = String(req.body.transcript || '').trim();
    let savedRecordingPath = '';

    if (req.file) {
      const kind = String(req.file.originalname || '').includes('singing') ? 'singing' : 'practice';
      savedRecordingPath = saveCommunicationRecording(sessionId, req.file.path, kind);
    }

    if (savedRecordingPath) {
      const asr = await speechService.transcribeAudio(savedRecordingPath, speechCfg.whisperModelPath, {
        binaryPath: speechCfg.whisperBinaryPath,
        geminiKeys,
        language: speechCfg.language,
        originalName: req.file?.originalname || path.basename(savedRecordingPath),
        mimeType: req.file?.mimetype || '',
        keepSource: true
      });
      if (asr.success && String(asr.transcript || '').trim()) {
        userTranscript = String(asr.transcript).trim();
      } else if (!userTranscript) {
        return res.status(500).json({ error: asr.error || 'Transcription failed' });
      }
    } else if (!userTranscript) {
      return res.status(400).json({ error: 'audio file or transcript required' });
    } else if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }

    const diffResult = communicationService.computeReadingDiff(expectedPassage, userTranscript);
    const tipsResult = await communicationService.phraseCorrectionTips(diffResult, geminiKeys, speechCfg.language);

    const correctionTips = {
      summary: tipsResult.tips,
      accuracyScore: diffResult.accuracyScore,
      missedWords: diffResult.missedWords,
      wrongWords: diffResult.wrongWords,
      wordResults: diffResult.wordResults
    };

    await db.saveReadingResult(
      sessionId,
      expectedPassage,
      userTranscript,
      diffResult.accuracyScore,
      correctionTips
    );
    await db.appendTurn(sessionId, 'user', `[practice] ${userTranscript}`);
    await db.endCommunicationSession(sessionId);

    res.json({
      success: true,
      accuracyScore: diffResult.accuracyScore,
      correctionTips: tipsResult.tips,
      wordResults: diffResult.wordResults,
      expectedPassage,
      userTranscript,
      missedWords: diffResult.missedWords,
      wrongWords: diffResult.wrongWords
    });
  } catch (err) {
    console.error('Error submitting reading:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/communication/history', async (req, res) => {
  try {
    const history = await db.getCommunicationHistory();
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(` Focus Mode v1 Server running on http://localhost:${PORT}`);
  console.log(`===================================================`);
}).on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.warn(`[Server] Port ${PORT} already in use — reusing existing Focus Mode server (safe for Electron relaunch).`);
    return;
  }
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
