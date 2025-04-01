 class PowerGrid {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.gridSize = 25;
        this.cellSize = 30;
        this.buildings = [];
        this.connections = [];
        this.gold = 1000;
        this.reputation = 100;
        this.selectedBuilding = null; // 用于存储选中的建筑物
        this.selectedConnection = null; // 用于存储右键选中的连接
        this.gameStartTime = Date.now();
        this.lastFactoryTime = Date.now();
        this.factoryMinInterval = 15000; // 初始15秒最小间隔
        this.factoryMaxInterval = 30000; // 初始30秒最大间隔
        this.isWarning = false;
        this.warningType = null; // 'low' 或 'high'
        this.gameOver = false;
        this.flashTimer = 0;
        this.warningNetworks = new Set(); // 存储警告状态的网络
        this.gameSpeed = 1; // 添加游戏速度控制
        this.nuclearSymbol = new Image();
        this.nuclearSymbol.src = 'data:image/svg+xml;base64,' + btoa(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="45" fill="#ffde00"/>
                <g fill="#000">
                    <path d="M50 50 L20 85 L80 85 Z"/>
                    <path d="M50 50 L20 85 L80 85 Z" transform="rotate(120, 50, 50)"/>
                    <path d="M50 50 L20 85 L80 85 Z" transform="rotate(240, 50, 50)"/>
                    <circle cx="50" cy="50" r="10"/>
                </g>
            </svg>
        `.trim());

        // 等待图标加载完成
        this.nuclearSymbol.onload = () => {
            this.render(); // 图标加载完成后重新渲染
        };
        this.lastSolarUpdate = Date.now(); // 记录上次光伏更新时间
        this.lastBatteryUpdate = Date.now(); // 记录上次电池更新时间
        this.isPaused = false;
        this.explosions = []; // 添加爆炸效果数组
        this.lastWindUpdate = Date.now(); // 记录上次风电更新时间
        this.windRotation = 0; // 风车旋转角度
        this.terrain = []; // 存储地形数据
        this.generateTerrain(); // 生成地形
        this.messages = []; // 添加消息数组
        this.reputationThresholds = [75, 50, 25]; // 信誉值阈值
        this.triggeredThresholds = new Set(); // 记录已触发的阈值
        this.lastReputationPenalty = 0;           // 添加最后一次扣分时间戳
        
        // 修改游戏说明，添加兵工厂描述
        this.gameDescription = `
操作说明：
1. 使用方向键移动光标
2. 空格键放置或移除电线
3. 按ESC键暂停游戏

游戏规则：
1. 电厂会持续产生电力
2. 需要将电力输送到负载（住宅、工厂等）
3. 兵工厂将不时出现，其往往耗电量较大，随机消失。给兵工厂通电将补充信誉值
4. 未能及时供电会降低信誉值
5. 当子电网消失时，将扣除该子电网所连全部负荷的信誉值
6. 信誉值降至0以下时游戏结束
`;
        
        this.init();
    }

    init() {
        // 调整画布大小以适应窗口
        const updateCanvasSize = () => {
            const size = Math.min(
                this.canvas.parentElement.clientWidth,
                this.canvas.parentElement.clientHeight - 40
            );
            this.canvas.width = size;
            this.canvas.height = size;
            this.cellSize = size / this.gridSize;
        };

        updateCanvasSize();
        window.addEventListener('resize', () => {
            updateCanvasSize();
            this.render();
        });

        // 初始化游戏状态
        this.setupInitialBuildings();
        this.setupEventListeners();
        this.setupPauseHandler();
        this.startGameLoop();
        this.setupSpeedButton();
    }

    setupInitialBuildings() {
        // 修改初始建筑属性
        this.buildings.push({
            type: 'powerplant',
            power: 200,
            position: {x: 5, y: 5}
        });
        
        this.buildings.push({
            type: 'transformer',
            efficiency: 0.95,
            capacity: 500,
            position: {x: 5, y: 7}
        });
        
        this.buildings.push({
            type: 'factory',
            consumption: 190,
            position: {x: 5, y: 9},
            timer: 60,  // 设置初始倒计时
            startTime: Date.now(),  // 设置开始时间
            reputationPenalty: 3
        });

        // 只添加发电站到变电站的连接
        this.connections.push({
            from: this.buildings[0],
            to: this.buildings[1]
        });
    }

    setupEventListeners() {
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        this.canvas.addEventListener('contextmenu', (e) => this.handleRightClick(e));
        
        // 拖拽相关事件
        const buildingItems = document.querySelectorAll('.building-item');
        buildingItems.forEach(item => {
            item.addEventListener('dragstart', (e) => this.handleDragStart(e));
        });

        this.canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        this.canvas.addEventListener('drop', (e) => this.handleDrop(e));
    }

    setupPauseHandler() {
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                this.isPaused = !this.isPaused;
                const overlay = document.querySelector('.paused-overlay') || 
                              this.createPauseOverlay();
                overlay.style.display = this.isPaused ? 'block' : 'none';
            }
        });
    }

    createPauseOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'paused-overlay';
        overlay.textContent = '游戏已暂停';
        document.body.appendChild(overlay);
        return overlay;
    }

    startGameLoop() {
        const gameLoop = () => {
            if (!this.isPaused) {
                this.generateRandomBuilding();
                this.updateFactories();
                this.updateSolarPanels();
                this.updateWindPower(); // 添加风电站更新
                this.updateBatteries();
                this.checkPowerBalance();
                this.flashTimer++;
            }
            this.render();
            requestAnimationFrame(gameLoop);
        };
        gameLoop();
    }

    generateRandomBuilding() {
        // 如果游戏已结束，直接返回
        if (this.gameOver) {
            return;
        }
        
        const currentTime = Date.now();
        
        if (currentTime - this.lastFactoryTime >= this.factoryMinInterval / this.gameSpeed) {
            if (Math.random() < 0.3) { // 30%概率生成建筑
                const x = Math.floor(Math.random() * this.gridSize);
                const y = Math.floor(Math.random() * this.gridSize);
                
                if (!this.isCellOccupied(x, y)) {
                    const buildingType = Math.random();
                    if (buildingType < 0.6) { // 60%概率生成工厂
                        const consumption = Math.floor(Math.random() * 151) + 50;
                        const factory = {
                            type: 'factory',
                            consumption: consumption,
                            position: {x, y},
                            timer: 60,
                            startTime: Date.now(),
                            reputationPenalty: 3 // 工厂消失扣3点信誉
                        };
                        this.buildings.push(factory);
                    } else if (buildingType < 0.8) { // 20%概率生成居民楼
                        const consumption = Math.floor(Math.random() * 16) + 10;
                        const residential = {
                            type: 'residential',
                            consumption: consumption,
                            position: {x, y},
                            timer: 25,
                            startTime: Date.now(),
                            reputationPenalty: 10 // 居民楼消失扣10点信誉
                        };
                        this.buildings.push(residential);
                    } else { // 20%概率生成兵工厂
                        const consumption = Math.floor(Math.random() * 101) + 400; // 400-500
                        const armory = {
                            type: 'armory',
                            consumption: consumption,
                            position: {x, y},
                            timer: 30,
                            startTime: Date.now(),
                            isHighlighted: true // 用于显示闪烁效果
                        };
                        this.buildings.push(armory);
                    }
                    this.lastFactoryTime = currentTime;
                }
            }
        }
    }

    updateFactories() {
        const currentTime = Date.now();
        const deltaTime = (currentTime - (this.lastUpdateTime || currentTime)) * this.gameSpeed;
        this.lastUpdateTime = currentTime;
        
        // 获取所有电网及其负荷比
        const networks = this.getIndependentNetworks();
        const networkLoadRatios = new Map();
        
        networks.forEach(network => {
            let totalGeneration = 0;
            let totalConsumption = 0;
            
            network.forEach(building => {
                if (building.type === 'powerplant') {
                    totalGeneration += building.power;
                } else if ((building.type === 'factory' || building.type === 'residential') && 
                          this.isPowered(building)) {
                    totalConsumption += building.consumption;
                }
            });
            
            // 计算这个网络的负荷比
            const ratio = totalConsumption > 0 ? Math.min(totalGeneration / totalConsumption, 1) : 1;
            network.forEach(building => networkLoadRatios.set(building, ratio));
        });

        // 更新建筑状态和收费
        // 使用新数组存储要删除的建筑
        const buildingsToRemove = [];
        
        this.buildings.forEach((building, index) => {
            if (building.type === 'factory' || building.type === 'residential') {
                if (building.timer !== null) {
                    const elapsed = (currentTime - building.startTime) * this.gameSpeed / 1000;
                    building.timer = Math.max(0, (building.type === 'residential' ? 25 : 60) - Math.floor(elapsed));
                    
                    // 如果倒计时结束或已通电，检查状态
                    if (building.timer <= 0 || this.isPowered(building)) {
                        if (this.isPowered(building)) {
                            // 如果通电，开始计费
                            building.timer = null;
                            building.lastPayout = Date.now();
                        } else {
                            // 如果倒计时结束且未通电，扣分并移除
                            if (building.type === 'factory') {
                                this.deductReputation(3);
                            } else if (building.type === 'residential') {
                                this.deductReputation(10);
                            }
                            buildingsToRemove.push(building);
                        }
                    }
                } else if (this.isPowered(building)) {
                    if (Date.now() - (building.lastPayout || 0) >= 3000) {
                        // 获取该建筑所在网络的负荷比
                        const loadRatio = networkLoadRatios.get(building) || 1;
                        // 计算实际用电量
                        const actualConsumption = Math.floor(building.consumption * loadRatio);
                        // 计算收入
                        const income = Math.floor(actualConsumption * (building.type === 'factory' ? 0.05 : 0.1));
                        
                        this.gold += income;
                        document.getElementById('goldAmount').textContent = this.gold;
                        building.lastPayout = Date.now();
                    }
                }
            } else if (building.type === 'armory') {
                if (building.timer !== null) {
                    const elapsed = (currentTime - building.startTime) * this.gameSpeed / 1000;
                    building.timer = Math.max(0, 30 - Math.floor(elapsed));
                    
                    // 如果通电且倒计时结束，增加信誉值
                    if (building.timer <= 0 && this.isPowered(building)) {
                        this.reputation = Math.min(100, this.reputation + 5);
                        document.getElementById('reputationPoints').textContent = this.reputation;
                        buildingsToRemove.push(building);
                        building.isHighlighted = false;
                    }
                }
                
                // 通电后停止高亮效果
                if (this.isPowered(building)) {
                    building.isHighlighted = false;
                }
            }
        });
        
        // 在循环结束后统一删除建筑
        buildingsToRemove.forEach(building => {
            this.explodeBuilding(building);
        });

        // 更新电力统计
        this.updatePowerStats();
    }

    updatePowerStats() {
        const networks = this.getIndependentNetworks();
        let statsHtml = '';
        
        networks.forEach((network, index) => {
            let totalGeneration = 0;
            let totalLoad = 0;
            let hasGenerator = false;
            let hasConsumer = false;
            let hasTerminal = false;

            network.forEach(building => {
                if (building.type === 'powerplant') {
                    totalGeneration += building.power;
                    hasGenerator = true;
                } else if ((building.type === 'factory' || building.type === 'residential') && 
                          this.isPowered(building)) {
                    totalLoad += building.consumption;
                    hasConsumer = true;
                } else if (building.type === 'terminal' && this.isPowered(building)) {
                    hasTerminal = true;
                }
            });

            if (hasGenerator && hasConsumer) {
                const loadRatio = totalLoad > 0 ? (totalGeneration / totalLoad * 100).toFixed(1) : 0;
                
                statsHtml += `
                    <div class="network-stats">
                        <div>网${index + 1}: ${totalGeneration}/${totalLoad} (${loadRatio}%)</div>
                        ${hasTerminal ? this.getPredictionHtml(totalGeneration, totalLoad) : ''}
                    </div>
                `;
            }
        });

        document.querySelector('.power-stats').innerHTML = statsHtml;
    }

    getPredictionHtml(generation, load) {
        // 计算可增加的负荷（基于60%负荷比下限）
        const maxAddableLoad = Math.max(0, Math.floor(generation / 0.6 - load));
        
        // 计算可增加的发电量（基于150%负荷比上限）
        const maxAddableGeneration = Math.max(0, Math.floor(load * 1.5 - generation));
        
        return `
            <div class="prediction">
                可增负荷: ${maxAddableLoad}
                可增发电: ${maxAddableGeneration}
            </div>
        `;
    }

    isPowered(building) {
        // 检查建筑是否已通电
        return this.connections.some(conn => conn.to === building);
    }

    render() {
        // 清除画布
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 绘制网格
        this.drawGrid();
        
        // 绘制连接
        this.drawConnections();
        
        // 绘制建筑
        this.drawBuildings();
        
        // 绘制爆炸效果
        this.drawExplosions();
        
        // 绘制消息
        this.drawMessages();
    }

    drawGrid() {
        const offset = (this.canvas.width - (this.gridSize * this.cellSize)) / 2;
        
        // 先绘制地形
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const terrainType = this.terrain[y][x];
                if (terrainType !== 'normal') {
                    this.ctx.fillStyle = terrainType === 'desert' ? 
                        'rgba(255, 248, 220, 0.2)' : // 浅黄色沙漠
                        'rgba(173, 216, 230, 0.2)';  // 浅蓝色海洋
                    this.ctx.fillRect(
                        x * this.cellSize + offset,
                        y * this.cellSize + offset,
                        this.cellSize,
                        this.cellSize
                    );
                }
            }
        }
        
        // 绘制网格线
        this.ctx.strokeStyle = '#333';
        this.ctx.lineWidth = 1;
        
        for (let i = 0; i <= this.gridSize; i++) {
            const pos = (i * this.cellSize) + offset;
            
            // 垂直线
            this.ctx.beginPath();
            this.ctx.moveTo(pos, offset);
            this.ctx.lineTo(pos, this.canvas.height - offset);
            this.ctx.stroke();
            
            // 水平线
            this.ctx.beginPath();
            this.ctx.moveTo(offset, pos);
            this.ctx.lineTo(this.canvas.width - offset, pos);
            this.ctx.stroke();
        }
    }

    drawBuildings() {
        const offset = (this.canvas.width - (this.gridSize * this.cellSize)) / 2;
        
        this.buildings.forEach(building => {
            const x = (building.position.x * this.cellSize) + offset;
            const y = (building.position.y * this.cellSize) + offset;
            
            let size = building.size || 1;
            let width = this.cellSize * size;
            let height = this.cellSize * size;

            // 检查建筑物是否在警告网络中
            let isWarning = false;
            let warningType = null;
            this.warningNetworks.forEach(network => {
                if (network.buildings.includes(building)) {
                    isWarning = true;
                    warningType = network.type;
                }
            });

            // 根据建筑类型绘制
            switch(building.type) {
                case 'powerplant':
                    if (building.isNuclear) {
                        // 绘制核电站冷凝塔
                        this.ctx.fillStyle = '#ff4444';
                        const towerWidth = width * 0.8;
                        const towerHeight = height * 0.9;
                        const towerX = x + (width - towerWidth) / 2;
                        const towerY = y + height - towerHeight;
                        
                        // 绘制冷凝塔主体
                        this.drawCoolingTower(towerX, towerY, towerWidth, towerHeight);
                        
                        // 绘制向右飘的云状白烟
                        this.ctx.fillStyle = '#ffffff';
                        const smokeWidth = towerWidth * 1.2;
                        const smokeHeight = height * 0.3;
                        const smokeX = towerX + towerWidth * 0.3; // 从冷凝塔右侧开始
                        const smokeY = y;
                        
                        // 绘制多层云状白烟
                        for (let i = 0; i < 3; i++) {
                            const offsetX = i * (smokeWidth * 0.3);
                            const offsetY = i * (smokeHeight * 0.1);
                            this.drawCloud(
                                smokeX + offsetX,
                                smokeY + offsetY,
                                smokeWidth * 0.5,
                                smokeHeight * 0.7
                            );
                        }
                        
                        // 绘制核能标志
                        const symbolSize = width * 0.4;
                        const symbolX = x + (width - symbolSize) / 2;
                        const symbolY = y + (height - symbolSize) / 2;
                        this.ctx.drawImage(this.nuclearSymbol, symbolX, symbolY, symbolSize, symbolSize);
                        
                        // 显示发电量
                        this.ctx.fillStyle = 'white';
                        this.ctx.font = '12px Arial';
                        this.ctx.fillText(building.power, x + 5, y + height - 5);
                    } else if (building.isSolar) {
                        // 检查是否在沙漠中获得加成
                        const isBuffed = this.terrain[building.position.y][building.position.x] === 'desert';
                        
                        // 如果有加成效果，先绘制金光
                        if (isBuffed) {
                            const gradient = this.ctx.createRadialGradient(
                                x + width/2, y + height/2, 0,
                                x + width/2, y + height/2, width/2
                            );
                            gradient.addColorStop(0, 'rgba(255, 215, 0, 0.3)');
                            gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
                            
                            this.ctx.fillStyle = gradient;
                            this.ctx.beginPath();
                            this.ctx.arc(x + width/2, y + height/2, width * 0.8, 0, Math.PI * 2);
                            this.ctx.fill();
                        }
                        
                        // 绘制太阳能板支架
                        this.ctx.fillStyle = '#666';
                        this.ctx.beginPath();
                        this.ctx.moveTo(x + width * 0.2, y + height * 0.8);
                        this.ctx.lineTo(x + width * 0.8, y + height * 0.8);
                        this.ctx.lineTo(x + width * 0.5, y + height * 0.5);
                        this.ctx.closePath();
                        this.ctx.fill();
                        
                        // 绘制倾斜的太阳能板
                        this.ctx.fillStyle = '#1a4b77'; // 深蓝色
                        this.ctx.save();
                        this.ctx.translate(x + width * 0.5, y + height * 0.5);
                        this.ctx.rotate(-Math.PI/6); // 30度倾角
                        
                        // 添加金色光晕效果
                        const panelGradient = this.ctx.createLinearGradient(
                            -width * 0.4, 0,
                            width * 0.4, 0
                        );
                        panelGradient.addColorStop(0, '#1a4b77');
                        panelGradient.addColorStop(0.5, '#1a4b77');
                        panelGradient.addColorStop(0.7, '#ffd700');
                        panelGradient.addColorStop(1, '#1a4b77');
                        
                        this.ctx.fillStyle = panelGradient;
                        this.ctx.fillRect(-width * 0.4, -height * 0.05, width * 0.8, height * 0.1);
                        this.ctx.restore();
                        
                        // 显示发电量
                        this.ctx.fillStyle = 'white';
                        this.ctx.font = '12px Arial';
                        this.ctx.fillText(building.power, x + 5, y + height - 5);
                    } else if (building.isWind) {
                        // 检查是否在海洋中获得加成
                        const isBuffed = this.terrain[building.position.y][building.position.x] === 'ocean';
                        
                        // 如果有加成效果，先绘制金光
                        if (isBuffed) {
                            // 绘制发光效果
                            const gradient = this.ctx.createRadialGradient(
                                x + width/2, y + height/2, 0,
                                x + width/2, y + height/2, width/2
                            );
                            gradient.addColorStop(0, 'rgba(255, 215, 0, 0.3)');
                            gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
                            
                            this.ctx.fillStyle = gradient;
                            this.ctx.beginPath();
                            this.ctx.arc(x + width/2, y + height/2, width * 0.8, 0, Math.PI * 2);
                            this.ctx.fill();
                        }
                        
                        // 绘制风电站本体
                        const poleWidth = width * 0.1;
                        const poleHeight = height * 0.8;
                        const poleX = x + width/2 - poleWidth/2;
                        const poleY = y + height - poleHeight;
                        
                        // 绘制杆子
                        this.ctx.fillStyle = '#87ceeb';
                        this.ctx.fillRect(poleX, poleY, poleWidth, poleHeight);
                        
                        // 绘制旋转的叶片
                        const centerX = x + width/2;
                        const centerY = poleY;
                        const bladeLength = width * 0.4;
                        const rotationSpeed = (building.power - 80) / 20 * 0.2 + 0.1; // 根据发电量调整速度
                        
                        this.ctx.save();
                        this.ctx.translate(centerX, centerY);
                        this.ctx.rotate(this.windRotation * rotationSpeed);
                        
                        // 绘制三个叶片
                        for (let i = 0; i < 3; i++) {
                            this.ctx.fillStyle = '#ffffff';
                            this.ctx.beginPath();
                            this.ctx.ellipse(0, -bladeLength/2, bladeLength/6, bladeLength, 0, 0, Math.PI * 2);
                            this.ctx.fill();
                            this.ctx.rotate(Math.PI * 2 / 3);
                        }
                        
                        this.ctx.restore();
                        
                        // 显示发电量
                        this.ctx.fillStyle = 'white';
                        this.ctx.font = '12px Arial';
                        this.ctx.fillText(building.power, x + 5, y + height - 5);
                    } else {
                        // 普通发电站 - 两个梯形冷凝塔和厂房
                        this.ctx.fillStyle = building.power <= 100 ? '#ffb4b4' : '#ff6b6b';
                        const scale = building.power <= 100 ? 1 : 1.2; // 中型电站略大
                        
                        // 绘制厂房
                        const plantWidth = width * 0.5 * scale;
                        const plantHeight = height * 0.6 * scale;
                        const plantX = x + width * 0.4;
                        const plantY = y + height - plantHeight;
                        this.ctx.fillRect(plantX, plantY, plantWidth, plantHeight);
                        
                        // 绘制两个梯形冷凝塔
                        const towerWidth = width * 0.2 * scale;
                        const towerHeight = height * 0.7 * scale;
                        const tower1X = x + width * 0.05;
                        const tower2X = x + width * 0.2;
                        const towerY = y + height - towerHeight;
                        
                        // 绘制梯形冷凝塔
                        this.drawTrapezoidTower(tower1X, towerY, towerWidth, towerHeight);
                        this.drawTrapezoidTower(tower2X, towerY, towerWidth, towerHeight);
                    }
                    // 显示发电量
                    this.ctx.fillStyle = 'white';
                    this.ctx.font = '12px Arial';
                    this.ctx.fillText(building.power, x + 5, y + this.cellSize - 5);
                    break;

                case 'transformer':
                    const load = this.getTransformerLoad(building);
                    const loadRatio = load / building.capacity;
                    this.ctx.fillStyle = loadRatio > 0.9 ? '#ff6b6b' : 
                                        loadRatio > 0.7 ? '#ffd93d' : 
                                        building.capacity <= 300 ? '#b4d4ff' : '#4dabf7';
                    
                    const scale = building.capacity <= 300 ? 1 : 1.2; // 中型变电站略大
                    
                    // 绘制输电塔（埃菲尔铁塔风格）
                    const towerWidth = width * 0.3 * scale;
                    const towerHeight = height * 0.9 * scale;
                    const towerX = x + width * 0.15;
                    const towerY = y + height - towerHeight;
                    
                    // 绘制塔身（梯形）
                    this.ctx.beginPath();
                    this.ctx.moveTo(towerX, towerY + towerHeight);
                    this.ctx.lineTo(towerX + towerWidth, towerY + towerHeight);
                    this.ctx.lineTo(towerX + towerWidth * 0.7, towerY);
                    this.ctx.lineTo(towerX + towerWidth * 0.3, towerY);
                    this.ctx.closePath();
                    this.ctx.fill();
                    
                    // 绘制横梁（三层）
                    const beamHeights = [0.3, 0.5, 0.7];
                    beamHeights.forEach(heightRatio => {
                        const beamY = towerY + towerHeight * heightRatio;
                        const beamWidth = towerWidth * (1.2 - heightRatio * 0.4); // 越往上越窄
                        const beamX = towerX + (towerWidth - beamWidth) / 2;
                        this.ctx.fillRect(beamX, beamY, beamWidth, towerWidth * 0.1);
                    });
                    
                    // 绘制三相电线
                    this.ctx.strokeStyle = this.ctx.fillStyle;
                    this.ctx.lineWidth = 2;
                    beamHeights.forEach(heightRatio => {
                        const beamY = towerY + towerHeight * heightRatio;
                        const beamWidth = towerWidth * (1.2 - heightRatio * 0.4);
                        const beamX = towerX + (towerWidth - beamWidth) / 2;
                        
                        // 每层画三根弧形电线
                        for (let i = 0; i < 3; i++) {
                            const wireX = beamX + beamWidth * (i + 1) / 4;
                            this.drawPowerLine(
                                wireX,
                                beamY,
                                wireX,
                                beamY + towerHeight * 0.2,
                                towerWidth * 0.1
                            );
                        }
                    });
                    
                    // 绘制小房子
                    const houseWidth = width * 0.3 * scale;
                    const houseHeight = height * 0.4 * scale;
                    const houseX = x + width * 0.6;
                    const houseY = y + height - houseHeight;
                    
                    // 房子主体
                    this.ctx.fillRect(houseX, houseY, houseWidth, houseHeight);
                    // 房顶
                    this.ctx.beginPath();
                    this.ctx.moveTo(houseX - houseWidth * 0.1, houseY);
                    this.ctx.lineTo(houseX + houseWidth * 0.5, houseY - houseHeight * 0.3);
                    this.ctx.lineTo(houseX + houseWidth * 1.1, houseY);
                    this.ctx.fill();

                    // 显示负载信息
                    this.ctx.fillStyle = 'white';
                    this.ctx.font = '12px Arial';
                    this.ctx.fillText(`${Math.floor(load)}/${building.capacity}`, x + 5, y + this.cellSize - 5);
                    break;

                case 'factory':
                    // 厂房加烟囱造型，确保不超出格子
                    this.ctx.fillStyle = this.isPowered(building) ? 'lightgreen' : 'green';
                    
                    // 绘制主厂房
                    const factoryWidth = width * 0.8;
                    const factoryHeight = height * 0.6;
                    const factoryX = x + (width - factoryWidth) / 2;
                    const factoryY = y + height - factoryHeight;
                    this.ctx.fillRect(factoryX, factoryY, factoryWidth, factoryHeight);
                    
                    // 绘制烟囱（确保在格子内）
                    const chimneyWidth = width * 0.15;
                    const chimneyHeight = height * 0.4;
                    const chimneyX = factoryX + factoryWidth - chimneyWidth * 1.5;
                    const chimneyY = y + height - factoryHeight - chimneyHeight;
                    this.ctx.fillRect(chimneyX, chimneyY, chimneyWidth, chimneyHeight);
                    
                    // 绘制烟囱顶部
                    const capWidth = chimneyWidth * 1.3;
                    const capHeight = chimneyHeight * 0.1;
                    this.ctx.fillRect(chimneyX - (capWidth - chimneyWidth) / 2, 
                                    chimneyY, capWidth, capHeight);
                    
                    // 显示信息
                    this.ctx.fillStyle = 'white';
                    this.ctx.font = '12px Arial';
                    if (building.timer !== null) {
                        this.ctx.fillText(building.timer, x + 5, y + 15);
                    }
                    this.ctx.fillText(building.consumption, x + 5, y + height - 5);
                    break;

                case 'residential':
                    // 高矩形居民楼，左右留空
                    const buildingWidth = width * 0.6; // 减小宽度
                    const buildingHeight = height * 0.9; // 增加高度
                    const buildingX = x + (width - buildingWidth) / 2;
                    const buildingY = y + (height - buildingHeight);
                    
                    // 绘制主体
                    this.ctx.fillStyle = '#9c27b0';
                    this.ctx.fillRect(buildingX, buildingY, buildingWidth, buildingHeight);
                    
                    // 绘制窗户
                    const windowSize = buildingWidth * 0.3;
                    const windowSpacingX = (buildingWidth - windowSize * 2) / 3;
                    const windowSpacingY = (buildingHeight - windowSize * 2) / 3;
                    const windowColor = this.isPowered(building) ? '#ffd700' : '#333';
                    
                    this.ctx.fillStyle = windowColor;
                    // 绘制4个窗户
                    for (let i = 0; i < 2; i++) {
                        for (let j = 0; j < 2; j++) {
                            this.ctx.fillRect(
                                buildingX + windowSpacingX + i * (windowSize + windowSpacingX),
                                buildingY + windowSpacingY + j * (windowSize + windowSpacingY),
                                windowSize,
                                windowSize
                            );
                        }
                    }
                    
                    // 显示信息
                    this.ctx.fillStyle = 'white';
                    this.ctx.font = '12px Arial';
                    if (building.timer !== null) {
                        this.ctx.fillText(building.timer, x + 5, y + 15);
                    }
                    this.ctx.fillText(building.consumption, x + 5, y + height - 5);
                    break;

                case 'battery':
                    // 修改蓄电池外观
                    this.ctx.fillStyle = '#444'; // 深灰色电池本体
                    const batteryWidth = this.cellSize * 0.6;
                    const batteryHeight = this.cellSize * 0.8;
                    const batteryX = x + (this.cellSize - batteryWidth) / 2;
                    const batteryY = y + (this.cellSize - batteryHeight) / 2;
                    
                    // 绘制电池主体
                    this.ctx.fillRect(batteryX, batteryY, batteryWidth, batteryHeight);
                    
                    // 绘制闪电图标
                    const chargeRatio = (building.charge || 0) / building.capacity; // 确保初始为0
                    const iconHeight = batteryHeight * 0.8;
                    const iconWidth = batteryWidth * 0.6;
                    const iconX = batteryX + (batteryWidth - iconWidth) / 2;
                    const iconY = batteryY + (batteryHeight - iconHeight) / 2;
                    
                    // 创建闪电的渐变色
                    const gradient = this.ctx.createLinearGradient(
                        iconX,
                        iconY,
                        iconX,
                        iconY + iconHeight
                    );
                    
                    // 判断充放电状态
                    const networks = this.getIndependentNetworks();
                    let isCharging = false;
                    networks.forEach(network => {
                        if (network.includes(building)) {
                            let totalGeneration = 0;
                            let totalConsumption = 0;
                            network.forEach(b => {
                                if (b.type === 'powerplant') {
                                    totalGeneration += b.power;
                                } else if ((b.type === 'factory' || b.type === 'residential') && 
                                          this.isPowered(b)) {
                                    totalConsumption += b.consumption;
                                }
                            });
                            const ratio = totalConsumption > 0 ? totalGeneration / totalConsumption : 1;
                            isCharging = ratio > 1;
                        }
                    });
                    
                    // 如果电量为0，整个闪电显示为黑色
                    if (chargeRatio === 0) {
                        gradient.addColorStop(0, '#000000');
                        gradient.addColorStop(1, '#000000');
                    } else {
                        // 不管是充电还是放电，黄色部分高度都与电量成正比
                        gradient.addColorStop(0, '#000000');          // 顶部黑色
                        gradient.addColorStop(1 - chargeRatio, '#000000');  // 黑色区域的底部
                        gradient.addColorStop(1 - chargeRatio, '#ffd700'); // 黄色区域的顶部
                        gradient.addColorStop(1, '#ffd700');          // 底部黄色
                    }
                    
                    // 绘制闪电形状
                    this.ctx.fillStyle = gradient;
                    this.ctx.beginPath();
                    this.ctx.moveTo(iconX + iconWidth * 0.5, iconY); // 顶部中点
                    this.ctx.lineTo(iconX + iconWidth * 0.8, iconY + iconHeight * 0.4); // 右上
                    this.ctx.lineTo(iconX + iconWidth * 0.6, iconY + iconHeight * 0.4); // 右中收缩
                    this.ctx.lineTo(iconX + iconWidth * 0.8, iconY + iconHeight * 0.8); // 右下
                    this.ctx.lineTo(iconX + iconWidth * 0.2, iconY + iconHeight * 0.4); // 左下
                    this.ctx.lineTo(iconX + iconWidth * 0.4, iconY + iconHeight * 0.4); // 左中收缩
                    this.ctx.lineTo(iconX + iconWidth * 0.2, iconY); // 左上
                    this.ctx.closePath();
                    this.ctx.fill();
                    
                    // 显示充电量
                    this.ctx.fillStyle = 'white';
                    this.ctx.font = '12px Arial';
                    this.ctx.fillText(
                        `${Math.floor(building.charge || 0)}/${building.capacity}`,
                        x + 5,
                        y + this.cellSize - 5
                    );
                    break;

                case 'terminal':
                    // 绘制电脑形状
                    this.ctx.fillStyle = '#666'; // 浅灰色外壳
                    
                    // 绘制显示器
                    const monitorWidth = width * 0.8;
                    const monitorHeight = height * 0.6;
                    const monitorX = x + (width - monitorWidth) / 2;
                    const monitorY = y + height * 0.1;
                    
                    // 显示器外壳
                    this.ctx.fillRect(monitorX, monitorY, monitorWidth, monitorHeight);
                    
                    // 显示器屏幕（矩形）
                    const screenWidth = monitorWidth * 0.9;
                    const screenHeight = monitorHeight * 0.9;
                    const screenX = monitorX + (monitorWidth - screenWidth) / 2;
                    const screenY = monitorY + (monitorHeight - screenHeight) / 2;
                    
                    this.ctx.fillStyle = this.isPowered(building) ? '#4dabf7' : '#000';
                    this.ctx.fillRect(screenX, screenY, screenWidth, screenHeight);
                    
                    // 绘制支架
                    this.ctx.fillStyle = '#666';
                    const standWidth = width * 0.1;
                    const standHeight = height * 0.2;
                    const standX = x + (width - standWidth) / 2;
                    const standY = monitorY + monitorHeight;
                    this.ctx.fillRect(standX, standY, standWidth, standHeight);
                    
                    // 绘制底座
                    const baseWidth = width * 0.4;
                    const baseHeight = height * 0.1;
                    const baseX = x + (width - baseWidth) / 2;
                    const baseY = standY + standHeight;
                    this.ctx.fillRect(baseX, baseY, baseWidth, baseHeight);
                    break;

                case 'armory':
                    // 不绘制底色，直接绘制坦克和炮弹
                    
                    // 左半边绘制坦克
                    this.drawTank(x, y + height * 0.1, width * 0.6, height * 0.8);
                    
                    // 右半边绘制炮弹
                    this.drawShells(x + width * 0.6, y + height * 0.1, width * 0.4, height * 0.8);
                    
                    // 如果需要高亮显示，绘制扩散圆圈
                    if (building.isHighlighted) {
                        const centerX = x + width/2;
                        const centerY = y + height/2;
                        const maxRadius = width;
                        const highlightProgress = (Date.now() - building.startTime) % 2000 / 2000;
                        const currentRadius = maxRadius * highlightProgress;
                        const alpha = Math.max(0, 1 - highlightProgress);
                        
                        this.ctx.strokeStyle = `rgba(255, 215, 0, ${alpha})`;
                        this.ctx.lineWidth = 2;
                        this.ctx.beginPath();
                        this.ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2);
                        this.ctx.stroke();
                    }
                    
                    // 显示用电量
                    this.ctx.fillStyle = 'white';
                    this.ctx.font = '12px Arial';
                    this.ctx.fillText(building.consumption, x + 5, y + height - 5);
                    break;
            }

            // 选中的建筑物显示边框
            if (building === this.selectedBuilding) {
                this.ctx.strokeStyle = '#ffff00';
                this.ctx.lineWidth = 4;
                this.ctx.strokeRect(x - 4, y - 4, this.cellSize + 8, this.cellSize + 8);
            }
        });
    }

    drawConnections() {
        this.ctx.lineWidth = 2;
        
        this.connections.forEach(conn => {
            // 根据连接类型设置颜色
            if (conn.from.type === 'terminal' || conn.to.type === 'terminal') {
                this.ctx.strokeStyle = '#ffd700'; // 智能终端连接为黄色
            } else if (conn.from.type === 'powerplant' || conn.to.type === 'powerplant') {
                this.ctx.strokeStyle = '#ff0000'; // 发电站连接为红色
            } else if (conn.from.type === 'transformer' || conn.to.type === 'transformer') {
                this.ctx.strokeStyle = '#0088ff'; // 变电站连接为蓝色
            } else if (conn.from.type === 'battery' || conn.to.type === 'battery') {
                this.ctx.strokeStyle = '#9c27b0'; // 蓄电池连接为紫色
            }

            let fromX, fromY, toX, toY;
            const offset = (this.canvas.width - (this.gridSize * this.cellSize)) / 2;
            
            // 特殊处理核电站的连接点
            if (conn.from.isNuclear) {
                fromX = (conn.from.position.x * this.cellSize) + offset + this.cellSize;
                fromY = (conn.from.position.y * this.cellSize) + offset + this.cellSize;
            } else {
                fromX = (conn.from.position.x * this.cellSize) + offset + this.cellSize/2;
                fromY = (conn.from.position.y * this.cellSize) + offset + this.cellSize/2;
            }
            
            if (conn.to.isNuclear) {
                toX = (conn.to.position.x * this.cellSize) + offset + this.cellSize;
                toY = (conn.to.position.y * this.cellSize) + offset + this.cellSize;
            } else {
                toX = (conn.to.position.x * this.cellSize) + offset + this.cellSize/2;
                toY = (conn.to.position.y * this.cellSize) + offset + this.cellSize/2;
            }
            
            this.ctx.beginPath();
            this.ctx.moveTo(fromX, fromY);
            this.ctx.lineTo(toX, toY);
            this.ctx.stroke();
        });
    }

    isCellOccupied(x, y) {
        return this.buildings.some(building => {
            const size = building.size || 1;
            for (let i = 0; i < size; i++) {
                for (let j = 0; j < size; j++) {
                    if (building.position.x + i === x && building.position.y + j === y) {
                        return true;
                    }
                }
            }
            return false;
        });
    }

    // 事件处理方法
    handleCanvasClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const offset = (this.canvas.width - (this.gridSize * this.cellSize)) / 2;
        
        const x = Math.floor((e.clientX - rect.left - offset) / this.cellSize);
        const y = Math.floor((e.clientY - rect.top - offset) / this.cellSize);
        
        // 检查点击是否在有效网格范围内
        if (x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize) {
            // 获取点击位置的建筑物
            const clickedBuilding = this.buildings.find(b => 
                b.position.x === x && b.position.y === y
            );

            if (clickedBuilding) {
                if (this.selectedBuilding && clickedBuilding && clickedBuilding !== this.selectedBuilding) {
                    // 检查是否可以建立连接
                    if (
                        // 发电站到变电站/蓄电池/发电站
                        (this.selectedBuilding.type === 'powerplant' && 
                         (clickedBuilding.type === 'transformer' || 
                          clickedBuilding.type === 'battery' ||
                          clickedBuilding.type === 'powerplant')) ||
                        
                        // 变电站到工厂/居民楼/智能终端/兵工厂/变电站
                        (this.selectedBuilding.type === 'transformer' && 
                         (clickedBuilding.type === 'factory' || 
                          clickedBuilding.type === 'residential' || 
                          clickedBuilding.type === 'terminal' || 
                          clickedBuilding.type === 'armory' ||
                          clickedBuilding.type === 'transformer')) ||
                        
                        // 兵工厂到变电站
                        (this.selectedBuilding.type === 'armory' && 
                         clickedBuilding.type === 'transformer') ||
                        
                        // 其他连接规则...
                        (this.selectedBuilding.type === 'battery' && 
                         clickedBuilding.type === 'powerplant') ||
                        (this.selectedBuilding.type === 'terminal' && 
                         clickedBuilding.type === 'transformer')
                    ) {
                        this.connections.push({
                            from: this.selectedBuilding,
                            to: clickedBuilding
                        });
                    }
                    this.selectedBuilding = null;
                } else {
                    this.selectedBuilding = clickedBuilding;
                }
            } else {
                // 点击空地，取消选择
                this.selectedBuilding = null;
            }
            
            // 每次点击后都重新渲染
            this.render();
        }
    }

    handleDragStart(e) {
        e.dataTransfer.setData('text/plain', e.target.dataset.type);
    }

    handleDrop(e) {
        e.preventDefault();
        const type = e.dataTransfer.getData('text/plain');
        const rect = this.canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left - (this.canvas.width - this.gridSize * this.cellSize) / 2) / this.cellSize);
        const y = Math.floor((e.clientY - rect.top - (this.canvas.height - this.gridSize * this.cellSize) / 2) / this.cellSize);
        
        // 检查是否在网格范围内
        if (x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize) {
            // 对于核电站，检查右侧和下方是否也在网格范围内
            if (type === 'powerplant-nuclear') {
                if (x + 1 >= this.gridSize || y + 1 >= this.gridSize) {
                    return;
                }
            }
            this.placeBuilding(type, x, y);
        }
    }

    placeBuilding(type, x, y) {
        let cost = 0;
        let building = {
            position: {x, y}
        };
        
        switch(type) {
            case 'powerplant-nuclear':
                // 检查2x2的空间是否可用
                if (!this.isAreaFree(x, y, 2, 2)) {
                    return false;
                }
                cost = 500;
                building.type = 'powerplant';
                building.power = 800;
                building.isNuclear = true;
                building.size = 2; // 设置大小为2x2
                break;
            case 'powerplant-small':
                cost = 200;
                building.type = 'powerplant';
                building.power = 100;
                break;
            case 'powerplant-medium':
                cost = 400;
                building.type = 'powerplant';
                building.power = 200;
                break;
            case 'transformer-small':
                cost = 150;
                building.type = 'transformer';
                building.efficiency = 0.95;
                building.capacity = 300; // 小变电站容量
                break;
            case 'transformer-medium':
                cost = 300;
                building.type = 'transformer';
                building.efficiency = 0.97;
                building.capacity = 500; // 大变电站容量
                break;
            case 'powerplant-solar':
                cost = 50;
                building.type = 'powerplant';
                building.isSolar = true;
                building.power = this.getRandomSolarPower();
                building.lastUpdate = Date.now();
                break;
            case 'battery':
                cost = 200;
                building.type = 'battery';
                building.capacity = 500;
                building.charge = 0; // 当前电量
                building.lastUpdate = Date.now();
                break;
            case 'terminal':
                cost = 50;
                building.type = 'terminal';
                break;
            case 'powerplant-wind':
                cost = 120;
                building.type = 'powerplant';
                building.power = Math.floor(Math.random() * 21) + 80; // 80-100
                building.isWind = true;
                building.rotation = 0;
                break;
        }
        
        if (this.gold >= cost) {
            this.gold -= cost;
            this.buildings.push(building);
            document.getElementById('goldAmount').textContent = this.gold;
            return true;
        }
        return false;
    }

    handleRightClick(e) {
        e.preventDefault(); // 阻止默认右键菜单
        
        const rect = this.canvas.getBoundingClientRect();
        const offset = (this.canvas.width - (this.gridSize * this.cellSize)) / 2;
        
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // 检查是否点击到了连接线
        const clickedConnection = this.findClickedConnection(mouseX, mouseY);
        if (clickedConnection) {
            // 删除连接
            const index = this.connections.indexOf(clickedConnection);
            if (index > -1) {
                this.connections.splice(index, 1);
                
                // 返还一半的连接费用
                const distance = Math.abs(clickedConnection.from.position.x - clickedConnection.to.position.x) + 
                               Math.abs(clickedConnection.from.position.y - clickedConnection.to.position.y);
                const refund = Math.floor((distance * 10) / 2); // 返还一半费用
                this.gold += refund;
                document.getElementById('goldAmount').textContent = this.gold;
                
                // 检查工厂是否还有其他连接
                if (clickedConnection.to.type === 'factory' && !this.isPowered(clickedConnection.to)) {
                    clickedConnection.to.timer = 60; // 重新开始倒计时
                }
                
                this.render();
            }
        }
    }

    findClickedConnection(mouseX, mouseY) {
        const offset = (this.canvas.width - (this.gridSize * this.cellSize)) / 2;
        
        return this.connections.find(connection => {
            const fromX = (connection.from.position.x * this.cellSize + offset) + (this.cellSize / 2);
            const fromY = (connection.from.position.y * this.cellSize + offset) + (this.cellSize / 2);
            const toX = (connection.to.position.x * this.cellSize + offset) + (this.cellSize / 2);
            const toY = (connection.to.position.y * this.cellSize + offset) + (this.cellSize / 2);
            
            // 计算点击位置到线段的距离
            const distance = this.pointToLineDistance(
                mouseX, mouseY,
                fromX, fromY,
                toX, toY
            );
            
            return distance < 5; // 如果距离小于5像素，认为点击到了线
        });
    }

    pointToLineDistance(px, py, x1, y1, x2, y2) {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;

        const dot = A * C + B * D;
        const len_sq = C * C + D * D;
        let param = -1;
        
        if (len_sq != 0) {
            param = dot / len_sq;
        }

        let xx, yy;

        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }

        const dx = px - xx;
        const dy = py - yy;
        
        return Math.sqrt(dx * dx + dy * dy);
    }

    isValidConnection(from, to) {
        // 工厂和居民楼只能作为终点
        if (from.type === 'factory' || from.type === 'residential') {
            return false;
        }

        // 智能终端的连接规则
        if (from.type === 'terminal') {
            return to.type === 'transformer';
        }
        if (to.type === 'terminal') {
            return from.type === 'transformer';
        }

        // 蓄电池只能与发电站连接
        if (from.type === 'battery' || to.type === 'battery') {
            return (from.type === 'powerplant' || to.type === 'powerplant');
        }

        // 发电站可以连接到发电站、变电站或蓄电池
        if (from.type === 'powerplant' && 
            (to.type !== 'powerplant' && to.type !== 'transformer' && to.type !== 'battery')) {
            return false;
        }

        // 变电站可以连接到任何建筑（除了蓄电池）
        if (from.type === 'transformer' && 
            (to.type !== 'powerplant' && to.type !== 'transformer' && 
             to.type !== 'factory' && to.type !== 'residential' && to.type !== 'terminal')) {
            return false;
        }

        return true;
    }

    tryConnect(from, to) {
        // 检查连接是否有效
        if (from === to) return;

        // 计算连接成本
        const distance = Math.abs(from.position.x - to.position.x) + 
                        Math.abs(from.position.y - to.position.y);
        const cost = distance * 10; // 每格10金币

        // 检查是否有足够的金币
        if (this.gold < cost) {
            alert('金币不足！需要 ' + cost + ' 金币');
            return;
        }

        // 检查连接类型是否有效
        if (this.isValidConnection(from, to)) {
            // 检查是否已经存在相同的连接
            const existingConnection = this.connections.find(conn => 
                (conn.from === from && conn.to === to) ||
                (conn.from === to && conn.to === from)
            );
            
            if (!existingConnection) {
                this.connections.push({ from, to });
                this.gold -= cost;
                document.getElementById('goldAmount').textContent = this.gold;

                // 如果连接到工厂或居民楼，取消其倒计时
                if ((to.type === 'factory' || to.type === 'residential') && to.timer !== null) {
                    to.timer = null;
                }
            }
        } else {
            alert('无效的连接！\n' +
                  '- 发电站可以连接到发电站、变电站或蓄电池\n' +
                  '- 变电站可以连接到除蓄电池外的任何建筑\n' +
                  '- 蓄电池只能与发电站连接\n' +
                  '- 工厂和居民楼只能作为终点');
        }
    }

    checkPowerBalance() {
        const networks = this.getIndependentNetworks();
        this.warningNetworks.clear();
        
        networks.forEach(network => {
            let totalGeneration = 0;
            let totalConsumption = 0;
            let hasGenerator = false;
            
            network.forEach(building => {
                if (building.type === 'powerplant') {
                    totalGeneration += building.power;
                    hasGenerator = true;
                } else if ((building.type === 'factory' || building.type === 'residential' || building.type === 'armory') && 
                          this.isPowered(building)) {
                    totalConsumption += building.consumption;
                }
            });
            
            // 检查是否是孤立的负荷（没有发电机的网络）
            const hasUnpoweredLoad = network.some(b => {
                if (b.type !== 'factory' && b.type !== 'residential' && b.type !== 'armory') return false;
                if (b.timer !== null) return false; // 倒计时未结束的负荷不计入检查
                
                // 检查是否有通过变电站的供电路径
                const hasValidPowerPath = this.connections.some(conn => 
                    conn.to === b && conn.from.type === 'transformer' &&
                    this.isPowered(conn.from)
                );
                
                return !hasValidPowerPath;
            });
            
            if (!hasGenerator && hasUnpoweredLoad) {
                this.showMessage('检测到断电负荷，系统自动清除！');
                this.destroyNetwork(network);
                return;
            }
            
            if (totalConsumption > 0) {
                const ratio = totalGeneration / totalConsumption;
                
                if (ratio < 0.6) {
                    // 供电严重不足，销毁整个网络
                    this.showMessage('电网供电不足，系统自动断电！');
                    this.destroyNetwork(network);
                } else if (ratio > 1.6) {
                    // 供电严重过剩，销毁整个网络
                    this.showMessage('电网负荷严重失衡，系统自动断电！');
                    this.destroyNetwork(network);
                } else if (ratio > 1.5) {
                    // 轻微过剩，只显示警告不扣分
                    this.warningNetworks.add({
                        buildings: network,
                        type: 'high'
                    });
                } else if (ratio < 0.8) {
                    // 供电不足但不严重（60%-80%），只显示警告不扣分
                    this.warningNetworks.add({
                        buildings: network,
                        type: 'low'
                    });
                }
            }
        });
    }

    // 修改销毁整个网络的方法
    destroyNetwork(network) {
        // 计算网络中所有负荷的信誉值损失
        let reputationLoss = 0;
        network.forEach(building => {
            if ((building.type === 'factory' || building.type === 'residential') && building.timer === null) {
                reputationLoss += building.type === 'factory' ? 3 : 10;
            }
        });
        
        // 扣除信誉值
        this.deductReputation(reputationLoss);
        
        // 销毁建筑物
        const buildingsToDestroy = new Set();
        network.forEach(building => {
            buildingsToDestroy.add(building);
            this.connections.forEach(conn => {
                if (conn.from === building || conn.to === building) {
                    buildingsToDestroy.add(conn.from);
                    buildingsToDestroy.add(conn.to);
                }
            });
        });
        
        buildingsToDestroy.forEach(building => {
            this.explodeBuilding(building);
        });
    }

    getTransformerLoad(transformer) {
        let load = 0;
        this.connections.forEach(conn => {
            if (conn.from === transformer && 
                (conn.to.type === 'factory' || conn.to.type === 'residential')) {
                // 计算这个变电站承担的该建筑的负载
                const connectedTransformers = this.connections.filter(c => 
                    c.to === conn.to && c.from.type === 'transformer'
                ).length;
                load += conn.to.consumption / connectedTransformers;
            }
        });
        return load;
    }

    explodeBuilding(building) {
        if (building.isNuclear) {
            this.createNuclearExplosion(building.position.x, building.position.y);
            this.deductReputation(30);
        }
        
        // 先移除与该建筑相关的所有连接
        this.connections = this.connections.filter(conn => 
            conn.from !== building && conn.to !== building
        );
        
        // 然后从建筑数组中移除该建筑
        const index = this.buildings.indexOf(building);
        if (index > -1) {
            this.buildings.splice(index, 1);
        }
    }

    explodeAllBuildings() {
        this.buildings = [];
        this.connections = [];
    }

    // 获取所有独立的电力网络
    getIndependentNetworks() {
        const networks = [];
        const visited = new Set();

        this.buildings.forEach(building => {
            if (!visited.has(building)) {
                const network = this.getConnectedNetwork(building);
                if (network.size > 0) {
                    networks.push(Array.from(network));
                }
                network.forEach(b => visited.add(b));
            }
        });

        return networks;
    }

    // 获取与指定建筑物相连的所有建筑物
    getConnectedNetwork(building) {
        const network = new Set();
        const queue = [building];
        
        while (queue.length > 0) {
            const current = queue.shift();
            if (!network.has(current)) {
                network.add(current);
                
                // 查找所有相连的建筑物
                this.connections.forEach(conn => {
                    if (conn.from === current && !network.has(conn.to)) {
                        queue.push(conn.to);
                    }
                    if (conn.to === current && !network.has(conn.from)) {
                        queue.push(conn.from);
                    }
                });
            }
        }
        
        return network;
    }

    createNuclearExplosion(gridX, gridY) {
        const offset = (this.canvas.width - (this.gridSize * this.cellSize)) / 2;
        const centerX = (gridX * this.cellSize) + offset + this.cellSize * 2;
        const centerY = (gridY * this.cellSize) + offset + this.cellSize * 2;
        
        this.explosions.push({
            centerX,
            centerY,
            frame: 0,
            maxFrames: 120, // 增加帧数使动画更流畅
            maxRadius: this.cellSize * 8,
            groundFlashRadius: this.cellSize * 12 // 地面闪光半径
        });
    }

    drawExplosions() {
        this.explosions = this.explosions.filter(explosion => {
            if (explosion.frame >= explosion.maxFrames) return false;
            
            const progress = explosion.frame / explosion.maxFrames;
            
            // 1. 绘制地面闪光（白色椭圆）
            if (progress < 0.3) {
                const flashProgress = progress / 0.3;
                const flashAlpha = Math.max(0, 1 - flashProgress);
                this.ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
                
                this.ctx.beginPath();
                this.ctx.ellipse(
                    explosion.centerX,
                    explosion.centerY + this.cellSize * 2,
                    explosion.groundFlashRadius * flashProgress,
                    explosion.groundFlashRadius * flashProgress * 0.4,
                    0,
                    0,
                    Math.PI * 2
                );
                this.ctx.fill();
            }
            
            // 2. 绘制火球
            const fireballProgress = Math.min(1, progress * 1.5);
            const fireballRadius = explosion.maxRadius * fireballProgress;
            
            // 火球颜色渐变（红色 -> 橙色 -> 黄色 -> 灰色）
            const innerColor = progress < 0.3 ? '#ff0000' : 
                              progress < 0.5 ? '#ff4400' :
                              progress < 0.7 ? '#ff8800' :
                              progress < 0.9 ? '#ffaa00' : '#666666';
            
            const outerColor = progress < 0.3 ? '#ff4400' :
                              progress < 0.5 ? '#ff8800' :
                              progress < 0.7 ? '#ffaa00' :
                              progress < 0.9 ? '#cccccc' : '#999999';
            
            // 创建不规则的火球形状
            this.ctx.save();
            this.ctx.translate(explosion.centerX, explosion.centerY);
            
            const gradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, fireballRadius);
            gradient.addColorStop(0, innerColor);
            gradient.addColorStop(0.6, outerColor);
            gradient.addColorStop(1, 'rgba(100, 100, 100, 0)');
            
            this.ctx.fillStyle = gradient;
            
            // 绘制不规则的火球
            this.ctx.beginPath();
            for (let angle = 0; angle < Math.PI * 2; angle += 0.1) {
                const noise = 0.8 + Math.random() * 0.4; // 添加随机扰动
                const radius = fireballRadius * noise;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                
                if (angle === 0) {
                    this.ctx.moveTo(x, y);
                } else {
                    this.ctx.lineTo(x, y);
                }
            }
            this.ctx.closePath();
            this.ctx.fill();
            
            // 3. 添加火球内部的能量波纹
            if (progress < 0.7) {
                const waveCount = 3;
                for (let i = 0; i < waveCount; i++) {
                    const waveProgress = (progress + i / waveCount) % 1;
                    const waveRadius = fireballRadius * waveProgress;
                    
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, waveRadius, 0, Math.PI * 2);
                    this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 * (1 - waveProgress)})`;
                    this.ctx.lineWidth = 2;
                    this.ctx.stroke();
                }
            }
            
            this.ctx.restore();
            
            explosion.frame++;
            return true;
        });
    }

    isAreaFree(x, y, width, height) {
        for (let i = 0; i < width; i++) {
            for (let j = 0; j < height; j++) {
                if (this.isCellOccupied(x + i, y + j)) {
                    return false;
                }
            }
        }
        return true;
    }

    getRandomSolarPower() {
        return Math.floor(Math.random() * 26) + 25; // 25到50之间的随机数
    }

    updateSolarPanels() {
        const currentTime = Date.now();
        if (currentTime - this.lastSolarUpdate >= 2000 / this.gameSpeed) {
            this.buildings.forEach(building => {
                if (building.isSolar) {
                    let power = this.getRandomSolarPower();
                    // 在沙漠中发电量翻倍
                    if (this.terrain[building.position.y][building.position.x] === 'desert') {
                        power *= 2;
                    }
                    building.power = power;
                }
            });
            this.lastSolarUpdate = currentTime;
        }
    }

    updateBatteries() {
        const currentTime = Date.now();
        if (currentTime - this.lastBatteryUpdate >= 3000) { // 每3秒更新一次
            const networks = this.getIndependentNetworks();
            
            networks.forEach(network => {
                let totalGeneration = 0;
                let totalConsumption = 0;
                const batteries = [];
                
                network.forEach(building => {
                    if (building.type === 'powerplant') {
                        totalGeneration += building.power;
                    } else if ((building.type === 'factory' || building.type === 'residential') && 
                              this.isPowered(building)) {
                        totalConsumption += building.consumption;
                    } else if (building.type === 'battery') {
                        batteries.push(building);
                    }
                });

                if (batteries.length > 0 && totalConsumption > 0) {
                    const ratio = totalGeneration / totalConsumption;
                    
                    batteries.forEach(battery => {
                        if (ratio > 1) {
                            // 充电模式
                            const excessPower = totalGeneration - totalConsumption;
                            // 计算这次可以充电的量
                            const maxCharge = battery.capacity - battery.charge;
                            const chargeAmount = Math.min(excessPower, maxCharge);
                            
                            if (chargeAmount > 0) {
                                battery.charge = Math.min(battery.charge + chargeAmount, battery.capacity);
                                // 从总发电量中减去充电量，使负荷比保持在100%
                                totalGeneration -= chargeAmount;
                            }
                        } else {
                            // 放电模式
                            const powerNeeded = totalConsumption - totalGeneration;
                            const dischargeAmount = Math.min(powerNeeded, battery.charge);
                            
                            if (dischargeAmount > 0) {
                                battery.charge = Math.max(battery.charge - dischargeAmount, 0);
                                // 加入放电量到总发电量
                                totalGeneration += dischargeAmount;
                            }
                        }
                    });
                }
            });
            
            this.lastBatteryUpdate = currentTime;
        }
    }

    drawLightning(x, y, height) {
        // 绘制简单的闪电形状
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(x - height/4, y + height/2);
        this.ctx.lineTo(x + height/4, y + height/2);
        this.ctx.lineTo(x, y + height);
        this.ctx.fill();
    }

    // 添加绘制冷凝塔的辅助方法
    drawCoolingTower(x, y, width, height) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, y + height);
        
        // 绘制左侧曲线
        this.ctx.bezierCurveTo(
            x, y + height * 0.7,
            x + width * 0.1, y,
            x + width * 0.5, y
        );
        
        // 绘制右侧曲线
        this.ctx.bezierCurveTo(
            x + width * 0.9, y,
            x + width, y + height * 0.7,
            x + width, y + height
        );
        
        this.ctx.closePath();
        this.ctx.fill();
    }

    // 添加绘制梯形冷凝塔的方法
    drawTrapezoidTower(x, y, width, height) {
        const topWidth = width * 0.6;
        const bottomWidth = width;
        
        this.ctx.beginPath();
        this.ctx.moveTo(x, y + height);
        this.ctx.lineTo(x + bottomWidth, y + height);
        this.ctx.lineTo(x + bottomWidth - (bottomWidth - topWidth)/2, y);
        this.ctx.lineTo(x + (bottomWidth - topWidth)/2, y);
        this.ctx.closePath();
        this.ctx.fill();
    }

    // 添加绘制云状白烟的方法
    drawCloud(x, y, width, height) {
        this.ctx.beginPath();
        const circles = [
            { x: x + width * 0.2, y: y + height * 0.3, r: height * 0.4 },
            { x: x + width * 0.5, y: y + height * 0.5, r: height * 0.5 },
            { x: x + width * 0.8, y: y + height * 0.2, r: height * 0.3 }
        ];
        
        circles.forEach(circle => {
            this.ctx.moveTo(circle.x + circle.r, circle.y);
            this.ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
        });
        
        this.ctx.fill();
    }

    // 添加绘制弧形电线的方法
    drawPowerLine(x1, y1, x2, y2, sag) {
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2 + sag;
        this.ctx.quadraticCurveTo(midX, midY, x2, y2);
        this.ctx.stroke();
    }

    // 添加风电站更新方法
    updateWindPower() {
        const currentTime = Date.now();
        if (currentTime - this.lastWindUpdate >= 2000 / this.gameSpeed) {
            this.buildings.forEach(building => {
                if (building.isWind) {
                    let power = Math.floor(Math.random() * 21) + 80;
                    // 在海洋中发电量翻倍
                    if (this.terrain[building.position.y][building.position.x] === 'ocean') {
                        power *= 2;
                    }
                    building.power = power;
                }
            });
            this.lastWindUpdate = currentTime;
        }
        
        this.windRotation += 0.1;
    }

    // 添加生成地形的方法
    generateTerrain() {
        // 初始化地形数组
        for (let y = 0; y < this.gridSize; y++) {
            this.terrain[y] = [];
            for (let x = 0; x < this.gridSize; x++) {
                this.terrain[y][x] = 'normal';
            }
        }

        // 计算总格子数和30%的限制
        const totalCells = this.gridSize * this.gridSize;
        const maxTerrainCells = Math.floor(totalCells * 0.3);
        
        // 生成沙漠区域（2-3个区域）
        const desertAreas = 2 + Math.floor(Math.random());
        let desertCells = 0;
        
        // 尝试生成沙漠，直到达到合适的面积
        while (desertCells < maxTerrainCells * 0.8) { // 目标约25%的面积
            const newDesertCells = this.generateTerrainArea('desert', 1, 10);
            if (desertCells + newDesertCells > maxTerrainCells) {
                break;
            }
            desertCells += newDesertCells;
        }

        // 生成海洋区域（2-3个区域）
        const oceanAreas = 2 + Math.floor(Math.random());
        let oceanCells = 0;
        
        // 尝试生成海洋，直到达到合适的面积
        while (oceanCells < maxTerrainCells * 0.8) { // 目标约25%的面积
            const newOceanCells = this.generateTerrainArea('ocean', 1, 10);
            if (oceanCells + newOceanCells > maxTerrainCells) {
                break;
            }
            oceanCells += newOceanCells;
        }
    }

    generateTerrainArea(type, count, maxSize) {
        let cellsGenerated = 0;
        
        for (let i = 0; i < count; i++) {
            // 随机选择一个起始点
            const startX = Math.floor(Math.random() * this.gridSize);
            const startY = Math.floor(Math.random() * this.gridSize);
            const size = 5 + Math.floor(Math.random() * maxSize);

            // 使用噪声算法生成不规则形状
            for (let y = -size; y < size; y++) {
                for (let x = -size; x < size; x++) {
                    const currentX = startX + x;
                    const currentY = startY + y;
                    
                    // 检查是否在地图范围内
                    if (currentX >= 0 && currentX < this.gridSize && 
                        currentY >= 0 && currentY < this.gridSize) {
                        
                        // 使用距离和随机性创建不规则形状
                        const distance = Math.sqrt(x * x + y * y);
                        if (distance < size * 0.7 + (Math.random() * size * 0.3)) {
                            // 只在当前位置是普通地形时才转换
                            if (this.terrain[currentY][currentX] === 'normal') {
                                this.terrain[currentY][currentX] = type;
                                cellsGenerated++;
                            }
                        }
                    }
                }
            }
        }
        
        return cellsGenerated; // 返回生成的格子数量
    }

    // 在 PowerGrid 类中添加检查信誉值阈值的方法
    checkReputationThresholds() {
        this.reputationThresholds.forEach(threshold => {
            if (this.reputation <= threshold && !this.triggeredThresholds.has(threshold)) {
                this.showMessage('你是南方兄弟单位派来的卧底嘛？');
                this.triggeredThresholds.add(threshold);
            }
        });
    }

    // 添加显示消息的方法
    showMessage(text, duration = 2000) {
        const message = {
            text,
            startTime: Date.now(),
            duration
        };
        this.messages.push(message);
    }

    // 添加绘制消息的方法
    drawMessages() {
        const currentTime = Date.now();
        this.messages = this.messages.filter(message => {
            const elapsed = currentTime - message.startTime;
            if (elapsed >= message.duration) return false;
            
            // 计算透明度
            const alpha = Math.max(0, 1 - (elapsed / message.duration));
            
            // 设置样式
            this.ctx.save();
            this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            this.ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
            this.ctx.lineWidth = 3;
            this.ctx.font = 'bold 24px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            
            // 绘制文字阴影
            const centerX = this.canvas.width / 2;
            const centerY = this.canvas.height / 2;
            this.ctx.strokeText(message.text, centerX, centerY);
            this.ctx.fillText(message.text, centerX, centerY);
            
            this.ctx.restore();
            return true;
        });
    }

    // 修改信誉值扣除的方法
    deductReputation(amount) {
        const currentTime = Date.now();
        if (currentTime - this.lastReputationPenalty >= 1000) {
            this.reputation = Math.max(0, this.reputation - amount);
            document.getElementById('reputationPoints').textContent = this.reputation;
            this.lastReputationPenalty = currentTime;
            
            // 检查游戏是否结束
            if (this.reputation <= 0) {
                this.gameOver = true;
                // 使用居中显示的消息，而不是alert
                this.showGameOverMessage();
            }
            
            this.checkReputationThresholds();
        }
    }

    // 修改游戏结束消息显示方法
    showGameOverMessage() {
        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.zIndex = '1000';

        // 创建消息框
        const messageBox = document.createElement('div');
        messageBox.style.backgroundColor = '#333'; // 深色背景
        messageBox.style.padding = '30px';
        messageBox.style.borderRadius = '15px';
        messageBox.style.textAlign = 'center';
        messageBox.style.boxShadow = '0 0 20px rgba(255, 0, 0, 0.5)';
        messageBox.style.animation = 'fadeIn 0.5s ease-out';
        messageBox.innerHTML = `
            <h2 style="color: #fff; margin-bottom: 20px; font-size: 24px;">在您的光辉领导下，供电公司更名为停电公司！</h2>
            <p style="color: #fff; margin-bottom: 20px; font-size: 18px;">游戏结束，按空格键再来一局</p>
        `;

        // 添加动画样式
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeIn {
                from { opacity: 0; transform: scale(0.9); }
                to { opacity: 1; transform: scale(1); }
            }
        `;
        document.head.appendChild(style);

        overlay.appendChild(messageBox);
        document.body.appendChild(overlay);

        // 添加空格键事件监听器
        const spaceHandler = (event) => {
            if (event.code === 'Space') {
                location.reload(); // 重新加载页面
                document.removeEventListener('keydown', spaceHandler); // 移除事件监听器
            }
        };
        document.addEventListener('keydown', spaceHandler);
    }

    // 添加绘制坦克的辅助方法
    drawTank(x, y, width, height) {
        this.ctx.fillStyle = '#D2B48C'; // 土黄色
        
        // 坦克履带
        this.ctx.fillRect(x, y + height * 0.7, width, height * 0.2);
        
        // 坦克主体
        this.ctx.fillRect(x + width * 0.1, y + height * 0.3, width * 0.8, height * 0.5);
        
        // 炮塔
        this.ctx.beginPath();
        this.ctx.arc(x + width * 0.5, y + height * 0.5, width * 0.2, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 炮管
        this.ctx.fillRect(x + width * 0.5, y + height * 0.45, width * 0.5, height * 0.1);
    }

    // 添加绘制炮弹的辅助方法
    drawShells(x, y, width, height) {
        this.ctx.fillStyle = '#D2B48C'; // 土黄色
        const shellWidth = width * 0.2;
        const shellHeight = height * 0.7;
        const shellSpacing = width * 0.3;
        
        // 绘制三枚炮弹
        for (let i = 0; i < 3; i++) {
            const shellX = x + shellSpacing * i;
            
            // 炮弹主体
            this.ctx.fillRect(shellX, y + height * 0.3, shellWidth, shellHeight);
            
            // 炮弹头
            this.ctx.beginPath();
            this.ctx.moveTo(shellX, y + height * 0.3);
            this.ctx.lineTo(shellX + shellWidth/2, y + height * 0.1);
            this.ctx.lineTo(shellX + shellWidth, y + height * 0.3);
            this.ctx.fill();
        }
    }

    setupSpeedButton() {
        const speedButton = document.createElement('button');
        speedButton.className = 'speed-button';
        speedButton.textContent = '×1';
        speedButton.style.position = 'fixed';
        speedButton.style.left = '20px';
        speedButton.style.bottom = '20px';
        speedButton.style.padding = '10px 20px';
        speedButton.style.backgroundColor = '#333';
        speedButton.style.color = '#fff';
        speedButton.style.border = 'none';
        speedButton.style.borderRadius = '5px';
        speedButton.style.cursor = 'pointer';
        speedButton.style.fontSize = '16px';
        speedButton.style.zIndex = '1000';

        speedButton.addEventListener('click', () => {
            this.gameSpeed = this.gameSpeed === 1 ? 10 : 1;
            speedButton.textContent = `×${this.gameSpeed}`;
        });

        document.body.appendChild(speedButton);
    }

    // 修改按键处理方法
    handleKeyPress(event) {
        if (!this.gameOver) {  // 只在游戏未结束时处理其他按键事件
            // ... 其他按键处理代码 ...
        }
    }
}

// 启动游戏
window.onload = () => {
    const game = new PowerGrid();
}; 