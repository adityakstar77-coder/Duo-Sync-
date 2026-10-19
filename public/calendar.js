// @ts-check
/**
 * DuoSync Calendar & Daily Planner Module — Enhanced Edition
 */

const DAILY_PROMPTS = [
  "What made you smile or laugh today? 😊",
  "One thing I'm deeply grateful for today...",
  "Favorite conversation or moment together today ✨",
  "What is one goal you want to crush tomorrow? 🎯",
  "Something cute or kind your partner did recently ❤️",
  "A song, meal, or movie that reminds you of today 🎵",
  "What was the most challenging part of today, and how did you overcome it? 💪",
  "One word to describe your overall mood today 🌟"
];

class DuoCalendar {
  constructor(app) {
    this.app = app;
    const now = new Date();
    this.currentYear = now.getFullYear();
    this.currentMonth = now.getMonth(); // 0-indexed
    this.selectedDateStr = this.formatDate(now); // YYYY-MM-DD
    this.monthTasks = [];
    this.monthLogs = [];
    this.saveTimeout = null;
    this.promptIndex = 0;

    try {
      this.cachedDailyLogs = JSON.parse(localStorage.getItem(`duosync_logs_${this.app.roomId}`) || '{}');
    } catch(e) {
      this.cachedDailyLogs = {};
    }

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.monthTitle = document.getElementById('calendarMonthTitle');
    this.monthStats = document.getElementById('calendarMonthStats');
    this.daysGrid = document.getElementById('calendarDaysGrid');
    this.prevMonthBtn = document.getElementById('calPrevMonthBtn');
    this.nextMonthBtn = document.getElementById('calNextMonthBtn');
    this.todayBtn = document.getElementById('calTodayBtn');

    // Day Quick Switcher
    this.dayNavPrevBtn = document.getElementById('dayNavPrevBtn');
    this.dayNavTodayBtn = document.getElementById('dayNavTodayBtn');
    this.dayNavNextBtn = document.getElementById('dayNavNextBtn');
    this.dayNavDatePicker = document.getElementById('dayNavDatePicker');

    // Day Detail Header & Progress
    this.dayFullDate = document.getElementById('dayDetailFullDate');
    this.dayRelative = document.getElementById('dayDetailRelative');
    this.dayCompletionPill = document.getElementById('dayCompletionPill');
    this.dayProgressLabel = document.getElementById('dayProgressLabel');
    this.dayProgressBarFill = document.getElementById('dayProgressBarFill');
    this.dayProgressCelebration = document.getElementById('dayProgressCelebration');

    // Inline Add Form
    this.addTaskForDayBtn = document.getElementById('addTaskForSelectedDayBtn');
    this.dayInlineAddCard = document.getElementById('dayInlineAddCard');
    this.dayInlineAddForm = document.getElementById('dayInlineAddForm');
    this.dayInlineTaskTitle = document.getElementById('dayInlineTaskTitle');
    this.dayInlineTaskTime = document.getElementById('dayInlineTaskTime');
    this.dayInlineTaskAssignee = document.getElementById('dayInlineTaskAssignee');
    this.dayInlineTaskCategory = document.getElementById('dayInlineTaskCategory');
    this.cancelDayInlineAddBtn = document.getElementById('cancelDayInlineAddBtn');

    // Day Tasks List
    this.dayTasksList = document.getElementById('dayTasksList');
    this.dayTasksCount = document.getElementById('dayTasksCount');

    // Daily Notes & Moods
    this.user1NoteInput = document.getElementById('user1DailyNote');
    this.user2NoteInput = document.getElementById('user2DailyNote');
    this.sharedReflectionInput = document.getElementById('sharedDailyReflection');
    this.checkinSavedStatus = document.getElementById('checkinSavedStatus');
    this.duoCheckinStatus = document.getElementById('duoCheckinStatus');
    this.user1TurnBadge = document.getElementById('user1TurnBadge');
    this.user2TurnBadge = document.getElementById('user2TurnBadge');

    // Prompts
    this.dailyPromptLabel = document.getElementById('dailyPromptLabel');
    this.shufflePromptBtn = document.getElementById('shufflePromptBtn');

    // Streak
    this.streakTitle = document.getElementById('streakTitle');
    this.streakDescription = document.getElementById('streakDescription');
    this.streakBadge = document.getElementById('streakBadge');
    this.streakMilestoneTag = document.getElementById('streakMilestoneTag');
  }

  bindEvents() {
    this.prevMonthBtn?.addEventListener('click', () => this.changeMonth(-1));
    this.nextMonthBtn?.addEventListener('click', () => this.changeMonth(1));
    this.todayBtn?.addEventListener('click', () => this.jumpToToday());

    // Day Quick Switcher buttons
    this.dayNavPrevBtn?.addEventListener('click', () => this.shiftDay(-1));
    this.dayNavTodayBtn?.addEventListener('click', () => this.jumpToToday());
    this.dayNavNextBtn?.addEventListener('click', () => this.shiftDay(1));
    this.dayNavDatePicker?.addEventListener('change', (e) => {
      // @ts-ignore
      if (e.target?.value) this.selectDate(e.target.value);
    });

    // Inline Add Task for Selected Day
    this.addTaskForDayBtn?.addEventListener('click', () => this.toggleInlineAdd(true));
    this.cancelDayInlineAddBtn?.addEventListener('click', () => this.toggleInlineAdd(false));
    this.dayInlineAddForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleInlineAdd();
    });

    // Prompt Shuffle
    this.shufflePromptBtn?.addEventListener('click', () => this.shufflePrompt());

    // Auto-save daily notes with safe field ownership
    const handleDailyNoteChange = (userTarget) => {
      this.showSavingStatus('Saving...');
      clearTimeout(this.saveTimeout);
      this.saveTimeout = setTimeout(() => this.saveDailyNotes(userTarget), 650);
    };

    this.user1NoteInput?.addEventListener('input', () => handleDailyNoteChange('user1'));
    this.user2NoteInput?.addEventListener('input', () => handleDailyNoteChange('user2'));
    this.sharedReflectionInput?.addEventListener('input', () => handleDailyNoteChange('reflection'));

    // Mood buttons
    document.querySelectorAll('.mood-selector').forEach(sel => {
      sel.addEventListener('click', (e) => {
        // @ts-ignore
        const btn = e.target.closest('.mood-btn');
        if (!btn) return;
        const parent = btn.parentElement;
        parent.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.app.playChime('message');
        // @ts-ignore
        const userKey = sel.dataset.user || 'user1';
        this.saveDailyNotes(userKey);
      });
    });

    // Send spark cheer
    document.getElementById('sendCheerStreak')?.addEventListener('click', () => {
      this.app.sendCheer('🔥', 'Sent a fiery spark for today\'s streak!');
    });
  }

  formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  parseDate(dateStr) {
    const parts = dateStr.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  changeMonth(delta) {
    this.currentMonth += delta;
    if (this.currentMonth < 0) {
      this.currentMonth = 11;
      this.currentYear--;
    } else if (this.currentMonth > 11) {
      this.currentMonth = 0;
      this.currentYear++;
    }
    this.renderCalendar();
  }

  jumpToToday() {
    const now = new Date();
    this.currentYear = now.getFullYear();
    this.currentMonth = now.getMonth();
    this.selectedDateStr = this.formatDate(now);
    this.renderCalendar();
    this.loadSelectedDayDetails();
  }

  shiftDay(delta) {
    const dateObj = this.parseDate(this.selectedDateStr);
    dateObj.setDate(dateObj.getDate() + delta);
    this.selectDate(this.formatDate(dateObj));
  }

  selectDate(dateStr) {
    this.selectedDateStr = dateStr;
    const dateObj = this.parseDate(dateStr);
    this.currentYear = dateObj.getFullYear();
    this.currentMonth = dateObj.getMonth();
    this.renderCalendar();
    this.loadSelectedDayDetails();
  }

  shufflePrompt() {
    this.promptIndex = (this.promptIndex + 1) % DAILY_PROMPTS.length;
    if (this.dailyPromptLabel) {
      this.dailyPromptLabel.textContent = `🌟 Prompt of the Day: ${DAILY_PROMPTS[this.promptIndex]}`;
    }
  }

  toggleInlineAdd(show) {
    if (!this.dayInlineAddCard) return;
    if (show) {
      this.dayInlineAddCard.classList.remove('hidden');
      this.dayInlineTaskTitle?.focus();
    } else {
      this.dayInlineAddCard.classList.add('hidden');
      if (this.dayInlineTaskTitle) this.dayInlineTaskTitle.value = '';
      if (this.dayInlineTaskTime) this.dayInlineTaskTime.value = '';
    }
  }

  async handleInlineAdd() {
    if (!this.dayInlineTaskTitle) return;
    const title = this.dayInlineTaskTitle.value.trim();
    if (!title) return;

    const payload = {
      title,
      due_date: this.selectedDateStr,
      due_time: this.dayInlineTaskTime?.value || null,
      assigned_to: this.dayInlineTaskAssignee?.value || 'both',
      category: this.dayInlineTaskCategory?.value || 'General',
      priority: 'normal',
      notes: '',
      created_by: this.app.getCurrentUserName()
    };

    try {
      const res = await this.app.api(`/api/rooms/${encodeURIComponent(this.app.roomId)}/tasks`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (res.task && !this.app.tasks.some(t => t.id === res.task.id)) {
        this.app.tasks.unshift(res.task);
      }
      this.toggleInlineAdd(false);
      this.app.playChime('success');
      this.app.showToast(`Task added for ${this.selectedDateStr}!`);
      this.app.renderTasks();
      this.renderCalendar();
      this.loadSelectedDayDetails();
    } catch (err) {
      alert('Failed to add task: ' + err.message);
    }
  }

  async renderCalendar() {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    if (this.monthTitle) {
      this.monthTitle.textContent = `${monthNames[this.currentMonth]} ${this.currentYear}`;
    }

    const monthStr = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}`;
    
    // Fetch tasks & logs for month
    try {
      const data = await this.app.api(`/api/rooms/${encodeURIComponent(this.app.roomId)}/calendar?month=${monthStr}`);
      this.monthTasks = data.tasks || [];
      this.monthLogs = data.logs || [];
    } catch (err) {
      this.monthTasks = this.app.tasks.filter(t => t.due_date && t.due_date.startsWith(monthStr));
    }

    const totalMonthTasks = this.monthTasks.length;
    const completedMonthTasks = this.monthTasks.filter(t => t.is_completed).length;
    if (this.monthStats) {
      this.monthStats.textContent = `${completedMonthTasks}/${totalMonthTasks} tasks completed this month`;
    }

    // Compute grid days
    if (!this.daysGrid) return;
    this.daysGrid.innerHTML = '';

    const firstDayIndex = new Date(this.currentYear, this.currentMonth, 1).getDay(); // 0 is Sunday
    const daysInCurrentMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(this.currentYear, this.currentMonth, 0).getDate();

    const todayStr = this.formatDate(new Date());

    // 1. Previous month trailing days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      const prevMonth = this.currentMonth === 0 ? 12 : this.currentMonth;
      const prevYear = this.currentMonth === 0 ? this.currentYear - 1 : this.currentYear;
      const dateStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      this.daysGrid.appendChild(this.createDayCell(dayNum, dateStr, true, todayStr));
    }

    // 2. Current month days
    for (let dayNum = 1; dayNum <= daysInCurrentMonth; dayNum++) {
      const dateStr = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      this.daysGrid.appendChild(this.createDayCell(dayNum, dateStr, false, todayStr));
    }

    // 3. Next month leading days to complete full rows (multiple of 7)
    const totalCells = firstDayIndex + daysInCurrentMonth;
    const nextDaysNeeded = (7 - (totalCells % 7)) % 7;
    for (let dayNum = 1; dayNum <= nextDaysNeeded; dayNum++) {
      const nextMonth = this.currentMonth === 11 ? 1 : this.currentMonth + 2;
      const nextYear = this.currentMonth === 11 ? this.currentYear + 1 : this.currentYear;
      const dateStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      this.daysGrid.appendChild(this.createDayCell(dayNum, dateStr, true, todayStr));
    }

    // Update streak
    this.updateStreak();
  }

  createDayCell(dayNum, dateStr, isOtherMonth, todayStr) {
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell';
    if (isOtherMonth) cell.classList.add('other-month');
    if (dateStr === todayStr) cell.classList.add('is-today');
    if (dateStr === this.selectedDateStr) cell.classList.add('is-selected');

    cell.dataset.date = dateStr;

    // Day Number & Status row
    const topRow = document.createElement('div');
    topRow.className = 'cal-cell-top';

    const numEl = document.createElement('span');
    numEl.className = 'cal-day-num';
    numEl.textContent = dayNum;
    topRow.appendChild(numEl);

    // Find tasks & logs for this day (scheduled or created on this day)
    const dayTasks = this.app.tasks.filter(t => t.due_date === dateStr || (!t.due_date && this.formatDate(new Date(t.created_at)) === dateStr));
    const dayLog = this.monthLogs.find(l => l.date === dateStr);

    if (dayTasks.length > 0) {
      const doneCount = dayTasks.filter(t => t.is_completed).length;
      const leftCount = dayTasks.length - doneCount;
      const allDone = doneCount === dayTasks.length;

      const badgeWrap = document.createElement('div');
      badgeWrap.className = 'cal-done-left-badge';
      if (allDone) {
        badgeWrap.innerHTML = `<span class="badge-done-count all" title="All ${doneCount} tasks done!">✓ ${doneCount} done</span>`;
      } else {
        badgeWrap.innerHTML = `
          ${doneCount > 0 ? `<span class="badge-done-count" title="${doneCount} completed">✓${doneCount}</span>` : ''}
          <span class="badge-left-count" title="${leftCount} left to do">⏳${leftCount} left</span>
        `;
      }
      topRow.appendChild(badgeWrap);
    }

    cell.appendChild(topRow);

    // Middle: Display tasks written for this day
    if (dayTasks.length > 0) {
      const taskList = document.createElement('div');
      taskList.className = 'cal-day-task-list';

      const maxPreview = 3;
      const previewTasks = dayTasks.slice(0, maxPreview);
      for (const t of previewTasks) {
        const tItem = document.createElement('div');
        const isDone = !!t.is_completed;
        tItem.className = `cal-mini-task ${isDone ? 'done' : 'pending'}`;
        tItem.title = `${t.title} (${isDone ? 'Done' : 'Left'})`;
        tItem.innerHTML = `
          <span class="cal-mini-icon">${isDone ? '✓' : '•'}</span>
          <span class="cal-mini-title">${this.app.escapeHtml(t.title)}</span>
        `;
        taskList.appendChild(tItem);
      }

      if (dayTasks.length > maxPreview) {
        const moreEl = document.createElement('span');
        moreEl.className = 'cal-mini-task-more';
        moreEl.textContent = `+${dayTasks.length - maxPreview} more`;
        taskList.appendChild(moreEl);
      }

      cell.appendChild(taskList);
    }

    // Indicator row: Partner 1 & Partner 2 mood emojis
    const indContainer = document.createElement('div');
    indContainer.className = 'cal-day-indicators';

    if (dayLog) {
      if (dayLog.user1_mood) {
        const m1 = document.createElement('span');
        m1.className = 'cal-partner-mood mood-user1';
        m1.title = `${this.app.room.user1_name}: ${dayLog.user1_mood}`;
        m1.textContent = dayLog.user1_mood;
        indContainer.appendChild(m1);
      }
      if (dayLog.user2_mood) {
        const m2 = document.createElement('span');
        m2.className = 'cal-partner-mood mood-user2';
        m2.title = `${this.app.room.user2_name}: ${dayLog.user2_mood}`;
        m2.textContent = dayLog.user2_mood;
        indContainer.appendChild(m2);
      }
    }

    cell.appendChild(indContainer);

    cell.addEventListener('click', () => {
      this.selectDate(dateStr);
    });

    return cell;
  }

  async loadSelectedDayDetails() {
    const dateObj = this.parseDate(this.selectedDateStr);
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    if (this.dayFullDate) {
      this.dayFullDate.textContent = dateObj.toLocaleDateString(undefined, options);
    }

    // Compute relative text (Today, Tomorrow, Yesterday, etc.)
    const today = new Date();
    const todayStr = this.formatDate(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = this.formatDate(tomorrow);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = this.formatDate(yesterday);

    if (this.dayNavDatePicker) {
      this.dayNavDatePicker.value = this.selectedDateStr;
    }

    // Toggle active pill in day switcher
    this.dayNavTodayBtn?.classList.toggle('active-pill', this.selectedDateStr === todayStr);

    if (this.dayRelative) {
      if (this.selectedDateStr === todayStr) {
        this.dayRelative.textContent = 'Today';
        this.dayRelative.className = 'badge-pill relative-today';
      } else if (this.selectedDateStr === tomorrowStr) {
        this.dayRelative.textContent = 'Tomorrow';
        this.dayRelative.className = 'badge-pill relative-tomorrow';
      } else if (this.selectedDateStr === yesterdayStr) {
        this.dayRelative.textContent = 'Yesterday';
        this.dayRelative.className = 'badge-pill relative-past';
      } else {
        this.dayRelative.textContent = this.selectedDateStr > todayStr ? 'Upcoming' : 'Past Day';
        this.dayRelative.className = 'badge-pill relative-other';
      }
    }

    // Render tasks for this selected day (scheduled or created on this day)
    const dayTasks = this.app.tasks.filter(t => t.due_date === this.selectedDateStr || (!t.due_date && this.formatDate(new Date(t.created_at)) === this.selectedDateStr));
    if (this.dayTasksCount) this.dayTasksCount.textContent = dayTasks.length;
    
    // Day progress calculation
    const doneTasks = dayTasks.filter(t => t.is_completed);
    const doneCount = doneTasks.length;
    const totalCount = dayTasks.length;
    const leftCount = totalCount - doneCount;
    const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

    // Update stat chips in day panel
    const statTotal = document.getElementById('dayStatTotal');
    const statDone = document.getElementById('dayStatDone');
    const statLeft = document.getElementById('dayStatLeft');
    if (statTotal) statTotal.textContent = totalCount;
    if (statDone) statDone.textContent = doneCount;
    if (statLeft) statLeft.textContent = leftCount;

    if (this.dayProgressBarFill) {
      this.dayProgressBarFill.style.width = `${pct}%`;
    }
    if (this.dayCompletionPill) {
      this.dayCompletionPill.textContent = totalCount > 0 ? `${doneCount} Done · ${leftCount} Left (${pct}%)` : 'No tasks';
      this.dayCompletionPill.className = `day-completion-pill ${pct === 100 && totalCount > 0 ? 'all-done' : ''}`;
    }
    if (this.dayProgressLabel) {
      this.dayProgressLabel.textContent = `${doneCount} of ${totalCount} tasks completed (${leftCount} left)`;
    }
    if (this.dayProgressCelebration) {
      if (pct === 100 && totalCount > 0) {
        this.dayProgressCelebration.textContent = '🎉 All done! Great duo work!';
      } else {
        this.dayProgressCelebration.textContent = '';
      }
    }

    if (!this.dayTasksList) return;
    this.dayTasksList.innerHTML = '';

    if (dayTasks.length === 0) {
      this.dayTasksList.innerHTML = '<p class="empty-hint">No tasks scheduled or written for this day. Click "+ Quick Task" to add one!</p>';
    } else {
      for (const t of dayTasks) {
        const item = document.createElement('div');
        item.className = `day-task-card ${t.is_completed ? 'completed' : ''}`;

        const isShared = !t.assigned_to || t.assigned_to === 'both';
        let myDone = false;
        if (isShared) {
          myDone = this.app.currentUserKey === 'user1' ? !!t.user1_done : !!t.user2_done;
        } else {
          myDone = !!t.is_completed;
        }

        const isUser1 = t.assigned_to === 'user1';
        const isUser2 = t.assigned_to === 'user2';
        const assigneeName = isUser1 ? this.app.room.user1_name : (isUser2 ? this.app.room.user2_name : 'Both of us');
        const assigneeAvatar = isUser1 ? this.app.room.user1_avatar : (isUser2 ? this.app.room.user2_avatar : '👥');

        let duoStatusHtml = '';
        if (isShared) {
          const u1 = !!t.user1_done;
          const u2 = !!t.user2_done;
          if (t.is_completed) {
            duoStatusHtml = `<span class="badge" style="background:#dcfce7; color:#15803d;">🎉 Both Done</span>`;
          } else if (u1 || u2) {
            duoStatusHtml = `<span class="badge" style="background:#e0e7ff; color:#4338ca;">${u1 ? this.app.room.user1_avatar + ' Done' : '⏳ ' + this.app.room.user1_name} • ${u2 ? this.app.room.user2_avatar + ' Done' : '⏳ ' + this.app.room.user2_name}</span>`;
          } else {
            duoStatusHtml = `<span class="badge" style="background:#fef3c7; color:#b45309;">👥 Both Pending</span>`;
          }
        }

        item.innerHTML = `
          <div class="day-task-left">
            <input type="checkbox" class="task-checkbox" ${t.is_completed || (isShared && myDone) ? 'checked' : ''} title="${isShared ? (myDone ? 'Completed by you (click to uncheck)' : 'Click to complete your part') : 'Mark done'}">
            <div class="day-task-details">
              <span class="day-task-title ${t.is_completed ? 'line-through' : ''}">${this.app.escapeHtml(t.title)}</span>
              <div class="day-task-badges">
                ${t.due_time ? `<span class="badge badge-time">⏰ ${t.due_time}</span>` : ''}
                <span class="badge badge-assignee">${assigneeAvatar} ${assigneeName}</span>
                <span class="badge badge-category">${this.app.escapeHtml(t.category)}</span>
                ${duoStatusHtml}
              </div>
            </div>
          </div>
          <div class="day-task-actions">
            ${!t.is_completed ? `<button type="button" class="nudge-btn day-nudge-btn" title="Nudge your partner">🔔 Nudge</button>` : ''}
            <button type="button" class="task-action-btn delete day-delete-btn" title="Delete task">&times;</button>
          </div>
        `;

        // Checkbox event
        const chk = item.querySelector('.task-checkbox');
        chk?.addEventListener('change', () => {
          this.app.toggleTaskCompleted(t.id, chk.checked);
        });

        // Nudge event
        const nudgeBtn = item.querySelector('.day-nudge-btn');
        nudgeBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.app.sendNudge(t);
        });

        // Delete event
        const delBtn = item.querySelector('.day-delete-btn');
        delBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`Delete "${t.title}"?`)) {
            this.app.deleteTask(t.id);
          }
        });

        this.dayTasksList.appendChild(item);
      }
    }

    // Role tags in check-in
    const isUser1Active = this.app.currentUserKey === 'user1';
    this.user1TurnBadge?.classList.toggle('hidden', !isUser1Active);
    this.user2TurnBadge?.classList.toggle('hidden', isUser1Active);

    // Load Daily Log (Notes, Mood, Shared reflection)
    try {
      const data = await this.app.api(`/api/rooms/${encodeURIComponent(this.app.roomId)}/daily/${this.selectedDateStr}`);
      const log = data.log || this.cachedDailyLogs[this.selectedDateStr] || {};
      if (data.log) {
        this.cachedDailyLogs[this.selectedDateStr] = data.log;
        try {
          localStorage.setItem(`duosync_logs_${this.app.roomId}`, JSON.stringify(this.cachedDailyLogs));
        } catch(e) {}
      }

      // Preserve typing focus so we don't clobber active input
      if (document.activeElement !== this.user1NoteInput && this.user1NoteInput) {
        this.user1NoteInput.value = log.user1_note || '';
      }
      if (document.activeElement !== this.user2NoteInput && this.user2NoteInput) {
        this.user2NoteInput.value = log.user2_note || '';
      }
      if (document.activeElement !== this.sharedReflectionInput && this.sharedReflectionInput) {
        this.sharedReflectionInput.value = log.reflection || '';
      }

      // Highlight selected moods
      this.setMoodUI('user1', log.user1_mood);
      this.setMoodUI('user2', log.user2_mood);

      // Duo Check-in status
      if (this.duoCheckinStatus) {
        const u1Done = Boolean(log.user1_note || log.user1_mood);
        const u2Done = Boolean(log.user2_note || log.user2_mood);
        if (u1Done && u2Done) {
          this.duoCheckinStatus.textContent = '🌟 Both partners have checked in today! Awesome connection!';
          this.duoCheckinStatus.className = 'checkin-subtitle checkin-complete';
        } else if (u1Done) {
          this.duoCheckinStatus.textContent = `${this.app.room.user1_name} checked in ✓ (Waiting for ${this.app.room.user2_name})`;
          this.duoCheckinStatus.className = 'checkin-subtitle checkin-partial';
        } else if (u2Done) {
          this.duoCheckinStatus.textContent = `${this.app.room.user2_name} checked in ✓ (Waiting for ${this.app.room.user1_name})`;
          this.duoCheckinStatus.className = 'checkin-subtitle checkin-partial';
        } else {
          this.duoCheckinStatus.textContent = 'Share your thoughts & feelings for today';
          this.duoCheckinStatus.className = 'checkin-subtitle';
        }
      }

      this.showSavingStatus('Up to date');
    } catch (err) {
      console.warn('Could not load day log from server, checking local vault:', err);
      const log = this.cachedDailyLogs[this.selectedDateStr] || {};
      if (this.user1NoteInput && log.user1_note) this.user1NoteInput.value = log.user1_note;
      if (this.user2NoteInput && log.user2_note) this.user2NoteInput.value = log.user2_note;
      if (this.sharedReflectionInput && log.reflection) this.sharedReflectionInput.value = log.reflection;
      this.setMoodUI('user1', log.user1_mood);
      this.setMoodUI('user2', log.user2_mood);
    }
  }

  setMoodUI(userKey, moodEmoji) {
    const parent = document.querySelector(`.mood-selector[data-user="${userKey}"]`);
    if (!parent) return;
    parent.querySelectorAll('.mood-btn').forEach(b => {
      // @ts-ignore
      b.classList.toggle('selected', b.dataset.mood === moodEmoji);
    });
  }

  getSelectedMood(userKey) {
    const parent = document.querySelector(`.mood-selector[data-user="${userKey}"]`);
    const active = parent?.querySelector('.mood-btn.selected');
    // @ts-ignore
    return active ? active.dataset.mood : '';
  }

  async saveDailyNotes(userTarget) {
    // Safe payload: only save active user fields to prevent clobbering partner data
    const payload = {
      reflection: this.sharedReflectionInput?.value || '',
      actor: this.app.getCurrentUserName()
    };

    if (userTarget === 'user1' || this.app.currentUserKey === 'user1') {
      payload.user1_note = this.user1NoteInput?.value || '';
      payload.user1_mood = this.getSelectedMood('user1');
    }
    if (userTarget === 'user2' || this.app.currentUserKey === 'user2') {
      payload.user2_note = this.user2NoteInput?.value || '';
      payload.user2_mood = this.getSelectedMood('user2');
    }

    // Save to local vault immediately
    this.cachedDailyLogs[this.selectedDateStr] = {
      ...(this.cachedDailyLogs[this.selectedDateStr] || {}),
      ...payload,
      date: this.selectedDateStr
    };
    try {
      localStorage.setItem(`duosync_logs_${this.app.roomId}`, JSON.stringify(this.cachedDailyLogs));
    } catch(e) {}

    try {
      await this.app.api(`/api/rooms/${encodeURIComponent(this.app.roomId)}/daily/${this.selectedDateStr}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      this.showSavingStatus('Auto-saved ✨');
    } catch (err) {
      this.showSavingStatus('Saved locally 📱');
    }
  }

  showSavingStatus(text) {
    if (this.checkinSavedStatus) {
      this.checkinSavedStatus.textContent = text;
    }
  }

  updateStreak() {
    const completedDates = new Set(
      this.app.tasks
        .filter(t => t.is_completed && t.due_date)
        .map(t => t.due_date)
    );

    let streak = 0;
    const cur = new Date();
    const todayStr = this.formatDate(cur);

    let checkDate = new Date(cur);
    if (!completedDates.has(todayStr)) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    while (completedDates.has(this.formatDate(checkDate))) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }

    if (this.streakBadge) {
      this.streakBadge.textContent = `🔥 ${streak}d`;
    }
    if (this.streakTitle) {
      this.streakTitle.textContent = `Daily Duo Streak: ${streak} Day${streak === 1 ? '' : 's'}`;
    }

    // Milestone badges
    if (this.streakMilestoneTag) {
      if (streak >= 30) {
        this.streakMilestoneTag.textContent = '👑 30-Day Duo Legends';
      } else if (streak >= 14) {
        this.streakMilestoneTag.textContent = '⚡ 14-Day Power Duo';
      } else if (streak >= 7) {
        this.streakMilestoneTag.textContent = '🔥 7-Day Flame';
      } else if (streak >= 3) {
        this.streakMilestoneTag.textContent = '✨ 3-Day Spark';
      } else {
        this.streakMilestoneTag.textContent = '🌱 Daily Duo Starter';
      }
    }

    if (this.streakDescription) {
      if (streak > 0) {
        this.streakDescription.textContent = `Awesome work! You both have stayed consistent for ${streak} days in a row! Keep the spark going!`;
      } else {
        this.streakDescription.textContent = 'Complete at least one task together every day to build your duo streak!';
      }
    }
  }
}

// @ts-ignore
window.DuoCalendar = DuoCalendar;
