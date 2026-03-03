/**
 * In-Memory Database Service - No native dependencies
 * 支持设备管理和审计日志持久化到磁盘
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

interface Device {
  id: string;
  appId: string;
  type: string;
  name: string;
  status: 'online' | 'offline';
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

// 设备管理记录 - 每个设备只保留一条最新记录
interface DeviceManagementRecord {
  deviceId: string;
  deviceName: string;
  appId: string;
  firstSeen: number;
  lastConnectedTime: number;
  lastDisconnectedTime?: number;
  connectCount: number;
  isOnline: boolean;
  metadata?: Record<string, unknown>;
}

// 审计日志记录
interface AuditLogRecord {
  id: string;
  timestamp: number;
  eventType: 'connect' | 'disconnect' | 'message' | 'bind' | 'unbind';
  appDeviceId?: string;
  appDeviceName?: string;
  openclawDeviceId?: string;
  openclawDeviceName?: string;
  appId: string;
  details?: Record<string, unknown>;
}

interface Binding {
  id: number;
  appDeviceId: string;
  openclawDeviceId: string;
  createdAt: number;
}

interface Session {
  id: string;
  appDeviceId: string;
  openclawDeviceId: string;
  status: 'active' | 'closed';
  createdAt: number;
  lastMessageAt: number;
}

// 数据持久化文件路径
const DATA_DIR = process.env.DB_DIR || process.env.DATA_DIR || './data';
const DEVICE_MANAGEMENT_FILE = join(DATA_DIR, 'device-management.json');
const AUDIT_LOG_FILE = join(DATA_DIR, 'audit-log.jsonl');

class DatabaseService {
  private devices: Map<string, Device> = new Map();
  private bindings: Binding[] = [];
  private sessions: Map<string, Session> = new Map();
  private deviceManagement: Map<string, DeviceManagementRecord> = new Map();
  private nextBindingId = 1;

  async connect(): Promise<void> {
    // 确保数据目录存在
    this.ensureDataDir();
    // 加载设备管理数据
    this.loadDeviceManagement();
    console.log('[DB] In-memory database ready');
  }

  // 确保数据目录存在
  private ensureDataDir(): void {
    if (!existsSync(DATA_DIR)) {
      try {
        mkdirSync(DATA_DIR, { recursive: true });
        console.log(`[DB] Created data directory: ${DATA_DIR}`);
      } catch (err) {
        console.error(`[DB] Failed to create data directory: ${err}`);
      }
    }
  }

  // 加载设备管理数据
  private loadDeviceManagement(): void {
    try {
      if (existsSync(DEVICE_MANAGEMENT_FILE)) {
        const data = readFileSync(DEVICE_MANAGEMENT_FILE, 'utf-8');
        const records: DeviceManagementRecord[] = JSON.parse(data);
        records.forEach(record => {
          this.deviceManagement.set(record.deviceId, record);
        });
        console.log(`[DB] Loaded ${records.length} device management records`);
      } else {
        console.log('[DB] No device management file found, starting fresh');
      }
    } catch (err) {
      console.error('[DB] Failed to load device management:', err);
    }
  }

  // 保存设备管理数据到磁盘
  private saveDeviceManagement(): void {
    try {
      this.ensureDataDir();
      const records = Array.from(this.deviceManagement.values());
      writeFileSync(DEVICE_MANAGEMENT_FILE, JSON.stringify(records, null, 2), 'utf-8');
      console.log(`[DB] Saved ${records.length} device management records`);
    } catch (err) {
      console.error('[DB] Failed to save device management:', err);
    }
  }

  // 添加审计日志
  private addAuditLog(record: Omit<AuditLogRecord, 'id'>): void {
    try {
      this.ensureDataDir();
      const logEntry: AuditLogRecord = {
        ...record,
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      };
      // 使用 JSON Lines 格式追加写入
      appendFileSync(AUDIT_LOG_FILE, JSON.stringify(logEntry) + '\n', 'utf-8');
    } catch (err) {
      console.error('[DB] Failed to write audit log:', err);
    }
  }

  async createDevice(device: {
    id: string;
    appId: string;
    type: string;
    name: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const now = Date.now();
    this.devices.set(device.id, {
      id: device.id,
      appId: device.appId,
      type: device.type,
      name: device.name,
      status: 'online',
      metadata: device.metadata,
      createdAt: now,
      updatedAt: now,
    });

    // 如果是openclaw设备，更新设备管理记录
    if (device.type === 'openclaw') {
      this.updateDeviceManagement(device.id, device.name, device.appId, true, device.metadata);
    }

    // 记录连接审计日志
    this.addAuditLog({
      timestamp: now,
      eventType: 'connect',
      openclawDeviceId: device.type === 'openclaw' ? device.id : undefined,
      openclawDeviceName: device.type === 'openclaw' ? device.name : undefined,
      appId: device.appId,
      details: { deviceType: device.type, deviceName: device.name },
    });
  }

  // 更新或创建设备管理记录
  private updateDeviceManagement(
    deviceId: string,
    deviceName: string,
    appId: string,
    isOnline: boolean,
    metadata?: Record<string, unknown>
  ): void {
    const now = Date.now();
    const existing = this.deviceManagement.get(deviceId);

    if (existing) {
      // 更新现有记录
      existing.deviceName = deviceName;
      existing.lastConnectedTime = now;
      existing.connectCount += 1;
      existing.isOnline = isOnline;
      existing.appId = appId;
      if (metadata) {
        existing.metadata = { ...existing.metadata, ...metadata };
      }
    } else {
      // 创建新记录
      const newRecord: DeviceManagementRecord = {
        deviceId,
        deviceName,
        appId,
        firstSeen: now,
        lastConnectedTime: now,
        connectCount: 1,
        isOnline,
        metadata,
      };
      this.deviceManagement.set(deviceId, newRecord);
    }

    // 保存到磁盘
    this.saveDeviceManagement();
    console.log(`[DB] Updated device management for ${deviceId}, isOnline: ${isOnline}`);
  }

  // 设备断开连接
  async updateDeviceStatus(deviceId: string, status: 'online' | 'offline'): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) {
      device.status = status;
      device.updatedAt = Date.now();

      // 更新设备管理记录
      const record = this.deviceManagement.get(deviceId);
      if (record) {
        record.isOnline = status === 'online';
        if (status === 'offline') {
          record.lastDisconnectedTime = Date.now();
        }
        this.saveDeviceManagement();
      }

      // 记录断开审计日志
      this.addAuditLog({
        timestamp: Date.now(),
        eventType: 'disconnect',
        openclawDeviceId: device.type === 'openclaw' ? deviceId : undefined,
        openclawDeviceName: device.type === 'openclaw' ? device.name : undefined,
        appId: device.appId,
        details: { deviceType: device.type, status },
      });
    }
  }

  // 获取设备管理列表（每个设备只返回一条最新记录）
  async getDeviceManagementList(appId: string): Promise<DeviceManagementRecord[]> {
    return this.getDeviceManagementListSync(appId);
  }

  // 获取设备管理列表（同步）
  getDeviceManagementListSync(appId: string): DeviceManagementRecord[] {
    return Array.from(this.deviceManagement.values())
      .filter(record => record.appId === appId)
      .sort((a, b) => b.lastConnectedTime - a.lastConnectedTime);
  }

  // 获取审计日志
  async getAuditLogs(appId: string, limit: number = 100): Promise<AuditLogRecord[]> {
    try {
      if (!existsSync(AUDIT_LOG_FILE)) {
        return [];
      }
      const data = readFileSync(AUDIT_LOG_FILE, 'utf-8');
      const logs: AuditLogRecord[] = data
        .trim()
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line))
        .filter(log => log.appId === appId)
        .slice(-limit);
      return logs;
    } catch (err) {
      console.error('[DB] Failed to read audit logs:', err);
      return [];
    }
  }

  // 获取所有设备管理记录（用于调试）
  async getAllDeviceManagement(): Promise<DeviceManagementRecord[]> {
    return Array.from(this.deviceManagement.values())
      .sort((a, b) => b.lastConnectedTime - a.lastConnectedTime);
  }

  async getDevice(deviceId: string): Promise<Device | undefined> {
    return this.devices.get(deviceId);
  }

  async getDevicesByAppId(appId: string): Promise<Device[]> {
    return Array.from(this.devices.values()).filter(
      d => d.appId === appId && d.status === 'online'
    );
  }

  async createBinding(appDeviceId: string, openclawDeviceId: string): Promise<void> {
    const existing = this.bindings.find(
      b => b.appDeviceId === appDeviceId && b.openclawDeviceId === openclawDeviceId
    );
    if (!existing) {
      this.bindings.push({
        id: this.nextBindingId++,
        appDeviceId,
        openclawDeviceId,
        createdAt: Date.now(),
      });
    }
  }

  async removeBinding(appDeviceId: string, openclawDeviceId: string): Promise<void> {
    this.bindings = this.bindings.filter(
      b => !(b.appDeviceId === appDeviceId && b.openclawDeviceId === openclawDeviceId)
    );
  }

  async getBoundOpenclawDevice(appDeviceId: string): Promise<Device | undefined> {
    const binding = this.bindings.find(b => b.appDeviceId === appDeviceId);
    if (binding) {
      const device = this.devices.get(binding.openclawDeviceId);
      if (device && device.status === 'online') {
        return device;
      }
    }
    return undefined;
  }

  async createSession(session: { id: string; appDeviceId: string; openclawDeviceId: string }): Promise<void> {
    const now = Date.now();
    this.sessions.set(session.id, {
      id: session.id,
      appDeviceId: session.appDeviceId,
      openclawDeviceId: session.openclawDeviceId,
      status: 'active',
      createdAt: now,
      lastMessageAt: now,
    });
  }

  async updateSessionLastMessage(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastMessageAt = Date.now();
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'closed';
    }
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    const session = this.sessions.get(sessionId);
    if (session && session.status === 'active') {
      return session;
    }
    return undefined;
  }

  async getStats(): Promise<{ totalDevices: number; onlineDevices: number; activeSessions: number; deviceManagementCount: number }> {
    const allDevices = Array.from(this.devices.values());
    const onlineDevices = allDevices.filter(d => d.status === 'online');
    const activeSessions = Array.from(this.sessions.values()).filter(s => s.status === 'active');

    return {
      totalDevices: allDevices.length,
      onlineDevices: onlineDevices.length,
      activeSessions: activeSessions.length,
      deviceManagementCount: this.deviceManagement.size,
    };
  }
}

export const db = new DatabaseService();
export type { DeviceManagementRecord, AuditLogRecord };
