// Automated integration test for DuoSync
const http = require('node:http');
let serverInstance;
try {
  serverInstance = require('./server.js');
} catch (e) {}

async function runTests() {
  console.log('🧪 Starting DuoSync Automated Test Suite...');
  const baseUrl = 'http://localhost:3000';
  const roomId = 'test-duo-' + Date.now();

  const request = (path, method = 'GET', body = null) => {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const req = http.request(url, {
        method,
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
          } catch(e) {
            resolve({ status: res.statusCode, headers: res.headers, body: data });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  };

  // 1. Test room state
  console.log('[1/12] Testing Room Initialization & Safe State...');
  const stateRes = await request(`/api/rooms/${roomId}/state`);
  if (stateRes.status !== 200 || !stateRes.body.room) throw new Error('Failed to get room state');
  if (stateRes.body.room.has_pin !== false) throw new Error('Expected has_pin to be false initially');
  console.log('  ✅ Room initialized with safe profile and default categories:', stateRes.body.categories.length);

  // 2. Test profile update
  console.log('[2/12] Testing Profile Customization...');
  const profRes = await request(`/api/rooms/${roomId}/profile`, 'PUT', {
    user1_name: 'Alex',
    user2_name: 'Sam',
    user1_avatar: '🦊',
    user2_avatar: '🐼'
  });
  if (profRes.body.room.user1_name !== 'Alex' || profRes.body.room.user2_name !== 'Sam') {
    throw new Error('Profile update failed');
  }
  console.log('  ✅ Users updated to Alex & Sam');

  // 3. Test Task Creation with Recurring interval
  console.log('[3/12] Testing Recurring Task Creation...');
  const todayStr = new Date().toISOString().split('T')[0];
  const taskRes = await request(`/api/rooms/${roomId}/tasks`, 'POST', {
    title: 'Water plants & take vitamins',
    notes: 'Living room plants + Vitamin D',
    category: 'Health & Habits',
    priority: 'high',
    assigned_to: 'both',
    due_date: todayStr,
    recurring: 'daily',
    created_by: 'Alex'
  });
  if (taskRes.status !== 201 || !taskRes.body.task.id) throw new Error('Task creation failed');
  const taskId = taskRes.body.task.id;
  if (taskRes.body.task.recurring !== 'daily') throw new Error('Recurring property not set');
  console.log('  ✅ Recurring daily task created:', taskId);

  // 4. Test Task Completion and Auto-Spawning Next Occurrence
  console.log('[4/12] Testing Recurring Task Auto-Spawning on Completion...');
  const toggleRes = await request(`/api/rooms/${roomId}/tasks/${taskId}`, 'PUT', {
    is_completed: true,
    completed_by: 'Sam',
    updated_by: 'Sam'
  });
  if (!toggleRes.body.task.is_completed || toggleRes.body.task.completed_by !== 'Sam') {
    throw new Error('Task completion toggle failed');
  }
  if (!toggleRes.body.spawnedTask) {
    throw new Error('Expected spawnedTask for recurring daily task');
  }
  console.log('  ✅ Task completed and spawned next daily occurrence due:', toggleRes.body.spawnedTask.due_date);

  // 5. Test Partner Nudge / Ping Endpoint
  console.log('[5/12] Testing Partner Nudge / Ping...');
  const nudgeRes = await request(`/api/rooms/${roomId}/nudge`, 'POST', {
    from: 'Alex',
    taskId: toggleRes.body.spawnedTask.id,
    taskTitle: toggleRes.body.spawnedTask.title
  });
  if (nudgeRes.status !== 200 || !nudgeRes.body.success) throw new Error('Nudge failed');
  console.log('  ✅ Nudge reminder successfully broadcasted');

  // 6. Test Real-Time Scratchpad Sync
  console.log('[6/12] Testing Database-backed Scratchpad Sync...');
  const scratchRes = await request(`/api/rooms/${roomId}/scratchpad`, 'PUT', {
    content: '- Apples\n- Sourdough Bread\n- Greek Yogurt',
    updated_by: 'Alex'
  });
  if (scratchRes.status !== 200 || !scratchRes.body.success) throw new Error('Scratchpad update failed');
  const checkState = await request(`/api/rooms/${roomId}/state`);
  if (!checkState.body.scratchpad.includes('Sourdough Bread')) {
    throw new Error('Scratchpad content was not persisted');
  }
  console.log('  ✅ Shared scratchpad updated and verified in room state');

  // 7. Test Room PIN Protection (Setting, Checking, Verifying)
  console.log('[7/12] Testing Room PIN Protection & Verification...');
  const setPinRes = await request(`/api/rooms/${roomId}/pin`, 'PUT', {
    pin: '2026',
    updated_by: 'Alex'
  });
  if (!setPinRes.body.has_pin) throw new Error('Failed to set PIN');

  // Check invalid PIN
  const wrongPinRes = await request(`/api/rooms/${roomId}/verify-pin`, 'POST', { pin: '0000' });
  if (wrongPinRes.body.success !== false) throw new Error('Wrong PIN should fail verification');

  // Check valid PIN
  const rightPinRes = await request(`/api/rooms/${roomId}/verify-pin`, 'POST', { pin: '2026' });
  if (rightPinRes.body.success !== true) throw new Error('Correct PIN failed verification');
  console.log('  ✅ Room PIN protection verified successfully');

  // 8. Test Daily Calendar Note / Log
  console.log('[8/12] Testing Daily Calendar Notes & Moods...');
  const dailyRes = await request(`/api/rooms/${roomId}/daily/${todayStr}`, 'PUT', {
    user1_note: 'Finished project draft!',
    user2_note: 'Cooked dinner tonight',
    user1_mood: '⚡',
    user2_mood: '😊',
    reflection: 'Loved cooking together today!',
    actor: 'Alex'
  });
  if (!dailyRes.body.log || dailyRes.body.log.user1_mood !== '⚡') {
    throw new Error('Daily log update failed');
  }
  console.log('  ✅ Daily notes & moods saved');

  // 9. Test Calendar Month Aggregation
  console.log('[9/12] Testing Monthly Calendar Query...');
  const monthStr = todayStr.substring(0, 7); // YYYY-MM
  const monthRes = await request(`/api/rooms/${roomId}/calendar?month=${monthStr}`);
  if (monthRes.status !== 200 || !monthRes.body.tasks || !monthRes.body.logs) {
    throw new Error('Calendar monthly query failed');
  }
  console.log('  ✅ Calendar month tasks:', monthRes.body.tasks.length, 'logs:', monthRes.body.logs.length);

  // 10. Test Cheer Endpoint
  console.log('[10/12] Testing Real-Time Cheer...');
  const cheerRes = await request(`/api/rooms/${roomId}/cheer`, 'POST', {
    from: 'Alex',
    emoji: '🎉',
    message: 'High-five for completing daily goals!'
  });
  if (cheerRes.status !== 200 || !cheerRes.body.success) {
    throw new Error('Cheer failed');
  }
  console.log('  ✅ Cheer successfully broadcasted');

  // 11. Test 1-Click Export (JSON & Markdown)
  console.log('[11/12] Testing 1-Click Export (JSON & Markdown)...');
  const exportJson = await request(`/api/rooms/${roomId}/export?format=json`);
  if (exportJson.status !== 200 || !exportJson.body.tasks || !exportJson.body.room) {
    throw new Error('JSON export failed');
  }
  const exportMd = await request(`/api/rooms/${roomId}/export?format=markdown`);
  if (exportMd.status !== 200 || typeof exportMd.body !== 'string' || !exportMd.body.includes('# DuoSync Export')) {
    throw new Error('Markdown export failed');
  }
  console.log('  ✅ 1-Click backup & Markdown journal exported successfully');

  // 12. Test PWA Static Assets (Manifest & Service Worker)
  console.log('[12/15] Testing PWA Static Assets (manifest.json, sw.js, icon.svg)...');
  const manifestRes = await request('/manifest.json');
  if (manifestRes.status !== 200 || manifestRes.body.short_name !== 'DuoSync') {
    throw new Error('PWA manifest.json not accessible or invalid');
  }
  const swRes = await request('/sw.js');
  if (swRes.status !== 200 || !swRes.body.includes('duosync')) {
    throw new Error('Service Worker sw.js not accessible');
  }
  const iconRes = await request('/icon.svg');
  if (iconRes.status !== 200) {
    throw new Error('PWA icon.svg not accessible');
  }
  console.log('  ✅ All PWA assets served correctly');

  // 13. Test Duo Chat Messaging
  console.log('[13/15] Testing Duo Chat Room (Send Message, History, Typing Indicator)...');
  const sendMsgRes = await request(`/api/rooms/${roomId}/messages`, 'POST', {
    sender_id: 'user1',
    sender_name: 'Alex',
    sender_avatar: '🦊',
    text: 'Hey Sam! Don\'t forget to pick up sourdough bread!'
  });
  if (sendMsgRes.status !== 201 || !sendMsgRes.body.message || !sendMsgRes.body.message.id) {
    throw new Error('Chat message send failed');
  }
  console.log('  ✅ Message sent:', sendMsgRes.body.message.text);

  const getMsgsRes = await request(`/api/rooms/${roomId}/messages`);
  if (getMsgsRes.status !== 200 || !Array.isArray(getMsgsRes.body.messages) || getMsgsRes.body.messages.length !== 1) {
    throw new Error('Failed to retrieve chat messages');
  }
  if (getMsgsRes.body.messages[0].text !== 'Hey Sam! Don\'t forget to pick up sourdough bread!') {
    throw new Error('Message text mismatch');
  }
  console.log('  ✅ Chat history retrieved with', getMsgsRes.body.messages.length, 'message');

  const typingRes = await request(`/api/rooms/${roomId}/typing`, 'POST', {
    userId: 'user2',
    userName: 'Sam',
    isTyping: true
  });
  if (typingRes.status !== 200 || !typingRes.body.success) {
    throw new Error('Chat typing indicator failed');
  }
  console.log('  ✅ Partner typing indicator broadcasted');

  // 14. Test Fast Delta Sync Endpoint
  console.log('[14/15] Testing Fast Delta / Live Sync Endpoint...');
  const syncRes = await request(`/api/rooms/${roomId}/sync?since=0`);
  if (syncRes.status !== 200 || !syncRes.body.tasks || !syncRes.body.messages || syncRes.body.scratchpad === undefined) {
    throw new Error('Sync endpoint failed');
  }
  console.log('  ✅ Sync endpoint verified (tasks:', syncRes.body.tasks.length, 'messages:', syncRes.body.messages.length, ')');

  // 15. Test Chat in Export and Clear Chat
  console.log('[15/15] Testing Chat Export & Clear Chat...');
  const exportWithChat = await request(`/api/rooms/${roomId}/export?format=markdown`);
  if (!exportWithChat.body.includes('Duo Chat History') || !exportWithChat.body.includes('sourdough bread')) {
    throw new Error('Chat was not included in Markdown export');
  }
  const clearChatRes = await request(`/api/rooms/${roomId}/messages?user=Alex`, 'DELETE');
  if (clearChatRes.status !== 200 || !clearChatRes.body.success) {
    throw new Error('Failed to clear chat');
  }
  const verifyEmptyChat = await request(`/api/rooms/${roomId}/messages`);
  if (verifyEmptyChat.body.messages.length !== 0) {
    throw new Error('Chat history not empty after clear');
  }
  console.log('  ✅ Chat export verified and cleared successfully');

  // 16. Test Auto-Heal & Restore Endpoint
  console.log('[16/16] Testing Auto-Heal & Restore Endpoint...');
  const healTaskId = 'heal-task-' + Date.now();
  const healPayload = {
    tasks: [{ id: healTaskId, title: 'Auto Healed Task', category: 'General', is_completed: 0 }],
    dailyLogs: [{ date: '2026-09-28', user1_note: 'Restored note', user1_mood: '💪' }],
    scratchpad: 'Restored scratchpad content'
  };
  const healRes = await request(`/api/rooms/${roomId}/restore`, 'POST', healPayload);
  if (healRes.status !== 200 || !healRes.body.success || healRes.body.restoredTasks !== 1) {
    throw new Error('Auto-heal restore endpoint failed');
  }
  const verifyHealState = await request(`/api/rooms/${roomId}/state`);
  const healedTask = verifyHealState.body.tasks.find(t => t.id === healTaskId);
  if (!healedTask || healedTask.title !== 'Auto Healed Task') {
    throw new Error('Restored task not found in state');
  }
  console.log('  ✅ Auto-Heal & Restore verified successfully (tasks restored:', healRes.body.restoredTasks, ')');

  // 17. Test Duo Task Separate Completion Logic
  console.log('[17/17] Testing Duo Separate Completion Logic for Shared Tasks...');
  const duoTaskRes = await request(`/api/rooms/${roomId}/tasks`, 'POST', {
    title: 'Shared Duo Project Review',
    assigned_to: 'both',
    category: 'Work / Study',
    created_by: 'Alex'
  });
  const duoTaskId = duoTaskRes.body.task.id;

  // Partner 1 checks it done
  const p1CheckRes = await request(`/api/rooms/${roomId}/tasks/${duoTaskId}`, 'PUT', {
    user_action: 'user1',
    is_checked: true
  });
  if (p1CheckRes.body.task.is_completed !== 0 || p1CheckRes.body.task.user1_done !== 1 || p1CheckRes.body.task.user2_done !== 0) {
    throw new Error('Expected task to remain is_completed: 0 when only partner 1 completed');
  }
  console.log('  ✅ Partner 1 completed: task stays active (is_completed: 0, user1_done: 1, user2_done: 0)');

  // Partner 2 also checks it done
  const p2CheckRes = await request(`/api/rooms/${roomId}/tasks/${duoTaskId}`, 'PUT', {
    user_action: 'user2',
    is_checked: true
  });
  if (p2CheckRes.body.task.is_completed !== 1 || p2CheckRes.body.task.user1_done !== 1 || p2CheckRes.body.task.user2_done !== 1) {
    throw new Error('Expected task to become is_completed: 1 when both partners completed');
  }
  console.log('  ✅ Partner 2 completed: task is now fully completed (is_completed: 1)');

  // Partner 1 unchecks it
  const uncheckRes = await request(`/api/rooms/${roomId}/tasks/${duoTaskId}`, 'PUT', {
    user_action: 'user1',
    is_checked: false
  });
  if (uncheckRes.body.task.is_completed !== 0 || uncheckRes.body.task.user1_done !== 0 || uncheckRes.body.task.user2_done !== 1) {
    throw new Error('Expected task to return to is_completed: 0 when partner 1 unchecks');
  }
  console.log('  ✅ Partner 1 unchecked: task correctly reverted to active');

  // 18. Test Past Date Storage & Calendar History Retrieval
  console.log('[18/18] Testing Past Date Storage & History Retrieval...');
  const pastTaskRes = await request(`/api/rooms/${roomId}/tasks`, 'POST', {
    title: 'History Essay Draft from Last Week',
    due_date: '2026-09-20',
    category: 'Work / Study',
    created_by: 'Alex'
  });
  if (!pastTaskRes.body.task || pastTaskRes.body.task.due_date !== '2026-09-20') {
    throw new Error('Past date task storage failed');
  }

  // Also verify task created without due_date gets today's date automatically
  const autoDateTaskRes = await request(`/api/rooms/${roomId}/tasks`, 'POST', {
    title: 'Task Without Explicit Date',
    category: 'General',
    created_by: 'Sam'
  });
  if (!autoDateTaskRes.body.task.due_date) {
    throw new Error('Expected task without explicit due_date to be automatically dated');
  }

  const calMonthRes = await request(`/api/rooms/${roomId}/calendar?month=2026-09`);
  const foundPastTask = calMonthRes.body.tasks.find(t => t.id === pastTaskRes.body.task.id);
  if (!foundPastTask || foundPastTask.due_date !== '2026-09-20') {
    throw new Error('Failed to retrieve past date task in calendar history query');
  }
  console.log('  ✅ Past date tasks safely stored and retrievable in calendar history');

  // 19. Test Partner Live Status System
  console.log('[19/19] Testing Partner Live Status System (Studying, Bathing, Timepass, Waiting)...');
  const status1Res = await request(`/api/rooms/${roomId}/status`, 'PUT', {
    user: 'user1',
    status: '📚 Studying'
  });
  if (status1Res.status !== 200 || status1Res.body.room.user1_status !== '📚 Studying') {
    throw new Error('Failed to set partner 1 status');
  }
  console.log('  ✅ Partner 1 status set to: 📚 Studying');

  const status2Res = await request(`/api/rooms/${roomId}/status`, 'PUT', {
    user: 'user2',
    status: '🚿 Bathing'
  });
  if (status2Res.status !== 200 || status2Res.body.room.user2_status !== '🚿 Bathing') {
    throw new Error('Failed to set partner 2 status');
  }
  console.log('  ✅ Partner 2 status set to: 🚿 Bathing');

  const verifyStateRes = await request(`/api/rooms/${roomId}/state`);
  if (verifyStateRes.body.room.user1_status !== '📚 Studying' || verifyStateRes.body.room.user2_status !== '🚿 Bathing') {
    throw new Error('State endpoint did not return correct partner statuses');
  }
  console.log('  ✅ Verified state endpoint returns both live partner statuses');

  const verifySyncRes = await request(`/api/rooms/${roomId}/sync?since=0`);
  if (verifySyncRes.body.room.user1_status !== '📚 Studying' || verifySyncRes.body.room.user2_status !== '🚿 Bathing') {
    throw new Error('Sync endpoint did not return correct partner statuses');
  }
  console.log('  ✅ Verified sync endpoint propagates live partner statuses');

  // Test clearing status
  const clearStatusRes = await request(`/api/rooms/${roomId}/status`, 'PUT', {
    user: 'user1',
    status: ''
  });
  if (clearStatusRes.body.room.user1_status !== '') {
    throw new Error('Failed to clear partner 1 status');
  }
  console.log('  ✅ Partner 1 status successfully cleared');

  console.log('\n======================================================');
  console.log('🎉 ALL 19 INTEGRATION & RESILIENCE TESTS PASSED 100%!');
  console.log('======================================================');
  if (serverInstance && typeof serverInstance.close === 'function') serverInstance.close();
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
