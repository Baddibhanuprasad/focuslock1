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

  // Settings table for persistent settings
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key_name TEXT PRIMARY KEY,
      key_value TEXT
    )
  `);

  // Default Settings
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('profile_name', 'Focus User')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('profile_email', 'user@gmail.com')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('profile_goal', 'Learn Web Development & AI Security')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('educational_focus_topic', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('active_theme', 'slate')`);
  db.run(`INSERT OR IGNORE INTO settings (key_name, key_value) VALUES ('gemini_api_keys', '["AQ.Ab8RN6KXhQLRqnMzs_5JI9OkKrmFTiVX9NMlGTS4REgnoCHxSA"]')`);
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
};

module.exports = DBManager;
