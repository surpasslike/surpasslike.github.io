---
title: 学习日记：Compose 项目中的 Route、ViewModel、Gateway、Screen 分工
date: 2026-08-10
updated: 2026-08-10
description: 从 XML 和 Fragment 过渡到 Compose，结合 UI 状态、单向数据流和 Android 平台能力，梳理 Route、ViewModel、Gateway、Screen 以及 UseCase 的职责边界。
categories:
  - 学习笔记
tags:
  - Jetpack Compose
  - Kotlin
  - 架构设计
  - MVVM
topic: compose
topic_order: 1
mermaid: true
---

最近整理系统权限和车机投屏问题时，我发现很多问题并不是“某一行代码写错了”，而是不同层之间互相替对方做了决定，简单说就是不够解耦。

比如，APK 能安装，不代表系统权限链路已经打通；`onFrameRendered` 回调到了，也不代表用户真的看到了正常画面。类似地，一个 Compose 页面能显示出来，也不代表页面生命周期、业务状态和 Android 平台资源就已经分工清楚。

这篇学习日记就记录我现在对一组常见角色的理解：`Route`、`ViewModel`、`Gateway` 和 `Screen`。它们不是 Compose 官方强制规定的四层，而是一种很实用的协作约定。

传统 Android 项目里，我们经常会看到这样的数据链路：

```text
Activity / Fragment
        ↓
    ViewModel
        ↓
   Repository
        ↓
 Room / Network
```

到了 Compose，页面不再依赖 XML 布局来驱动更新，但 `Activity` 仍然可以作为系统入口，数据也仍然需要从某个真实来源获取。变化主要在于：界面更明确地变成了“状态的结果”。

```text
用户操作：Screen → Route → ViewModel → Gateway → Data Source
界面状态：Screen ← Route ← ViewModel ← Gateway ← Data Source
```

这不是说 Compose 必须使用这四个名字，而是借它们把“谁画界面、谁连接状态、谁做决策、谁访问外部世界”分开。

## 省流

可以先用四句话记住它们：

> `Screen` 负责“看见什么”；
>
> `Route` 负责“连接页面状态、处理页面级副作用，并把生命周期事件转换成业务通知”；
>
> `ViewModel` 负责“用户做了什么，以及状态如何变化”；
>
> `Gateway` 负责“系统或外部世界实际做了什么”。

如果还有更复杂的业务流程，再增加 `UseCase` 或 `Repository`，但不要为了凑层次而把简单逻辑拆得过细。

## Compose 本身没有规定这些名字

Compose 主要解决的是声明式 UI：给定状态，描述界面应该长什么样。

它并没有规定项目必须存在 `Route`、`Gateway` 或 `UseCase`。这些名字通常来自团队对职责的约定。真正重要的不是文件名，而是下面几个问题：

- 谁可以访问 Android `Context`、系统服务或硬件资源？
- 谁决定一个用户操作会导致什么业务状态变化？
- 谁负责监听页面进入和离开？
- 谁只负责把状态画出来？
- 一个回调回来时，如何确认它还属于当前页面和当前任务？

只要这些问题的答案稳定，项目就比较容易维护。反过来，如果每一层都能随意调用别的层，短期看起来代码少，后面遇到生命周期、重试和异步回调时就很容易失控。

## 一条完整的调用链

一个比较清晰的页面，可以先抽象成下面这条链路：

{% mermaid %}
graph LR
    A[Activity Host] --> B[Feature Route]
    B --> C[Feature Screen]
    C -->|User Action| B
    B -->|Action| D[Feature ViewModel]
    D -->|Platform Call| E[Feature Gateway]
    E --> F[Android Platform]
    F -->|Result or Callback| E
    E -->|Domain Result| D
    D -->|UiState or UiEffect| B
    B --> C
{% endmermaid %}

这里有一个很重要的方向感：

- 用户操作从 `Screen` 往上走，最终交给 `ViewModel` 决策；
- 平台结果从 `Gateway` 往上返回，最终变成 `UiState` 或 `UiEffect`；
- `Screen` 不直接向下穿透到 Android 平台；
- `Gateway` 不直接向上修改 Compose 状态。

## 为什么要把 Route 和 Screen 分开

在 XML 时代，一个 Fragment 往往同时负责：加载布局、找到控件、监听点击、收集数据和更新 UI。页面小时这样写很直接，页面变复杂后，界面代码、状态代码和数据调用就容易混在同一个文件里。

Compose 的一个重要变化，是可以把“页面如何显示”和“页面如何接入业务”拆开：

- `Screen` 只接收 `UiState`，并通过回调发出用户事件；
- `Route` 获取或接收 ViewModel，收集状态，再把状态和事件接到 Screen；
- ViewModel 和 Gateway 隐藏在 Route 后面，Screen 不需要知道它们的具体类型。

因此，`Screen` 可以单独 Preview，Route 可以集中处理生命周期和一次性效果，ViewModel 也可以用 Fake Gateway 做单元测试。这种拆分不是为了增加文件数量，而是为了让每个问题有明确的归因位置。

## Screen：只负责把状态变成界面

`Screen` 是最接近用户的一层。它接收状态，展示内容，再把用户操作通过回调交出去。

一个比较理想的 `Screen` 大概是这样：

```kotlin
@Composable
fun FeatureScreen(
    state: FeatureUiState,
    onAction: (FeatureAction) -> Unit,
) {
    Column {
        Text(text = state.title)

        Button(onClick = { onAction(FeatureAction.Retry) }) {
            Text(text = "重试")
        }

        if (state.isLoading) {
            CircularProgressIndicator()
        }
    }
}
```

可以把 `Screen` 记成两个方向：

```text
State In
Event Out
```

它不需要知道数据来自 API、Room、文件、蓝牙还是 Binder，也不需要知道 ViewModel 的类名。它只负责把输入状态画出来，再把用户事件交出去。

它最好不要做这些事情：

- 直接调用 `MediaRecorder`、`BluetoothAdapter`、`WebView` 或文件系统；
- 在组合函数里直接发起不可控的网络或硬件操作；
- 自己决定页面跳转、弹 Toast 或结束 Activity；
- 根据某一条底层日志就把状态改成“成功”；
- 把 `Context`、`NavController` 或具体的 ViewModel 深埋在组件内部。

这样做的好处是，`Screen` 可以单独预览和测试。给它一个 `UiState`，就能观察加载、成功、空数据和错误状态，而不需要真的启动 Android 平台服务。

## Route：页面的连接器和生命周期边界

很多人第一次看到 `Route` 时，会以为它只是一个导航函数。实际项目中，它更像是“页面连接器”：把 `ViewModel` 的状态和 `Screen` 接起来，同时承接页面级副作用和一次性效果。

Route 不是生命周期本身的所有者。真正提供生命周期的是 `LifecycleOwner`、Activity 或 Fragment；Route 只是站在 Compose 页面边界上，监听这些生命周期变化，并把“页面开始、停止、离开”转换成 ViewModel 能理解的业务通知。

```kotlin
@Composable
fun FeatureRoute(
    viewModel: FeatureViewModel = viewModel(),
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) {
        viewModel.effects.collect { effect ->
            when (effect) {
                FeatureEffect.NavigateBack -> onNavigateBack()
            }
        }
    }

    LifecycleStartEffect(Unit) {
        viewModel.onPageStarted()

        onStopOrDispose {
            viewModel.onPageStopped()
        }
    }

    FeatureScreen(
        state = state,
        onAction = viewModel::onAction,
    )
}
```

这段代码里，`Route` 没有决定“点击重试后应该请求哪个接口”，也没有直接操作系统资源。它做的是三件事：

1. 订阅状态，把状态传给 `Screen`；
2. 把 `Screen` 的动作转交给 `ViewModel`；
3. 把页面开始、停止和一次性效果接到外部生命周期上。

这也是为什么页面级清理通常应该放在 `Route` 的生命周期边界上。页面停止时，Route 可以通知 ViewModel 取消当前任务、重置纯页面状态，并让 Gateway 释放仍然占用的资源。

如果把这些逻辑放进 `Screen`，重组就可能让副作用变得难以追踪；如果完全不通知 `ViewModel` 页面已经停止，旧页面留下的回调就可能在新页面上继续生效。

## ViewModel：业务状态的决策者

`ViewModel` 不应该只是一个“存放几个变量的类”。它的核心职责是把用户动作、Gateway 结果和业务规则转换成稳定的 UI 状态。

通常可以把输入和输出先定义清楚：

```kotlin
data class FeatureUiState(
    val title: String = "准备开始",
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
)

sealed interface FeatureAction {
    data object Retry : FeatureAction
    data object Confirm : FeatureAction
}

sealed interface FeatureEffect {
    data object NavigateBack : FeatureEffect
}
```

然后由 ViewModel 统一处理动作：

```kotlin
class FeatureViewModel(
    private val gateway: FeatureGateway,
) : ViewModel() {

    private val _uiState = MutableStateFlow(FeatureUiState())
    val uiState: StateFlow<FeatureUiState> = _uiState.asStateFlow()

    private val _effects = MutableSharedFlow<FeatureEffect>()
    val effects: SharedFlow<FeatureEffect> = _effects.asSharedFlow()

    private var pageGeneration = 0L

    fun onPageStarted() {
        pageGeneration += 1
        _uiState.update { it.copy(errorMessage = null) }
    }

    fun onPageStopped() {
        // 页面离开时让当前页面的异步结果失效
        pageGeneration += 1
        viewModelScope.launch {
            gateway.stop()
        }
    }

    fun onAction(action: FeatureAction) {
        when (action) {
            FeatureAction.Retry -> load()
            FeatureAction.Confirm -> confirm()
        }
    }

    private fun load() {
        val generation = pageGeneration
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }

            val result = gateway.load()

            // 忽略已经离开页面或已经过期的异步结果
            if (generation != pageGeneration) return@launch

            _uiState.update { state ->
                result.fold(
                    onSuccess = { value ->
                        state.copy(isLoading = false, title = value)
                    },
                    onFailure = { error ->
                        state.copy(isLoading = false, errorMessage = error.message)
                    },
                )
            }
        }
    }

    private fun confirm() {
        // 这里只示意业务动作，实际项目中可以发出 UiEffect
    }
}
```

上面的 `pageGeneration` 是一个简单的示意。实际项目中也可以使用 `requestId`、`sessionId` 或者一个可取消的 Job。关键点不是变量叫什么，而是：**异步结果必须和当前页面、当前操作绑定起来。**

这和排查投屏时的 `attemptId`、`epoch`、`sessionToken` 是同一种思路。上一轮连接迟到的回调，不能因为“回调确实发生了”就被当成当前连接的成功证据。

## Gateway：平台世界的唯一入口

`Gateway` 不是 Android 官方规定的固定层名，而是本文采用的一种边界命名。它的作用，是把 Android 平台、系统服务、硬件、文件和外部 SDK 隔离在一个边界后面。

在不同项目里，Gateway 的含义可能不完全一样。有的团队用它表示平台能力入口，有的团队也会让它隐藏 API、Room 或缓存。关键不在于把某个类改名成 Gateway，而在于明确它到底隔离了哪一种外部依赖，以及谁拥有这些资源的生命周期。

有些项目会直接使用 Repository 代替 Gateway，也有些项目会把 Gateway 看作 Repository 的下层实现。它们都可以成立，前提是依赖方向和资源归属是清楚的。

先定义接口：

```kotlin
interface FeatureGateway {
    suspend fun load(): Result<String>

    suspend fun stop()
}
```

再提供 Android 实现：

```kotlin
class AndroidFeatureGateway(
    private val context: Context,
) : FeatureGateway {

    private var resource: PlatformResource? = null

    override suspend fun load(): Result<String> = runCatching {
        // 这里只负责申请资源、调用平台能力并返回结果
        resource = resource ?: PlatformResource(context)
        resource!!.read()
    }

    override suspend fun stop() {
        // 这里只负责停止、释放平台资源，保证清理路径可重复调用
        resource?.release()
        resource = null
    }
}
```

### Gateway 和 Repository 不是同义词

如果一个 `UserGatewayImpl` 同时读取 DAO、请求 API，并负责缓存策略，它在职责上更接近 Repository 或数据访问编排层；如果一个 `AudioGateway` 管理 `AudioFocusRequest`、`MediaRecorder` 和 `MediaPlayer`，它更接近 Android 平台 Gateway。

可以这样区分：

| 角色 | 主要问题 |
|:---|:---|
| Gateway | Android 系统或外部服务实际提供了什么能力？ |
| Repository | 数据应该从网络、数据库还是缓存获取？ |
| UseCase | 这次业务操作需要按什么顺序完成？ |
| ViewModel | 当前页面应该呈现什么状态？ |

所以，项目可以同时拥有 Repository 和 Gateway，也可以在简单功能中只保留其中一个。不要因为名字流行，就把所有数据访问类机械地改名。

Gateway 适合负责：

- 调用 Android 系统服务、硬件接口或外部 SDK；
- 管理 `MediaRecorder`、`MediaPlayer`、Socket、文件句柄等平台资源；
- 把回调、异常和平台返回值转换成上层能理解的结果；
- 在成功、失败、取消和页面退出时完成清理。

Gateway 不适合负责：

- 修改 Compose 的 `MutableState`；
- 决定页面显示“录音失败”还是“播放失败”；
- 直接触发导航或弹窗；
- 把所有异常都转换成一个模糊的“操作失败”。

例如，录音和播放都可能返回 `IOException`，但 ViewModel 需要保留当前操作上下文，分别显示“录音失败”和“播放失败”。如果 Gateway 越权替上层决定文案，错误归因就会变得含糊。

## Route、ViewModel、Gateway、Screen 的边界表

| 角色 | 主要负责 | 不应该负责 |
|:---|:---|:---|
| `Screen` | 根据 `UiState` 绘制界面，发出用户动作 | 调平台、做业务决策、直接导航 |
| `Route` | 连接状态和界面，承接页面级副作用与生命周期通知 | 承担完整业务流程、管理平台资源 |
| `ViewModel` | 处理动作、编排业务、生成 `UiState` 和 `UiEffect` | 持有 Activity/View、直接管理长生命周期平台对象 |
| `Gateway` | 访问平台或外部世界，管理资源和底层回调 | 直接改变 UI、决定产品文案 |
| `Activity/Host` | 创建依赖、承载页面和系统入口 | 堆积页面业务逻辑 |

这里的“不能负责”不是绝对的语法限制，而是为了让问题有明确的归因位置。出了问题时，我们应该能快速回答：是界面展示错了、业务状态错了，还是平台能力没有成功执行。

## 如果项目变复杂，再增加 UseCase 和 Repository

四层结构适合帮助我们先把边界立住，但复杂项目通常还会出现两个角色。

### UseCase：描述一次完整的业务动作

如果一次操作需要先申请权限、再创建资源、请求音频焦点、开始录制，最后还要处理失败清理，那么这些步骤可以放进 `UseCase`。它关注的是业务流程，不应该知道 Compose 的组件细节。

```text
ViewModel
    -> StartRecordingUseCase
        -> PermissionGateway
        -> AudioGateway
        -> RecorderGateway
```

### Repository：描述数据从哪里来

如果数据同时来自网络、数据库和内存缓存，可以用 Repository 统一“取数据”的策略。Repository 更关心数据来源和缓存，Gateway 更像是和某个具体平台或外部系统打交道。

不过，如果页面只有一个简单的读取动作，直接由 ViewModel 调用一个 Gateway 也完全可以。架构不是层数竞赛。

## 一次刷新操作的完整数据流

以用户点击“刷新”为例，事件和状态会沿着不同方向流动：

```text
用户点击刷新
      ↓
    Screen
      ↓
     Route
      ↓
ViewModel.refresh()
      ↓
Gateway.load()
      ↓
Repository / API / Room
      ↓
ViewModel 更新 UiState
      ↓
Route 收集 State
      ↓
Screen 重新组合
```

也可以把它概括成：

```text
Event Down
State Up
```

这里的 Down 和 Up 不是指界面坐标，而是指单向数据流的方向。用户事件向业务层传递，业务结果再以不可变状态的形式返回界面。

## XML 和 Compose 的对应关系

下面的对应关系可以帮助理解迁移，但它们不是严格的一一替换：

| XML 时代 | Compose 项目中的常见对应物 |
|:---|:---|
| Fragment | Route 加 Screen |
| XML 布局 | Screen |
| LiveData | StateFlow 或其他可观察状态 |
| ViewBinding | Compose 的状态读取和重组 |
| Repository | Repository 或 Gateway，取决于外部依赖类型 |
| Adapter | LazyColumn、LazyRow 等列表 Composable |

本质并没有改变：数据经过业务处理后形成状态，状态再驱动 UI。Compose 只是让这条数据流更容易显式表达出来。

## 把前两篇文章的经验放回这套分工

### 1. 系统权限问题：不要把“能启动”当成“能力可用”

系统权限文章里最容易混淆的是：platform 签名、UID、Priv-App、SELinux 和 DAC 各自解决不同问题。

放到 Compose 页面里，也应该保留这种分层意识：

```text
Screen：显示“正在检查”“读取成功”或“读取失败”
ViewModel：决定当前检查状态，并区分失败原因
Gateway：真正发起系统目录、Binder 或系统服务访问
Platform：根据签名、UID、SELinux、DAC 等规则决定是否允许
```

APK 能启动，只能证明启动链路的一部分；Gateway 真正访问目标资源并成功返回，才是业务能力可用的证据。

### 2. 投屏问题：不要把一个回调写成整条链路的成功

投屏文章里，连接建立、握手、解码、首帧回调、非黑像素和持续稳定，本来就是不同层次的证据。

因此，ViewModel 不应该简单地看到 `onFrameRendered` 就把状态改成“用户已经看到画面”。至少还要确认：

- 回调属于当前的 `attempt` 或 `session`；
- 负责取消 watchdog 的对象确实消费了首帧事件；
- 显示层有实际可见内容，而不是只有一个回调；
- 页面退出后，旧会话的回调不会污染新会话。

这也说明，`UiState` 里的“已连接”“已渲染”和“用户可见”最好不要随意混成一个 Boolean。状态名称越准确，后面的排查越容易。

## 在 Android Automotive 项目中的对应关系

把这套分工放到车机功能里，可以这样理解：

```text
VehicleScreen
    显示车辆状态、连接状态和错误提示

VehicleRoute
    连接页面生命周期、导航和一次性效果

VehicleViewModel
    管理 ACC、电源、连接、重试和当前会话状态

VehicleGateway
    访问 Binder、AIDL、Car API、Socket 或 Bluetooth
```

Compose 只是 UI 层的写法变化，车机系统里的权限、平台服务、资源释放和异步回调问题并不会因此消失。把它们隔离在 Gateway 和 ViewModel 后面，才能让 Screen 保持简单，也让真机问题有明确的排查入口。

## 异步结果必须属于当前页面

Compose 的重组、Activity 的停止与恢复、ViewModel 的存活时间，以及 Gateway 的资源生命周期，并不天然完全一致。

这也是 Android 页面最容易出现“看起来随机”的地方：页面 A 发起的任务，可能在页面 B 已经出现之后才返回。因此，异步结果不能只看“有没有回来”，还要确认它是否仍然属于当前页面和当前操作。

常见的错误过程是：

1. 页面 A 发起请求或连接；
2. 用户离开页面，页面 B 打开；
3. 页面 A 的 Gateway 回调这时才返回；
4. ViewModel 把旧结果写进了当前状态；
5. 页面 B 显示出看似随机的成功或错误。

比较稳妥的做法是同时做好三件事：

- Route 在页面进入和离开时明确通知 ViewModel；
- ViewModel 取消当前 Job，并维护 generation 或 session 标识；
- Gateway 对停止、释放和重复清理保持幂等，迟到回调不能重新持有已释放资源。

清理也不能只写在“正常成功”路径里。失败、取消、页面退出、权限拒绝和短时操作异常，都应该进入同一套资源回收逻辑。

## 一个推荐的目录结构

对于一个中等规模的 Compose 功能，可以从下面的结构开始：

```text
feature/
└── user/
    ├── UserRoute.kt
    ├── UserScreen.kt
    ├── UserViewModel.kt
    ├── UserUiState.kt
    ├── UserGateway.kt
    ├── AndroidUserGateway.kt
    └── UserAction.kt
```

如果业务流程明显变长，再增加：

```text
├── StartFeatureUseCase.kt
├── FeatureRepository.kt
└── FeatureEffect.kt
```

文件拆分只是表面，更重要的是依赖方向。尽量保持：

```text
Screen -> Route -> ViewModel -> UseCase or Repository -> Gateway -> Platform
```

如果发现 `Screen` 开始调用 Gateway，或者 Gateway 开始引用 `NavController`，通常说明边界正在反过来渗透，耦合度高可不太好。

## 如何分别测试这些层

不同层的测试，证明的事情也不同：

| 测试位置 | 能证明什么 |
|:---|:---|
| `Screen` Preview 或 Compose 测试 | 某个状态是否被正确画出来，点击是否发出正确动作 |
| `ViewModel` 单元测试 | 输入动作能否得到正确状态、错误和效果 |
| Fake Gateway 测试 | ViewModel 是否正确处理成功、失败、取消和迟到结果 |
| Gateway Android 测试 | 平台资源调用和清理逻辑是否基本正确 |
| 真机或车机验证 | 真实权限、系统服务、Surface、硬件和用户可见结果是否成立 |

JVM 测试和 Kotlin 编译只能证明代码及状态逻辑的一部分，不能自动证明真实设备上的权限、音频焦点、GNSS、投屏画面或系统服务一定正常。**证据必须和结论处在同一层。**

## 最容易出现的几个反模式

### Screen 里直接拿 ViewModel 或启动任务

例如在 `UserScreen` 里面直接调用 `hiltViewModel<UserViewModel>()`，会让纯 UI 组件和业务实现绑定。更稳妥的做法是由 Route 获取 ViewModel，Screen 只接收状态和回调。

如果在 Screen 的组合函数里直接启动任务，还会把副作用和重组绑在一起，后续很难判断任务到底启动了一次还是多次。

### Route 里写完整业务流程

Route 适合做连接和生命周期协调，不适合堆积权限判断、重试策略、错误映射和资源释放。否则它会变成一个没有测试边界的“大 Composable”。

### ViewModel 持有 Activity、Context 或平台资源

这样会增加生命周期和内存泄漏风险，也让单元测试不得不启动真实 Android 环境。ViewModel 可以接收抽象后的 Gateway，但不应该亲自持有 `Activity`、`View`、`MediaPlayer`、`Socket` 之类的对象。确实需要应用级 Context 时，也应把它限制在明确的基础设施边界内，而不是让页面 ViewModel 到处传递 Context。

### Gateway 写成万能类

如果把用户、设置、网络、数据库和车机能力全部放进一个 `AppGateway`，它最后会变成 God Class。更好的方式是按业务或平台能力拆分，例如 `UserGateway`、`SettingsGateway`、`VehicleGateway`，并让每个 Gateway 只拥有自己负责的资源。

### Gateway 直接发 Toast 或修改 UI 状态

这会让底层平台代码知道产品界面，最后任何错误都只能通过全局副作用传播，难以复用和测试。

### 用一个 Boolean 代表所有成功

“连接成功”“首帧到达”“画面可见”“页面稳定”可能是四个不同状态。把它们压成 `isSuccess = true`，排查时就会再次遇到“日志看起来成功，用户却看不到”的问题。

## 最后总结

把 Compose 页面理解成一组边界：

```text
Activity / Host：把页面放进系统
Route：连接页面状态，承接页面级副作用和生命周期通知
Screen：把状态画成用户能看到的界面
ViewModel：处理动作，维护状态，做业务决策
UseCase：编排较复杂的一次业务操作
Repository：决定数据从哪里来
Gateway：访问 Android 或外部世界，并负责资源清理
Platform：真正执行系统、硬件或外部 SDK 能力
```

> 每一层只对自己能证明的事情负责。

`Screen` 能证明界面画出了什么，`ViewModel` 能证明状态如何变化，`Gateway` 能证明平台调用返回了什么；至于真实设备上是否拥有权限、是否有声音、是否出现正常画面，还需要回到对应的设备证据和业务验收。

当每个问题都能找到明确的责任边界，Compose 项目就不只是能看到页面，而是更容易阅读、测试和排查。
