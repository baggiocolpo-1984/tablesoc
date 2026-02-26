import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// 基本的な定数
const TEAM_COLORS = {
    p1: 0x00ffff, // ネオンブルー
    p2: 0xff00ff  // ネオンマゼンタ
};

class Game {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });

        this.rods = [];
        this.ball = null;
        this.mySide = null;
        this.socket = io();

        this.init();
    }

    async init() {
        this.setupRenderer();
        this.setupLights();
        this.setupTable();
        this.setupSocket();
        this.animate();

        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupRenderer() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        document.getElementById('canvas-container').appendChild(this.renderer.domElement);

        this.camera.position.set(0, 10, 12);
        this.camera.lookAt(0, 0, 0);
    }

    setupLights() {
        const ambientLight = new THREE.AmbientLight(0x404040, 2);
        this.scene.add(ambientLight);

        const pointLight = new THREE.PointLight(0x00ffff, 2, 50);
        pointLight.position.set(0, 10, 0);
        this.scene.add(pointLight);
    }

    setupTable() {
        // テーブルの床
        const floorGeo = new THREE.BoxGeometry(10, 0.5, 22);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x050505,
            metalness: 0.9,
            roughness: 0.1,
            emissive: 0x001122
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.receiveShadow = true;
        this.scene.add(floor);

        // 物理の床
        const floorBody = new CANNON.Body({
            mass: 0,
            shape: new CANNON.Box(new CANNON.Vec3(5, 0.25, 11))
        });
        this.world.addBody(floorBody);

        // 壁 (少し長く)
        this.createWall(0, 1, 11.25, 10.5, 2, 0.5); // 奥
        this.createWall(0, 1, -11.25, 10.5, 2, 0.5); // 手前
        this.createWall(5.25, 1, 0, 0.5, 2, 23); // 右
        this.createWall(-5.25, 1, 0, 0.5, 2, 23); // 左

        this.setupGoals();
        this.setupBall();
        this.setupRods();
    }

    setupGoals() {
        const goalWidth = 3;
        const goalDepth = 1;
        const goalHeight = 1.5;

        const createGoal = (zPos, color) => {
            const goalGeo = new THREE.BoxGeometry(goalWidth, goalHeight, goalDepth);
            const goalMat = new THREE.MeshStandardMaterial({
                color: 0x111111,
                emissive: color,
                emissiveIntensity: 0.5,
                transparent: true,
                opacity: 0.5
            });
            const goalMesh = new THREE.Mesh(goalGeo, goalMat);
            goalMesh.position.set(0, goalHeight / 2, zPos);
            this.scene.add(goalMesh);

            // 枠線
            const edges = new THREE.EdgesGeometry(goalGeo);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: color }));
            goalMesh.add(line);
        };

        createGoal(-11, TEAM_COLORS.p1); // P1のゴール
        createGoal(11, TEAM_COLORS.p2);  // P2のゴール
    }

    createWall(x, y, z, w, h, d) {
        const geo = new THREE.BoxGeometry(w, h, d);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            metalness: 0.5,
            roughness: 0.5,
            transparent: true,
            opacity: 0.8
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        this.scene.add(mesh);

        const body = new CANNON.Body({
            mass: 0,
            shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2))
        });
        body.position.set(x, y, z);
        this.world.addBody(body);
    }

    setupBall() {
        const radius = 0.3;

        // クラシックなサッカーボールを描画するためのキャンバステクスチャ作成
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; // 白背景
        ctx.fillRect(0, 0, 512, 256);
        ctx.fillStyle = '#111111'; // 黒い模様
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 4; j++) {
                if ((i + j) % 2 === 0) {
                    ctx.beginPath();
                    // 六角形/五角形っぽく見えるように少し大きめの円を描画
                    ctx.arc(i * 64 + 32, j * 64 + 32, 24, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;

        const geo = new THREE.SphereGeometry(radius, 32, 32);
        const mat = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.6,
            metalness: 0.1
        });

        this.ball = new THREE.Mesh(geo, mat);
        this.ball.position.y = 2;
        this.scene.add(this.ball);

        const shape = new CANNON.Sphere(radius);
        this.ballBody = new CANNON.Body({
            mass: 1,
            shape: shape,
            position: new CANNON.Vec3(0, 2, 0),
            material: new CANNON.Material({ friction: 0.1, restitution: 0.7 })
        });
        this.world.addBody(this.ballBody);
    }

    setupRods() {
        // 1-4-3-3のフォーメーション設定 (Z座標と配置人数)
        const formation = [
            { z: -9, side: 'p1', count: 1 }, // P1 GK
            { z: -7, side: 'p1', count: 4 }, // P1 DF
            { z: -4, side: 'p2', count: 3 }, // P2 FW
            { z: -1, side: 'p1', count: 3 }, // P1 MF
            { z: 1, side: 'p2', count: 3 }, // P2 MF
            { z: 4, side: 'p1', count: 3 }, // P1 FW
            { z: 7, side: 'p2', count: 4 }, // P2 DF
            { z: 9, side: 'p2', count: 1 }  // P2 GK
        ];

        formation.forEach((rodConfig, index) => {
            const rodId = `rod_${index}`;
            const { z, side, count } = rodConfig;

            // Three.js Rod - 横棒をメタリックにして端まで伸ばす
            const rodGeo = new THREE.CylinderGeometry(0.1, 0.1, 12, 16);
            rodGeo.rotateZ(Math.PI / 2);
            const rodMat = new THREE.MeshStandardMaterial({
                color: 0x999999,
                metalness: 0.8,
                roughness: 0.2
            });
            const rodMesh = new THREE.Mesh(rodGeo, rodMat);
            rodMesh.position.set(0, 1.5, z);
            this.scene.add(rodMesh);

            // プレイヤー（人形）
            const players = this.createPlayersOnRod(rodMesh, side, count);

            // Cannon.js Rod Body
            const rodBody = new CANNON.Body({
                mass: 0,
                shape: new CANNON.Box(new CANNON.Vec3(6, 0.1, 0.1))
            });
            rodBody.position.set(0, 1.5, z);
            this.world.addBody(rodBody);

            this.rods.push({ id: rodId, mesh: rodMesh, body: rodBody, side: side, players: players });
        });
    }

    createPlayersOnRod(rodMesh, side, count) {
        const playerGeos = [];
        // 人数に応じて間隔を調整
        let spacing = 2;
        if (count === 4) spacing = 1.8;
        if (count === 1) spacing = 0;

        const color = TEAM_COLORS[side];

        for (let i = 0; i < count; i++) {
            const group = new THREE.Group();

            const bodyGeo = new THREE.BoxGeometry(0.6, 1.4, 0.4);
            const bodyMat = new THREE.MeshStandardMaterial({
                color: 0x111111,
                metalness: 0.3,
                roughness: 0.7,
                emissive: color,
                emissiveIntensity: 0.4
            });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.y = -0.7; // 棒より下に体を配置
            group.add(body);

            // 頭を追加
            const headGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
            const head = new THREE.Mesh(headGeo, bodyMat);
            head.position.y = 0.3;
            group.add(head);

            // 足（ボールを蹴る部分）を少し前に出す
            const footGeo = new THREE.BoxGeometry(0.6, 0.3, 0.3);
            const foot = new THREE.Mesh(footGeo, bodyMat);
            foot.position.y = -1.3;
            foot.position.z = 0.1;
            group.add(foot);

            if (count > 1) {
                group.position.x = (i - (count - 1) / 2) * spacing;
            } else {
                group.position.x = 0;
            }

            rodMesh.add(group);
            playerGeos.push(group);
        }
        return playerGeos;
    }

    setupSocket() {
        this.socket.on('init', (data) => {
            this.mySide = data.side;
            console.log('Joined as', this.mySide);

            // 自分のゴールが手前に来るようにカメラを調整
            if (this.mySide === 'p2') {
                this.camera.position.set(0, 10, -12);
                this.camera.lookAt(0, 0, 0);
            }

            document.getElementById('status-text').innerText = `YOU ARE ${this.mySide === 'p1' ? 'BLUE' : 'MAGENTA'}`;
            this.setupControls();
        });
    }

    setupControls() {
        this.activeRodIndex = 0; // 0=GK, 1=DF, 2=MF, 3=FW
        this.activeRod = null;

        const updateActiveRod = () => {
            const myRods = this.rods.filter(r => r.side === this.mySide);
            // 自分のゴールから近い順にソート (GK, DF, MF, FW)
            myRods.sort((a, b) => {
                const distA = this.mySide === 'p1' ? a.mesh.position.z : -a.mesh.position.z;
                const distB = this.mySide === 'p1' ? b.mesh.position.z : -b.mesh.position.z;
                return distA - distB;
            });

            if (this.activeRod) {
                this.setRodHighlight(this.activeRod, false);
            }
            this.activeRod = myRods[this.activeRodIndex];
            if (this.activeRod) {
                this.setRodHighlight(this.activeRod, true);
            }

            // Update UI buttons
            document.querySelectorAll('.rod-btn').forEach((btn, idx) => {
                if (idx === this.activeRodIndex) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        };

        updateActiveRod();

        // UIボタンによるロッド切り替え
        document.querySelectorAll('.rod-btn').forEach((btn, idx) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.activeRodIndex = idx;
                updateActiveRod();
            });
        });

        // 共通の移動メソッド (同期付き)
        const moveActiveRod = (dx) => {
            if (!this.activeRod) return;
            const dirMultiplier = this.mySide === 'p2' ? -1 : 1; // P2は視点が反転しているので操作も反転
            this.activeRod.mesh.position.x = Math.max(-2, Math.min(2, this.activeRod.mesh.position.x + dx * dirMultiplier));
            this.activeRod.body.position.x = this.activeRod.mesh.position.x;

            this.socket.emit('rodMove', {
                rodId: this.activeRod.id,
                x: this.activeRod.mesh.position.x,
                rotation: this.activeRod.mesh.rotation.x
            });
        };

        // 共通の回転メソッド (同期付き)
        const rotActiveRod = (speed) => {
            if (!this.activeRod) return;
            const dirMultiplier = this.mySide === 'p2' ? -1 : 1;
            this.rotateRod(this.activeRod, speed * dirMultiplier);
        };

        // ========== PC Keyboard Controls ==========
        window.addEventListener('keydown', (e) => {
            // キーボードの1~4でロッド切り替え
            if (['1', '2', '3', '4'].includes(e.key)) {
                this.activeRodIndex = parseInt(e.key) - 1;
                updateActiveRod();
                return;
            }

            const moveStep = 0.5;
            const rotStep = 0.2;

            if (e.key === 'ArrowLeft' || e.key === 'a') {
                moveActiveRod(-moveStep);
            } else if (e.key === 'ArrowRight' || e.key === 'd') {
                moveActiveRod(moveStep);
            } else if (e.key === 'ArrowUp' || e.key === 'w') {
                rotActiveRod(-rotStep);
            } else if (e.key === 'ArrowDown' || e.key === 's') {
                rotActiveRod(rotStep);
            }
        });

        // ========== PC Mouse Controls ==========
        let isMouseDown = false;
        let lastMouseX = 0;

        window.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isMouseDown = true;
            lastMouseX = e.clientX;
        });
        window.addEventListener('mousemove', (e) => {
            if (!isMouseDown) return;
            const dx = (e.clientX - lastMouseX) * 0.02;
            moveActiveRod(dx);
            lastMouseX = e.clientX;
        });
        window.addEventListener('mouseup', () => { isMouseDown = false; });

        window.addEventListener('wheel', (e) => {
            const rotSpeed = e.deltaY * 0.005;
            rotActiveRod(rotSpeed);
        });

        // ========== Mobile Touch Controls ==========
        let startX = 0, startY = 0;
        let lastTime = 0;

        window.addEventListener('touchstart', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            lastTime = Date.now();
        });

        window.addEventListener('touchmove', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            const touch = e.touches[0];
            const dx = (touch.clientX - startX) * 0.02;
            moveActiveRod(dx);
            startX = touch.clientX;
        });

        window.addEventListener('touchend', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            const touch = e.changedTouches[0];
            const dy = touch.clientY - startY;
            const dt = Date.now() - lastTime;

            // フリックによる回転
            if (Math.abs(dy) > 10 && dt < 200) {
                const rotationImpulse = dy * 0.01;
                rotActiveRod(rotationImpulse);
            }
        });
    }

    setRodHighlight(rod, active) {
        if (!rod) return;
        const intensity = active ? 2.0 : 0.2;
        rod.players.forEach(p => {
            p.children[0].material.emissiveIntensity = intensity;
        });
    }

    rotateRod(rod, speed) {
        rod.mesh.rotation.x += speed;
        // 物理エンジンの回転も同期させる必要があるが、Cannon.jsのBox回転は少し工夫が必要
        rod.body.quaternion.copy(rod.mesh.quaternion);

        this.socket.emit('rodMove', {
            rodId: rod.id,
            x: rod.mesh.position.x,
            rotation: rod.mesh.rotation.x
        });
    }

    setupSocket() {
        this.socket.on('init', (data) => {
            this.mySide = data.side;
            this.myId = data.id;
            console.log('Joined as', this.mySide);

            if (this.mySide === 'p2') {
                this.camera.position.set(0, 10, -12);
                this.camera.lookAt(0, 0, 0);
            }

            document.getElementById('status-text').innerText = `YOU ARE ${this.mySide === 'p1' ? 'BLUE' : 'MAGENTA'}`;
            document.getElementById('overlay').style.display = 'none';
            this.setupControls();
        });

        this.socket.on('rodMoved', (data) => {
            const rod = this.rods.find(r => r.id === data.rodId);
            if (rod) {
                // 反転同期ロジック
                // 相手からのデータなので、座標を反転させて表示する
                rod.mesh.position.x = -data.x;
                rod.mesh.rotation.x = -data.rotation;
                rod.body.position.x = rod.mesh.position.x;
                rod.body.quaternion.copy(rod.mesh.quaternion);
            }
        });

        this.socket.on('ballSynced', (data) => {
            if (this.mySide === 'p2') {
                this.ballBody.position.set(-data.x, data.y, -data.z);
                this.ballBody.velocity.set(-data.vx, data.vy, -data.vz);
            } else {
                this.ballBody.position.set(data.x, data.y, data.z);
                this.ballBody.velocity.set(data.vx, data.vy, data.vz);
            }
        });

        this.socket.on('scoreSynced', (scores) => {
            this.scores = scores;
            this.updateScoreUI();
        });
    }

    scoreGoal(winner) {
        if (this.isReplaying) return;

        // P1側がスコア管理の主導権を持つ（簡易化）
        if (this.mySide === 'p1') {
            this.scores[winner]++;
            this.socket.emit('scoreUpdate', this.scores);

            if (this.scores[winner] >= 5) {
                this.triggerSlowMoReplay(winner);
            } else {
                this.resetBall();
            }
        }
    }

    updateScoreUI() {
        document.getElementById('p1-score').innerText = this.scores.p1;
        document.getElementById('p2-score').innerText = this.scores.p2;
    }

    resetBall() {
        this.ballBody.position.set(0, 5, 0);
        this.ballBody.velocity.set(0, 0, 0);
        this.ballBody.angularVelocity.set(0, 0, 0);
    }

    triggerSlowMoReplay(winner) {
        this.isReplaying = true;
        this.timeScale = 0.1; // 超スローモーション

        // 勝った方のゴール付近を写す
        const goalZ = winner === 'p1' ? -10 : 10;
        const goalPos = new THREE.Vector3(0, 1, goalZ);

        const targetCamPos = new THREE.Vector3(5, 4, goalZ + (winner === 'p1' ? 5 : -5));

        let startTime = Date.now();
        const duration = 5000;

        const animateReplay = () => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / duration;

            if (progress < 1) {
                this.camera.position.lerp(targetCamPos, 0.02);
                this.camera.lookAt(goalPos);
                this.applyCameraShake(progress);
                requestAnimationFrame(animateReplay);
            } else {
                this.isReplaying = false;
                this.timeScale = 1.0;
                this.showResult(winner);
            }
        };
        requestAnimationFrame(animateReplay);
    }

    applyCameraShake(progress) {
        const intensity = (1 - progress) * 0.2;
        this.camera.position.x += (Math.random() - 0.5) * intensity;
        this.camera.position.y += (Math.random() - 0.5) * intensity;
    }

    showResult(winner) {
        const isWin = winner === this.mySide;
        document.getElementById('status-text').innerText = isWin ? "VICTORY" : "DEFEAT";
        document.getElementById('overlay').style.display = 'flex';
        document.getElementById('start-btn').style.display = 'block';
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        this.world.fixedStep(this.timeScale / 60);

        // ボールの同期表示
        this.ball.position.copy(this.ballBody.position);
        this.ball.quaternion.copy(this.ballBody.quaternion);

        // ロッドの物理反映
        this.rods.forEach(rod => {
            rod.body.position.copy(rod.mesh.position);
            rod.body.quaternion.copy(rod.mesh.quaternion);
        });

        // P1がボールのマスターとして位置を同期
        if (this.mySide === 'p1' && !this.isReplaying) {
            this.socket.emit('ballSync', {
                x: this.ballBody.position.x,
                y: this.ballBody.position.y,
                z: this.ballBody.position.z,
                vx: this.ballBody.velocity.x,
                vy: this.ballBody.velocity.y,
                vz: this.ballBody.velocity.z
            });
            this.checkGoals();
        }

        this.renderer.render(this.scene, this.camera);
    }

    checkGoals() {
        const threshold = 10.5;
        if (this.ballBody.position.z > threshold) {
            this.scoreGoal('p2');
        } else if (this.ballBody.position.z < -threshold) {
            this.scoreGoal('p1');
        }
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

// 起動
const gameInstance = new Game();
gameInstance.scores = { p1: 0, p2: 0 };
gameInstance.isReplaying = false;
gameInstance.timeScale = 1.0;
