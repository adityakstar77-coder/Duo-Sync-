// @ts-check
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.VERCEL ? path.join('/tmp', 'duosync-data') : path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize SQLite database
const db = new DatabaseSync(path.join(DATA_DIR, 'duosync.db'));

// Setup tables
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    user1_name TEXT DEFAULT 'User 1',
    user2_name TEXT DEFAULT 'User 2',
    user1_color TEXT DEFAULT '#4f46e5',
    user2_color TEXT DEFAULT '#ec4899',
    user1_avatar TEXT DEFAULT '🦊',
    user2_avatar TEXT DEFAULT '🐼',
    user1_status TEXT DEFAULT '',
    user2_status TEXT DEFAULT '',
    user1_status_time INTEGER DEFAULT 0,
    user2_status_time INTEGER DEFAULT 0,
    pin_code TEXT DEFAULT '',
    scratchpad TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    last_active INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT DEFAULT '',
    category TEXT DEFAULT 'General',
    priority TEXT DEFAULT 'normal',
    assigned_to TEXT DEFAULT 'both',
    due_date TEXT,
    due_time TEXT,
    is_completed INTEGER DEFAULT 0,
    completed_by TEXT,
    completed_at INTEGER,
    subtasks TEXT DEFAULT '[]',
    recurring TEXT DEFAULT 'none',
    created_by TEXT,
    created_at INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    user1_done INTEGER DEFAULT 0,
    user2_done INTEGER DEFAULT 0,
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS daily_logs (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    date TEXT NOT NULL,
    user1_note TEXT DEFAULT '',
    user2_note TEXT DEFAULT '',
    user1_mood TEXT DEFAULT '',
    user2_mood TEXT DEFAULT '',
    reflection TEXT DEFAULT '',
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',
    icon TEXT DEFAULT '📌',
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_avatar TEXT DEFAULT '💬',
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room_id, created_at);
`);

// Safe migrations for existing databases
try { db.exec("ALTER TABLE rooms ADD COLUMN pin_code TEXT DEFAULT '';"); } catch (e) {}
try { db.exec("ALTER TABLE rooms ADD COLUMN scratchpad TEXT DEFAULT '';"); } catch (e) {}
try { db.exec("ALTER TABLE rooms ADD COLUMN user1_status TEXT DEFAULT '';"); } catch (e) {}
try { db.exec("ALTER TABLE rooms ADD COLUMN user2_status TEXT DEFAULT '';"); } catch (e) {}
try { db.exec("ALTER TABLE rooms ADD COLUMN user1_status_time INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE rooms ADD COLUMN user2_status_time INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE tasks ADD COLUMN recurring TEXT DEFAULT 'none';"); } catch (e) {}
try { db.exec("ALTER TABLE tasks ADD COLUMN user1_done INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE tasks ADD COLUMN user2_done INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("UPDATE tasks SET due_date = strftime('%Y-%m-%d', datetime(created_at/1000, 'unixepoch')) WHERE due_date IS NULL OR due_date = '';"); } catch (e) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room_id, created_at);"); } catch (e) {}

// SSE connections map: roomId -> Set of client objects { res, userId, userName }
const sseClients = new Map();

function broadcast(roomId, eventType, data, excludeClient = null) {
  const clients = sseClients.get(roomId);
  if (!clients || clients.size === 0) return;
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  const deadClients = [];
  for (const client of clients) {
    if (client === excludeClient || client.res === excludeClient) continue;
    try {
      if (client.res.destroyed || client.res.writableEnded) {
        deadClients.push(client);
        continue;
      }
      client.res.write(payload);
      if (typeof client.res.flush === 'function') {
        client.res.flush();
      }
    } catch (e) {
      deadClients.push(client);
    }
  }
  for (const dead of deadClients) {
    clients.delete(dead);
  }
}

function getRoomOnlineUsers(roomId) {
  const clients = sseClients.get(roomId);
  if (!clients) return [];
  const users = [];
  for (const client of clients) {
    if (client.userId && !users.includes(client.userId)) {
      users.push(client.userId);
    }
  }
  return users;
}

function logActivity(roomId, actor, action, details = '') {
  try {
    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(`
      INSERT INTO activity_log (id, room_id, actor, action, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, roomId, actor, action, details, now);

    broadcast(roomId, 'activity', {
      id,
      roomId,
      actor,
      action,
      details,
      created_at: now
    });
  } catch (err) {
    console.error('Error logging activity:', err);
  }
}

// Helpers
function getRoom(roomId) {
  return db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
}

function getSafeRoom(room) {
  if (!room) return null;
  return {
    id: room.id,
    user1_name: room.user1_name,
    user2_name: room.user2_name,
    user1_color: room.user1_color,
    user2_color: room.user2_color,
    user1_avatar: room.user1_avatar,
    user2_avatar: room.user2_avatar,
    user1_status: room.user1_status || '',
    user2_status: room.user2_status || '',
    user1_status_time: room.user1_status_time || 0,
    user2_status_time: room.user2_status_time || 0,
    has_pin: Boolean(room.pin_code && room.pin_code.trim().length > 0),
    scratchpad: room.scratchpad || '',
    created_at: room.created_at,
    last_active: room.last_active
  };
}

function ensureRoom(roomId) {
  let room = getRoom(roomId);
  if (!room) {
    const now = Date.now();
    db.prepare(`
      INSERT INTO rooms (id, user1_name, user2_name, user1_color, user2_color, user1_avatar, user2_avatar, user1_status, user2_status, user1_status_time, user2_status_time, pin_code, scratchpad, created_at, last_active)
      VALUES (?, 'Partner 1', 'Partner 2', '#4f46e5', '#ec4899', '🦊', '🐼', '', '', 0, 0, '', '', ?, ?)
    `).run(roomId, now, now);

    // Insert default categories
    const defaultCats = [
      { name: 'General', color: '#6366f1', icon: '📝' },
      { name: 'Home & Groceries', color: '#10b981', icon: '🛒' },
      { name: 'Work / Study', color: '#f59e0b', icon: '💼' },
      { name: 'Date & Fun', color: '#ec4899', icon: '✨' },
      { name: 'Health & Habits', color: '#06b6d4', icon: '💪' }
    ];

    const insertCat = db.prepare('INSERT INTO categories (id, room_id, name, color, icon) VALUES (?, ?, ?, ?, ?)');
    for (const c of defaultCats) {
      insertCat.run(crypto.randomUUID(), roomId, c.name, c.color, c.icon);
    }

    room = getRoom(roomId);
  }
  return room;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, filePath) {
  let safeRelPath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  if (safeRelPath.startsWith(path.sep)) safeRelPath = safeRelPath.slice(1);

  // Check in PUBLIC_DIR first
  let targetPath = path.join(PUBLIC_DIR, safeRelPath);

  // Fallback check: if not in PUBLIC_DIR, check in root folder (__dirname)
  if (!fs.existsSync(targetPath)) {
    const rootCandidate = path.join(__dirname, safeRelPath);
    const disallowed = ['server.js', 'package.json', 'package-lock.json', 'Dockerfile', 'render.yaml', '.replit', 'replit.nix'];
    const baseName = path.basename(rootCandidate);
    if (fs.existsSync(rootCandidate) && !disallowed.includes(baseName) && !safeRelPath.startsWith('data')) {
      targetPath = rootCandidate;
    }
  }

  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
    targetPath = path.join(targetPath, 'index.html');
  }

  if (!fs.existsSync(targetPath)) {
    // SPA fallback: check for index.html in public, then in root
    if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
      targetPath = path.join(PUBLIC_DIR, 'index.html');
    } else if (fs.existsSync(path.join(__dirname, 'index.html'))) {
      targetPath = path.join(__dirname, 'index.html');
    } else {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>DuoSync — Missing public/index.html</title></head>
        <body style="font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:4rem 1.5rem;background:#0f172a;color:#f8fafc;line-height:1.6;">
          <h2 style="color:#ef4444;margin-bottom:0.5rem;">⚠️ DuoSync: public/index.html is missing</h2>
          <p style="color:#94a3b8;max-width:500px;margin:0 auto 1.5rem auto;">
            The server started cleanly, but the <strong>public</strong> folder was not found.
          </p>
          <div style="background:#1e293b;display:inline-block;padding:1.25rem 2rem;border-radius:12px;border:1px solid #334155;text-align:left;">
            <strong>To fix this on Replit / GitHub:</strong>
            <ol style="margin:0.5rem 0 0 1rem;padding:0;color:#cbd5e1;">
              <li>Upload the <code>public</code> folder from your project into the project root.</li>
              <li>Or create a folder named <code>public</code> and move <code>index.html</code>, <code>styles.css</code>, <code>app.js</code>, and <code>calendar.js</code> into it.</li>
            </ol>
          </div>
        </body>
        </html>
      `);
      return;
    }
  }

  const ext = path.extname(targetPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  
  try {
    const content = fs.readFileSync(targetPath);
    const isCodeAsset = ext === '.html' || ext === '.js' || ext === '.css' || targetPath.endsWith('sw.js') || targetPath.endsWith('manifest.json');
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': isCodeAsset ? 'no-cache, no-store, must-revalidate' : 'public, max-age=86400'
    };
    if (targetPath.endsWith('sw.js')) {
      headers['Service-Worker-Allowed'] = '/';
    }
    res.writeHead(200, headers);
    res.end(content);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server Error');
  }
}

// Request dispatcher
const server = http.createServer(async (req, res) => {
  // Enable CORS for cross-origin or tunnel usage
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // SSE Event Stream endpoint: /api/rooms/:roomId/events
  const sseMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/events$/);
  if (sseMatch && req.method === 'GET') {
    const roomId = decodeURIComponent(sseMatch[1]);
    const userId = parsedUrl.searchParams.get('userId') || 'guest';
    const userName = parsedUrl.searchParams.get('userName') || 'Partner';

    ensureRoom(roomId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform, no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    if (req.socket) {
      req.socket.setKeepAlive(true, 5000);
      req.socket.setTimeout(0);
    }

    res.write(`event: connected\ndata: ${JSON.stringify({ type: 'connected', roomId, timestamp: Date.now() })}\n\n`);
    if (typeof res.flush === 'function') res.flush();

    if (!sseClients.has(roomId)) {
      sseClients.set(roomId, new Set());
    }

    const clientObj = { res, userId, userName };
    sseClients.get(roomId).add(clientObj);

    // Broadcast that partner came online
    broadcast(roomId, 'presence', {
      type: 'user_joined',
      userId,
      userName,
      onlineUsers: getRoomOnlineUsers(roomId)
    }, clientObj);

    // Keepalive ping every 10 seconds to keep tunnels, proxies, and mobile sockets active
    const pingInterval = setInterval(() => {
      try {
        if (res.destroyed || res.writableEnded) {
          clearInterval(pingInterval);
          return;
        }
        res.write(': keepalive\n\n');
        if (typeof res.flush === 'function') res.flush();
      } catch (err) {
        clearInterval(pingInterval);
      }
    }, 10000);

    req.on('close', () => {
      clearInterval(pingInterval);
      const clients = sseClients.get(roomId);
      if (clients) {
        clients.delete(clientObj);
        if (clients.size === 0) {
          sseClients.delete(roomId);
        } else {
          broadcast(roomId, 'presence', {
            type: 'user_left',
            userId,
            userName,
            onlineUsers: getRoomOnlineUsers(roomId)
          });
        }
      }
    });

    return;
  }

  // API Routes
  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');

    try {
      // 1. Get room full state: GET /api/rooms/:roomId/state
      const stateMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/state$/);
      if (stateMatch && req.method === 'GET') {
        const roomId = decodeURIComponent(stateMatch[1]);
        const room = ensureRoom(roomId);
        const tasks = db.prepare('SELECT * FROM tasks WHERE room_id = ? ORDER BY is_completed ASC, sort_order ASC, created_at DESC').all(roomId);
        const categories = db.prepare('SELECT * FROM categories WHERE room_id = ?').all(roomId);
        const today = new Date().toISOString().split('T')[0];
        const todayLog = db.prepare('SELECT * FROM daily_logs WHERE room_id = ? AND date = ?').get(roomId, today) || null;
        const activities = db.prepare('SELECT * FROM activity_log WHERE room_id = ? ORDER BY created_at DESC LIMIT 20').all(roomId);
        const messages = db.prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY created_at ASC LIMIT 100').all(roomId);

        // Parse subtasks JSON
        for (const t of tasks) {
          try {
            t.subtasks = JSON.parse(t.subtasks || '[]');
          } catch (e) {
            t.subtasks = [];
          }
        }

        res.writeHead(200);
        res.end(JSON.stringify({
          room: getSafeRoom(room),
          tasks,
          categories,
          todayLog,
          activities,
          messages,
          scratchpad: room.scratchpad || '',
          onlineUsers: getRoomOnlineUsers(roomId)
        }));
        return;
      }

      // 2. Update room profile / user names: PUT /api/rooms/:roomId/profile
      const profileMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/profile$/);
      if (profileMatch && req.method === 'PUT') {
        const roomId = decodeURIComponent(profileMatch[1]);
        const data = await parseJsonBody(req);
        ensureRoom(roomId);

        db.prepare(`
          UPDATE rooms SET 
            user1_name = COALESCE(?, user1_name),
            user2_name = COALESCE(?, user2_name),
            user1_color = COALESCE(?, user1_color),
            user2_color = COALESCE(?, user2_color),
            user1_avatar = COALESCE(?, user1_avatar),
            user2_avatar = COALESCE(?, user2_avatar),
            user1_status = COALESCE(?, user1_status),
            user2_status = COALESCE(?, user2_status),
            last_active = ?
          WHERE id = ?
        `).run(
          data.user1_name || null,
          data.user2_name || null,
          data.user1_color || null,
          data.user2_color || null,
          data.user1_avatar || null,
          data.user2_avatar || null,
          data.user1_status !== undefined ? data.user1_status : null,
          data.user2_status !== undefined ? data.user2_status : null,
          Date.now(),
          roomId
        );

        const updatedRoom = getRoom(roomId);
        const safeUpdated = getSafeRoom(updatedRoom);
        broadcast(roomId, 'room_updated', safeUpdated);
        logActivity(roomId, data.updated_by || 'Partner', 'updated room profile');

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, room: safeUpdated }));
        return;
      }

      // 2b. Update partner status: PUT /api/rooms/:roomId/status
      const statusMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/status$/);
      if (statusMatch && req.method === 'PUT') {
        const roomId = decodeURIComponent(statusMatch[1]);
        const data = await parseJsonBody(req);
        const room = ensureRoom(roomId);
        const user = data.user === 'user2' ? 'user2' : 'user1';
        const rawStatus = typeof data.status === 'string' ? data.status.trim().substring(0, 80) : '';
        const now = Date.now();

        if (user === 'user1') {
          db.prepare('UPDATE rooms SET user1_status = ?, user1_status_time = ?, last_active = ? WHERE id = ?').run(rawStatus, now, now, roomId);
        } else {
          db.prepare('UPDATE rooms SET user2_status = ?, user2_status_time = ?, last_active = ? WHERE id = ?').run(rawStatus, now, now, roomId);
        }

        const updatedRoom = getRoom(roomId);
        const safeRoom = getSafeRoom(updatedRoom);
        const userName = user === 'user1' ? updatedRoom.user1_name : updatedRoom.user2_name;

        // Broadcast dedicated status event and updated room
        broadcast(roomId, 'status_updated', {
          userId: user,
          userName,
          status: rawStatus,
          status_time: now,
          room: safeRoom
        });
        broadcast(roomId, 'room_updated', safeRoom);

        if (rawStatus) {
          logActivity(roomId, userName, `is now ${rawStatus}`);
        } else {
          logActivity(roomId, userName, 'cleared their status');
        }

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, room: safeRoom }));
        return;
      }

      // 3. Create task: POST /api/rooms/:roomId/tasks
      const tasksMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/tasks$/);
      if (tasksMatch && req.method === 'POST') {
        const roomId = decodeURIComponent(tasksMatch[1]);
        ensureRoom(roomId);
        const data = await parseJsonBody(req);

        if (!data.title || !data.title.trim()) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Title is required' }));
          return;
        }

        const taskId = crypto.randomUUID();
        const now = Date.now();
        const subtasksJson = JSON.stringify(data.subtasks || []);

        const taskDueDate = data.due_date || new Date().toISOString().split('T')[0];

        db.prepare(`
          INSERT INTO tasks (
            id, room_id, title, notes, category, priority, assigned_to,
            due_date, due_time, is_completed, subtasks, recurring, created_by, created_at, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0)
        `).run(
          taskId,
          roomId,
          data.title.trim(),
          data.notes || '',
          data.category || 'General',
          data.priority || 'normal',
          data.assigned_to || 'both',
          taskDueDate,
          data.due_time || null,
          subtasksJson,
          data.recurring || 'none',
          data.created_by || 'Partner',
          now
        );

        const newTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
        try { newTask.subtasks = JSON.parse(newTask.subtasks); } catch(e) { newTask.subtasks = []; }

        broadcast(roomId, 'task_created', newTask);
        logActivity(roomId, data.created_by || 'Partner', 'added a task', newTask.title);

        res.writeHead(201);
        res.end(JSON.stringify({ success: true, task: newTask }));
        return;
      }

      // 4. Update task: PUT /api/rooms/:roomId/tasks/:taskId
      const taskItemMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/tasks\/([^/]+)$/);
      if (taskItemMatch && req.method === 'PUT') {
        const roomId = decodeURIComponent(taskItemMatch[1]);
        const taskId = decodeURIComponent(taskItemMatch[2]);
        const data = await parseJsonBody(req);

        const existing = db.prepare('SELECT * FROM tasks WHERE id = ? AND room_id = ?').get(taskId, roomId);
        if (!existing) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Task not found' }));
          return;
        }

        const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) || {};

        let user1Done = existing.user1_done !== undefined ? existing.user1_done : (existing.is_completed ? 1 : 0);
        let user2Done = existing.user2_done !== undefined ? existing.user2_done : (existing.is_completed ? 1 : 0);

        if (data.user_action === 'user1' || data.toggle_user === 'user1') {
          user1Done = data.is_checked ? 1 : 0;
        } else if (data.user_action === 'user2' || data.toggle_user === 'user2') {
          user2Done = data.is_checked ? 1 : 0;
        } else {
          if (data.user1_done !== undefined) user1Done = data.user1_done ? 1 : 0;
          if (data.user2_done !== undefined) user2Done = data.user2_done ? 1 : 0;
        }

        const assignedTo = data.assigned_to || existing.assigned_to || 'both';

        let isCompleted;
        let completedBy = existing.completed_by;
        let completedAt = existing.completed_at;

        if (data.is_completed !== undefined && data.user_action === undefined && data.user1_done === undefined && data.user2_done === undefined) {
          isCompleted = data.is_completed ? 1 : 0;
          if (isCompleted) {
            user1Done = 1;
            user2Done = 1;
            completedBy = data.completed_by || existing.completed_by || 'Partner';
            completedAt = completedAt || Date.now();
          } else {
            user1Done = 0;
            user2Done = 0;
            completedBy = null;
            completedAt = null;
          }
        } else {
          if (assignedTo === 'user1') {
            isCompleted = user1Done ? 1 : 0;
            completedBy = isCompleted ? (data.completed_by || room.user1_name || 'Partner 1') : null;
          } else if (assignedTo === 'user2') {
            isCompleted = user2Done ? 1 : 0;
            completedBy = isCompleted ? (data.completed_by || room.user2_name || 'Partner 2') : null;
          } else {
            // assigned_to === 'both'
            if (user1Done === 1 && user2Done === 1) {
              isCompleted = 1;
              completedBy = 'Both';
            } else {
              isCompleted = 0;
              if (user1Done === 1) completedBy = room.user1_name || 'Partner 1';
              else if (user2Done === 1) completedBy = room.user2_name || 'Partner 2';
              else completedBy = null;
            }
          }
          if (isCompleted && !completedAt) completedAt = Date.now();
          if (!isCompleted) completedAt = null;
        }

        const subtasksJson = data.subtasks ? JSON.stringify(data.subtasks) : existing.subtasks;

        db.prepare(`
          UPDATE tasks SET
            title = COALESCE(?, title),
            notes = COALESCE(?, notes),
            category = COALESCE(?, category),
            priority = COALESCE(?, priority),
            assigned_to = COALESCE(?, assigned_to),
            due_date = ?,
            due_time = ?,
            is_completed = ?,
            completed_by = ?,
            completed_at = ?,
            subtasks = ?,
            recurring = COALESCE(?, recurring),
            sort_order = COALESCE(?, sort_order),
            user1_done = ?,
            user2_done = ?
          WHERE id = ? AND room_id = ?
        `).run(
          data.title ? data.title.trim() : null,
          data.notes !== undefined ? data.notes : null,
          data.category || null,
          data.priority || null,
          data.assigned_to || null,
          data.due_date !== undefined ? data.due_date : existing.due_date,
          data.due_time !== undefined ? data.due_time : existing.due_time,
          isCompleted,
          completedBy,
          completedAt,
          subtasksJson,
          data.recurring || null,
          data.sort_order !== undefined ? data.sort_order : null,
          user1Done,
          user2Done,
          taskId,
          roomId
        );

        const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
        try { updated.subtasks = JSON.parse(updated.subtasks); } catch(e) { updated.subtasks = []; }

        broadcast(roomId, 'task_updated', updated);

        // Auto-spawn next occurrence for recurring tasks when completed
        let spawnedTask = null;
        if (existing.is_completed === 0 && isCompleted === 1 && updated.recurring && updated.recurring !== 'none') {
          try {
            let nextDueDate = null;
            const baseDate = updated.due_date ? new Date(updated.due_date + 'T12:00:00') : new Date();
            if (updated.recurring === 'daily') {
              baseDate.setDate(baseDate.getDate() + 1);
            } else if (updated.recurring === 'weekly') {
              baseDate.setDate(baseDate.getDate() + 7);
            } else if (updated.recurring === 'monthly') {
              baseDate.setMonth(baseDate.getMonth() + 1);
            }
            const y = baseDate.getFullYear();
            const m = String(baseDate.getMonth() + 1).padStart(2, '0');
            const d = String(baseDate.getDate()).padStart(2, '0');
            nextDueDate = `${y}-${m}-${d}`;

            // Reset subtasks completion
            let resetSubtasks = [];
            try {
              resetSubtasks = updated.subtasks.map(s => ({ ...s, completed: false }));
            } catch (e) {
              resetSubtasks = [];
            }

            const nextTaskId = crypto.randomUUID();
            const now = Date.now();
            db.prepare(`
              INSERT INTO tasks (
                id, room_id, title, notes, category, priority, assigned_to,
                due_date, due_time, is_completed, subtasks, recurring, created_by, created_at, sort_order
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0)
            `).run(
              nextTaskId,
              roomId,
              updated.title,
              updated.notes,
              updated.category,
              updated.priority,
              updated.assigned_to,
              nextDueDate,
              updated.due_time,
              JSON.stringify(resetSubtasks),
              updated.recurring,
              '🔁 Auto-recurring',
              now
            );

            spawnedTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(nextTaskId);
            try { spawnedTask.subtasks = JSON.parse(spawnedTask.subtasks); } catch (e) { spawnedTask.subtasks = []; }
            broadcast(roomId, 'task_created', spawnedTask);
            logActivity(roomId, '🔁 Auto-recurring', `spawned next recurrence for "${updated.title}" due ${nextDueDate}`);
          } catch (recurError) {
            console.error('Error auto-spawning recurring task:', recurError);
          }
        }

        if (existing.is_completed === 0 && isCompleted === 1) {
          logActivity(roomId, completedBy, 'completed', updated.title);
        } else if (existing.is_completed === 1 && isCompleted === 0) {
          logActivity(roomId, data.updated_by || 'Partner', 'reopened', updated.title);
        } else {
          logActivity(roomId, data.updated_by || 'Partner', 'updated', updated.title);
        }

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, task: updated, spawnedTask }));
        return;
      }

      // 5. Delete task: DELETE /api/rooms/:roomId/tasks/:taskId
      if (taskItemMatch && req.method === 'DELETE') {
        const roomId = decodeURIComponent(taskItemMatch[1]);
        const taskId = decodeURIComponent(taskItemMatch[2]);
        const parsedUrlQuery = parsedUrl.searchParams;
        const deletedBy = parsedUrlQuery.get('user') || 'Partner';

        const existing = db.prepare('SELECT * FROM tasks WHERE id = ? AND room_id = ?').get(taskId, roomId);
        if (existing) {
          db.prepare('DELETE FROM tasks WHERE id = ? AND room_id = ?').run(taskId, roomId);
          broadcast(roomId, 'task_deleted', { id: taskId, title: existing.title });
          logActivity(roomId, deletedBy, 'deleted task', existing.title);
        }

        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // 6. Calendar tasks and logs by month: GET /api/rooms/:roomId/calendar?month=YYYY-MM
      const calendarMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/calendar$/);
      if (calendarMatch && req.method === 'GET') {
        const roomId = decodeURIComponent(calendarMatch[1]);
        const month = parsedUrl.searchParams.get('month'); // e.g. 2026-09
        if (!month) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'month parameter required (YYYY-MM)' }));
          return;
        }

        const tasks = db.prepare(`
          SELECT * FROM tasks 
          WHERE room_id = ? AND due_date LIKE ?
          ORDER BY due_time ASC, created_at ASC
        `).all(roomId, `${month}%`);

        for (const t of tasks) {
          try { t.subtasks = JSON.parse(t.subtasks || '[]'); } catch(e) { t.subtasks = []; }
        }

        const logs = db.prepare(`
          SELECT * FROM daily_logs 
          WHERE room_id = ? AND date LIKE ?
        `).all(roomId, `${month}%`);

        res.writeHead(200);
        res.end(JSON.stringify({ tasks, logs }));
        return;
      }

      // 7. Daily entry (Get/Put): /api/rooms/:roomId/daily/:date
      const dailyMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/daily\/([0-9]{4}-[0-9]{2}-[0-9]{2})$/);
      if (dailyMatch && req.method === 'GET') {
        const roomId = decodeURIComponent(dailyMatch[1]);
        const date = dailyMatch[2];
        const log = db.prepare('SELECT * FROM daily_logs WHERE room_id = ? AND date = ?').get(roomId, date) || {
          room_id: roomId,
          date,
          user1_note: '',
          user2_note: '',
          user1_mood: '',
          user2_mood: '',
          reflection: '',
          updated_at: Date.now()
        };
        const dayTasks = db.prepare('SELECT * FROM tasks WHERE room_id = ? AND due_date = ?').all(roomId, date);
        for (const t of dayTasks) {
          try { t.subtasks = JSON.parse(t.subtasks || '[]'); } catch(e) { t.subtasks = []; }
        }

        res.writeHead(200);
        res.end(JSON.stringify({ log, tasks: dayTasks }));
        return;
      }

      if (dailyMatch && req.method === 'PUT') {
        const roomId = decodeURIComponent(dailyMatch[1]);
        const date = dailyMatch[2];
        const data = await parseJsonBody(req);
        ensureRoom(roomId);
        const logId = `${roomId}_${date}`;
        const now = Date.now();

        const existing = db.prepare('SELECT * FROM daily_logs WHERE id = ?').get(logId);
        if (existing) {
          db.prepare(`
            UPDATE daily_logs SET
              user1_note = COALESCE(?, user1_note),
              user2_note = COALESCE(?, user2_note),
              user1_mood = COALESCE(?, user1_mood),
              user2_mood = COALESCE(?, user2_mood),
              reflection = COALESCE(?, reflection),
              updated_at = ?
            WHERE id = ?
          `).run(
            data.user1_note !== undefined ? data.user1_note : null,
            data.user2_note !== undefined ? data.user2_note : null,
            data.user1_mood !== undefined ? data.user1_mood : null,
            data.user2_mood !== undefined ? data.user2_mood : null,
            data.reflection !== undefined ? data.reflection : null,
            now,
            logId
          );
        } else {
          db.prepare(`
            INSERT INTO daily_logs (id, room_id, date, user1_note, user2_note, user1_mood, user2_mood, reflection, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            logId,
            roomId,
            date,
            data.user1_note || '',
            data.user2_note || '',
            data.user1_mood || '',
            data.user2_mood || '',
            data.reflection || '',
            now
          );
        }

        const updated = db.prepare('SELECT * FROM daily_logs WHERE id = ?').get(logId);
        broadcast(roomId, 'daily_log_updated', updated);

        if (data.actor) {
          logActivity(roomId, data.actor, `updated day notes for ${date}`);
        }

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, log: updated }));
        return;
      }

      // 8. Custom categories: POST / DELETE
      const categoriesMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/categories$/);
      if (categoriesMatch && req.method === 'POST') {
        const roomId = decodeURIComponent(categoriesMatch[1]);
        const data = await parseJsonBody(req);
        if (!data.name || !data.name.trim()) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Category name required' }));
          return;
        }

        const catId = crypto.randomUUID();
        db.prepare('INSERT INTO categories (id, room_id, name, color, icon) VALUES (?, ?, ?, ?, ?)').run(
          catId,
          roomId,
          data.name.trim(),
          data.color || '#6366f1',
          data.icon || '📌'
        );

        const newCat = db.prepare('SELECT * FROM categories WHERE id = ?').get(catId);
        broadcast(roomId, 'category_added', newCat);

        res.writeHead(201);
        res.end(JSON.stringify({ success: true, category: newCat }));
        return;
      }

      const catItemMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/categories\/([^/]+)$/);
      if (catItemMatch && req.method === 'DELETE') {
        const roomId = decodeURIComponent(catItemMatch[1]);
        const catId = decodeURIComponent(catItemMatch[2]);
        db.prepare('DELETE FROM categories WHERE id = ? AND room_id = ?').run(catId, roomId);
        broadcast(roomId, 'category_deleted', { id: catId });

        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // 9. High-five / Cheer reaction: POST /api/rooms/:roomId/cheer
      const cheerMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/cheer$/);
      if (cheerMatch && req.method === 'POST') {
        const roomId = decodeURIComponent(cheerMatch[1]);
        const data = await parseJsonBody(req);
        const cheerData = {
          actionId: data.actionId || ('cheer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)),
          fromUserId: data.fromUserId || 'user1',
          from: data.from || 'Partner',
          fromAvatar: data.fromAvatar || '🎉',
          emoji: data.emoji || '🎉',
          message: data.message || 'Sent a cheer!',
          timestamp: Date.now()
        };
        broadcast(roomId, 'cheer', cheerData);
        logActivity(roomId, cheerData.from, `sent ${cheerData.emoji} cheer!`);

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, cheer: cheerData }));
        return;
      }

      // 10. Partner Nudge / Ping: POST /api/rooms/:roomId/nudge
      const nudgeMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/nudge$/);
      if (nudgeMatch && req.method === 'POST') {
        const roomId = decodeURIComponent(nudgeMatch[1]);
        const data = await parseJsonBody(req);
        const nudgeData = {
          actionId: data.actionId || ('nudge_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)),
          fromUserId: data.fromUserId || 'user1',
          from: data.from || 'Partner',
          fromAvatar: data.fromAvatar || '🔔',
          taskId: data.taskId || null,
          taskTitle: data.taskTitle || 'a task',
          timestamp: Date.now()
        };
        broadcast(roomId, 'nudge', nudgeData);
        logActivity(roomId, nudgeData.from, `sent a friendly reminder for "${nudgeData.taskTitle}" 🔔`);

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, nudge: nudgeData }));
        return;
      }

      // 11. Shared Scratchpad real-time sync: PUT /api/rooms/:roomId/scratchpad
      const scratchpadMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/scratchpad$/);
      if (scratchpadMatch && req.method === 'PUT') {
        const roomId = decodeURIComponent(scratchpadMatch[1]);
        const data = await parseJsonBody(req);
        ensureRoom(roomId);
        const content = typeof data.content === 'string' ? data.content : '';
        db.prepare('UPDATE rooms SET scratchpad = ?, last_active = ? WHERE id = ?').run(content, Date.now(), roomId);
        broadcast(roomId, 'scratchpad_updated', { content, updated_by: data.updated_by || 'Partner' });

        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // 12. Verify room PIN: POST /api/rooms/:roomId/verify-pin
      const verifyPinMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/verify-pin$/);
      if (verifyPinMatch && req.method === 'POST') {
        const roomId = decodeURIComponent(verifyPinMatch[1]);
        const room = ensureRoom(roomId);
        const data = await parseJsonBody(req);
        const expectedPin = (room.pin_code || '').trim();
        if (!expectedPin) {
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, has_pin: false }));
          return;
        }
        const inputPin = (data.pin || '').toString().trim();
        const valid = inputPin === expectedPin;
        res.writeHead(200);
        res.end(JSON.stringify({ success: valid, has_pin: true }));
        return;
      }

      // 13. Set / Change / Remove room PIN: PUT /api/rooms/:roomId/pin
      const pinMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/pin$/);
      if (pinMatch && req.method === 'PUT') {
        const roomId = decodeURIComponent(pinMatch[1]);
        const room = ensureRoom(roomId);
        const data = await parseJsonBody(req);
        const currentPin = (room.pin_code || '').trim();

        // If room currently has a PIN, verify current_pin
        if (currentPin && data.current_pin !== undefined && (data.current_pin || '').toString().trim() !== currentPin) {
          res.writeHead(403);
          res.end(JSON.stringify({ error: 'Incorrect current PIN' }));
          return;
        }

        const newPin = (data.pin || '').toString().trim();
        db.prepare('UPDATE rooms SET pin_code = ?, last_active = ? WHERE id = ?').run(newPin, Date.now(), roomId);
        const updated = getRoom(roomId);
        const safeUpdated = getSafeRoom(updated);
        broadcast(roomId, 'room_updated', safeUpdated);
        logActivity(roomId, data.updated_by || 'Partner', newPin ? 'enabled room PIN protection 🔒' : 'removed room PIN 🔓');

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, has_pin: Boolean(newPin) }));
        return;
      }

      // 14. Chat Messages: GET /api/rooms/:roomId/messages?limit=100
      const messagesMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/messages$/);
      if (messagesMatch && req.method === 'GET') {
        const roomId = decodeURIComponent(messagesMatch[1]);
        ensureRoom(roomId);
        const limit = Math.min(200, Math.max(1, parseInt(parsedUrl.searchParams.get('limit') || '100', 10)));
        const messages = db.prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY created_at ASC LIMIT ?').all(roomId, limit);
        res.writeHead(200);
        res.end(JSON.stringify({ messages }));
        return;
      }

      // 15. Send Chat Message: POST /api/rooms/:roomId/messages
      if (messagesMatch && req.method === 'POST') {
        const roomId = decodeURIComponent(messagesMatch[1]);
        ensureRoom(roomId);
        const data = await parseJsonBody(req);
        const text = (data.text || '').trim();
        if (!text) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Message text is required' }));
          return;
        }

        const msgId = crypto.randomUUID();
        const now = Date.now();
        const senderId = data.sender_id || 'user1';
        const senderName = data.sender_name || 'Partner';
        const senderAvatar = data.sender_avatar || '💬';

        db.prepare(`
          INSERT INTO messages (id, room_id, sender_id, sender_name, sender_avatar, text, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(msgId, roomId, senderId, senderName, senderAvatar, text, now);

        const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
        db.prepare('UPDATE rooms SET last_active = ? WHERE id = ?').run(now, roomId);

        broadcast(roomId, 'chat_message', message);
        logActivity(roomId, senderName, 'sent a chat message', text.length > 35 ? text.substring(0, 35) + '...' : text);

        res.writeHead(201);
        res.end(JSON.stringify({ success: true, message }));
        return;
      }

      // 16. Clear Chat Messages: DELETE /api/rooms/:roomId/messages
      if (messagesMatch && req.method === 'DELETE') {
        const roomId = decodeURIComponent(messagesMatch[1]);
        const user = parsedUrl.searchParams.get('user') || 'Partner';
        db.prepare('DELETE FROM messages WHERE room_id = ?').run(roomId);
        broadcast(roomId, 'chat_cleared', { by: user });
        logActivity(roomId, user, 'cleared the chat history');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // 17. Partner Typing Indicator: POST /api/rooms/:roomId/typing
      const typingMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/typing$/);
      if (typingMatch && req.method === 'POST') {
        const roomId = decodeURIComponent(typingMatch[1]);
        const data = await parseJsonBody(req);
        broadcast(roomId, 'partner_typing', {
          userId: data.userId || 'user1',
          userName: data.userName || 'Partner',
          userAvatar: data.userAvatar || '💬',
          isTyping: Boolean(data.isTyping),
          timestamp: Date.now()
        });
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // 18. Fast Delta & State Sync Endpoint: GET /api/rooms/:roomId/sync?since=<timestamp>
      const syncMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/sync$/);
      if (syncMatch && req.method === 'GET') {
        const roomId = decodeURIComponent(syncMatch[1]);
        const room = ensureRoom(roomId);
        const since = parseInt(parsedUrl.searchParams.get('since') || '0', 10);

        const tasks = db.prepare('SELECT * FROM tasks WHERE room_id = ? ORDER BY is_completed ASC, sort_order ASC, created_at DESC').all(roomId);
        for (const t of tasks) {
          try { t.subtasks = JSON.parse(t.subtasks || '[]'); } catch (e) { t.subtasks = []; }
        }

        const messages = since > 0
          ? db.prepare('SELECT * FROM messages WHERE room_id = ? AND created_at > ? ORDER BY created_at ASC').all(roomId, since)
          : db.prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY created_at ASC LIMIT 100').all(roomId);

        res.writeHead(200);
        res.end(JSON.stringify({
          serverTime: Date.now(),
          room: getSafeRoom(room),
          scratchpad: room.scratchpad || '',
          tasks,
          messages,
          onlineUsers: getRoomOnlineUsers(roomId)
        }));
        return;
      }

      // 19. 1-Click Export: GET /api/rooms/:roomId/export
      const exportMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/export$/);
      if (exportMatch && req.method === 'GET') {
        const roomId = decodeURIComponent(exportMatch[1]);
        const room = ensureRoom(roomId);
        const tasks = db.prepare('SELECT * FROM tasks WHERE room_id = ? ORDER BY is_completed ASC, created_at DESC').all(roomId);
        for (const t of tasks) {
          try { t.subtasks = JSON.parse(t.subtasks || '[]'); } catch (e) { t.subtasks = []; }
        }
        const categories = db.prepare('SELECT * FROM categories WHERE room_id = ?').all(roomId);
        const logs = db.prepare('SELECT * FROM daily_logs WHERE room_id = ? ORDER BY date DESC').all(roomId);
        const activities = db.prepare('SELECT * FROM activity_log WHERE room_id = ? ORDER BY created_at DESC LIMIT 50').all(roomId);
        const messages = db.prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY created_at ASC').all(roomId);

        const format = parsedUrl.searchParams.get('format') || 'json';
        const dateStr = new Date().toISOString().split('T')[0];

        if (format === 'markdown') {
          let md = `# DuoSync Export — Space: ${room.id}\n`;
          md += `Generated: ${new Date().toLocaleString()}\n`;
          md += `Partners: ${room.user1_avatar} ${room.user1_name} & ${room.user2_avatar} ${room.user2_name}\n\n`;
          md += `## 📋 Active Tasks\n`;
          const activeTasks = tasks.filter(t => !t.is_completed);
          if (activeTasks.length === 0) md += `_No active tasks._\n`;
          for (const t of activeTasks) {
            md += `- [ ] **${t.title}** (Assignee: ${t.assigned_to}, Priority: ${t.priority}${t.due_date ? `, Due: ${t.due_date}` : ''})\n`;
            if (t.notes) md += `  - Note: ${t.notes}\n`;
            for (const s of (t.subtasks || [])) {
              md += `  - [${s.completed ? 'x' : ' '}] ${s.title}\n`;
            }
          }
          md += `\n## ✨ Completed Tasks\n`;
          const completedTasks = tasks.filter(t => t.is_completed);
          if (completedTasks.length === 0) md += `_No completed tasks._\n`;
          for (const t of completedTasks) {
            md += `- [x] **${t.title}** (Completed by: ${t.completed_by || 'Partner'})\n`;
          }
          md += `\n## 📝 Shared Scratchpad\n`;
          md += (room.scratchpad || '_Scratchpad empty._') + '\n\n';
          md += `## 💬 Duo Chat History\n`;
          if (messages.length === 0) {
            md += `_No messages yet._\n\n`;
          } else {
            for (const m of messages) {
              const timeStr = new Date(m.created_at).toLocaleString();
              md += `**${m.sender_avatar} ${m.sender_name}** (${timeStr}):\n> ${m.text}\n\n`;
            }
          }
          md += `## 📅 Daily Memories & Reflections\n`;
          for (const l of logs) {
            if (l.user1_note || l.user2_note || l.reflection) {
              md += `### ${l.date}\n`;
              if (l.user1_note) md += `- **${room.user1_name}**: ${l.user1_mood ? l.user1_mood + ' ' : ''}${l.user1_note}\n`;
              if (l.user2_note) md += `- **${room.user2_name}**: ${l.user2_mood ? l.user2_mood + ' ' : ''}${l.user2_note}\n`;
              if (l.reflection) md += `- **Shared Reflection**: ${l.reflection}\n`;
            }
          }

          res.writeHead(200, {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="duosync-${room.id}-${dateStr}.md"`
          });
          res.end(md);
          return;
        }

        const backupData = {
          version: '3.0',
          room: getSafeRoom(room),
          tasks,
          categories,
          dailyLogs: logs,
          activities,
          messages,
          scratchpad: room.scratchpad || '',
          exportedAt: Date.now()
        };

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="duosync-${room.id}-${dateStr}.json"`
        });
        res.end(JSON.stringify(backupData, null, 2));
        return;
      }

      // 20. Auto-Heal & Restore Endpoint: POST /api/rooms/:roomId/restore
      const restoreMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/restore$/);
      if (restoreMatch && req.method === 'POST') {
        const roomId = decodeURIComponent(restoreMatch[1]);
        const room = ensureRoom(roomId);
        const data = await parseJsonBody(req);

        let restoredTasks = 0;
        let restoredLogs = 0;
        let restoredMessages = 0;

        // 1. Restore Tasks (Upsert by ID)
        if (Array.isArray(data.tasks)) {
          const insertTask = db.prepare(`
            INSERT INTO tasks (
              id, room_id, title, notes, category, priority, assigned_to,
              due_date, due_time, is_completed, completed_by, completed_at,
              subtasks, recurring, created_by, created_at, sort_order,
              user1_done, user2_done
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              room_id = excluded.room_id,
              title = excluded.title,
              notes = excluded.notes,
              category = excluded.category,
              priority = excluded.priority,
              assigned_to = excluded.assigned_to,
              due_date = excluded.due_date,
              due_time = excluded.due_time,
              is_completed = excluded.is_completed,
              completed_by = excluded.completed_by,
              completed_at = excluded.completed_at,
              subtasks = excluded.subtasks,
              recurring = excluded.recurring,
              sort_order = excluded.sort_order,
              user1_done = excluded.user1_done,
              user2_done = excluded.user2_done
          `);

          for (const t of data.tasks) {
            if (!t.id || !t.title) continue;
            const subtasksStr = typeof t.subtasks === 'string' ? t.subtasks : JSON.stringify(t.subtasks || []);
            const u1Done = t.user1_done !== undefined ? (t.user1_done ? 1 : 0) : (t.is_completed ? 1 : 0);
            const u2Done = t.user2_done !== undefined ? (t.user2_done ? 1 : 0) : (t.is_completed ? 1 : 0);
            insertTask.run(
              t.id,
              roomId,
              t.title,
              t.notes || '',
              t.category || 'General',
              t.priority || 'normal',
              t.assigned_to || 'both',
              t.due_date || null,
              t.due_time || null,
              t.is_completed ? 1 : 0,
              t.completed_by || null,
              t.completed_at || null,
              subtasksStr,
              t.recurring || 'none',
              t.created_by || 'Partner',
              t.created_at || Date.now(),
              t.sort_order || 0,
              u1Done,
              u2Done
            );
            restoredTasks++;
          }
        }

        // 2. Restore Daily Logs
        if (data.dailyLogs) {
          const logsList = Array.isArray(data.dailyLogs) ? data.dailyLogs : Object.values(data.dailyLogs);
          for (const l of logsList) {
            if (!l.date) continue;
            const logId = l.id || `${roomId}_${l.date}`;
            const existing = db.prepare('SELECT * FROM daily_logs WHERE id = ?').get(logId);
            if (existing) {
              db.prepare(`
                UPDATE daily_logs SET
                  user1_mood = COALESCE(?, user1_mood),
                  user2_mood = COALESCE(?, user2_mood),
                  user1_note = CASE WHEN ? != '' THEN ? ELSE user1_note END,
                  user2_note = CASE WHEN ? != '' THEN ? ELSE user2_note END,
                  reflection = CASE WHEN ? != '' THEN ? ELSE reflection END,
                  updated_at = ?
                WHERE id = ?
              `).run(
                l.user1_mood || null,
                l.user2_mood || null,
                l.user1_note || '',
                l.user1_note || '',
                l.user2_note || '',
                l.user2_note || '',
                l.reflection || '',
                l.reflection || '',
                l.updated_at || Date.now(),
                logId
              );
            } else {
              db.prepare(`
                INSERT INTO daily_logs (id, room_id, date, user1_mood, user2_mood, user1_note, user2_note, reflection, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                logId,
                roomId,
                l.date,
                l.user1_mood || '',
                l.user2_mood || '',
                l.user1_note || '',
                l.user2_note || '',
                l.reflection || '',
                l.updated_at || Date.now()
              );
            }
            restoredLogs++;
          }
        }

        // 3. Restore Scratchpad
        if (data.scratchpad && !room.scratchpad) {
          db.prepare('UPDATE rooms SET scratchpad = ? WHERE id = ?').run(data.scratchpad, roomId);
        }

        // 4. Restore Room Profile
        if (data.room) {
          if (data.room.user1_name && room.user1_name === 'Partner 1') {
            db.prepare('UPDATE rooms SET user1_name = ?, user1_avatar = ?, user1_color = ? WHERE id = ?')
              .run(data.room.user1_name, data.room.user1_avatar || '🦊', data.room.user1_color || '#4f46e5', roomId);
          }
          if (data.room.user2_name && room.user2_name === 'Partner 2') {
            db.prepare('UPDATE rooms SET user2_name = ?, user2_avatar = ?, user2_color = ? WHERE id = ?')
              .run(data.room.user2_name, data.room.user2_avatar || '🐼', data.room.user2_color || '#ec4899', roomId);
          }
        }

        // 5. Restore Messages
        if (Array.isArray(data.messages)) {
          const insertMsg = db.prepare(`
            INSERT OR IGNORE INTO messages (id, room_id, sender_id, sender_name, sender_avatar, text, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
          for (const m of data.messages) {
            if (!m.id || !m.text) continue;
            insertMsg.run(
              m.id,
              roomId,
              m.sender_id || 'user1',
              m.sender_name || 'Partner',
              m.sender_avatar || '💬',
              m.text,
              m.created_at || Date.now()
            );
            restoredMessages++;
          }
        }

        db.prepare('UPDATE rooms SET last_active = ? WHERE id = ?').run(Date.now(), roomId);
        broadcast(roomId, 'state_restored', {
          restoredTasks,
          restoredLogs,
          restoredMessages,
          timestamp: Date.now()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          restoredTasks,
          restoredLogs,
          restoredMessages
        }));
        return;
      }

      // Not found in API
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
      return;

    } catch (apiError) {
      console.error('API Error:', apiError);
      res.writeHead(500);
      res.end(JSON.stringify({ error: apiError.message }));
      return;
    }
  }

  // Handle SPA room URLs: /r/:roomId serves index.html
  if (pathname.startsWith('/r/')) {
    serveStatic(req, res, 'index.html');
    return;
  }

  // Serve static files
  serveStatic(req, res, pathname.replace(/^\//, ''));
});

server.on('clientError', (err, socket) => {
  if (socket && socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  } else if (socket) {
    socket.destroy();
  }
});

if (!process.env.VERCEL) {
  server.listen(PORT, '0.0.0.0', () => {
    let localIp = '127.0.0.1';
    try {
      const os = require('node:os');
      const nets = os.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === 'IPv4' && !net.internal) {
            localIp = net.address;
            break;
          }
        }
      }
    } catch (e) {}

    console.log(`====================================================`);
    console.log(` DuoSync 2-User Collaborative Server Running!`);
    console.log(` Local URL (Your PC):        http://localhost:${PORT}`);
    console.log(` Wi-Fi / Phone URL (Home):   http://${localIp}:${PORT}`);
    console.log(`====================================================`);
  });
}

module.exports = server;
