// @ts-check
/**
 * DuoSync — Collaborative Real-Time Client Application
 */

class DuoApp {
  constructor() {
    this.roomId = this.getParam('room') || localStorage.getItem('duosync_room') || 'our-space';
    this.currentUserKey = this.getParam('user') || localStorage.getItem('duosync_user') || 'user1'; // 'user1' or 'user2'
    
    this.room = {
      id: this.roomId,
      user1_name: 'Partner 1',
      user2_name: 'Partner 2',
      user1_color: '#4f46e5',
      user2_color: '#ec4899',
      user1_avatar: '🦊',
      user2_avatar: '🐼',
      user1_status: '',
      user2_status: ''
    };
    this.statusTargetUser = this.currentUserKey;

    this.tasks = [];
    this.categories = [];
    this.activities = [];
    this.messages = [];
    this.currentFilter = 'all';
    this.searchQuery = '';
    this.filterCategory = 'all';
    this.hideCompleted = false;
    this.currentTab = 'todos';
    this.unreadChatCount = 0;

    this.eventSource = null;
    this.isOnline = false;
    this.audioCtx = null;

    // Real-time synchronization flags & timers
    this.lastSyncTime = 0;
    this.lastHeartbeat = Date.now();
    this.userIsTypingScratchpad = false;
    this.scratchpadTypingTimeout = null;
    this.userIsTypingChat = false;
    this.chatTypingDebounce = null;
    this.partnerTypingTimeout = null;
    this.reconnectAttempts = 0;

    // Track sent actions to prevent duplicate self-prompts
    this.mySentActionIds = new Set();
    this.activeNudgeTaskId = null;
    this.nudgeBannerTimeout = null;

    // Chat notification sound & title flashing state
    this.soundEnabled = localStorage.getItem('duosync_sound_enabled') !== 'false';
    this.titleFlashInterval = null;
    this.originalDocumentTitle = document.title || 'DuoSync — Couple & Partner Sync';

    // Cache elements
    this.initElements();
    this.initAudio();
    this.initTheme();
    this.initPwa();
    this.bindEvents();

    // Start Calendar
    this.calendar = new window.DuoCalendar(this);

    // Instant local pre-hydration so tasks appear in 0ms without waiting for network/spin-up!
    this.hydrateFromLocalVault();

    // Initial load
    this.loadState().then(() => {
      this.initSSE();
      this.checkPinProtection();
      this.calendar.renderCalendar();
      this.calendar.loadSelectedDayDetails();
      this.initWatchdogs();
    });
  }

  hydrateFromLocalVault() {
    const local = this.getLocalSnapshot();
    if (local && Array.isArray(local.tasks) && local.tasks.length > 0) {
      this.tasks = local.tasks;
      if (local.room) this.room = { ...this.room, ...local.room };
      if (Array.isArray(local.categories) && local.categories.length > 0) this.categories = local.categories;
      if (Array.isArray(local.messages) && local.messages.length > 0) this.messages = local.messages;
      if (local.dailyLogs && typeof local.dailyLogs === 'object') {
        try { localStorage.setItem(`duosync_logs_${this.roomId}`, JSON.stringify(local.dailyLogs)); } catch(e) {}
      }
      this.renderTasks();
    }
  }

  saveLocalSnapshot() {
    if (!this.roomId) return;
    try {
      let dailyLogs = {};
      if (this.calendar && this.calendar.cachedDailyLogs) {
        dailyLogs = this.calendar.cachedDailyLogs;
      } else {
        try { dailyLogs = JSON.parse(localStorage.getItem(`duosync_logs_${this.roomId}`) || '{}'); } catch(e) {}
      }

      const snapshot = {
        version: '3.0',
        roomId: this.roomId,
        room: this.room,
        tasks: this.tasks,
        categories: this.categories,
        dailyLogs,
        scratchpad: this.scratchpadArea ? this.scratchpadArea.value : '',
        messages: this.messages,
        updatedAt: Date.now()
      };
      localStorage.setItem(`duosync_vault_${this.roomId}`, JSON.stringify(snapshot));
    } catch (e) {
      console.warn('Could not save local vault snapshot:', e);
    }
  }

  getLocalSnapshot() {
    if (!this.roomId) return null;
    try {
      const raw = localStorage.getItem(`duosync_vault_${this.roomId}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  getParam(key) {
    const url = new URL(window.location.href);
    return url.searchParams.get(key);
  }

  setParam(key, value) {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    window.history.replaceState({}, '', url.toString());
  }

  initElements() {
    // Nav
    this.partnerStatusPill = document.getElementById('partnerStatusPill');
    this.statusDot = document.getElementById('statusDot');
    this.statusText = document.getElementById('statusText');
    this.partnerAvatarSmall = document.getElementById('partnerAvatarSmall');
    this.currentRoomDisplay = document.getElementById('currentRoomDisplay');

    // PWA & Notifications
    this.installPwaBtn = document.getElementById('installPwaBtn');
    this.notificationToggleBtn = document.getElementById('notificationToggleBtn');

    // Identity pills
    this.user1Btn = document.getElementById('user1SelectBtn');
    this.user2Btn = document.getElementById('user2SelectBtn');
    this.navUser1Name = document.getElementById('navUser1Name');
    this.navUser2Name = document.getElementById('navUser2Name');
    this.navUser1Avatar = document.getElementById('navUser1Avatar');
    this.navUser2Avatar = document.getElementById('navUser2Avatar');
    this.navUser1StatusTag = document.getElementById('navUser1StatusTag');
    this.navUser2StatusTag = document.getElementById('navUser2StatusTag');

    // Live Partner Status Bar & Modal elements
    this.partnerStatusBar = document.getElementById('partnerStatusBar');
    this.statusColAvatar1 = document.getElementById('statusColAvatar1');
    this.statusColName1 = document.getElementById('statusColName1');
    this.statusText1 = document.getElementById('statusText1');
    this.statusBubble1 = document.getElementById('statusBubble1');
    this.editStatusBtn1 = document.getElementById('editStatusBtn1');
    this.statusColAvatar2 = document.getElementById('statusColAvatar2');
    this.statusColName2 = document.getElementById('statusColName2');
    this.statusText2 = document.getElementById('statusText2');
    this.statusBubble2 = document.getElementById('statusBubble2');
    this.editStatusBtn2 = document.getElementById('editStatusBtn2');
    this.openStatusModalBtn = document.getElementById('openStatusModalBtn');
    this.statusModal = document.getElementById('statusModal');
    this.closeStatusModalBtn = document.getElementById('closeStatusModalBtn');
    this.statusPickUser1 = document.getElementById('statusPickUser1');
    this.statusPickUser2 = document.getElementById('statusPickUser2');
    this.statusPickAvatar1 = document.getElementById('statusPickAvatar1');
    this.statusPickAvatar2 = document.getElementById('statusPickAvatar2');
    this.statusPickName1 = document.getElementById('statusPickName1');
    this.statusPickName2 = document.getElementById('statusPickName2');
    this.customStatusForm = document.getElementById('customStatusForm');
    this.customStatusInput = document.getElementById('customStatusInput');
    this.clearStatusBtn = document.getElementById('clearStatusBtn');

    // Tabs
    this.tabButtons = document.querySelectorAll('.main-tabs .tab-btn');
    this.tabContents = document.querySelectorAll('.tab-content');
    this.activeTodoCount = document.getElementById('activeTodoCount');

    // Form
    this.addTaskForm = document.getElementById('addTaskForm');
    this.taskTitleInput = document.getElementById('taskTitleInput');
    this.taskAssignee = document.getElementById('taskAssignee');
    this.taskDueDate = document.getElementById('taskDueDate');
    this.taskCategory = document.getElementById('taskCategory');
    this.taskPriority = document.getElementById('taskPriority');
    this.taskRecurring = document.getElementById('taskRecurring');
    this.taskNotesInput = document.getElementById('taskNotesInput');
    this.toggleNotesBtn = document.getElementById('toggleNotesBtn');
    this.notesExpandable = document.getElementById('notesExpandable');

    // Filters
    this.filterPills = document.querySelectorAll('.filter-pill');
    this.taskSearchInput = document.getElementById('taskSearchInput');
    this.filterCategorySelect = document.getElementById('filterCategorySelect');
    this.hideCompletedCheck = document.getElementById('hideCompletedCheck');

    // Task Lists
    this.activeTasksList = document.getElementById('activeTasksList');
    this.completedTasksList = document.getElementById('completedTasksList');
    this.tasksEmptyState = document.getElementById('tasksEmptyState');
    this.activeTasksHeaderCount = document.getElementById('activeTasksHeaderCount');
    this.completedTasksHeaderCount = document.getElementById('completedTasksHeaderCount');
    this.clearCompletedBtn = document.getElementById('clearCompletedBtn');

    // Modals
    this.shareModal = document.getElementById('shareModal');
    this.settingsModal = document.getElementById('settingsModal');
    this.taskEditModal = document.getElementById('taskEditModal');
    this.pinLockModal = document.getElementById('pinLockModal');
    this.pinUnlockForm = document.getElementById('pinUnlockForm');
    this.pinUnlockInput = document.getElementById('pinUnlockInput');
    this.pinErrorMsg = document.getElementById('pinErrorMsg');
    this.savePinBtn = document.getElementById('savePinBtn');
    this.exportJsonBtn = document.getElementById('exportJsonBtn');
    this.exportMarkdownBtn = document.getElementById('exportMarkdownBtn');
    this.toastContainer = document.getElementById('toastContainer');
    this.cheerOverlay = document.getElementById('cheerOverlay');

    // Scratchpad
    this.scratchpadArea = document.getElementById('scratchpadArea');
    this.scratchpadStatus = document.getElementById('scratchpadStatus');

    // Duo Chat Room
    this.chatTabBtn = document.getElementById('chatTabBtn');
    this.unreadChatBadge = document.getElementById('unreadChatBadge');
    this.floatingChatBtn = document.getElementById('floatingChatBtn');
    this.floatingChatBadge = document.getElementById('floatingChatBadge');
    this.chatPartnerAvatar = document.getElementById('chatPartnerAvatar');
    this.chatPartnerName = document.getElementById('chatPartnerName');
    this.chatPartnerStatusDot = document.getElementById('chatPartnerStatusDot');
    this.chatPartnerStatusText = document.getElementById('chatPartnerStatusText');
    this.chatPartnerOnlineBadge = document.getElementById('chatPartnerOnlineBadge');
    this.chatQuickLoveBtn = document.getElementById('chatQuickLoveBtn');
    this.chatEmojiDrawerBtn = document.getElementById('chatEmojiDrawerBtn');
    this.chatMessagesContainer = document.getElementById('chatMessagesContainer');
    this.chatMessagesList = document.getElementById('chatMessagesList');
    this.chatTypingIndicator = document.getElementById('chatTypingIndicator');
    this.typingPartnerAvatar = document.getElementById('typingPartnerAvatar');
    this.typingPartnerText = document.getElementById('typingPartnerText');
    this.chatForm = document.getElementById('chatForm');
    this.chatTextInput = document.getElementById('chatTextInput');
    this.chatSendBtn = document.getElementById('chatSendBtn');
    this.clearChatBtn = document.getElementById('clearChatBtn');
    this.emojiChips = document.querySelectorAll('.emoji-chip');

    // Activity timeline
    this.activityTimeline = document.getElementById('activityTimeline');

    // Prominent Partner Nudge Banner
    this.nudgeAlertBanner = document.getElementById('nudgeAlertBanner');
    this.nudgeAlertSender = document.getElementById('nudgeAlertSender');
    this.nudgeAlertMessage = document.getElementById('nudgeAlertMessage');
    this.nudgeActionDoneBtn = document.getElementById('nudgeActionDoneBtn');
    this.nudgeActionDismissBtn = document.getElementById('nudgeActionDismissBtn');

    // Prominent Partner Cheer Modal
    this.cheerCelebrationModal = document.getElementById('cheerCelebrationModal');
    this.cheerModalEmoji = document.getElementById('cheerModalEmoji');
    this.cheerModalTitle = document.getElementById('cheerModalTitle');
    this.cheerModalDesc = document.getElementById('cheerModalDesc');
    this.cheerReplyBtn = document.getElementById('cheerReplyBtn');
    // Chat sound toggle
    this.chatSoundToggleBtn = document.getElementById('chatSoundToggleBtn');
    this.updateChatSoundBtnUI();
  }

  initAudio() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
      this.fallbackAudio = new Audio(this.generateWavDataUri());
      this.fallbackAudio.preload = 'auto';
    } catch (e) {
      console.warn('Audio system warning:', e);
    }

    // Auto-resume / unlock AudioContext on any user interaction anywhere on the window
    const unlockAudio = () => {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      // Pre-warm HTML5 audio element
      if (this.fallbackAudio && this.fallbackAudio.paused) {
        this.fallbackAudio.volume = 0.001;
        this.fallbackAudio.play().then(() => {
          this.fallbackAudio.pause();
          this.fallbackAudio.currentTime = 0;
          this.fallbackAudio.volume = 1.0;
        }).catch(() => {});
      }
    };

    ['click', 'keydown', 'touchstart', 'pointerdown'].forEach(evt => {
      window.addEventListener(evt, unlockAudio, { passive: true });
    });
  }

  generateWavDataUri() {
    // Generate a 0.55s pleasant 3-tone notification chime (784Hz -> 1046Hz -> 1318Hz) as a base64 WAV
    const sampleRate = 22050;
    const duration = 0.55;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let sample = 0;
      if (t < 0.10) {
        // G5 (784 Hz)
        const env = Math.sin((t / 0.10) * Math.PI);
        sample = Math.sin(2 * Math.PI * 783.99 * t) * env;
      } else if (t < 0.20) {
        // C6 (1046.5 Hz)
        const tNote = t - 0.10;
        const env = Math.sin((tNote / 0.10) * Math.PI);
        sample = Math.sin(2 * Math.PI * 1046.50 * t) * env;
      } else {
        // E6 (1318.5 Hz) with gentle exponential decay
        const tDecay = t - 0.20;
        const decay = Math.exp(-tDecay * 6.5);
        sample = (Math.sin(2 * Math.PI * 1318.51 * t) * 0.8 + Math.sin(2 * Math.PI * 2637.0 * t) * 0.2) * decay;
      }
      const val = Math.max(-1, Math.min(1, sample)) * 0.65;
      view.setInt16(44 + i * 2, val < 0 ? val * 0x8000 : val * 0x7FFF, true);
    }

    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return 'data:audio/wav;base64,' + btoa(binary);
  }

  toggleChatSound() {
    this.soundEnabled = !this.soundEnabled;
    localStorage.setItem('duosync_sound_enabled', String(this.soundEnabled));
    this.updateChatSoundBtnUI();
    if (this.soundEnabled) {
      this.playChime('message');
      this.showToast('Chat notification sound enabled 🔊 (Testing chime!)');
    } else {
      this.showToast('Chat notification sound muted 🔇');
    }
  }

  updateChatSoundBtnUI() {
    if (!this.chatSoundToggleBtn) return;
    if (this.soundEnabled) {
      this.chatSoundToggleBtn.classList.remove('muted');
      this.chatSoundToggleBtn.innerHTML = '<span id="chatSoundIcon">🔊</span> Sound On';
      this.chatSoundToggleBtn.title = 'Chat notification sound is enabled. Click to test or mute!';
    } else {
      this.chatSoundToggleBtn.classList.add('muted');
      this.chatSoundToggleBtn.innerHTML = '<span id="chatSoundIcon">🔇</span> Sound Off';
      this.chatSoundToggleBtn.title = 'Chat notification sound is muted. Click to enable!';
    }
  }

  startTitleFlashing(alertText) {
    if (this.titleFlashInterval) {
      clearInterval(this.titleFlashInterval);
    }
    if (!this.originalDocumentTitle) {
      this.originalDocumentTitle = document.title || 'DuoSync — Couple & Partner Sync';
    }
    let toggle = false;

    this.titleFlashInterval = setInterval(() => {
      const isVisibleAndChat = !document.hidden && document.hasFocus() && this.currentTab === 'chat';
      if (isVisibleAndChat) {
        this.stopTitleFlashing();
        return;
      }
      document.title = toggle ? alertText : this.originalDocumentTitle;
      toggle = !toggle;
    }, 900);
  }

  stopTitleFlashing() {
    if (this.titleFlashInterval) {
      clearInterval(this.titleFlashInterval);
      this.titleFlashInterval = null;
    }
    if (this.originalDocumentTitle) {
      document.title = this.originalDocumentTitle;
    }
  }

  playChime(type = 'success') {
    if (!this.soundEnabled) return;

    let playedWebAudio = false;

    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      if (this.audioCtx.state === 'running') {
        try {
          const now = this.audioCtx.currentTime;

          if (type === 'message') {
            // Bright 3-note harmonic arpeggio (G5 -> C6 -> E6)
            // Crisp, audible even across rooms and in background
            const notes = [
              { freq: 783.99, delay: 0.0, dur: 0.38, gain: 0.35, wave: 'sine' },
              { freq: 1046.50, delay: 0.09, dur: 0.42, gain: 0.38, wave: 'sine' },
              { freq: 1318.51, delay: 0.18, dur: 0.55, gain: 0.32, wave: 'triangle' }
            ];

            notes.forEach(n => {
              const osc = this.audioCtx.createOscillator();
              const gain = this.audioCtx.createGain();
              const startTime = now + n.delay;
              osc.type = n.wave;
              osc.frequency.setValueAtTime(n.freq, startTime);
              gain.gain.setValueAtTime(0, startTime);
              gain.gain.linearRampToValueAtTime(n.gain, startTime + 0.02);
              gain.gain.exponentialRampToValueAtTime(0.001, startTime + n.dur);
              osc.connect(gain);
              gain.connect(this.audioCtx.destination);
              osc.start(startTime);
              osc.stop(startTime + n.dur);
            });
            playedWebAudio = true;
          } else if (type === 'message_soft') {
            // Soft gentle droplet pop when user is already viewing chat
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880.0, now);
            osc.frequency.exponentialRampToValueAtTime(520.0, now + 0.12);
            gain.gain.setValueAtTime(0.16, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.12);
            playedWebAudio = true;
          } else if (type === 'success') {
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.setValueAtTime(659.25, now + 0.08);
            osc.frequency.setValueAtTime(783.99, now + 0.16);
            gain.gain.setValueAtTime(0.18, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            osc.start(now);
            osc.stop(now + 0.4);
            playedWebAudio = true;
          } else if (type === 'cheer') {
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, now);
            osc.frequency.setValueAtTime(880.00, now + 0.1);
            osc.frequency.setValueAtTime(1174.66, now + 0.2);
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
            osc.start(now);
            osc.stop(now + 0.6);
            playedWebAudio = true;
          } else if (type === 'nudge') {
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880.0, now);
            osc.frequency.setValueAtTime(1318.5, now + 0.12);
            gain.gain.setValueAtTime(0.28, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
            osc.start(now);
            osc.stop(now + 0.5);
            playedWebAudio = true;
          }
        } catch (e) {
          console.warn('Audio synthesis blip:', e);
        }
      }
    }

    // Fallback: If Web Audio couldn't play (e.g. background tab or suspended context), use HTML5 audio!
    if (!playedWebAudio && type === 'message' && this.fallbackAudio) {
      try {
        this.fallbackAudio.currentTime = 0;
        this.fallbackAudio.volume = 0.85;
        this.fallbackAudio.play().catch(() => {});
      } catch (e) {}
    }
  }

  initTheme() {
    const savedTheme = localStorage.getItem('duosync_theme') || 'theme-light';
    document.body.className = savedTheme;
    const icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = savedTheme === 'theme-dark' ? '☀️' : '🌙';

    document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
      const isDark = document.body.classList.contains('theme-dark');
      const nextTheme = isDark ? 'theme-light' : 'theme-dark';
      document.body.className = nextTheme;
      localStorage.setItem('duosync_theme', nextTheme);
      if (icon) icon.textContent = nextTheme === 'theme-dark' ? '☀️' : '🌙';
    });
  }

  bindEvents() {
    // Switch tabs
    this.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.tab);
      });
    });

    // Identity Switcher
    this.user1Btn?.addEventListener('click', () => this.switchUser('user1'));
    this.user2Btn?.addEventListener('click', () => this.switchUser('user2'));

    // Live Partner Status Modal & Bar
    this.ensureStatusUI();
    this.openStatusModalBtn?.addEventListener('click', () => this.openStatusModal());
    this.statusBubble1?.addEventListener('click', () => this.openStatusModal('user1'));
    this.editStatusBtn1?.addEventListener('click', (e) => { e.stopPropagation(); this.openStatusModal('user1'); });
    this.statusBubble2?.addEventListener('click', () => this.openStatusModal('user2'));
    this.editStatusBtn2?.addEventListener('click', (e) => { e.stopPropagation(); this.openStatusModal('user2'); });

    this.closeStatusModalBtn?.addEventListener('click', () => this.closeStatusModal());
    this.statusModal?.addEventListener('click', (e) => {
      if (e.target === this.statusModal) this.closeStatusModal();
    });

    this.statusPickUser1?.addEventListener('click', () => this.setStatusTargetUser('user1'));
    this.statusPickUser2?.addEventListener('click', () => this.setStatusTargetUser('user2'));

    document.querySelectorAll('.status-preset-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        // @ts-ignore
        const statusVal = chip.dataset.status || chip.textContent.trim();
        this.setPartnerStatus(this.statusTargetUser || this.currentUserKey, statusVal);
        this.closeStatusModal();
      });
    });

    this.customStatusForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = this.customStatusInput ? this.customStatusInput.value.trim() : '';
      this.setPartnerStatus(this.statusTargetUser || this.currentUserKey, val);
      this.closeStatusModal();
    });

    this.clearStatusBtn?.addEventListener('click', () => {
      this.setPartnerStatus(this.statusTargetUser || this.currentUserKey, '');
      this.closeStatusModal();
    });

    // Toggle Notes button in Quick Add
    this.toggleNotesBtn?.addEventListener('click', () => {
      this.notesExpandable.classList.toggle('hidden');
      this.toggleNotesBtn.textContent = this.notesExpandable.classList.contains('hidden') ? '+ Notes / Checklist' : '- Hide Notes';
    });

    // Add Task Submit
    this.addTaskForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleAddTask();
    });

    // Filter pills
    this.filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        this.filterPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.currentFilter = pill.dataset.filter;
        this.renderTasks();
      });
    });

    // Search & Category filters
    this.taskSearchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.renderTasks();
    });

    this.filterCategorySelect?.addEventListener('change', (e) => {
      this.filterCategory = e.target.value;
      this.renderTasks();
    });

    this.hideCompletedCheck?.addEventListener('change', (e) => {
      this.hideCompleted = e.target.checked;
      this.renderTasks();
    });

    // Date Filter
    const dateFilterInput = document.getElementById('taskDateFilterInput');
    const clearDateBtn = document.getElementById('clearDateFilterBtn');

    dateFilterInput?.addEventListener('change', (e) => {
      this.filterDate = e.target.value;
      if (clearDateBtn) clearDateBtn.classList.toggle('hidden', !this.filterDate);
      this.renderTasks();
    });

    clearDateBtn?.addEventListener('click', () => {
      this.filterDate = null;
      if (dateFilterInput) dateFilterInput.value = '';
      if (clearDateBtn) clearDateBtn.classList.add('hidden');
      this.renderTasks();
    });

    // Clear completed
    this.clearCompletedBtn?.addEventListener('click', () => {
      if (confirm('Clear all completed tasks?')) {
        const completed = this.tasks.filter(t => t.is_completed);
        for (const t of completed) {
          this.deleteTask(t.id);
        }
      }
    });

    // Cheer button
    document.getElementById('cheerBtn')?.addEventListener('click', () => {
      const emojis = ['🙌', '🎉', '❤️', '🔥', '✨', '💪', '🍕'];
      const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
      this.sendCheer(randomEmoji, `${this.getCurrentUserName()} sent high-five cheer!`);
    });

    // Nudge alert banner actions
    this.nudgeActionDismissBtn?.addEventListener('click', () => {
      this.dismissNudgeAlertBanner();
    });

    this.nudgeActionDoneBtn?.addEventListener('click', () => {
      if (this.activeNudgeTaskId) {
        this.toggleTaskCompleted(this.activeNudgeTaskId, true);
        this.showToast('Marked task done! Great teamwork! 🎉');
      }
      this.dismissNudgeAlertBanner();
    });

    // Cheer celebration modal actions
    this.cheerDismissBtn?.addEventListener('click', () => {
      this.closeCheerCelebrationModal();
    });

    this.cheerReplyBtn?.addEventListener('click', () => {
      this.closeCheerCelebrationModal();
      this.sendCheer('🙌', `${this.getCurrentUserName()} sent a high-five back!`);
    });

    // Share & Connect modal
    document.getElementById('shareBtn')?.addEventListener('click', () => this.openShareModal());
    document.getElementById('closeShareModal')?.addEventListener('click', () => this.closeShareModal());
    document.getElementById('closeShareModalBtn')?.addEventListener('click', () => this.closeShareModal());
    document.getElementById('copyShareLinkBtn')?.addEventListener('click', () => this.copyShareLink());

    // Settings modal
    document.getElementById('settingsBtn')?.addEventListener('click', () => this.openSettingsModal());
    document.getElementById('closeSettingsModal')?.addEventListener('click', () => this.closeSettingsModal());
    document.getElementById('cancelSettingsBtn')?.addEventListener('click', () => this.closeSettingsModal());
    document.getElementById('settingsForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSaveSettings();
    });

    document.getElementById('switchRoomBtn')?.addEventListener('click', () => {
      const newRoom = document.getElementById('settingsRoomId').value.trim();
      if (newRoom && newRoom !== this.roomId) {
        this.switchRoom(newRoom);
      }
    });

    // Desktop join notification toggle
    this.ensureNotificationSettingUI();
    document.getElementById('cfgNotifyPartnerJoin')?.addEventListener('change', (e) => {
      this.handleTogglePartnerJoinNotify(e.target.checked);
    });

    // PIN lock form & PIN settings
    this.savePinBtn?.addEventListener('click', () => this.updateRoomPin());
    this.pinUnlockForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.unlockWithPin();
    });

    // Data Export
    this.exportJsonBtn?.addEventListener('click', () => this.downloadExport('json'));
    this.exportMarkdownBtn?.addEventListener('click', () => this.downloadExport('markdown'));

    // Edit Modal close
    document.getElementById('closeEditModal')?.addEventListener('click', () => this.closeEditModal());
    document.getElementById('cancelEditModalBtn')?.addEventListener('click', () => this.closeEditModal());
    document.getElementById('editTaskForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSaveEditedTask();
    });
    document.getElementById('deleteTaskInModalBtn')?.addEventListener('click', () => {
      const id = document.getElementById('editTaskId').value;
      if (id && confirm('Delete this task?')) {
        this.deleteTask(id);
        this.closeEditModal();
      }
    });

    // Subtask add in modal
    document.getElementById('addSubtaskBtn')?.addEventListener('click', () => {
      const input = document.getElementById('newSubtaskInput');
      const text = input.value.trim();
      if (!text) return;
      this.appendSubtaskItemUI(text, false);
      input.value = '';
    });

    // Scratchpad auto-sync to SQLite database and SSE broadcast
    let scratchpadTimeout;
    this.scratchpadArea?.addEventListener('input', () => {
      this.userIsTypingScratchpad = true;
      this.scratchpadStatus.textContent = 'Saving to room...';
      clearTimeout(this.scratchpadTypingTimeout);
      this.scratchpadTypingTimeout = setTimeout(() => {
        this.userIsTypingScratchpad = false;
      }, 1500);

      clearTimeout(scratchpadTimeout);
      scratchpadTimeout = setTimeout(async () => {
        try {
          await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/scratchpad`, {
            method: 'PUT',
            body: JSON.stringify({
              content: this.scratchpadArea.value,
              updated_by: this.getCurrentUserName()
            })
          });
          this.scratchpadStatus.textContent = 'Synced with partner ☁️';
          localStorage.setItem(`duosync_scratch_${this.roomId}`, this.scratchpadArea.value);
        } catch (e) {
          this.scratchpadStatus.textContent = 'Saved locally';
        }
      }, 500);
    });

    // Chat room event listeners
    this.chatForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSendChatMessage();
    });

    this.chatTextInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSendChatMessage();
      }
    });

    this.chatTextInput?.addEventListener('input', () => {
      this.handleChatInput();
    });

    this.clearChatBtn?.addEventListener('click', () => {
      this.handleClearChat();
    });

    this.floatingChatBtn?.addEventListener('click', () => {
      this.switchTab('chat');
    });

    // Chat sound toggle button
    this.chatSoundToggleBtn?.addEventListener('click', () => {
      this.toggleChatSound();
    });

    // Window focus & visibility listeners to clear unread & stop title flashing when returning to chat
    window.addEventListener('focus', () => {
      if (this.currentTab === 'chat') {
        this.unreadChatCount = 0;
        this.updateUnreadChatBadge();
        this.stopTitleFlashing();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && document.hasFocus() && this.currentTab === 'chat') {
        this.unreadChatCount = 0;
        this.updateUnreadChatBadge();
        this.stopTitleFlashing();
      }
    });

    this.emojiChips.forEach(chip => {
      chip.addEventListener('click', () => {
        if (this.chatTextInput) {
          this.chatTextInput.value += chip.dataset.emoji;
          this.chatTextInput.focus();
          this.handleChatInput();
        }
      });
    });

    // Quick Phrases Chips
    document.querySelectorAll('.quick-phrase-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        // @ts-ignore
        const phrase = chip.dataset.phrase;
        if (this.chatTextInput && phrase) {
          this.chatTextInput.value = phrase;
          this.chatTextInput.focus();
          this.handleSendChatMessage();
        }
      });
    });

    // Quick Love / Hug button
    this.chatQuickLoveBtn?.addEventListener('click', () => {
      this.handleQuickLovePing();
    });

    // Emoji Drawer Focus button
    this.chatEmojiDrawerBtn?.addEventListener('click', () => {
      const scrollBar = document.querySelector('.quick-chips-scroll');
      if (scrollBar) {
        scrollBar.scrollTo({ left: 160, behavior: 'smooth' });
      }
      this.chatTextInput?.focus();
    });
  }

  switchTab(tabId) {
    this.currentTab = tabId;
    this.tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    this.tabContents.forEach(content => {
      content.classList.toggle('active', content.id === `tab-${tabId}`);
    });

    if (tabId === 'todos') {
      this.renderTasks();
    } else if (tabId === 'calendar') {
      this.calendar.renderCalendar();
      this.calendar.loadSelectedDayDetails();
    } else if (tabId === 'notes') {
      this.syncScratchpad();
    } else if (tabId === 'chat') {
      this.unreadChatCount = 0;
      this.updateUnreadChatBadge();
      this.stopTitleFlashing();
      this.hidePartnerTyping(); // Ensure typing indicator starts clean
      this.scrollChatToBottom();
      setTimeout(() => this.chatTextInput?.focus(), 60);
    }
  }

  getCurrentUserName() {
    return this.currentUserKey === 'user1' ? this.room.user1_name : this.room.user2_name;
  }

  getCurrentUserAvatar() {
    return this.currentUserKey === 'user1' ? this.room.user1_avatar : this.room.user2_avatar;
  }

  getPartnerUserName() {
    return this.currentUserKey === 'user1' ? this.room.user2_name : this.room.user1_name;
  }

  getPartnerAvatar() {
    return this.currentUserKey === 'user1' ? this.room.user2_avatar : this.room.user1_avatar;
  }

  switchUser(userKey) {
    this.currentUserKey = userKey;
    localStorage.setItem('duosync_user', userKey);
    this.setParam('user', userKey);
    this.updateUserUI();
    this.renderTasks();
    this.calendar.loadSelectedDayDetails();
    this.showToast(`Switched view to ${this.getCurrentUserName()}`);
    // Reconnect SSE with new identity
    this.initSSE();
  }

  switchRoom(newRoomId) {
    this.roomId = newRoomId.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    localStorage.setItem('duosync_room', this.roomId);
    this.setParam('room', this.roomId);
    window.location.reload();
  }

  updateUserUI() {
    this.user1Btn.classList.toggle('active', this.currentUserKey === 'user1');
    this.user2Btn.classList.toggle('active', this.currentUserKey === 'user2');

    this.navUser1Name.textContent = this.room.user1_name;
    this.navUser2Name.textContent = this.room.user2_name;
    this.navUser1Avatar.textContent = this.room.user1_avatar;
    this.navUser2Avatar.textContent = this.room.user2_avatar;

    this.currentRoomDisplay.textContent = this.roomId;
    this.partnerAvatarSmall.textContent = this.getPartnerAvatar();

    // Assignee dropdown labels
    const optUser1 = document.getElementById('assigneeOptionUser1');
    const optUser2 = document.getElementById('assigneeOptionUser2');
    if (optUser1) optUser1.textContent = `${this.room.user1_avatar} ${this.room.user1_name}`;
    if (optUser2) optUser2.textContent = `${this.room.user2_avatar} ${this.room.user2_name}`;

    const editOpt1 = document.getElementById('editAssigneeUser1');
    const editOpt2 = document.getElementById('editAssigneeUser2');
    if (editOpt1) editOpt1.textContent = `${this.room.user1_avatar} ${this.room.user1_name}`;
    if (editOpt2) editOpt2.textContent = `${this.room.user2_avatar} ${this.room.user2_name}`;

    // Daily check-in headers
    const checkin1 = document.getElementById('checkinUser1Name');
    const checkin2 = document.getElementById('checkinUser2Name');
    const checkinAvatar1 = document.getElementById('checkinUser1Avatar');
    const checkinAvatar2 = document.getElementById('checkinUser2Avatar');
    if (checkin1) checkin1.textContent = `${this.room.user1_name}'s Day Note`;
    if (checkin2) checkin2.textContent = `${this.room.user2_name}'s Day Note`;
    if (checkinAvatar1) checkinAvatar1.textContent = this.room.user1_avatar;
    if (checkinAvatar2) checkinAvatar2.textContent = this.room.user2_avatar;

    // Live Partner Status Bar updates
    const colAvatar1 = document.getElementById('statusColAvatar1');
    const colName1 = document.getElementById('statusColName1');
    const statusText1 = document.getElementById('statusText1');
    const bubble1 = document.getElementById('statusBubble1');
    const dot1 = bubble1?.querySelector('.status-badge-dot');

    const colAvatar2 = document.getElementById('statusColAvatar2');
    const colName2 = document.getElementById('statusColName2');
    const statusText2 = document.getElementById('statusText2');
    const bubble2 = document.getElementById('statusBubble2');
    const dot2 = bubble2?.querySelector('.status-badge-dot');

    const s1 = this.room.user1_status || '';
    const s2 = this.room.user2_status || '';

    if (colAvatar1) colAvatar1.textContent = this.room.user1_avatar;
    if (colName1) colName1.textContent = this.room.user1_name;
    if (statusText1) statusText1.textContent = s1 || 'Free / Available';
    if (dot1) dot1.className = `status-badge-dot ${s1 ? '' : 'empty'}`;

    if (colAvatar2) colAvatar2.textContent = this.room.user2_avatar;
    if (colName2) colName2.textContent = this.room.user2_name;
    if (statusText2) statusText2.textContent = s2 || 'Free / Available';
    if (dot2) dot2.className = `status-badge-dot ${s2 ? '' : 'empty'}`;

    // Nav pill mini status tags
    const navTag1 = document.getElementById('navUser1StatusTag');
    const navTag2 = document.getElementById('navUser2StatusTag');
    if (navTag1) {
      navTag1.textContent = s1;
      navTag1.classList.toggle('hidden', !s1);
    }
    if (navTag2) {
      navTag2.textContent = s2;
      navTag2.classList.toggle('hidden', !s2);
    }

    // Modal picker labels
    const pickAvatar1 = document.getElementById('statusPickAvatar1');
    const pickName1 = document.getElementById('statusPickName1');
    const pickAvatar2 = document.getElementById('statusPickAvatar2');
    const pickName2 = document.getElementById('statusPickName2');
    if (pickAvatar1) pickAvatar1.textContent = this.room.user1_avatar;
    if (pickName1) pickName1.textContent = this.room.user1_name;
    if (pickAvatar2) pickAvatar2.textContent = this.room.user2_avatar;
    if (pickName2) pickName2.textContent = this.room.user2_name;

    // Update settings modal inputs if present
    const cfgStatus1 = document.getElementById('cfgUser1Status');
    const cfgStatus2 = document.getElementById('cfgUser2Status');
    if (cfgStatus1 && document.activeElement !== cfgStatus1) cfgStatus1.value = s1;
    if (cfgStatus2 && document.activeElement !== cfgStatus2) cfgStatus2.value = s2;
  }

  // ================= API & Realtime SSE =================
  async api(endpoint, options = {}) {
    const defaultHeaders = { 'Content-Type': 'application/json' };
    const res = await fetch(endpoint, {
      ...options,
      headers: { ...defaultHeaders, ...(options.headers || {}) }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed with ${res.status}`);
    }
    return res.json();
  }

  async loadState() {
    try {
      const data = await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/state`);
      const local = this.getLocalSnapshot();
      let serverTasks = data.tasks || [];

      // Check if server database was wiped/empty (e.g. Render restart or ephemeral disk reset)
      if (serverTasks.length === 0 && local && Array.isArray(local.tasks) && local.tasks.length > 0) {
        console.warn('⚠️ Server database is empty. Auto-healing server from local vault...');
        this.showToast('✨ Restored saved tasks from device sync');

        try {
          await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/restore`, {
            method: 'POST',
            body: JSON.stringify({
              tasks: local.tasks,
              categories: local.categories,
              dailyLogs: local.dailyLogs,
              scratchpad: local.scratchpad,
              room: local.room,
              messages: local.messages
            })
          });
        } catch (restoreErr) {
          console.error('Failed to auto-restore server:', restoreErr);
        }

        this.tasks = local.tasks;
        this.room = local.room || data.room || this.room;
        this.categories = (local.categories && local.categories.length > 0) ? local.categories : (data.categories || []);
        this.messages = (local.messages && local.messages.length > 0) ? local.messages : (data.messages || []);
      } else {
        // Normal flow: server is active
        this.room = data.room || this.room;
        this.categories = data.categories || [];
        this.activities = data.activities || [];
        this.messages = data.messages || [];

        // Check if there are local tasks that never synced to server
        if (local && Array.isArray(local.tasks) && local.tasks.length > 0) {
          const serverTaskIds = new Set(serverTasks.map(t => t.id));
          const unsyncedTasks = local.tasks.filter(t => !serverTaskIds.has(t.id));
          if (unsyncedTasks.length > 0) {
            console.log(`Syncing ${unsyncedTasks.length} local tasks to server...`);
            this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/restore`, {
              method: 'POST',
              body: JSON.stringify({ tasks: unsyncedTasks })
            }).catch(e => console.warn('Unsynced push error:', e));
            serverTasks.push(...unsyncedTasks);
          }
        }

        this.tasks = serverTasks;
      }

      this.lastSyncTime = Date.now();
      this.saveLocalSnapshot();

      // Update room colors in CSS
      document.documentElement.style.setProperty('--partner1-color', this.room.user1_color);
      document.documentElement.style.setProperty('--partner2-color', this.room.user2_color);

      this.updateUserUI();
      this.updateChatHeader();
      this.renderCategoryOptions();
      this.renderTasks();
      this.renderActivities();
      this.renderChatMessages();

      // Load scratchpad from database or local fallback
      if (data.scratchpad !== undefined && this.scratchpadArea) {
        this.scratchpadArea.value = data.scratchpad;
      } else {
        const savedScratch = localStorage.getItem(`duosync_scratch_${this.roomId}`);
        if (savedScratch && this.scratchpadArea) {
          this.scratchpadArea.value = savedScratch;
        }
      }

      this.updatePinStatusUI();
    } catch (err) {
      console.warn('Error loading initial state:', err);
      // Offline fallback: load from local snapshot
      const local = this.getLocalSnapshot();
      if (local && Array.isArray(local.tasks)) {
        this.tasks = local.tasks;
        this.renderTasks();
      }
      this.showToast('Could not reach server. Working with saved device tasks.');
    }
  }

  initWatchdogs() {
    // 1. Heartbeat watchdog: detect dropped connections and auto-reconnect
    setInterval(() => {
      const stalled = Date.now() - this.lastHeartbeat > 25000;
      const closed = !this.eventSource || this.eventSource.readyState === EventSource.CLOSED;
      if (stalled || closed) {
        this.initSSE();
      }
    }, 10000);

    // 2. High-reliability background sync every 6 seconds as a guaranteed safety net
    setInterval(() => {
      this.syncState(false);
    }, 6000);

    // 3. Tab visibility & focus recovery (e.g. mobile lock screen, tab switching)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const closed = !this.eventSource || this.eventSource.readyState === EventSource.CLOSED;
        if (closed) this.initSSE();
        this.syncState(true);
      }
    });

    window.addEventListener('online', () => {
      this.initSSE();
      this.syncState(true);
    });

    window.addEventListener('focus', () => {
      this.syncState(false);
    });
  }

  async syncState(force = false) {
    if (!this.roomId) return;
    try {
      const sinceParam = force ? 0 : this.lastSyncTime;
      const data = await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/sync?since=${sinceParam}`);
      this.lastSyncTime = data.serverTime || Date.now();

      // Sync tasks if changed
      if (data.tasks) {
        // Guard against server wiping tasks when local client has tasks:
        if (data.tasks.length === 0 && this.tasks.length > 0) {
          console.warn('⚠️ Server returned 0 tasks during sync. Auto-restoring server database...');
          this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/restore`, {
            method: 'POST',
            body: JSON.stringify({
              tasks: this.tasks,
              scratchpad: this.scratchpadArea ? this.scratchpadArea.value : '',
              room: this.room
            })
          }).catch(() => {});
          return;
        }

        const currentFingerprint = this.tasks.map(t => `${t.id}_${t.is_completed}_${t.sort_order}_${t.title}_${t.priority}`).join('|');
        const incomingFingerprint = data.tasks.map(t => `${t.id}_${t.is_completed}_${t.sort_order}_${t.title}_${t.priority}`).join('|');
        if (currentFingerprint !== incomingFingerprint) {
          this.tasks = data.tasks;
          this.renderTasks();
          this.saveLocalSnapshot();
          if (this.calendar) {
            this.calendar.renderCalendar();
            this.calendar.loadSelectedDayDetails();
          }
        }
      }

      // Sync scratchpad if user is not actively typing
      if (data.scratchpad !== undefined && this.scratchpadArea && !this.userIsTypingScratchpad) {
        if (this.scratchpadArea.value !== data.scratchpad) {
          const wasFocused = document.activeElement === this.scratchpadArea;
          const prevStart = this.scratchpadArea.selectionStart;
          const prevEnd = this.scratchpadArea.selectionEnd;
          this.scratchpadArea.value = data.scratchpad;
          if (wasFocused) {
            this.scratchpadArea.setSelectionRange(prevStart, prevEnd);
          }
          this.scratchpadStatus.textContent = 'Synced with partner ☁️';
          localStorage.setItem(`duosync_scratch_${this.roomId}`, data.scratchpad);
        }
      }

      // Sync chat messages
      if (data.messages && data.messages.length > 0) {
        let hasNewMessages = false;
        for (const msg of data.messages) {
          if (!this.messages.some(m => m.id === msg.id)) {
            this.messages.push(msg);
            this.appendChatMessageUI(msg);
            hasNewMessages = true;
            if (this.currentTab !== 'chat') {
              this.unreadChatCount++;
            }
          }
        }
        if (hasNewMessages) {
          this.updateUnreadChatBadge();
          if (this.currentTab === 'chat') {
            this.scrollChatToBottom();
          }
        }
      }

      // Sync room & live partner statuses if updated
      if (data.room) {
        if (this.room.user1_status !== data.room.user1_status ||
            this.room.user2_status !== data.room.user2_status ||
            this.room.user1_name !== data.room.user1_name ||
            this.room.user2_name !== data.room.user2_name ||
            this.room.user1_avatar !== data.room.user1_avatar ||
            this.room.user2_avatar !== data.room.user2_avatar) {
          this.room = { ...this.room, ...data.room };
          this.updateUserUI();
          this.updateChatHeader();
          this.saveLocalSnapshot();
        }
      }

      if (data.onlineUsers) {
        this.updatePresenceUI(data.onlineUsers);
      }
    } catch (err) {
      // Quiet background blip
    }
  }

  async syncScratchpad() {
    if (!this.scratchpadArea || this.userIsTypingScratchpad) return;
    try {
      const data = await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/sync?since=0`);
      if (data.scratchpad !== undefined && !this.userIsTypingScratchpad) {
        this.scratchpadArea.value = data.scratchpad;
        this.scratchpadStatus.textContent = 'Synced with partner ☁️';
        localStorage.setItem(`duosync_scratch_${this.roomId}`, data.scratchpad);
      }
    } catch (e) {}
  }

  initSSE() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    const sseUrl = `/api/rooms/${encodeURIComponent(this.roomId)}/events?userId=${this.currentUserKey}&userName=${encodeURIComponent(this.getCurrentUserName())}`;
    this.eventSource = new EventSource(sseUrl);

    this.eventSource.onopen = () => {
      this.isOnline = true;
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.statusDot.className = 'status-dot online';
      this.statusText.textContent = 'Connected (Sync Active)';
      // Trigger instant background sync to catch any changes during reconnection
      this.syncState(true);
    };

    this.eventSource.onerror = () => {
      this.isOnline = false;
      this.statusDot.className = 'status-dot offline';
      this.statusText.textContent = 'Reconnecting...';

      if (this.eventSource && this.eventSource.readyState === EventSource.CLOSED) {
        this.eventSource.close();
        clearTimeout(this.reconnectTimeout);
        const delay = Math.min(1000 * Math.pow(1.4, this.reconnectAttempts++), 8000);
        this.reconnectTimeout = setTimeout(() => this.initSSE(), delay);
      }
    };

    this.eventSource.onmessage = () => {
      this.lastHeartbeat = Date.now();
    };

    // 1. Presence
    this.eventSource.addEventListener('presence', (e) => {
      this.lastHeartbeat = Date.now();
      const data = JSON.parse(e.data);
      const otherUserKey = this.currentUserKey === 'user1' ? 'user2' : 'user1';
      if (data.onlineUsers) {
        this.updatePresenceUI(data.onlineUsers);
      }
      if (data.type === 'user_joined' && data.userId === otherUserKey) {
        this.showToast(`${this.getPartnerUserName()} joined your space! 👋`);
        if (this.isPartnerJoinNotifyEnabled()) {
          this.sendDesktopNotification(
            `${this.getPartnerUserName()} joined DuoSync! 👋`,
            `${this.getPartnerUserName()} just joined the space. Say what's up!`
          );
        }
      }
    });

    // 2. Tasks: Created
    this.eventSource.addEventListener('task_created', (e) => {
      this.lastHeartbeat = Date.now();
      const task = JSON.parse(e.data);
      if (!this.tasks.some(t => t.id === task.id)) {
        this.tasks.unshift(task);
        this.renderTasks();
        this.saveLocalSnapshot();
        if (this.calendar) {
          this.calendar.renderCalendar();
          this.calendar.loadSelectedDayDetails();
        }
        if (task.created_by !== this.getCurrentUserName()) {
          this.showToast(`✨ ${task.created_by} added: ${task.title}`);
          this.showNativeNotification(`New Task Added ✨`, {
            body: `${task.created_by}: ${task.title}`,
            icon: 'icon-192.png'
          });
        }
      }
    });

    // 3. Tasks: Updated
    this.eventSource.addEventListener('task_updated', (e) => {
      this.lastHeartbeat = Date.now();
      const task = JSON.parse(e.data);
      const idx = this.tasks.findIndex(t => t.id === task.id);
      if (idx !== -1) {
        const wasCompleted = this.tasks[idx].is_completed;
        this.tasks[idx] = task;
        this.renderTasks();
        this.saveLocalSnapshot();
        if (this.calendar) {
          this.calendar.renderCalendar();
          this.calendar.loadSelectedDayDetails();
        }

        if (!wasCompleted && task.is_completed && task.completed_by !== this.getCurrentUserName()) {
          this.playChime('success');
          this.triggerConfetti();
          this.showToast(`🎉 ${task.completed_by} completed: ${task.title}!`);
          this.showNativeNotification(`Task Completed 🎉`, {
            body: `${task.completed_by} completed: ${task.title}`,
            icon: 'icon-192.png'
          });
        }
      } else {
        // If not in local array, add it
        this.tasks.unshift(task);
        this.renderTasks();
        this.saveLocalSnapshot();
      }
    });

    // 4. Tasks: Deleted
    this.eventSource.addEventListener('task_deleted', (e) => {
      this.lastHeartbeat = Date.now();
      const data = JSON.parse(e.data);
      this.tasks = this.tasks.filter(t => t.id !== data.id);
      this.renderTasks();
      this.saveLocalSnapshot();
      if (this.calendar) {
        this.calendar.renderCalendar();
        this.calendar.loadSelectedDayDetails();
      }
    });

    // 4b. State Restored Event (Auto-Heal from Partner)
    this.eventSource.addEventListener('state_restored', (e) => {
      this.lastHeartbeat = Date.now();
      this.syncState(true);
    });

    // 5. Shared Scratchpad Live Update
    this.eventSource.addEventListener('scratchpad_updated', (e) => {
      this.lastHeartbeat = Date.now();
      const data = JSON.parse(e.data);
      if (this.scratchpadArea) {
        if (!this.userIsTypingScratchpad) {
          const wasFocused = document.activeElement === this.scratchpadArea;
          const prevStart = this.scratchpadArea.selectionStart;
          const prevEnd = this.scratchpadArea.selectionEnd;
          this.scratchpadArea.value = data.content || '';
          if (wasFocused) {
            this.scratchpadArea.setSelectionRange(prevStart, prevEnd);
          }
          this.scratchpadStatus.textContent = 'Synced with partner ☁️';
          localStorage.setItem(`duosync_scratch_${this.roomId}`, data.content || '');
        }
      }
    });

    // 6. Duo Chat: New Message
    this.eventSource.addEventListener('chat_message', (e) => {
      this.lastHeartbeat = Date.now();
      const msg = JSON.parse(e.data);
      if (!this.messages.some(m => m.id === msg.id)) {
        this.messages.push(msg);
        this.appendChatMessageUI(msg);

        const isFromMe = msg.sender_id === this.currentUserKey ||
                         (msg.sender_name && msg.sender_name === this.getCurrentUserName() && !msg.sender_id);
        const isFromPartner = !isFromMe;
        const isDiffSection = this.currentTab !== 'chat';
        const isDiffApp = document.hidden || !document.hasFocus();

        if (isFromPartner) {
          this.hidePartnerTyping();
          if (isDiffSection || isDiffApp) {
            // User is in a different section OR in another app/tab!
            this.unreadChatCount++;
            this.updateUnreadChatBadge();
            // Audibly alert the user with the chime sound
            this.playChime('message');
            this.showToast(`💬 ${msg.sender_name}: ${msg.text}`, () => this.switchTab('chat'));
            this.showNativeNotification(`💬 Message from ${msg.sender_name}`, {
              body: msg.text,
              icon: 'icon-192.png'
            });
            this.startTitleFlashing(`(1) 💬 ${msg.sender_name}: ${msg.text.substring(0, 30)}`);
          } else {
            // User is actively looking at the chat tab in foreground
            this.playChime('message_soft');
            this.scrollChatToBottom();
          }
        } else {
          this.scrollChatToBottom();
        }
      }
    });

    // 7. Duo Chat: Partner Typing
    this.eventSource.addEventListener('partner_typing', (e) => {
      this.lastHeartbeat = Date.now();
      const data = JSON.parse(e.data);
      const otherUserKey = this.currentUserKey === 'user1' ? 'user2' : 'user1';
      if (data.userId === otherUserKey) {
        if (data.isTyping) {
          this.showPartnerTyping(data.userAvatar, `${data.userName} is typing...`);
        } else {
          this.hidePartnerTyping();
        }
      }
    });

    // 8. Duo Chat: Cleared
    this.eventSource.addEventListener('chat_cleared', (e) => {
      this.lastHeartbeat = Date.now();
      const data = JSON.parse(e.data);
      this.messages = [];
      this.renderChatMessages();
      this.showToast(`Chat history was cleared by ${data.by || 'Partner'}`);
    });

    // 9. Partner Nudge
    this.eventSource.addEventListener('nudge', (e) => {
      this.lastHeartbeat = Date.now();
      const data = JSON.parse(e.data);
      if (data.actionId && this.mySentActionIds.has(data.actionId)) {
        return;
      }
      if (data.fromUserId && data.fromUserId === this.currentUserKey && !data.actionId) {
        return;
      }

      this.playChime('nudge');
      this.showToast(`🔔 ${data.from || 'Partner'} sent a friendly reminder for "${data.taskTitle}"!`);
      this.showNativeNotification(`Friendly Reminder from ${data.from || 'Partner'} 🔔`, {
        body: `Reminder for: ${data.taskTitle}`,
        icon: 'icon-192.png'
      });
      this.showNudgeAlertBanner(data);
    });

    // 10. Room Settings Updated
    this.eventSource.addEventListener('room_updated', (e) => {
      this.lastHeartbeat = Date.now();
      const updatedRoom = JSON.parse(e.data);
      this.room = updatedRoom;
      document.documentElement.style.setProperty('--partner1-color', this.room.user1_color);
      document.documentElement.style.setProperty('--partner2-color', this.room.user2_color);
      this.updateUserUI();
      this.updateChatHeader();
      this.renderTasks();
      this.updatePinStatusUI();
      if (this.room.has_pin) {
        this.checkPinProtection();
      }
    });

    // 10b. Partner Live Status Updated
    this.eventSource.addEventListener('status_updated', (e) => {
      this.lastHeartbeat = Date.now();
      const data = JSON.parse(e.data);
      if (data.room) {
        this.room = data.room;
      } else {
        if (data.userId === 'user1') {
          this.room.user1_status = data.status || '';
        } else if (data.userId === 'user2') {
          this.room.user2_status = data.status || '';
        }
      }
      this.updateUserUI();
      this.updateChatHeader();
      this.saveLocalSnapshot();

      const otherUserKey = this.currentUserKey === 'user1' ? 'user2' : 'user1';
      if (data.userId === otherUserKey) {
        const partnerName = this.getPartnerUserName();
        if (data.status) {
          this.showToast(`📌 ${partnerName} is now: ${data.status}`);
          this.showNativeNotification(`📌 ${partnerName} Status Update`, {
            body: `${partnerName} is now: ${data.status}`,
            icon: 'icon-192.png'
          });
        } else {
          this.showToast(`📌 ${partnerName} cleared their status.`);
        }
      }
    });

    // 11. Daily Log / Calendar Notes
    this.eventSource.addEventListener('daily_log_updated', (e) => {
      this.lastHeartbeat = Date.now();
      const log = JSON.parse(e.data);
      if (this.calendar && log.date === this.calendar.selectedDateStr) {
        this.calendar.loadSelectedDayDetails();
      }
      if (this.calendar) {
        this.calendar.renderCalendar();
      }
    });

    // 12. Cheers
    this.eventSource.addEventListener('cheer', (e) => {
      this.lastHeartbeat = Date.now();
      const data = JSON.parse(e.data);
      if (data.actionId && this.mySentActionIds.has(data.actionId)) {
        return;
      }
      if (data.fromUserId && data.fromUserId === this.currentUserKey && !data.actionId) {
        return;
      }

      this.playChime('cheer');
      this.triggerFloatingEmoji(data.emoji || '🎉');
      this.showToast(`${data.from || 'Partner'}: ${data.message || 'Cheered you on!'} ${data.emoji || '🎉'}`);
      this.showCheerCelebrationModal(data);
    });

    // 13. Activity Log Feed
    this.eventSource.addEventListener('activity', (e) => {
      this.lastHeartbeat = Date.now();
      const act = JSON.parse(e.data);
      this.activities.unshift(act);
      this.renderActivities();
    });
  }

  // ================= CHAT ROOM METHODS =================
  updateChatHeader() {
    if (this.chatPartnerAvatar) {
      this.chatPartnerAvatar.textContent = this.getPartnerAvatar();
    }
    if (this.chatPartnerName) {
      this.chatPartnerName.textContent = this.getPartnerUserName();
    }
    const partnerStatus = this.currentUserKey === 'user1' ? (this.room.user2_status || '') : (this.room.user1_status || '');
    if (this.chatPartnerStatusText) {
      const isOnline = this.chatPartnerStatusDot?.classList.contains('online');
      if (partnerStatus) {
        this.chatPartnerStatusText.textContent = isOnline ? `online • ${partnerStatus} 🟢` : `offline (${partnerStatus})`;
      } else {
        this.chatPartnerStatusText.textContent = isOnline ? 'online 🟢' : 'offline';
      }
    }
  }

  updatePresenceUI(onlineUsers) {
    const otherUserKey = this.currentUserKey === 'user1' ? 'user2' : 'user1';
    const partnerOnline = onlineUsers && onlineUsers.includes(otherUserKey);
    const partnerStatus = this.currentUserKey === 'user1' ? (this.room.user2_status || '') : (this.room.user1_status || '');
    const statusPart = partnerStatus ? ` • ${partnerStatus}` : '';

    if (this.statusDot && this.statusText) {
      if (partnerOnline) {
        this.statusDot.className = 'status-dot online';
        this.statusText.textContent = `${this.getPartnerUserName()} online${statusPart} 🟢`;
      } else {
        this.statusDot.className = 'status-dot';
        this.statusText.textContent = partnerStatus ? `${this.getPartnerUserName()}: ${partnerStatus}` : `Sync Active (Partner away)`;
      }
    }

    if (this.chatPartnerStatusDot && this.chatPartnerStatusText) {
      if (partnerOnline) {
        this.chatPartnerStatusDot.className = 'status-dot online';
        this.chatPartnerStatusText.textContent = `online${statusPart} 🟢`;
      } else {
        this.chatPartnerStatusDot.className = 'status-dot offline';
        this.chatPartnerStatusText.textContent = partnerStatus ? `offline (${partnerStatus})` : 'offline';
      }
    }

    if (this.chatPartnerOnlineBadge) {
      this.chatPartnerOnlineBadge.className = `chat-online-badge ${partnerOnline ? 'online' : 'offline'}`;
    }
  }

  renderChatMessages() {
    if (!this.chatMessagesList) return;
    this.chatMessagesList.innerHTML = '';

    if (!this.messages || this.messages.length === 0) {
      this.chatMessagesList.innerHTML = `
        <div class="chat-empty-state">
          <div class="chat-empty-icon">💬</div>
          <h4>Your Private Duo Chat</h4>
          <p>Say hello to ${this.getPartnerUserName()}! Messages sync in real-time between both of you.</p>
        </div>
      `;
      return;
    }

    for (const msg of this.messages) {
      this.appendChatMessageUI(msg, false);
    }
    this.scrollChatToBottom();
  }

  appendChatMessageUI(msg, autoScroll = true) {
    if (!this.chatMessagesList) return;

    // Remove empty state if present
    const emptyState = this.chatMessagesList.querySelector('.chat-empty-state');
    if (emptyState) emptyState.remove();

    const isMe = msg.sender_id === this.currentUserKey || msg.sender_name === this.getCurrentUserName();
    const row = document.createElement('div');
    row.className = `chat-msg-row ${isMe ? 'me' : 'partner'}`;
    row.dataset.id = msg.id;

    const timeStr = this.formatChatTime(msg.created_at);

    row.innerHTML = `
      <div class="chat-msg-avatar">${msg.sender_avatar || (isMe ? (this.currentUserKey === 'user1' ? this.room.user1_avatar : this.room.user2_avatar) : this.getPartnerAvatar())}</div>
      <div class="chat-msg-content">
        <span class="chat-msg-sender">${isMe ? 'You' : this.escapeHtml(msg.sender_name)}</span>
        <div class="chat-msg-bubble">${this.escapeHtml(msg.text)}</div>
        <div class="chat-msg-footer">
          <span class="chat-msg-time">${timeStr}</span>
          ${isMe ? '<span class="chat-msg-status-tick" title="Delivered to duo space">✓✓</span>' : ''}
        </div>
      </div>
    `;

    this.chatMessagesList.appendChild(row);
    if (autoScroll) {
      this.scrollChatToBottom();
    }
  }

  formatChatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return time;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
  }

  scrollChatToBottom() {
    if (this.chatMessagesContainer) {
      requestAnimationFrame(() => {
        this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
      });
    }
  }

  async handleSendChatMessage() {
    if (!this.chatTextInput) return;
    const text = this.chatTextInput.value.trim();
    if (!text) return;

    this.chatTextInput.value = '';
    this.userIsTypingChat = false;
    clearTimeout(this.chatTypingDebounce);
    this.sendTypingIndicator(false);

    const payload = {
      sender_id: this.currentUserKey,
      sender_name: this.getCurrentUserName(),
      sender_avatar: this.currentUserKey === 'user1' ? this.room.user1_avatar : this.room.user2_avatar,
      text
    };

    try {
      const res = await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/messages`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (res.message && !this.messages.some(m => m.id === res.message.id)) {
        this.messages.push(res.message);
        this.appendChatMessageUI(res.message);
        this.saveLocalSnapshot();
      }
    } catch (err) {
      this.showToast('Failed to send message: ' + err.message);
    }
  }

  handleChatInput() {
    const val = this.chatTextInput ? this.chatTextInput.value.trim() : '';
    if (val.length > 0) {
      if (!this.userIsTypingChat) {
        this.userIsTypingChat = true;
        this.sendTypingIndicator(true);
      }
      clearTimeout(this.chatTypingDebounce);
      this.chatTypingDebounce = setTimeout(() => {
        this.userIsTypingChat = false;
        this.sendTypingIndicator(false);
      }, 2500);
    } else {
      if (this.userIsTypingChat) {
        this.userIsTypingChat = false;
        clearTimeout(this.chatTypingDebounce);
        this.sendTypingIndicator(false);
      }
    }
  }

  async sendTypingIndicator(isTyping) {
    try {
      await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/typing`, {
        method: 'POST',
        body: JSON.stringify({
          userId: this.currentUserKey,
          userName: this.getCurrentUserName(),
          userAvatar: this.currentUserKey === 'user1' ? this.room.user1_avatar : this.room.user2_avatar,
          isTyping
        })
      });
    } catch (e) {}
  }

  showPartnerTyping(avatar, text) {
    if (!this.chatTypingIndicator) return;
    if (this.typingPartnerAvatar) this.typingPartnerAvatar.textContent = avatar || this.getPartnerAvatar();
    if (this.typingPartnerText) this.typingPartnerText.textContent = text || `${this.getPartnerUserName()} is typing...`;
    this.chatTypingIndicator.classList.remove('hidden');
    this.scrollChatToBottom();

    clearTimeout(this.partnerTypingTimeout);
    this.partnerTypingTimeout = setTimeout(() => {
      this.hidePartnerTyping();
    }, 2800);
  }

  hidePartnerTyping() {
    if (this.chatTypingIndicator) {
      this.chatTypingIndicator.classList.add('hidden');
    }
  }

  async handleQuickLovePing() {
    this.playChime('cheer');
    this.triggerConfetti();
    this.showToast(`Sent 👊 Fist Bump to ${this.getPartnerUserName()}!`);

    // Broadcast cheer
    try {
      await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/cheer`, {
        method: 'POST',
        body: JSON.stringify({
          emoji: '👊',
          fromUserId: this.currentUserKey,
          fromName: this.getCurrentUserName(),
          fromAvatar: this.getCurrentUserAvatar()
        })
      });
    } catch(e) {}

    // Auto-post cool fist bump into chat
    const friendMessages = [
      "Fist bump! 👊 Let's crush our goals!",
      "Yo! What's up bro? 🙌",
      "Let's grind! Keep it up! 🔥",
      "Quick check-in! Let's get this done! ⚡"
    ];
    const randomMsg = friendMessages[Math.floor(Math.random() * friendMessages.length)];
    if (this.chatTextInput) {
      this.chatTextInput.value = randomMsg;
      this.handleSendChatMessage();
    }
  }

  updateUnreadChatBadge() {
    if (this.unreadChatBadge) {
      if (this.unreadChatCount > 0) {
        this.unreadChatBadge.textContent = this.unreadChatCount;
        this.unreadChatBadge.classList.remove('hidden');
      } else {
        this.unreadChatBadge.classList.add('hidden');
      }
    }
    if (this.floatingChatBadge) {
      if (this.unreadChatCount > 0) {
        this.floatingChatBadge.textContent = this.unreadChatCount;
        this.floatingChatBadge.classList.remove('hidden');
      } else {
        this.floatingChatBadge.classList.add('hidden');
      }
    }
  }

  async handleClearChat() {
    if (!confirm('Are you sure you want to clear chat history for both users?')) return;
    try {
      await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/messages?user=${encodeURIComponent(this.getCurrentUserName())}`, {
        method: 'DELETE'
      });
      this.messages = [];
      this.renderChatMessages();
      this.showToast('Chat history cleared');
    } catch (err) {
      alert('Failed to clear chat: ' + err.message);
    }
  }

  // ================= TASK MANAGEMENT =================
  async handleAddTask() {
    const title = this.taskTitleInput.value.trim();
    if (!title) return;

    const payload = {
      title,
      notes: this.taskNotesInput.value.trim(),
      category: this.taskCategory.value,
      priority: this.taskPriority.value,
      assigned_to: this.taskAssignee.value,
      due_date: this.taskDueDate.value || (this.calendar ? this.calendar.formatDate(new Date()) : new Date().toISOString().split('T')[0]),
      recurring: this.taskRecurring ? this.taskRecurring.value : 'none',
      created_by: this.getCurrentUserName()
    };

    // Reset input fields
    this.taskTitleInput.value = '';
    this.taskNotesInput.value = '';
    if (this.taskRecurring) this.taskRecurring.value = 'none';
    this.notesExpandable.classList.add('hidden');
    this.toggleNotesBtn.textContent = '+ Notes / Checklist';

    try {
      const res = await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/tasks`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (res.task && !this.tasks.some(t => t.id === res.task.id)) {
        this.tasks.unshift(res.task);
        this.renderTasks();
        this.calendar.renderCalendar();
      }
      this.playChime('success');
      this.showToast('Task added!');
    } catch (err) {
      alert('Failed to add task: ' + err.message);
    }
  }

  async toggleTaskCompleted(taskId, isChecked, userKey = null) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;

    const actionUserKey = userKey || this.currentUserKey; // 'user1' or 'user2'
    const isShared = !task.assigned_to || task.assigned_to === 'both';

    if (isShared) {
      if (actionUserKey === 'user1') {
        task.user1_done = isChecked ? 1 : 0;
      } else {
        task.user2_done = isChecked ? 1 : 0;
      }

      const bothDone = (task.user1_done === 1) && (task.user2_done === 1);
      task.is_completed = bothDone ? 1 : 0;

      if (bothDone) {
        task.completed_by = 'Both';
        task.completed_at = Date.now();
        this.playChime('success');
        this.triggerConfetti();
        this.showToast('🎉 Both of you completed the task!');
      } else {
        task.completed_at = null;
        if (isChecked) {
          this.playChime('success');
          const partnerName = actionUserKey === 'user1' ? this.room.user2_name : this.room.user1_name;
          this.showToast(`✓ Marked done by you! Waiting for ${partnerName} to complete.`);
        } else {
          this.showToast('Marked as incomplete for you.');
        }
      }
    } else {
      task.is_completed = isChecked ? 1 : 0;
      if (task.assigned_to === 'user1') task.user1_done = isChecked ? 1 : 0;
      if (task.assigned_to === 'user2') task.user2_done = isChecked ? 1 : 0;
      task.completed_by = isChecked ? this.getCurrentUserName() : null;
      task.completed_at = isChecked ? Date.now() : null;

      if (isChecked) {
        this.playChime('success');
        this.triggerConfetti();
        this.showToast('Task completed! 🎉');
      }
    }

    this.renderTasks();
    this.saveLocalSnapshot();
    if (this.calendar) {
      this.calendar.renderCalendar();
      this.calendar.loadSelectedDayDetails();
      this.calendar.updateStreak();
    }

    try {
      const res = await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          user_action: actionUserKey,
          is_checked: isChecked,
          user1_done: task.user1_done,
          user2_done: task.user2_done,
          updated_by: this.getCurrentUserName()
        })
      });

      if (res && res.spawnedTask && !this.tasks.some(t => t.id === res.spawnedTask.id)) {
        this.tasks.unshift(res.spawnedTask);
        this.renderTasks();
        this.saveLocalSnapshot();
        if (this.calendar) {
          this.calendar.renderCalendar();
          this.calendar.loadSelectedDayDetails();
        }
        this.showToast(`🔁 Next recurring task scheduled for ${res.spawnedTask.due_date}!`);
      }
    } catch (err) {
      console.error('Error toggling task:', err);
    }
  }

  async deleteTask(taskId) {
    const idx = this.tasks.findIndex(t => t.id === taskId);
    if (idx !== -1) {
      this.tasks.splice(idx, 1);
      this.renderTasks();
      this.calendar.renderCalendar();
      this.calendar.loadSelectedDayDetails();
    }

    try {
      await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/tasks/${encodeURIComponent(taskId)}?user=${encodeURIComponent(this.getCurrentUserName())}`, {
        method: 'DELETE'
      });
    } catch (err) {
      console.error('Error deleting task:', err);
    }
  }

  openEditModal(task) {
    document.getElementById('editTaskId').value = task.id;
    document.getElementById('editTaskTitle').value = task.title;
    document.getElementById('editTaskNotes').value = task.notes || '';
    document.getElementById('editTaskAssignee').value = task.assigned_to || 'both';
    document.getElementById('editTaskDueDate').value = task.due_date || '';
    document.getElementById('editTaskCategory').value = task.category || 'General';
    document.getElementById('editTaskPriority').value = task.priority || 'normal';

    const recurSel = document.getElementById('editTaskRecurring');
    if (recurSel) recurSel.value = task.recurring || 'none';

    const list = document.getElementById('editSubtasksList');
    list.innerHTML = '';
    (task.subtasks || []).forEach(st => {
      this.appendSubtaskItemUI(st.text, st.completed, st.id);
    });

    this.taskEditModal.classList.remove('hidden');
  }

  closeEditModal() {
    this.taskEditModal.classList.add('hidden');
  }

  appendSubtaskItemUI(text, isChecked = false, id = null) {
    const list = document.getElementById('editSubtasksList');
    const row = document.createElement('div');
    row.className = 'edit-subtask-row';
    const subId = id || 'st_' + Math.random().toString(36).substr(2, 6);

    row.innerHTML = `
      <input type="checkbox" ${isChecked ? 'checked' : ''} class="subtask-checkbox" data-id="${subId}">
      <input type="text" value="${this.escapeHtml(text)}" class="input-text">
      <button type="button" class="task-action-btn delete" style="padding: 0.2rem 0.4rem;">&times;</button>
    `;

    row.querySelector('.delete').addEventListener('click', () => row.remove());
    list.appendChild(row);
  }

  async handleSaveEditedTask() {
    const taskId = document.getElementById('editTaskId').value;
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;

    // Collect subtasks
    const subtaskRows = document.querySelectorAll('#editSubtasksList .edit-subtask-row');
    const subtasks = [];
    subtaskRows.forEach(row => {
      const chk = row.querySelector('.subtask-checkbox');
      const txt = row.querySelector('input[type="text"]').value.trim();
      if (txt) {
        subtasks.push({
          id: chk.dataset.id,
          text: txt,
          completed: chk.checked
        });
      }
    });

    const payload = {
      title: document.getElementById('editTaskTitle').value.trim(),
      notes: document.getElementById('editTaskNotes').value.trim(),
      assigned_to: document.getElementById('editTaskAssignee').value,
      due_date: document.getElementById('editTaskDueDate').value || null,
      category: document.getElementById('editTaskCategory').value,
      priority: document.getElementById('editTaskPriority').value,
      recurring: document.getElementById('editTaskRecurring')?.value || 'none',
      subtasks,
      updated_by: this.getCurrentUserName()
    };

    Object.assign(task, payload);
    this.renderTasks();
    this.calendar.renderCalendar();
    this.calendar.loadSelectedDayDetails();
    this.closeEditModal();

    try {
      await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      this.showToast('Task updated ✨');
    } catch (err) {
      alert('Error updating task: ' + err.message);
    }
  }

  // ================= RENDERING =================
  renderTasks() {
    const todayStr = this.calendar.formatDate(new Date());

    // Filter tasks
    const filtered = this.tasks.filter(t => {
      // 1. Completion filter
      if (this.hideCompleted && t.is_completed) return false;

      // 2. Tab / Pill filter
      if (this.currentFilter === 'today') {
        const taskDate = t.due_date || (t.created_at ? this.calendar.formatDate(new Date(t.created_at)) : '');
        if (!taskDate || taskDate > todayStr) return false; // past or today
      } else if (this.currentFilter === 'past') {
        const taskDate = t.due_date || (t.created_at ? this.calendar.formatDate(new Date(t.created_at)) : '');
        if (!taskDate || taskDate >= todayStr) return false; // strictly previous dates
      } else if (this.currentFilter === 'groceries') {
        if (t.category !== 'Home & Groceries') return false;
      } else if (this.currentFilter === 'mine') {
        if (t.assigned_to !== this.currentUserKey && t.assigned_to !== 'both') return false;
      } else if (this.currentFilter === 'partner') {
        const partnerKey = this.currentUserKey === 'user1' ? 'user2' : 'user1';
        if (t.assigned_to !== partnerKey) return false;
      } else if (this.currentFilter === 'both') {
        if (t.assigned_to !== 'both') return false;
      }

      // 2b. Exact Date filter (if selected)
      if (this.filterDate) {
        const taskDate = t.due_date || (t.created_at ? this.calendar.formatDate(new Date(t.created_at)) : '');
        if (taskDate !== this.filterDate) return false;
      }

      // 3. Category filter
      if (this.filterCategory !== 'all' && t.category !== this.filterCategory) {
        return false;
      }

      // 4. Search query
      if (this.searchQuery) {
        const matchTitle = t.title.toLowerCase().includes(this.searchQuery);
        const matchNotes = (t.notes || '').toLowerCase().includes(this.searchQuery);
        const matchCat = (t.category || '').toLowerCase().includes(this.searchQuery);
        if (!matchTitle && !matchNotes && !matchCat) return false;
      }

      return true;
    });

    const activeList = filtered.filter(t => !t.is_completed);
    const completedList = filtered.filter(t => t.is_completed);

    // Update Counts
    const totalActive = this.tasks.filter(t => !t.is_completed).length;
    this.activeTodoCount.textContent = totalActive;
    this.activeTasksHeaderCount.textContent = `${activeList.length} task${activeList.length === 1 ? '' : 's'}`;
    this.completedTasksHeaderCount.textContent = `${completedList.length} completed`;

    // Filter pill count badges
    document.getElementById('filterAllCount').textContent = this.tasks.length;
    document.getElementById('filterTodayCount').textContent = this.tasks.filter(t => {
      const d = t.due_date || (t.created_at ? this.calendar.formatDate(new Date(t.created_at)) : '');
      return d && d <= todayStr && !t.is_completed;
    }).length;

    const filterPastPill = document.getElementById('filterPastCount');
    if (filterPastPill) {
      filterPastPill.textContent = this.tasks.filter(t => {
        const d = t.due_date || (t.created_at ? this.calendar.formatDate(new Date(t.created_at)) : '');
        return d && d < todayStr;
      }).length;
    }

    const groceriesPill = document.getElementById('filterGroceriesCount');
    if (groceriesPill) groceriesPill.textContent = this.tasks.filter(t => t.category === 'Home & Groceries' && !t.is_completed).length;
    document.getElementById('filterMineCount').textContent = this.tasks.filter(t => (t.assigned_to === this.currentUserKey || t.assigned_to === 'both') && !t.is_completed).length;
    document.getElementById('filterPartnerCount').textContent = this.tasks.filter(t => t.assigned_to === (this.currentUserKey === 'user1' ? 'user2' : 'user1') && !t.is_completed).length;
    document.getElementById('filterBothCount').textContent = this.tasks.filter(t => t.assigned_to === 'both' && !t.is_completed).length;

    // Render Active
    this.activeTasksList.innerHTML = '';
    if (activeList.length === 0) {
      this.tasksEmptyState.style.display = 'flex';
      this.activeTasksList.appendChild(this.tasksEmptyState);
    } else {
      this.tasksEmptyState.style.display = 'none';
      for (const t of activeList) {
        this.activeTasksList.appendChild(this.createTaskElement(t));
      }
    }

    // Render Completed
    this.completedTasksList.innerHTML = '';
    const completedGroup = document.getElementById('completedTasksGroup');
    if (completedList.length === 0) {
      completedGroup.style.display = 'none';
    } else {
      completedGroup.style.display = 'block';
      for (const t of completedList) {
        this.completedTasksList.appendChild(this.createTaskElement(t));
      }
    }
  }

  createTaskElement(t) {
    const item = document.createElement('div');
    item.className = `task-item ${t.is_completed ? 'completed' : ''}`;
    item.dataset.id = t.id;

    // Assignee styling
    let assigneeName = 'Both Together';
    let assigneeClass = 'assign-both';
    let assigneeAvatar = '👥';

    if (t.assigned_to === 'user1') {
      assigneeName = this.room.user1_name;
      assigneeClass = 'assign-user1';
      assigneeAvatar = this.room.user1_avatar;
    } else if (t.assigned_to === 'user2') {
      assigneeName = this.room.user2_name;
      assigneeClass = 'assign-user2';
      assigneeAvatar = this.room.user2_avatar;
    }

    // Date badge
    let dateBadgeHtml = '';
    if (t.due_date) {
      const todayStr = this.calendar.formatDate(new Date());
      let dateText = t.due_date;
      let dateClass = 'badge-date';
      if (t.due_date === todayStr) {
        dateText = 'Today';
        dateClass += ' today';
      } else if (t.due_date < todayStr && !t.is_completed) {
        dateText = `Overdue (${t.due_date})`;
        dateClass += ' overdue';
      }
      dateBadgeHtml = `<span class="badge ${dateClass}">📅 ${dateText}</span>`;
    }

    // Priority badge
    let priorityBadgeHtml = '';
    if (t.priority && t.priority !== 'normal') {
      const pMap = {
        urgent: '🚨 Urgent',
        high: '🔥 High',
        low: '💤 Low'
      };
      priorityBadgeHtml = `<span class="badge badge-priority ${t.priority}">${pMap[t.priority] || t.priority}</span>`;
    }

    // Recurring badge
    let recurringBadgeHtml = '';
    if (t.recurring && t.recurring !== 'none') {
      const rMap = { daily: 'Daily 🔁', weekly: 'Weekly 📅', monthly: 'Monthly 🗓️' };
      recurringBadgeHtml = `<span class="badge badge-recurring">${rMap[t.recurring] || t.recurring}</span>`;
    }

    // Subtasks preview
    let subtasksHtml = '';
    if (t.subtasks && t.subtasks.length > 0) {
      const doneCount = t.subtasks.filter(s => s.completed).length;
      subtasksHtml = `
        <div class="task-subtasks-preview">
          <small style="font-weight:700; color:var(--text-muted);">Checklist (${doneCount}/${t.subtasks.length}):</small>
          ${t.subtasks.map(s => `
            <label class="subtask-item ${s.completed ? 'checked' : ''}">
              <input type="checkbox" class="subtask-checkbox" data-taskid="${t.id}" data-subid="${s.id}" ${s.completed ? 'checked' : ''}>
              <span>${this.escapeHtml(s.text)}</span>
            </label>
          `).join('')}
        </div>
      `;
    }

    const isShared = !t.assigned_to || t.assigned_to === 'both';
    let myDone = false;
    if (isShared) {
      myDone = this.currentUserKey === 'user1' ? !!t.user1_done : !!t.user2_done;
    } else {
      myDone = !!t.is_completed;
    }

    let duoStatusHtml = '';
    if (isShared) {
      const u1Done = !!t.user1_done;
      const u2Done = !!t.user2_done;
      const bothDone = !!t.is_completed || (u1Done && u2Done);
      const isU1 = this.currentUserKey === 'user1';
      const myPart = isU1 ? u1Done : u2Done;
      const partnerPart = isU1 ? u2Done : u1Done;
      const partnerName = isU1 ? this.room.user2_name : this.room.user1_name;

      let duoStatusText = '';
      let duoStatusClass = '';

      if (bothDone) {
        duoStatusText = '🎉 Both completed!';
        duoStatusClass = 'status-both-done';
      } else if (myPart && !partnerPart) {
        duoStatusText = `✓ You did your part · ⏳ Waiting for ${this.escapeHtml(partnerName)}`;
        duoStatusClass = 'status-waiting-partner';
      } else if (!myPart && partnerPart) {
        duoStatusText = `⏳ Your turn! · ${this.escapeHtml(partnerName)} finished their part ✓`;
        duoStatusClass = 'status-your-turn';
      } else {
        duoStatusText = `👥 Shared task: Both need to complete`;
        duoStatusClass = 'status-both-pending';
      }

      duoStatusHtml = `
        <div class="duo-task-status-bar ${duoStatusClass}">
          <span class="duo-status-text">${duoStatusText}</span>
          <div class="duo-partner-chips">
            <span class="duo-chip ${u1Done ? 'done' : 'pending'}" title="${this.escapeHtml(this.room.user1_name)}: ${u1Done ? 'Done' : 'Incomplete'}">
              ${this.room.user1_avatar} ${this.escapeHtml(this.room.user1_name)}: ${u1Done ? '✓' : '⏳'}
            </span>
            <span class="duo-chip ${u2Done ? 'done' : 'pending'}" title="${this.escapeHtml(this.room.user2_name)}: ${u2Done ? 'Done' : 'Incomplete'}">
              ${this.room.user2_avatar} ${this.escapeHtml(this.room.user2_name)}: ${u2Done ? '✓' : '⏳'}
            </span>
          </div>
        </div>
      `;
    }

    item.innerHTML = `
      <div class="task-checkbox-wrap">
        <input type="checkbox" class="task-checkbox" ${t.is_completed || (isShared && myDone) ? 'checked' : ''} title="${isShared ? (myDone ? 'Completed by you (click to uncheck)' : 'Click to complete your part') : 'Mark done'}">
      </div>
      <div class="task-content">
        <div class="task-title-line">
          <span class="task-title ${t.is_completed ? 'completed' : ''}">${this.escapeHtml(t.title)}</span>
          <div class="task-actions">
            ${!t.is_completed ? `<button class="nudge-btn" title="Send a friendly reminder to your partner">🔔 Nudge</button>` : ''}
            <button class="task-action-btn edit" title="Edit task">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="task-action-btn delete" title="Delete task">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
        ${t.notes ? `<p class="task-notes-preview">${this.escapeHtml(t.notes)}</p>` : ''}
        ${subtasksHtml}
        ${duoStatusHtml}
        <div class="task-badges">
          <span class="badge badge-assignee ${assigneeClass}">${assigneeAvatar} ${assigneeName}</span>
          <span class="badge badge-category">🏷️ ${this.escapeHtml(t.category)}</span>
          ${recurringBadgeHtml}
          ${dateBadgeHtml}
          ${priorityBadgeHtml}
          ${t.is_completed ? `<span class="badge badge-done-all">🎉 Fully Completed</span>` : (isShared && (t.user1_done || t.user2_done) ? `<span class="badge badge-partial-done">⚡ 1/2 Duo Done</span>` : '')}
          ${t.is_completed && t.completed_by ? `<span class="badge" style="background:#dcfce7; color:#15803d;">Done by ${this.escapeHtml(t.completed_by)}</span>` : ''}
        </div>
      </div>
    `;

    // Nudge button event
    const nudgeBtn = item.querySelector('.nudge-btn');
    if (nudgeBtn) {
      nudgeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.sendNudge(t);
      });
    }

    // Checkbox event
    const chk = item.querySelector('.task-checkbox');
    chk.addEventListener('change', () => {
      this.toggleTaskCompleted(t.id, chk.checked);
    });

    // Subtask checkboxes
    item.querySelectorAll('.subtask-item input').forEach(sChk => {
      sChk.addEventListener('change', () => {
        const subId = sChk.dataset.subid;
        const subItem = t.subtasks.find(s => s.id === subId);
        if (subItem) {
          subItem.completed = sChk.checked;
          this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/tasks/${encodeURIComponent(t.id)}`, {
            method: 'PUT',
            body: JSON.stringify({ subtasks: t.subtasks, updated_by: this.getCurrentUserName() })
          });
          this.renderTasks();
        }
      });
    });

    // Edit button
    item.querySelector('.task-action-btn.edit').addEventListener('click', () => {
      this.openEditModal(t);
    });

    // Delete button
    item.querySelector('.task-action-btn.delete').addEventListener('click', () => {
      if (confirm(`Delete "${t.title}"?`)) {
        this.deleteTask(t.id);
      }
    });

    return item;
  }

  renderCategoryOptions() {
    const sel = document.getElementById('filterCategorySelect');
    if (!sel) return;
    sel.innerHTML = '<option value="all">All Categories</option>';
    const defaultCats = ['General', 'Home & Groceries', 'Work / Study', 'Date & Fun', 'Health & Habits'];
    const customCats = this.categories.map(c => c.name);
    const all = Array.from(new Set([...defaultCats, ...customCats]));
    for (const c of all) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    }
  }

  renderActivities() {
    if (!this.activityTimeline) return;
    this.activityTimeline.innerHTML = '';
    if (this.activities.length === 0) {
      this.activityTimeline.innerHTML = '<p class="empty-hint">No recent activities yet. Start adding tasks together!</p>';
      return;
    }

    for (const act of this.activities) {
      const el = document.createElement('div');
      el.className = 'activity-item';
      const timeAgo = this.formatTimeAgo(act.created_at);
      const isUser1 = act.actor === this.room.user1_name;
      const avatar = isUser1 ? this.room.user1_avatar : this.room.user2_avatar;

      el.innerHTML = `
        <span class="activity-avatar">${avatar}</span>
        <div class="activity-text">
          <strong>${this.escapeHtml(act.actor)}</strong> ${this.escapeHtml(act.action)} 
          ${act.details ? `<em>"${this.escapeHtml(act.details)}"</em>` : ''}
        </div>
        <span class="activity-time">${timeAgo}</span>
      `;
      this.activityTimeline.appendChild(el);
    }
  }

  formatTimeAgo(timestamp) {
    const sec = Math.floor((Date.now() - timestamp) / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  // ================= CHEER & CONFETTI =================
  async sendCheer(emoji, message) {
    const actionId = 'act_cheer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    this.mySentActionIds.add(actionId);
    this.triggerFloatingEmoji(emoji);
    this.playChime('cheer');
    try {
      await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/cheer`, {
        method: 'POST',
        body: JSON.stringify({
          actionId,
          fromUserId: this.currentUserKey,
          from: this.getCurrentUserName(),
          fromAvatar: this.getCurrentUserAvatar(),
          emoji,
          message
        })
      });
    } catch (e) {
      console.warn('Cheer send failed:', e);
    }
  }

  triggerFloatingEmoji(emoji) {
    if (!this.cheerOverlay) return;
    for (let i = 0; i < 6; i++) {
      const span = document.createElement('span');
      span.className = 'floating-cheer';
      span.textContent = emoji;
      span.style.left = `${30 + Math.random() * 40}%`;
      span.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
      span.style.animationDelay = `${i * 0.12}s`;
      this.cheerOverlay.appendChild(span);
      setTimeout(() => span.remove(), 2600);
    }
  }

  triggerConfetti() {
    const emojis = ['🎉', '✨', '⭐', '🎈', '💖'];
    for (let i = 0; i < 8; i++) {
      const e = emojis[Math.floor(Math.random() * emojis.length)];
      this.triggerFloatingEmoji(e);
    }
  }

  // ================= SHARE & CONNECT MODAL =================
  openShareModal() {
    const input = document.getElementById('shareLinkInput');
    // Partner's link switches user key so they open ready as the other partner!
    const partnerKey = this.currentUserKey === 'user1' ? 'user2' : 'user1';
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set('room', this.roomId);
    shareUrl.searchParams.set('user', partnerKey);
    input.value = shareUrl.toString();

    this.renderQRCode(shareUrl.toString());
    this.shareModal.classList.remove('hidden');
  }

  closeShareModal() {
    this.shareModal.classList.add('hidden');
  }

  copyShareLink() {
    const input = document.getElementById('shareLinkInput');
    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
      const btnText = document.getElementById('copyBtnText');
      btnText.textContent = 'Copied! ✅';
      this.showToast('Link copied to clipboard! Send to your partner.');
      setTimeout(() => { btnText.textContent = 'Copy Link'; }, 2500);
    });
  }

  renderQRCode(text) {
    const canvas = document.getElementById('qrCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = 180;
    canvas.width = size;
    canvas.height = size;

    // Lightweight inline QR matrix rendering
    // Fallback/standard QR matrix generator
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // Render aesthetic placeholder QR code pattern with room hash seed
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }

    const gridSize = 21;
    const cellSize = Math.floor((size - 20) / gridSize);
    const offset = Math.floor((size - (gridSize * cellSize)) / 2);

    ctx.fillStyle = '#1e293b';

    // Position detection squares (top-left, top-right, bottom-left)
    const drawFinder = (x, y) => {
      ctx.fillRect(offset + x * cellSize, offset + y * cellSize, 7 * cellSize, 7 * cellSize);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(offset + (x + 1) * cellSize, offset + (y + 1) * cellSize, 5 * cellSize, 5 * cellSize);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(offset + (x + 2) * cellSize, offset + (y + 2) * cellSize, 3 * cellSize, 3 * cellSize);
    };

    drawFinder(0, 0);
    drawFinder(gridSize - 7, 0);
    drawFinder(0, gridSize - 7);

    // Pseudorandom grid data from URL text
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        // Skip finder squares
        if ((r < 8 && c < 8) || (r < 8 && c >= gridSize - 8) || (r >= gridSize - 8 && c < 8)) {
          continue;
        }
        const val = Math.sin(hash * 0.1 + r * 13 + c * 37);
        if (val > 0.05) {
          ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize - 1, cellSize - 1);
        }
      }
    }
  }

  // ================= LIVE PARTNER STATUS =================
  ensureStatusUI() {
    let statusBar = document.getElementById('partnerStatusBar');
    if (!statusBar) {
      const userBar = document.querySelector('.user-identity-bar');
      if (userBar) {
        const barDiv = document.createElement('div');
        barDiv.className = 'partner-status-bar';
        barDiv.id = 'partnerStatusBar';
        barDiv.innerHTML = `
          <div class="partner-status-col" id="statusColUser1">
            <div class="status-col-identity">
              <span class="status-col-avatar" id="statusColAvatar1">🦊</span>
              <span class="status-col-name" id="statusColName1">Partner 1</span>
            </div>
            <div class="status-display-bubble" id="statusBubble1" title="Click to update status for Partner 1">
              <span class="status-badge-dot"></span>
              <span class="status-bubble-text" id="statusText1">Free / Available</span>
              <button type="button" class="status-edit-mini-btn" id="editStatusBtn1" title="Change status">✏️</button>
            </div>
          </div>
          <div class="status-bar-divider"></div>
          <div class="partner-status-col" id="statusColUser2">
            <div class="status-col-identity">
              <span class="status-col-avatar" id="statusColAvatar2">🐼</span>
              <span class="status-col-name" id="statusColName2">Partner 2</span>
            </div>
            <div class="status-display-bubble" id="statusBubble2" title="Click to update status for Partner 2">
              <span class="status-badge-dot"></span>
              <span class="status-bubble-text" id="statusText2">Free / Available</span>
              <button type="button" class="status-edit-mini-btn" id="editStatusBtn2" title="Change status">✏️</button>
            </div>
          </div>
          <button type="button" class="quick-set-status-action-btn" id="openStatusModalBtn" title="Set what you are doing right now (studying, bathing, timepass, waiting...)">
            <span class="status-btn-icon">💭</span>
            <span class="status-btn-label">Set My Status</span>
          </button>
        `;
        userBar.parentNode.insertBefore(barDiv, userBar.nextSibling);
      }
    }

    let statusModal = document.getElementById('statusModal');
    if (!statusModal) {
      const modalDiv = document.createElement('div');
      modalDiv.className = 'modal-overlay hidden';
      modalDiv.id = 'statusModal';
      modalDiv.innerHTML = `
        <div class="modal-card status-modal-card">
          <div class="modal-header">
            <h3>💭 Update Live Status</h3>
            <button class="modal-close-btn" id="closeStatusModalBtn">&times;</button>
          </div>
          <div class="modal-body">
            <p class="status-modal-subtitle">Let your partner know what you're doing right now!</p>
            <div class="status-user-picker">
              <label>Update status for:</label>
              <div class="status-user-pills">
                <button type="button" class="status-user-btn active" id="statusPickUser1">
                  <span id="statusPickAvatar1">🦊</span>
                  <span id="statusPickName1">Partner 1</span>
                </button>
                <button type="button" class="status-user-btn" id="statusPickUser2">
                  <span id="statusPickAvatar2">🐼</span>
                  <span id="statusPickName2">Partner 2</span>
                </button>
              </div>
            </div>
            <div class="status-presets-section">
              <label>Quick Presets (1-tap to set):</label>
              <div class="status-chips-grid">
                <button type="button" class="status-preset-chip" data-status="📚 Studying">📚 Studying</button>
                <button type="button" class="status-preset-chip" data-status="🚿 Bathing">🚿 Bathing</button>
                <button type="button" class="status-preset-chip" data-status="🎮 Timepass">🎮 Timepass</button>
                <button type="button" class="status-preset-chip" data-status="⏳ Waiting">⏳ Waiting</button>
                <button type="button" class="status-preset-chip" data-status="💼 Working">💼 Working</button>
                <button type="button" class="status-preset-chip" data-status="🍽️ Eating">🍽️ Eating</button>
                <button type="button" class="status-preset-chip" data-status="😴 Sleeping">😴 Sleeping</button>
                <button type="button" class="status-preset-chip" data-status="🚗 Traveling">🚗 Traveling</button>
                <button type="button" class="status-preset-chip" data-status="☕ Taking Break">☕ Taking Break</button>
                <button type="button" class="status-preset-chip" data-status="🏋️ Workout">🏋️ Workout</button>
                <button type="button" class="status-preset-chip" data-status="🎧 Chilling">🎧 Chilling</button>
                <button type="button" class="status-preset-chip" data-status="🧹 Chores">🧹 Chores</button>
              </div>
            </div>
            <form id="customStatusForm" class="custom-status-form">
              <label for="customStatusInput">Or type your own custom status:</label>
              <div class="custom-status-input-row">
                <input type="text" id="customStatusInput" class="input-text" placeholder="e.g. studying physics, taking shower, waiting for food..." maxlength="60" autocomplete="off">
              </div>
              <div class="status-modal-actions">
                <button type="button" class="secondary-btn" id="clearStatusBtn">Clear Status</button>
                <button type="submit" class="primary-btn" id="saveStatusBtn">Save Status</button>
              </div>
            </form>
          </div>
        </div>
      `;
      document.body.appendChild(modalDiv);
    }

    // Refresh cached references & listeners
    this.statusModal = document.getElementById('statusModal');
    this.customStatusInput = document.getElementById('customStatusInput');
    this.customStatusForm = document.getElementById('customStatusForm');
    this.clearStatusBtn = document.getElementById('clearStatusBtn');
    this.closeStatusModalBtn = document.getElementById('closeStatusModalBtn');
    this.statusPickUser1 = document.getElementById('statusPickUser1');
    this.statusPickUser2 = document.getElementById('statusPickUser2');
    this.openStatusModalBtn = document.getElementById('openStatusModalBtn');
    this.statusBubble1 = document.getElementById('statusBubble1');
    this.editStatusBtn1 = document.getElementById('editStatusBtn1');
    this.statusBubble2 = document.getElementById('statusBubble2');
    this.editStatusBtn2 = document.getElementById('editStatusBtn2');

    if (this.openStatusModalBtn && !this.openStatusModalBtn._bound) {
      this.openStatusModalBtn._bound = true;
      this.openStatusModalBtn.addEventListener('click', () => this.openStatusModal());
    }
    if (this.statusBubble1 && !this.statusBubble1._bound) {
      this.statusBubble1._bound = true;
      this.statusBubble1.addEventListener('click', () => this.openStatusModal('user1'));
    }
    if (this.editStatusBtn1 && !this.editStatusBtn1._bound) {
      this.editStatusBtn1._bound = true;
      this.editStatusBtn1.addEventListener('click', (e) => { e.stopPropagation(); this.openStatusModal('user1'); });
    }
    if (this.statusBubble2 && !this.statusBubble2._bound) {
      this.statusBubble2._bound = true;
      this.statusBubble2.addEventListener('click', () => this.openStatusModal('user2'));
    }
    if (this.editStatusBtn2 && !this.editStatusBtn2._bound) {
      this.editStatusBtn2._bound = true;
      this.editStatusBtn2.addEventListener('click', (e) => { e.stopPropagation(); this.openStatusModal('user2'); });
    }
    if (this.closeStatusModalBtn && !this.closeStatusModalBtn._bound) {
      this.closeStatusModalBtn._bound = true;
      this.closeStatusModalBtn.addEventListener('click', () => this.closeStatusModal());
    }
    if (this.statusModal && !this.statusModal._bound) {
      this.statusModal._bound = true;
      this.statusModal.addEventListener('click', (e) => {
        if (e.target === this.statusModal) this.closeStatusModal();
      });
    }
    if (this.statusPickUser1 && !this.statusPickUser1._bound) {
      this.statusPickUser1._bound = true;
      this.statusPickUser1.addEventListener('click', () => this.setStatusTargetUser('user1'));
    }
    if (this.statusPickUser2 && !this.statusPickUser2._bound) {
      this.statusPickUser2._bound = true;
      this.statusPickUser2.addEventListener('click', () => this.setStatusTargetUser('user2'));
    }
    document.querySelectorAll('.status-preset-chip').forEach(chip => {
      // @ts-ignore
      if (!chip._bound) {
        // @ts-ignore
        chip._bound = true;
        chip.addEventListener('click', () => {
          // @ts-ignore
          const statusVal = chip.dataset.status || chip.textContent.trim();
          this.setPartnerStatus(this.statusTargetUser || this.currentUserKey, statusVal);
          this.closeStatusModal();
        });
      }
    });
    if (this.customStatusForm && !this.customStatusForm._bound) {
      this.customStatusForm._bound = true;
      this.customStatusForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = this.customStatusInput ? this.customStatusInput.value.trim() : '';
        this.setPartnerStatus(this.statusTargetUser || this.currentUserKey, val);
        this.closeStatusModal();
      });
    }
    if (this.clearStatusBtn && !this.clearStatusBtn._bound) {
      this.clearStatusBtn._bound = true;
      this.clearStatusBtn.addEventListener('click', () => {
        this.setPartnerStatus(this.statusTargetUser || this.currentUserKey, '');
        this.closeStatusModal();
      });
    }
  }

  setStatusTargetUser(userKey) {
    this.statusTargetUser = userKey;
    if (this.statusPickUser1) this.statusPickUser1.classList.toggle('active', userKey === 'user1');
    if (this.statusPickUser2) this.statusPickUser2.classList.toggle('active', userKey === 'user2');

    const curStatus = userKey === 'user1' ? (this.room.user1_status || '') : (this.room.user2_status || '');
    if (this.customStatusInput) {
      this.customStatusInput.value = curStatus;
      this.customStatusInput.focus();
    }
  }

  openStatusModal(targetUser = null) {
    this.ensureStatusUI();
    const userToSet = targetUser || this.currentUserKey || 'user1';
    this.setStatusTargetUser(userToSet);

    const pickAvatar1 = document.getElementById('statusPickAvatar1');
    const pickName1 = document.getElementById('statusPickName1');
    const pickAvatar2 = document.getElementById('statusPickAvatar2');
    const pickName2 = document.getElementById('statusPickName2');
    if (pickAvatar1) pickAvatar1.textContent = this.room.user1_avatar;
    if (pickName1) pickName1.textContent = this.room.user1_name;
    if (pickAvatar2) pickAvatar2.textContent = this.room.user2_avatar;
    if (pickName2) pickName2.textContent = this.room.user2_name;

    this.statusModal?.classList.remove('hidden');
    setTimeout(() => {
      this.customStatusInput?.focus();
    }, 100);
  }

  closeStatusModal() {
    this.statusModal?.classList.add('hidden');
  }

  async setPartnerStatus(userKey, statusText) {
    const cleanStatus = typeof statusText === 'string' ? statusText.trim() : '';
    // Optimistic local update
    if (userKey === 'user1') {
      this.room.user1_status = cleanStatus;
    } else {
      this.room.user2_status = cleanStatus;
    }
    this.updateUserUI();
    this.updateChatHeader();
    this.saveLocalSnapshot();

    const userName = userKey === 'user1' ? this.room.user1_name : this.room.user2_name;
    this.showToast(cleanStatus ? `${userName} status: ${cleanStatus} 📌` : `${userName} status cleared`);

    try {
      const res = await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/status`, {
        method: 'PUT',
        body: JSON.stringify({ user: userKey, status: cleanStatus })
      });
      if (res.room) {
        this.room = res.room;
        this.updateUserUI();
        this.updateChatHeader();
        this.saveLocalSnapshot();
      }
    } catch (err) {
      console.warn('Failed to save status to server:', err);
    }
  }

  // ================= SETTINGS MODAL =================
  ensureNotificationSettingUI() {
    let notifyChk = document.getElementById('cfgNotifyPartnerJoin');
    if (!notifyChk) {
      const settingsForm = document.getElementById('settingsForm');
      if (settingsForm) {
        const div = document.createElement('div');
        div.className = 'form-group notification-settings-group';
        div.id = 'notificationSettingsGroup';
        div.innerHTML = `
          <label>🔔 Desktop / Computer Notifications:</label>
          <div class="toggle-setting-box highlight-setting-card">
            <div class="toggle-setting-info">
              <span class="toggle-setting-title">Partner Join Alert <span class="badge-new">NEW</span></span>
              <p class="toggle-setting-desc">Get a notification on your computer when your friend/partner joins the group space.</p>
              <small id="desktopNotifyStatus" class="toggle-setting-status">Status: Disabled</small>
            </div>
            <label class="switch-toggle" title="Enable/disable desktop join notifications">
              <input type="checkbox" id="cfgNotifyPartnerJoin">
              <span class="switch-slider"></span>
            </label>
          </div>
        `;
        // Insert right after Partner 2 profile or before savePinBtn
        const pinGroup = document.getElementById('savePinBtn')?.closest('.form-group');
        if (pinGroup) {
          settingsForm.insertBefore(div, pinGroup);
          const divider = document.createElement('div');
          divider.className = 'divider';
          settingsForm.insertBefore(divider, pinGroup);
        } else {
          const footer = settingsForm.querySelector('.modal-footer');
          if (footer) {
            settingsForm.insertBefore(div, footer);
          } else {
            settingsForm.appendChild(div);
          }
        }
        notifyChk = document.getElementById('cfgNotifyPartnerJoin');
        notifyChk?.addEventListener('change', (e) => {
          this.handleTogglePartnerJoinNotify(e.target.checked);
        });
      }
    }
    return notifyChk;
  }

  openSettingsModal() {
    this.ensureNotificationSettingUI();

    document.getElementById('settingsRoomId').value = this.roomId;
    document.getElementById('cfgUser1Name').value = this.room.user1_name;
    document.getElementById('cfgUser1Avatar').value = this.room.user1_avatar;
    document.getElementById('cfgUser1Color').value = this.room.user1_color;

    document.getElementById('cfgUser2Name').value = this.room.user2_name;
    document.getElementById('cfgUser2Avatar').value = this.room.user2_avatar;
    document.getElementById('cfgUser2Color').value = this.room.user2_color;

    const cfgStatus1 = document.getElementById('cfgUser1Status');
    const cfgStatus2 = document.getElementById('cfgUser2Status');
    if (cfgStatus1) cfgStatus1.value = this.room.user1_status || '';
    if (cfgStatus2) cfgStatus2.value = this.room.user2_status || '';

    // Desktop Join Notification Setting (Disabled by default)
    const notifyChk = document.getElementById('cfgNotifyPartnerJoin');
    const notifyStatus = document.getElementById('desktopNotifyStatus');
    const isEnabled = this.isPartnerJoinNotifyEnabled();
    if (notifyChk) {
      notifyChk.checked = isEnabled;
    }
    if (notifyStatus) {
      if (!('Notification' in window)) {
        notifyStatus.textContent = 'Status: Not supported in this browser';
        if (notifyChk) notifyChk.disabled = true;
      } else if (Notification.permission === 'denied') {
        notifyStatus.textContent = 'Status: Blocked in browser settings';
      } else if (isEnabled) {
        notifyStatus.textContent = 'Status: Enabled (Active) 🔔';
      } else {
        notifyStatus.textContent = 'Status: Disabled (Click switch to turn ON)';
      }
    }

    this.settingsModal.classList.remove('hidden');
  }

  closeSettingsModal() {
    this.settingsModal.classList.add('hidden');
  }

  isPartnerJoinNotifyEnabled() {
    return localStorage.getItem('duosync_notify_partner_join') === 'true' &&
           ('Notification' in window) &&
           Notification.permission === 'granted';
  }

  async handleTogglePartnerJoinNotify(enable) {
    const notifyChk = document.getElementById('cfgNotifyPartnerJoin');
    const notifyStatus = document.getElementById('desktopNotifyStatus');

    if (!enable) {
      localStorage.setItem('duosync_notify_partner_join', 'false');
      if (notifyStatus) notifyStatus.textContent = 'Status: Disabled (Click switch to turn ON)';
      this.updateNotificationBtnUI();
      this.showToast('Desktop join alerts turned OFF.');
      return;
    }

    if (!('Notification' in window)) {
      alert('Your browser does not support desktop notifications.');
      if (notifyChk) notifyChk.checked = false;
      this.updateNotificationBtnUI();
      return;
    }

    if (Notification.permission === 'granted') {
      localStorage.setItem('duosync_notify_partner_join', 'true');
      if (notifyStatus) notifyStatus.textContent = 'Status: Enabled (Active) 🔔';
      this.updateNotificationBtnUI();
      this.showToast('Desktop join alerts turned ON! 🔔');
      this.sendDesktopNotification('DuoSync Alert Active! 🔔', 'You will now receive computer notifications when your partner joins.');
      return;
    }

    if (Notification.permission !== 'denied') {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          localStorage.setItem('duosync_notify_partner_join', 'true');
          if (notifyStatus) notifyStatus.textContent = 'Status: Enabled (Active) 🔔';
          this.updateNotificationBtnUI();
          this.showToast('Desktop join alerts enabled! 🔔');
          this.sendDesktopNotification('DuoSync Alert Active! 🔔', 'You will now receive computer notifications when your partner joins.');
        } else {
          localStorage.setItem('duosync_notify_partner_join', 'false');
          if (notifyChk) notifyChk.checked = false;
          if (notifyStatus) notifyStatus.textContent = 'Status: Permission not granted';
          this.updateNotificationBtnUI();
          this.showToast('Notification permission was not granted.');
        }
      } catch (err) {
        localStorage.setItem('duosync_notify_partner_join', 'false');
        if (notifyChk) notifyChk.checked = false;
        this.updateNotificationBtnUI();
      }
    } else {
      localStorage.setItem('duosync_notify_partner_join', 'false');
      if (notifyChk) notifyChk.checked = false;
      if (notifyStatus) notifyStatus.textContent = 'Status: Blocked in browser settings';
      this.updateNotificationBtnUI();
      alert('Desktop notifications are blocked by your browser settings. Please allow notifications for this site in your browser URL bar.');
    }
  }

  async sendDesktopNotification(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!this.isPartnerJoinNotifyEnabled()) return;

    try {
      const options = {
        body,
        icon: '/icon-192.png',
        badge: '/icon.svg',
        tag: 'duosync-partner-joined',
        renotify: true
      };

      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          reg.showNotification(title, options);
          this.playChime('nudge');
          return;
        }
      }

      const notification = new Notification(title, options);
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      this.playChime('nudge');
    } catch (e) {
      try {
        const notification = new Notification(title, { body, icon: '/icon-192.png' });
        notification.onclick = () => { window.focus(); notification.close(); };
      } catch (err) {}
    }
  }

  async handleSaveSettings() {
    const payload = {
      user1_name: document.getElementById('cfgUser1Name').value.trim() || 'Partner 1',
      user1_avatar: document.getElementById('cfgUser1Avatar').value.trim() || '🦊',
      user1_color: document.getElementById('cfgUser1Color').value,
      user1_status: document.getElementById('cfgUser1Status')?.value.trim() ?? (this.room.user1_status || ''),
      user2_name: document.getElementById('cfgUser2Name').value.trim() || 'Partner 2',
      user2_avatar: document.getElementById('cfgUser2Avatar').value.trim() || '🐼',
      user2_color: document.getElementById('cfgUser2Color').value,
      user2_status: document.getElementById('cfgUser2Status')?.value.trim() ?? (this.room.user2_status || ''),
      updated_by: this.getCurrentUserName()
    };

    try {
      const res = await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/profile`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      if (res.room) {
        this.room = res.room;
        document.documentElement.style.setProperty('--partner1-color', this.room.user1_color);
        document.documentElement.style.setProperty('--partner2-color', this.room.user2_color);
        this.updateUserUI();
        this.renderTasks();
      }
      this.closeSettingsModal();
      this.showToast('Profile & Duo Settings Saved! ✨');
    } catch (err) {
      alert('Error saving settings: ' + err.message);
    }
  }

  // ================= NUDGE & REMINDERS =================
  async sendNudge(task) {
    const actionId = 'act_nudge_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    this.mySentActionIds.add(actionId);
    this.playChime('nudge');
    this.showToast(`🔔 Sent gentle reminder for "${task.title}"`);
    try {
      await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/nudge`, {
        method: 'POST',
        body: JSON.stringify({
          actionId,
          fromUserId: this.currentUserKey,
          from: this.getCurrentUserName(),
          fromAvatar: this.getCurrentUserAvatar(),
          taskId: task.id,
          taskTitle: task.title
        })
      });
    } catch (err) {
      console.warn('Error sending nudge:', err);
    }
  }

  // ================= NUDGE BANNER & CHEER MODAL =================
  showNudgeAlertBanner(data) {
    if (!this.nudgeAlertBanner) return;
    this.activeNudgeTaskId = data.taskId;
    if (this.nudgeAlertSender) {
      this.nudgeAlertSender.textContent = `${data.fromAvatar || '🔔'} ${data.from || 'Partner'}`;
    }
    if (this.nudgeAlertMessage) {
      this.nudgeAlertMessage.textContent = `sent a reminder: "${data.taskTitle || 'a task'}"`;
    }
    this.nudgeAlertBanner.classList.remove('hidden');

    clearTimeout(this.nudgeBannerTimeout);
    this.nudgeBannerTimeout = setTimeout(() => {
      this.dismissNudgeAlertBanner();
    }, 15000);
  }

  dismissNudgeAlertBanner() {
    if (this.nudgeAlertBanner) {
      this.nudgeAlertBanner.classList.add('hidden');
    }
    this.activeNudgeTaskId = null;
  }

  showCheerCelebrationModal(data) {
    if (!this.cheerCelebrationModal) return;
    if (this.cheerModalEmoji) {
      this.cheerModalEmoji.textContent = data.emoji || '🎉';
    }
    if (this.cheerModalTitle) {
      this.cheerModalTitle.textContent = `${data.from || 'Partner'} sent cheer!`;
    }
    if (this.cheerModalDesc) {
      this.cheerModalDesc.textContent = data.message || 'Keep up the fantastic momentum together!';
    }
    this.cheerCelebrationModal.classList.remove('hidden');
  }

  closeCheerCelebrationModal() {
    if (this.cheerCelebrationModal) {
      this.cheerCelebrationModal.classList.add('hidden');
    }
  }

  // ================= PWA & NOTIFICATIONS =================
  initPwa() {
    // Service Worker registration
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then((reg) => {
          console.log('DuoSync ServiceWorker active:', reg.scope);
          try { reg.update(); } catch (e) {}
        }).catch((err) => {
          console.warn('ServiceWorker registration error:', err);
        });
      });
    }

    // PWA Install prompt listener
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      if (this.installPwaBtn) {
        this.installPwaBtn.classList.remove('hidden');
      }
    });

    this.installPwaBtn?.addEventListener('click', async () => {
      if (this.deferredPrompt) {
        this.deferredPrompt.prompt();
        const choice = await this.deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          this.showToast('Thank you for installing DuoSync! 📲');
          this.installPwaBtn.classList.add('hidden');
        }
        this.deferredPrompt = null;
      } else {
        this.showToast('To install, tap "Add to Home Screen" in your browser menu 📲');
      }
    });

    // Web Notifications
    this.updateNotificationBtnUI();
    this.notificationToggleBtn?.addEventListener('click', () => {
      this.toggleNotifications();
    });
  }

  updateNotificationBtnUI() {
    if (!('Notification' in window) || !this.notificationToggleBtn) return;
    const isJoinNotify = this.isPartnerJoinNotifyEnabled();
    if (Notification.permission === 'granted' || isJoinNotify) {
      this.notificationToggleBtn.classList.add('enabled');
      this.notificationToggleBtn.title = isJoinNotify ? 'Partner join alerts active 🔔 (Click to open settings)' : 'Browser notifications enabled (Click to open settings)';
    } else {
      this.notificationToggleBtn.classList.remove('enabled');
      this.notificationToggleBtn.title = 'Partner Join & Desktop Alerts (Click to configure)';
    }
  }

  async toggleNotifications() {
    // Directly open Settings modal and highlight the Partner Join Alert section
    this.openSettingsModal();
    setTimeout(() => {
      const elem = document.getElementById('notificationSettingsGroup') || document.getElementById('cfgNotifyPartnerJoin');
      elem?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      elem?.classList.add('highlight-pulse');
      setTimeout(() => elem?.classList.remove('highlight-pulse'), 2500);
    }, 150);
  }

  showNativeNotification(title, options = {}) {
    const isAway = document.hidden || !document.hasFocus();
    if ('Notification' in window && Notification.permission === 'granted' && isAway) {
      try {
        const notif = new Notification(title, {
          icon: 'icon-192.png',
          badge: 'icon-192.png',
          tag: 'duosync-chat',
          renotify: true,
          ...options
        });
        notif.onclick = () => {
          window.focus();
          this.switchTab('chat');
          notif.close();
        };
      } catch (e) {
        console.warn('Native notification failed:', e);
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.ready.then(reg => {
            reg.showNotification(title, {
              icon: 'icon-192.png',
              tag: 'duosync-chat',
              renotify: true,
              ...options
            });
          }).catch(() => {});
        }
      }
    }
  }

  // ================= ROOM PIN PROTECTION =================
  checkPinProtection() {
    if (this.room && this.room.has_pin) {
      const unlocked = sessionStorage.getItem(`duosync_unlocked_${this.roomId}`);
      if (!unlocked) {
        this.showPinLockModal();
      }
    }
  }

  showPinLockModal() {
    const modal = document.getElementById('pinLockModal');
    const roomName = document.getElementById('lockRoomName');
    if (roomName) roomName.textContent = this.roomId;
    if (modal) modal.classList.remove('hidden');
    const input = document.getElementById('pinUnlockInput');
    if (input) input.focus();
  }

  async unlockWithPin() {
    const input = document.getElementById('pinUnlockInput');
    const errorMsg = document.getElementById('pinErrorMsg');
    const pin = input ? input.value.trim() : '';

    try {
      const res = await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/verify-pin`, {
        method: 'POST',
        body: JSON.stringify({ pin })
      });

      if (res.success) {
        sessionStorage.setItem(`duosync_unlocked_${this.roomId}`, 'true');
        document.getElementById('pinLockModal')?.classList.add('hidden');
        if (errorMsg) errorMsg.classList.add('hidden');
        this.showToast('Welcome to your space! 🔓');
      } else {
        if (errorMsg) errorMsg.classList.remove('hidden');
        if (input) {
          input.value = '';
          input.focus();
        }
      }
    } catch (err) {
      if (errorMsg) {
        errorMsg.textContent = 'Error checking PIN: ' + err.message;
        errorMsg.classList.remove('hidden');
      }
    }
  }

  async updateRoomPin() {
    const currentPin = document.getElementById('cfgCurrentPin')?.value.trim();
    const newPin = document.getElementById('cfgNewPin')?.value.trim();

    try {
      const res = await this.api(`/api/rooms/${encodeURIComponent(this.roomId)}/pin`, {
        method: 'PUT',
        body: JSON.stringify({
          pin: newPin,
          current_pin: currentPin,
          updated_by: this.getCurrentUserName()
        })
      });

      this.room.has_pin = res.has_pin;
      this.updatePinStatusUI();
      sessionStorage.setItem(`duosync_unlocked_${this.roomId}`, 'true');
      this.showToast(newPin ? 'Room PIN enabled! 🔒' : 'Room PIN removed! 🔓');
      const curInput = document.getElementById('cfgCurrentPin');
      const newInput = document.getElementById('cfgNewPin');
      if (curInput) curInput.value = '';
      if (newInput) newInput.value = '';
    } catch (err) {
      alert('Error updating PIN: ' + err.message);
    }
  }

  updatePinStatusUI() {
    const label = document.getElementById('pinStatusLabel');
    if (!label) return;
    if (this.room && this.room.has_pin) {
      label.textContent = 'Status: Protected with PIN 🔒';
      label.style.color = '#10b981';
    } else {
      label.textContent = 'Status: No PIN set (Open Access) 🔓';
      label.style.color = 'var(--text-muted)';
    }
  }

  // ================= 1-CLICK BACKUP & EXPORT =================
  downloadExport(format) {
    const url = `/api/rooms/${encodeURIComponent(this.roomId)}/export?format=${format}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    this.showToast(format === 'markdown' ? 'Downloaded Markdown summary! 📄' : 'Downloaded JSON backup! 💾');
  }

  // ================= TOASTS =================
  showToast(message, onClick = null) {
    if (!this.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>💬</span> <span>${this.escapeHtml(message)}</span>`;
    if (onClick) {
      toast.style.cursor = 'pointer';
      toast.title = 'Click to open';
      toast.addEventListener('click', () => {
        onClick();
        toast.remove();
      });
    }
    this.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Instantiate on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  window.duoApp = new DuoApp();
});
