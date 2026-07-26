console.log('[Focus Mode Extension] Background active tab monitor active.');

let lastReportedUrl = '';
let lastReportTime = 0;

// Poll active browser tab & Focus Mode server signal
async function checkActiveTabAndSignal() {
  try {
    const res = await fetch('http://localhost:3000/api/extension/signal');
    const signalData = await res.json();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const activeTab = tabs[0];
      const url = activeTab.url || '';

      const isShorts = url.includes('youtube.com/shorts');
      const isYtMusic = url.includes('music.youtube.com');
      const isYouTube = url.includes('youtube.com');
      const isInstagram = url.includes('instagram.com');
      const isSpotify = url.includes('spotify.com');
      const isTikTok = url.includes('tiktok.com');
      const isTwitter = url.includes('x.com') || url.includes('twitter.com');
      const isReddit = url.includes('reddit.com');

      const isDistractingUrl = isShorts || isYtMusic || isYouTube || isInstagram || isSpotify || isTikTok || isTwitter || isReddit;

      // If Focus Session is active and active tab is distracting
      if (signalData.isFocusSessionActive && isDistractingUrl) {
        const now = Date.now();
        if (url !== lastReportedUrl || (now - lastReportTime) > 3000) {
          lastReportedUrl = url;
          lastReportTime = now;

          fetch('http://localhost:3000/api/distraction/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url, title: activeTab.title || 'Distracting Site' })
          }).catch(() => {});
        }
      }

      chrome.tabs.sendMessage(activeTab.id, {
        action: 'SYNC_YT_STATE',
        pauseYouTube: signalData.pauseYouTube,
        reason: signalData.reason,
        isFocusSessionActive: signalData.isFocusSessionActive,
        isDistractingUrl: isDistractingUrl,
        url: url
      }).catch(() => {});
    });
  } catch (e) {
    // Server offline
  }
}

setInterval(checkActiveTabAndSignal, 1000);
