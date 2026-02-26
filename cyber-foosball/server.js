const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// サーバー側でのゲーム状態管理
let players = {};
let gameState = {
    ball: { x: 0, y: 0.5, z: 0 },
    scores: { p1: 0, p2: 0 }
};

io.on('connection', (socket) => {
    console.log('a user connected:', socket.id);

    // プレイヤーの割り当て (2人まで)
    if (Object.keys(players).length < 2) {
        const playerSide = Object.keys(players).length === 0 ? 'p1' : 'p2';
        players[socket.id] = { side: playerSide };
        socket.emit('init', { side: playerSide, id: socket.id });
    } else {
        socket.emit('spectator');
    }

    socket.on('disconnect', () => {
        console.log('user disconnected:', socket.id);
        delete players[socket.id];
    });

    // ロッド操作の受信と全プレイヤーへの同期
    socket.on('rodMove', (data) => {
        socket.broadcast.emit('rodMoved', { id: socket.id, ...data });
    });

    // ボールの同期 (本来はサーバー側物理演算が理想だが、今回はクライアント主導の同期)
    socket.on('ballSync', (data) => {
        socket.broadcast.emit('ballSynced', data);
    });

    // スコアの同期
    socket.on('scoreUpdate', (data) => {
        gameState.scores = data;
        io.emit('scoreSynced', gameState.scores);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
