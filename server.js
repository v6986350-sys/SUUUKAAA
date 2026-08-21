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
      avatar TEXT DEFAULT '',
      isAdmin INTEGER DEFAULT 0,
      gifts TEXT DEFAULT '[]'
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

  db.run(`CREATE INDEX IF NOT EXISTS idx_msg_from_to ON messages("from", "to")`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_msg_to ON messages("to")`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_gifts_to ON gifts("to")`);
});

console.log('✅ SQLite база данных готова');

// ==================== ДАННЫЕ ПОДАРКОВ ====================
const GIFTS = [
  { type: 'rose', name: '🌹 Роза', price: 50 },
  { type: 'heart', name: '❤️ Сердце', price: 100 },
  { type: 'star', name: '⭐ Звезда', price: 75 },
  { type: 'flower', name: '🌸 Цветок', price: 60 },
  { type: 'ring', name: '💍 Кольцо', price: 200 },
  { type: 'crown', name: '👑 Корона', price: 500 },
  { type: 'diamond', name: '💎 Алмаз', price: 1000 },
  { type: 'cake', name: '🎂 Торт', price: 150 },
  { type: 'coffee', name: '☕ Кофе', price: 30 },
  { type: 'beer', name: '🍺 Пиво', price: 40 },
  { type: 'rocket', name: '🚀 Ракета', price: 300 },
  { type: 'fire', name: '🔥 Огонь', price: 250 },
  { type: 'music', name: '🎵 Музыка', price: 80 },
  { type: 'book', name: '📚 Книга', price: 45 },
  { type: 'game', name: '🎮 Игра', price: 120 },
  { type: 'car', name: '🚗 Машина', price: 800 },
  { type: 'house', name: '🏠 Дом', price: 1500 },
  { type: 'planet', name: '🪐 Планета', price: 2000 },
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
      console.error('Ошибка получения данных:', err);
      callback(null);
      return;
    }
    if (user) {
      try {
        user.gifts = JSON.parse(user.gifts || '[]');
      } catch(e) {
        user.gifts = [];
      }
    }
    callback(user);
  });
}

function saveUserData(username, userData) {
  const giftsJson = JSON.stringify(userData.gifts || []);
  db.run(
    'UPDATE users SET coins = ?, avatar = ?, isAdmin = ?, gifts = ?, lastSeen = CURRENT_TIMESTAMP WHERE username = ?',
    [userData.coins || 0, userData.avatar || '', userData.isAdmin || 0, giftsJson, username]
  );
}

function connectUser(ws, username) {
  connectedUsers[username] = { ws, connectedAt: new Date() };
  db.run('UPDATE users SET isOnline = 1, lastSeen = CURRENT_TIMESTAMP WHERE username = ?', [username]);
  
  db.run('UPDATE users SET coins = coins + 10 WHERE username = ?', [username]);
  
  getUserData(username, (userData) => {
    if (!userData) return;
    
    console.log(`🟢 ${username} подключился (💰 ${userData.coins})`);

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
          db.run('UPDATE users SET coins = coins + ? WHERE username = ?', [earned, username], () => {
            getUserData(username, (userData) => {
              ws.send(JSON.stringify({
                type: 'coins_update',
                coins: userData.coins
              }));
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
                        timestamp: new Date().toISOString()
                      });
                      saveUserData(messageData.to, receiverData);
                    }
                  });
                  
                  broadcast({
                    type: 'gift_received',
                    from: username,
                    to: messageData.to,
                    giftType: gift.type,
                    giftName: gift.name,
                    price: gift.price
                  });
                  
                  getUserData(username, (updatedSender) => {
                    ws.send(JSON.stringify({
                      type: 'coins_update',
                      coins: updatedSender.coins
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
