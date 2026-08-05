const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const axios = require('axios');

ffmpeg.setFfmpegPath(ffmpegStatic);

class SpeechService {
  constructor() {
    this.tmpDir = path.join(__dirname, 'tmp');
    if (!fs.existsSync(this.tmpDir)) {
      fs.mkdirSync(this.tmpDir, { recursive: true });
    }
    // Lite models only — full flash models exhaust free-tier quotas quickly for audio ASR.
    this.asrModels = [
      'gemini-2.0-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-1.5-flash-8b'
    ];
  }

  findAudioPayloadOffset(buffer) {
    if (!buffer || buffer.length < 8) return 0;
    const maxScan = Math.min(buffer.length - 4, 512 * 1024);
    for (let i = 0; i < maxScan; i++) {
      // WebM / Matroska EBML
      if (buffer[i] === 0x1a && buffer[i + 1] === 0x45 && buffer[i + 2] === 0xdf && buffer[i + 3] === 0xa3) {
        return i;
      }
      // Ogg
      if (buffer[i] === 0x4f && buffer[i + 1] === 0x67 && buffer[i + 2] === 0x67 && buffer[i + 3] === 0x53) {
        return i;
      }
      // WAV RIFF
      if (buffer[i] === 0x52 && buffer[i + 1] === 0x49 && buffer[i + 2] === 0x46 && buffer[i + 3] === 0x46) {
        return i;
      }
      // MP3 frame sync or ID3
      if (
        (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) ||
        (buffer[i] === 0x49 && buffer[i + 1] === 0x44 && buffer[i + 2] === 0x33)
      ) {
        return i;
      }
    }
    return 0;
  }

  sniffAudioExt(buffer) {
    const off = this.findAudioPayloadOffset(buffer);
    const head = buffer.slice(off, off + 16);
    if (head[0] === 0x1a) return 'webm';
    if (head.toString('ascii', 0, 4) === 'OggS') return 'ogg';
    if (head.toString('ascii', 0, 4) === 'RIFF') return 'wav';
    if (head[0] === 0xff || head.toString('ascii', 0, 3) === 'ID3') return 'mp3';
    return 'webm';
  }

  /**
   * MediaRecorder timeslice uploads can include junk bytes before the real container header.
   */
  sanitizeAudioFile(audioFilePath) {
    const raw = fs.readFileSync(audioFilePath);
    if (raw.length < 256) {
      throw new Error('Recording too short — speak longer and try again');
    }
    const offset = this.findAudioPayloadOffset(raw);
    if (offset <= 0) return audioFilePath;

    const trimmedPath = `${audioFilePath}.trim.${this.sniffAudioExt(raw)}`;
    fs.writeFileSync(trimmedPath, raw.slice(offset));
    try { fs.unlinkSync(audioFilePath); } catch (e) {}
    return trimmedPath;
  }

  resolveWhisperBinary(explicitPath, modelPath) {
    const tried = [];
    const push = (p) => {
      if (!p) return;
      const n = path.normalize(String(p).trim());
      if (n && !tried.includes(n)) tried.push(n);
    };

    push(explicitPath);
    // Bundled Focus Mode whisper install
    push(path.join(__dirname, 'whisper', 'Release', process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'));
    push(path.join(__dirname, 'whisper', 'Release', process.platform === 'win32' ? 'main.exe' : 'main'));

    if (modelPath) {
      const absModel = path.isAbsolute(modelPath) ? modelPath : path.join(__dirname, modelPath);
      const modelDir = path.dirname(absModel);
      const parent = path.dirname(modelDir);
      const names = process.platform === 'win32'
        ? ['whisper-cli.exe', 'main.exe', 'whisper.exe', 'main']
        : ['whisper-cli', 'main', 'whisper'];
      for (const name of names) {
        push(path.join(modelDir, name));
        push(path.join(parent, name));
        push(path.join(parent, 'Release', name));
        push(path.join(parent, 'build', 'bin', name));
        push(path.join(parent, 'build', 'Release', name));
        push(path.join(__dirname, 'whisper', 'Release', name));
        push(path.join(__dirname, 'whisper', name));
        push(path.join(__dirname, 'bin', name));
      }
    }

    for (const candidate of tried) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { binary: candidate, tried };
      }
    }

    const bare = process.platform === 'win32' ? 'main.exe' : 'main';
    return { binary: bare, tried: [...tried, bare] };
  }

  resolveModelPath(modelPath) {
    if (!modelPath) return '';
    if (fs.existsSync(modelPath)) return path.resolve(modelPath);
    const local = path.join(__dirname, modelPath);
    if (fs.existsSync(local)) return local;
    return modelPath;
  }

  runFfmpegToWav(inputPath, wavPath, formatHint) {
    return new Promise((resolve, reject) => {
      let cmd = ffmpeg(inputPath);
      if (formatHint) cmd = cmd.inputOptions(['-f', formatHint]);
      cmd
        .audioChannels(1)
        .audioFrequency(16000)
        .format('wav')
        .outputOptions(['-y', '-vn'])
        .save(wavPath)
        .on('end', resolve)
        .on('error', reject);
    });
  }

  async convertToWav(audioFilePath, hintExt = '') {
    const inputPath = await this.ensureReadableAudioPath(audioFilePath, hintExt);
    const wavPath = path.join(this.tmpDir, `comm_audio_${Date.now()}.wav`);

    const ext = path.extname(inputPath).toLowerCase().replace('.', '') || 'webm';
    const formatHints = [...new Set([
      '',
      ext,
      ext === 'webm' ? 'matroska' : '',
      'webm', 'matroska', 'ogg', 'wav', 'mp3'
    ].filter(Boolean))];

    let lastError = null;
    for (const hint of formatHints) {
      try {
        await this.runFfmpegToWav(inputPath, wavPath, hint || null);
        return wavPath;
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(lastError?.message || 'Audio conversion failed');
  }

  /**
   * Multer often saves files with no extension — rename so ffmpeg/Gemini can detect format.
   */
  async ensureReadableAudioPath(audioFilePath, hintExt = '') {
    if (!audioFilePath || !fs.existsSync(audioFilePath)) {
      throw new Error('Audio file missing');
    }

    let workingPath = this.sanitizeAudioFile(audioFilePath);
    if (path.extname(workingPath)) return workingPath;

    let ext = String(hintExt || '').toLowerCase().replace(/^\./, '');
    if (!ext) {
      const buf = fs.readFileSync(workingPath);
      ext = this.sniffAudioExt(buf);
    }

    const renamed = `${workingPath}.${ext}`;
    try {
      fs.renameSync(workingPath, renamed);
      return renamed;
    } catch {
      fs.copyFileSync(workingPath, renamed);
      try { fs.unlinkSync(workingPath); } catch (e) {}
      return renamed;
    }
  }

  async transcribeWithWhisper(wavPath, modelPath, binaryPath) {
    const { binary, tried } = this.resolveWhisperBinary(binaryPath, modelPath);
    if (!fs.existsSync(binary) && path.isAbsolute(binary)) {
      return {
        success: false,
        transcript: '',
        error: `Whisper binary not found. Tried: ${tried.slice(0, 8).join(' | ')}. Set whisper_binary_path in Settings.`
      };
    }

    const txtPathWav = `${wavPath}.txt`;
    const txtPathBase = wavPath.replace(/\.wav$/i, '.txt');

    try {
      await new Promise((resolve, reject) => {
        execFile(
          binary,
          ['-m', modelPath, '-f', wavPath, '-otxt', '-np'],
          {
            cwd: path.dirname(binary) !== '.' ? path.dirname(binary) : process.cwd(),
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
            shell: false
          },
          (err, stdout, stderr) => {
            if (err) {
              const msg = (stderr || err.message || '').toString();
              if (err.code === 'ENOENT') {
                return reject(new Error(
                  `Whisper binary not found (spawn ${binary} ENOENT). Set full path to main.exe in Settings.`
                ));
              }
              return reject(new Error(msg || err.message));
            }
            resolve(stdout);
          }
        );
      });
    } catch (error) {
      return { success: false, transcript: '', error: `Whisper transcription failed: ${error.message}` };
    }

    try {
      let outputText = '';
      if (fs.existsSync(txtPathWav)) {
        outputText = fs.readFileSync(txtPathWav, 'utf8').trim();
      } else if (fs.existsSync(txtPathBase)) {
        outputText = fs.readFileSync(txtPathBase, 'utf8').trim();
      } else {
        return { success: false, transcript: '', error: 'Whisper produced no transcript file' };
      }
      return { success: true, transcript: outputText, error: null, engine: 'whisper.cpp' };
    } catch (error) {
      return { success: false, transcript: '', error: `Failed to read transcription output: ${error.message}` };
    } finally {
      [txtPathWav, txtPathBase].forEach((file) => {
        try { if (file && fs.existsSync(file)) fs.unlinkSync(file); } catch (e) {}
      });
    }
  }

  extractGeminiText(responseData) {
    const parts = responseData?.candidates?.[0]?.content?.parts || [];
    const texts = parts
      .filter(p => p && typeof p.text === 'string' && !p.thought)
      .map(p => p.text);
    if (texts.length) return texts.join('\n').trim();
    return (parts[0]?.text || '').trim();
  }

  /**
   * Gemini multimodal ASR — used when whisper.cpp binary is not installed.
   */
  async transcribeWithGemini(audioFilePath, apiKeys, language) {
    const keys = (Array.isArray(apiKeys) ? apiKeys : [])
      .map(k => (k || '').trim())
      .filter(k => k.length > 0 && !k.startsWith('AQ.'));

    if (keys.length === 0) {
      return { success: false, transcript: '', error: 'No Gemini API key available for speech recognition' };
    }

    if (!audioFilePath || !fs.existsSync(audioFilePath)) {
      return { success: false, transcript: '', error: 'Audio file missing for transcription' };
    }

    const lower = audioFilePath.toLowerCase();
    const mime = lower.endsWith('.wav') ? 'audio/wav'
      : lower.endsWith('.mp3') ? 'audio/mp3'
      : lower.endsWith('.webm') ? 'audio/webm'
      : lower.endsWith('.ogg') ? 'audio/ogg'
      : 'audio/wav';

    const stat = fs.statSync(audioFilePath);
    if (stat.size < 256) {
      return { success: false, transcript: '', error: 'Recording too short — hold the mic longer and try again' };
    }

    const b64 = fs.readFileSync(audioFilePath).toString('base64');
    const prompt = `Transcribe this spoken audio into ${language || 'English'} plain text accurately.
Rules:
- Return ONLY the spoken words (correct spelling/grammar of what was said).
- No quotes, labels, markdown, or commentary.
- Preserve names and technical words carefully.
- If silent or unintelligible, return exactly: (inaudible)`;

    let lastError = '';

    for (const apiKey of keys) {
      for (const model of this.asrModels) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
          const response = await axios.post(url, {
            contents: [{
              parts: [
                { text: prompt },
                { inlineData: { mimeType: mime, data: b64 } }
              ]
            }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 512
            }
          }, { timeout: 25000 });

          const text = this.extractGeminiText(response.data);
          const finish = response.data?.candidates?.[0]?.finishReason;
          console.log(`[SpeechService] ASR ${model} finish=${finish} chars=${(text || '').length}`);

          if (text && text.trim().length > 0) {
            const cleaned = text.trim().replace(/^["']|["']$/g, '');
            if (cleaned === '(inaudible)') {
              return { success: false, transcript: '', error: 'Could not hear speech clearly — try again closer to the mic' };
            }
            return { success: true, transcript: cleaned, error: null, engine: `gemini:${model}` };
          }
          lastError = `${model} returned empty transcript (finish=${finish})`;
        } catch (e) {
          const code = e.response?.status;
          const message = e.response?.data?.error?.message || e.message;
          lastError = `${model}: ${message}`;
          console.warn(`[SpeechService] ASR ${lastError}`);
          if (code === 401 || code === 403) break;
          if (code === 429 || /quota|rate.?limit|resource.?exhausted/i.test(message)) {
            // Try next lite model / key instead of hammering the same limit
            continue;
          }
        }
      }
    }

    const quotaHit = /quota|rate.?limit|limit:\s*0/i.test(lastError || '');
    const friendly = quotaHit
      ? 'Gemini free-tier speech quota is used up. Enable browser speech recognition (Chrome/Edge) or add another API key in Settings.'
      : (lastError ? `Speech recognition failed: ${lastError}` : 'Speech recognition failed for all Gemini keys');

    return { success: false, transcript: '', error: friendly };
  }

  async transcribeAudio(audioFilePath, modelPath, options = {}) {
    const { binaryPath = '', geminiKeys = [], language = 'english', originalName = '', mimeType = '', keepSource = false } = options;

    if (!audioFilePath) {
      return { success: false, transcript: '', error: 'No audio file provided' };
    }

    let preparedPath = audioFilePath;
    let wavPath = '';
    const cleanupFiles = new Set(keepSource ? [] : [audioFilePath]);

    try {
      const hint = path.extname(originalName || '') ||
        (mimeType.includes('ogg') ? '.ogg' : mimeType.includes('wav') ? '.wav' : '.webm');
      preparedPath = await this.ensureReadableAudioPath(audioFilePath, hint);
      if (!keepSource || preparedPath !== audioFilePath) cleanupFiles.add(preparedPath);
    } catch (error) {
      return { success: false, transcript: '', error: `Audio prepare failed: ${error.message}` };
    }

    const cleanup = () => {
      cleanupFiles.forEach((file) => {
        try { if (file && fs.existsSync(file)) fs.unlinkSync(file); } catch (e) {}
      });
      if (wavPath) {
        try { if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath); } catch (e) {}
      }
    };

    const resolvedModel = this.resolveModelPath(modelPath);
    const resolved = this.resolveWhisperBinary(binaryPath, resolvedModel);
    const hasModel = resolvedModel && fs.existsSync(resolvedModel);
    const hasBinary = resolved.binary && fs.existsSync(resolved.binary);

    // Prefer local whisper when installed; otherwise skip FFmpeg and send original audio to Gemini (faster + fewer failures)
    if (hasModel && hasBinary) {
      try {
        wavPath = await this.convertToWav(preparedPath, path.extname(preparedPath));
      } catch (error) {
        console.warn('[SpeechService] FFmpeg failed, falling back to Gemini ASR:', error.message);
      }

      if (wavPath) {
        const whisperResult = await this.transcribeWithWhisper(wavPath, resolvedModel, binaryPath || resolved.binary);
        if (whisperResult.success) {
          cleanup();
          return whisperResult;
        }
        const isMissingBin = /ENOENT|not found/i.test(whisperResult.error || '');
        if (!isMissingBin) {
          // Still try Gemini before giving up
          console.warn('[SpeechService] Whisper failed — trying Gemini ASR:', whisperResult.error);
        }
      }
    }

    const geminiInput = wavPath && fs.existsSync(wavPath) ? wavPath : preparedPath;
    const geminiResult = await this.transcribeWithGemini(geminiInput, geminiKeys, language);
    cleanup();
    return geminiResult;
  }

  async synthesizeSpeech(text, apiKey, voiceId, modelHeader) {
    if (!text) {
      return { success: false, audioFilePath: '', error: 'Missing text for speech synthesis' };
    }
    if (!apiKey) {
      return { success: false, audioFilePath: '', error: 'Fish Audio API key is not configured in Settings' };
    }

    const filename = `comm_tts_${Date.now()}.mp3`;
    const audioFilePath = path.join(this.tmpDir, filename);
    const model = (modelHeader || '').trim() || 's2.1-pro-free';

    try {
      // latency: low/balanced = much faster time-to-first-audio for conversation
      // https://docs.fish.audio/developer-guide/core-features/text-to-speech
      const payload = {
        text: String(text).trim().slice(0, 500),
        format: 'mp3',
        mp3_bitrate: 64,
        normalize: false,
        latency: 'balanced',
        chunk_length: 120,
        min_chunk_length: 50
      };
      if (voiceId && String(voiceId).trim()) {
        payload.reference_id = String(voiceId).trim();
      }

      const response = await axios.post('https://api.fish.audio/v1/tts', payload, {
        responseType: 'arraybuffer',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          model
        },
        timeout: 25000,
        validateStatus: (s) => s >= 200 && s < 300
      });

      fs.writeFileSync(audioFilePath, Buffer.from(response.data));
      return { success: true, audioFilePath, audioUrl: `/tmp/${filename}`, error: null };
    } catch (error) {
      let msg = error.message;
      if (error.response && error.response.data) {
        try {
          const buf = Buffer.isBuffer(error.response.data)
            ? error.response.data
            : Buffer.from(error.response.data);
          msg = buf.toString('utf8');
        } catch (e) {
          msg = String(error.response.status || msg);
        }
      }
      return { success: false, audioFilePath: '', error: `Fish Audio TTS failed: ${msg}` };
    }
  }
}

module.exports = new SpeechService();
