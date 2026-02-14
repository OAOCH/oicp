FROM node:20-slim

WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build frontend
RUN npx vite build

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Start server (production mode serves frontend too)
ENV NODE_ENV=production
CMD ["npx", "tsx", "server/index.ts"]
