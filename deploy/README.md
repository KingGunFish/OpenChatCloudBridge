# CloudBridge 部署工具

本目录提供一键部署脚本，帮助用户快速将 CloudBridge 服务端部署到自己的服务器。

## 文件说明

| 文件 | 说明 |
|------|------|
| `deploy.sh` | MacOS/Linux 一键部署脚本 |
| `deploy.bat` | Windows 一键部署脚本 |
| `config.example.json` | 配置文件示例 |
| `QUICK_INSTALL.md` | 快速安装指南 |

## 使用方法

1. 复制 `config.example.json` 为 `config.json`
2. 修改 `config.json` 中的服务器IP和密钥
3. 运行部署脚本：
   ```bash
   ./deploy.sh
   ```

## 安全提示

- `config.json` 包含服务器信息，**请勿提交到 Git**
- 部署时会要求输入服务器 root 密码，密码不会保存在任何文件中
- 服务器只存储密钥的 SHA-256 哈希值，不存储明文
