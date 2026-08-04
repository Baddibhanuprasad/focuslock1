const axios = require('axios');
const Diff = require('diff');

class CommunicationService {
  constructor() {
    // Prefer models that work with current free-tier keys.
    // Note: flash-latest uses "thinking" tokens — maxOutputTokens must leave room (~500+).
    this.geminiModels = [
      'gemini-2.0-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-3.1-flash-lite',
      'gemini-2.0-flash'
    ];
    // Soft content target stays short via prompts; hard cap must cover thinking + output.
    this.maxOutputTokens = 384;
    this.maxTurns = 6;
    this.maxExchangesBeforeReading = 999; // reading is a separate mode now

    // Demo singing track (user-provided)
    this.singingDemo = {
      videoId: 'kH9_meN7WqQ',
      videoUrl: 'https://www.youtube.com/embed/kH9_meN7WqQ?rel=0&modestbranding=1',
      title: 'Singing Practice (Demo)',
      lyrics: `Twinkle twinkle little star
How I wonder what you are
Up above the world so high
Like a diamond in the sky
Twinkle twinkle little star
How I wonder what you are`
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
          // continue to next model for 404/429/400
        }
      }
    }

    return { success: false, text: '', error: lastError || 'Gemini communication generation failed for all keys' };
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
    const prompt = `Write a clear reading practice passage in ${language || 'English'} with exactly 4 simple sentences. Use everyday words. Plain text only — no quotes or markdown.`;
    return this.generateContent(prompt, apiKeys, { temperature: 0.65, json: false });
  }

  async generatePracticeIntro(apiKeys, language) {
    const prompt = `Say one short line (under 12 words) inviting the learner to read the passage aloud, in ${language || 'English'}. Plain text only.`;
    return this.generateContent(prompt, apiKeys, { temperature: 0.6, json: false });
  }

  getSingingDemo() {
    return { ...this.singingDemo };
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
