# 游戏框架结构文档

本文档详细说明游戏项目的标准目录结构、各模块职责、命名规范和开发指南。

---

## 目录

1. [框架概览](#一框架概览)
2. [目录结构详解](#二目录结构详解)
3. [核心模块说明](#三核心模块说明)
4. [命名规范](#四命名规范)
5. [开发流程](#五开发流程)
6. [最佳实践](#六最佳实践)

---

# 一、框架概览

## 1.1 整体架构图

```
游戏项目根目录/
├── scripts/          # 游戏代码目录
│   ├── scenes/       # 场景控制脚本
│   ├── managers/     # 管理器脚本
│   ├── handlers/     # 请求回调处理
│   ├── controls/     # 网络请求控制
│   ├── views/        # UI界面脚本
│   ├── components/   # 通用组件
│   ├── global/       # 全局变量
│   └── enums/        # 枚举定义
├── assets/           # 游戏资源目录
│   ├── textures/     # 图片资源
│   ├── sounds/       # 音频资源
│   ├── videos/       # 视频资源
│   ├── prefabs/      # 预制体资源
│   └── maps/         # 地图数据
├── configs/          # 配置文件目录
├── libs/             # 第三方库/插件
├── tools/            # 工具脚本
└── docs/             # 文档目录
```

## 1.2 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│                        表现层 (Views)                        │
│              UI界面、动画效果、视觉反馈                        │
├─────────────────────────────────────────────────────────────┤
│                        控制层 (Controls)                     │
│              场景控制、输入处理、网络请求                       │
├─────────────────────────────────────────────────────────────┤
│                        管理层 (Managers)                     │
│              系统管理、状态管理、资源管理                       │
├─────────────────────────────────────────────────────────────┤
│                        数据层 (Configs/Global)               │
│              配置数据、全局状态、枚举定义                       │
└─────────────────────────────────────────────────────────────┘
```

---

# 二、目录结构详解

## 2.1 scripts/ - 游戏代码目录

所有游戏逻辑代码存放于此目录。

### 2.1.1 scenes/ - 场景控制脚本

**职责**：管理游戏场景的生命周期、初始化和切换逻辑。

```
scripts/scenes/
├── MainMenuScene.ts      # 主菜单场景
├── GameScene.ts          # 游戏主场景
├── BattleScene.ts        # 战斗场景
├── LoadingScene.ts       # 加载场景
└── BaseScene.ts          # 场景基类
```

**示例代码**：

```typescript
// BaseScene.ts - 场景基类
export abstract class BaseScene {
    protected sceneName: string;
    
    abstract onEnter(): void;      // 进入场景
    abstract onExit(): void;       // 离开场景
    abstract onUpdate(dt: number): void;  // 每帧更新
    
    protected preload(): void {
        // 预加载资源
    }
}

// GameScene.ts - 游戏场景
export class GameScene extends BaseScene {
    onEnter(): void {
        EventManager.emit(EventEnum.SCENE_ENTER, 'game');
        this.initGame();
    }
    
    onExit(): void {
        EventManager.emit(EventEnum.SCENE_EXIT, 'game');
    }
    
    onUpdate(dt: number): void {
        // 游戏逻辑更新
    }
}
```

### 2.1.2 managers/ - 管理器脚本

**职责**：各系统的核心管理逻辑，采用单例模式。

```
scripts/managers/
├── EventManager.ts       # 事件管理器（核心）
├── SceneManager.ts       # 场景管理器
├── AudioManager.ts       # 音频管理器
├── ResourceManager.ts    # 资源管理器
├── UIManager.ts          # UI管理器
├── DataManager.ts        # 数据管理器
├── SaveManager.ts        # 存档管理器
├── InputManager.ts       # 输入管理器
├── NetworkManager.ts     # 网络管理器
└── PoolManager.ts        # 对象池管理器
```

**EventManager 示例**：

```typescript
// EventManager.ts - 事件管理器
import { EventEnum } from '../enums/EventEnum';

type EventCallback = (...args: any[]) => void;

class EventManager {
    private static instance: EventManager;
    private listeners: Map<EventEnum, EventCallback[]> = new Map();
    
    static getInstance(): EventManager {
        if (!EventManager.instance) {
            EventManager.instance = new EventManager();
        }
        return EventManager.instance;
    }
    
    // 注册事件监听
    on(event: EventEnum, callback: EventCallback): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(callback);
    }
    
    // 移除事件监听
    off(event: EventEnum, callback: EventCallback): void {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index !== -1) {
                callbacks.splice(index, 1);
            }
        }
    }
    
    // 触发事件
    emit(event: EventEnum, ...args: any[]): void {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(cb => cb(...args));
        }
    }
    
    // 清除所有监听
    clear(): void {
        this.listeners.clear();
    }
}

export default EventManager.getInstance();
```

### 2.1.3 handlers/ - 请求回调脚本

**职责**：处理网络请求的响应和回调逻辑。

```
scripts/handlers/
├── LoginHandler.ts       # 登录响应处理
├── BattleHandler.ts      # 战斗响应处理
├── ShopHandler.ts        # 商店响应处理
├── TaskHandler.ts        # 任务响应处理
└── BaseHandler.ts        # 处理器基类
```

**示例代码**：

```typescript
// BaseHandler.ts
export abstract class BaseHandler {
    abstract handle(data: any): void;
    
    protected onSuccess(data: any): void {
        // 成功处理
    }
    
    protected onError(error: any): void {
        // 错误处理
        console.error('Handler error:', error);
    }
}

// LoginHandler.ts
export class LoginHandler extends BaseHandler {
    handle(data: any): void {
        if (data.code === 0) {
            Global.playerData = data.player;
            EventManager.emit(EventEnum.LOGIN_SUCCESS, data);
        } else {
            this.onError(data.message);
        }
    }
}
```

### 2.1.4 controls/ - 网络请求脚本

**职责**：封装网络请求接口。

```
scripts/controls/
├── LoginControl.ts       # 登录请求
├── BattleControl.ts      # 战斗请求
├── ShopControl.ts        # 商店请求
├── TaskControl.ts        # 任务请求
└── BaseControl.ts        # 请求基类
```

**示例代码**：

```typescript
// BaseControl.ts
export abstract class BaseControl {
    protected baseUrl: string = '/api';
    
    protected async request<T>(
        method: string, 
        endpoint: string, 
        data?: any
    ): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: data ? JSON.stringify(data) : undefined
        });
        return response.json();
    }
}

// LoginControl.ts
export class LoginControl extends BaseControl {
    async login(form: LoginForm) {
        return this.request('POST', '/login', form);
    }
    
    async logout() {
        return this.request('POST', '/logout');
    }
}
```

### 2.1.5 views/ - 界面脚本

**职责**：UI界面的逻辑和交互。

```
scripts/views/
├── common/               # 通用UI组件
│   ├── Button.ts
│   ├── Dialog.ts
│   └── Toast.ts
├── panels/               # 功能面板
│   ├── MainPanel.ts
│   ├── BagPanel.ts
│   ├── ShopPanel.ts
│   └── SettingPanel.ts
├── hud/                  # HUD界面
│   ├── PlayerHUD.ts
│   ├── MiniMap.ts
│   └── SkillBar.ts
└── BaseView.ts           # 视图基类
```

**示例代码**：

```typescript
// BaseView.ts
export abstract class BaseView {
    protected isVisible: boolean = false;
    
    abstract onCreate(): void;    // 创建时
    abstract onShow(): void;      // 显示时
    abstract onHide(): void;      // 隐藏时
    abstract onDestroy(): void;   // 销毁时
    
    show(): void {
        this.isVisible = true;
        this.onShow();
    }
    
    hide(): void {
        this.isVisible = false;
        this.onHide();
    }
}

// BagPanel.ts
export class BagPanel extends BaseView {
    private items: ItemData[] = [];
    
    onCreate(): void {
        EventManager.on(EventEnum.BAG_UPDATE, this.refresh.bind(this));
    }
    
    onShow(): void {
        this.items = DataManager.getBagItems();
        this.render();
    }
    
    onHide(): void {
        // 清理逻辑
    }
    
    onDestroy(): void {
        EventManager.off(EventEnum.BAG_UPDATE, this.refresh.bind(this));
    }
    
    private refresh(items: ItemData[]): void {
        this.items = items;
        this.render();
    }
    
    private render(): void {
        // 渲染背包UI
    }
}
```

### 2.1.6 components/ - 组件脚本

**职责**：可复用的游戏组件。

```
scripts/components/
├── Player.ts             # 玩家组件
├── Enemy.ts              # 敌人组件
├── Projectile.ts         # 投射物组件
├── Item.ts               # 道具组件
├── Effect.ts             # 特效组件
└── BaseComponent.ts      # 组件基类
```

### 2.1.7 global/ - 全局变量脚本

**职责**：存储全局状态和数据。

```
scripts/global/
├── Global.ts             # 全局变量入口
├── PlayerData.ts         # 玩家数据
├── GameConfig.ts         # 游戏配置
└── Constants.ts          # 常量定义
```

**示例代码**：

```typescript
// Global.ts
export class Global {
    // 玩家数据
    static playerData: PlayerData | null = null;
    
    // 游戏状态
    static isPlaying: boolean = false;
    static isPaused: boolean = false;
    
    // 配置
    static readonly VERSION = '1.0.0';
    static readonly DEBUG = true;
    
    // 重置
    static reset(): void {
        Global.playerData = null;
        Global.isPlaying = false;
        Global.isPaused = false;
    }
}

// Constants.ts
export const Constants = {
    // 屏幕尺寸
    SCREEN_WIDTH: 1920,
    SCREEN_HEIGHT: 1080,
    
    // 游戏参数
    MAX_LEVEL: 100,
    MAX_BAG_SIZE: 200,
    
    // 时间
    TICK_RATE: 60,
    SAVE_INTERVAL: 30000,
} as const;
```

### 2.1.8 enums/ - 枚举脚本

**职责**：定义所有枚举类型，便于代码维护和查阅。

```
scripts/enums/
├── EventEnum.ts          # 事件枚举（核心）
├── SceneEnum.ts          # 场景枚举
├── ItemEnum.ts           # 道具枚举
├── SkillEnum.ts          # 技能枚举
├── UIEnum.ts             # UI枚举
└── ErrorEnum.ts          # 错误码枚举
```

**EventEnum 示例**：

```typescript
// EventEnum.ts - 事件枚举定义
export enum EventEnum {
    // ========== 场景事件 ==========
    SCENE_ENTER = 'scene_enter',           // 进入场景
    SCENE_EXIT = 'scene_exit',             // 离开场景
    SCENE_LOADED = 'scene_loaded',         // 场景加载完成
    
    // ========== 玩家事件 ==========
    PLAYER_MOVE = 'player_move',           // 玩家移动
    PLAYER_ATTACK = 'player_attack',       // 玩家攻击
    PLAYER_HURT = 'player_hurt',           // 玩家受伤
    PLAYER_DIE = 'player_die',             // 玩家死亡
    PLAYER_LEVEL_UP = 'player_level_up',   // 玩家升级
    
    // ========== UI事件 ==========
    UI_OPEN = 'ui_open',                   // 打开UI
    UI_CLOSE = 'ui_close',                 // 关闭UI
    UI_REFRESH = 'ui_refresh',             // 刷新UI
    
    // ========== 背包事件 ==========
    BAG_UPDATE = 'bag_update',             // 背包更新
    BAG_ITEM_ADD = 'bag_item_add',         // 添加道具
    BAG_ITEM_REMOVE = 'bag_item_remove',   // 移除道具
    BAG_ITEM_USE = 'bag_item_use',         // 使用道具
    
    // ========== 战斗事件 ==========
    BATTLE_START = 'battle_start',         // 战斗开始
    BATTLE_END = 'battle_end',             // 战斗结束
    BATTLE_WIN = 'battle_win',             // 战斗胜利
    BATTLE_LOSE = 'battle_lose',           // 战斗失败
    
    // ========== 网络事件 ==========
    NET_CONNECT = 'net_connect',           // 网络连接
    NET_DISCONNECT = 'net_disconnect',     // 网络断开
    NET_ERROR = 'net_error',               // 网络错误
    
    // ========== 登录事件 ==========
    LOGIN_SUCCESS = 'login_success',       // 登录成功
    LOGIN_FAIL = 'login_fail',             // 登录失败
    LOGOUT = 'logout',                     // 登出
    
    // ========== 任务事件 ==========
    TASK_ACCEPT = 'task_accept',           // 接受任务
    TASK_UPDATE = 'task_update',           // 任务更新
    TASK_COMPLETE = 'task_complete',       // 任务完成
    
    // ========== 系统事件 ==========
    GAME_INIT = 'game_init',               // 游戏初始化
    GAME_START = 'game_start',             // 游戏开始
    GAME_PAUSE = 'game_pause',             // 游戏暂停
    GAME_RESUME = 'game_resume',           // 游戏继续
    GAME_OVER = 'game_over',               // 游戏结束
}
```

---

## 2.2 assets/ - 游戏资源目录

### 2.2.1 textures/ - 图片资源

```
assets/textures/
├── ui/                   # UI图片
│   ├── icons/            # 图标
│   ├── backgrounds/      # 背景
│   └── buttons/          # 按钮
├── characters/           # 角色图片
│   ├── player/           # 玩家
│   └── enemies/          # 敌人
├── effects/              # 特效图片
├── items/                # 道具图片
└── tiles/                # 地图图块
```

### 2.2.2 sounds/ - 音频资源

```
assets/sounds/
├── bgm/                  # 背景音乐
│   ├── main_theme.mp3
│   ├── battle.mp3
│   └── victory.mp3
├── sfx/                  # 音效
│   ├── attack/           # 攻击音效
│   ├── ui/               # UI音效
│   └── ambient/          # 环境音效
└── voice/                # 语音
```

### 2.2.3 videos/ - 视频资源

```
assets/videos/
├── opening.mp4           # 开场动画
├── cutscenes/            # 过场动画
└── tutorials/            # 教程视频
```

### 2.2.4 prefabs/ - 预制体资源

```
assets/prefabs/
├── characters/           # 角色预制体
├── effects/              # 特效预制体
├── projectiles/          # 投射物预制体
├── items/                # 道具预制体
└── ui/                   # UI预制体
```

### 2.2.5 maps/ - 地图数据

```
assets/maps/
├── world_01/             # 世界1地图数据
│   ├── level_01.json     # 关卡1
│   ├── level_02.json     # 关卡2
│   └── tileset.json      # 图块集
├── world_02/             # 世界2地图数据
└── navigation/           # 导航网格数据
```

---

## 2.3 configs/ - 配置文件目录

```
configs/
├── items.json            # 道具配置表
├── skills.json           # 技能配置表
├── enemies.json          # 敌人配置表
├── levels.json           # 关卡配置表
├── shop.json             # 商店配置表
├── tasks.json            # 任务配置表
└── localization/         # 多语言配置
    ├── zh_CN.json        # 中文
    └── en_US.json        # 英文
```

**配置表示例**：

```json
// items.json
{
    "items": [
        {
            "id": 1001,
            "name": "生命药水",
            "type": "consumable",
            "quality": "common",
            "stackLimit": 99,
            "effect": {
                "type": "heal",
                "value": 100
            },
            "price": {
                "buy": 50,
                "sell": 25
            }
        }
    ]
}
```

---

## 2.4 libs/ - 第三方库目录

```
libs/
├── physics/              # 物理引擎
├── network/              # 网络库
├── ui/                   # UI框架
└── utils/                # 工具库
```

---

## 2.5 tools/ - 工具脚本目录

```
tools/
├── build.ts              # 构建脚本
├── export.ts             # 导出脚本
├── config-gen.ts         # 配置表生成器
└── asset-pack.ts         # 资源打包工具
```

---

# 三、核心模块说明

## 3.1 事件系统

事件系统是框架的核心，负责模块间的解耦通信。

**使用规范**：

1. 所有事件必须在 `EventEnum` 中定义
2. 事件命名采用 `模块_动作` 格式
3. 注册事件时必须在销毁时移除
4. 避免循环触发事件

```typescript
// 正确用法
class MyComponent {
    private onPlayerHurt = (damage: number) => {
        console.log(`受到 ${damage} 点伤害`);
    };
    
    onCreate() {
        EventManager.on(EventEnum.PLAYER_HURT, this.onPlayerHurt);
    }
    
    onDestroy() {
        EventManager.off(EventEnum.PLAYER_HURT, this.onPlayerHurt);
    }
}
```

## 3.2 场景管理

场景管理器负责场景的加载、切换和生命周期管理。

```typescript
// 场景切换
SceneManager.loadScene(SceneEnum.BATTLE, {
    levelId: 101,
    onComplete: () => console.log('场景加载完成')
});

// 场景栈管理
SceneManager.pushScene(SceneEnum.PAUSE);  // 压入场景
SceneManager.popScene();                   // 弹出场景
```

## 3.3 UI管理

UI管理器负责面板的打开、关闭和层级管理。

```typescript
// 打开面板
UIManager.open(UIEnum.BAG_PANEL, { tabIndex: 0 });

// 关闭面板
UIManager.close(UIEnum.BAG_PANEL);

// 弹窗
UIManager.showDialog({
    title: '提示',
    content: '确定退出游戏？',
    buttons: ['确定', '取消'],
    onConfirm: () => { /* 确定逻辑 */ }
});

// 提示
UIManager.showToast('获得 100 金币');
```

---

# 四、命名规范

## 4.1 文件命名

| 类型 | 规范 | 示例 |
|------|------|------|
| 场景 | PascalCase + Scene | `GameScene.ts` |
| 管理器 | PascalCase + Manager | `EventManager.ts` |
| 视图 | PascalCase + Panel/HUD | `BagPanel.ts` |
| 组件 | PascalCase | `Player.ts` |
| 枚举 | PascalCase + Enum | `EventEnum.ts` |
| 工具 | kebab-case | `config-gen.ts` |

## 4.2 变量命名

| 类型 | 规范 | 示例 |
|------|------|------|
| 类 | PascalCase | `class PlayerData` |
| 接口 | I + PascalCase | `interface IItem` |
| 枚举值 | UPPER_SNAKE_CASE | `PLAYER_MOVE` |
| 常量 | UPPER_SNAKE_CASE | `MAX_LEVEL` |
| 变量 | camelCase | `playerHealth` |
| 私有变量 | camelCase | `private isPlaying` |

## 4.3 资源命名

| 类型 | 规范 | 示例 |
|------|------|------|
| 图片 | snake_case | `btn_start.png` |
| 音频 | snake_case | `bgm_battle.mp3` |
| 预制体 | snake_case | `enemy_goblin.prefab` |
| 配置 | snake_case | `item_config.json` |

---

# 五、开发流程

## 5.1 新功能开发流程

```
1. 在 enums/ 中定义相关枚举
       ↓
2. 在 configs/ 中添加配置数据
       ↓
3. 在 managers/ 中添加管理器（如需要）
       ↓
4. 在 components/ 中添加组件
       ↓
5. 在 views/ 中添加UI界面
       ↓
6. 在 scenes/ 中集成功能
       ↓
7. 测试和调试
```

## 5.2 网络功能开发流程

```
1. 在 controls/ 中添加请求接口
       ↓
2. 在 handlers/ 中添加响应处理
       ↓
3. 在 enums/EventEnum 中定义事件
       ↓
4. 在 views/ 中监听事件更新UI
```

---

# 六、最佳实践

## 6.1 代码规范

- **单一职责**：每个类只负责一件事
- **依赖注入**：避免硬编码依赖
- **事件驱动**：使用事件系统解耦模块
- **配置分离**：数据与逻辑分离

## 6.2 性能优化

- 使用对象池管理频繁创建销毁的对象
- 合理使用事件，避免过度广播
- 资源懒加载，按需加载资源
- 定期清理无用监听器

## 6.3 调试建议

```typescript
// 开启调试模式
if (Global.DEBUG) {
    console.log('[Debug]', message);
}

// 事件追踪
EventManager.on(EventEnum.PLAYER_HURT, (damage) => {
    console.log(`[Event] PLAYER_HURT: ${damage}`);
});
```

---

# 附录：快速参考表

## 常用Manager列表

| Manager | 职责 | 单例 |
|---------|------|------|
| EventManager | 事件收发 | ✓ |
| SceneManager | 场景管理 | ✓ |
| UIManager | UI管理 | ✓ |
| AudioManager | 音频管理 | ✓ |
| ResourceManager | 资源管理 | ✓ |
| DataManager | 数据管理 | ✓ |
| SaveManager | 存档管理 | ✓ |
| InputManager | 输入管理 | ✓ |
| NetworkManager | 网络管理 | ✓ |
| PoolManager | 对象池 | ✓ |

## 生命周期方法

| 方法 | 调用时机 |
|------|----------|
| onCreate | 创建时 |
| onEnter/onShow | 进入/显示时 |
| onUpdate | 每帧更新 |
| onExit/onHide | 离开/隐藏时 |
| onDestroy | 销毁时 |

---

*文档版本: 1.0*  
*创建日期: 2026-02*
