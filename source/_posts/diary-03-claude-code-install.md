---
title: Windows 环境下通过 WSL 安装 Claude Code
date: 2026-04-07
updated: 2026-04-07
description: 记录 Windows 通过 WSL Ubuntu 安装 Claude Code 的完整步骤，涵盖 WSL 初始化、Node.js 与 NVM 安装、Claude Code 安装和登录使用。
categories:
  - 工具指南
tags:
  - Claude Code
  - WSL
  - 环境搭建
topic: tooling
topic_order: 1
---

Windows 上通过 WSL（Ubuntu）安装 Claude Code 的完整过程

---

## 一、安装 WSL

打开 PowerShell（管理员），运行：

```powershell
wsl --install
```

安装完成后会提示新建用户：

- **用户名**：随便起，比如 `like`
- **密码**：输入时屏幕不会显示任何字符，这是正常的，盲打输入即可

{% note info flat %}
密码不显示是 Linux 的安全设计，不是卡住了。输完直接按回车就行。
{% endnote %}

![WSL 设置用户名密码](/img/posts/claude-code-install/01-wsl-setup-user.png)

---

## 二、打开 Ubuntu

安装完成后，开始菜单中会出现 **Ubuntu** 应用，单击打开即可进入 Linux 终端。

![开始菜单中的 Ubuntu](/img/posts/claude-code-install/02-start-menu-ubuntu.png)

---

## 三、更新系统

首次进入 Ubuntu，先更新系统软件包：

```bash
sudo apt update && sudo apt upgrade -y
```

![apt update 终端输出](/img/posts/claude-code-install/03-apt-update.png)

---

## 四、安装 Node.js

推荐用 nvm（Node 版本管理器）安装，方便后续切换版本：

**第一步：安装 nvm**

打开 [nvm 官方仓库](https://github.com/nvm-sh/nvm#installing-and-updating)，复制页面里的安装命令，直接粘贴到终端运行。

{% note info flat %}
命令格式大致如下：
`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v*.**.*/install.sh | bash`
其中 `v*.**.*` 是版本号，以官方页面为准。
{% endnote %}

**第二步：安装 Node.js**

```bash
# 重新加载配置
source ~/.bashrc

# 安装 Node.js LTS 版本
nvm install --lts

# 验证安装
node --version
```

显示 `v20.x.x` 之类的版本号就说明安装成功了。

{% note warning flat %}
如果 `node --version` 提示命令未找到，先关闭终端重新打开再试，nvm 需要重新加载 shell 配置才能生效。
{% endnote %}

---

## 五、安装 Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

验证安装：

```bash
claude --version
```

---

## 六、登录并使用

直接在终端输入：

```bash
claude
```

首次启动会引导你登录 Anthropic 账号，完成后即可开始使用。

![Claude Code 启动界面](/img/posts/claude-code-install/04-claude-running.png)

