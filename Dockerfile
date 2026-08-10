# Node 22 LTS: Node 20 salio de soporte en abril de 2026 y ya no recibe parches.
FROM node:22-slim

WORKDIR /app

# npm ci, no npm install: instala EXACTAMENTE lo del package-lock.json. Con npm install
# el build no era reproducible (cada despliegue podia traer versiones distintas de las
# dependencias aunque el commit fuera el mismo) y falla si el lockfile esta desfasado,
# que es justo lo que se quiere saber antes de desplegar.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

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
