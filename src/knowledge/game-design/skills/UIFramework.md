# 泛用UI框架设计文档

本文档详细说明游戏UI框架的架构设计、核心模块、组件规范和最佳实践，旨在解决UI层级混乱、调用失败等常见问题。

---

## 目录

1. [框架概览](#一框架概览)
2. [层级系统](#二层级系统)
3. [面板管理](#三面板管理)
4. [组件系统](#四组件系统)
5. [数据绑定](#五数据绑定)
6. [动画系统](#六动画系统)
7. [事件系统](#七事件系统)
8. [适配方案](#八适配方案)
9. [资源管理](#九资源管理)
10. [调试工具](#十调试工具)
11. [API参考](#十一api参考)
12. [最佳实践](#十二最佳实践)

---

# 一、框架概览

## 1.1 核心架构

```
UISystem
├── UIManager              # UI管理器（单例入口）
│   ├── UILayerManager     # 层级管理
│   ├── UIStackManager     # 面板栈管理
│   ├── UIPoolManager      # UI对象池
│   └── UIMaskManager      # 遮罩管理
├── UIPanelRegistry        # 面板注册表
├── UIComponentFactory     # 组件工厂
├── UIAnimator             # 动画控制器
├── UIBinder               # 数据绑定器
└── UIDebugger             # 调试工具
```

## 1.2 设计目标

| 目标 | 实现方式 |
|-----|---------|
| 层级可控 | 固定层级 + 层内动态排序 + 模态遮罩 |
| 调用安全 | 状态机 + Promise化 + 防御性编程 |
| 高性能 | 对象池 + 虚拟列表 + 按需加载 |
| 易扩展 | 组件化 + 配置化 + 事件驱动 |
| 易调试 | 调用追踪 + 错误上报 + 可视化工具 |

## 1.3 数据流

```
┌─────────────────────────────────────────────────────────────┐
│                     用户交互 (Input)                         │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   事件分发 (UIEvent)                         │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   业务逻辑 (Handler)                         │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   数据更新 (Model)                           │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   视图刷新 (View)                            │
└─────────────────────────────────────────────────────────────┘
```

---

# 二、层级系统

## 2.1 固定层级定义

```typescript
// UILayer.ts
export enum UILayer {
    /** 背景层：全屏背景、场景UI */
    Background = 0,
    
    /** 主界面层：HUD、主功能入口 */
    Main = 100,
    
    /** 弹窗层：功能面板、二级界面 */
    Popup = 200,
    
    /** 模态层：确认框、输入框 */
    Modal = 300,
    
    /** 引导层：新手引导、高亮遮罩 */
    Guide = 400,
    
    /** 提示层：Toast、飘字 */
    Toast = 500,
    
    /** 加载层：全屏Loading */
    Loading = 600,
    
    /** 系统层：网络错误、强制更新、GM工具 */
    System = 700,
}
```

## 2.2 层级管理器

```typescript
// UILayerManager.ts
class UILayerManager {
    private layers: Map<UILayer, UILayerContainer> = new Map();
    private sortCounter: Map<UILayer, number> = new Map();
    
    /** 初始化所有层级容器 */
    init(root: Container): void {
        const layerValues = Object.values(UILayer)
            .filter(v => typeof v === 'number') as UILayer[];
        
        layerValues.sort((a, b) => a - b).forEach(layer => {
            const container = new UILayerContainer(layer);
            container.zIndex = layer;
            root.addChild(container);
            this.layers.set(layer, container);
            this.sortCounter.set(layer, 0);
        });
    }
    
    /** 添加面板到指定层级 */
    addToLayer(panel: UIPanel, layer: UILayer): void {
        const container = this.layers.get(layer);
        if (!container) {
            console.error(`[UI] 层级 ${layer} 不存在`);
            return;
        }
        
        // 层内排序：后添加的在上面
        const sortIndex = this.sortCounter.get(layer)! + 1;
        this.sortCounter.set(layer, sortIndex);
        panel.sortInLayer = sortIndex;
        
        container.addChild(panel);
        container.sortChildren();
    }
    
    /** 将面板置顶（在当前层级内） */
    bringToFront(panel: UIPanel): void {
        const layer = panel.layer;
        const sortIndex = this.sortCounter.get(layer)! + 1;
        this.sortCounter.set(layer, sortIndex);
        panel.sortInLayer = sortIndex;
        panel.parent?.sortChildren();
    }
    
    /** 锁定层级（禁止交互） */
    lockLayer(layer: UILayer): void {
        const container = this.layers.get(layer);
        if (container) {
            container.interactiveChildren = false;
        }
    }
    
    /** 解锁层级 */
    unlockLayer(layer: UILayer): void {
        const container = this.layers.get(layer);
        if (container) {
            container.interactiveChildren = true;
        }
    }
}
```

## 2.3 遮罩管理器

```typescript
// UIMaskManager.ts
interface MaskConfig {
    color: number;           // 遮罩颜色
    alpha: number;           // 透明度 0-1
    closeOnClick: boolean;   // 点击关闭
    animated: boolean;       // 是否动画
}

const DefaultMaskConfig: MaskConfig = {
    color: 0x000000,
    alpha: 0.6,
    closeOnClick: true,
    animated: true,
};

class UIMaskManager {
    private maskPool: UIMask[] = [];
    private activeMasks: Map<UIPanel, UIMask> = new Map();
    
    /** 显示遮罩 */
    show(panel: UIPanel, config: Partial<MaskConfig> = {}): UIMask {
        const cfg = { ...DefaultMaskConfig, ...config };
        
        // 从对象池获取或创建
        const mask = this.maskPool.pop() || new UIMask();
        mask.setup(cfg);
        
        // 插入到面板下方
        const parent = panel.parent;
        const index = parent.getChildIndex(panel);
        parent.addChildAt(mask, index);
        
        this.activeMasks.set(panel, mask);
        
        if (cfg.closeOnClick) {
            mask.onClick = () => UI.close(panel.name);
        }
        
        if (cfg.animated) {
            mask.fadeIn(0.2);
        }
        
        return mask;
    }
    
    /** 隐藏遮罩 */
    async hide(panel: UIPanel): Promise<void> {
        const mask = this.activeMasks.get(panel);
        if (!mask) return;
        
        await mask.fadeOut(0.2);
        mask.parent?.removeChild(mask);
        mask.reset();
        this.maskPool.push(mask);
        this.activeMasks.delete(panel);
    }
}
```

---

# 三、面板管理

## 3.1 面板状态机

```typescript
// UIPanelState.ts
export enum UIPanelState {
    /** 未创建 */
    None = 'none',
    
    /** 资源加载中 */
    Loading = 'loading',
    
    /** 已创建，未显示 */
    Ready = 'ready',
    
    /** 显示动画中 */
    Showing = 'showing',
    
    /** 已显示 */
    Shown = 'shown',
    
    /** 隐藏动画中 */
    Hiding = 'hiding',
    
    /** 已隐藏 */
    Hidden = 'hidden',
    
    /** 已销毁 */
    Destroyed = 'destroyed',
}

// 状态转换规则
const StateTransitions: Record<UIPanelState, UIPanelState[]> = {
    [UIPanelState.None]: [UIPanelState.Loading],
    [UIPanelState.Loading]: [UIPanelState.Ready, UIPanelState.Destroyed],
    [UIPanelState.Ready]: [UIPanelState.Showing, UIPanelState.Destroyed],
    [UIPanelState.Showing]: [UIPanelState.Shown],
    [UIPanelState.Shown]: [UIPanelState.Hiding, UIPanelState.Destroyed],
    [UIPanelState.Hiding]: [UIPanelState.Hidden],
    [UIPanelState.Hidden]: [UIPanelState.Showing, UIPanelState.Destroyed],
    [UIPanelState.Destroyed]: [],
};
```

## 3.2 面板类型

```typescript
// UIPanelType.ts
export enum UIPanelType {
    /** 普通面板：可叠加显示 */
    Normal = 'normal',
    
    /** 互斥面板：同层只显示一个，打开新的会关闭旧的 */
    Exclusive = 'exclusive',
    
    /** 栈式面板：后进先出，返回时关闭当前显示上一个 */
    Stack = 'stack',
    
    /** 全屏面板：隐藏下层所有面板 */
    Fullscreen = 'fullscreen',
    
    /** 固定面板：不受栈管理，手动控制 */
    Fixed = 'fixed',
}
```

## 3.3 面板注册表

```typescript
// UIPanelRegistry.ts
interface UIPanelConfig {
    /** 资源路径 */
    path: string;
    
    /** 所属层级 */
    layer: UILayer;
    
    /** 面板类型 */
    type: UIPanelType;
    
    /** 是否单例（默认true） */
    singleton?: boolean;
    
    /** 是否预加载 */
    preload?: boolean;
    
    /** 是否缓存（关闭后不销毁） */
    cache?: boolean;
    
    /** 遮罩配置 */
    mask?: Partial<MaskConfig> | boolean;
    
    /** 显示动画 */
    showAnim?: UIAnimationType;
    
    /** 隐藏动画 */
    hideAnim?: UIAnimationType;
    
    /** 打开音效 */
    openSound?: string;
    
    /** 关闭音效 */
    closeSound?: string;
}

// 面板注册表
export const UIPanelRegistry: Record<string, UIPanelConfig> = {
    // ========== 主界面 ==========
    'MainHUD': {
        path: 'prefabs/ui/hud/MainHUD',
        layer: UILayer.Main,
        type: UIPanelType.Fixed,
        preload: true,
        cache: true,
    },
    
    // ========== 功能面板 ==========
    'BagPanel': {
        path: 'prefabs/ui/panels/BagPanel',
        layer: UILayer.Popup,
        type: UIPanelType.Exclusive,
        cache: true,
        mask: true,
        showAnim: 'scaleIn',
        hideAnim: 'scaleOut',
        openSound: 'sfx_ui_open',
    },
    
    'ShopPanel': {
        path: 'prefabs/ui/panels/ShopPanel',
        layer: UILayer.Popup,
        type: UIPanelType.Exclusive,
        cache: true,
        mask: { alpha: 0.7 },
        showAnim: 'slideInRight',
        hideAnim: 'slideOutRight',
    },
    
    // ========== 弹窗 ==========
    'ConfirmDialog': {
        path: 'prefabs/ui/dialogs/ConfirmDialog',
        layer: UILayer.Modal,
        type: UIPanelType.Stack,
        singleton: false,  // 允许多个确认框
        mask: { closeOnClick: false },
        showAnim: 'popIn',
        hideAnim: 'popOut',
    },
    
    // ========== 提示 ==========
    'ToastPanel': {
        path: 'prefabs/ui/common/ToastPanel',
        layer: UILayer.Toast,
        type: UIPanelType.Fixed,
        cache: true,
    },
};
```

## 3.4 面板基类

```typescript
// UIPanel.ts
export abstract class UIPanel extends Container {
    /** 面板名称 */
    readonly name: string;
    
    /** 面板配置 */
    readonly config: UIPanelConfig;
    
    /** 当前状态 */
    private _state: UIPanelState = UIPanelState.None;
    
    /** 层内排序 */
    sortInLayer: number = 0;
    
    /** 待执行的回调队列 */
    private pendingCalls: Array<() => void> = [];
    
    /** 定时器列表（销毁时清理） */
    private timers: number[] = [];
    
    /** 事件监听列表（销毁时清理） */
    private eventListeners: Array<{ event: string; callback: Function }> = [];
    
    // ==================== 状态管理 ====================
    
    get state(): UIPanelState {
        return this._state;
    }
    
    protected setState(newState: UIPanelState): boolean {
        const allowedStates = StateTransitions[this._state];
        if (!allowedStates.includes(newState)) {
            console.warn(`[UI] ${this.name} 状态转换失败: ${this._state} -> ${newState}`);
            return false;
        }
        
        const oldState = this._state;
        this._state = newState;
        this.onStateChange(oldState, newState);
        return true;
    }
    
    /** 是否可交互 */
    get isInteractive(): boolean {
        return this._state === UIPanelState.Shown;
    }
    
    // ==================== 生命周期 ====================
    
    /** 创建时（仅调用一次） */
    protected abstract onCreate(): void;
    
    /** 显示前（每次显示都调用） */
    protected onBeforeShow(data?: any): void {}
    
    /** 显示后 */
    protected onShow(data?: any): void {}
    
    /** 刷新数据 */
    protected onRefresh(data?: any): void {}
    
    /** 隐藏前 */
    protected onBeforeHide(): void {}
    
    /** 隐藏后 */
    protected onHide(): void {}
    
    /** 销毁时 */
    protected onDestroy(): void {}
    
    /** 状态变化时 */
    protected onStateChange(oldState: UIPanelState, newState: UIPanelState): void {}
    
    // ==================== 核心方法 ====================
    
    /** 显示面板 */
    async show(data?: any): Promise<void> {
        // 状态检查
        if (this._state === UIPanelState.Showing || this._state === UIPanelState.Shown) {
            console.warn(`[UI] ${this.name} 已在显示状态`);
            this.safeRefresh(data);
            return;
        }
        
        if (this._state === UIPanelState.Destroyed) {
            console.error(`[UI] ${this.name} 已销毁，无法显示`);
            return;
        }
        
        // 首次显示需要创建
        if (this._state === UIPanelState.None || this._state === UIPanelState.Loading) {
            await this.waitUntilReady();
        }
        
        this.setState(UIPanelState.Showing);
        
        // 显示遮罩
        if (this.config.mask) {
            const maskConfig = typeof this.config.mask === 'boolean' ? {} : this.config.mask;
            UI.mask.show(this, maskConfig);
        }
        
        // 显示前回调
        this.onBeforeShow(data);
        
        // 播放音效
        if (this.config.openSound) {
            AudioManager.playSound(this.config.openSound);
        }
        
        // 播放动画
        if (this.config.showAnim) {
            await UIAnimator.play(this, this.config.showAnim);
        }
        
        this.setState(UIPanelState.Shown);
        
        // 显示后回调
        this.onShow(data);
        
        // 执行待处理的回调
        this.flushPendingCalls();
    }
    
    /** 隐藏面板 */
    async hide(): Promise<void> {
        if (this._state !== UIPanelState.Shown) {
            console.warn(`[UI] ${this.name} 不在显示状态，无法隐藏`);
            return;
        }
        
        this.setState(UIPanelState.Hiding);
        
        // 隐藏前回调
        this.onBeforeHide();
        
        // 播放音效
        if (this.config.closeSound) {
            AudioManager.playSound(this.config.closeSound);
        }
        
        // 播放动画
        if (this.config.hideAnim) {
            await UIAnimator.play(this, this.config.hideAnim);
        }
        
        // 隐藏遮罩
        if (this.config.mask) {
            await UI.mask.hide(this);
        }
        
        this.setState(UIPanelState.Hidden);
        
        // 隐藏后回调
        this.onHide();
        
        // 根据配置决定是缓存还是销毁
        if (this.config.cache) {
            this.visible = false;
        } else {
            this.destroy();
        }
    }
    
    /** 安全刷新（仅在显示状态执行） */
    safeRefresh(data?: any): void {
        if (this._state === UIPanelState.Shown) {
            this.onRefresh(data);
        } else {
            console.warn(`[UI] ${this.name} 未在显示状态，跳过刷新`);
        }
    }
    
    /** 等待就绪后执行 */
    callWhenReady(callback: () => void): void {
        if (this._state === UIPanelState.Shown) {
            callback();
        } else {
            this.pendingCalls.push(callback);
        }
    }
    
    /** 等待面板就绪 */
    private async waitUntilReady(): Promise<void> {
        return new Promise((resolve) => {
            const check = () => {
                if (this._state >= UIPanelState.Ready) {
                    resolve();
                } else {
                    requestAnimationFrame(check);
                }
            };
            check();
        });
    }
    
    /** 执行待处理的回调 */
    private flushPendingCalls(): void {
        const calls = this.pendingCalls.splice(0);
        calls.forEach(cb => {
            try {
                cb();
            } catch (e) {
                console.error(`[UI] ${this.name} 回调执行错误:`, e);
            }
        });
    }
    
    // ==================== 工具方法 ====================
    
    /** 添加定时器（自动清理） */
    protected setTimeout(callback: () => void, delay: number): number {
        const id = window.setTimeout(() => {
            this.timers = this.timers.filter(t => t !== id);
            if (this._state !== UIPanelState.Destroyed) {
                callback();
            }
        }, delay);
        this.timers.push(id);
        return id;
    }
    
    /** 添加事件监听（自动清理） */
    protected addEventListener(event: string, callback: Function): void {
        EventManager.on(event, callback as any);
        this.eventListeners.push({ event, callback });
    }
    
    /** 清理所有定时器 */
    private clearTimers(): void {
        this.timers.forEach(id => window.clearTimeout(id));
        this.timers = [];
    }
    
    /** 移除所有事件监听 */
    private removeAllListeners(): void {
        this.eventListeners.forEach(({ event, callback }) => {
            EventManager.off(event, callback as any);
        });
        this.eventListeners = [];
    }
    
    /** 销毁面板 */
    destroy(): void {
        if (this._state === UIPanelState.Destroyed) {
            return;
        }
        
        this.setState(UIPanelState.Destroyed);
        
        // 清理
        this.onDestroy();
        this.clearTimers();
        this.removeAllListeners();
        this.pendingCalls = [];
        
        // 移除遮罩
        UI.mask.hide(this);
        
        // 从父节点移除
        this.parent?.removeChild(this);
        
        // 防止销毁后调用
        this.onRefresh = () => {};
        this.onShow = () => {};
        this.onHide = () => {};
    }
}
```

## 3.5 UI管理器

```typescript
// UIManager.ts
class UIManager {
    private static _instance: UIManager;
    
    readonly layer: UILayerManager;
    readonly mask: UIMaskManager;
    readonly stack: UIStackManager;
    readonly pool: UIPoolManager;
    
    /** 已打开的面板 */
    private openedPanels: Map<string, UIPanel> = new Map();
    
    /** 加载中的面板 */
    private loadingPanels: Set<string> = new Set();
    
    /** 错误处理器 */
    onError?: (error: UIError) => void;
    
    static getInstance(): UIManager {
        if (!UIManager._instance) {
            UIManager._instance = new UIManager();
        }
        return UIManager._instance;
    }
    
    // ==================== 核心API ====================
    
    /**
     * 打开面板
     * @param name 面板名称
     * @param data 传递的数据
     * @returns 面板实例
     */
    async open<T extends UIPanel = UIPanel>(name: string, data?: any): Promise<T> {
        const config = UIPanelRegistry[name];
        if (!config) {
            const error = { type: UIErrorType.PanelNotFound, panel: name };
            this.handleError(error);
            throw new Error(`面板 ${name} 未注册`);
        }
        
        // 调试追踪
        UIDebugger.trace('open', name, data);
        
        // 检查是否已打开
        const existing = this.openedPanels.get(name);
        if (existing) {
            if (config.singleton !== false) {
                // 单例模式：刷新现有面板
                existing.safeRefresh(data);
                this.layer.bringToFront(existing);
                return existing as T;
            }
        }
        
        // 检查是否正在加载
        if (this.loadingPanels.has(name)) {
            console.warn(`[UI] ${name} 正在加载中，请勿重复调用`);
            // 等待加载完成
            await this.waitForPanel(name);
            return this.openedPanels.get(name) as T;
        }
        
        // 处理互斥面板
        if (config.type === UIPanelType.Exclusive) {
            await this.closeExclusivePanels(config.layer);
        }
        
        // 加载面板
        this.loadingPanels.add(name);
        
        try {
            const panel = await this.loadPanel(name, config);
            this.loadingPanels.delete(name);
            
            // 添加到层级
            this.layer.addToLayer(panel, config.layer);
            this.openedPanels.set(name, panel);
            
            // 处理栈式面板
            if (config.type === UIPanelType.Stack) {
                this.stack.push(panel);
            }
            
            // 显示面板
            await panel.show(data);
            
            return panel as T;
            
        } catch (error) {
            this.loadingPanels.delete(name);
            this.handleError({ type: UIErrorType.LoadFailed, panel: name, error });
            throw error;
        }
    }
    
    /**
     * 关闭面板
     * @param name 面板名称
     */
    async close(name: string): Promise<void> {
        const panel = this.openedPanels.get(name);
        if (!panel) {
            console.warn(`[UI] ${name} 未打开，无需关闭`);
            return;
        }
        
        UIDebugger.trace('close', name);
        
        await panel.hide();
        
        if (!panel.config.cache) {
            this.openedPanels.delete(name);
        }
    }
    
    /**
     * 强制关闭面板（跳过动画）
     */
    forceClose(name: string): void {
        const panel = this.openedPanels.get(name);
        if (panel) {
            panel.destroy();
            this.openedPanels.delete(name);
        }
    }
    
    /**
     * 关闭所有面板
     */
    async closeAll(exceptFixed: boolean = true): Promise<void> {
        const promises: Promise<void>[] = [];
        
        this.openedPanels.forEach((panel, name) => {
            if (exceptFixed && panel.config.type === UIPanelType.Fixed) {
                return;
            }
            promises.push(this.close(name));
        });
        
        await Promise.all(promises);
    }
    
    /**
     * 获取已打开的面板
     */
    getPanel<T extends UIPanel = UIPanel>(name: string): T | undefined {
        return this.openedPanels.get(name) as T | undefined;
    }
    
    /**
     * 判断面板是否打开
     */
    isOpened(name: string): boolean {
        const panel = this.openedPanels.get(name);
        return panel?.state === UIPanelState.Shown;
    }
    
    // ==================== 便捷方法 ====================
    
    /**
     * 显示确认对话框
     */
    async dialog(options: DialogOptions): Promise<boolean> {
        const panel = await this.open<ConfirmDialog>('ConfirmDialog', options);
        return panel.waitForResult();
    }
    
    /**
     * 显示Toast提示
     */
    toast(message: string, duration: number = 2000): void {
        const toastPanel = this.getPanel<ToastPanel>('ToastPanel');
        if (toastPanel) {
            toastPanel.show(message, duration);
        } else {
            this.open('ToastPanel').then(panel => {
                (panel as ToastPanel).show(message, duration);
            });
        }
    }
    
    /**
     * 显示Loading
     */
    async showLoading(message?: string): Promise<void> {
        await this.open('LoadingPanel', { message });
    }
    
    /**
     * 隐藏Loading
     */
    async hideLoading(): Promise<void> {
        await this.close('LoadingPanel');
    }
    
    /**
     * 预加载面板
     */
    async preload(names: string[]): Promise<void> {
        const promises = names.map(name => {
            const config = UIPanelRegistry[name];
            if (config) {
                return ResourceManager.load(config.path);
            }
            return Promise.resolve();
        });
        await Promise.all(promises);
    }
    
    // ==================== 内部方法 ====================
    
    private async loadPanel(name: string, config: UIPanelConfig): Promise<UIPanel> {
        // 先检查对象池
        const pooled = this.pool.get(name);
        if (pooled) {
            return pooled;
        }
        
        // 加载资源
        const prefab = await ResourceManager.load(config.path);
        const panel = instantiate(prefab) as UIPanel;
        panel.name = name;
        panel.config = config;
        
        return panel;
    }
    
    private async closeExclusivePanels(layer: UILayer): Promise<void> {
        const promises: Promise<void>[] = [];
        
        this.openedPanels.forEach((panel, name) => {
            if (panel.config.layer === layer && 
                panel.config.type === UIPanelType.Exclusive &&
                panel.state === UIPanelState.Shown) {
                promises.push(this.close(name));
            }
        });
        
        await Promise.all(promises);
    }
    
    private async waitForPanel(name: string): Promise<void> {
        return new Promise((resolve) => {
            const check = () => {
                if (!this.loadingPanels.has(name)) {
                    resolve();
                } else {
                    setTimeout(check, 50);
                }
            };
            check();
        });
    }
    
    private handleError(error: UIError): void {
        console.error('[UI] Error:', error);
        this.onError?.(error);
    }
}

// 导出单例
export const UI = UIManager.getInstance();
```

---

# 四、组件系统

## 4.1 基础组件

### UIButton

```typescript
interface UIButtonConfig {
    /** 普通状态纹理 */
    normal?: string;
    /** 按下状态纹理 */
    pressed?: string;
    /** 禁用状态纹理 */
    disabled?: string;
    /** 点击音效 */
    clickSound?: string;
    /** 缩放效果 */
    scaleOnPress?: number;
    /** 防连点间隔（毫秒） */
    clickInterval?: number;
}

class UIButton extends UIComponent {
    private lastClickTime: number = 0;
    private config: UIButtonConfig;
    
    /** 点击事件 */
    onClick?: () => void;
    
    /** 长按事件 */
    onLongPress?: () => void;
    
    /** 重复点击事件 */
    onRepeat?: () => void;
    
    private handleClick(): void {
        const now = Date.now();
        const interval = this.config.clickInterval || 200;
        
        if (now - this.lastClickTime < interval) {
            return; // 防连点
        }
        
        this.lastClickTime = now;
        
        // 播放音效
        if (this.config.clickSound) {
            AudioManager.playSound(this.config.clickSound);
        }
        
        this.onClick?.();
    }
}
```

### UIList（虚拟滚动列表）

```typescript
interface UIListConfig<T> {
    /** 单个item高度（或宽度） */
    itemSize: number;
    /** 方向 */
    direction: 'vertical' | 'horizontal';
    /** 缓冲区item数量 */
    buffer?: number;
    /** item渲染器 */
    itemRenderer: new () => UIListItem<T>;
}

class UIList<T> extends UIComponent {
    private items: T[] = [];
    private visibleItems: Map<number, UIListItem<T>> = new Map();
    private itemPool: UIListItem<T>[] = [];
    
    /** 设置数据 */
    setData(items: T[]): void {
        this.items = items;
        this.refresh();
    }
    
    /** 刷新显示 */
    refresh(): void {
        const startIndex = this.getStartIndex();
        const endIndex = this.getEndIndex();
        
        // 回收不可见的item
        this.visibleItems.forEach((item, index) => {
            if (index < startIndex || index > endIndex) {
                this.recycleItem(item);
                this.visibleItems.delete(index);
            }
        });
        
        // 创建可见的item
        for (let i = startIndex; i <= endIndex; i++) {
            if (!this.visibleItems.has(i)) {
                const item = this.getItem();
                item.setData(this.items[i], i);
                item.y = i * this.config.itemSize;
                this.visibleItems.set(i, item);
            }
        }
    }
    
    private getItem(): UIListItem<T> {
        return this.itemPool.pop() || new this.config.itemRenderer();
    }
    
    private recycleItem(item: UIListItem<T>): void {
        item.reset();
        this.itemPool.push(item);
    }
}
```

## 4.2 组件列表

| 类别 | 组件 | 说明 |
|-----|------|-----|
| 基础 | UIButton | 按钮（普通/切换/长按/重复） |
| 基础 | UILabel | 文本（普通/富文本/打字机） |
| 基础 | UIImage | 图片（普通/九宫格/填充） |
| 基础 | UISprite | 精灵（支持图集） |
| 输入 | UIInput | 输入框 |
| 输入 | UISlider | 滑动条 |
| 输入 | UIToggle | 开关/复选框 |
| 输入 | UIToggleGroup | 单选组 |
| 进度 | UIProgress | 进度条（水平/垂直/圆形） |
| 容器 | UIList | 虚拟滚动列表 |
| 容器 | UIGrid | 网格 |
| 容器 | UIScrollView | 滚动视图 |
| 容器 | UIPageView | 分页视图 |
| 容器 | UITabView | 标签页 |
| 高级 | UIRedDot | 红点提示 |
| 高级 | UITips | 悬浮提示 |
| 高级 | UIDrag | 拖拽组件 |
| 高级 | UICountdown | 倒计时 |

---

# 五、数据绑定

## 5.1 绑定类型

```typescript
class UIBinder {
    /**
     * 单向绑定：Model -> View
     */
    static bind<T, K extends keyof T>(
        view: UILabel,
        model: T,
        key: K,
        formatter?: (value: T[K]) => string
    ): () => void {
        const update = () => {
            const value = model[key];
            view.text = formatter ? formatter(value) : String(value);
        };
        
        // 监听变化
        const unwatch = watch(model, key, update);
        
        // 初始更新
        update();
        
        // 返回解绑函数
        return unwatch;
    }
    
    /**
     * 双向绑定：Model <-> View
     */
    static bindTwoWay<T, K extends keyof T>(
        view: UIInput,
        model: T,
        key: K
    ): () => void {
        // Model -> View
        const unwatch = watch(model, key, (value) => {
            view.text = String(value);
        });
        
        // View -> Model
        view.onValueChange = (value) => {
            (model as any)[key] = value;
        };
        
        // 初始值
        view.text = String(model[key]);
        
        return () => {
            unwatch();
            view.onValueChange = undefined;
        };
    }
    
    /**
     * 列表绑定
     */
    static bindList<T>(
        list: UIList<T>,
        data: T[],
        itemRenderer: new () => UIListItem<T>
    ): () => void {
        list.config.itemRenderer = itemRenderer;
        list.setData(data);
        
        const unwatch = watchArray(data, () => {
            list.refresh();
        });
        
        return unwatch;
    }
    
    /**
     * 条件绑定
     */
    static bindVisible<T, K extends keyof T>(
        view: Container,
        model: T,
        key: K,
        condition?: (value: T[K]) => boolean
    ): () => void {
        const update = () => {
            const value = model[key];
            view.visible = condition ? condition(value) : Boolean(value);
        };
        
        const unwatch = watch(model, key, update);
        update();
        
        return unwatch;
    }
}
```

## 5.2 使用示例

```typescript
class BagPanel extends UIPanel {
    private unbinders: Array<() => void> = [];
    
    onCreate(): void {
        const player = DataManager.player;
        
        // 绑定金币显示
        this.unbinders.push(
            UIBinder.bind(this.goldLabel, player, 'gold', 
                (v) => `${v.toLocaleString()} 金币`)
        );
        
        // 绑定等级显示
        this.unbinders.push(
            UIBinder.bind(this.levelLabel, player, 'level',
                (v) => `Lv.${v}`)
        );
        
        // 绑定VIP图标显示
        this.unbinders.push(
            UIBinder.bindVisible(this.vipIcon, player, 'vipLevel',
                (v) => v > 0)
        );
        
        // 绑定道具列表
        this.unbinders.push(
            UIBinder.bindList(this.itemList, player.items, BagItemRenderer)
        );
    }
    
    onDestroy(): void {
        // 解绑所有
        this.unbinders.forEach(fn => fn());
        this.unbinders = [];
    }
}
```

---

# 六、动画系统

## 6.1 内置动画

```typescript
enum UIAnimationType {
    // 淡入淡出
    FadeIn = 'fadeIn',
    FadeOut = 'fadeOut',
    
    // 缩放
    ScaleIn = 'scaleIn',
    ScaleOut = 'scaleOut',
    
    // 弹出（带弹性）
    PopIn = 'popIn',
    PopOut = 'popOut',
    
    // 滑入滑出
    SlideInLeft = 'slideInLeft',
    SlideInRight = 'slideInRight',
    SlideInTop = 'slideInTop',
    SlideInBottom = 'slideInBottom',
    SlideOutLeft = 'slideOutLeft',
    SlideOutRight = 'slideOutRight',
    SlideOutTop = 'slideOutTop',
    SlideOutBottom = 'slideOutBottom',
    
    // 特效
    Bounce = 'bounce',
    Shake = 'shake',
    Pulse = 'pulse',
}
```

## 6.2 动画配置

```typescript
interface UIAnimationConfig {
    type: UIAnimationType;
    duration?: number;       // 持续时间（秒）
    delay?: number;          // 延迟（秒）
    ease?: EaseType;         // 缓动函数
    onStart?: () => void;    // 开始回调
    onComplete?: () => void; // 完成回调
}

// 默认配置
const DefaultAnimConfigs: Record<UIAnimationType, Partial<UIAnimationConfig>> = {
    [UIAnimationType.FadeIn]: { duration: 0.2, ease: 'linear' },
    [UIAnimationType.FadeOut]: { duration: 0.2, ease: 'linear' },
    [UIAnimationType.ScaleIn]: { duration: 0.25, ease: 'backOut' },
    [UIAnimationType.ScaleOut]: { duration: 0.2, ease: 'backIn' },
    [UIAnimationType.PopIn]: { duration: 0.3, ease: 'elasticOut' },
    [UIAnimationType.PopOut]: { duration: 0.2, ease: 'backIn' },
    // ...
};
```

## 6.3 动画控制器

```typescript
class UIAnimator {
    /**
     * 播放动画
     */
    static async play(
        target: Container,
        animation: UIAnimationType | UIAnimationConfig
    ): Promise<void> {
        const config = typeof animation === 'string'
            ? { type: animation, ...DefaultAnimConfigs[animation] }
            : { ...DefaultAnimConfigs[animation.type], ...animation };
        
        return new Promise((resolve) => {
            config.onComplete = () => {
                resolve();
            };
            
            this.executeAnimation(target, config);
        });
    }
    
    private static executeAnimation(target: Container, config: UIAnimationConfig): void {
        const { type, duration = 0.3, delay = 0, ease = 'linear' } = config;
        
        switch (type) {
            case UIAnimationType.FadeIn:
                target.alpha = 0;
                gsap.to(target, { alpha: 1, duration, delay, ease, onComplete: config.onComplete });
                break;
                
            case UIAnimationType.ScaleIn:
                target.scale.set(0);
                gsap.to(target.scale, { x: 1, y: 1, duration, delay, ease, onComplete: config.onComplete });
                break;
                
            case UIAnimationType.PopIn:
                target.scale.set(0);
                target.alpha = 0;
                gsap.to(target, { alpha: 1, duration: duration * 0.3, delay });
                gsap.to(target.scale, { x: 1, y: 1, duration, delay, ease: 'elastic.out(1, 0.5)', onComplete: config.onComplete });
                break;
                
            case UIAnimationType.SlideInRight:
                const startX = target.x + 300;
                target.x = startX;
                target.alpha = 0;
                gsap.to(target, { x: target.x - 300, alpha: 1, duration, delay, ease, onComplete: config.onComplete });
                break;
                
            case UIAnimationType.Shake:
                gsap.to(target, {
                    x: '+=10',
                    duration: 0.05,
                    repeat: 5,
                    yoyo: true,
                    ease: 'power1.inOut',
                    onComplete: config.onComplete
                });
                break;
                
            // ... 其他动画实现
        }
    }
    
    /**
     * 停止动画
     */
    static stop(target: Container): void {
        gsap.killTweensOf(target);
        gsap.killTweensOf(target.scale);
    }
}
```

---

# 七、事件系统

## 7.1 事件类型

```typescript
enum UIEventType {
    // 点击相关
    Click = 'click',
    DoubleClick = 'doubleClick',
    LongPress = 'longPress',
    
    // 触摸/鼠标
    PointerDown = 'pointerDown',
    PointerUp = 'pointerUp',
    PointerMove = 'pointerMove',
    PointerEnter = 'pointerEnter',
    PointerLeave = 'pointerLeave',
    
    // 拖拽
    DragStart = 'dragStart',
    Drag = 'drag',
    DragEnd = 'dragEnd',
    Drop = 'drop',
    
    // 焦点
    Focus = 'focus',
    Blur = 'blur',
    
    // 值变化
    ValueChange = 'valueChange',
    
    // 滚动
    Scroll = 'scroll',
    ScrollEnd = 'scrollEnd',
}
```

## 7.2 事件穿透控制

```typescript
enum UIBlockMode {
    /** 阻挡所有事件 */
    BlockAll = 'blockAll',
    
    /** 仅阻挡点击 */
    BlockClick = 'blockClick',
    
    /** 完全穿透 */
    Transparent = 'transparent',
}

class UIEventBlocker extends Container {
    mode: UIBlockMode = UIBlockMode.BlockAll;
    
    constructor() {
        super();
        this.interactive = true;
        
        this.on('pointerdown', (e) => {
            if (this.mode === UIBlockMode.BlockAll || this.mode === UIBlockMode.BlockClick) {
                e.stopPropagation();
            }
        });
    }
}
```

---

# 八、适配方案

## 8.1 适配策略

```typescript
enum UIScaleMode {
    /** 固定宽度，高度自适应 */
    FixedWidth = 'fixedWidth',
    
    /** 固定高度，宽度自适应 */
    FixedHeight = 'fixedHeight',
    
    /** 全部显示，可能有黑边 */
    ShowAll = 'showAll',
    
    /** 无黑边，可能裁剪 */
    NoBorder = 'noBorder',
    
    /** 扩展，充满屏幕 */
    Expand = 'expand',
}

class UIAdapter {
    private designWidth: number = 1920;
    private designHeight: number = 1080;
    private scaleMode: UIScaleMode = UIScaleMode.FixedHeight;
    
    /** 安全区边距 */
    safeArea = {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
    };
    
    /**
     * 计算适配参数
     */
    calculate(screenWidth: number, screenHeight: number): AdaptResult {
        const designRatio = this.designWidth / this.designHeight;
        const screenRatio = screenWidth / screenHeight;
        
        let scale: number;
        let offsetX = 0;
        let offsetY = 0;
        
        switch (this.scaleMode) {
            case UIScaleMode.FixedWidth:
                scale = screenWidth / this.designWidth;
                break;
                
            case UIScaleMode.FixedHeight:
                scale = screenHeight / this.designHeight;
                break;
                
            case UIScaleMode.ShowAll:
                scale = Math.min(
                    screenWidth / this.designWidth,
                    screenHeight / this.designHeight
                );
                offsetX = (screenWidth - this.designWidth * scale) / 2;
                offsetY = (screenHeight - this.designHeight * scale) / 2;
                break;
                
            case UIScaleMode.NoBorder:
                scale = Math.max(
                    screenWidth / this.designWidth,
                    screenHeight / this.designHeight
                );
                break;
                
            case UIScaleMode.Expand:
                return {
                    scaleX: screenWidth / this.designWidth,
                    scaleY: screenHeight / this.designHeight,
                    offsetX: 0,
                    offsetY: 0,
                };
        }
        
        return { scaleX: scale, scaleY: scale, offsetX, offsetY };
    }
    
    /**
     * 检测刘海屏安全区
     */
    detectSafeArea(): void {
        // iOS
        if (typeof window !== 'undefined' && 'visualViewport' in window) {
            const viewport = window.visualViewport!;
            this.safeArea.top = viewport.offsetTop;
            // ...
        }
        
        // Android
        // ...
    }
}
```

---

# 九、资源管理

## 9.1 资源加载

```typescript
class UIResourceManager {
    private cache: Map<string, any> = new Map();
    private loading: Map<string, Promise<any>> = new Map();
    private refCount: Map<string, number> = new Map();
    
    /**
     * 加载资源
     */
    async load<T>(path: string): Promise<T> {
        // 检查缓存
        if (this.cache.has(path)) {
            this.addRef(path);
            return this.cache.get(path);
        }
        
        // 检查是否正在加载
        if (this.loading.has(path)) {
            return this.loading.get(path);
        }
        
        // 开始加载
        const promise = this.doLoad<T>(path);
        this.loading.set(path, promise);
        
        try {
            const asset = await promise;
            this.cache.set(path, asset);
            this.addRef(path);
            return asset;
        } finally {
            this.loading.delete(path);
        }
    }
    
    /**
     * 释放资源
     */
    release(path: string): void {
        const count = this.refCount.get(path) || 0;
        if (count <= 1) {
            this.cache.delete(path);
            this.refCount.delete(path);
        } else {
            this.refCount.set(path, count - 1);
        }
    }
    
    private addRef(path: string): void {
        const count = this.refCount.get(path) || 0;
        this.refCount.set(path, count + 1);
    }
    
    private async doLoad<T>(path: string): Promise<T> {
        // 实际加载逻辑
        return await Assets.load(path);
    }
}
```

## 9.2 预加载策略

```typescript
class UIPreloader {
    /**
     * 预加载指定面板
     */
    async preloadPanels(names: string[]): Promise<void> {
        const tasks = names.map(name => {
            const config = UIPanelRegistry[name];
            if (config) {
                return UIResourceManager.load(config.path);
            }
            return Promise.resolve();
        });
        
        await Promise.all(tasks);
    }
    
    /**
     * 预加载场景UI
     */
    async preloadForScene(scene: string): Promise<void> {
        const panelNames = SceneUIConfig[scene] || [];
        await this.preloadPanels(panelNames);
    }
}

// 场景UI配置
const SceneUIConfig: Record<string, string[]> = {
    'MainScene': ['MainHUD', 'BagPanel', 'ShopPanel', 'SettingPanel'],
    'BattleScene': ['BattleHUD', 'PausePanel', 'ResultPanel'],
};
```

---

# 十、调试工具

## 10.1 调用追踪

```typescript
class UIDebugger {
    private static enabled: boolean = true;
    private static logs: UIDebugLog[] = [];
    
    /**
     * 追踪UI操作
     */
    static trace(action: string, panel: string, data?: any): void {
        if (!this.enabled) return;
        
        const log: UIDebugLog = {
            time: Date.now(),
            action,
            panel,
            data,
            stack: new Error().stack,
        };
        
        this.logs.push(log);
        
        console.log(`[UI][${this.formatTime(log.time)}] ${action}: ${panel}`, data || '');
    }
    
    /**
     * 获取面板调用历史
     */
    static getHistory(panel?: string): UIDebugLog[] {
        if (panel) {
            return this.logs.filter(log => log.panel === panel);
        }
        return [...this.logs];
    }
    
    /**
     * 打印当前UI状态
     */
    static printState(): void {
        console.group('[UI] 当前状态');
        
        UI['openedPanels'].forEach((panel, name) => {
            console.log(`${name}: ${panel.state} (layer: ${panel.config.layer})`);
        });
        
        console.groupEnd();
    }
    
    private static formatTime(timestamp: number): string {
        const date = new Date(timestamp);
        return `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
    }
}
```

## 10.2 可视化工具

```typescript
class UIInspector {
    private overlay: Container;
    private enabled: boolean = false;
    
    /**
     * 显示点击区域
     */
    showHitAreas(): void {
        // 遍历所有可交互节点，绘制边框
    }
    
    /**
     * 显示层级信息
     */
    showLayerInfo(): void {
        // 在每个面板上显示层级和名称
    }
    
    /**
     * 节点拾取
     */
    enablePicker(): void {
        // 点击节点显示其属性
    }
    
    /**
     * 性能监控
     */
    showPerformance(): void {
        // 显示DrawCall、节点数等
    }
}
```

---

# 十一、API参考

## 11.1 UI 全局接口

```typescript
// 打开面板
const panel = await UI.open('BagPanel', { tabIndex: 0 });

// 关闭面板
await UI.close('BagPanel');

// 强制关闭（跳过动画）
UI.forceClose('BagPanel');

// 关闭所有（保留固定面板）
await UI.closeAll();

// 获取面板
const bag = UI.getPanel<BagPanel>('BagPanel');

// 判断是否打开
if (UI.isOpened('BagPanel')) { }

// 显示对话框
const confirmed = await UI.dialog({
    title: '提示',
    content: '确定删除该道具？',
    buttons: ['确定', '取消'],
});

// 显示Toast
UI.toast('获得道具 x1');
UI.toast('操作成功', 3000);

// Loading
await UI.showLoading('加载中...');
await UI.hideLoading();

// 预加载
await UI.preload(['BagPanel', 'ShopPanel']);

// 层级控制
UI.layer.lockLayer(UILayer.Main);
UI.layer.unlockLayer(UILayer.Main);
UI.layer.bringToFront(panel);
```

## 11.2 面板生命周期

```typescript
class MyPanel extends UIPanel {
    // 创建时（仅一次）
    onCreate(): void {
        this.initUI();
        this.bindEvents();
    }
    
    // 显示前（每次）
    onBeforeShow(data?: any): void {
        this.loadData(data);
    }
    
    // 显示后
    onShow(data?: any): void {
        this.playEntryAnimation();
    }
    
    // 刷新
    onRefresh(data?: any): void {
        this.updateUI(data);
    }
    
    // 隐藏前
    onBeforeHide(): void {
        this.saveState();
    }
    
    // 隐藏后
    onHide(): void {
        this.clearTempData();
    }
    
    // 销毁时
    onDestroy(): void {
        this.unbindEvents();
        this.releaseResources();
    }
}
```

---

# 十二、最佳实践

## 12.1 问题预防清单

| 问题 | 预防措施 |
|-----|---------|
| 层级混乱 | 使用固定层级 + 层内自动排序 |
| 重复打开 | 单例检测 + 加载状态检测 |
| 调用未就绪面板 | 状态机 + Promise化 |
| 调用已销毁面板 | 状态检查 + 空方法替换 |
| 事件泄漏 | 自动清理事件监听 |
| 定时器泄漏 | 自动清理定时器 |
| 点击穿透 | 遮罩管理器 |
| 数据不同步 | 数据绑定 |

## 12.2 性能优化

```typescript
// 1. 使用对象池
const item = UI.pool.get('ItemCell');
// 使用后
UI.pool.put('ItemCell', item);

// 2. 虚拟列表
<UIList itemSize={100} direction="vertical" />

// 3. 按需加载
UI.open('HeavyPanel'); // 首次打开时加载

// 4. 预加载关键面板
UI.preload(['BagPanel', 'ShopPanel']);

// 5. 合理使用缓存
{
    cache: true,  // 频繁打开的面板
    cache: false, // 只打开一次的面板
}
```

## 12.3 开发规范

1. **面板注册**：所有面板必须在 `UIPanelRegistry` 注册
2. **状态检查**：操作前检查面板状态
3. **事件清理**：`onDestroy` 中清理所有事件和定时器
4. **数据绑定**：优先使用绑定而非手动刷新
5. **动画配置**：使用配置而非硬编码动画
6. **错误处理**：设置 `UI.onError` 处理异常

---

*文档版本: 1.0*  
*创建日期: 2026-02*
