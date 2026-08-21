const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

// ==================== БАЗА ДАННЫХ (SQLite) ====================
const DB_PATH = path.join(__dirname, 'messenger.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      isOnline INTEGER DEFAULT 0,
      lastSeen DATETIME DEFAULT CURRENT_TIMESTAMP,
      coins INTEGER DEFAULT 0,
      totalEarned INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      avatar TEXT DEFAULT '',
      isAdmin INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      gifts TEXT DEFAULT '[]',
      achievements TEXT DEFAULT '[]',
      theme TEXT DEFAULT 'dark',
      dailyBonus INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      "from" TEXT NOT NULL,
      "to" TEXT NOT NULL,
      type TEXT DEFAULT 'chat',
      text TEXT,
      url TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS gifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      "from" TEXT NOT NULL,
      "to" TEXT NOT NULL,
      giftType TEXT NOT NULL,
      giftName TEXT NOT NULL,
      price INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1 TEXT NOT NULL,
      user2 TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      description TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_msg_from_to ON messages("from", "to")`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_msg_to ON messages("to")`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_gifts_to ON gifts("to")`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user1, user2)`);
});

console.log('✅ База данных готова');

// ==================== ДАННЫЕ ПОДАРКОВ ====================
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
  { type: 'planet', name: '🪐 Планета', price: 2000, rarity: 'legendary' },
];

// ==================== ДОСТИЖЕНИЯ ====================
const ACHIEVEMENTS = [
  { id: 'first_login', name: 'Первый шаг', icon: '🎉', desc: 'Впервые вошли в мессенджер' },
  { id: 'clicker_100', name: 'Кликер', icon: '👆', desc: 'Сделайте 100 кликов' },
  { id: 'clicker_1000', name: 'Мастер кликов', icon: '💪', desc: 'Сделайте 1000 кликов' },
  { id: 'coins_1000', name: 'Богач', icon: '💰', desc: 'Накопите 1000 монет' },
  { id: 'coins_10000', name: 'Миллионер', icon: '🤑', desc: 'Накопите 10000 монет' },
  { id: 'gift_sender', name: 'Даритель', icon: '🎁', desc: 'Отправьте первый подарок' },
  { id: 'gift_10', name: 'Щедрый', icon: '💝', desc: 'Отправьте 10 подарков' },
  { id: 'level_5', name: 'Опытный', icon: '⭐', desc: 'Достигните 5 уровня' },
  { id: 'level_10', name: 'Легенда', icon: '🏆', desc: 'Достигните 10 уровня' },
  { id: 'chat_master', name: 'Общительный', icon: '💬', desc: 'Отправьте 100 сообщений' },
];

// ==================== МАГАЗИН ====================
const SHOP_ITEMS = [
  { id: 'boost_click', name: 'Буст клика', icon: '⚡', price: 200, desc: 'x2 к кликам на 1 час' },
  { id: 'boost_double', name: 'Двойные монеты', icon: '✨', price: 500, desc: 'x2 ко всем доходам на 1 час' },
  { id: 'theme_purple', name: 'Тема фиолетовая', icon: '💜', price: 300, desc: 'Фиолетовая тема' },
  { id: 'theme_gold', name: 'Тема золотая', icon: '👑', price: 1000, desc: 'Золотая тема' },
  { id: 'badge_star', name: 'Значок звезда', icon: '🌟', price: 400, desc: 'Эксклюзивный значок' },
  { id: 'badge_fire', name: 'Значок огонь', icon: '🔥', price: 600, desc: 'Эксклюзивный значок' },
];

// ==================== МИНИ-ИГРЫ ====================
const GAMES = [
  { id: 'dice', name: '🎲 Кости', desc: 'Угадайте число от 1 до 6', bet: 50 },
  { id: 'coin', name: '🪙 Монетка', desc: 'Орёл или решка', bet: 100 },
  { id: 'slots', name: '🎰 Слоты', desc: 'Три одинаковых символа', bet: 75 },
];

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

function getUserData(username, callback) {
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      console.error('Ошибка:', err);
      callback(null);
      return;
    }
    if (user) {
      try {
        user.gifts = JSON.parse(user.gifts || '[]');
        user.achievements = JSON.parse(user.achievements || '[]');
      } catch(e) {
        user.gifts = [];
        user.achievements = [];
      }
    }
    callback(user);
  });
}

function saveUserData(username, userData) {
  const giftsJson = JSON.stringify(userData.gifts || []);
  const achievementsJson = JSON.stringify(userData.achievements || []);
  db.run(
    'UPDATE users SET coins = ?, totalEarned = ?, clicks = ?, avatar = ?, isAdmin = ?, level = ?, theme = ?, dailyBonus = ?, gifts = ?, achievements = ?, lastSeen = CURRENT_TIMESTAMP WHERE username = ?',
    [
      userData.coins || 0,
      userData.totalEarned || 0,
      userData.clicks || 0,
      userData.avatar || '',
      userData.isAdmin || 0,
      userData.level || 1,
      userData.theme || 'dark',
      userData.dailyBonus || 0,
      giftsJson,
      achievementsJson,
      username
    ]
  );
}

function calculateLevel(coins) {
  return Math.floor(Math.sqrt(coins / 100)) + 1;
}

function checkAchievements(username, userData) {
  const newAchievements = [];
  
  ACHIEVEMENTS.forEach(ach => {
    if (userData.achievements.includes(ach.id)) return;
    
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
      userData.achievements.push(ach.id);
      newAchievements.push(ach);
    }
  });
  
  if (newAchievements.length > 0) {
    saveUserData(username, userData);
    return newAchievements;
  }
  return [];
}

function connectUser(ws, username) {
  connectedUsers[username] = { ws, connectedAt: new Date() };
  db.run('UPDATE users SET isOnline = 1, lastSeen = CURRENT_TIMESTAMP WHERE username = ?', [username]);
  
  db.run('UPDATE users SET coins = coins + 10 WHERE username = ?', [username]);
  
  getUserData(username, (userData) => {
    if (!userData) return;
    
    console.log(`🟢 ${username} подключился (💰 ${userData.coins}, ⭐ Ур.${userData.level})`);

    const onlineList = Object.keys(connectedUsers);
    ws.send(JSON.stringify({ 
      type: 'online_users', 
      users: onlineList,
      myData: userData
    }));

    db.all('SELECT username FROM users ORDER BY username', [], (err, rows) => {
      if (err) {
        console.error('Ошибка:', err);
        return;
      }
      const allUsers = rows.map(u => u.username);
      ws.send(JSON.stringify({ type: 'all_users', users: allUsers }));
    });

    db.all(
      'SELECT * FROM messages WHERE "from" = ? OR "to" = ? ORDER BY timestamp DESC LIMIT 50',
      [username, username],
      (err, rows) => {
        if (err) {
          console.error('Ошибка:', err);
          return;
        }
        ws.send(JSON.stringify({ type: 'conversations', conversations: rows }));
      }
    );
  });

  ws.on('message', (data) => {
    try {
      const messageData = JSON.parse(data);
      messageData.timestamp = new Date().toISOString();

      switch (messageData.type) {
        case 'chat':
        case 'photo':
        case 'voice':
        case 'circle':
          db.run(
            'INSERT INTO messages ("from", "to", type, text, url) VALUES (?, ?, ?, ?, ?)',
            [
              messageData.from,
              messageData.to,
              messageData.type,
              messageData.text || '',
              messageData.url || ''
            ],
            (err) => {
              if (err) console.error('Ошибка:', err);
            }
          );
          
          if (messageData.to) {
            db.run('UPDATE users SET lastSeen = CURRENT_TIMESTAMP WHERE username = ?', [messageData.to]);
          }
          
          broadcast(messageData);
          break;

        case 'get_chat':
          db.all(
            'SELECT * FROM messages WHERE ("from" = ? AND "to" = ?) OR ("from" = ? AND "to" = ?) ORDER BY timestamp ASC',
            [username, messageData.to, messageData.to, username],
            (err, rows) => {
              if (err) {
                console.error('Ошибка:', err);
                return;
              }
              ws.send(JSON.stringify({ type: 'chat_history', user: messageData.to, messages: rows }));
            }
          );
          break;

        case 'clicker':
          const earned = messageData.amount || 1;
          db.run('UPDATE users SET coins = coins + ?, totalEarned = totalEarned + ? WHERE username = ?', 
            [earned, earned, username], function() {
            db.run('UPDATE users SET clicks = clicks + 1 WHERE username = ?', [username], function() {
              getUserData(username, (updatedUser) => {
                if (updatedUser) {
                  const newLevel = calculateLevel(updatedUser.totalEarned || 0);
                  if (newLevel > updatedUser.level) {
                    updatedUser.level = newLevel;
                  }
                  
                  const newAchievements = checkAchievements(username, updatedUser);
                  
                  saveUserData(username, updatedUser);
                  
                  ws.send(JSON.stringify({
                    type: 'coins_update',
                    coins: updatedUser.coins,
                    level: updatedUser.level,
                    clicks: updatedUser.clicks
                  }));
                  
                  if (newAchievements.length > 0) {
                    newAchievements.forEach(ach => {
                      ws.send(JSON.stringify({
                        type: 'achievement_unlocked',
                        achievement: ach
                      }));
                    });
                  }
                }
              });
            });
          });
          break;

        case 'send_gift':
          const gift = GIFTS.find(g => g.type === messageData.giftType);
          if (!gift) break;
          
          getUserData(username, (senderData) => {
            if (!senderData || senderData.coins < gift.price) {
              ws.send(JSON.stringify({ type: 'error', message: 'Недостаточно монет!' }));
              return;
            }
            
            db.run('UPDATE users SET coins = coins - ? WHERE username = ?', [gift.price, username], () => {
              if (senderData.isAdmin) {
                db.run('UPDATE users SET coins = coins + ? WHERE username = ?', [gift.price, username]);
              }
              
              db.run(
                'INSERT INTO gifts ("from", "to", giftType, giftName, price) VALUES (?, ?, ?, ?, ?)',
                [username, messageData.to, gift.type, gift.name, gift.price],
                (err) => {
                  if (err) {
                    console.error('Ошибка:', err);
                    return;
                  }
                  
                  getUserData(messageData.to, (receiverData) => {
                    if (receiverData) {
                      receiverData.gifts = receiverData.gifts || [];
                      receiverData.gifts.push({
                        type: gift.type,
                        name: gift.name,
                        from: username,
                        timestamp: new Date().toISOString(),
                        rarity: gift.rarity
                      });
                      saveUserData(messageData.to, receiverData);
                    }
                  });
                  
                  // Check achievements for sender
                  getUserData(username, (senderWithGift) => {
                    if (senderWithGift) {
                      if (!senderWithGift.achievements.includes('gift_sender')) {
                        senderWithGift.achievements.push('gift_sender');
                        checkAchievements(username, senderWithGift);
                        saveUserData(username, senderWithGift);
                        ws.send(JSON.stringify({
                          type: 'achievement_unlocked',
                          achievement: ACHIEVEMENTS.find(a => a.id === 'gift_sender')
                        }));
                      }
                    }
                  });
                  
                  broadcast({
                    type: 'gift_received',
                    from: username,
                    to: messageData.to,
                    giftType: gift.type,
                    giftName: gift.name,
                    price: gift.price,
                    rarity: gift.rarity
                  });
                  
                  getUserData(username, (updatedSender) => {
                    ws.send(JSON.stringify({
                      type: 'coins_update',
                      coins: updatedSender.coins,
                      level: updatedSender.level,
                      clicks: updatedSender.clicks
                    }));
                  });
                }
              );
            });
          });
          break;

        case 'set_avatar':
          db.run('UPDATE users SET avatar = ? WHERE username = ?', [messageData.avatar, username], () => {
            getUserData(username, (userData) => {
              ws.send(JSON.stringify({
                type: 'avatar_update',
                avatar: userData.avatar
              }));
            });
          });
          break;

        case 'get_profile':
          getUserData(messageData.username, (userData) => {
            if (userData) {
              db.all(
                'SELECT * FROM gifts WHERE "to" = ? ORDER BY timestamp DESC',
                [messageData.username],
                (err, giftRows) => {
                  if (err) {
                    console.error('Ошибка:', err);
                    return;
                  }
                  ws.send(JSON.stringify({
                    type: 'profile_data',
                    user: userData,
                    gifts: giftRows || []
                  }));
                }
              );
            }
          });
          break;

        case 'give_admin':
          getUserData(username, (adminData) => {
            if (!adminData || !adminData.isAdmin) {
              ws.send(JSON.stringify({ type: 'error', message: 'Нет прав!' }));
              return;
            }
            
            db.run('UPDATE users SET isAdmin = 1 WHERE username = ?', [messageData.targetUsername], function(err) {
              if (this.changes > 0) {
                getUserData(messageData.targetUsername, (newAdmin) => {
                  ws.send(JSON.stringify({
                    type: 'admin_granted',
                    target: messageData.targetUsername,
                    admin: newAdmin
                  }));
                  
                  if (connectedUsers[messageData.targetUsername]) {
                    connectedUsers[messageData.targetUsername].ws.send(JSON.stringify({
                      type: 'you_are_admin'
                    }));
                  }
                });
              }
            });
          });
          break;

        case 'buy_shop_item':
          getUserData(username, (buyerData) => {
            if (!buyerData) return;
            const item = SHOP_ITEMS.find(i => i.id === messageData.itemId);
            if (!item || buyerData.coins < item.price) {
              ws.send(JSON.stringify({ type: 'error', message: 'Недостаточно монет!' }));
              return;
            }
            
            db.run('UPDATE users SET coins = coins - ? WHERE username = ?', [item.price, username], () => {
              if (item.id === 'theme_purple') {
                db.run('UPDATE users SET theme = ? WHERE username = ?', ['purple', username]);
              } else if (item.id === 'theme_gold') {
                db.run('UPDATE users SET theme = ? WHERE username = ?', ['gold', username]);
              }
              
              getUserData(username, (updatedUser) => {
                ws.send(JSON.stringify({
                  type: 'shop_purchased',
                  item: item,
                  coins: updatedUser.coins
                }));
              });
            });
          });
          break;

        case 'play_game':
          const game = GAMES.find(g => g.id === messageData.gameId);
          if (!game) break;
          
          getUserData(username, (playerData) => {
            if (!playerData || playerData.coins < game.bet) {
              ws.send(JSON.stringify({ type: 'error', message: 'Недостаточно монет!' }));
              return;
            }
            
            let win = false;
            let multiplier = 0;
            
            switch(game.id) {
              case 'dice':
                const diceResult = Math.floor(Math.random() * 6) + 1;
                win = diceResult === messageData.guess;
                multiplier = win ? 5 : 0;
                break;
              case 'coin':
                const coinResult = Math.random() > 0.5 ? 'heads' : 'tails';
                win = coinResult === messageData.choice;
                multiplier = win ? 1.8 : 0;
                break;
              case 'slots':
                const s1 = Math.floor(Math.random() * 3);
                const s2 = Math.floor(Math.random() * 3);
                const s3 = Math.floor(Math.random() * 3);
                win = s1 === s2 && s2 === s3;
                multiplier = win ? 10 : 0;
                break;
            }
            
            const winAmount = Math.floor(game.bet * multiplier);
            db.run('UPDATE users SET coins = coins + ? WHERE username = ?', [winAmount, username]);
            
            getUserData(username, (updatedUser) => {
              ws.send(JSON.stringify({
                type: 'game_result',
                won: win,
                amount: winAmount,
                result: messageData.result || ''
              }));
            });
          });
          break;

        case 'request_daily':
          getUserData(username, (dailyData) => {
            const lastDaily = dailyData.lastDaily || 0;
            const now = Date.now();
            
            if (now - lastDaily < 86400000) {
              ws.send(JSON.stringify({
                type: 'daily_error',
                message: 'Получите награду завтра!'
              }));
              return;
            }
            
            const bonus = 100 + (dailyData.level || 1) * 50;
            db.run('UPDATE users SET coins = coins + ?, dailyBonus = dailyBonus + 1, lastDaily = ? WHERE username = ?', 
              [bonus, now, username]);
            
            getUserData(username, (updatedUser) => {
              ws.send(JSON.stringify({
                type: 'daily_received',
                amount: bonus,
                streak: updatedUser.dailyBonus || 0
              }));
            });
          });
          break;

        case 'request_friends':
          db.all(
            'SELECT * FROM friends WHERE user1 = ? OR user2 = ?',
            [username, username],
            (err, friendRows) => {
              if (err) {
                console.error('Ошибка:', err);
                return;
              }
              
              const friends = friendRows.filter(f => f.status === 'accepted');
              db.all(
                'SELECT username FROM users WHERE username IN (?)',
                [friends.map(f => f.user1 === username ? f.user2 : f.user1)],
                (err, userRows) => {
                  ws.send(JSON.stringify({
                    type: 'friends_list',
                    friends: userRows.map(u => u.username)
                  }));
                }
              );
            }
          );
          break;

        case 'add_friend':
          db.run(
            'INSERT OR IGNORE INTO friends (user1, user2, status) VALUES (?, ?, ?)',
            [username, messageData.friendUsername, 'pending'],
            (err) => {
              if (err && !err.message.includes('UNIQUE')) {
                console.error('Ошибка:', err);
                return;
              }
              ws.send(JSON.stringify({ type: 'friend_added', username: messageData.friendUsername }));
            }
          );
          break;

        case 'accept_friend':
          db.run(
            'UPDATE friends SET status = ? WHERE user1 = ? AND user2 = ?',
            ['accepted', messageData.friendUsername, username],
            () => {
              ws.send(JSON.stringify({ type: 'friend_accepted', username: messageData.friendUsername }));
            }
          );
          break;

        case 'request_stats':
          db.all('SELECT COUNT(*) as count FROM users', [], (err, rows) => {
            const totalUsers = rows[0].count;
            
            db.all('SELECT COUNT(*) as count FROM messages', [], (err, rows) => {
              const totalMessages = rows[0].count;
              
              db.all('SELECT AVG(coins) as avg FROM users', [], (err, rows) => {
                const avgCoins = Math.floor(rows[0].avg || 0);
                
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
      console.error('Error:', e);
    }
  });

  ws.on('close', () => {
    delete connectedUsers[username];
    db.run('UPDATE users SET isOnline = 0, lastSeen = CURRENT_TIMESTAMP WHERE username = ?', [username]);
    
    const onlineList = Object.keys(connectedUsers);
    broadcast({ type: 'online_update', users: onlineList });
    console.log(`🔴 ${username} отключился`);
  });
}

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const username = params.get('username');
  const password = params.get('password');

  if (!username || !password) {
    ws.close();
    return;
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      console.error('Ошибка:', err);
      ws.close();
      return;
    }
    
    if (!user) {
      bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) {
          console.error('Ошибка:', err);
          ws.close();
          return;
        }
        
        const isAdmin = username.toLowerCase() === 'vortex' ? 1 : 0;
        
        db.run(
          'INSERT INTO users (username, password, isAdmin) VALUES (?, ?, ?)',
          [username, hashedPassword, isAdmin],
          (err) => {
            if (err && !err.message.includes('UNIQUE')) {
              console.error('Ошибка:', err);
              ws.close();
              return;
            }
            connectUser(ws, username);
          }
        );
      });
    } else {
      bcrypt.compare(password, user.password, (err, isMatch) => {
        if (err || !isMatch) {
          ws.close();
          return;
        }
        connectUser(ws, username);
      });
    }
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
