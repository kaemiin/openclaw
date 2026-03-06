# PatiscoMantisShrimp

For AI Agent

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
