const { exec } = require('child_process');
const path = require('path');
const axios = require('axios');

class WindowTracker {
  constructor() {
    this.distractingKeywords = [
      'youtube', 'shorts', 'youtube.com/shorts', 'music.youtube', 'music',
      'song', 'lyrics', 'music video', 'official video', 'vlog', 'reaction',
      'comedy', 'funny', 'meme', 'challenge', 'trailer', 'remix', 'asmr',
      'instagram', 'insta', 'reels', 'tiktok', 'facebook', 'fb', 'twitter',
      'x.com', 'reddit', 'netflix', 'twitch', 'spotify', 'soundcloud',
      'gaming', 'steam', 'discord', '9gag', 'buzzfeed', 'entertainment', 'game'
    ];

    this.educationalKeywords = [
      'documentation', 'docs', 'coursera', 'edx', 'udemy', 'github', 'gitlab', 
      'stack overflow', 'stackoverflow', 'medium', 'article', 'tutorial', 
      'lecture', 'course', 'learn', 'leetcode', 'paper', 'arxiv', 'wikipedia',
      'vscode', 'visual studio', 'pycharm', 'intellij', 'terminal', 'powershell',
      'focus mode', 'research', 'pdf', 'notion', 'figma', 'canva'
    ];
  }

  // Gets foreground app process name & window title natively on Windows via PowerShell script
  getActiveWindowInfo() {
    return new Promise((resolve) => {
      const psScriptPath = path.join(__dirname, 'get_active_window.ps1');
      const command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`;

      exec(command, (err, stdout) => {
        if (err || !stdout.trim()) {
          return resolve({
            processName: 'Unknown',
            windowTitle: 'Desktop Workspace',
            url: ''
          });
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          resolve({
            processName: parsed.ProcessName || 'Unknown',
            windowTitle: parsed.WindowTitle || 'Desktop Workspace',
            url: parsed.WindowTitle
          });
        } catch (e) {
          resolve({
            processName: 'System',
            windowTitle: stdout.trim() || 'Desktop Workspace',
            url: ''
          });
        }
      });
    });
  }

  // Classifies content into "educational" | "distracting" | "neutral"
  async classifyContent(windowInfo) {
    const title = (windowInfo.windowTitle || '').toLowerCase();
    const proc = (windowInfo.processName || '').toLowerCase();
    const combinedText = `${proc} ${title}`;

    // YouTube watch pages are classified by the video title keywords.
    // This enables entertainment detection without using a browser extension.
    const isYouTubeWatch = title.includes('youtube') && !title.includes('shorts') && !title.includes('music.youtube');
    if (isYouTubeWatch) {
      const normalizedTitle = title
        .replace(/\s*-\s*youtube.*$/i, '')
        .replace(/\s*-\s*google chrome$/i, '')
        .replace(/\s*-\s*microsoft edge$/i, '')
        .trim();

      let entertainmentScore = 0;
      let educationalScore = 0;

      const entertainmentKeywords = [
        'music', 'song', 'lyrics', 'official video', 'vlog', 'reaction',
        'comedy', 'funny', 'meme', 'challenge', 'trailer', 'remix', 'asmr',
        'gaming', 'highlights', 'compilation', 'prank', 'drama', 'storytime',
        'dance', 'cover', 'pv', 'mv', 'sing', 'rap', 'movie'
      ];

      for (const kw of entertainmentKeywords) {
        if (normalizedTitle.includes(kw)) entertainmentScore++;
      }
      for (const kw of this.educationalKeywords) {
        if (normalizedTitle.includes(kw)) educationalScore++;
      }

      if (entertainmentScore > educationalScore && entertainmentScore > 0) {
        return 'distracting';
      }
      if (educationalScore > entertainmentScore && educationalScore > 0) {
        return 'educational';
      }
      return 'neutral';
    }

    for (const kw of this.distractingKeywords) {
      if (title.includes(kw) || proc.includes(kw)) {
        return 'distracting';
      }
    }

    // Try Ollama local LLM if available
    try {
      const prompt = `Classify this active desktop window title into EXACTLY one category: "educational", "distracting", or "neutral".
Title: "${combinedText}"
Respond with ONLY one word in lowercase.`;

      const response = await axios.post('http://localhost:11434/api/generate', {
        model: 'llama3.1:8b',
        prompt: prompt,
        stream: false
      }, { timeout: 1000 });

      const category = (response.data?.response || '').trim().toLowerCase();
      if (['educational', 'distracting', 'neutral'].includes(category)) {
        return category;
      }
    } catch (err) {}

    for (const kw of this.educationalKeywords) {
      if (title.includes(kw) || proc.includes(kw)) {
        return 'educational';
      }
    }

    return 'neutral';
  }
}

module.exports = new WindowTracker();
