---
title: Calendar 日历应用 - 系统架构设计
date: 2026-01-26
updated: 2026-01-26
categories:
  - 项目
tags:
  - Android
  - Calendar
  - 架构设计
  - MVVM
series: Calendar日历应用
mermaid: true
---

## 一、架构概述

本项目使用 **MVVM (Model-View-ViewModel)** 架构，结合 **Repository 模式** 进行数据管理，将 UI 与业务逻辑分离。

{% note info flat %}
**架构优势**
- **View** - 显示界面、响应用户点击（后厨，负责准备食材和做菜）
- **ViewModel** - 持有数据、处理业务逻辑（餐桌和餐具，顾客直接接触的部分）
- **Model** - 获取数据库（服务员，从后厨取菜端给顾客，把顾客的需求传达给后厨）
{% endnote %}

---

## 二、架构图

![高层架构图](https://raw.githubusercontent.com/surpasslike/Calendar/main/docs/images/03-high-level-architecture-diagram.png)

---

## 三、分层设计

{% tabs layers %}
<!-- tab View 界面层 -->
**职责**：负责 UI 展示和用户交互

| 组件 | 说明 |
|:-----|:-----|
| CalendarFragment | 日历主界面，展示月历和当日事件/习惯 |
| ScheduleFragment | 日程编辑界面，处理事件的增删改 |
| HabitFragment | 习惯编辑界面，处理习惯的增删改 |
| Adapter | RecyclerView 适配器，负责列表数据绑定 |
| Dialog | 对话框组件，用于确认操作等交互 |

**特点**：
- 只负责展示，不直接处理底层的数据
- 通过观察 ViewModel 的 LiveData 获取数据
- 通过调用 ViewModel 方法处理底层数据
<!-- endtab -->

<!-- tab ViewModel 逻辑层 -->
**职责**：处理 UI 相关的业务逻辑，管理 UI 状态

| 组件 | 说明 |
|:-----|:-----|
| CalendarViewModel | 处理日历显示、日期选择、当日数据加载 |
| ScheduleViewModel | 处理日程的增删改操作 |
| HabitViewModel | 处理习惯的增删改和打卡操作 |

**特点**：
- 持有 UI 状态的 LiveData，供 View 层观察
- 调用 Repository get或set数据
- 配置变更时保留数据
<!-- endtab -->

<!-- tab Repository 仓库层 -->
**职责**：管理数据访问，作为 ViewModel 和 Data 层的桥梁

| 组件 | 说明 |
|:-----|:-----|
| ScheduleRepository | 封装日程相关数据操作（增删改查） |
| HabitRepository | 封装习惯相关数据操作（增删改查、打卡记录） |

**特点**：
- 单一职责，每个 Repository 只负责一个领域
<!-- endtab -->

<!-- tab Data 数据层 -->
**职责**：数据持久化存储

| 组件 | 说明 |
|:-----|:-----|
| AppDatabase | Room 数据库实例，单例模式 |
| ScheduleDao | 日程数据访问对象 |
| HabitDao | 习惯数据访问对象 |
| HabitRecordDao | 打卡记录数据访问对象 |
| Schedule | 日程实体类 |
| Habit | 习惯实体类 |
| HabitRecord | 打卡记录实体类 |

**特点**：
- 使用 Room 进行 ORM 映射
- DAO 提供数据库操作方法
- Entity 定义数据表结构
- HabitRecord（打卡记录）是 Habit（习惯）的附属数据
<!-- endtab -->
{% endtabs %}

---

## 四、目录结构（根据代码实时更新）

```
com/surpasslike/calendar/
│
├── MyApplication.kt             # Application 全局入口
├── MainActivity.kt              # 应用入口 Activity
│
├── base/                        # 基类
│   ├── BaseFragment.kt          # Fragment 通用基类
│   └── BaseViewModel.kt         # ViewModel 通用基类
│
├── data/                        # 数据层
│   ├── dao/                     # 数据访问对象
│   │   ├── ScheduleDao.kt       # 日程 DAO
│   │   ├── HabitDao.kt          # 习惯 DAO
│   │   └── HabitRecordDao.kt    # 打卡记录 DAO
│   ├── entity/                  # 实体类
│   │   ├── Schedule.kt          # 日程实体
│   │   ├── Habit.kt             # 习惯实体
│   │   └── HabitRecord.kt       # 打卡记录实体
│   └── database/                # 数据库
│       └── AppDatabase.kt       # Room 数据库实例
│
├── repository/                  # 仓库层
│   ├── ScheduleRepository.kt    # 日程数据访问管理
│   └── HabitRepository.kt       # 习惯数据访问管理
│
├── viewmodel/                   # ViewModel 逻辑层
│   ├── CalendarViewModel.kt     # 日历和列表逻辑
│   ├── ScheduleViewModel.kt     # 日程增删改
│   └── HabitViewModel.kt        # 习惯增删改
│
├── view/                        # View 界面层
│   ├── fragment/                # Fragment
│   │   ├── CalendarFragment.kt  # 日历主界面
│   │   ├── ScheduleFragment.kt  # 日程编辑界面
│   │   └── HabitFragment.kt     # 习惯编辑界面
│   ├── adapter/                 # RecyclerView 适配器
│   │   ├── ScheduleAdapter.kt   # 日程列表适配器
│   │   └── HabitAdapter.kt      # 习惯列表适配器
│   └── dialog/                  # 对话框组件
│       └── ConfirmDialog.kt     # 确认对话框
│
├── notification/                # 通知模块
│
└── utils/                       # 工具类
    └── DateUtils.kt             # 日期格式化等工具
```

---

## 五、数据流

### 5.1 数据流向图

<img src="https://raw.githubusercontent.com/surpasslike/Calendar/main/docs/images/04-mvvm-data-stream.png" alt="数据流向图" width="40%">

### 5.2 数据流举例

{% note primary flat %}
**添加日程**
1. 用户在 `ScheduleFragment` 填写日程信息并点击保存
2. `ScheduleFragment` 调用 `ScheduleViewModel.addSchedule()`
3. `ScheduleViewModel` 调用 `ScheduleRepository.insert()`
4. `ScheduleRepository` 调用 `ScheduleDao.insert()`
5. 数据保存到 Room 数据库
6. LiveData 自动通知 UI 更新
{% endnote %}

---

## 六、关键设计点

| 决策 | 说明 |
|:-----|:-----|
| 单 Activity 多 Fragment | 使用 Navigation 组件管理 Fragment 导航，减少 Activity 开销 |
| Repository 单例 | 保证数据访问的一致性 |
| LiveData数据容器 | 自动感知生命周期，只在页面可见时更新 |
| 拆分 Repository | ScheduleRepository 和 HabitRepository 只负责各自领域，方便单独测试 |
| 代码开发顺序 | Entity → Dao → Database → Repository → ViewModel → UI |

## 上一篇

[Calendar 日历应用 - 项目概述与需求分析](/calendar-01-requirements/)

<!-- ## 下一篇 -->

<!-- [Calendar 日历应用 - 数据库设计](/calendar-03-database/) -->
