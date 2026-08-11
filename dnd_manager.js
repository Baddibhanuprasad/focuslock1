const { exec } = require('child_process');

class DNDManager {
  constructor() {
    this.isMuted = false;
  }

  muteNotifications() {
    return new Promise((resolve) => {
      this.isMuted = true;
      console.log('[DNDManager] Muting OS Notifications (Focus Mode ON)');
      
      // PowerShell script to disable Windows Toast Notifications
      const psCommand = `powershell -Command "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings' -Name 'NOC_GLOBAL_SETTING_TOASTS_ENABLED' -Value 0 -ErrorAction SilentlyContinue"`;
      
      exec(psCommand, (err) => {
        if (err) {
          console.warn('[DNDManager] PowerShell DND toggle warning (simulating DND in UI):', err.message);
        } else {
          console.log('[DNDManager] Windows OS notifications silenced.');
        }
        resolve({ success: true, isMuted: true });
      });
    });
  }

  restoreNotifications() {
    return new Promise((resolve) => {
      this.isMuted = false;
      console.log('[DNDManager] Restoring OS Notifications (Focus Mode OFF)');
      
      const psCommand = `powershell -Command "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings' -Name 'NOC_GLOBAL_SETTING_TOASTS_ENABLED' -Value 1 -ErrorAction SilentlyContinue"`;
      
      exec(psCommand, (err) => {
        if (err) {
          console.warn('[DNDManager] PowerShell DND restore warning:', err.message);
        } else {
          console.log('[DNDManager] Windows OS notifications restored.');
        }
        resolve({ success: true, isMuted: false });
      });
    });
  }

  getStatus() {
    return { isMuted: this.isMuted };
  }
}

module.exports = new DNDManager();
