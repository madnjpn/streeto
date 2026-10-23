# RockAuto Service for STREETO

A FastAPI microservice that wraps the [rockauto-api](https://github.com/rsp2k/rockauto-api) Python library, providing a REST API for the STREETO Node.js application.

## Architecture

```
┌─────────────────┐     HTTP      ┌──────────────────┐
│  STREETO (Node) │ ────────────► │  RockAuto Service │
│  (port 443/3000)│               │  (Python/FastAPI) │
└─────────────────┘               │  (port 8001)      │
                                  └────────┬──────────┘
                                           │
                                           ▼
                                  ┌──────────────────┐
                                  │  RockAuto.com     │
                                  │  (catalog API)    │
                                  └──────────────────┘
```

## Portable Python Setup

The `python-portable/` folder is a self-contained Python 3.12 virtual environment with all dependencies pre-installed. This enables **zero-install deployment** - just copy the entire `streeto` folder to any server and run.

### Creating the Portable Environment (One-time Setup)

```bash
# Windows
python -m venv python-portable
python-portable\Scripts\pip.exe install -r requirements.txt

# Linux/macOS
python3 -m venv python-portable
python-portable/bin/pip install -r requirements.txt
```

### What's Included

- Python 3.12 interpreter (copied from system)
- All dependencies from `requirements.txt`:
  - `fastapi`, `uvicorn` - Web framework
  - `rockauto-api` - RockAuto client library
  - `httpx`, `beautifulsoup4`, `pydantic` - Dependencies

### Moving to Another Server

1. Copy the entire `streeto` folder (including `rockauto-service/python-portable/`)
2. Run the startup script:
   - Windows: `start-rockauto.bat`
   - Linux/macOS: `./start-rockauto.sh`
3. No Python installation needed on target server

### Updating Dependencies

```bash
# Windows
python-portable\Scripts\pip.exe install -r requirements.txt --upgrade

# Linux/macOS
python-portable/bin/pip install -r requirements.txt --upgrade
```

---

## Quick Start

### Option 1: Docker (Recommended for Production)

```bash
cd rockauto-service
cp .env.example .env
# Edit .env with your settings
docker-compose up -d
```

### Option 2: Portable Python (Zero-Install, Copy-Paste Deploy)

The `python-portable/` folder contains a self-contained Python environment with all dependencies. **No system Python install required.**

**Windows:**
```cmd
cd rockauto-service
start-rockauto.bat
```

**Linux/macOS:**
```bash
cd rockauto-service
chmod +x start-rockauto.sh
./start-rockauto.sh
```

### Option 3: Native Python (Development)

If you prefer using system Python:

## Configuration

Copy `.env.example` to `.env` and edit:

```env
SERVICE_HOST=0.0.0.0
SERVICE_PORT=8001
CORS_ORIGINS=https://streeto.net,http://localhost:3000
ROCKAUTO_EMAIL=your@email.com        # Optional: for authenticated features
ROCKAUTO_PASSWORD=your_password      # Optional
LOG_LEVEL=INFO
```

## API Endpoints

### Health & Status
- `GET /health` - Basic health check
- `GET /status` - Detailed status including auth state

### Vehicle Data
- `GET /makes` - All makes
- `GET /years/{make}` - Years for a make
- `GET /models/{make}/{year}` - Models for make/year
- `GET /engines/{make}/{year}/{model}` - Engines for make/year/model

### Parts
- `GET /categories/{make}/{year}/{model}/{engine}` - Part categories
- `GET /parts/{make}/{year}/{model}/{engine}/{category}?subcategory=` - Parts
- `GET /search?q=` - Search by part number/name

## Integration with STREETO

### 1. Set Environment Variable
In your STREETO `.env.production`:
```env
ROCKAUTO_SERVICE_URL=http://localhost:8001
# Or for Docker: ROCKAUTO_SERVICE_URL=http://rockauto-service:8001
```

### 2. The Node.js app will automatically use the service
The `rockauto-client.js` wrapper detects `ROCKAUTO_SERVICE_URL` and switches between:
- **Service mode** (when `ROCKAUTO_SERVICE_URL` is set): Calls the Python microservice
- **Built-in mode** (default): Uses the original Node.js `rockauto.js` client

### 3. No code changes needed in routes
The API routes (`api.js`) use `getRockAutoClient()` which transparently uses whichever client is active.

## Deployment to New Server

### One-liner Setup
```bash
# Clone the repo
git clone <repo> streeto
cd streeto/rockauto-service

# Copy env and configure
cp .env.example .env
# Edit .env with your settings

# Start with Docker
docker-compose up -d

# Or start natively
./start-rockauto.sh
```

### Systemd Service (Linux)
Create `/etc/systemd/system/streeto-rockauto.service`:
```ini
[Unit]
Description=STREETO RockAuto Service
After=network.target

[Service]
Type=simple
User=streeto
WorkingDirectory=/home/streeto/streeto/rockauto-service
Environment=PATH=/home/streeto/streeto/rockauto-service/venv/bin
ExecStart=/home/streeto/streeto/rockauto-service/venv/bin/python main.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable streeto-rockauto
sudo systemctl start streeto-rockauto
```

## Testing

```bash
# Health check
curl http://localhost:8001/health

# Status
curl http://localhost:8001/status

# Get makes
curl http://localhost:8001/makes

# Search parts
curl "http://localhost:8001/search?q=brake%20pads"
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "RockAuto service timeout" | Increase `TIMEOUT` in `rockauto-service.js` or check network |
| "RockAuto service error 503" | Check if Python service is running: `docker ps` or `systemctl status` |
| CORS errors | Add your domain to `CORS_ORIGINS` in `.env` |
| Auth fails | Check `ROCKAUTO_EMAIL`/`ROCKAUTO_PASSWORD` in `.env` |

## Development

```bash
# Install dev dependencies
pip install -r requirements.txt pytest pytest-asyncio

# Run tests
pytest tests/ -v

# Run with auto-reload
uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

## License

MIT - Part of the STREETO project.