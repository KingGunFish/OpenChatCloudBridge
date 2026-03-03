#!/bin/bash
#
# CloudBridge 一键部署脚本 (MacOS/Linux)
#
# 用法:
#   ./deploy.sh                    # 使用 config.json 中的配置
#   ./deploy.sh -k <密钥>          # 指定密钥明文（推荐，不会保存到文件）
#   ./deploy.sh -h <哈希>          # 直接使用密钥哈希值
#
# 安全说明:
#   - config.json 只保存密钥哈希，不保存明文
#   - 推荐使用 -k 参数在命令行指定密钥，避免保存在文件中
#   - 服务器上只存储密钥哈希值

set -e

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.json"
PACKAGE_NAME="cloud-bridge-v2.2.tar.gz"
PACKAGE_PATH="$SCRIPT_DIR/$PACKAGE_NAME"

# 帮助信息
show_help() {
    echo "CloudBridge 部署脚本"
    echo ""
    echo "用法:"
    echo "  $0 [选项]"
    echo ""
    echo "选项:"
    echo "  -k <密钥>     指定密钥明文（推荐，8-64位字母数字）"
    echo "  -h <哈希>     直接使用密钥 SHA-256 哈希值"
    echo "  --help        显示帮助信息"
    echo ""
    echo "示例:"
    echo "  $0 -k MySecret2024"
    echo "  $0 -h a943446531987b4192ec605a3f1dc76b54df226ddfd9ebb696bb4c2df7e19206"
    echo ""
    echo "安全提示:"
    echo "  使用 -k 参数时，密钥不会保存到任何文件，只用于生成哈希"
    exit 0
}

# 解析命令行参数
SECRET_KEY=""
SECRET_KEY_HASH=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -k|--key)
            SECRET_KEY="$2"
            shift 2
            ;;
        -h|--hash)
            SECRET_KEY_HASH="$2"
            shift 2
            ;;
        --help)
            show_help
            ;;
        *)
            echo "❌ 未知参数: $1"
            echo "使用 --help 查看帮助"
            exit 1
            ;;
    esac
done

# 检查安装包是否存在
if [ ! -f "$PACKAGE_PATH" ]; then
    echo "❌ 错误: 找不到安装包 $PACKAGE_NAME"
    exit 1
fi

# 检查 expect 是否安装
if ! command -v expect &> /dev/null; then
    echo "❌ 错误: 请先安装 expect"
    echo "   MacOS: brew install expect"
    echo "   Ubuntu/Debian: sudo apt-get install expect"
    exit 1
fi

# 检查 jq 是否安装（用于处理JSON）
if ! command -v jq &> /dev/null; then
    echo "❌ 错误: 请先安装 jq"
    echo "   MacOS: brew install jq"
    echo "   Ubuntu/Debian: sudo apt-get install jq"
    exit 1
fi

# 读取配置文件
SERVER_IP=$(jq -r '.server.ip // empty' "$CONFIG_FILE" 2>/dev/null || echo "")
SERVER_PORT=$(jq -r '.server.port // "18789"' "$CONFIG_FILE" 2>/dev/null || echo "18789")
CONFIG_HASH=$(jq -r '.security.secretKeyHash // empty' "$CONFIG_FILE" 2>/dev/null || echo "")

# 检查服务器IP是否配置
if [ -z "$SERVER_IP" ]; then
    echo "❌ 错误: 请在 config.json 中配置服务器IP"
    echo ""
    echo "修改 $CONFIG_FILE:"
    echo '  "server": {'
    echo '    "ip": "你的服务器IP",'
    echo '    "port": 18789'
    echo '  }'
    exit 1
fi

# 确定密钥哈希值（优先级: 命令行 -h > 命令行 -k > config.json）
if [ -n "$SECRET_KEY_HASH" ]; then
    # 直接使用命令行指定的哈希
    echo "✅ 使用命令行指定的密钥哈希"
elif [ -n "$SECRET_KEY" ]; then
    # 从命令行密钥生成哈希
    if ! echo "$SECRET_KEY" | grep -qE '^[a-zA-Z0-9]{8,64}$'; then
        echo "❌ 错误: 密钥格式无效"
        echo "   密钥必须是 8-64 位的字母和数字组合"
        exit 1
    fi
    SECRET_KEY_HASH=$(echo -n "$SECRET_KEY" | sha256sum | cut -d' ' -f1)
    echo "✅ 已从密钥生成哈希"
    
    # 更新 config.json（只保存哈希，不保存明文）
    jq --arg hash "$SECRET_KEY_HASH" '.security.secretKeyHash = $hash | del(.security.secretKey)' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
    echo "✅ 已更新 config.json（只保存哈希）"
elif [ -n "$CONFIG_HASH" ]; then
    # 使用配置文件中的哈希
    SECRET_KEY_HASH="$CONFIG_HASH"
    echo "✅ 使用 config.json 中的密钥哈希"
else
    echo "❌ 错误: 未提供密钥"
    echo ""
    echo "请使用以下方式之一提供密钥:"
    echo "  1. 命令行指定: $0 -k <密钥>"
    echo "  2. 命令行指定哈希: $0 -h <哈希>"
    echo "  3. 在 config.json 中配置 secretKeyHash"
    exit 1
fi

echo "========================================"
echo "  CloudBridge 一键部署脚本"
echo "========================================"
echo ""
echo "服务器: $SERVER_IP:$SERVER_PORT"
echo "密钥哈希: ${SECRET_KEY_HASH:0:16}..."
echo ""

# 提示用户输入密码
echo -n "请输入服务器 root 密码: "
read -s PASSWORD
echo ""

if [ -z "$PASSWORD" ]; then
    echo "❌ 错误: 密码不能为空"
    exit 1
fi

echo ""
echo "📦 步骤 1/5: 上传安装包到服务器..."

expect << EOF
spawn scp "$PACKAGE_PATH" root@$SERVER_IP:/tmp/
expect "password:"
send "$PASSWORD\r"
expect eof
EOF

echo "✅ 上传完成"
echo ""
echo "🔧 步骤 2-5: 连接服务器并部署..."

expect << EOF
spawn ssh root@$SERVER_IP
expect "password:"
send "$PASSWORD\r"
expect "#"

# 停止旧服务
send "echo '停止旧服务...' && pm2 stop openclaw-bridge 2>/dev/null; pkill -f 'node.*bridge' 2>/dev/null; sleep 1\r"
expect "#"

# 备份数据
send "echo '备份数据...' && cp -r /opt/cloud-bridge-lite/data /opt/data-backup-\$(date +%Y%m%d-%H%M) 2>/dev/null; echo '备份完成'\r"
expect "#"

# 清理旧目录
send "echo '清理旧版本...' && rm -rf /opt/cloud-bridge-lite && echo '清理完成'\r"
expect "#"

# 解压新版本
send "echo '解压新版本...' && mkdir -p /opt/cloud-bridge-lite && tar -xzf /tmp/$PACKAGE_NAME -C /opt/cloud-bridge-lite --strip-components=1 && echo '解压完成'\r"
expect "#"

# 安装依赖
send "echo '安装依赖...' && cd /opt/cloud-bridge-lite && npm install\r"
expect "#"

# 编译
send "echo '编译代码...' && cd /opt/cloud-bridge-lite && npm run build\r"
expect "#"

# 创建 .env 文件（只保存密钥 hash，不保存明文）
send "echo '配置环境...' && cd /opt/cloud-bridge-lite && echo -e \"PORT=$SERVER_PORT\nAPP_SECRET=$SECRET_KEY_HASH\nNODE_ENV=production\nDB_DIR=./data\" > .env\r"
expect "#"

# 启动服务
send "echo '启动服务...' && cd /opt/cloud-bridge-lite && pm2 start dist/index.js --name openclaw-bridge && pm2 save\r"
expect "#"

# 显示状态
send "echo '' && echo '========================================' && echo '  部署完成！' && echo '========================================' && echo '' && echo '服务器: $SERVER_IP:$SERVER_PORT' && echo '' && cat .env && echo '' && pm2 status\r"
expect "#"

send "exit\r"
expect eof
EOF

echo ""
echo "🎉 部署成功！"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 配置信息："
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "服务器地址: $SERVER_IP"
echo "端口:       $SERVER_PORT"
echo "密钥哈希:   $SECRET_KEY_HASH"
echo ""
if [ -n "$SECRET_KEY" ]; then
    echo "⚠️  请牢记你的原始密钥: $SECRET_KEY"
    echo "   （密钥不会保存在服务器或配置文件中）"
else
    echo "⚠️  请确保你知道原始密钥"
fi
echo ""
echo "📱 App 配置："
echo "   - 地址: $SERVER_IP"
echo "   - 端口: $SERVER_PORT"
echo "   - 密钥: （你的原始密钥）"
echo ""
echo "🤖 OpenChatBot 配置："
echo "   endpoint: ws://$SERVER_IP:$SERVER_PORT"
echo "   appId:    openclaw_01"
echo "   appSecret: $SECRET_KEY_HASH"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
