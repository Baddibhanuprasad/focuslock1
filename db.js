const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'focus_mode.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    INSERT OR IGNORE INTO users (id, name, email) 
    VALUES (1, 'Focus User', 'user@gmail.com')
  `);

  // Focus sessions table
  db.run(`
    CREATE TABLE IF NOT EXISTS focus_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT 1,
      duration_minutes INTEGER,
      goal_tag TEXT,
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_time DATETIME,
      status TEXT DEFAULT 'ACTIVE',
      distraction_count INTEGER DEFAULT 0,
      drowsy_count INTEGER DEFAULT 0,
      absence_count INTEGER DEFAULT 0
    )
  `);

  // Session events log table
  db.run(`
    CREATE TABLE IF NOT EXISTS session_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      event_type TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      details TEXT,
      FOREIGN KEY(session_id) REFERENCES focus_sessions(id)
    )
  `);

  // Roadmaps table
  db.run(`
    CREATE TABLE IF NOT EXISTS roadmaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT 1,
      goal TEXT,
      roadmap_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Roadmap completion proofs table
  db.run(`
    CREATE TABLE IF NOT EXISTS roadmap_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roadmap_id INTEGER,
      stage_index INTEGER,
      stage_title TEXT,
      resource_name TEXT,
      proof_text TEXT,
      proof_file_path TEXT,
      completed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(roadmap_id) REFERENCES roadmaps(id)
    )
  `);

  // Settings table for persistent settings
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key_name TEXT PRIMARY KEY,
      key_value TEXT
    )
  `);

  // Default Settings
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('profile_completed', 'false')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('profile_name', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('profile_education', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('profile_future_goal', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('profile_gmail_1', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('profile_gmail_2', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('profile_gmail_3', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('educational_focus_topic', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('active_theme', 'slate')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('gemini_api_keys', '["AQ.Ab8RN6KXhQLRqnMzs_5JI9OkKrmFTiVX9NMlGTS4REgnoCHxSA"]')`);

  // Communication sessions table
  db.run(`
    CREATE TABLE IF NOT EXISTS communication_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      transcript_json TEXT DEFAULT '[]',
      reading_passage TEXT,
      reading_transcript TEXT,
      accuracy_score REAL,
      correction_tips_json TEXT
    )
  `);

  // Migrate older communication_sessions schemas (CREATE IF NOT EXISTS won't add columns)
  db.all(`PRAGMA table_info(communication_sessions)`, (err, columns) => {
    if (err || !columns) return;
    const names = new Set(columns.map(c => c.name));
    const alterIfMissing = (col, ddl) => {
      if (!names.has(col)) {
        db.run(`ALTER TABLE communication_sessions ADD COLUMN ${ddl}`, (alterErr) => {
          if (alterErr) console.warn(`[DB] migrate ${col}:`, alterErr.message);
          else console.log(`[DB] Added communication_sessions.${col}`);
        });
      }
    };
    alterIfMissing('transcript_json', `transcript_json TEXT DEFAULT '[]'`);
    alterIfMissing('reading_passage', 'reading_passage TEXT');
    alterIfMissing('reading_transcript', 'reading_transcript TEXT');
    alterIfMissing('accuracy_score', 'accuracy_score REAL');
    alterIfMissing('correction_tips_json', 'correction_tips_json TEXT');
  });

  // Default settings for Communication Mode (keys stay empty — configure via Settings UI)
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('fish_audio_api_key', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('fish_audio_voice_id', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('fish_audio_model', 's2.1-pro-free')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('whisper_model_path', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('whisper_binary_path', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('communication_language', 'english')`);

  // Job search cache table
  db.run(`
    CREATE TABLE IF NOT EXISTS job_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_key TEXT UNIQUE,
      results_json TEXT,
      api_calls_used INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Default settings for Adzuna job search
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('preferred_location', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('adzuna_app_id', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('adzuna_app_key', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('adzuna_calls_used_this_month', '0')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('adzuna_quota_reset_date', '')`);

  // Curated Shorts daily access limits
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('shorts_day_key', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('shorts_daily_used_seconds', '0')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('shorts_locked', 'false')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('shorts_bonus_seconds', '0')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('shorts_focus_credit_seconds', '0')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('shorts_warned_json', '[]')`);

  // User Scores table (daily, weekly, monthly scoring)
  db.run(`
    CREATE TABLE IF NOT EXISTS user_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT 1,
      score_type TEXT,
      score_value REAL,
      score_date DATE,
      total_focus_minutes INTEGER DEFAULT 0,
      focus_mode_count INTEGER DEFAULT 0,
      roadmap_mode_count INTEGER DEFAULT 0,
      communication_mode_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, score_type, score_date)
    )
  `);
});

const DBManager = {
  createSession: (durationMinutes, goalTag) => {
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO focus_sessions (duration_minutes, goal_tag, status) VALUES (?, ?, 'ACTIVE')`;
      db.run(sql, [durationMinutes, goalTag || 'General Focus'], function(err) {
        if (err) return reject(err);
        resolve({ sessionId: this.lastID, durationMinutes, goalTag });
      });
    });
  },

  endSession: (sessionId, distractionCount = 0, drowsyCount = 0, absenceCount = 0) => {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE focus_sessions 
        SET status = 'COMPLETED', 
            end_time = CURRENT_TIMESTAMP, 
            distraction_count = ?, 
            drowsy_count = ?,
            absence_count = ?
        WHERE id = ?
      `;
      db.run(sql, [distractionCount, drowsyCount, absenceCount, sessionId], function(err) {
        if (err) return reject(err);
        resolve({ success: true, sessionId });
      });
    });
  },

  getActiveSession: () => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM focus_sessions WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1`;
      db.get(sql, [], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  },

  logEvent: (sessionId, eventType, details = '') => {
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO session_events (session_id, event_type, details) VALUES (?, ?, ?)`;
      db.run(sql, [sessionId, eventType, details], function(err) {
        if (err) return reject(err);
        
        if (sessionId) {
          if (eventType === 'DISTRACTION') {
            db.run(`UPDATE focus_sessions SET distraction_count = distraction_count + 1 WHERE id = ?`, [sessionId]);
          } else if (eventType === 'DROWSY') {
            db.run(`UPDATE focus_sessions SET drowsy_count = drowsy_count + 1 WHERE id = ?`, [sessionId]);
          } else if (eventType === 'ABSENT') {
            db.run(`UPDATE focus_sessions SET absence_count = absence_count + 1 WHERE id = ?`, [sessionId]);
          }
        }

        resolve({ success: true, eventId: this.lastID });
      });
    });
  },

  getSessionHistory: () => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM focus_sessions ORDER BY id DESC LIMIT 20`;
      db.all(sql, [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  },

  createCommunicationSession: () => {
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO communication_sessions (transcript_json) VALUES ('[]')`;
      db.run(sql, [], function(err) {
        if (err) return reject(err);
        resolve({ sessionId: this.lastID });
      });
    });
  },

  appendTurn: (sessionId, speaker, text, audioUrl = null) => {
    return new Promise((resolve, reject) => {
      const getSql = `SELECT transcript_json FROM communication_sessions WHERE id = ?`;
      db.get(getSql, [sessionId], (err, row) => {
        if (err || !row) return reject(err || new Error('Communication session not found'));
        let transcript = [];
        try {
          transcript = JSON.parse(row.transcript_json || '[]');
        } catch (e) {
          transcript = [];
        }

        const turn = { speaker, text, timestamp: new Date().toISOString() };
        if (audioUrl) turn.audioUrl = audioUrl;
        transcript.push(turn);
        const updateSql = `UPDATE communication_sessions SET transcript_json = ? WHERE id = ?`;
        db.run(updateSql, [JSON.stringify(transcript), sessionId], function(updateErr) {
          if (updateErr) return reject(updateErr);
          resolve({ success: true, transcript });
        });
      });
    });
  },

  saveReadingResult: (sessionId, readingPassage, readingTranscript, accuracyScore, correctionTips) => {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE communication_sessions SET reading_passage = ?, reading_transcript = ?, accuracy_score = ?, correction_tips_json = ? WHERE id = ?`;
      db.run(sql, [readingPassage || '', readingTranscript || '', accuracyScore == null ? null : accuracyScore, JSON.stringify(correctionTips || {}), sessionId], function(err) {
        if (err) return reject(err);
        resolve({ success: true });
      });
    });
  },

  setReadingPassage: (sessionId, readingPassage) => {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE communication_sessions SET reading_passage = ? WHERE id = ?`;
      db.run(sql, [readingPassage || '', sessionId], function(err) {
        if (err) return reject(err);
        resolve({ success: true });
      });
    });
  },

  endCommunicationSession: (sessionId) => {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE communication_sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = ?`;
      db.run(sql, [sessionId], function(err) {
        if (err) return reject(err);
        resolve({ success: true, sessionId });
      });
    });
  },

  getCommunicationHistory: () => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM communication_sessions ORDER BY id DESC LIMIT 20`;
      db.all(sql, [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  },

  getCommunicationSession: (sessionId) => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM communication_sessions WHERE id = ?`;
      db.get(sql, [sessionId], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  },

  findSavedRoadmap: (goalText) => {
    return new Promise((resolve, reject) => {
      const cleanGoal = `%${goalText.trim().toLowerCase()}%`;
      const sql = `SELECT * FROM roadmaps WHERE LOWER(goal) LIKE ? ORDER BY id DESC LIMIT 1`;
      db.get(sql, [cleanGoal], (err, row) => {
        if (err || !row) return resolve(null);
        try {
          resolve({
            id: row.id,
            goal: row.goal,
            created_at: row.created_at,
            roadmap: JSON.parse(row.roadmap_json)
          });
        } catch (e) {
          resolve(null);
        }
      });
    });
  },

  saveRoadmap: (goal, roadmapJson) => {
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO roadmaps (goal, roadmap_json) VALUES (?, ?)`;
      db.run(sql, [goal, JSON.stringify(roadmapJson)], function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, goal, roadmap: roadmapJson });
      });
    });
  },

  getSavedRoadmaps: () => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM roadmaps ORDER BY id DESC LIMIT 20`;
      db.all(sql, [], (err, rows) => {
        if (err) return reject(err);
        const parsed = rows.map(r => ({
          id: r.id,
          goal: r.goal,
          created_at: r.created_at,
          roadmap: JSON.parse(r.roadmap_json)
        }));
        resolve(parsed);
      });
    });
  },

  getRoadmapCompletions: (roadmapId) => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM roadmap_completions WHERE roadmap_id = ? ORDER BY created_at DESC`;
      db.all(sql, [roadmapId], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  },

  saveRoadmapCompletion: (roadmapId, stageIndex, stageTitle, resourceName, proofText, proofFilePath, completed) => {
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO roadmap_completions (roadmap_id, stage_index, stage_title, resource_name, proof_text, proof_file_path, completed) VALUES (?, ?, ?, ?, ?, ?, ?)`;
      db.run(sql, [roadmapId, stageIndex, stageTitle, resourceName, proofText || '', proofFilePath || '', completed ? 1 : 0], function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, roadmapId, stageIndex, stageTitle, resourceName, proofText, proofFilePath, completed });
      });
    });
  },

  // SETTINGS DB HELPERS
  saveSetting: (keyName, keyValue) => {
    return new Promise((resolve, reject) => {
      const sql = `INSERT OR REPLACE INTO settings (key_name, key_value) VALUES (?, ?)`;
      db.run(sql, [keyName, keyValue], (err) => {
        if (err) return reject(err);
        resolve({ success: true });
      });
    });
  },

  getSettings: () => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM settings`, [], (err, rows) => {
        if (err) return reject(err);
        const settings = {};
        (rows || []).forEach(r => {
          settings[r.key_name] = r.key_value;
        });
        resolve(settings);
      });
    });
  }
  ,

  // JOB CACHE HELPERS — results stay until user explicitly refreshes
  findCachedJobs: (queryKey, maxAgeHours = null) => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM job_cache WHERE query_key = ? ORDER BY id DESC LIMIT 1`;
      db.get(sql, [queryKey], (err, row) => {
        if (err || !row) return resolve(null);
        try {
          // null / Infinity = keep forever until force refresh
          if (maxAgeHours != null && Number.isFinite(maxAgeHours)) {
            const created = new Date(row.created_at);
            const ageMs = Date.now() - created.getTime();
            const maxAgeMs = maxAgeHours * 3600 * 1000;
            if (ageMs > maxAgeMs) return resolve(null);
          }
          resolve({
            id: row.id,
            query_key: row.query_key,
            created_at: row.created_at,
            api_calls_used: row.api_calls_used,
            results: JSON.parse(row.results_json)
          });
        } catch (e) {
          resolve(null);
        }
      });
    });
  },

  saveJobCache: (queryKey, resultsJson) => {
    return new Promise((resolve, reject) => {
      const sql = `INSERT OR REPLACE INTO job_cache (query_key, results_json, api_calls_used, created_at) VALUES (?, ?, 1, CURRENT_TIMESTAMP)`;
      db.run(sql, [queryKey, JSON.stringify(resultsJson)], function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, queryKey, results: resultsJson });
      });
    });
  },

  clearJobCache: (queryKey) => {
    return new Promise((resolve, reject) => {
      if (!queryKey) {
        db.run(`DELETE FROM job_cache`, [], function(err) {
          if (err) return reject(err);
          resolve({ cleared: this.changes });
        });
        return;
      }
      db.run(`DELETE FROM job_cache WHERE query_key = ?`, [queryKey], function(err) {
        if (err) return reject(err);
        resolve({ cleared: this.changes });
      });
    });
  },

  incrementAdzunaCallCount: async () => {
    const settings = await DBManager.getSettings();
    let count = parseInt(settings.adzuna_calls_used_this_month || '0', 10) || 0;
    count = count + 1;
    return DBManager.saveSetting('adzuna_calls_used_this_month', String(count));
  },

  getAdzunaCallCount: async () => {
    const settings = await DBManager.getSettings();
    const count = parseInt(settings.adzuna_calls_used_this_month || '0', 10) || 0;
    return count;
  },

  resetAdzunaCallCountIfNewMonth: async () => {
    const settings = await DBManager.getSettings();
    const storedReset = settings.adzuna_quota_reset_date || '';
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const isoFirst = firstOfMonth.toISOString().slice(0,10); // YYYY-MM-DD

    if (!storedReset || storedReset !== isoFirst) {
      await DBManager.saveSetting('adzuna_calls_used_this_month', '0');
      await DBManager.saveSetting('adzuna_quota_reset_date', isoFirst);
    }
    return true;
  },

  // SCORING SYSTEM - Daily, Weekly, Monthly scores based on usage
  calculateAndSaveScore: (scoreType, scoreDate, totalFocusMinutes, modeUsage = {}, roadmapCreditCount = 0) => {
    return new Promise((resolve, reject) => {
      // scoreType: 'daily', 'weekly', 'monthly'
      // scoreDate: YYYY-MM-DD for daily, YYYY-Www for weekly (W01-W53), YYYY-MM for monthly
      // modeUsage: { focus: count, roadmap: count, communication: count }
      // roadmapCreditCount: additional roadmap completion credits to boost score

      const getSql = `SELECT * FROM user_scores WHERE user_id = 1 AND score_type = ? AND score_date = ?`;
      db.get(getSql, [scoreType, scoreDate], (err, existing) => {
        if (err) return reject(err);

        const previousFocus = existing ? Number(existing.total_focus_minutes || 0) : 0;
        const previousRoadmap = existing ? Number(existing.roadmap_mode_count || 0) : 0;
        const previousFocusCount = existing ? Number(existing.focus_mode_count || 0) : 0;
        const previousCommCount = existing ? Number(existing.communication_mode_count || 0) : 0;

        const newTotalFocus = previousFocus + Number(totalFocusMinutes || 0);
        const newFocusCount = previousFocusCount + (modeUsage.focus || 0);
        const newRoadmapCount = previousRoadmap + (modeUsage.roadmap || 0);
        const newCommCount = previousCommCount + (modeUsage.communication || 0);

        let scoreValue = 0;
        if (scoreType === 'daily') {
          scoreValue = Math.min(10, (newTotalFocus / 150) * 10);
          scoreValue = Math.min(10, scoreValue + (roadmapCreditCount * 0.2));
        } else if (scoreType === 'weekly') {
          scoreValue = Math.min(100, (newTotalFocus / 750) * 100);
          scoreValue = Math.min(100, scoreValue + (roadmapCreditCount * 1));
        } else if (scoreType === 'monthly') {
          scoreValue = Math.min(100, (newTotalFocus / 3000) * 100);
          scoreValue = Math.min(100, scoreValue + (roadmapCreditCount * 2));
        }

        const sql = `
          INSERT INTO user_scores 
          (user_id, score_type, score_value, score_date, total_focus_minutes, focus_mode_count, roadmap_mode_count, communication_mode_count) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, score_type, score_date) 
          DO UPDATE SET 
            score_value = ?,
            total_focus_minutes = ?,
            focus_mode_count = ?,
            roadmap_mode_count = ?,
            communication_mode_count = ?
        `;

        db.run(sql, [
          1, scoreType, scoreValue, scoreDate, newTotalFocus, newFocusCount, newRoadmapCount, newCommCount,
          scoreValue, newTotalFocus, newFocusCount, newRoadmapCount, newCommCount
        ], function(runErr) {
          if (runErr) return reject(runErr);
          resolve({ success: true, scoreValue: Math.round(scoreValue * 100) / 100 });
        });
      });
    });
  },

  getDailyScore: (date) => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM user_scores WHERE user_id = 1 AND score_type = 'daily' AND score_date = ?`;
      db.get(sql, [date], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  },

  getWeeklyScore: (weekKey) => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM user_scores WHERE user_id = 1 AND score_type = 'weekly' AND score_date = ?`;
      db.get(sql, [weekKey], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  },

  getMonthlyScore: (monthKey) => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM user_scores WHERE user_id = 1 AND score_type = 'monthly' AND score_date = ?`;
      db.get(sql, [monthKey], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  },

  getTotalRoadmapCredits: () => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT COUNT(*) AS count FROM roadmap_completions WHERE completed = 1`;
      db.get(sql, [], (err, row) => {
        if (err) return reject(err);
        resolve((row && row.count) ? Number(row.count) : 0);
      });
    });
  },

  getLastSevenDaysScores: () => {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM user_scores 
        WHERE user_id = 1 AND score_type = 'daily'
        ORDER BY score_date DESC 
        LIMIT 7
      `;
      db.all(sql, [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  },

  getLastThreeMonthsScores: () => {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM user_scores 
        WHERE user_id = 1 AND score_type = 'monthly'
        ORDER BY score_date DESC 
        LIMIT 3
      `;
      db.all(sql, [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  },

  // Clear all session history data
  clearSessionHistory: () => {
    return new Promise((resolve, reject) => {
      // Delete all session events
      db.run(`DELETE FROM session_events`, [], function(err1) {
        if (err1) return reject(err1);
        
        // Delete all focus sessions
        db.run(`DELETE FROM focus_sessions`, [], function(err2) {
          if (err2) return reject(err2);
          resolve({ success: true, cleared: this.changes });
        });
      });
    });
  }
};

module.exports = DBManager;
