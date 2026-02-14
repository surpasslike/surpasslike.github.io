---
title: Kotlin 协程学习笔记 - 在 Calendar 项目中的实战使用
date: 2026-02-14
updated: 2026-02-14
categories:
  - 学习日记
tags:
  - Kotlin
  - 协程
  - Android
mermaid: true
---

以 Calendar 日历应用为例，记录协程在项目中的实际使用方式。

---

## 一、为什么需要协程

Android 的主线程（UI 线程）负责渲染界面和响应用户操作。如果在主线程执行耗时操作（如数据库读写、网络请求），界面会**卡住**甚至 ANR 崩溃。

传统解决方案是用回调或线程，但代码会变得很难读：

```kotlin
// 传统回调方式 —— 嵌套
database.getSchedule(id, object : Callback<Schedule> {
    override fun onSuccess(schedule: Schedule) {
        database.updateSchedule(schedule.copy(title = "新标题"), object : Callback<Unit> {
            override fun onSuccess(result: Unit) {
                runOnUiThread { showToast("更新成功") }
            }
            override fun onError(e: Exception) { /* ... */ }
        })
    }
    override fun onError(e: Exception) { /* ... */ }
})
```

协程让异步代码写起来**像同步代码一样**：

```kotlin
// 协程方式 —— 顺序书写，自动切线程
lifecycleScope.launch {
    val schedule = database.getSchedule(id)          // 挂起，不阻塞主线程
    database.updateSchedule(schedule.copy(title = "新标题"))  // 挂起
    showToast("更新成功")                              // 回到主线程
}
```

{% note info flat %}
**协程的核心优势**
- **不阻塞主线程** —— 耗时操作自动在后台执行
- **顺序书写** —— 没有回调嵌套，代码直观易读
- **自动取消** —— 配合生命周期，页面销毁时自动取消，不会内存泄漏
{% endnote %}

---

## 二、suspend 函数 —— 协程的基础

### 2.1 什么是 suspend

`suspend` 关键字标记一个函数可以**挂起**：执行到耗时操作时暂停当前协程，让出线程给别人用，等操作完成后再恢复执行。

项目中 `ScheduleDao.kt` 的增删改查都是 suspend 函数：

```kotlin
@Dao
interface ScheduleDao {
    @Insert
    suspend fun insertSchedule(scheduleEntity: ScheduleEntity): Long

    @Delete
    suspend fun deleteSchedule(scheduleEntity: ScheduleEntity)

    @Update
    suspend fun updateSchedule(scheduleEntity: ScheduleEntity)

    @Query("SELECT * FROM schedules WHERE id = :id")
    suspend fun getScheduleById(id: Long): ScheduleEntity?
}
```

{% note warning flat %}
**为什么 Room 的 DAO 方法要标记 suspend？**
Room 在编译时会自动生成代码，把 suspend 方法的数据库操作切换到**后台线程**执行。如果不加 suspend，直接在主线程调用会崩溃（`IllegalStateException: Cannot access database on the main thread`）。
{% endnote %}

### 2.2 suspend 的传递性

suspend 函数只能在**协程**或**另一个 suspend 函数**中调用。这形成了一条调用链：

`ScheduleRepository.kt` 的方法也是 suspend，因为它要调用 DAO 的 suspend 方法：

```kotlin
class ScheduleRepository(private val scheduleDao: ScheduleDao) {

    suspend fun insertSchedule(scheduleEntity: ScheduleEntity): Long {
        val id = scheduleDao.insertSchedule(scheduleEntity)  // 调用 suspend 方法
        return id
    }

    suspend fun deleteSchedule(schedule: ScheduleEntity) {
        scheduleDao.deleteSchedule(schedule)  // 调用 suspend 方法
    }

    suspend fun getScheduleById(id: Long): ScheduleEntity? {
        return scheduleDao.getScheduleById(id)  // 调用 suspend 方法
    }
}
```

`CalendarViewModel.kt` 同样：

```kotlin
// ViewModel 中的 suspend 函数，供 UI 层调用
suspend fun getScheduleById(id: Long): ScheduleEntity? {
    return scheduleRepository.getScheduleById(id)
}
```

```
UI 层 (launch 启动协程)
    ↓ 调用
ViewModel.getScheduleById() ← suspend
    ↓ 调用
Repository.getScheduleById() ← suspend
    ↓ 调用
DAO.getScheduleById() ← suspend (Room 自动切到后台线程执行 SQL)
    ↓ 返回结果
一路返回到 UI 层
```

---

## 三、协程作用域 —— 在哪里启动协程

suspend 函数不能直接调用，需要在**协程作用域**中通过 `launch` 启动。项目中用到了两种作用域：

### 3.1 viewModelScope —— ViewModel 中使用

`CalendarViewModel.kt` 的增删改操作：

```kotlin
// viewModelScope: ViewModel自带的协程作用域
// ViewModel销毁时自动取消, 不会内存泄漏
fun insertSchedule(schedule: ScheduleEntity) {
    viewModelScope.launch {
        scheduleRepository.insertSchedule(schedule)
    }
}

fun deleteSchedule(schedule: ScheduleEntity) {
    viewModelScope.launch {
        scheduleRepository.deleteSchedule(schedule)
    }
}

fun updateSchedule(schedule: ScheduleEntity) {
    viewModelScope.launch {
        scheduleRepository.updateSchedule(schedule)
    }
}
```

{% note info flat %}
**viewModelScope 的特点**
- 由 `androidx.lifecycle` 提供，不需要手动创建
- 默认运行在**主线程**（`Dispatchers.Main`）
- ViewModel 被销毁时（如页面关闭），**自动取消**所有未完成的协程
- 适合处理：数据库操作、网络请求等需要 ViewModel 生命周期管理的任务
{% endnote %}

**注意**：这些函数本身**不是** suspend 函数（没有 `suspend` 关键字），所以 UI 层可以直接调用，不需要在协程中调用：

```kotlin
// ScheduleFragment.kt 中直接调用，不需要 launch
mViewModel.insertSchedule(scheduleEntity)
mViewModel.deleteSchedule(schedule)
```

### 3.2 lifecycleScope —— Fragment/Activity 中使用

`ScheduleFragment.kt` 加载日程详情：

```kotlin
private fun loadSchedule(id: Long) {
    viewLifecycleOwner.lifecycleScope.launch {
        val schedule = mViewModel.getScheduleById(id) ?: run {
            // 未找到日程，返回上一页
            parentFragmentManager.popBackStack()
            return@launch
        }
        // 以下代码在主线程执行，可以直接操作 UI
        editingSchedule = schedule
        mBinding.etTitle.setText(schedule.title)
        mBinding.etDescription.setText(schedule.description.orEmpty())
        // ... 填充其他表单字段
        mBinding.btnDelete.visibility = View.VISIBLE
    }
}
```

{% note info flat %}
**lifecycleScope 的特点**
- 由 `androidx.lifecycle` 提供
- 绑定 Fragment/Activity 的**生命周期**
- 页面销毁时自动取消
- 使用 `viewLifecycleOwner.lifecycleScope` 而不是 `lifecycleScope`，确保跟 View 的生命周期一致
{% endnote %}

### 3.3 两种作用域的对比

| 特性 | viewModelScope | lifecycleScope |
|------|---------------|----------------|
| 所在位置 | ViewModel | Fragment / Activity |
| 生命周期 | 跟随 ViewModel | 跟随 Fragment / Activity |
| 默认线程 | 主线程 | 主线程 |
| 典型用途 | 数据库增删改、网络请求 | 加载数据填充 UI、一次性操作 |
| 自动取消 | ViewModel 销毁时 | 页面销毁时 |

### 3.4 为什么不手动创建协程作用域？

```kotlin
// 错误做法：手动创建，没有生命周期绑定
val scope = CoroutineScope(Dispatchers.Main)
scope.launch {
    repository.deleteSchedule(schedule)
    // 如果用户已经离开页面，这里还在执行 → 内存泄漏！
}

// 正确做法：使用生命周期绑定的作用域
viewModelScope.launch {
    repository.deleteSchedule(schedule)
    // ViewModel 销毁时自动取消，不会泄漏
}
```

---

## 四、Dispatchers —— 协程在哪个线程执行

### 4.1 三种常用 Dispatcher

| Dispatcher | 线程 | 用途 |
|-----------|------|------|
| `Dispatchers.Main` | 主线程 | 更新 UI |
| `Dispatchers.IO` | IO 线程池 | 数据库、文件、网络 |
| `Dispatchers.Default` | 计算线程池 | CPU 密集型计算 |

### 4.2 项目中的使用

在 `ScheduleRepository.kt` 中使用了 `Dispatchers.Default`：

```kotlin
fun observeSchedulesByDate(targetDate: Long): Flow<List<ScheduleEntity>> {
    return scheduleDao.observeSchedulesByDate(targetDate).map { list ->
        list.filter { schedule ->
            if (schedule.repeatRule == null) true
            else schedule.repeatRule.matches(schedule.date, targetDate)
        }
    }.flowOn(Dispatchers.Default)  // 精筛过滤在计算线程执行
}
```

{% note warning flat %}
**为什么这里用 `Dispatchers.Default` 而不是 `Dispatchers.IO`？**
- `Dispatchers.IO`：适合**等待型**操作（等数据库返回、等网络响应），线程池较大
- `Dispatchers.Default`：适合 **CPU 计算型**操作（过滤、排序、解析），线程数 = CPU 核心数
- 这里的 `.map { list.filter { ... } }` 是纯 CPU 计算（遍历列表做匹配），所以用 Default
{% endnote %}

### 4.3 那 DAO 的 suspend 方法在哪个线程？

Room 会**自动**把 suspend DAO 方法切换到内部的 IO 线程执行，不需要手动指定 Dispatcher。所以项目中的 ViewModel 和 Repository 都没有写 `withContext(Dispatchers.IO)`：

```kotlin
// Room 自动处理线程切换，不需要手动写 withContext
viewModelScope.launch {  // 主线程启动
    scheduleRepository.insertSchedule(schedule)  // Room 自动切到 IO 线程
    // 执行完后自动回到主线程
}
```

---

## 五、协程的取消与生命周期

### 5.1 自动取消

项目中使用的 `viewModelScope` 和 `lifecycleScope` 都会**自动取消**：

```
用户打开编辑页 → lifecycleScope.launch { loadSchedule(id) }
    ↓ 正在从数据库加载...
用户按返回键 → Fragment 销毁 → lifecycleScope 自动取消协程
    ↓
loadSchedule 中断，不会继续执行后续的 UI 操作 → 不会崩溃
```

### 5.2 launch 中的提前返回

`ScheduleFragment.kt` 的 `loadSchedule` 展示了协程中的提前返回：

```kotlin
viewLifecycleOwner.lifecycleScope.launch {
    val schedule = mViewModel.getScheduleById(id) ?: run {
        parentFragmentManager.popBackStack()
        return@launch  // 提前退出这个协程，后续代码不执行
    }
    // 只有 schedule 不为 null 才会执行到这里
    mBinding.etTitle.setText(schedule.title)
}
```

`return@launch` 是返回到 `launch` 这个 lambda，**不是**返回外层函数。类似于循环中的 `continue`，但这里是直接结束整个协程。

---

## 六、完整协程流转图

以"用户点击保存日程"为例：

{% mermaid %}
graph TB
    A["用户点击保存按钮"] --> B["ScheduleFragment 调用 mViewModel.insertSchedule()"]
    B --> C["viewModelScope.launch 启动协程 (主线程)"]
    C --> D["调用 repository.insertSchedule() (suspend)"]
    D --> E["调用 dao.insertSchedule() (suspend)"]
    E --> F["Room 自动切到 IO 线程执行 SQL"]
    F --> G["SQL 执行完毕 返回插入的 id"]
    G --> H["协程恢复 回到主线程"]
    H --> I["Room 检测到表变化 Flow 自动发射新数据"]
    I --> J["CalendarFragment 的 UI 自动刷新"]
    style A fill:#4CAF50,color:#fff
    style F fill:#FF9800,color:#fff
    style J fill:#2196F3,color:#fff
{% endmermaid %}

以"用户打开编辑页"为例：

{% mermaid %}
graph TB
    A["用户点击某条日程"] --> B["ScheduleFragment.loadSchedule(id)"]
    B --> C["lifecycleScope.launch 启动协程 (主线程)"]
    C --> D["调用 viewModel.getScheduleById(id) (suspend)"]
    D --> E["Room 在 IO 线程执行查询"]
    E -->|"找到日程"| F["协程恢复 在主线程填充表单 UI"]
    E -->|"未找到"| G["return@launch 协程结束 返回上一页"]
    style A fill:#4CAF50,color:#fff
    style E fill:#FF9800,color:#fff
    style F fill:#2196F3,color:#fff
    style G fill:#f44336,color:#fff
{% endmermaid %}

---

## 七、总结

这个项目中协程的使用可以归纳为三个层面：

{% note success flat %}
**1. suspend 函数（DAO + Repository 层）**
标记耗时操作，让 Room 自动在后台线程执行数据库操作
`ScheduleDao.kt` → 增删改查都是 suspend
`ScheduleRepository.kt` → 透传 suspend，加上业务逻辑

**2. 协程作用域（ViewModel + Fragment 层）**
`viewModelScope.launch` → ViewModel 中启动协程，执行增删改
`lifecycleScope.launch` → Fragment 中启动协程，加载数据填充 UI
两者都会在页面销毁时**自动取消**，防止内存泄漏

**3. Dispatchers 线程调度（Repository 层）**
`Dispatchers.Default` → CPU 密集型的过滤计算
`Dispatchers.IO` → Room 自动处理，不需要手动指定
`Dispatchers.Main` → 协程作用域默认使用，适合更新 UI
{% endnote %}

协程最大的价值：**把异步代码写成同步的样子**。不需要回调，不需要手动切线程，不需要担心内存泄漏 —— `suspend` 标记 + 生命周期作用域，就把这些问题都解决了。
