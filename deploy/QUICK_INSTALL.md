# CloudBridge 快速安装指南

## 部署前准备

### 1. 编辑配置文件

打开 `config.json`，修改以下配置：

```json
{
  "server": {
    "ip": "192.168.1.100",      // ← 必填：你的服务器IP
    "port": 18789               // 默认端口
  },
  "security": {
    "secretKey": "AppSecret2026"   // ← 建议修改为你自己的密钥
  }
}
```

**密钥要求：**
- 长度：8-64 位
- 字符：仅限数字和字母（a-z, A-Z, 0-9）
- 示例：`AppSecret2026`、`MyKey2024`、`OpenClaw01`

---

## 方法一：MacOS/Linux 一键部署

### 前提条件
- 安装 `expect`: `brew install expect` (MacOS) / `apt-get install expect` (Linux)

### 部署步骤

```bash
cd deploy
./deploy.sh

# 按提示输入服务器 root 密码
```

**部署过程：**
```
========================================
  CloudBridge 一键部署脚本
========================================

服务器: 192.168.1.100:18789

请输入服务器 root 密码: 

📦 步骤 1/5: 上传安装包到服务器...
✅ 上传完成

🔧 步骤 2-5: 连接服务器并部署...
...

🎉 部署成功！

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 配置信息：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
服务器地址: 192.168.1.100
端口:       18789
密钥 Hash:  0e39fd49...

⚠️  注意: 服务器上只保存了密钥的 Hash 值
   请牢记你的原始密钥: AppSecret2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 方法二：Windows 一键部署

### 前提条件
1. 下载并安装 [PuTTY](https://www.chiark.greenend.org.uk/~sgtatham/putty/latest.html)
2. 确保 `pscp.exe` 和 `plink.exe` 在系统 PATH 中

### 部署步骤

1. 编辑 `config.json` 配置服务器IP和密钥
2. 双击运行 `deploy.bat`
3. 按提示输入服务器 root 密码

---

## 方法三：服务器本地安装

如果已经通过 SSH 登录到服务器：

### 步骤 1：准备安装包
将 `cloud-bridge-v2.2.tar.gz` 上传到服务器的 `/tmp` 目录

### 步骤 2：执行安装命令

```bash
# 1. 解压安装
cd /opt && rm -rf cloud-bridge-lite && mkdir cloud-bridge-lite \
&& tar -xzf /tmp/cloud-bridge-v2.2.tar.gz -C cloud-bridge-lite --strip-components=1

# 2. 安装依赖
cd /opt/cloud-bridge-lite && npm install

# 3. 编译
npm run build

# 4. 生成 AppToken（交互式）
npm run setup
# 输入密钥: AppSecret2026 （或你自己的密钥）
# 确认: yes

# 5. 启动服务
pm2 start dist/index.js --name openclaw-bridge && pm2 save

# 6. 查看状态
cat .env && pm2 status
```

---

## 客户端配置

### App 配置

1. 打开 App → 设置 → 服务器配置
2. **服务器地址**: 你的服务器IP
3. **端口**: 18789
4. **密钥**: 你在 config.json 中设置的密钥

### OpenChatBot 配置

```json
{
  "cloudBridge": {
    "enabled": true,
    "endpoint": "ws://你的服务器IP:18789",
    "appId": "openclaw_01",
    "appSecret": "生成的64位Hash值"
  }
}
```

---

## 验证安装

### 检查服务状态
```bash
ssh root@你的服务器IP
pm2 status
```

### 查看生成的配置
```bash
cat /opt/cloud-bridge-lite/.env
```

输出示例：
```
PORT=18789
APP_SECRET=0e39fd4980aedee3014454f843ccc54517590c39fb4919560c07767186372e54
NODE_ENV=production
DB_DIR=./data
```

---

## 安全说明

1. **密码**: 部署时手动输入，不保存在任何文件中
2. **密钥**: 
   - `config.json` 中保存明文（仅本地使用）
   - 服务器 `.env` 中只保存 SHA256 Hash 值
3. **IP**: 保存在 `config.json` 中，由用户自行配置

---

## 常见问题

### Q: 提示 "请在 config.json 中配置服务器IP"
在 `config.json` 中填写你的服务器IP：
```json
"server": {
  "ip": "192.168.1.100"
}
```

### Q: 提示 "请在 config.json 中配置密钥"
在 `config.json` 中设置密钥：
```json
"security": {
  "secretKey": "你的密钥"
}
```

### Q: 忘记密钥怎么办
需要重新部署：
1. 修改 `config.json` 中的 `secretKey`
2. 重新运行 `deploy.sh` 或 `deploy.bat`

### Q: 如何重启服务
```bash
ssh root@你的服务器IP
pm2 restart openclaw-bridge
```

### Q: 如何更新到新版
重新执行部署脚本即可，数据会自动备份。

---

## 目录结构

部署后的服务器目录：
```
/opt/cloud-bridge-lite/
├── dist/              # 编译后的代码
├── src/               # 源代码
├── data/              # 运行时数据（数据库）
├── .env               # 环境变量（只含密钥Hash）
├── package.json
└── ...
```
