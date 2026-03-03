# Portal Hub

Single-file browser hub served by a lightweight Node server.

## Run locally

```bash
npm start
```

Open `http://localhost:8000`.

## Deploy on Koyeb

This repo is ready for Koyeb deployment with a Dockerfile.

1. Push this folder to a GitHub/GitLab repository.
2. In Koyeb, click **Create App** -> **Web Service** -> **Git repository**.
3. Select this repository.
4. Build settings:
   - **Builder**: Dockerfile
   - **Dockerfile path**: `Dockerfile`
5. Service settings:
   - **HTTP Port**: `8000` (or keep auto-detect)
   - **Environment Variables**: optional (`PORT` is auto-managed by Koyeb and supported by `server.js`)
6. Deploy.

### Why this works on Koyeb

- `server.js` listens on `process.env.PORT` (required for Koyeb runtime).
- `Dockerfile` builds a minimal Node container and starts the app with `npm start`.
- `package.json` includes a `start` script so runtime command is explicit.
