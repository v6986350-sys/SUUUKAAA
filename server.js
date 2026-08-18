const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Создаем сервер
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading page');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url === '/upload' && req.method === 'POST') {
    const multerUpload = multer({ dest: 'uploads/' });
    multerUpload.single('file')(req, res, (err) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      if (!req.file) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No file' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: `/uploads/${req.file.filename}` }));
    });
  } else if (req.url.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, req.url);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      const types = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav'
      };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Создаем WebSocket сервер
const wss = new WebSocket.Server({ server });

// Хранилище подключённых пользователей
const connectedUsers = {};

// ==================== БАЗА ДАННЫХ ====================
const DB_FILE = path.join(__dirname, 'messages.db.json');
const USERS_DB_FILE = path.join(__dirname, 'users.db.json');

// Загружаем базу сообщений
let messagesDB = [];
if (fs.existsSync(DB_FILE)) {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    messagesDB = JSON.parse(data);
    console.log(`📚 Загружено ${messagesDB.length} сообщений из базы данных`);
  } catch (e) {
    console.error('Ошибка загрузки БД:', e);
    messagesDB = [];
  }
}

// Загружаем базу пользователей
let usersDB = {};
if (fs.existsSync(USERS_DB_FILE)) {
  try {
    const data = fs.readFileSync(USERS_DB_FILE, 'utf-8');
    usersDB = JSON.parse(data);
    console.log(`👥 Загружено ${Object.keys(usersDB).length} пользователей из БД`);
  } catch (e) {
    console.error('Ошибка загрузки БД пользователей:', e);
    usersDB = {};
  }
}

// Сохраняем сообщения в БД
function saveMessagesDB() {
  try {
    // Храним только последние 10000 сообщений
    const toSave = messagesDB.length > 10000 ? messagesDB.slice(-10000) : messagesDB;
    fs.writeFileSync(DB_FILE, JSON.stringify(toSave, null, 2), 'utf-8');
  } catch (e) {
    console.error('Ошибка сохранения БД:', e);
  }
}

// Сохраняем базу пользователей
function saveUsersDB() {
  try {
    fs.writeFileSync(USERS_DB_FILE, JSON.stringify(usersDB, null, 2), 'utf-8');
  } catch (e) {
    console.error('Ошибка сохранения БД пользователей:', e);
  }
}

// Получить все переписки пользователя
function getUserConversations(user) {
  const userMessages = messagesDB.filter(m => m.from === user || m.to === user);
  const conversations = {};

  userMessages.forEach(msg => {
    const otherUser = msg.from === user ? msg.to : msg.from;
    if (!conversations[otherUser] || new Date(msg.timestamp) > new Date(conversations[otherUser].timestamp)) {
      conversations[otherUser] = msg;
    }
  });

  // Сортируем по последнему сообщению
  return Object.values(conversations).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

// Получить все переписки между двумя пользователями
function getChatHistory(user1, user2) {
  return messagesDB.filter(m =>
    (m.from === user1 && m.to === user2) ||
    (m.from === user2 && m.to === user1)
  ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

// Получить всех пользователей с которыми общался данный пользователь
function getUserContacts(user) {
  const contacts = new Set();
  messagesDB.forEach(m => {
    if (m.from === user) contacts.add(m.to);
    if (m.to === user) contacts.add(m.from);
  });
  return Array.from(contacts);
}

// Создаем папку для загрузок
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  let username = params.get('username') || 'Anonymous_' + Math.floor(Math.random() * 10000);

  // Регистрируем подключённого пользователя
  connectedUsers[username] = { ws, connectedAt: new Date().toISOString() };

  // Добавляем в базу пользователей
  if (!usersDB[username]) {
    usersDB[username] = {
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      isOnline: true
    };
    saveUsersDB();
  } else {
    usersDB[username].lastSeen = new Date().toISOString();
    usersDB[username].isOnline = true;
    saveUsersDB();
  }

  console.log(`🟢 Пользователь подключён: ${username}`);

  // Отправляем список онлайн пользователей
  const onlineList = Object.keys(connectedUsers);
  ws.send(JSON.stringify({
    type: 'online_users',
    users: onlineList
  }));

  // Отправляем ВСЕХ зарегистрированных пользователей
  const allUsersList = Object.keys(usersDB);
  ws.send(JSON.stringify({
    type: 'all_users',
    users: allUsersList
  }));

  // Отправляем ВСЕ переписки пользователя
  const conversations = getUserConversations(username);
  ws.send(JSON.stringify({
    type: 'conversations',
    conversations: conversations
  }));

  // Отправляем список контактов (все с кем общался)
  const contacts = getUserContacts(username);
  ws.send(JSON.stringify({
    type: 'contacts',
    contacts: contacts
  }));

  // Уведомляем об онлайне
  broadcast({
    type: 'online_update',
    users: onlineList
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      message.username = username;
      message.timestamp = new Date().toISOString();

      switch (message.type) {
        case 'chat':
        case 'photo':
        case 'voice':
        case 'circle':
          messagesDB.push(message);
          saveMessagesDB();

          // Обновляем lastSeen у получателя
          if (message.to && usersDB[message.to]) {
            usersDB[message.to].lastSeen = new Date().toISOString();
            saveUsersDB();
          }

          broadcast(message);
          break;

        case 'get_chat':
          // Запрос истории чата с конкретным пользователем
          const chatHistory = getChatHistory(username, message.to);
          ws.send(JSON.stringify({
            type: 'chat_history',
            user: message.to,
            messages: chatHistory
          }));
          break;
      }
    } catch (e) {
      console.error('Ошибка парсинга сообщения:', e);
    }
  });

  ws.on('close', () => {
    delete connectedUsers[username];

    // Обновляем статус в БД
    if (usersDB[username]) {
      usersDB[username].isOnline = false;
      usersDB[username].lastSeen = new Date().toISOString();
      saveUsersDB();
    }

    const onlineList = Object.keys(connectedUsers);
    broadcast({
      type: 'online_update',
      users: onlineList
    });

    console.log(`🔴 Пользователь отключён: ${username}`);
  });

  ws.on('error', (err) => {
    console.error('WebSocket ошибка:', err);
  });
});

function broadcast(message, excludeWs = null) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🟣 Purple Messenger is running!`);
  console.log(`👉 Open: http://localhost:${PORT}\n`);
  console.log(`💬 Open the link in multiple tabs to chat between them\n`);
});
