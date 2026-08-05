const axios = require('axios');
const Diff = require('diff');
const fs = require('fs');
const path = require('path');

class CommunicationService {
  constructor() {
    // Lite models only on free tier — avoid full flash models that exhaust quota quickly.
    this.geminiModels = [
      'gemini-2.0-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-1.5-flash-8b'
    ];
    // Soft content target stays short via prompts; hard cap must cover thinking + output.
    this.maxOutputTokens = 384;
    this.maxTurns = 6;
    this.maxExchangesBeforeReading = 999; // reading is a separate mode now

    this.assetsDir = path.join(__dirname, 'assests');
    this.videoExtensions = new Set(['.mp4', '.webm', '.mkv', '.mov', '.m4v']);
  }

  cleanVideoTitle(filename) {
    return String(filename || '')
      .replace(/\.[^.]+$/, '')
      .replace(/\(\d+\)$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  getSingingVideos() {
    try {
      if (!fs.existsSync(this.assetsDir)) return [];
      return fs.readdirSync(this.assetsDir)
        .filter((name) => this.videoExtensions.has(path.extname(name).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
        .map((filename, index) => ({
          index,
          filename,
          title: this.cleanVideoTitle(filename),
          videoUrl: `/assests/${encodeURIComponent(filename)}`
        }));
    } catch (error) {
      console.warn('[Communication] Could not read singing videos:', error.message);
      return [];
    }
  }

  getSingingDemo(videoIndex = 0) {
    const videos = this.getSingingVideos();
    if (videos.length === 0) {
      return {
        index: 0,
        filename: '',
        title: 'Singing Demo',
        videoUrl: '',
        lyrics: 'Add karaoke .mp4 files to the assests folder, then restart the app.',
        videos: []
      };
    }

    const idx = Number.isFinite(videoIndex) ? Math.max(0, Math.min(videos.length - 1, videoIndex)) : 0;
    const selected = videos[idx];
    return {
      ...selected,
      videos,
      lyrics: `Demo track: ${selected.title}\n\nPress play on the video, sing along with the karaoke lyrics on screen, then tap RECORD SINGING when you are ready to capture your voice.`
    };
  }

  extractText(responseData) {
    const parts = responseData?.candidates?.[0]?.content?.parts || [];
    // Skip thought parts if present; join visible text parts
    const texts = parts
      .filter(p => p && typeof p.text === 'string' && !p.thought)
      .map(p => p.text);
    if (texts.length) return texts.join('\n').trim();
    return (parts[0]?.text || '').trim();
  }

  async generateContent(prompt, apiKeys, opts = {}) {
    const keys = (Array.isArray(apiKeys) ? apiKeys : [])
      .map(k => (k || '').trim())
      .filter(k => k.length > 0);

    if (keys.length === 0) {
      return { success: false, text: '', error: 'No Gemini API key available' };
    }

    const wantJson = Boolean(opts.json);
    let lastError = '';

    for (const apiKey of keys) {
      // Skip clearly non-AI-Studio keys (e.g. AQ.* ADC tokens) for this endpoint
      if (apiKey.startsWith('AQ.')) continue;

      for (const model of this.geminiModels) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
          const generationConfig = {
            temperature: opts.temperature != null ? opts.temperature : 0.7,
            maxOutputTokens: this.maxOutputTokens,
            candidateCount: 1
          };
          if (wantJson) {
            generationConfig.responseMimeType = 'application/json';
          }

          const response = await axios.post(url, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig
          }, { timeout: 20000 });

          const finish = response.data?.candidates?.[0]?.finishReason;
          const text = this.extractText(response.data);
          const thoughts = response.data?.usageMetadata?.thoughtsTokenCount || 0;
          console.log(`[Communication] ${model} finish=${finish} thoughts=${thoughts} chars=${text.length}`);

          if (text && text.trim().length > 0) {
            // Reject obviously truncated JSON payloads
            if (wantJson && text.includes('{') && !text.includes('}')) {
              lastError = `Truncated JSON from ${model}`;
              continue;
            }
            return { success: true, text: text.trim(), model, finishReason: finish };
          }
          lastError = `${model} returned empty (finish=${finish})`;
        } catch (error) {
          const code = error.response?.status;
          const message = error.response?.data?.error?.message || error.message;
          lastError = `${model}: ${message}`;
          console.warn(`[Communication] ${lastError}`);
          // On quota/auth for this key, try next model; on hard auth move to next key
          if (code === 401 || code === 403) break;
          if (code === 429 || /quota|rate.?limit|resource.?exhausted/i.test(message)) continue;
        }
      }
    }

    return { success: false, text: '', error: lastError || 'Gemini communication generation failed for all keys' };
  }

  isQuotaError(message) {
    return /quota|rate.?limit|limit:\s*0|resource.?exhausted/i.test(String(message || ''));
  }

  countUserExchanges(transcript) {
    const turns = Array.isArray(transcript) ? transcript : [];
    return turns.filter(t => t.speaker === 'user').length;
  }

  getRecentTurns(transcript, limit = this.maxTurns) {
    const turns = Array.isArray(transcript) ? transcript : [];
    return turns.slice(-Math.min(limit, this.maxTurns));
  }

  buildTurnsPrompt(transcript, language) {
    const recentTurns = this.getRecentTurns(transcript, this.maxTurns);
    const formattedTurns = recentTurns.map(turn => {
      const speaker = turn.speaker === 'user' ? 'User' : 'Assistant';
      return `${speaker}: ${turn.text}`;
    }).join('\n');

    return `You are a friendly conversational partner speaking in ${language || 'English'}. Keep replies casual, warm, and 1-2 sentences max. Answer the user's latest question directly. Use only the turns below.

Conversation (last ${recentTurns.length} turns only):
${formattedTurns || '(no prior turns)'}`;
  }

  parseReplyJson(raw, forceReading) {
    const cleaned = String(raw || '')
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    // Prefer last complete JSON object
    const matches = cleaned.match(/\{[^{}]*\}/g) || cleaned.match(/\{[\s\S]*\}/g);
    if (matches && matches.length) {
      for (let i = matches.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(matches[i]);
          const replyText = String(parsed.replyText || parsed.reply || parsed.text || '').trim();
          if (replyText && !replyText.startsWith('{')) {
            return {
              success: true,
              replyText,
              shouldMoveToReading: Boolean(parsed.shouldMoveToReading) || forceReading
            };
          }
        } catch (e) {}
      }
    }

    // Plain-text fallback (strip accidental JSON wrappers)
    let plain = cleaned
      .replace(/^\{\s*"replyText"\s*:\s*"/i, '')
      .replace(/"\s*,\s*"shouldMoveToReading"[\s\S]*$/i, '')
      .replace(/^["']|["']$/g, '')
      .trim();

    if (plain.startsWith('{') || plain.length < 2) {
      return { success: false, text: '', error: 'Could not parse a usable reply from Gemini' };
    }

    return { success: true, replyText: plain, shouldMoveToReading: forceReading };
  }

  async generateGreeting(apiKeys, language) {
    const prompt = `Say ONE short friendly greeting to start a spoken chat in ${language || 'English'}. Under 14 words. Plain text only.`;
    return this.generateContent(prompt, apiKeys, { temperature: 0.7, json: false });
  }

  async generateReply(transcript, apiKeys, language, shouldForceReading = false) {
    const prompt = `${this.buildTurnsPrompt(transcript, language)}

Reply in 1 short spoken sentence (max 18 words). Plain text only — no JSON, markdown, or quotes.`;

    const result = await this.generateContent(prompt, apiKeys, { temperature: 0.55, json: false });
    if (!result.success) return result;
    const replyText = String(result.text || '')
      .replace(/^["']|["']$/g, '')
      .trim();
    if (!replyText) return { success: false, text: '', error: 'Empty reply' };
    return { success: true, replyText, shouldMoveToReading: false };
  }

  async generateReadingPassage(apiKeys, language) {
    const prompt = `Write a clear reading practice passage in ${language || 'English'} with exactly 4 simple sentences. Use everyday words. Plain text only — no quotes, markdown, or numbering.`;
    const result = await this.generateContent(prompt, apiKeys, { temperature: 0.65, json: false });
    const text = String(result.text || '')
      .replace(/^["']|["']$/g, '')
      .replace(/^```[\s\S]*?\n/, '')
      .replace(/```$/, '')
      .trim();

    if (result.success && text.length >= 40) {
      return { success: true, text, source: 'gemini' };
    }

    console.warn('[Communication] Passage generation weak/empty — using fallback:', result.error || 'short text');
    return { success: true, text: this.pickFallbackPassage(), source: 'fallback' };
  }

  pickFallbackPassage() {
    const passages = [
      'Good morning. Today is a great day to practice speaking clearly. Take a deep breath and read each word carefully. You will improve a little every time you try.',
      'Learning a language takes patience and practice. Speak slowly and focus on clear sounds. Do not worry about small mistakes. Confidence grows when you keep going.',
      'The sun rises in the east and sets in the west. Birds sing in the morning light. People walk to work and school. Every day brings a new chance to learn.',
      'Communication helps us share ideas with others. Listen carefully when someone speaks. Then reply with simple and honest words. Practice makes your voice stronger.'
    ];
    return passages[Math.floor(Math.random() * passages.length)];
  }

  async generatePracticeIntro(apiKeys, language) {
    const prompt = `Say one short line (under 12 words) inviting the learner to read the passage aloud, in ${language || 'English'}. Plain text only.`;
    return this.generateContent(prompt, apiKeys, { temperature: 0.6, json: false });
  }


  computeReadingDiff(expectedPassage, userTranscript) {
    const normalize = (s) => String(s || '')
      .toLowerCase()
      .replace(/[^\w\s']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const expectedWords = normalize(expectedPassage).split(' ').filter(Boolean);
    const actualWords = normalize(userTranscript).split(' ').filter(Boolean);
    const changes = Diff.diffArrays(expectedWords, actualWords);

    const wordResults = [];
    let correct = 0;
    const missed = [];
    const wrong = [];

    for (const part of changes) {
      if (part.added) {
        part.value.forEach((w) => {
          wrong.push(w);
          wordResults.push({ word: w, status: 'wrong' });
        });
      } else if (part.removed) {
        part.value.forEach((w) => {
          missed.push(w);
          wordResults.push({ word: w, status: 'missed' });
        });
      } else {
        part.value.forEach((w) => {
          correct += 1;
          wordResults.push({ word: w, status: 'correct' });
        });
      }
    }

    const total = Math.max(expectedWords.length, 1);
    const accuracyScore = Math.round((correct / total) * 1000) / 10;

    return {
      accuracyScore,
      wordResults,
      correctCount: correct,
      expectedCount: expectedWords.length,
      missedWords: missed,
      wrongWords: wrong,
      expectedWords,
      actualWords
    };
  }

  async phraseCorrectionTips(diffResult, apiKeys, language) {
    const missed = (diffResult.missedWords || []).slice(0, 8).join(', ') || 'none';
    const wrong = (diffResult.wrongWords || []).slice(0, 8).join(', ') || 'none';
    const prompt = `Accuracy ${diffResult.accuracyScore}%. Missed: ${missed}. Extra: ${wrong}.
In ${language || 'English'}, write 2 short coaching tips. Plain text only.`;

    const result = await this.generateContent(prompt, apiKeys, { temperature: 0.5, json: false });
    if (!result.success) {
      return {
        success: true,
        tips: diffResult.accuracyScore >= 90
          ? 'Great job — your reading was very clear. Keep practicing to stay sharp!'
          : `Nice effort (${diffResult.accuracyScore}%). Focus on the missed words and try once more.`,
        tipsSource: 'fallback'
      };
    }
    return { success: true, tips: result.text, tipsSource: 'gemini' };
  }
}

module.exports = new CommunicationService();
