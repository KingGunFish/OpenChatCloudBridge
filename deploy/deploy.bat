@echo off
chcp 65001 >nul
REM CloudBridge 一键部署脚本 (Windows)
REM
REM 用法:
REM   deploy.bat                   使用 config.json 中的哈希或提示输入密钥
REM   deploy.bat -k <密钥>         指定密钥明文（推荐，不会保存到文件）
REM   deploy.bat -h <哈希>         直接使用密钥哈希值

setlocal EnableDelayedExpansion

REM 获取脚本所在目录
set "SCRIPT_DIR=%~dp0"
set "CONFIG_FILE=%SCRIPT_DIR%config.json"
set "PACKAGE_NAME=cloud-bridge-v2.2.tar.gz"
set "PACKAGE_PATH=%SCRIPT_DIR%%PACKAGE_NAME%"

REM 解析命令行参数
set "SECRET_KEY="
set "SECRET_KEY_HASH="
set "ARG_INDEX=0"

:parse_args
if "%~1"=="" goto :done_parse
if "%~1"=="-k" (
    set "SECRET_KEY=%~2"
    shift
    shift
    goto :parse_args
)
if "%~1"=="-h" (
    set "SECRET_KEY_HASH=%~2"
    shift
    shift
    goto :parse_args
)
if "%~1"=="--help" (
    echo CloudBridge 部署脚本 (Windows)
    echo.
    echo 用法:
    echo   deploy.bat [选项]
    echo.
    echo 选项:
    echo   -k ^<密钥^>     指定密钥明文（推荐，8-64位字母数字）
    echo   -h ^<哈希^>     直接使用密钥 SHA-256 哈希值
    echo   --help         显示帮助信息
    echo.
    echo 示例:
    echo   deploy.bat -k MySecret2024
    echo   deploy.bat -h 02949353af6320b410f5c948fa6f025819cb169f6cc99c0f74a4ced31e230454
    pause
    exit /b 0
)
shift
goto :parse_args
:done_parse

REM 检查配置文件
if not exist "%CONFIG_FILE%" (
    echo [错误] 找不到配置文件 config.json
    echo        请确保 config.json 与 deploy.bat 在同一目录
    pause
    exit /b 1
)

REM 检查安装包
if not exist "%PACKAGE_PATH%" (
    echo [错误] 找不到安装包 %PACKAGE_NAME%
    pause
    exit /b 1
)

REM 检查 pscp 和 plink
where pscp >nul 2>&1
if errorlevel 1 (
    echo [错误] 找不到 pscp.exe，请安装 PuTTY 并添加到 PATH
    echo        下载: https://www.chiark.greenend.org.uk/~sgtatham/putty/latest.html
    pause
    exit /b 1
)

where plink >nul 2>&1
if errorlevel 1 (
    echo [错误] 找不到 plink.exe，请安装 PuTTY 并添加到 PATH
    pause
    exit /b 1
)

REM 从 config.json 读取配置
for /f "tokens=2 delims=:" %%a in ('findstr /i "\"ip\"" "%CONFIG_FILE%"') do (
    set "SERVER_IP=%%a"
    set "SERVER_IP=!SERVER_IP:"=!"
    set "SERVER_IP=!SERVER_IP: =!"
    set "SERVER_IP=!SERVER_IP:,=!"
)

for /f "tokens=2 delims=:" %%a in ('findstr /i "\"port\"" "%CONFIG_FILE%"') do (
    set "SERVER_PORT=%%a"
    set "SERVER_PORT=!SERVER_PORT: =!"
    set "SERVER_PORT=!SERVER_PORT:,=!"
)

for /f "tokens=2 delims=:" %%a in ('findstr /i "\"secretKeyHash\"" "%CONFIG_FILE%"') do (
    set "CONFIG_HASH=%%a"
    set "CONFIG_HASH=!CONFIG_HASH:"=!"
    set "CONFIG_HASH=!CONFIG_HASH: =!"
    set "CONFIG_HASH=!CONFIG_HASH:,=!"
)

REM 默认值
if "!SERVER_PORT!"=="" set "SERVER_PORT=18789"

REM 检查服务器IP
if "!SERVER_IP!"=="" (
    echo [错误] 请在 config.json 中配置服务器IP
    echo.
    echo 修改 %CONFIG_FILE%:
    echo   "server": {
    echo     "ip": "你的服务器IP",
    echo     "port": 18789
    echo   }
    pause
    exit /b 1
)

REM 确定密钥哈希（优先级: 命令行 -h > 命令行 -k > config.json）
if not "!SECRET_KEY_HASH!"=="" (
    echo [信息] 使用命令行指定的密钥哈希
) else if not "!SECRET_KEY!"==" (
    REM 验证密钥格式
    echo !SECRET_KEY! | findstr /r "^[a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9]*$" >nul
    if errorlevel 1 (
        echo [错误] 密钥格式无效
        echo        密钥必须是 8-64 位的字母和数字组合
        pause
        exit /b 1
    )
    REM 使用 PowerShell 生成 SHA256
    for /f %%a in ('powershell -Command "[BitConverter]::ToString((New-Object System.Security.Cryptography.SHA256Managed).ComputeHash([System.Text.Encoding]::UTF8.GetBytes('!SECRET_KEY!'))).Replace('-','').ToLower()"') do (
        set "SECRET_KEY_HASH=%%a"
    )
    echo [信息] 已从密钥生成哈希
) else if not "!CONFIG_HASH!"=="" (
    set "SECRET_KEY_HASH=!CONFIG_HASH!"
    echo [信息] 使用 config.json 中的密钥哈希
) else (
    REM 提示用户输入密钥
    echo.
    echo 请输入密钥（8-64位字母数字，输入时不显示）:
    set /p SECRET_KEY=
    
    if "!SECRET_KEY!"=="" (
        echo [错误] 密钥不能为空
        pause
        exit /b 1
    )
    
    REM 验证密钥格式
    echo !SECRET_KEY! | findstr /r "^[a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9]*$" >nul
    if errorlevel 1 (
        echo [错误] 密钥格式无效
        echo        密钥必须是 8-64 位的字母和数字组合
        pause
        exit /b 1
    )
    
    REM 生成 SHA256
    for /f %%a in ('powershell -Command "[BitConverter]::ToString((New-Object System.Security.Cryptography.SHA256Managed).ComputeHash([System.Text.Encoding]::UTF8.GetBytes('!SECRET_KEY!'))).Replace('-','').ToLower()"') do (
        set "SECRET_KEY_HASH=%%a"
    )
    echo [信息] 已从输入的密钥生成哈希
)

if "!SECRET_KEY_HASH!"=="" (
    echo [错误] 无法确定密钥哈希
    pause
    exit /b 1
)

echo ========================================
echo   CloudBridge 一键部署脚本 (Windows)
echo ========================================
echo.
echo 服务器: !SERVER_IP!:!SERVER_PORT!
echo 密钥哈希: !SECRET_KEY_HASH:~0,16!...
echo.

REM 提示输入密码
echo 请输入服务器 root 密码（输入时不显示）:
set /p PASSWORD=

if "!PASSWORD!"=="" (
    echo [错误] 密码不能为空
    pause
    exit /b 1
)

echo.
echo [1/5] 上传安装包到服务器...
pscp -pw !PASSWORD! -P 22 "!PACKAGE_PATH!" root@!SERVER_IP!:/tmp/
if errorlevel 1 (
    echo [错误] 上传失败
    pause
    exit /b 1
)
echo [√] 上传完成
echo.

echo [2-5] 连接服务器并部署...
echo.

REM 创建临时脚本
set "TEMP_SCRIPT=%TEMP%\cloudbridge_deploy_%RANDOM%.txt"
(
echo #!/bin/bash
echo echo "停止旧服务..."
echo pm2 stop openclaw-bridge 2^>/dev/null
echo pm2 delete openclaw-bridge 2^>/dev/null
echo pkill -f 'node.*bridge' 2^>/dev/null
echo sleep 1
echo.
echo echo "清理旧目录..."
echo rm -rf /opt/cloud-bridge-lite
echo mkdir -p /opt/cloud-bridge-lite
echo.
echo echo "解压新版本..."
echo tar -xzf /tmp/%PACKAGE_NAME% -C /opt/cloud-bridge-lite --strip-components=1
echo echo "解压完成"
echo.
echo echo "安装依赖..."
echo cd /opt/cloud-bridge-lite
echo npm install
echo.
echo echo "编译代码..."
echo npm run build
echo.
echo echo "配置环境..."
echo echo -e "PORT=!SERVER_PORT!\nAPP_SECRET=!SECRET_KEY_HASH!\nNODE_ENV=production\nDB_DIR=./data" ^> .env
echo.
echo echo "启动服务..."
echo pm2 start dist/index.js --name openclaw-bridge
echo pm2 save
echo.
echo echo "========================================"
echo echo "  部署完成！"
echo echo "========================================"
echo echo "服务器: !SERVER_IP!:!SERVER_PORT!"
echo echo ""
echo cat .env
echo pm2 status
) > "!TEMP_SCRIPT!"

plink -pw !PASSWORD! -P 22 -m "!TEMP_SCRIPT!" root@!SERVER_IP!

del "!TEMP_SCRIPT!"

echo.
echo ========================================
echo  部署成功！
echo ========================================
echo.
echo [配置信息]
echo 服务器地址: !SERVER_IP!
echo 端口:       !SERVER_PORT!
echo 密钥哈希:   !SECRET_KEY_HASH!
echo.
if not "!SECRET_KEY!"=="" (
    echo [警告] 请牢记你的原始密钥: !SECRET_KEY!
    echo        密钥不会保存在服务器或配置文件中
) else (
    echo [警告] 请确保你知道原始密钥
)
echo.
echo [App 配置]
echo   地址: !SERVER_IP!
echo   端口: !SERVER_PORT!
echo   密钥: （你的原始密钥）
echo.
echo [OpenChatBot 配置]
echo   endpoint: ws://!SERVER_IP!:!SERVER_PORT!
echo   appId:    openclaw_01
echo   appSecret: !SECRET_KEY_HASH!
echo.
pause
exit /b 0
