/**
 * OpenClaw Cloud Bridge - WebSocket Chat Room Server
 * Port: 18789 (WebSocket only)
 */

import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import { createHmac } from "crypto";
import { db, DeviceManagementRecord } from "./database-memory.js";

const PORT = parseInt(process.env.PORT || "18789");
const APP_SECRET = process.env.APP_SECRET || "demo_secret_change_in_production";

interface Device {
  id: string;
  appId: string;
  type: "openclaw" | "app";
  name: string;
  ws: WebSocket;
  boundTo?: string;
  lastHeartbeat: number;
}

const devices = new Map<string, Device>();

// Verify HMAC signature or direct token
function verifySignature(appId: string, timestamp: string, signature: string): boolean {
  // 方法1: HMAC-SHA256 签名验证 (OpenChatBot 使用)
  const data = `${appId}:${timestamp}`;
  const expected = createHmac("sha256", APP_SECRET).update(data).digest("hex");
  if (signature === expected) {
    return true;
  }
  
  // 方法2: 直接使用 APP_SECRET 作为 token 验证 (App 使用)
  // 允许 signature 等于 APP_SECRET（用于简化 App 认证）
  if (signature === APP_SECRET) {
    console.log(`[Auth] Token-based auth accepted for ${appId}`);
    return true;
  }
  
  return false;
}

// 验证 token 是否有效（支持 HMAC 签名或直接使用 APP_SECRET）
function isValidToken(appId: string, timestamp: string, signature: string): boolean {
  return verifySignature(appId, timestamp, signature);
}

// Generate device ID
function generateDeviceId(type: "openclaw" | "app"): string {
  const prefix = type === "openclaw" ? "ocl" : "app";
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;
}

// 获取稳定的设备ID
// 优先使用客户端提供的deviceId，如果没有则生成新的
function getStableDeviceId(type: "openclaw" | "app", clientDeviceId?: string | null): string {
  if (clientDeviceId && clientDeviceId.length > 0) {
    // 客户端提供了设备ID，使用客户端的（添加前缀确保唯一性）
    const prefix = type === "openclaw" ? "ocl" : "app";
    // 如果客户端ID已经带有前缀，直接使用；否则添加前缀
    if (clientDeviceId.startsWith(prefix + "_")) {
      return clientDeviceId;
    }
    return `${prefix}_${clientDeviceId}`;
  }
  // 客户端没有提供，生成新的
  return generateDeviceId(type);
}

// 获取在线设备ID集合（用于判断历史设备是否在线）
function getOnlineDeviceIdsByAppId(appId: string): Set<string> {
  const onlineIds = new Set<string>();
  devices.forEach(device => {
    if (device.appId === appId && device.type === "openclaw") {
      onlineIds.add(device.id);
    }
  });
  return onlineIds;
}

export function startServer() {
  // WebSocket server only
  const wss = new WebSocketServer({ port: PORT });
  console.log(`[Bridge] WebSocket server started on port ${PORT}`);

  wss.on("connection", (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[WS] Connection from ${clientIp}`);
    
    // 尝试从 URL 参数读取认证信息
    const url = new URL(req.url || "", `http://localhost:${PORT}`);
    const urlAppId = url.searchParams.get("appId");
    const urlTimestamp = url.searchParams.get("timestamp");
    const urlSignature = url.searchParams.get("signature");
    const urlDeviceName = url.searchParams.get("deviceName");
    const urlType = url.searchParams.get("type") || url.searchParams.get("deviceType");
    
    // 尝试从 Header 读取认证信息（App 使用）
    const authHeader = req.headers["authorization"] || "";
    const tokenMatch = authHeader.match(/Bearer\s+(.+)/i);
    const headerToken = tokenMatch ? tokenMatch[1] : "";
    const headerClientType = req.headers["x-client-type"] as string || "";
    
    let device: Device | null = null;
    let authenticated = false;
    let urlAuthAttempted = false;
    
    // 如果 URL 参数包含认证信息，立即验证（OpenClaw 使用）
    if (urlAppId && urlTimestamp && urlSignature) {
      urlAuthAttempted = true;
      console.log(`[WS] URL auth attempt from ${urlAppId}, type=${urlType || 'unknown'}`);
      console.log(`[WS] Signature check: expected HMAC or token match`);
      
      if (!verifySignature(urlAppId, urlTimestamp, urlSignature)) {
        console.log(`[WS] URL auth failed: invalid signature`);
        console.log(`[WS]   - appId: ${urlAppId}`);
        console.log(`[WS]   - timestamp: ${urlTimestamp}`);
        console.log(`[WS]   - signature length: ${urlSignature.length}`);
        ws.send(JSON.stringify({
          type: "auth_ack",
          error: { code: "INVALID_SIGNATURE", message: "Invalid signature" }
        }));
        ws.close(1008, "Auth failed");
        return;
      }
      console.log(`[WS] URL auth successful for ${urlAppId}`)
      
      const deviceType = (urlType === "app" ? "app" : "openclaw") as "openclaw" | "app";
      // 尝试获取客户端提供的设备ID，如果没有则生成新的
      const urlClientDeviceId = url.searchParams.get("deviceId") || url.searchParams.get("clientDeviceId");
      const deviceId = getStableDeviceId(deviceType, urlClientDeviceId);
      const deviceName = urlDeviceName || `${deviceType}-device-${Date.now()}`;
      
      device = {
        id: deviceId,
        appId: urlAppId,
        type: deviceType,
        name: deviceName,
        ws,
        lastHeartbeat: Date.now(),
      };
      
      devices.set(deviceId, device);
      authenticated = true;
      
      // 创建设备记录（数据库会更新历史记录）
      db.createDevice({
        id: deviceId,
        appId: urlAppId,
        type: deviceType,
        name: device.name,
      }).catch(console.error);
      
      // 如果是app类型，获取并发送历史设备列表
      let deviceHistory: any[] = [];
      if (deviceType === "app") {
        deviceHistory = getDeviceListForApp(urlAppId);
      }
      
      ws.send(JSON.stringify({
        type: "auth_ack",
        deviceId,
        payload: { 
          status: "success",
          serverTime: Date.now(),
          deviceType: deviceType,
          deviceHistory: deviceHistory
        }
      }));
      
      console.log(`[WS] Device ${deviceId} (${deviceType}) authenticated via URL`);
      
      // 如果是openclaw设备，通知同app下的所有app设备
      if (deviceType === "openclaw") {
        broadcastToApp(device.appId, {
          type: "device_online",
          payload: {
            deviceId: device.id,
            deviceType: device.type,
            name: device.name
          }
        }, "app"); // 只通知app类型的设备
      }
    }
    // 如果 Header 包含 Token，使用 Token 认证（App 使用）
    else if (headerToken) {
      console.log(`[WS] Header auth attempt with token`);
      
      // App 使用简化认证，默认使用 openclaw_01 作为 appId
      // 可以通过 X-App-Id header 指定不同的 appId
      const appId = (req.headers["x-app-id"] as string) || "openclaw_01";
      const deviceType = (headerClientType === "app" ? "app" : "openclaw") as "openclaw" | "app";
      // 从Header获取客户端设备ID
      const headerDeviceId = req.headers["x-device-id"] as string;
      const deviceId = getStableDeviceId(deviceType, headerDeviceId);
      const deviceName = `${deviceType}-device-${Date.now()}`;
      
      device = {
        id: deviceId,
        appId: appId,
        type: deviceType,
        name: deviceName,
        ws,
        lastHeartbeat: Date.now(),
      };
      
      devices.set(deviceId, device);
      authenticated = true;
      
      // 创建设备记录（数据库会更新历史记录）
      db.createDevice({
        id: deviceId,
        appId: appId,
        type: deviceType,
        name: device.name,
      }).catch(console.error);
      
      // 如果是app类型，获取并发送历史设备列表
      let deviceHistory: any[] = [];
      if (deviceType === "app") {
        deviceHistory = getDeviceListForApp(appId);
      }
      
      ws.send(JSON.stringify({
        type: "auth_ack",
        deviceId,
        payload: { 
          status: "success",
          serverTime: Date.now(),
          deviceType: deviceType,
          deviceHistory: deviceHistory
        }
      }));
      
      console.log(`[WS] Device ${deviceId} (${deviceType}) authenticated via Header Token`);
      
      // 如果是openclaw设备，通知同app下的所有app设备
      if (deviceType === "openclaw") {
        broadcastToApp(device.appId, {
          type: "device_online",
          payload: {
            deviceId: device.id,
            deviceType: device.type,
            name: device.name
          }
        }, "app"); // 只通知app类型的设备
      }
    }
    
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        console.log("[WS] Auth timeout");
        ws.close(1008, "Auth timeout");
      }
    }, 30000);
    
    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        if (!authenticated) {
          if (msg.type === "auth") {
            const { appId, timestamp, signature, deviceName, type, deviceType: dt, deviceId: clientDeviceId } = msg.payload || msg;
            
            if (!verifySignature(appId, timestamp, signature)) {
              ws.send(JSON.stringify({
                type: "auth_ack",
                error: { code: "INVALID_SIGNATURE", message: "Invalid signature" }
              }));
              return;
            }
            
            const deviceType = dt || (type === "app" ? "app" : "openclaw");
            // 使用客户端提供的设备ID或生成新的
            const newDeviceId = getStableDeviceId(deviceType, clientDeviceId);
            const finalDeviceName = deviceName || `${deviceType}-device-${Date.now()}`;
            
            device = {
              id: newDeviceId,
              appId,
              type: deviceType,
              name: finalDeviceName,
              ws,
              lastHeartbeat: Date.now(),
            };
            
            devices.set(newDeviceId, device);
            authenticated = true;
            clearTimeout(authTimeout);
            
            await db.createDevice({
              id: newDeviceId,
              appId,
              type: deviceType,
              name: device.name,
            });
            
            // 如果是app类型，获取并发送历史设备列表
            let deviceHistory: any[] = [];
            if (deviceType === "app") {
              deviceHistory = getDeviceListForApp(appId);
            }
            
            // Send auth success with device info
            ws.send(JSON.stringify({
              type: "auth_ack",
              deviceId: newDeviceId,
              payload: { 
                status: "success",
                serverTime: Date.now(),
                deviceType: deviceType,
                deviceHistory: deviceHistory
              }
            }));
            
            console.log(`[WS] Device ${newDeviceId} (${deviceType}) authenticated`);
            
            // 如果是openclaw设备，通知同app下的所有app设备
            if (deviceType === "openclaw") {
              broadcastToApp(device.appId, {
                type: "device_online",
                payload: {
                  deviceId: device.id,
                  deviceType: device.type,
                  name: device.name
                }
              }, "app");
            }
          }
          return;
        }
        
        if (!device) return;
        device.lastHeartbeat = Date.now();
        
        switch (msg.type) {
          case "auth":
            // Device already authenticated via URL/Header, acknowledge again
            // 如果是app，返回历史设备列表
            let historyList: any[] = [];
            if (device.type === "app") {
              historyList = getDeviceListForApp(device.appId);
            }
            
            ws.send(JSON.stringify({
              type: "auth_ack",
              deviceId: device.id,
              payload: {
                status: "success",
                serverTime: Date.now(),
                deviceType: device.type,
                alreadyAuthenticated: true,
                deviceHistory: historyList
              }
            }));
            break;
            
          case "heartbeat":
            ws.send(JSON.stringify({ 
              type: "heartbeat_ack", 
              timestamp: Date.now(),
              payload: { 
                deviceCount: devices.size,
                serverTime: Date.now()
              }
            }));
            break;
          
          case "heartbeat_ack":
            // Client acknowledges heartbeat, no action needed
            break;
            
          case "bind":
            await handleBind(device, msg);
            break;
            
          case "unbind":
            await handleUnbind(device, msg);
            break;
            
          case "message":
            await handleMessage(device, msg);
            break;
            
          case "broadcast":
            await handleBroadcast(device, msg);
            break;
            
          case "get_device_history":
            await handleGetDeviceHistory(device, msg);
            break;
            
          default:
            console.log(`[WS] Unknown message type: ${msg.type}`);
        }
      } catch (err) {
        console.error("[WS] Message error:", err);
        ws.send(JSON.stringify({
          type: "error",
          error: { code: "PARSE_ERROR", message: "Invalid message format" }
        }));
      }
    });
    
    ws.on("close", async () => {
      clearTimeout(authTimeout);
      if (device) {
        console.log(`[WS] Device ${device.id} disconnected`);
        devices.delete(device.id);
        await db.updateDeviceStatus(device.id, "offline");
        
        // Notify other devices in same app
        broadcastToApp(device.appId, {
          type: "device_offline",
          payload: {
            deviceId: device.id,
            deviceType: device.type
          }
        });
      }
    });
    
    ws.on("error", (err) => {
      console.error("[WS] Error:", err);
    });
  });

  // 获取设备管理列表（格式化为app需要的格式）
  // 每个设备只返回一条最新记录，包含实时在线状态
  // 过滤：只返回在线设备或24小时内活跃过的设备
  function getDeviceListForApp(appId: string): any[] {
    const records = db.getDeviceManagementListSync(appId);
    const onlineIds = getOnlineDeviceIdsByAppId(appId);
    
    const now = Date.now();
    const MAX_AGE = 24 * 60 * 60 * 1000; // 24小时
    
    return records
      .filter(record => {
        // 在线设备总是显示
        if (onlineIds.has(record.deviceId)) {
          return true;
        }
        // 离线设备只显示24小时内活跃过的
        const lastActivity = record.lastDisconnectedTime || record.lastConnectedTime;
        return (now - lastActivity) < MAX_AGE;
      })
      .map(record => ({
        deviceId: record.deviceId,
        deviceName: record.deviceName,
        firstSeen: record.firstSeen,
        lastConnectedTime: record.lastConnectedTime,
        lastDisconnectedTime: record.lastDisconnectedTime,
        connectCount: record.connectCount,
        isOnline: onlineIds.has(record.deviceId), // 实时在线状态
        metadata: record.metadata
      }));
  }

  // Handle get_device_history request
  async function handleGetDeviceHistory(device: Device, msg: any) {
    if (device.type !== "app") {
      device.ws.send(JSON.stringify({
        type: "device_history",
        error: { code: "UNAUTHORIZED", message: "Only app can request device history" }
      }));
      return;
    }
    
    const devices = getDeviceListForApp(device.appId);
    
    device.ws.send(JSON.stringify({
      type: "device_history",
      payload: {
        devices: devices,
        totalCount: devices.length
      }
    }));
    
    console.log(`[DeviceManagement] Sent ${devices.length} devices to ${device.id}`);
  }

  // Handle binding between app and openclaw device
  async function handleBind(device: Device, msg: any) {
    const targetId = msg.payload?.deviceId || msg.deviceId;
    if (!targetId) {
      device.ws.send(JSON.stringify({
        type: "bind_ack",
        error: { code: "MISSING_DEVICE", message: "Target device ID required" }
      }));
      return;
    }
    
    const target = devices.get(targetId);
    if (!target) {
      device.ws.send(JSON.stringify({
        type: "bind_ack",
        error: { code: "NOT_FOUND", message: "Target device offline" }
      }));
      return;
    }
    
    // Verify same app
    if (device.appId !== target.appId) {
      device.ws.send(JSON.stringify({
        type: "bind_ack",
        error: { code: "DIFFERENT_APP", message: "Cannot bind devices from different apps" }
      }));
      return;
    }
    
    // Only app can bind to openclaw (not vice versa)
    if (device.type !== "app" || target.type !== "openclaw") {
      device.ws.send(JSON.stringify({
        type: "bind_ack",
        error: { code: "INVALID_BIND", message: "Only app can bind to openclaw" }
      }));
      return;
    }
    
    // Save binding to database
    await db.createBinding(device.id, target.id);
    device.boundTo = target.id;
    
    // Confirm to app
    device.ws.send(JSON.stringify({
      type: "bind_ack",
      deviceId: target.id,
      payload: { 
        status: "success",
        targetName: target.name,
        boundAt: Date.now()
      }
    }));
    
    // Notify openclaw device
    target.ws.send(JSON.stringify({
      type: "bound",
      deviceId: device.id,
      payload: { 
        status: "bound",
        appName: device.name,
        boundAt: Date.now()
      }
    }));
    
    console.log(`[Bind] ${device.id} (app) <-> ${target.id} (openclaw)`);
  }

  // Handle unbinding
  async function handleUnbind(device: Device, msg: any) {
    if (!device.boundTo) {
      device.ws.send(JSON.stringify({
        type: "unbind_ack",
        error: { code: "NOT_BOUND", message: "Device not bound" }
      }));
      return;
    }
    
    const target = devices.get(device.boundTo);
    
    // Remove binding from database
    await db.removeBinding(device.id, device.boundTo);
    
    // Notify target if online
    if (target) {
      target.ws.send(JSON.stringify({
        type: "unbound",
        deviceId: device.id,
        payload: { status: "unbound" }
      }));
    }
    
    device.ws.send(JSON.stringify({
      type: "unbind_ack",
      payload: { status: "success" }
    }));
    
    device.boundTo = undefined;
    console.log(`[Unbind] ${device.id}`);
  }

  // 消息安全检查配置
  const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB 最大消息大小
  const ALLOWED_MESSAGE_TYPES = ['message', 'text', 'chat', 'response', 'data', 'event', 'status'];
  
  // 危险模式检测（防止命令注入、路径遍历等）
  const DANGEROUS_PATTERNS = [
    // 命令执行相关
    /\b(rm|del|delete|format|mkfs|dd|exec|eval|system|spawn|child_process)\b/i,
    // 路径遍历
    /\.\.\//,
    /\.\.\\/,
    /%2e%2e%2f/i,
    /%252e%252e%252f/i,
    // 系统文件访问
    /\/etc\/passwd/i,
    /\/etc\/shadow/i,
    /\.ssh\//i,
    /\.aws\//i,
    /\.env/i,
    // 网络相关危险操作
    /curl\s+.*\|.*bash/i,
    /wget\s+.*\|.*sh/i,
    /nc\s+-e/i,
    /netcat.*-e/i,
    // 编码/解码绕过
    /base64\s+-d.*\|/i,
    /eval\s*\(/i,
    /Function\s*\(/i,
    // 文件操作
    /fs\.(unlink|rmdir|writeFile|appendFile)/i,
    /require\s*\(\s*['"]child_process['"]\s*\)/i,
    // 反序列化攻击
    /__proto__/,
    /constructor\s*\[/,
    // 模板注入
    /\{\{.*\}\}/,
    /<\%.*\%>/,
    // SQL 注入相关（虽然不太可能，但保险起见）
    /;\s*drop\s+table/i,
    /;\s*delete\s+from/i,
    // 环境变量访问
    /process\.env/i,
    // 潜在的远程代码执行
    /fetch\s*\(.*\)\s*\.then.*eval/i,
    /XMLHttpRequest.*eval/i,
  ];

  // 安全检查函数
  function securityCheck(from: Device, msg: any): { allowed: boolean; reason?: string } {
    // 1. 检查消息大小
    const msgSize = JSON.stringify(msg).length;
    if (msgSize > MAX_MESSAGE_SIZE) {
      return { allowed: false, reason: `Message too large: ${msgSize} bytes (max: ${MAX_MESSAGE_SIZE})` };
    }

    // 2. 对于 OpenChatBot 消息进行额外检查
    if (from.type === 'openclaw') {
      const payload = msg.payload || msg;
      const content = typeof payload === 'string' ? payload : JSON.stringify(payload);
      
      // 3. 检查危险模式
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(content)) {
          console.warn(`[Security] 🚨 Blocked dangerous pattern from ${from.id}: ${pattern}`);
          return { allowed: false, reason: 'Message contains potentially dangerous content' };
        }
      }

      // 4. 检查消息类型
      const msgType = msg.type || 'message';
      if (!ALLOWED_MESSAGE_TYPES.includes(msgType)) {
        console.warn(`[Security] ⚠️ Unusual message type from ${from.id}: ${msgType}`);
        // 不阻止，但记录警告
      }

      // 5. 深度检查 payload 结构
      if (payload && typeof payload === 'object') {
        // 禁止某些字段
        const forbiddenFields = ['__proto__', 'constructor', 'prototype', 'eval', 'exec'];
        const checkObject = (obj: any, path: string = ''): boolean => {
          if (!obj || typeof obj !== 'object') return true;
          
          for (const key of Object.keys(obj)) {
            const fullPath = path ? `${path}.${key}` : key;
            
            // 检查键名
            if (forbiddenFields.includes(key.toLowerCase())) {
              console.warn(`[Security] 🚨 Forbidden field detected: ${fullPath}`);
              return false;
            }
            
            // 检查值
            const value = obj[key];
            if (typeof value === 'string') {
              for (const pattern of DANGEROUS_PATTERNS) {
                if (pattern.test(value)) {
                  console.warn(`[Security] 🚨 Dangerous content in ${fullPath}`);
                  return false;
                }
              }
            } else if (typeof value === 'object') {
              if (!checkObject(value, fullPath)) {
                return false;
              }
            }
          }
          return true;
        };

        if (!checkObject(payload)) {
          return { allowed: false, reason: 'Payload contains forbidden fields or dangerous content' };
        }
      }

      // 6. 记录 OpenChatBot 消息（审计日志）
      console.log(`[Security] ✓ OpenChatBot message passed security check from ${from.id}`);
    }

    return { allowed: true };
  }

  // Handle message forwarding - 直接转发，不需要绑定
  async function handleMessage(from: Device, msg: any) {
    // 打印收到的消息内容
    console.log(`[Message] ═══════════════════════════════════════════`);
    console.log(`[Message] 📥 Received from ${from.id} (type: ${from.type})`);
    console.log(`[Message]    appId: ${from.appId}`);
    console.log(`[Message]    payload:`, JSON.stringify(msg.payload || msg, null, 2));

    // 执行安全检查
    const security = securityCheck(from, msg);
    if (!security.allowed) {
      console.warn(`[Security] 🚫 Message blocked from ${from.id}: ${security.reason}`);
      from.ws.send(JSON.stringify({
        type: "error",
        error: { code: "SECURITY_VIOLATION", message: "Message blocked by security policy" }
      }));
      return;
    }
    
    // 找到目标设备 - 同一 appId 下的其他设备
    let targets: Device[] = [];
    
    // 遍历所有在线设备，找到同一 appId 的其他设备
    devices.forEach((device) => {
      if (device.appId === from.appId && device.id !== from.id) {
        targets.push(device);
      }
    });
    
    // 打印所有在线设备信息（用于调试）
    console.log(`[Message] 📊 All online devices (${devices.size} total):`);
    devices.forEach((device) => {
      const isTarget = device.appId === from.appId && device.id !== from.id;
      console.log(`[Message]    - ${device.id} (type: ${device.type}, appId: ${device.appId})${isTarget ? ' [TARGET]' : ''}`);
    });
    
    if (targets.length === 0) {
      console.log(`[Message] ⚠️ No other devices online for app ${from.appId}`);
      console.log(`[Message] ═══════════════════════════════════════════`);
      from.ws.send(JSON.stringify({
        type: "error",
        error: { code: "NO_TARGET", message: "No other devices online" }
      }));
      return;
    }
    
    console.log(`[Message] 📤 Forwarding to ${targets.length} target(s):`);
    
    // 转发消息给所有目标设备（广播）
    targets.forEach((target) => {
      console.log(`[Message]    → ${target.id} (type: ${target.type})`);
      target.ws.send(JSON.stringify({
        type: "message",
        from: from.id,
        fromType: from.type,
        sessionId: msg.sessionId || `sess_${Date.now()}`,
        payload: msg.payload,
        timestamp: Date.now(),
      }));
    });
    
    // Acknowledge to sender
    const ackMessage = {
      type: "message_ack",
      sessionId: msg.sessionId,
      timestamp: Date.now(),
    };
    
    try {
      from.ws.send(JSON.stringify(ackMessage));
      console.log(`[Message] ✅ ACK sent to ${from.id}, sessionId: ${msg.sessionId}`);
    } catch (err) {
      console.error(`[Message] ❌ Failed to send ACK to ${from.id}:`, err);
    }
    
    // Log message
    const payloadPreview = JSON.stringify(msg.payload).substring(0, 100);
    console.log(`[Message] ✅ Forwarded: ${payloadPreview}...`);
    console.log(`[Message] ═══════════════════════════════════════════`);
  }

  // Handle broadcast to all devices in same app
  async function handleBroadcast(from: Device, msg: any) {
    const targets = Array.from(devices.values()).filter(
      d => d.appId === from.appId && d.id !== from.id
    );
    
    if (targets.length === 0) {
      from.ws.send(JSON.stringify({
        type: "broadcast_ack",
        error: { code: "NO_TARGETS", message: "No other devices in app" }
      }));
      return;
    }
    
    let sentCount = 0;
    targets.forEach(target => {
      if (target.ws.readyState === WebSocket.OPEN) {
        target.ws.send(JSON.stringify({
          type: "broadcast",
          from: from.id,
          fromType: from.type,
          payload: msg.payload,
          timestamp: Date.now(),
        }));
        sentCount++;
      }
    });
    
    from.ws.send(JSON.stringify({
      type: "broadcast_ack",
      payload: { 
        status: "success",
        sentCount,
        totalTargets: targets.length
      }
    }));
    
    console.log(`[Broadcast] ${from.id} -> ${sentCount}/${targets.length} devices`);
  }

  // Broadcast message to all devices of a specific app
  // filterType: 如果指定，只发送到该类型的设备
  function broadcastToApp(appId: string, message: any, filterType?: "openclaw" | "app") {
    devices.forEach(device => {
      if (device.appId === appId && device.ws.readyState === WebSocket.OPEN) {
        if (!filterType || device.type === filterType) {
          device.ws.send(JSON.stringify(message));
        }
      }
    });
  }

  // Heartbeat checker - cleanup dead connections
  setInterval(() => {
    const now = Date.now();
    const timeout = 120000; // 2 minutes
    
    devices.forEach((device) => {
      if (now - device.lastHeartbeat > timeout) {
        console.log(`[HB] Timeout: ${device.id}, last seen ${(now - device.lastHeartbeat) / 1000}s ago`);
        device.ws.close();
        devices.delete(device.id);
        db.updateDeviceStatus(device.id, "offline");
        
        broadcastToApp(device.appId, {
          type: "device_timeout",
          payload: {
            deviceId: device.id,
            deviceType: device.type
          }
        });
      }
    });
    
    console.log(`[Status] Online: ${devices.size} devices, Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)}MB`);
  }, 60000); // Check every minute

  console.log(`[Bridge] Ready on port ${PORT}! Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)}MB`);

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("[Bridge] Shutting down...");
    wss.clients.forEach(ws => ws.close());
    wss.close();
    process.exit(0);
  });
}
