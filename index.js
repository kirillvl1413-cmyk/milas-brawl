require('dotenv').config();
const path=require('path');
const express=require('express');
const http=require('http');
const cors=require('cors');
const Database=require('better-sqlite3');
const {Server}=require('socket.io');
const db=new Database(path.join(__dirname,'milas.db'));
db.exec(`CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,name TEXT NOT NULL,coins INTEGER DEFAULT 1000,trophies INTEGER DEFAULT 0); CREATE TABLE IF NOT EXISTS friends(user_id TEXT,friend_id TEXT,PRIMARY KEY(user_id,friend_id));`);
const app=express(); const server=http.createServer(app); const io=new Server(server,{cors:{origin:'*'}}); app.use(cors()); app.use(express.json());
const online=new Map(); const queue=[];
function player(id,name){let p=db.prepare('SELECT * FROM players WHERE id=?').get(id); if(!p){db.prepare('INSERT INTO players(id,name) VALUES(?,?)').run(id,name||'Player');p=db.prepare('SELECT * FROM players WHERE id=?').get(id)} return p}
app.get('/api/player/:id',(req,res)=>res.json(player(req.params.id,req.query.name)));
app.get('/api/friends/:id',(req,res)=>{const rows=db.prepare('SELECT p.* FROM players p JOIN friends f ON p.id=f.friend_id WHERE f.user_id=?').all(req.params.id);res.json(rows.map(p=>({...p,online:online.has(p.id)}))) });
app.post('/api/friends/:id/:friend', (req,res)=>{player(req.params.id);player(req.params.friend);db.prepare('INSERT OR IGNORE INTO friends VALUES(?,?)').run(req.params.id,req.params.friend);res.json({ok:true})});
function finish(id,win){const p=player(id);const add=win?10:-3;db.prepare('UPDATE players SET trophies=MAX(0,trophies+?),coins=coins+? WHERE id=?').run(add,win?50:15,id);return player(id)}
function match(a,b){const room=`room_${Date.now()}_${Math.random().toString(36).slice(2)}`;a.join(room);b.join(room);a.data.room=room;b.data.room=room;a.data.enemy=b.data.id;b.data.enemy=a.data.id;a.emit('match_found',{room,enemy:b.data.player});b.emit('match_found',{room,enemy:a.data.player});}
io.on('connection',socket=>{socket.on('login',({id,name})=>{const p=player(String(id),name);socket.data.id=String(id);socket.data.player=p;online.set(String(id),socket.id);io.emit('presence',{id:String(id),online:true});socket.emit('player',p)});socket.on('queue',()=>{if(!socket.data.player)return;if(queue.includes(socket))return;const other=queue.shift();if(other&&other.connected)match(other,socket);else queue.push(socket)});socket.on('state',state=>{if(socket.data.room)socket.to(socket.data.room).emit('state',state)});socket.on('attack',data=>{if(socket.data.room)socket.to(socket.data.room).emit('attack',data)});socket.on('result',({win})=>{const p=finish(socket.data.id,!!win);socket.emit('player',p)});socket.on('disconnect',()=>{if(socket.data.id){online.delete(socket.data.id);io.emit('presence',{id:socket.data.id,online:false)}})});
});
const web=path.join(__dirname,'../web/dist');app.use(express.static(web));app.get('*',(req,res)=>res.sendFile(path.join(web,'index.html')));
server.listen(process.env.PORT||3000,()=>console.log('MILAS BRAWL server on '+(process.env.PORT||3000)));
