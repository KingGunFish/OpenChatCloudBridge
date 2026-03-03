# CloudBridge 部署脚本使用说明

## 📦 文件清单

```
deploy/
├── config.json                 # ⭐ 配置文件（只保存服务器IP和密钥哈希）
├── cloud-bridge-v2.2.tar.gz    # CloudBridge 安装包
├── deploy.sh                    # MacOS/Linux 一键部署脚本
├── deploy.bat                   # Windows 一键部署脚本
└── README.md                    # 本文件
```

---

## 🔐 安全说明

**重要：密钥永不以明文形式存储**

- `config.json` **只保存密钥哈希**，不保存密钥明文
- 推荐使用命令行参数 `-k <密钥>` 指定密钥，避免在任何文件中保存明文
- 服务器上只存储密钥的 SHA-256 哈希值，无法反推出原始密钥

---

## ⚙️ 第一步：修改配置文件

编辑 `config.json`：

```json
{
  "server": {
    "ip": "192.168.1.100",      // ← 必填：填写你的服务器IP
    "port": 18789               // 默认端口
  },
  "security": {
    "_comment": "此处只保存密钥哈希，不保存明文",
    "secretKeyHash": ""          // 部署时自动填充
  }
}
```

**只需要修改 `ip` 字段为你的服务器IP！**

---

## 🚀 第二步：运行部署脚本

### MacOS/Linux

#### 方式1：命令行指定密钥（推荐，最安全）
```bash
cd deploy
./deploy.sh -k AppSecret2026
```
密钥不会保存到任何文件，只用于生成哈希部署到服务器。

#### 方式2：使用已保存的哈希
```bash
cd deploy
./deploy.sh
```
如果 `config.json` 中已有 `secretKeyHash`，则直接使用。

#### 方式3：直接指定哈希
```bash
cd deploy
./deploy.sh -h 02949353af6320b410f5c948fa6f025819cb169f6cc99c0f74a4ced31e230454
```

---

### Windows

```cmd
cd deploy
deploy.bat
```

Windows 版本会提示输入密钥，同样不会在本地保存明文。

---

## 🔑 密钥要求

- **长度**：8-64 位
- **字符**：仅限数字和字母（a-z, A-Z, 0-9）
- **示例**：`AppSecret2026`、`MyKey2024`、`OpenClaw01`

**重要提示：**
- 请务必牢记你的原始密钥！
- App 连接时需要输入相同的密钥
- 如果忘记密钥，需要重新部署生成新的哈希

---

## 📱 App 配置

部署完成后，在 App 中配置：
- **服务器地址**：你的服务器IP
- **端口**：18789
- **密钥**：你部署时使用的原始密钥（如 `AppSecret2026`）

---

## 🤖 OpenChatBot 配置

```yaml
endpoint: ws://你的服务器IP:18789
appId: openclaw_01
appSecret: 密钥的SHA256哈希值（部署完成后显示）
```

---

## 📝 命令行参数说明

```
./deploy.sh [选项]

选项:
  -k <密钥>     指定密钥明文（推荐，8-64位字母数字）
  -h <哈希>     直接使用密钥 SHA-256 哈希值
  --help        显示帮助信息

示例:
  ./deploy.sh -k MySecret2024
  ./deploy.sh -h a943446531987b4192ec605a3f1dc76b54df226ddfd9ebb696bb4c2df7e19206
```

---

## 🔍 验证部署

部署完成后，可以通过以下方式验证：

```bash
# 检查服务状态
curl http://你的服务器IP:18789/health

# 查看日志
ssh root@你的服务器IP "pm2 logs openclaw-bridge --lines 20"
```

---

## ⚠️ 故障排查

### 1. 提示 "请先安装 expect"
MacOS: `brew install expect`
Ubuntu/Debian: `sudo apt-get install expect`

### 2. 提示 "请先安装 jq"
MacOS: `brew install jq`
Ubuntu/Debian: `sudo apt-get install jq`

### 3. 连接被拒绝
- 检查服务器防火墙是否开放 18789 端口
- 检查服务器安全组设置

### 4. 密钥认证失败
- 确认 App 中输入的密钥与部署时使用的密钥一致
- 重新部署时使用 `-k` 参数指定正确的密钥
