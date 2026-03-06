# PatiscoMantisShrimp

For AI Agent

## RUN

Setup

```
pnpm install

pnpm ui:build

pnpm build

pnpm openclaw onboard --install-daemon

pnpm openclaw gateway

pnpm openclaw devices list

openclaw devices approve XXXX

openclaw security audit

openclaw pairing list telegram

openclaw pairing approve telegram 9V8XU2J8


git add .
git commit -m "initial"
git push -u origin main

我是 Kyle，來自台灣 Taiwan (R.O.C.)，1977 年 1 月生，男性，未婚，一名程式設計師。而你: 我的朋友，你是一個基於 openclaw 建置的 AI Agent，以下是想想告訴你的事 -
你目前運行在 Github Codespaces 上，儲存庫位置： https://github.com/kaemiin/MyMantisShrimp.git，目前當前位置是： /app ，請以繁體中文與我溝通，很高興認識你。
```

Update

```
openclaw update
```

Run

```
openclaw gateway
```

Configuration

```
cp /app/openclaw.json /root/.openclaw/openclaw.json
```

## Packaging and Deployment

### 1. Build Core (Required for all steps)

Ensure all dependencies are installed and core components are built:

```bash
pnpm install
pnpm ui:build
pnpm build
```

### 2. Platform Packaging

Build application bundles for specific platforms:

- **macOS (.app):** `pnpm mac:package`
- **Android (APK):** `pnpm android:assemble`
- **iOS:** `pnpm ios:build`

### 3. Deployment

#### Docker

Run with Docker Compose:

```bash
docker-compose up -d
```

#### Cloud Deployment

- **Fly.io:** `fly deploy` (uses `fly.toml`)
- **VPS (System Service):**
  ```bash
  pnpm openclaw onboard --install-daemon
  pnpm openclaw gateway
  ```

For detailed guides on **Railway, Northflank, Oracle Cloud, GCP, and AWS**, see [docs/vps.md](./docs/vps.md).
