# 事件系统 (Event System) 功能文档

本文档详细说明事件系统的核心功能、设计模式、各游戏类型的应用场景和典型示例。

---

## 目录

1. [系统概述](#一系统概述)
2. [核心功能模块](#二核心功能模块)
3. [事件类型设计](#三事件类型设计)
4. [高级功能](#四高级功能)
5. [各类型游戏应用](#五各类型游戏应用)
6. [最佳实践](#六最佳实践)
7. [功能速查表](#七功能速查表)

---

# 一、系统概述

## 什么是事件系统

事件系统是游戏中实现模块间通信的核心机制，采用发布/订阅模式，让不同系统之间解耦合。当某个事件发生时，所有订阅该事件的监听器都会收到通知并执行相应逻辑。

## 为什么需要事件系统

| 问题 | 传统方式 | 事件系统方式 |
|------|---------|-------------|
| 玩家受伤时更新UI | UI系统直接引用玩家系统 | 玩家系统发送"受伤"事件，UI订阅并响应 |
| 敌人死亡时加分 | 敌人直接调用分数系统 | 敌人发送"死亡"事件，分数系统订阅 |
| 成就检测 | 成就系统轮询所有状态 | 各系统发送事件，成就系统监听 |

**优势**：
- 系统间解耦，降低依赖
- 易于扩展新功能
- 便于调试和追踪
- 支持异步和延迟处理

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    事件总线 (Event Bus)                       │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ 事件注册表  │  │  事件队列   │  │  监听器池   │         │
│  │ (Registry)  │  │  (Queue)    │  │ (Listeners) │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   发布者                    订阅者                          │
│  ┌─────────┐              ┌─────────┐                      │
│  │ 战斗系统 │──emit──────▶│ UI系统  │                      │
│  │ 任务系统 │──emit──────▶│ 音频系统│                      │
│  │ 玩家系统 │──emit──────▶│ 成就系统│                      │
│  └─────────┘              └─────────┘                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 适用范围

| 游戏类型 | 核心需求 |
|---------|---------|
| **所有类型** | 基础事件通信 |
| **RPG** | 战斗事件、任务事件、对话事件 |
| **动作游戏** | 伤害事件、击杀事件、技能事件 |
| **策略游戏** | 资源变化、建造完成、战斗结果 |
| **多人游戏** | 网络事件、同步事件 |

---

# 二、核心功能模块

## 1. 事件订阅 (Subscribe / On)

**功能说明**：注册一个监听器，当指定事件触发时执行回调函数。

| 功能 | 说明 |
|------|------|
| 基础订阅 | 监听指定事件 |
| 多事件订阅 | 一个监听器监听多个事件 |
| 带上下文订阅 | 绑定 this 上下文 |
| 条件订阅 | 满足条件才响应 |

**示例**：

> **UI 监听血量变化**：UI系统订阅"player:health_changed"事件。当玩家血量变化时，更新血条显示。
>
> **音效监听攻击**：音频系统订阅"combat:attack"事件。当任何攻击发生时，播放对应音效。
>
> **成就监听击杀**：成就系统订阅"enemy:killed"事件。当敌人被击杀时，更新击杀计数，检查是否达成"击杀100敌人"成就。

---

## 2. 事件发布 (Publish / Emit)

**功能说明**：触发一个事件，通知所有订阅该事件的监听器。

| 功能 | 说明 |
|------|------|
| 同步发布 | 立即执行所有监听器 |
| 异步发布 | 将事件加入队列，稍后处理 |
| 带数据发布 | 携带事件数据 |
| 广播发布 | 向所有监听器广播 |

**示例**：

> **玩家受伤**：玩家系统发布"player:damaged"事件，携带数据 `{ damage: 50, source: 'enemy_sword', currentHP: 150 }`。
>
> **任务完成**：任务系统发布"quest:completed"事件，携带数据 `{ questId: 'main_001', rewards: [...] }`。
>
> **关卡开始**：关卡管理器发布"level:started"事件，携带数据 `{ levelId: 5, difficulty: 'hard' }`。

---

## 3. 取消订阅 (Unsubscribe / Off)

**功能说明**：移除之前注册的监听器，停止接收事件。

| 功能 | 说明 |
|------|------|
| 移除特定监听 | 移除指定回调函数 |
| 移除所有监听 | 移除某事件的所有监听器 |
| 按上下文移除 | 移除某对象的所有监听 |
| 自动移除 | 对象销毁时自动移除 |

**示例**：

> **场景切换时清理**：游戏场景销毁时，移除该场景注册的所有事件监听器，避免内存泄漏和错误调用。
>
> **技能结束时清理**：技能效果结束时，移除该技能注册的监听器（如"受到伤害时反弹"效果）。
>
> **UI关闭时清理**：血条UI关闭时，取消对"player:health_changed"的订阅。

---

## 4. 一次性订阅 (Once)

**功能说明**：监听器只响应一次事件，之后自动移除。

**示例**：

> **首次击杀奖励**：订阅"boss:killed"事件，使用 once。第一次击杀Boss时发放特殊奖励，之后不再触发。
>
> **教程触发**：订阅"player:first_attack"事件。玩家首次攻击时显示教程提示，只触发一次。
>
> **加载完成回调**：订阅"scene:loaded"事件。场景加载完成后执行初始化，只需要执行一次。

---

## 5. 事件优先级

**功能说明**：多个监听器订阅同一事件时，按优先级顺序执行。

| 优先级 | 说明 | 示例 |
|--------|------|------|
| 最高 | 最先执行 | 伤害计算、数值修改 |
| 高 | 较早执行 | 战斗逻辑处理 |
| 普通 | 正常顺序 | 一般功能 |
| 低 | 较晚执行 | UI更新 |
| 最低 | 最后执行 | 日志记录、统计 |

**示例**：

> **伤害处理流程**：
> 1. 最高优先级：护盾系统吸收部分伤害
> 2. 高优先级：防御计算减免伤害
> 3. 普通优先级：实际扣血
> 4. 低优先级：UI更新血条
> 5. 最低优先级：记录战斗日志

---

## 6. 事件阻止/取消

**功能说明**：监听器可以阻止事件继续传播，后续监听器不会收到通知。

**示例**：

> **无敌状态**：玩家处于无敌状态，高优先级监听器检测到后阻止"player:damaged"事件继续传播，玩家不会扣血，UI也不会显示受伤效果。
>
> **技能免疫**：某技能使玩家免疫控制效果。当"player:stunned"事件触发时，技能系统的监听器阻止事件，玩家不会进入眩晕状态。
>
> **装备效果**：装备"格挡护符"有30%概率阻止伤害事件，完全免除此次伤害。

---

# 三、事件类型设计

## 1. 事件命名规范

| 格式 | 说明 | 示例 |
|------|------|------|
| 系统:动作 | 标准格式 | player:damaged, enemy:killed |
| 系统:对象:动作 | 详细格式 | inventory:item:added |
| 动作 | 简单格式（全局事件） | pause, resume |

**推荐命名**：
- 使用小写字母和下划线
- 使用动词过去式表示已发生（damaged, killed）
- 使用动词现在式表示正在进行（attacking, moving）
- 使用名词表示状态变化（health_changed, level_up）

---

## 2. 常用事件分类

### 玩家事件
| 事件 | 数据 | 说明 |
|------|------|------|
| player:spawned | {x, y, character} | 玩家生成 |
| player:damaged | {damage, source, currentHP} | 玩家受伤 |
| player:healed | {amount, source, currentHP} | 玩家治疗 |
| player:died | {killer, position} | 玩家死亡 |
| player:respawned | {x, y} | 玩家重生 |
| player:level_up | {newLevel, stats} | 玩家升级 |
| player:exp_gained | {amount, source} | 获得经验 |

### 战斗事件
| 事件 | 数据 | 说明 |
|------|------|------|
| combat:attack | {attacker, target, damage, type} | 攻击发生 |
| combat:hit | {attacker, target, damage, critical} | 命中目标 |
| combat:miss | {attacker, target} | 攻击未命中 |
| combat:block | {blocker, attacker, damage} | 格挡攻击 |
| combat:dodge | {dodger, attacker} | 闪避攻击 |
| combat:critical | {attacker, target, damage} | 暴击 |
| combat:kill | {killer, victim, weapon} | 击杀 |

### 敌人事件
| 事件 | 数据 | 说明 |
|------|------|------|
| enemy:spawned | {id, type, x, y} | 敌人生成 |
| enemy:damaged | {id, damage, attacker} | 敌人受伤 |
| enemy:killed | {id, killer, drops} | 敌人死亡 |
| enemy:alert | {id, target} | 敌人警觉 |
| enemy:lost_target | {id} | 敌人丢失目标 |

### 物品事件
| 事件 | 数据 | 说明 |
|------|------|------|
| item:picked | {itemId, amount} | 拾取物品 |
| item:dropped | {itemId, amount, x, y} | 丢弃物品 |
| item:used | {itemId, effect} | 使用物品 |
| item:equipped | {itemId, slot} | 装备物品 |
| item:unequipped | {itemId, slot} | 卸下装备 |

### 任务事件
| 事件 | 数据 | 说明 |
|------|------|------|
| quest:accepted | {questId} | 接受任务 |
| quest:progress | {questId, objective, current, target} | 任务进度 |
| quest:completed | {questId, rewards} | 完成任务 |
| quest:failed | {questId, reason} | 任务失败 |
| quest:abandoned | {questId} | 放弃任务 |

### 系统事件
| 事件 | 数据 | 说明 |
|------|------|------|
| game:started | {} | 游戏开始 |
| game:paused | {} | 游戏暂停 |
| game:resumed | {} | 游戏恢复 |
| game:saved | {slot} | 游戏存档 |
| game:loaded | {slot} | 游戏读档 |
| scene:loaded | {sceneKey} | 场景加载完成 |
| scene:unloaded | {sceneKey} | 场景卸载 |

### UI事件
| 事件 | 数据 | 说明 |
|------|------|------|
| ui:opened | {panelId} | 界面打开 |
| ui:closed | {panelId} | 界面关闭 |
| ui:button_clicked | {buttonId} | 按钮点击 |
| ui:dialog_confirmed | {dialogId, choice} | 对话框确认 |

### 音频事件
| 事件 | 数据 | 说明 |
|------|------|------|
| audio:bgm_play | {track} | 播放背景音乐 |
| audio:bgm_stop | {} | 停止背景音乐 |
| audio:sfx_play | {sound, position} | 播放音效 |
| audio:volume_changed | {type, value} | 音量调整 |

---

## 3. 事件数据设计原则

**必要信息**：事件数据应包含处理事件所需的所有信息，避免监听器需要额外查询。

**不可变性**：事件数据应该是只读的，监听器不应修改事件数据。

**简洁性**：只包含必要信息，避免传递过大的对象。

**示例对比**：

> **不好的设计**：
> ```
> event: player:damaged
> data: { playerId: 1 }  // 监听器需要额外查询玩家当前血量
> ```
>
> **好的设计**：
> ```
> event: player:damaged
> data: { 
>   damage: 50, 
>   source: 'enemy_sword',
>   currentHP: 150,
>   maxHP: 200,
>   isDead: false
> }
> ```

---

# 四、高级功能

## 1. 延迟事件

**功能说明**：事件在指定时间后触发，而非立即触发。

| 功能 | 说明 |
|------|------|
| 延迟发布 | 指定毫秒后触发事件 |
| 取消延迟 | 在触发前取消 |
| 帧延迟 | 在下一帧触发 |

**示例**：

> **延迟爆炸**：炸弹被放置后，3秒后发布"bomb:exploded"事件。玩家可以在3秒内拆除炸弹取消事件。
>
> **复活倒计时**：玩家死亡后，5秒后自动发布"player:respawn"事件。
>
> **效果延迟**：中毒效果每2秒发布一次"player:poison_tick"事件，造成持续伤害。

---

## 2. 事件队列

**功能说明**：事件进入队列，按顺序或在特定时机统一处理。

| 功能 | 说明 |
|------|------|
| 入队 | 事件加入队列而非立即触发 |
| 批量处理 | 在帧末或指定时机统一处理 |
| 队列优先级 | 高优先级事件先处理 |
| 队列清空 | 清空未处理的事件 |

**示例**：

> **战斗事件队列**：一帧内可能发生多次伤害，所有伤害事件先入队。帧末统一处理，计算最终伤害并只触发一次UI更新。
>
> **网络事件队列**：网络消息到达后入队，在主线程的固定时机处理，避免多线程问题。

---

## 3. 事件过滤

**功能说明**：只对满足特定条件的事件做出响应。

**示例**：

> **只监听玩家攻击**：订阅"combat:attack"事件，但只响应 attacker.type === 'player' 的事件。
>
> **只监听大额伤害**：订阅"player:damaged"事件，但只响应 damage > 100 的事件（用于触发重伤特效）。
>
> **只监听特定敌人**：订阅"enemy:killed"事件，但只响应 type === 'boss' 的事件（用于Boss击杀成就）。

---

## 4. 事件历史/日志

**功能说明**：记录所有触发的事件，用于调试和回放。

| 功能 | 说明 |
|------|------|
| 事件记录 | 记录事件名、数据、时间戳 |
| 历史查询 | 查询最近N条事件 |
| 按类型筛选 | 只查看特定类型事件 |
| 导出日志 | 导出事件日志用于分析 |

**示例**：

> **战斗回放**：记录所有战斗相关事件，战斗结束后可以回放查看整个战斗过程。
>
> **Bug追踪**：玩家报告Bug时，导出最近的事件日志，帮助开发者定位问题。
>
> **数据分析**：统计"item:used"事件，分析玩家最常使用的道具。

---

## 5. 事件聚合

**功能说明**：将多个小事件聚合成一个大事件。

**示例**：

> **连击统计**：连续收到多个"combat:hit"事件，聚合后发布"combat:combo"事件，携带连击数。
>
> **批量拾取**：短时间内连续拾取多个物品，聚合后发布一次"item:batch_picked"事件，减少UI刷新次数。

---

## 6. 事件命名空间

**功能说明**：使用命名空间组织事件，便于批量管理。

**示例**：

> **战斗命名空间**：所有战斗相关事件使用 combat: 前缀。场景切换时可以一键移除所有 combat: 监听器。
>
> **UI命名空间**：所有UI事件使用 ui: 前缀。切换到无UI的过场动画时，暂停所有 ui: 事件的处理。

---

# 五、各类型游戏应用

## 1. RPG游戏

### 核心事件
```
玩家系统
├── player:damaged → UI更新、音效、相机震动、成就检测
├── player:healed → UI更新、音效、特效
├── player:level_up → UI弹窗、音效、属性更新、解锁检测
├── player:died → 死亡界面、音效、存档提示
└── player:exp_gained → UI更新、升级检测

战斗系统
├── combat:attack → 音效、特效
├── combat:critical → 特殊音效、特殊特效、飘字
├── combat:kill → 经验发放、掉落生成、成就检测
└── combat:skill_used → 技能特效、消耗扣除、冷却开始

任务系统
├── quest:accepted → UI更新、导航标记
├── quest:progress → UI更新、提示音
├── quest:completed → 奖励发放、UI弹窗、音效、成就检测
└── quest:unlocked → 通知显示、NPC标记更新
```

### 典型应用

> **升级流程**：
> 1. 玩家获得经验，发布"player:exp_gained"
> 2. 经验系统检测达到升级条件，发布"player:level_up"
> 3. 属性系统监听，增加玩家属性
> 4. UI系统监听，显示升级弹窗和特效
> 5. 音频系统监听，播放升级音效
> 6. 技能系统监听，检查是否解锁新技能
> 7. 成就系统监听，检查等级相关成就

---

## 2. 动作游戏

### 核心事件
```
战斗系统
├── combat:hit → 受击硬直、伤害数字、音效、特效
├── combat:perfect_dodge → 子弹时间、特殊音效
├── combat:parry → 弹反特效、敌人硬直
├── combat:combo → 连击数显示、连击加成
└── combat:finisher → 处决动画、特写镜头

角色状态
├── player:stamina_changed → 体力条更新
├── player:invincible_start → 无敌特效
├── player:invincible_end → 特效结束
└── player:stance_changed → 姿态切换动画
```

### 典型应用

> **连击系统**：
> 1. 每次命中发布"combat:hit"事件
> 2. 连击系统监听，更新连击计数器
> 3. 连击达到阈值（10连、50连、100连），发布"combat:combo_milestone"
> 4. UI系统显示连击里程碑特效
> 5. 加成系统增加伤害加成
> 6. 若一定时间无命中，发布"combat:combo_break"，连击重置

---

## 3. 策略游戏

### 核心事件
```
资源系统
├── resource:changed → UI更新
├── resource:insufficient → 提示音、UI提示
└── resource:production → 飘字显示

建造系统
├── building:placed → 资源扣除、建造开始
├── building:progress → 进度条更新
├── building:completed → 功能启用、成就检测
└── building:destroyed → 资源回收、功能禁用

战斗系统
├── unit:selected → UI更新、语音
├── unit:ordered → 移动反馈
├── unit:attacked → 血条显示
├── unit:killed → 经验分配、尸体处理
└── battle:ended → 结算界面、统计数据
```

### 典型应用

> **建筑建造**：
> 1. 玩家下达建造指令，发布"building:ordered"
> 2. 资源系统检查是否足够，不足则发布"resource:insufficient"并阻止
> 3. 资源足够，扣除资源，发布"building:placed"
> 4. 建造过程中定期发布"building:progress"
> 5. 建造完成，发布"building:completed"
> 6. 各系统响应：解锁生产、更新科技、检测成就

---

## 4. 多人游戏

### 核心事件
```
网络系统
├── network:connected → 登录流程
├── network:disconnected → 重连提示
├── network:latency_high → 延迟警告
└── network:sync → 状态同步

匹配系统
├── match:searching → 匹配动画
├── match:found → 匹配成功提示
├── match:cancelled → 取消匹配
└── match:started → 进入战斗

对战系统
├── player:joined → 玩家列表更新
├── player:left → 玩家离开提示
├── team:score → 计分板更新
└── match:ended → 结算界面
```

### 典型应用

> **网络状态处理**：
> 1. 网络断开，发布"network:disconnected"
> 2. 游戏逻辑暂停，弹出重连界面
> 3. 自动尝试重连，发布"network:reconnecting"
> 4. 重连成功，发布"network:reconnected"
> 5. 请求服务器同步状态，发布"network:sync"
> 6. 状态同步完成，恢复游戏

---

## 5. 休闲/三消游戏

### 核心事件
```
游戏逻辑
├── match:made → 消除动画、音效
├── match:combo → 连消特效、加分
├── special:created → 特殊块生成动画
├── special:triggered → 特殊效果
└── board:settled → 检测新消除

进度系统
├── score:changed → 分数显示更新
├── moves:changed → 步数显示更新
├── objective:progress → 目标进度更新
├── objective:completed → 目标完成特效
└── level:completed → 结算流程
```

### 典型应用

> **连消处理**：
> 1. 玩家交换宝石，发布"swap:made"
> 2. 检测到消除，发布"match:made"，携带消除信息
> 3. 分数系统监听，计算并更新分数
> 4. 动画系统监听，播放消除动画
> 5. 宝石下落填充，发布"board:filled"
> 6. 再次检测消除，若有则发布"match:combo"，连消计数+1
> 7. 无新消除，发布"board:settled"，玩家可继续操作

---

## 6. 开放世界游戏

### 核心事件
```
探索系统
├── area:entered → 区域名称显示、BGM切换
├── area:discovered → 地图解锁、经验奖励
├── poi:discovered → 标记添加、日志更新
└── fast_travel:unlocked → 传送点激活

交互系统
├── npc:interacted → 对话开始
├── object:examined → 物品描述
├── chest:opened → 开箱动画、物品获取
└── switch:activated → 机关触发

天气/时间
├── time:changed → 光照调整、NPC行为变化
├── weather:changed → 天气效果、音效
└── day:passed → 刷新每日内容
```

### 典型应用

> **区域切换**：
> 1. 玩家进入新区域，发布"area:entered"
> 2. UI系统显示区域名称
> 3. 音频系统切换背景音乐
> 4. 天气系统可能切换天气
> 5. 敌人生成系统根据区域调整敌人配置
> 6. 若是首次进入，发布"area:discovered"
> 7. 地图系统解锁该区域的迷雾

---

# 六、最佳实践

## 1. 事件设计原则

| 原则 | 说明 |
|------|------|
| 单一职责 | 每个事件只描述一件事 |
| 语义清晰 | 事件名能清楚表达含义 |
| 数据完整 | 携带足够信息，减少额外查询 |
| 避免循环 | 防止事件A触发事件B又触发事件A |

---

## 2. 性能优化

| 优化 | 说明 |
|------|------|
| 减少高频事件 | 每帧发生的事件考虑合并 |
| 延迟批处理 | 多个同类事件合并处理 |
| 懒注册 | 只在需要时注册监听器 |
| 及时清理 | 对象销毁时移除监听器 |

**示例**：

> **不好的做法**：每帧发布"player:position_changed"事件。
>
> **好的做法**：只在位置实际变化时发布，或仅在进入/离开某区域时发布"area:entered"。

---

## 3. 调试技巧

| 技巧 | 说明 |
|------|------|
| 事件日志 | 开发时记录所有事件 |
| 断点监听 | 对特定事件添加调试断点 |
| 事件可视化 | UI显示最近触发的事件 |
| 模拟发送 | 调试面板手动触发事件 |

---

## 4. 常见错误

| 错误 | 说明 | 解决方案 |
|------|------|---------|
| 内存泄漏 | 对象销毁后监听器未移除 | 在 destroy() 中取消所有订阅 |
| 重复注册 | 同一监听器注册多次 | 使用标记避免重复注册 |
| 循环触发 | 事件处理中触发相同事件 | 添加防重入标记 |
| 空引用 | 监听器引用的对象已销毁 | 使用弱引用或检查有效性 |
| 顺序依赖 | 依赖监听器执行顺序 | 使用优先级或分阶段处理 |

---

# 七、功能速查表

## 事件总线方法

| 方法 | 说明 | 参数 |
|------|------|------|
| on | 订阅事件 | 事件名, 回调, 上下文?, 优先级? |
| once | 一次性订阅 | 事件名, 回调, 上下文? |
| off | 取消订阅 | 事件名, 回调?, 上下文? |
| emit | 发布事件 | 事件名, 数据? |
| emitAsync | 异步发布 | 事件名, 数据? |
| emitDelayed | 延迟发布 | 事件名, 数据, 延迟ms |
| has | 检查是否有监听器 | 事件名 |
| clear | 清空所有监听器 | 事件名? |

## 事件优先级

| 优先级 | 值 | 用途 |
|--------|-----|------|
| HIGHEST | 100 | 数值计算、伤害修改 |
| HIGH | 75 | 核心逻辑处理 |
| NORMAL | 50 | 一般功能 |
| LOW | 25 | UI更新 |
| LOWEST | 0 | 日志记录、统计 |

## 常用事件速查

| 分类 | 事件前缀 | 示例 |
|------|---------|------|
| 玩家 | player: | player:damaged, player:level_up |
| 敌人 | enemy: | enemy:spawned, enemy:killed |
| 战斗 | combat: | combat:hit, combat:critical |
| 物品 | item: | item:picked, item:used |
| 任务 | quest: | quest:completed, quest:progress |
| UI | ui: | ui:opened, ui:button_clicked |
| 系统 | game: | game:paused, game:saved |
| 场景 | scene: | scene:loaded, scene:unloaded |
| 音频 | audio: | audio:bgm_play, audio:sfx_play |
| 网络 | network: | network:connected, network:sync |

---

*文档版本: 1.0*  
*创建日期: 2026-02*
