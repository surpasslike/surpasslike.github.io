---
title: 学习日记：系统权限层级学习
date: 2026-08-07
updated: 2026-08-07
description: 从 Android Automotive 系统侧功能的实际问题出发，用一条访问链梳理 platform 签名、system UID、Priv-App、SELinux 与 DAC 的区别。
categories:
  - 学习日记
tags:
  - Android
  - Android Automotive
  - 系统集成
  - 平台签名
  - Priv-App
  - SELinux
  - DAC
  - 权限
series: Android Automotive 系统基础
mermaid: true
---

最近开发 Android Automotive 系统侧App时，我发现对于系统级别的应用，可能涉及到 `platform 签名`、`system UID`、`Priv-App`、`SELinux` 和 `DAC`。

我有App遇到过这样的情况：APK 明明已经推到车机里了，应用也能打开，但访问系统日志目录时还是失败。那时发现，这几个概念我有点混淆。它们更像是系统门口的几道门，开的是不同方向。

本文记录我踩过坑之后，对这几个概念的理解。文章里的包名、路径和日志均使用通用示例，重点是理解排查方法。

## 省流

> 签名解决“你是谁”，UID 解决“你以什么身份运行”，Priv-App 解决“你是不是系统镜像里的特权应用”，SELinux 和 DAC 解决“你到底能不能访问这个资源”。

它们可以一起出现，但谁也不能单独代表全部权限。

## 五个概念分别是什么

### 1. platform 签名：更像一张身份证

APK 安装时，Package Manager 会检查它的签名。使用 platform 证书签名，说明这个 APK 和系统平台之间建立了信任关系。

它通常影响两类事情：

- 是否满足某些 `signature` 级别权限；
- 是否具备参与某些系统集成关系的基础条件。

但 platform 签名不会自动改变应用的 UID，也不会自动让应用可以读取任意系统目录。

所以，“签了 platform”更准确的理解是：**身份被系统认可了一部分**，不是“权限全部打开了”。

### 2. system UID：进程在 Linux 里的身份

UID 是 Linux 层面的用户身份。Android 会用 UID 隔离不同应用的进程和数据；AOSP 中的 `SYSTEM_UID` 通常是 `1000`。

如果这里说的是 AOSP 的 `android.uid.system` shared UID，它通常对应 Linux UID `1000`。应用需要在 Manifest 中声明 `android:sharedUserId="android.uid.system"`，同时满足 platform 签名和目标系统的安装策略；只使用 platform 签名，并不会自动把应用放进这个 UID。

`android:sharedUserId` 在 Android 13 起已经弃用，不适合作为普通新应用的默认方案。Android 15 起，非 system 的 platform-signed 应用如果要在非 debuggable 构建中加入 platform shared UID，还需要通过系统配置 allowlist。系统集成时，最好优先使用独立 UID，再通过明确的 Binder 或系统服务接口提供能力。

### 3. Priv-App：应用安装在系统特权区域

Priv-App 一般指安装在系统镜像 `priv-app` 目录下的应用，例如某个分区的：

```text
/system/priv-app/
/product/priv-app/
/vendor/priv-app/
```

它和普通 `/data/app` 应用的区别，不只是目录名字不同。系统还会根据对应分区的 `privapp-permissions*.xml` 配置，决定哪些特权权限可以授予这个包。这个配置只对同一分区的 Priv-App 生效；放在 `/vendor/priv-app` 的应用还受到 `vendorPrivileged` 权限范围限制。

因此，下面这句话是不准确的：

> APK 放进 priv-app，所以它自然拥有所有系统权限。

更准确的说法是：**它获得了申请特权权限的系统位置和资格，但最终还要看权限白名单、签名和系统配置是否匹配。**

### 4. SELinux：系统的强制访问控制

SELinux 关注的不是“这个文件属于谁”这么简单，而是：

> 某个进程域，是否被策略允许访问某种类型的资源？

例如，应用进程可能属于某个 SELinux domain，日志目录和日志文件也有自己的安全类型。即使 Linux UID 看起来很高，如果策略没有允许这次访问，SELinux 仍然可以拒绝它。

在 `Enforcing` 模式下，拒绝通常会留下 `avc: denied` 日志，并且访问确实会失败。这也是为什么“已经是 root”也不能简单等于“SELinux 一定允许”。

### 5. DAC：Linux 传统的文件权限

DAC 就是我们更熟悉的 Linux 文件权限：

- 文件所有者是谁；
- 文件属于哪个用户组；
- 所有者、用户组和其他用户分别有读、写、执行权限。

执行下面的命令，可以看到传统权限和 SELinux 标签：

```bash
adb shell ls -lZ /mnt/vendor_logs
```

其中 `-l` 主要看 DAC，`-Z` 主要看 SELinux 上下文。一个进程想真正读取文件，通常需要同时通过这两层检查。

## 它们是怎样一起工作的

可以把一次“应用读取系统日志”的过程理解成这样：

{% mermaid %}
graph TD
    A[APK] --> B[签名身份]
    A --> C[安装位置]
    B --> D[签名权限与 shared UID 策略]
    C --> E[Priv-App 状态与同分区白名单]
    D --> F[进程 UID 与 SELinux Domain]
    E --> F
    F --> G[目标文件的 DAC 权限]
    F --> H[目标文件的 SELinux 类型]
    G --> I[应用实际访问]
    H --> I
{% endmermaid %}

这条链里任何一环不匹配，都可能出现“应用能启动，但功能不能用”。

以日志导出为例，比较完整的验证顺序应该是：

1. APK 签名是否和目标系统要求一致；
2. APK 是否安装到了正确的系统分区；
3. `privapp-permissions` 是否放在生效的分区配置目录；
4. `dumpsys package` 中的包、权限和 UID 状态是否符合预期；
5. 应用进程实际使用的 UID 和 SELinux domain 是什么；
6. 目标目录的所有者、权限和 SELinux 标签是什么；
7. 应用是否真的完成了枚举、读取和复制。

## 建议怎样排查

不要只盯着 Manifest，也不会只看 APK 能不能安装。而是先收集这些证据：

```bash
adb shell dumpsys package com.example.engineeringmode
adb shell pm path com.example.engineeringmode
adb shell ps -A -Z | grep engineeringmode
adb shell getenforce
adb shell ls -lZ /mnt/vendor_logs
adb logcat -b all | grep "avc: denied"
```

这些命令分别帮助确认：包状态、安装路径、进程 UID 与 SELinux domain、SELinux 模式、文件权限与标签，以及是否出现策略拒绝。不同 Android 版本的 `ps` 输出字段可能略有差异，以设备实际输出为准。

但它们仍然只是证据，最后还要回到应用本身：让 App 真正去访问目标目录，并记录成功或失败的结果。只有“真实访问成功”，才算这个功能链路闭环。

## 最容易记错的几句话

| 容易记错 | 更准确的理解 |
|:---|:---|
| platform 签名就是系统权限 | platform 签名只是身份和信任基础 |
| system UID 可以访问一切 | UID 只是进程身份，还会受到 SELinux、DAC 等限制 |
| 放进 priv-app 就拥有全部权限 | 还要看分区、白名单、签名和系统配置 |
| 文件权限是 `777` 就一定能读 | SELinux 仍然可能拒绝 |
| APK 推送成功就是系统集成完成 | 还要验证包状态、进程身份和真实业务访问 |

## 最后总结

把这几个概念简单记成：

```text
platform 签名：你是谁
system UID：你以谁的身份运行
Priv-App：你是否进入系统特权应用范围
SELinux：策略是否允许你访问
DAC：文件本身是否允许你访问
```

它们不是五个可以随便替换的同义词，而是 Android 系统安全模型中的不同层次。

## 参考资料

- [AOSP：App signing](https://source.android.com/docs/security/features/apksigning)
- [AOSP：Privileged permission allowlist](https://source.android.com/docs/core/permissions/perms-allowlist)
- [AOSP：Security-Enhanced Linux in Android](https://source.android.com/docs/security/features/selinux)
- [AOSP：SELinux concepts](https://source.android.com/docs/security/features/selinux/concepts)
- [AOSP：Application Sandbox](https://source.android.com/docs/security/app-sandbox)
- [AOSP：Platform-signed shared UID allowlist](https://source.android.com/docs/core/permissions/platform-signed-shared-uid-allowlist)
