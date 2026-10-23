# StellarCert Docker Startup Guide

## Quick Start

To start the entire StellarCert application using Docker Compose:

```bash
# Start all services in development mode
docker-compose up --build

# Start services in detached mode (run in background)
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Stop and remove volumes (clean restart)
docker-compose down -v
```

## Service URLs

Once all services are running, you can access:

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000
- **Health Check**: http://localhost:3000/api/v1/health
- **Metrics**: http://localhost:3000/metrics (if enabled)

## Optional Services

### Production Mode (with Nginx)

```bash
# Start with Nginx reverse proxy
docker-compose --profile production up --build
```

### Monitoring (with Prometheus)

```bash
# Start with Prometheus monitoring
docker-compose --profile monitoring up --build
```

### Production + Monitoring

```bash
# Start with both Nginx and Prometheus
docker-compose --profile production --profile monitoring up --build
```

## Environment Configuration

### Required Environment Variables

Create a .env file in the project root with the following variables:

```bash
# Stellar Configuration
STELLAR_ISSUER_SECRET_KEY=your_stellar_secret_key_here
STELLAR_ISSUER_PUBLIC_KEY=your_stellar_public_key_here

# JWT Configuration
# REQUIRED: JWT_SECRET has no default. The stack will fail fast at startup
# if it is unset, preventing production mode from signing/verifying JWTs
# with a publicly known secret. Generate a strong value, e.g.:
#   openssl rand -hex 32
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRES_IN=3600

# Database Credentials
# REQUIRED: DB credentials are sourced from secrets and have no hardcoded
# fallback. Set these (or provide them via Docker secrets) before starting.
POSTGRES_USER=stellarwave_user
POSTGRES_PASSWORD=your_db_password_here
POSTGRES_DB=stellarwave

# Optional: Sentry for error tracking
SENTRY_DSN=https://your_sentry_dsn@sentry.io/project_id

# Optional: Email configuration
EMAIL_SERVICE=smtp
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USERNAME=your_email@example.com
EMAIL_PASSWORD=your_email_password
EMAIL_FROM=noreply@example.com
```

### Using the Example Environment File

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your specific configuration
```

## Service Dependencies

The services start in the following order:

1. **PostgreSQL** - Database service
2. **Redis** - Cache and job queue service
3. **Backend** - API service (waits for database and Redis)
4. **Frontend** - Web application (waits for backend)

## Database Migrations

TypeORM migrations are run automatically by the backend container on every
startup (via `docker-entrypoint.sh`). The flow is:

1. Docker Compose waits for the Postgres health-check to pass (`pg_isready`).
2. The backend container starts and executes `docker-entrypoint.sh`.
3. The script runs `typeorm migration:run -d dist/database/data-source.js`,
   applying any pending migrations in timestamp order.
4. If migrations succeed the NestJS application starts normally.
5. If migrations fail the container exits with a non-zero code, keeping the
   app offline until the issue is resolved — no silent schema mismatch.

**Why not the Postgres `initdb.d` directory?**  
The Postgres image only executes top-level `.sql` and `.sh` files in
`/docker-entrypoint-initdb.d/` and only on the very first container startup
(empty data volume). TypeORM migrations are TypeScript source files, not SQL,
and nesting them inside a subdirectory means the image ignores them entirely.
Running migrations from the backend container is the correct approach, so the
backend no longer bind-mounts migrations into the Postgres init directory.

**Running migrations manually** (e.g. after a hotfix):

```bash
# Build first so dist/database/data-source.js exists
docker-compose exec backend sh -c "node node_modules/.bin/typeorm migration:run -d dist/database/data-source.js"

# Roll back the last migration
docker-compose exec backend sh -c "node node_modules/.bin/typeorm migration:revert -d dist/database/data-source.js"

# Show migration status
docker-compose exec backend sh -c "node node_modules/.bin/typeorm migration:show -d dist/database/data-source.js"
```

**Generating a new migration** (local dev, not inside Docker):

```bash
cd backend
npm run build
npm run migration:generate -- src/database/migrations/MyDescriptiveName
```

## Troubleshooting

### Common Issues

1. **Port conflicts**: Ensure ports 5432, 6379, 3000, and 5173 are available
2. **Environment variables**: Check that all required environment variables are set
3. **Database migrations**: The backend container runs `typeorm migration:run`
   automatically on every startup via `docker-entrypoint.sh`. Migrations are
   idempotent — already-applied migrations are skipped. If migrations fail the
   container exits with a non-zero code and Docker will not start the app
   process, making the failure visible in the logs.

### Reset Everything

```bash
# Stop all services
docker-compose down

# Remove all volumes (this will delete your data)
docker-compose down -v

# Remove all images
docker-compose down --rmi all

# Start fresh
docker-compose up --build
```

### View Service Status

```bash
# Check service status
docker-compose ps

# View logs for a specific service
docker-compose logs backend
docker-compose logs frontend
docker-compose logs postgres
docker-compose logs redis

# Follow logs in real-time
docker-compose logs -f backend
```

## Development Workflow

### Making Changes

1. **Frontend changes**: The frontend container will automatically reload
2. **Backend changes**: You may need to restart the backend service:
   ```bash
   docker-compose restart backend
   ```
3. **Database changes**: You may need to rebuild:
   ```bash
   docker-compose up --build --force-recreate backend
   ```

### Database Access

```bash
# Connect to PostgreSQL
docker-compose exec postgres psql -U stellarwave_user -d stellarwave

# Connect to Redis
docker-compose exec redis redis-cli
```

## Production Deployment

For production deployment:

1. Set `NODE_ENV=production` in your `.env` file
2. Set a strong, unique `JWT_SECRET` (there is no insecure default; startup
   fails fast if it is unset) and provide DB credentials via secrets rather
   than hardcoded values
3. Use the production profile:
   ```bash
   docker-compose --profile production up -d
   ```
4. Configure SSL certificates in the `nginx/ssl` directory
5. Update the `nginx/nginx.conf` file with your domain configuration

## Backend Image Build (Dependency Installation)

The backend `Dockerfile` is deterministic and produces a toolchain-free
runtime image:

- **Reproducible installs**: both the build stage and the production stage run
`npm ci` (against the committed `package-lock.json`) instead of `npm install`, so a
change to the lockfile is the only thing that changes the resolved dependency tree.
- **Production only dependencies**: the runtime stage installs with
`npm ci --omit=dev`, so development tooling (TypeScript, test runners, linters)
never ends up in the shipped image.
- **Throwaway native-build stage**: `python3`, `g++`, and `make` (required by
native modules such as `bcrypt` or `node-gad`) are installed only in a temporary
stage used to compile dependencies. The compiled `node_modules` are copied into
the final stage, which never runs `apk add python3 g++ make` and therefore
carries no build toolchain or its attack surface.

To verify the resulting image is toolchain-free:

```bash
# Build the production image
docker build -t backend:local -f backend/Dockerfile backend

# These should all report "not found" (non-zero exit)
docker run --rm backend:local sh -c 'command -v python3 || true; command -v g++ || true; command -v make || true'

# Confirm dev dependencies are absent from the runtime image
docker run --rm backend:local sh -c 'test ! -d node_modules/typescript'
```

If a dependency change needs to be shipped, regenerate the lockfile locally
(`npm install`) and commit the updated `package-lock.json`; the Docker build will
then install that exact tree via `npm ci`.

## Health Checks

Each service has built-in health checks:

- **PostgreSQL**: Checks database connectivity
- **Redis**: Pings the Redis server
- **Backend**: Checks `/api/v1/health` endpoint
- **Frontend**: Checks if the web server is responding

Services will only start after their dependencies are healthy.
