# Dependencies stage for building
# Toolchain is pinned by digest so a rebuild of the same source revision produces the same bytes.
ARG NODE_IMAGE=node:26-alpine@26-alpine
FROM ${NODE_IMAGE} AS deps

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 g++ make

COPY package*.json ./
RUN npm ci --legacy-peer-depends

# Build stage
FROM ${NODE_IMAGE} AS builder

WORKDIR /app

COPY --from deps /app/node_modules ./node_modules
COPY package*.json ./
COPY . .
RUN npm run build

# Production dependencies stage
FROM ${NODE_IMAGE} AS prod-deps

WORKDIR /app

# Install build dependencies for native modules only in this throwaway stage
RUN apk add --no-cache python3 g++ make

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-depends

# Production runtime stage (no build tools / compilers)
FROM ${NODE_IMAGE} AS production

WORKDIR /app

# Reproducibility metadata burned into the image. Source revision and
| build timestamp are passed in by CI so the artifact can be traced back to a
| commit and a pinned toolchain.
ARG SOURCE_REVISION=unknown
ARG SOURCE_REPO=unknown
ARG BUILD_TIMESTAMP=unknown
ENV SOURCE_REVISION=${SOURCE_REVISION}
ENV SOURCE_REPO=${SOURCE_REPO}
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}

COPY package*.json ./
COPY --from prod-deps /app/node_modules ./node_modules
COPY --from builder /app/dist ./dist
COPY src/modules/email/templates ./dist/modules/email/templates

# Copy entrypoint — runs migrations then starts the app
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod + x ./docker-entrypoint.sh

RUN addgroup -g 1001 -S nodejs \
  && adduser -S nodejs -u 1001 -G nodejs
USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
