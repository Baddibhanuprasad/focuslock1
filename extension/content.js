console.log('[Focus Mode Extension] Content script attached.');

let isAutoPaused = false;
let lastAudioTime = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'SYNC_YT_STATE') {
    const isInstagram = window.location.hostname.includes('instagram.com');
    const isShorts = window.location.pathname.includes('/shorts');
    const isTikTok = window.location.hostname.includes('tiktok.com');
    const isDistraction = isInstagram || isShorts || isTikTok || message.isDistractingUrl;

    const video = document.querySelector('video');

    // If Focus Session is active and user is viewing Instagram / Shorts
    if (message.isFocusSessionActive && isDistraction) {
      if (video && !video.paused) {
        console.log('[Focus Mode] Distracting site detected - Pausing video');
        video.pause();
      }

      playAlertChime();
      showOnScreenBanner(`🚨 FOCUS MODE ALERT: ${isInstagram ? 'Instagram' : (isShorts ? 'YouTube Shorts' : 'Distracting Site')} Blocked during Focus Session!`);
      return;
    }

    // Standard YouTube Pause / Resume
    if (message.pauseYouTube) {
      if (video && !video.paused) {
        video.pause();
        isAutoPaused = true;
        playAlertChime();
        showOnScreenBanner(`⚠️ Focus Mode: Video Paused (${message.reason})`);
      }
    } else {
      if (isAutoPaused && video && video.paused) {
        video.play();
        isAutoPaused = false;
        removeOnScreenBanner();
      } else if (!message.isFocusSessionActive) {
        removeOnScreenBanner();
      }
    }
  }
});

function playAlertChime() {
  const now = Date.now();
  if (now - lastAudioTime < 3000) return;
  lastAudioTime = now;

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(880, ctx.currentTime);
    osc2.frequency.setValueAtTime(550, ctx.currentTime);

    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 0.6);
    osc2.stop(ctx.currentTime + 0.6);
  } catch (e) {
    console.warn('Tab audio tone error:', e);
  }
}

function showOnScreenBanner(text) {
  let banner = document.getElementById('focus-mode-yt-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'focus-mode-yt-banner';
    banner.style.position = 'fixed';
    banner.style.top = '25px';
    banner.style.left = '50%';
    banner.style.transform = 'translateX(-50%)';
    banner.style.zIndex = '9999999';
    banner.style.backgroundColor = '#FF0844';
    banner.style.color = '#ffffff';
    banner.style.padding = '18px 32px';
    banner.style.borderRadius = '16px';
    banner.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    banner.style.fontWeight = '900';
    banner.style.fontSize = '16px';
    banner.style.boxShadow = '0 0 40px rgba(255, 8, 68, 0.8)';
    banner.style.border = '2px solid #ffffff';
    banner.style.letterSpacing = '0.5px';
    
    document.body.appendChild(banner);
  }
  banner.textContent = text;
}

function removeOnScreenBanner() {
  const banner = document.getElementById('focus-mode-yt-banner');
  if (banner) {
    banner.remove();
  }
}
