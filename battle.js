const socket = io();
const $ = (id) => document.getElementById(id);

const playerId =
  localStorage.getItem('milas_player_id') ||
  ('p_' + Math.random().toString(36).slice(2, 10));

const playerName =
  localStorage.getItem('milas_player_name') || 'MILAS';

localStorage.setItem('milas_player_id', playerId);
localStorage.setItem('milas_player_name', playerName);

let room = null;
let enemy = null;

let myHp = 100;
let enemyHp = 100;

let x = 30;
let y = 50;

let enemyX = 70;
let enemyY = 50;

let joined = false;
let attackCooldown = false;

$('myName').textContent = playerName;
$('myHp').style.width = '100%';
$('enemyHp').style.width = '100%';


// =========================
// ПОДКЛЮЧЕНИЕ К СЕРВЕРУ
// =========================

socket.on('connect', () => {
  $('status').textContent = 'ПОДКЛЮЧЕНО';

  socket.emit('login', {
    id: playerId,
    name: playerName
  });
});


// =========================
// ИГРОК ПОЛУЧЕН
// =========================

socket.on('player', () => {

  if (joined) return;

  joined = true;

  $('status').textContent =
    'ПОИСК СОПЕРНИКА...';

  socket.emit('queue');
});


// =========================
// ОЧЕРЕДЬ
// =========================

socket.on('queue_status', (data) => {

  if (data && data.queued) {

    $('status').textContent =
      'ПОИСК СОПЕРНИКА...';

  }

});


// =========================
// НАЙДЕН СОПЕРНИК
// =========================

socket.on('match_found', (data) => {

  room = data.room;

  enemy = data.enemy || {};

  $('enemyName').textContent =
    enemy.name || 'Соперник';

  $('status').textContent =
    'БОЙ НАЧАЛСЯ!';

  $('waiting').classList.add('hidden');

  myHp = 100;
  enemyHp = 100;

  x = 30;
  y = 50;

  enemyX = 70;
  enemyY = 50;

  $('myHp').style.width = '100%';
  $('enemyHp').style.width = '100%';

  render();

});


// =========================
// СОСТОЯНИЕ СОПЕРНИКА
// =========================

socket.on('state', (state) => {

  if (!state) return;

  if (state.id === playerId) return;

  if (typeof state.x === 'number') {
    enemyX = state.x;
  }

  if (typeof state.y === 'number') {
    enemyY = state.y;
  }

  if (typeof state.hp === 'number') {
    enemyHp = state.hp;
  }

  render();

});


// =========================
// АТАКА СОПЕРНИКА
// =========================

socket.on('attack', (data) => {

  if (!data) return;

  if (data.id === playerId) return;

  const distance =
    Math.hypot(
      enemyX - x,
      enemyY - y
    );

  if (distance < 16) {

    myHp = Math.max(
      0,
      myHp - (data.damage || 20)
    );

    $('myHp').style.width =
      myHp + '%';

    if (myHp <= 0) {

      finish(false);

    }

  }

});


// =========================
// СОПЕРНИК ВЫШЕЛ
// =========================

socket.on('enemy_left', () => {

  $('status').textContent =
    'СОПЕРНИК ВЫШЕЛ';

  room = null;

  setTimeout(() => {

    location.reload();

  }, 1500);

});


// =========================
// ОШИБКА
// =========================

socket.on('error_message', (data) => {

  $('status').textContent =
    data?.message || 'Ошибка';

});


// =========================
// ОТРИСОВКА
// =========================

function render() {

  $('me').style.left =
    x + '%';

  $('me').style.top =
    y + '%';

  $('enemy').style.left =
    enemyX + '%';

  $('enemy').style.top =
    enemyY + '%';

  $('enemyHp').style.width =
    enemyHp + '%';

}


// =========================
// ОТПРАВКА ПОЗИЦИИ
// =========================

function sendState() {

  if (!room)
