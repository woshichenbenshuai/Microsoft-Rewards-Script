# 北京华为云部署与 Git 更新

目标服务器为 Ubuntu 22.04 / x86_64 / 2 核约 2GB 内存。闲置 K3s 已停用，主机有 2GB Swap；Vaultwarden 和 cloudflared 独立运行。

云端使用 `compose.yaml` 和 `compose.huawei.yaml`，运行容器限制 1GB 内存、内存与 Swap 合计 2GB、1 核 CPU，关闭并行搜索，使用本地搜索词源，不发布端口。构建阶段不受服务运行内存限制。`Dockerfile.huawei` 使用华为云 Debian 镜像源，仍需要访问 Docker 基础镜像、npm 和浏览器下载服务。

## 首次部署

```bash
git clone --branch v4 https://github.com/woshichenbenshuai/Microsoft-Rewards-Script.git /opt/stacks/microsoft-rewards-script
cd /opt/stacks/microsoft-rewards-script
install -m 0600 env.huawei.example .env
install -d -m 0700 config sessions
# 在服务器编辑 .env 填入独立账号与通知配置，不打印凭据。
docker compose -f compose.yaml -f compose.huawei.yaml config --quiet
docker compose -f compose.yaml -f compose.huawei.yaml build
docker compose -f compose.yaml -f compose.huawei.yaml up -d --no-build
```

家庭和云端使用不同微软账号，两边的运行记录、登录会话和调度独立。`RUN_ON_START=false`，容器启动或重启不会立即执行 Rewards，默认任务每天北京时间 07:05–07:50 开始。`config/schedule.json` 如存在，则使用其中保存的调度。

## 后续更新：先提交代码，再 git pull

源码先在开发机修改、检查、提交并推送到 `origin/v4`。服务器不手改源码，也不上传本地 dist 覆盖镜像。

```bash
cd /opt/stacks/microsoft-rewards-script
git status --short
# 确认源码无本地修改，且没有正在执行的 Rewards 任务。
git pull --ff-only origin v4
# 如需保留不同版本镜像，在 .env 设置新的 IMAGE_TAG。
docker compose -f compose.yaml -f compose.huawei.yaml build
docker compose -f compose.yaml -f compose.huawei.yaml up -d --no-build
docker compose -f compose.yaml -f compose.huawei.yaml exec -T microsoft-rewards-script npm run run-history:init
docker compose -f compose.yaml -f compose.huawei.yaml exec -T microsoft-rewards-script npm run run-history:status
docker compose -f compose.yaml -f compose.huawei.yaml ps
```

更新必须保留 `.env`、`config/` 和 `sessions/`，包含每日运行标记、安全熔断、成功天数记录、调度以及账号登录会话。这些数据由 Git 忽略。更换容器无需删除配置或重置每日限制；健康状态只说明调度正常，不代表当日 Rewards 成功。

家庭实例同样先 `git pull --ff-only origin v4`，使用基础 `compose.yaml` 构建和启动，保留家庭自己的 `.env` 和数据目录。

旧的上传源码部署迁移到 Git 时，先在同级目录 clone，备份原目录，复制上述运行数据到新 Git 检出目录，停止旧调度后切换目录；原目录保留为备份。迁移后更新都通过 Git。

## 通知与成功天数

云端通过 Cloudflare Worker 向现有 TG 机器人推送，不依赖代理或家庭设备。云端 `.env`：

```dotenv
CONFIG_TELEGRAM_ENABLED=true
CONFIG_TELEGRAM_SUMMARY_ONLY=true
CONFIG_TELEGRAM_RELAY_URL=https://your-worker-domain/notify
CONFIG_TELEGRAM_RELAY_TOKEN=独立转发密钥
```

Bot Token、Chat ID 和转发密钥保存在 Worker Secret；Cloudflare API Token 不放到服务器或源码中。家庭保持原通知路径，两边独立工作。

通知测试不会运行 Rewards：

```bash
docker compose -f compose.yaml -f compose.huawei.yaml exec -T microsoft-rewards-script npm run telegram:test
```

程序成功天数的规则与初始化方式见 [成功天数说明](program-success-days.md)，Worker 配置见 [Cloudflare Telegram 转发](cloudflare-telegram-relay.md)。

2026-10-10 云端已确认一次完整成功：50 → 370，获得 320 积分，耗时约 16 分钟；随后 Worker 测试和成功摘要已送达 TG。更新不再运行当日任务。家庭与云端首次引入天数统计时，各自从最后已确认的成功日开始，不推算未知历史。

## 任务卡住与超时通知

云端 `MAX_RUN_MINUTES=120`，实际程序运行超过两小时后，调度脚本使用 GNU timeout 向整个任务进程组发送 TERM，30 秒后仍未退出则强制结束。随机等待时间不包含在两小时内。超时后保存未完成状态并通过既有 TG 通道告警；不清除每日标记、不增加成功天数，也不自动重跑。该保护适用于默认调度模式（API_MODE=false），并使用独立进程计时，浏览器 RPC 卡住也会生效。未配置该变量的普通部署默认上限为 480 分钟，与原有过期锁阈值一致。

Bing 搜索页面导航显式等待 DOMContentLoaded，最多等待 30 秒，避免等待网页全部资源加载完成。整次任务的超时保护仍作为浏览器接口异常挂起时的兜底。
