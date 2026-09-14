# Home VM 102 deployment

This profile is intended for the `common` VM, not the router VM. It builds the
audited checkout locally, publishes no ports, and does not run Rewards during
startup or restart.

## Prepare the release

On the trusted development machine, use the final reviewed commit:

```bash
git status --short
git rev-parse HEAD
git bundle create microsoft-rewards-script.bundle v4
```

Copy the bundle and the Git-ignored `.env` to VM 102 over SSH. Never print the
contents of `.env`. On the VM:

```bash
install -d -m 0700 /opt/stacks/microsoft-rewards-script
cd /opt/stacks/microsoft-rewards-script
git clone /path/to/microsoft-rewards-script.bundle .
git checkout v4
install -d -m 0700 config sessions
chmod 0600 .env
```

Set `IMAGE_TAG=4.3.2-<short-commit>` in `.env`. Keep one `ACCOUNT_1_*` block,
`ACCOUNT_1_GEO_LOCALE=auto`, `ACCOUNT_1_LANG_CODE=zh-CN`, and no account proxy.
Telegram requires the four `CONFIG_TELEGRAM_*` values shown in `env.example`;
its proxy is optional and applies only to Telegram.

## Validate without running Rewards

```bash
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=100
docker compose exec microsoft-rewards-script crontab -l
docker compose exec microsoft-rewards-script npm run telegram:test
docker run --rm --entrypoint npm "microsoft-rewards-script:$(grep '^IMAGE_TAG=' .env | cut -d= -f2-)" run browser:smoke
docker compose restart
docker compose ps
```

The container must become healthy, expose no host ports, show the
`Asia/Shanghai` 07:00 cron entry, and contain no Rewards run log after startup
or restart. The browser smoke command opens only `about:blank` and does not load
`.env`.

Verify the VM egress country is China using an operator-approved IP-check
service, but do not store the full address in logs. After the first scheduled
run, inspect `ACCOUNT-END`, `RUN-END`, resource use, and the single Telegram
summary. Stop automation on CAPTCHA, manual verification, or a Microsoft
bot-score warning.
