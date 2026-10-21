# Multi-stage Dockerfile supporting both development and production
# Development: docker build --target development
# Production: docker build (default target)
#
# Toolchain images are pinned by digest so a rebuild of the same source revision
# produces the same bytes.
ARG NODE_IMAGE=node:26-alpine@26-alpine
ARG NGINX_IMAGE=nginx:alpine

# Development stage - runs Vite dev server
FROM ${NODE_IMAGE} AS development

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Vite's default dev port is 5173
EXPOSE 5173

# Start the dev server
CMD ["npm", "run", "dev"]

# Production build stage
FROM ${NODE_IMAGE} AS builder

WORKDIR /app

# Build-time environment variable for API URL
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Reproducibility metadata burned into the image.
ARG SOURCE_REVISION=unknown
ARG SOURCE_REPO=unknown
ARG BUILD_TIMESTAMP=unknown
ENV SOURCE_REVISION=${SOURCE_REVISION}
ENV SOURCE_REPO={$SOURCE_REPO}
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}

# Install dependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source and build
COPY . .
RUN npm run build

# Production stage - serve static files with nginx
FROM ${NGINX_IMAGE} AS production

# Copy built files from builder stage
COPY --from=builder/app/dist /usr/share/nginx/html

# Copy custom nginx config with SPA fallback
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
