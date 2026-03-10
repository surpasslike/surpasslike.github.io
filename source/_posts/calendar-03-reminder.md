---
title: Calendar 日历应用 - 日程提醒通知功能
date: 2026-03-10
updated: 2026-03-10
categories:
  - 项目
tags:
  - Android
  - Calendar
  - 通知提醒
  - AlarmManager
series: Calendar日历应用
mermaid: true
---

## 一、功能概述

日程提醒功能让用户在创建日程时设置提前提醒时间（5/15/30/60 分钟），到达指定时间后通过系统通知栏提醒用户。

{% note info flat %}
**核心能力**
- **精准提醒** - 使用 AlarmManager 精确闹钟，即使应用被杀也能触发
- **重复日程** - 自动计算下一次触发时间，持续提醒
- **开机恢复** - 设备重启后自动重新注册所有闹钟
- **权限管理** - 自动处理 POST_NOTIFICATIONS 运行时权限
{% endnote %}

---

## 二、技术方案

| 组件 | 职责 |
|:-----|:-----|
| AlarmManager | 注册精确闹钟，在指定时间唤醒应用 |
| BroadcastReceiver | 接收闹钟触发广播，执行通知发送 |
| NotificationManager | 创建通知渠道，发送系统通知 |
| PendingIntent | 携带日程信息，连接闹钟与接收器 |

---

## 三、架构设计

### 3.1 类图

![提醒功能类图](https://raw.githubusercontent.com/surpasslike/Calendar/main/docs/images/05-reminder.png)

### 3.2 新增组件

{% tabs components %}
<!-- tab ReminderScheduler -->
**闹钟调度器**（object 单例）

负责闹钟的注册与取消，是整个提醒功能的核心调度中心。

| 方法 | 说明 |
|:-----|:-----|
| `scheduleAlarm(context, schedule)` | 计算触发时间并注册精确闹钟 |
| `cancelAlarm(context, scheduleId)` | 取消已注册的闹钟 |

**触发时间计算**：
- 普通日程：`triggerTime = startTime - reminderMinutes × 60000`
- 重复日程：从今天起向后迭代，找到下一次匹配 RepeatRule 的日期，再减去提醒分钟数
<!-- endtab -->

<!-- tab ReminderReceiver -->
**闹钟触发接收器**（BroadcastReceiver）

闹钟触发时由系统调用，负责发送通知。

**处理流程**：
1. 从 Intent extras 读取日程信息（id、标题、描述等）
2. 创建 NotificationChannel（IMPORTANCE_HIGH，首次自动创建）
3. 构建并发送 Notification
4. 若为重复日程，调用 `ReminderScheduler.scheduleAlarm()` 注册下一次
<!-- endtab -->

<!-- tab BootReceiver -->
**开机广播接收器**（BroadcastReceiver）

监听 `ACTION_BOOT_COMPLETED`，设备重启后重新注册所有闹钟。

**原因**：AlarmManager 注册的闹钟在设备重启后会全部丢失，必须重新注册。

**处理流程**：
1. `goAsync()` 获取异步处理权
2. 协程中查询所有设置了提醒的日程
3. 逐一调用 `ReminderScheduler.scheduleAlarm()` 重新注册
<!-- endtab -->

<!-- tab NotificationHelper -->
**通知权限辅助**（object 单例）

处理 Android 13+ 的 `POST_NOTIFICATIONS` 运行时权限。

| 方法 | 说明 |
|:-----|:-----|
| `registerPermissionLauncher(fragment)` | 在 Fragment 的 `onCreate()` 中注册权限请求 Launcher |
| `requestIfNeeded(fragment, launcher)` | 检查权限状态，未授权则弹出系统权限对话框 |
<!-- endtab -->
{% endtabs %}

---

## 四、时序图

### 4.1 完整交互流程

![提醒功能时序图](https://raw.githubusercontent.com/surpasslike/Calendar/main/docs/images/06-reminder_sequence.png)

### 4.2 关键场景说明

{% tabs scenarios %}
<!-- tab 新增日程 -->
```
用户填写日程 → 选择提醒时间 → 点击保存
  ↓
ScheduleFragment: 请求通知权限（首次）
  ↓
CalendarViewModel.insertSchedule()
  ↓
Repository 写入数据库，返回 id
  ↓
ReminderScheduler.scheduleAlarm()
  ↓
AlarmManager 注册精确闹钟
```

**关键点**：必须等 `insertSchedule` 返回 id 后，才能用该 id 作为 PendingIntent 的 requestCode，确保后续能精确取消。
<!-- endtab -->

<!-- tab 闹钟触发 -->
```
到达触发时间 → AlarmManager 发送广播
  ↓
ReminderReceiver.onReceive()
  ↓
创建 NotificationChannel（IMPORTANCE_HIGH）
  ↓
构建 Notification（标题=日程标题，内容=描述）
  ↓
NotificationManager.notify() → 通知栏显示
  ↓
[若重复日程] → ReminderScheduler 注册下一次闹钟
```

**关键点**：重复日程在每次触发后自动注册下一次，形成链式调度。
<!-- endtab -->

<!-- tab 修改日程 -->
```
用户修改提醒时间 → 点击保存
  ↓
CalendarViewModel.updateSchedule()
  ↓
cancelAlarm(旧闹钟) → 数据库更新 → scheduleAlarm(新闹钟)
```

**关键点**：必须先取消旧闹钟再注册新闹钟，否则旧闹钟仍会触发。
<!-- endtab -->

<!-- tab 设备重启 -->
```
设备重启 → 系统发送 BOOT_COMPLETED 广播
  ↓
BootReceiver.onReceive()
  ↓
goAsync() + 协程查询数据库
  ↓
遍历所有有提醒的日程 → 逐一 scheduleAlarm()
```

**关键点**：使用 `goAsync()` 延长 BroadcastReceiver 的生命周期，避免数据库查询被系统中断。
<!-- endtab -->
{% endtabs %}

---

## 五、权限说明

| 权限 | 用途 | 授权方式 |
|:-----|:-----|:---------|
| `USE_EXACT_ALARM` | 注册精确闹钟 | 日历类应用自动授权（minSdk 34） |
| `POST_NOTIFICATIONS` | 发送通知 | 运行时弹窗请求 |
| `RECEIVE_BOOT_COMPLETED` | 监听开机广播 | 安装时自动授权 |

---

## 六、修改的现有文件

| 文件 | 修改内容 |
|:-----|:---------|
| `AndroidManifest.xml` | 新增 3 个权限声明，注册 ReminderReceiver 和 BootReceiver |
| `ScheduleDao.kt` | 新增 `getSchedulesWithReminder()` 查询方法 |
| `CalendarViewModel.kt` | insert/update/delete 时调用 ReminderScheduler 注册或取消闹钟 |
| `ScheduleFragment.kt` | `onCreate()` 注册权限 Launcher，保存时请求通知权限 |

---

## 上一篇

[Calendar 日历应用 - 系统架构设计](/calendar-02-architecture/)
