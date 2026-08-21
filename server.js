const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

// ==================== SQLITE БАЗА ДАННЫХ ====================
const db = new sqlite3.Database('./messenger.db');

// Создаём таблицы
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    isOnline INTEGER DEFAULT 0,
    lastSeen DATETIME DEFAULT CURRENT_TIMESTAMP,
    coins INTEGER DEFAULT 0,
    totalEarned INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    avatar TEXT DEFAULT '',
    isAdmin INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    theme TEXT DEFAULT 'dark',
    dailyBonus INTEGER DEFAULT 0,
    lastDaily DATETIME,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS user_gifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    giftType TEXT NOT NULL,
    giftName TEXT NOT NULL,
    sender TEXT NOT NULL,
    rarity TEXT DEFAULT 'common',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES users(username)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS user_achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    achievementId TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    description TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES users(username)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    type TEXT DEFAULT 'chat',
    text TEXT,
    url TEXT,
    giftType TEXT,
    giftName TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // Индексы для скорости
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_sender_recipient ON messages(sender, recipient)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_coins ON users(coins)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_level ON users(level)`);
  
  console.log('✅ База данных готова');
});

// ==================== ДАННЫЕ ====================
const GIFTS = [
  { type: 'rose', name: '🌹 Роза', price: 50, rarity: 'common' },
  { type: 'heart', name: '❤️ Сердце', price: 100, rarity: 'common' },
  { type: 'star', name: '⭐ Звезда', price: 75, rarity: 'common' },
  { type: 'flower', name: '🌸 Цветок', price: 60, rarity: 'common' },
  { type: 'coffee', name: '☕ Кофе', price: 30, rarity: 'common' },
  { type: 'beer', name: '🍺 Пиво', price: 40, rarity: 'common' },
  { type: 'cake', name: '🎂 Торт', price: 150, rarity: 'rare' },
  { type: 'music', name: '🎵 Музыка', price: 80, rarity: 'common' },
  { type: 'book', name: '📚 Книга', price: 45, rarity: 'common' },
  { type: 'game', name: '🎮 Игра', price: 120, rarity: 'rare' },
  { type: 'ring', name: '💍 Кольцо', price: 200, rarity: 'rare' },
  { type: 'fire', name: '🔥 Огонь', price: 250, rarity: 'rare' },
  { type: 'rocket', name: '🚀 Ракета', price: 300, rarity: 'rare' },
  { type: 'crown', name: '👑 Корона', price: 500, rarity: 'epic' },
  { type: 'diamond', name: '💎 Алмаз', price: 1000, rarity: 'epic' },
  { type: 'car', name: '🚗 Машина', price: 800, rarity: 'epic' },
  { type: 'house', name: '🏠 Дом', price: 1500, rarity: 'legendary' },
  { type: 'planet', name: '🪐 Планета', price: 2000, rarity: 'legendary' }
];

const ACHIEVEMENTS = [
  { id: 'first_login', name: 'Первый шаг', icon: '🎉', desc: 'Впервые вошли' },
  { id: 'clicker_100', name: 'Кликер', icon: '👆', desc: '100 кликов' },
  { id: 'clicker_1000', name: 'Мастер', icon: '💪', desc: '1000 кликов' },
  { id: 'coins_1000', name: 'Богач', icon: '💰', desc: '1000 монет' },
  { id: 'coins_10000', name: 'Миллионер', icon: '🤑', desc: '10000 монет' },
  { id: 'level_5', name: 'Опытный', icon: '⭐', desc: '5 уровень' },
  { id: 'level_10', name: 'Легенда', icon: '🏆', desc: '10 уровень' }
];

function calculateLevel(coins) {
  return Math.floor(Math.sqrt(coins / 100)) + 1;
}

function checkAchievements(username, userData) {
  db.all('SELECT achievementId FROM user_achievements WHERE username = ?', [username], (err, rows) => {
    if (err) return console.error(err);
    
    const unlockedIds = rows.map(r => r.achievementId);
    
    ACHIEVEMENTS.forEach(ach => {
      if (unlockedIds.includes(ach.id)) return;
      
      let earned = false;
      switch(ach.id) {
        case 'first_login': earned = true; break;
        case 'clicker_100': if (userData.clicks >= 100) earned = true; break;
        case 'clicker_1000': if (userData.clicks >= 1000) earned = true; break;
        case 'coins_1000': if (userData.coins >= 1000) earned = true; break;
        case 'coins_10000': if (userData.coins >= 10000) earned = true; break;
        case 'level_5': if (userData.level >= 5) earned = true; break;
        case 'level_10': if (userData.level >= 10) earned = true; break;
      }
      
      if (earned) {
        db.run('INSERT INTO user_achievements (username, achievementId, name, icon, description) VALUES (?, ?, ?, ?, ?)',
          [username, ach.id, ach.name, ach.icon, ach.desc]);
      }
    });
  });
}

// ==================== СЕРВЕР ====================
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.readFile('./index.html', (err, data) => {
      if (err) res.end('Error');
      else res.end(data);
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
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm',
        '.ogg': 'audio/ogg', '.wav': 'audio/wav'
      };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// ==================== WEBSOCKET ====================
const wss = new WebSocket.Server({ server });
const connectedUsers = {};

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const username = params.get('username');
  const password = params.get('password');

  if (!username || !password) {
    ws.close();
    return;
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) {
      console.error('Ошибка БД:', err);
      ws.close();
      return;
    }

    let isAdmin = false;

    if (!user) {
      const hashedPassword = await bcrypt.hash(password, 10);
      isAdmin = username.toLowerCase() === 'vortex';
      
      db.run('INSERT INTO users (username, password, isAdmin) VALUES (?, ?, ?)',
        [username, hashedPassword, isAdmin ? 1 : 0], function(err) {
          if (err) console.error('Ошибка создания:', err);
          else console.log(`🆕 Новый пользователь: ${username}`);
        });
    } else {
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        ws.close();
        return;
      }
      isAdmin = user.isAdmin === 1;
    }

    db.run('UPDATE users SET isOnline = 1, lastSeen = CURRENT_TIMESTAMP WHERE username = ?', [username]);

    connectedUsers[username] = { ws, connectedAt: new Date(), isAdmin };
    
    console.log(`🟢 ${username} подключился (💰 ${user?.coins || 0}, ⭐ Ур.${user?.level || 1})`);

    ws.send(JSON.stringify({
      type: 'online_users',
      users: Object.keys(connectedUsers),
      myData: user || { username, isAdmin, coins: 10, level: 1, clicks: 0, avatar: '', achievements: [] }
    }));

    db.all('SELECT username FROM users ORDER BY username ASC', [], (err, rows) => {
      if (err) return console.error(err);
      ws.send(JSON.stringify({
        type: 'all_users',
        users: rows.map(r => r.username)
      }));
    });

    db.all(`SELECT * FROM messages WHERE (sender = ? OR recipient = ?) ORDER BY timestamp DESC LIMIT 50`,
      [username, username], (err, rows) => {
        if (err) return console.error(err);
        ws.send(JSON.stringify({
          type: 'conversations',
          conversations: rows
        }));
      });

    ws.on('message', async (data) => {
      try {
        const messageData = JSON.parse(data);

        switch (messageData.type) {
          case 'chat':
          case 'photo':
          case 'voice':
          case 'circle':
            db.run('INSERT INTO messages (sender, recipient, type, text, url) VALUES (?, ?, ?, ?, ?)',
              [messageData.sender, messageData.recipient, messageData.type, messageData.text, messageData.url]);
            broadcast(messageData);
            break;

          case 'get_chat':
            db.all(`SELECT * FROM messages WHERE 
              ((sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?))
              ORDER BY timestamp ASC`,
              [username, messageData.recipient, messageData.recipient, username],
              (err, rows) => {
                if (err) return console.error(err);
                ws.send(JSON.stringify({
                  type: 'chat_history',
                  user: messageData.recipient,
                  messages: rows
                }));
              });
            break;

          case 'clicker':
            db.get('SELECT * FROM users WHERE username = ?', [username], (err, currentUser) => {
              if (err) return console.error(err);
              if (!currentUser) return;
              
              const earned = messageData.amount || 1;
              const multiplier = 1 + (currentUser.level - 1) * 0.1;
              const actualEarned = Math.floor(earned * multiplier);
              
              db.run('UPDATE users SET coins = coins + ?, totalEarned = totalEarned + ?, clicks = clicks + 1 WHERE username = ?',
                [actualEarned, actualEarned, username]);
              
              const newLevel = calculateLevel(currentUser.totalEarned + actualEarned);
              if (newLevel > currentUser.level) {
                db.run('UPDATE users SET level = ? WHERE username = ?', [newLevel, username]);
                ws.send(JSON.stringify({
                  type: 'level_up',
                  level: newLevel,
                  message: `🎉 Уровень ${newLevel}! Множитель x${multiplier.toFixed(1)}`
                }));
              }
              
              checkAchievements(username, { clicks: currentUser.clicks + 1, coins: currentUser.coins + actualEarned, level: newLevel });
              
              ws.send(JSON.stringify({
                type: 'coins_update',
                coins: currentUser.coins + actualEarned,
                level: newLevel,
                clicks: currentUser.clicks + 1
              }));
            });
            break;

          case 'send_gift':
            db.get('SELECT * FROM users WHERE username = ?', [username], (err, currentUser) => {
              if (err) return console.error(err);
              if (!currentUser) return;
              
              const gift = GIFTS.find(g => g.type === messageData.giftType);
              if (!gift) return;
              
              if (currentUser.coins < gift.price && !isAdmin) {
                ws.send(JSON.stringify({ type: 'error', message: 'Недостаточно монет!' }));
                return;
              }
              
              if (!isAdmin) {
                db.run('UPDATE users SET coins = coins - ? WHERE username = ?', [gift.price, username]);
              }
              
              db.run('INSERT INTO messages (sender, recipient, type, giftType, giftName) VALUES (?, ?, ?, ?, ?)',
                [username, messageData.recipient, 'gift', gift.type, gift.name]);
              
              db.get('SELECT * FROM users WHERE username = ?', [messageData.recipient], (err, receiver) => {
                if (err) return;
                if (receiver) {
                  db.run('INSERT INTO user_gifts (username, giftType, giftName, sender, rarity) VALUES (?, ?, ?, ?, ?)',
                    [messageData.recipient, gift.type, gift.name, username, gift.rarity]);
                }
              });
              
              broadcast({
                type: 'gift_received',
                from: username,
                to: messageData.recipient,
                giftType: gift.type,
                giftName: gift.name,
                price: gift.price,
                rarity: gift.rarity
              });
              
              ws.send(JSON.stringify({
                type: 'coins_update',
                coins: isAdmin ? currentUser.coins : currentUser.coins - gift.price,
                level: currentUser.level,
                clicks: currentUser.clicks
              }));
            });
            break;

          case 'set_avatar':
            db.run('UPDATE users SET avatar = ? WHERE username = ?', [messageData.avatar, username]);
            ws.send(JSON.stringify({
              type: 'avatar_update',
              avatar: messageData.avatar
            }));
            break;

          case 'get_profile':
            db.get('SELECT * FROM users WHERE username = ?', [messageData.username], (err, profileUser) => {
              if (err) return console.error(err);
              if (profileUser) {
                db.all('SELECT * FROM user_gifts WHERE username = ?', [messageData.username], (err, gifts) => {
                  ws.send(JSON.stringify({
                    type: 'profile_data',
                    user: profileUser,
                    gifts: gifts || []
                  }));
                });
              }
            });
            break;

          case 'give_admin':
            if (!isAdmin) {
              ws.send(JSON.stringify({ type: 'error', message: 'Нет прав!' }));
              break;
            }
            
            db.get('SELECT * FROM users WHERE username = ?', [messageData.targetUsername], (err, targetUser) => {
              if (err) return;
              if (targetUser) {
                db.run('UPDATE users SET isAdmin = 1 WHERE username = ?', [messageData.targetUsername]);
                
                ws.send(JSON.stringify({
                  type: 'admin_granted',
                  target: messageData.targetUsername,
                  admin: targetUser
                }));
                
                if (connectedUsers[messageData.targetUsername]) {
                  connectedUsers[messageData.targetUsername].ws.send(JSON.stringify({
                    type: 'you_are_admin'
                  }));
                }
              }
            });
            break;

          case 'buy_shop_item':
            db.get('SELECT * FROM users WHERE username = ?', [username], (err, currentUser) => {
              if (err) return console.error(err);
              if (!currentUser) return;
              
              const SHOP_ITEMS = [
                { id: 'boost_click', name: 'Буст клика', icon: '⚡', price: 200 },
                { id: 'boost_double', name: 'Двойные монеты', icon: '✨', price: 500 },
                { id: 'theme_purple', name: 'Тема фиолетовая', icon: '💜', price: 300 },
                { id: 'theme_gold', name: 'Тема золотая', icon: '👑', price: 1000 },
                { id: 'badge_star', name: 'Значок звезда', icon: '🌟', price: 400 },
                { id: 'badge_fire', name: 'Значок огонь', icon: '🔥', price: 600 }
              ];
              
              const item = SHOP_ITEMS.find(i => i.id === messageData.itemId);
              if (!item || currentUser.coins < item.price) {
                ws.send(JSON.stringify({ type: 'error', message: 'Недостаточно монет!' }));
                return;
              }
              
              db.run('UPDATE users SET coins = coins - ? WHERE username = ?', [item.price, username]);
              
              if (item.id === 'theme_purple') db.run('UPDATE users SET theme = ? WHERE username = ?', ['purple', username]);
              if (item.id === 'theme_gold') db.run('UPDATE users SET theme = ? WHERE username = ?', ['gold', username]);
              
              ws.send(JSON.stringify({
                type: 'shop_purchased',
                item,
                coins: currentUser.coins - item.price
              }));
            });
            break;

          case 'play_game':
            db.get('SELECT * FROM users WHERE username = ?', [username], (err, currentUser) => {
              if (err) return console.error(err);
              if (!currentUser) return;
              
              const GAMES = [
                { id: 'dice', name: '🎲 Кости', bet: 50 },
                { id: 'coin', name: '🪙 Монетка', bet: 100 },
                { id: 'slots', name: '🎰 Слоты', bet: 75 }
              ];
              
              const game = GAMES.find(g => g.id === messageData.gameId);
              if (!game || currentUser.coins < game.bet) {
                ws.send(JSON.stringify({ type: 'error', message: 'Недостаточно монет!' }));
                return;
              }
              
              db.run('UPDATE users SET coins = coins - ? WHERE username = ?', [game.bet, username]);
              
              let win = false;
              let gameMultiplier = 0;
              
              switch(game.id) {
                case 'dice':
                  const diceResult = Math.floor(Math.random() * 6) + 1;
                  win = diceResult === parseInt(messageData.guess);
                  gameMultiplier = win ? 5 : 0;
                  break;
                case 'coin':
                  const coinResult = Math.random() > 0.5 ? 'heads' : 'tails';
                  win = coinResult === messageData.choice;
                  gameMultiplier = win ? 1.8 : 0;
                  break;
                case 'slots':
                  const s1 = Math.floor(Math.random() * 3);
                  const s2 = Math.floor(Math.random() * 3);
                  const s3 = Math.floor(Math.random() * 3);
                  win = s1 === s2 && s2 === s3;
                  gameMultiplier = win ? 10 : 0;
                  break;
              }
              
              const winAmount = Math.floor(game.bet * gameMultiplier);
              db.run('UPDATE users SET coins = coins + ? WHERE username = ?', [winAmount, username]);
              
              ws.send(JSON.stringify({
                type: 'game_result',
                won: win,
                amount: winAmount,
                result: messageData.result || ''
              }));
            });
            break;

          case 'request_daily':
            db.get('SELECT * FROM users WHERE username = ?', [username], (err, currentUser) => {
              if (err) return console.error(err);
              if (!currentUser) return;
              
              const now = Date.now();
              const lastDaily = currentUser.lastDaily ? new Date(currentUser.lastDaily).getTime() : 0;
              
              if (now - lastDaily < 86400000) {
                ws.send(JSON.stringify({
                  type: 'daily_error',
                  message: 'Получите награду завтра!'
                }));
                return;
              }
              
              const bonus = 100 + (currentUser.level || 1) * 50;
              db.run('UPDATE users SET coins = coins + ?, dailyBonus = dailyBonus + 1, lastDaily = CURRENT_TIMESTAMP WHERE username = ?',
                [bonus, username]);
              
              ws.send(JSON.stringify({
                type: 'daily_received',
                amount: bonus,
                streak: (currentUser.dailyBonus || 0) + 1
              }));
            });
            break;

          case 'request_friends':
            ws.send(JSON.stringify({
              type: 'friends_list',
              friends: Object.keys(connectedUsers)
            }));
            break;

          case 'request_stats':
            db.get('SELECT COUNT(*) as total FROM users', [], (err, res) => {
              const totalUsers = res?.total || 0;
              
              db.get('SELECT COUNT(*) as total FROM messages', [], (err, res) => {
                const totalMessages = res?.total || 0;
                
                db.get('SELECT AVG(coins) as avg FROM users', [], (err, res) => {
                  const avgCoins = Math.floor(res?.avg || 0);
                  
                  ws.send(JSON.stringify({
                    type: 'stats_data',
                    totalUsers,
                    totalMessages,
                    avgCoins
                  }));
                });
              });
            });
            break;
        }
      } catch (e) {
        console.error('Ошибка обработки сообщения:', e);
        ws.send(JSON.stringify({ type: 'error', message: 'Произошла ошибка' }));
      }
    });

    ws.on('close', () => {
      delete connectedUsers[username];
      
      db.run('UPDATE users SET isOnline = 0, lastSeen = CURRENT_TIMESTAMP WHERE username = ?', [username]);
      
      const onlineList = Object.keys(connectedUsers);
      broadcast({ type: 'online_update', users: onlineList });
      console.log(`🔴 ${username} отключился`);
    });
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
  console.log(`🟣 Messenger на порту ${PORT}`);
});
