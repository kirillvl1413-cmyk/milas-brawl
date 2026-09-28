require('dotenv').config();

const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');

const db = new Database(path.join(__dirname, 'milas.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    coins INTEGER DEFAULT 1000,
    trophies INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS friends (
    user_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    PRIMARY KEY (user_id, friend_id)
  );
`);

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

const online = new Map();
const queue = [];

function getPlayer(id, name) {
  id = String(id);

  let p = db
    .prepare('SELECT * FROM players WHERE id = ?')
    .get(id);

  if (!p) {
    db.prepare(
      'INSERT INTO players (id, name, coins, trophies) VALUES (?, ?, 1000, 0)'
    ).run(id, name || 'Player');

    p = db
      .prepare('SELECT * FROM players WHERE id = ?')
      .get(id);
  } else if (name && p.name !== name) {
    db.prepare(
      'UPDATE players SET name = ? WHERE id = ?'
    ).run(name, id);

    p = db
      .prepare('SELECT * FROM players WHERE id = ?')
      .get(id);
  }

  return p;
}

app.get('/api/player/:id', (req, res) => {
  try {
    res.json(
      getPlayer(
        req.params.id,
        req.query.name
      )
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: 'Failed to load player'
    });
  }
});

app.get('/api/friends/:id', (req, res) => {
  try {
    const rows = db
      .prepare(`
        SELECT p.*
        FROM players p
        JOIN friends f ON p.id = f.friend_id
        WHERE f.user_id = ?
      `)
      .all(String(req.params.id));

    res.json(
      rows.map((p) => ({
        ...p,
        online: online.has(String(p.id))
      }))
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: 'Failed to load friends'
    });
  }
});

app.post('/api/friends/:id/:friend', (req, res) => {
  try {
    const userId = String(req.params.id);
    const friendId = String(req.params.friend);

    if (userId === friendId) {
      return res.status(400).json({
        error: 'Cannot add yourself as a friend'
      });
    }

    getPlayer(userId);
    getPlayer(friendId);

    db.prepare(
      `INSERT OR IGNORE INTO friends
       (user_id, friend_id)
       VALUES (?, ?)`
    ).run(userId, friendId);

    res.json({
      ok: true
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: 'Failed to add friend'
    });
  }
});

function finish(id, win) {
  const trophyChange = win ? 10 : -3;
  const coinChange = win ? 50 : 15;

  db.prepare(`
    UPDATE players
    SET trophies = MAX(0, trophies + ?),
        coins = coins + ?
    WHERE id = ?
  `).run(
    trophyChange,
    coinChange,
    String(id)
  );

  return getPlayer(id);
}

function matchPlayers(a, b) {
  const room =
    `room_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`;

  a.join(room);
  b.join(room);

  a.data.room = room;
  b.data.room = room;

  a.data.enemy = b.data.id;
  b.data.enemy = a.data.id;

  a.emit('match_found', {
    room,
    enemy: b.data.player
  });

  b.emit('match_found', {
    room,
    enemy: a.data.player
  });
}

function removeFromQueue(socket) {
  const index = queue.indexOf(socket);

  if (index !== -1) {
    queue.splice(index, 1);
  }
}

io.on('connection', (socket) => {

  socket.on('login', ({ id, name } = {}) => {

    if (id === undefined || id === null) {
      socket.emit('error_message', {
        message: 'Player id is required'
      });
      return;
    }

    const player = getPlayer(
      String(id),
      name
    );

    socket.data.id = String(id);
    socket.data.player = player;

    // Если этот игрок уже онлайн с другого сокета — отключаем старый
    const previousSocketId = online.get(String(id));
    if (previousSocketId && previousSocketId !== socket.id) {
      const previous = io.sockets.sockets.get(previousSocketId);
      if (previous) {
        previous.emit('error_message', {
          message: 'Logged in from another device'
        });
        previous.disconnect(true);
      }
    }

    online.set(
      String(id),
      socket.id
    );

    io.emit('presence', {
      id: String(id),
      online: true
    });

    socket.emit(
      'player',
      player
    );
  });

  socket.on('queue', () => {

    if (!socket.data.player) {
      return;
    }

    if (queue.includes(socket)) {
      return;
    }

    let other = null;

    while (queue.length > 0) {

      const candidate = queue.shift();

      if (
        candidate &&
        candidate.connected &&
        candidate !== socket &&
        candidate.data.player &&
        candidate.data.id !== socket.data.id
      ) {
        other = candidate;
        break;
      }
    }

    if (other) {
      matchPlayers(
        other,
        socket
      );
    } else {
      queue.push(socket);

      socket.emit(
        'queue_status',
        {
          queued: true
        }
      );
    }
  });

  socket.on('leave_queue', () => {

    removeFromQueue(socket);

    socket.emit(
      'queue_status',
      {
        queued: false
      }
    );
  });

  socket.on('state', (state) => {

    if (socket.data.room) {
      socket
        .to(socket.data.room)
        .emit('state', state);
    }
  });

  socket.on('attack', (data) => {

    if (socket.data.room) {
      socket
        .to(socket.data.room)
        .emit('attack', data);
    }
  });

  // Завершение матча на сервере (было не реализовано)
  socket.on('finish', ({ win } = {}) => {
    if (!socket.data.id) return;

    const updated = finish(socket.data.id, Boolean(win));
    socket.emit('player', updated);
  });

  // Обработка отключения — критично для чистоты очереди и online
  socket.on('disconnect', () => {
    removeFromQueue(socket);

    const id = socket.data.id;
    if (id && online.get(id) === socket.id) {
      online.delete(id);
      io.emit('presence', {
        id,
        online: false
      });
    }

    // Уведомляем соперника, если матч был активен
    if (socket.data.room) {
      socket
        .to(socket.data.room)
        .emit('enemy_left');
    }
  });
});
/app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
