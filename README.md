# ✨ DuoSync — Shared To-Do & Daily Calendar for Two

> **Real-time collaborative planner designed specifically for 2 people connecting from different locations and different Wi-Fi networks.**

Whether you are partners, best friends, roommates, or study buddies living in different areas or on different networks, DuoSync keeps you completely connected in real time.

---

## 🌟 Key Features

### 1. 👥 Built for 2 Users Across Different Wi-Fi Networks
- **Zero Config Room Code**: Join the same room (e.g. `?room=our-space`) and you're immediately connected.
- **Partner Live Presence**: Real-time indicator shows when your partner is online (🟢) or last active.
- **Instant Live Sync**: Uses Server-Sent Events (SSE). When User 1 marks a task done, User 2's screen updates in real time with audio chime and joyful confetti!
- **High-Five Cheer**: Send real-time high-five cheers (🙌, 🎉, ❤️, ☕) that float emojis across both screens simultaneously.

### 2. 📝 Flexible To-Do List ("Let Users Decide What to Write")
- **Custom Tasks & Checklists**: Title, description notes, bullet points, and subtasks.
- **Assignee Control**: Assign tasks to **Partner 1**, **Partner 2**, or **Both Together**.
- **Tags & Categories**: Built-in and customizable tags (*General*, *Home & Groceries*, *Work / Study*, *Date & Fun*, *Health & Habits*).
- **Priorities & Due Dates**: Mark tasks as *Normal*, *High*, *Urgent*, or *Low* with visual alert badges.
- **Smart Filters**: Filter by *Today & Due*, *Assigned to Me*, *Assigned to Partner*, *Together*, or search by keyword.

### 3. 📅 Every Day Calendar & Habit Planner ("Every Day Calender Try")
- **Interactive Monthly Grid**: View all scheduled tasks at a glance with completion status dots.
- **Daily Planner View**: Click any day to see scheduled tasks and add date-specific goals.
- **Daily Duo Streak Tracker**: Tracks consecutive days you both complete tasks together (🔥 *5-Day Streak!*).
- **Daily Mood & Notes Check-in**:
  - Partner 1's thought / daily goal / mood for today (😊, ⚡, 😴, ☕, ❤️).
  - Partner 2's thought / daily goal / mood for today.
  - Shared daily gratitude / reflection memory.

### 4. 🗒️ Shared Scratchpad & Activity Timeline
- Freeform shared memo board for grocery lists, links, movie ideas, or quick thoughts.
- Live activity timeline tracking recent edits, completions, and cheers.

---

## 🚀 How to Run & Connect from Different Wi-Fi Networks

### Option A: Instant 1-Click Public Link (Recommended)
You do not need to install any extra tunneling software. Windows includes built-in OpenSSH:

1. Double-click **`share.bat`** (or in PowerShell run `.\share.ps1`).
2. The script starts the server and generates a secure public HTTPS link (via `localhost.run`):
   ```
   📱 SEND THIS LINK TO YOUR PARTNER:
      👉 https://xxxx.lhr.life/?room=our-space&user=user2
   ```
3. Send this link to your partner over WhatsApp, Telegram, or Email.
4. Your partner can open it on their **phone or computer anywhere in the world on any Wi-Fi or mobile data**!
5. Both of you will instantly sync and see each other's live changes!

---

### Option B: Run Locally on the Same Wi-Fi
If you are on the same local Wi-Fi or just testing:
1. Double-click **`start.bat`** or run:
   ```bash
   agy-node server.js
   ```
   *(or `node server.js`)*
2. Open in your browser:
   - User 1: [http://localhost:3000/?room=our-space&user=user1](http://localhost:3000/?room=our-space&user=user1)
   - User 2: [http://localhost:3000/?room=our-space&user=user2](http://localhost:3000/?room=our-space&user=user2)

---

### 4. 💬 Private Duo Chat Room (Real-Time Messaging)
- **Instant Live Chat**: Private, real-time messaging between Partner 1 and Partner 2 without needing external chat apps.
- **Partner Typing Indicator**: Live animated typing bubbles show when your partner is typing in real time.
- **Quick Emojis Bar**: 1-tap reactions (`❤️`, `🎉`, `😂`, `👍`, `🔥`, `☕`, `🍕`, `🙌`).
- **Floating Quick Chat Launcher**: Floating action button allows opening chat from any tab with unread notification badges.
- **Chimes & Notifications**: Synthesized soft water-droplet chimes and browser push alerts on new incoming messages.

### 5. ⚡ Zero-Refresh Instant Synchronization
- **No Page Refresh Needed**: Tasks, subtasks, scratchpad edits, and daily check-ins update on the other screen **the exact instant they are made**.
- **Resilient SSE + Anti-Buffering**: High-performance Server-Sent Events with proxy-bypass headers (`X-Accel-Buffering: no`, 10s keepalives, and immediate socket flush).
- **Service Worker Bypass for Live Streams**: Dynamic API/SSE streams bypass service worker caching to prevent stream freezes or sleep timeouts on mobile devices.
- **Automatic Reconnection & State Recovery Watchdogs**: Detects background tab sleeps, mobile screen lock/unlock, or brief network dropouts and automatically resynchronizes state immediately upon return.
- **Cursor-Safe Scratchpad Sync**: Allows real-time shared scratchpad updates without stealing or disrupting active typing focus.

### 6. 🔁 Recurring Tasks & Routines
- **Daily, Weekly, and Monthly repeats**: When you check off a recurring chore or medication task, DuoSync marks the current one complete and automatically spawns the next occurrence for the future date with checklist items ready.
- **Visual recurrence badges** (`🔁 Daily`, `📅 Weekly`, `🗓️ Monthly`).

### 7. 🔔 Friendly Partner Nudges & Reminders
- One-click **"🔔 Nudge"** button next to tasks to send an instant, cheerful reminder alert across both devices without switching to messaging apps.
- Synthesized dual-tone bell chime and floating reminder banner.

### 8. 🔒 Room Passcode / PIN Protection
- Optional 4-digit PIN lock screen protects private duo spaces from unauthorized viewers.
- Easy to enable, modify, or remove in Space Settings.

### 9. 📲 Progressive Web App (PWA) & Web Push
- **Add to Home Screen** on iOS and Android for a full-screen, native app experience without browser URL bars.
- Service Worker (`sw.js`) caches static assets for lightning-fast loads and offline resilience.
- Browser notification support for task completions, nudges, and cheers.

### 10. 🗒️ Database-Backed Shared Scratchpad & 1-Click Backup
- Freeform shared memo board for grocery lists, links, movie ideas, or quick thoughts synced directly through the SQLite database in real time.
- **1-Click JSON Backup**: Download complete room state anytime.
- **1-Click Markdown Journal**: Export all active & completed tasks, memories, chat history, and daily notes formatted for journaling.
- **Quick Groceries Filter Pill**: Instant 1-tap view of your shared grocery and household shopping list.

---

## 🚀 How to Run & Connect from Different Wi-Fi Networks

### Option A: Instant 1-Click Public Link (Recommended)
You do not need to install any extra tunneling software. Windows includes built-in OpenSSH:

1. Double-click **`share.bat`** (or in PowerShell run `.\share.ps1`).
2. The script starts the server and generates a secure public HTTPS link (via Cloudflare Tunnel):
   ```
   📱 SEND THIS LINK TO YOUR PARTNER:
      👉 https://xxxx.trycloudflare.com/?room=our-space&user=user2
   ```
3. Send this link to your partner over WhatsApp, Telegram, or Email.
4. Your partner can open it on their **phone or computer anywhere in the world on any Wi-Fi or mobile data**!
5. Both of you will instantly sync and see each other's live changes!

---

### Option B: Run Locally on the Same Wi-Fi
If you are on the same local Wi-Fi or just testing:
1. Double-click **`start.bat`** or run:
   ```bash
   agy-node server.js
   ```
   *(or `node server.js`)*
2. Open in your browser:
   - User 1: [http://localhost:3000/?room=our-space&user=user1](http://localhost:3000/?room=our-space&user=user1)
   - User 2: [http://localhost:3000/?room=our-space&user=user2](http://localhost:3000/?room=our-space&user=user2)

---

### Option C: 24/7 Free Cloud Hosting (Render, Railway, Glitch)
If you want the app running online 24/7 without needing your personal computer on:
1. Create a free account on [Render.com](https://render.com) or [Railway.app](https://railway.app).
2. Connect this repository / upload folder.
3. Start command: `node server.js`.
4. Render gives you a permanent free URL (e.g. `https://your-duosync.onrender.com`).
5. Share `https://your-duosync.onrender.com/?room=our-space` with your partner!

---

## 🛠️ Tech Stack & Architecture

- **Backend**: Node.js (`server.js`) with built-in `node:sqlite` (SQLite database for persistent offline/online storage). Zero npm dependencies required!
- **Real-Time Engine**: HTTP Server-Sent Events (SSE) with room-based broadcast and client presence heartbeat.
- **Frontend**: Vanilla JavaScript (`app.js`, `calendar.js`), responsive modern CSS (`styles.css`), Plus Jakarta Sans typography, and Web Audio API synthesized chimes.
- **PWA**: Service Worker (`sw.js`), web manifest (`manifest.json`), custom vector and raster icons.
- **Storage**: `data/duosync.db` (auto-created SQLite database with WAL mode).

---

## 🔒 Privacy & Data
- All tasks, daily notes, and scratchpad data are stored locally in your SQLite database.
- Each room is isolated by its unique Room ID with optional 4-digit PIN protection.
- Data exportable at any time in standard JSON or Markdown.
