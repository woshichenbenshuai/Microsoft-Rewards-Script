# Cloudflare Worker Telegram 通知

链路：北京服务器 → HTTPS Worker → Telegram Bot API。
只传任务通知文本（包含用户要求显示的完整账号邮箱），不传密码、Cookie 或浏览器会话。
家庭部署和云端部署分别运行，不依赖对方的设备、SSH 或代理。

Worker 源码：scripts/cloudflare/telegram-relay.mjs。
当前部署名称 rewards-telegram-relay，自定义域名 rewards-tg.970907.xyz。
workers.dev 和预览地址已关闭，不改变其他 Worker 或域名。

## Worker Secret

在 Cloudflare Worker 中配置三个 Secret：

- TELEGRAM_BOT_TOKEN：机器人 Token。
- TELEGRAM_CHAT_ID：固定接收聊天。
- RELAY_TOKEN：独立随机密钥，与云端环境变量保持一致。

Cloudflare API Token 只用于部署，不放入 Worker 或云服务器。
Worker 只接受 POST /notify，要求 Authorization: Bearer RELAY_TOKEN。
调用者只能提供通知文本和可选消息格式，不能选择聊天、机器人或目标 URL。
未认证请求返回 401，超大请求及非法消息拒绝，服务端错误不回显密钥。
GET /health 只显示服务健康信息。

## 云端环境

```dotenv
CONFIG_TELEGRAM_ENABLED=true
CONFIG_TELEGRAM_SUMMARY_ONLY=true
CONFIG_TELEGRAM_RELAY_URL=https://rewards-tg.970907.xyz/notify
CONFIG_TELEGRAM_RELAY_TOKEN=填写独立转发密钥
```

使用 Worker 时云端不需要 CONFIG_TELEGRAM_BOTTOKEN、CONFIG_TELEGRAM_CHATID
或 CONFIG_TELEGRAM_PROXY_URL。未配置 relay 时仍支持原有直连或代理方式。
不将 relay 密钥写入 Compose、源码或持久化 config.json。

重建容器后测试，不运行积分任务：

```bash
docker compose -f compose.yaml -f compose.huawei.yaml up -d --no-build
docker compose -f compose.yaml -f compose.huawei.yaml exec -T microsoft-rewards-script npm run telegram:test
```

消息带“北京华为云”来源标识。轮换 RELAY_TOKEN 时同时更新 Worker Secret
和云端 .env，再重建容器；不需要改家庭实例。

## 验证

2026-10-10 已从北京服务器验证健康检查 200、未认证 POST 401、
认证 POST 200，以及项目通知命令和实际 320 分收益摘要成功送达 TG。
本地 Node 24 构建、lint、Telegram 测试 11/11 和 Worker 测试 4/4 通过。
Worker 地址的国内可达性仍取决于网络，健康检查成功不替代实际发送验证。

```bash
npm run test:telegram
node --test scripts/cloudflare/telegram-relay.test.mjs
```
