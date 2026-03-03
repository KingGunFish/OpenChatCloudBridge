#!/usr/bin/env node
/**
 * Cloud Bridge CLI Tool
 * 用于生成和管理 APP_TOKEN
 */

import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// 固定的哈希算法 - 使用 SHA-256
export function generateAppToken(secretKey: string): string {
  return createHash("sha256").update(secretKey).digest("hex");
}

// 验证密钥格式: 8-64位，只允许数字和字母
export function validateSecretKey(key: string): { valid: boolean; message: string } {
  if (!key || key.length === 0) {
    return { valid: false, message: "密钥不能为空" };
  }

  if (key.length < 8) {
    return { valid: false, message: "密钥长度不能少于 8 位" };
  }

  if (key.length > 64) {
    return { valid: false, message: "密钥长度不能超过 64 位" };
  }

  // 只允许数字和字母
  const validPattern = /^[a-zA-Z0-9]+$/;
  if (!validPattern.test(key)) {
    return { valid: false, message: "密钥只能包含数字和字母（a-z, A-Z, 0-9）" };
  }

  return { valid: true, message: "密钥格式正确" };
}

// 提示用户输入密钥
async function promptForSecretKey(): Promise<string> {
  return new Promise((resolve) => {
    console.log("\n═══════════════════════════════════════════════════");
    console.log("  Cloud Bridge - APP_TOKEN 生成工具");
    console.log("═══════════════════════════════════════════════════\n");
    console.log("请输入自定义密钥（8-64位，仅数字和字母）：");
    console.log("此密钥将用于生成 APP_TOKEN，请妥善保管！\n");

    rl.question("密钥: ", (key) => {
      resolve(key.trim());
    });
  });
}

// 确认密钥
async function confirmSecretKey(key: string): Promise<boolean> {
  return new Promise((resolve) => {
    console.log("\n┌─────────────────────────────────────────────────┐");
    console.log(`│ 密钥: ${key.padEnd(44)} │`);
    console.log(`│ 长度: ${String(key.length).padEnd(44)} │`);
    console.log("└─────────────────────────────────────────────────┘\n");

    rl.question("确认使用此密钥生成 APP_TOKEN? (yes/no): ", (answer) => {
      resolve(answer.toLowerCase() === "yes" || answer.toLowerCase() === "y");
    });
  });
}

// 保存到 .env 文件
function saveToEnv(appToken: string, port: number = 18789): void {
  const envPath = join(process.cwd(), ".env");

  const envContent = `# Cloud Bridge Lite Configuration
PORT=${port}
APP_SECRET=${appToken}
NODE_ENV=production
DB_DIR=./data
`;

  writeFileSync(envPath, envContent, "utf-8");
  console.log(`\n✅ APP_TOKEN 已保存到: ${envPath}`);
}

// 显示 APP_TOKEN 信息
function displayAppToken(secretKey: string, appToken: string): void {
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  APP_TOKEN 生成成功");
  console.log("═══════════════════════════════════════════════════\n");

  console.log("┌─────────────────────────────────────────────────┐");
  console.log(`│ 原始密钥: ${"*".repeat(Math.min(secretKey.length, 40)).padEnd(38)} │`);
  console.log(`│ APP_TOKEN: ${appToken.substring(0, 20)}...${appToken.substring(appToken.length - 8)} │`);
  console.log(`│ 长度: ${String(appToken.length).padEnd(45)} │`);
  console.log("└─────────────────────────────────────────────────┘\n");

  console.log("⚠️  重要提示:");
  console.log("   1. 请牢记您的原始密钥，它无法从 APP_TOKEN 反向推导");
  console.log("   2. 客户端（App）需要输入相同的密钥来生成 APP_TOKEN");
  console.log("   3. 如果忘记密钥，需要重新运行 setup 生成新的密钥对\n");
}

// Setup 命令
async function setupCommand(): Promise<void> {
  try {
    // 检查是否已存在 .env
    const envPath = join(process.cwd(), ".env");
    if (existsSync(envPath)) {
      const existingEnv = readFileSync(envPath, "utf-8");
      const hasSecret = existingEnv.includes("APP_SECRET=") && 
                        !existingEnv.includes("APP_SECRET=placeholder") &&
                        !existingEnv.includes("# 请运行");

      if (hasSecret) {
        const existingSecret = existingEnv
          .split("\n")
          .find((line) => line.startsWith("APP_SECRET="))
          ?.split("=")[1];

        console.log("\n⚠️  检测到已存在的 APP_TOKEN:");
        console.log(`   ${existingSecret?.substring(0, 20)}...`);

        const answer = await new Promise<string>((resolve) => {
          rl.question("\n是否重新生成? (yes/no): ", resolve);
        });

        if (answer.toLowerCase() !== "yes" && answer.toLowerCase() !== "y") {
          console.log("\n已取消，保持现有配置。");
          rl.close();
          return;
        }
      }
    }

    // 获取密钥
    let secretKey: string;
    let isValid = false;

    while (!isValid) {
      secretKey = await promptForSecretKey();
      const validation = validateSecretKey(secretKey);

      if (!validation.valid) {
        console.log(`\n❌ 错误: ${validation.message}\n`);
        continue;
      }

      isValid = true;
    }

    // 确认密钥
    const confirmed = await confirmSecretKey(secretKey!);
    if (!confirmed) {
      console.log("\n已取消。");
      rl.close();
      return;
    }

    // 生成 APP_TOKEN
    const appToken = generateAppToken(secretKey!);

    // 显示结果
    displayAppToken(secretKey!, appToken);

    // 保存到 .env
    saveToEnv(appToken);

    console.log("\n🎉 设置完成！");
    console.log("   您现在可以启动服务: npm start\n");

  } catch (error) {
    console.error("\n❌ 错误:", error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Verify 命令 - 验证密钥是否匹配 APP_TOKEN
async function verifyCommand(): Promise<void> {
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  验证密钥与 APP_TOKEN 匹配");
  console.log("═══════════════════════════════════════════════════\n");

  const secretKey = await new Promise<string>((resolve) => {
    rl.question("请输入密钥: ", resolve);
  });

  const validation = validateSecretKey(secretKey.trim());
  if (!validation.valid) {
    console.log(`\n❌ 错误: ${validation.message}`);
    rl.close();
    return;
  }

  const appToken = generateAppToken(secretKey.trim());

  console.log("\n生成的 APP_TOKEN:");
  console.log(appToken);
  console.log("\n请将此值与服务器 .env 文件中的 APP_SECRET 比较。");
  console.log("如果一致，则密钥正确。\n");

  rl.close();
}

// Help 命令
function showHelp(): void {
  console.log(`
Cloud Bridge CLI Tool

用法:
  npx tsx src/cli.ts <command>

命令:
  setup     交互式设置 APP_TOKEN（推荐）
  verify    验证密钥是否匹配 APP_TOKEN
  help      显示帮助信息

示例:
  # 设置 APP_TOKEN
  npm run setup

  # 验证密钥
  npx tsx src/cli.ts verify

注意:
  - 密钥长度必须在 8-64 位之间
  - 密钥只能包含数字和字母（a-z, A-Z, 0-9）
  - 相同的密钥始终生成相同的 APP_TOKEN
`);
}

// 主函数
async function main(): Promise<void> {
  const command = process.argv[2] || "help";

  switch (command) {
    case "setup":
      await setupCommand();
      break;
    case "verify":
      await verifyCommand();
      break;
    case "help":
    case "--help":
    case "-h":
      showHelp();
      rl.close();
      break;
    default:
      console.log(`\n❌ 未知命令: ${command}`);
      showHelp();
      rl.close();
      process.exit(1);
  }
}

// 如果直接运行此文件（ES Module 方式检测）
const isMain = import.meta.url === `file://${process.argv[1]}` || 
               process.argv[1]?.endsWith('cli.ts') ||
               process.argv[1]?.endsWith('cli.js');
if (isMain) {
  main();
}
