---
title: 车机投屏项目 - 黑屏与重连问题排查
date: 2026-08-07
description: 结合几次真实的车机投屏排查，记录连接成功、首帧回调、纯黑画面、首帧超时和重连归因之间那些容易混淆的地方。
categories:
  - 项目实践
tags:
  - Android Automotive
  - 投屏
  - 故障排查
topic: automotive
topic_order: 2
mermaid: true
---

车机投屏出问题时，最容易让人误解的一句话就是：**“已经连接成功了。”**

比如说，日志里有 `onConnectionEstablished`，状态也到了 `state=3`，甚至还能看到 `onFrameRendered`。看起来每个关键节点都走到了，结果车机屏幕还是黑的；有时画面明明短暂出现了，十几秒之后又被一个 `FIRST_FRAME_TIMEOUT` 主动断开。

后来复盘几次连接过程，才发现这些日志分别证明了不同的事情。它们拼在一起，才接近“投屏真的成功”；单独拿出任何一条，都可能让人误判。

## 先把“成功”拆开

建议把一次投屏拆成下面几层来看：

{% mermaid %}
graph LR
    A[找到正确设备] --> B[BT 或 Socket 建立]
    B --> C[握手完成]
    C --> D[收到数据并解码]
    D --> E[首帧回调到达]
    E --> F[确认像素不是纯黑]
    F --> G[画面持续稳定]
{% endmermaid %}

这几层之间不是同一件事：

| 日志或状态 | 它大致能证明什么 | 它还不能证明什么 |
|:---|:---|:---|
| `onConnectionEstablished` | 某个通信连接建立了 | 目标设备一定正确，画面一定能显示 |
| `state=3` | 应用状态机认为连接已经进入成功态 | 用户一定看到了正常画面 |
| 收到关键帧、解码器启动 | 数据到达并开始处理 | Surface 一定正常，屏幕一定不是黑的 |
| `onFrameRendered` | 某个渲染回调发生了 | 回调一定属于当前会话，像素一定不是黑的 |
| 截图或像素采样正常 | 屏幕上确实出现了可见内容 | 后续连接一定不会断 |

所以，排查时真正要问的不是“有没有成功日志”，而是：**这条日志证明了链路中的哪一层？它和当前这次连接是不是同一个会话？**

## 第一个坑：有 `onFrameRendered`，画面也可能还是黑的

有一次排查黑屏时，连接初期的链路看起来很完整：蓝牙控制、Wi-Fi Socket、`ConnectionScenario_WiFiAP`、解码器启动、关键帧输出和 `onFrameRendered` 都能找到。

如果停在这里，很容易得出“画面应该已经出来了”的结论。但进一步做像素采样，结果是：

```text
meanLuma=0.00 variance=0.00 class=BLACK_OR_NEAR_BLACK
```

这说明回调发生了，但不能据此推断用户看到了正常画面。问题可能在解码输出、Surface 绑定、TextureView 生命周期、会话切换，也可能是发送端实际上没有持续输出。日志里还出现过：

```text
Sender is not active! Will reconfigure the connection!
c2.android.avc.decoder
Mali chroma siting warning
```

这些信息值得继续查，但它们只是线索，不应该直接被当成根因。尤其是 decoder warning 很容易吸引注意力，最后却发现真正需要确认的是：发送端是否 active、当前 Surface 是否属于本次会话，以及车机截图中的像素到底是什么样。

这次之后，我不再把“首帧回调”直接写成“用户看到了画面”。更准确的说法是：它证明应用侧的渲染链路走到了一个重要节点；要确认用户体验，还需要截图或像素证据。

## 第二个坑：画面已经渲染过，却还是被首帧超时断开

这个问题比纯黑更容易误导，因为它的日志前半段看起来完全正常。

当时的时间线大致是这样：

1. 视频帧已经解码并渲染。
2. 投屏页面打出了 `onFrameRendered: first frame rendered`。
3. Wi-Fi Socket 的 Ping 仍然有响应，连接并没有先断。
4. 但没有看到对应的 `projection watchdog: cancel reason=firstFrameRendered`。
5. 约 12 秒后，watchdog 认为“还没有首帧”，触发 `FIRST_FRAME_TIMEOUT`。
6. 随后 `ConnectionManager.disconnectDevice()` 才把连接断掉。

这时候如果只看最后一行，很容易把问题归结成“网络不稳定”。但真正的顺序是：**首帧已经发生，首帧事件却没有被负责取消 watchdog 的那一层消费掉。**

日志里出现过类似这样的信息：

```text
publishFirstFrameConnected: skip unknown session
tryConsumeFirstFrameConnected: keep pending/watchdog
projection watchdog: disconnect because no frame rendered after 12000ms
```

也就是说，投屏页面看到了首帧，但连接管理层没有把它和当前会话对上。前台已经收到包裹，后台系统却没有完成签收，于是定时器仍然按照“没收到”处理。

这个坑给我的教训是：遇到首帧超时，第一反应不应该是把 12 秒改成 30 秒，更不应该马上删除 watchdog。先要确认三件事：

- 首帧回调经过了哪些对象，最后由谁负责取消 watchdog；
- 回调中的 `attemptId`、`epoch`、`sessionToken` 和当前连接是否一致；
- watchdog 的取消日志有没有在同一个会话里出现。

否则只是把真正的状态绑定问题藏得更久。

## 第三个坑：都叫“连接断开”，先断的却不是同一层

有几次重连失败，表面上都是“连接建立后又断开”。把时间线展开后，断点其实不一样：

```text
13:48:00  Socket 建立
13:48:03  首帧出现
            随后 Socket 侧先关闭

13:48:24  Socket 建立
13:48:26  首帧出现
13:48:37  BluetoothLayer read return: -1

13:48:46  再次建立连接
13:48:48  首帧出现并保持稳定
```

前一次更接近 Socket/TCP 侧先结束，后一次则是蓝牙读线程先拿到了 EOF。它们都可以被概括成“投屏断开”，但修复方向并不相同：一个要继续看网络通道，另一个要看蓝牙连接或底层 Host 的状态。

我以前也会盯着最后出现的 `Socket close`，把它当作根因。现在会先找**本次 attempt 的第一个终止事件**：到底是 BluetoothLayer 先报 EOF，还是 Socket 先关闭，还是首帧 watchdog 先到期。最后一条 close 日志，很多时候只是前面某个问题触发后的结果。

## 第四个坑：自动重连找的设备，可能不是当前这台手机

启动自动重连时，还有一个很容易被忽略的前提：系统保存的目标设备，和这次实际参与连接的设备，必须是同一个 peer。

我遇到过启动流程仍然盯着旧的 Bluetooth 地址，但实际发起连接的是另一台手机。日志里同时出现“目标设备”“发现设备”“接受 alternate Bluetooth 连接”等信息时，如果不把地址、attempt 和 session 放在一起看，很容易把身份不一致误判成协议或网络问题。

这类问题不能简单靠“失败两次就清除目标”来处理。因为自动重连有自己的目标策略，临时接受 alternate peer 也有明确的场景；真正需要先补上的，是日志归因：

```text
attempt=13
targetPeer=旧目标
physicalPeer=当前连接设备
epoch=...
sessionToken=...
event=BT_CONNECTED
```

这样才能知道：这次连接到底是连错了设备、被策略拒绝了，还是连对设备后又在后面的 Socket、解码或显示阶段失败。

## 我现在会怎样排查一次黑屏或重连

我不会再从“要不要加重试”开始，而是先把一轮连接整理成一条有起点、有终点的时间线。

### 1. 先确认这是谁的连接

至少把 `attemptId`、`epoch`、`sessionToken`、物理设备标识和时间戳放到一起。没有这几个字段，上一轮连接的迟到回调很容易被算到下一轮头上。

### 2. 找到第一个真正的终止原因

把 `BT_EOF`、`SOCKET_EOF`、`FIRST_FRAME_TIMEOUT`、握手超时等原因区分开，并记录是谁先发起了 teardown。不要只看最终的 `disconnect`。

### 3. 把“连接”“帧”“显示”分开验证

分别确认 Socket 是否有数据、解码器是否产出、首帧回调是否到达负责状态提交的对象、watchdog 是否真的取消，最后再看截图或像素采样。每一步都要绑定当前 session。

### 4. 对可疑日志保持一点克制

`Sender is not active`、decoder warning、`BAD_INDEX` 或 `CORRUPTED` 都可能重要，但不能因为它们看起来刺眼，就跳过时间线。比如有几次连接里，首帧 watchdog 都在首帧后正常取消，说明它们至少不是当次断开的第一原因。

### 5. 用连续复现确认结论

一次成功只能说明这一次成功，一次黑屏也不能自动说明协议不兼容。真正有说服力的证据应该包括：不重启连续连接、无线/有线切换、手机关闭后重开、异常断开后重连，以及每次的截图、发送端日志和车机端时间线。

## 最后留下的一份最小日志

现在如果要给一次连接留下可追踪的信息，我希望至少能看到这样的结构：

```text
attempt=13 epoch=42 session=abc123 peer=phone-A
time=13:48:24 event=SOCKET_CONNECTED
time=13:48:25 event=HANDSHAKE_OK
time=13:48:26 event=FIRST_FRAME_CALLBACK owner=ProjectionScreen
time=13:48:26 event=FIRST_FRAME_CONSUMED owner=ConnectionManager
time=13:48:26 event=WATCHDOG_CANCEL reason=firstFrameRendered
time=13:48:37 event=BT_EOF
time=13:48:37 event=TEARDOWN firstInitiator=BluetoothLayer
```

这比单独打印一句“连接成功”有用得多。它不一定马上告诉你修复方案，但能告诉你问题到底停在发现、连接、握手、数据、渲染、显示还是断开上。

## 结语

车机投屏最麻烦的地方，不是日志少，而是日志太容易让人提前下结论：看到 `state=3` 就说成功，看到 `onFrameRendered` 就说有画面，看到 `Socket close` 就说网络断了，看到 decoder warning 就开始改解码器。

我现在更愿意把结论写得慢一点：

> 这条日志证明了哪一层？它属于哪一次连接？在它之前，谁先出了问题？

把这三个问题问清楚，黑屏和重连问题就不再只是偶先问题，而是可以沿着 attempt、session 和时间线一步步还原的工程问题。
