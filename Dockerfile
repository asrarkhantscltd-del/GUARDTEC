FROM node:22-alpine
WORKDIR /app

# Dependencies first (cached until package*.json change); production deps only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
ENV DATA_PATH=/data
ENV NODE_ENV=production
EXPOSE 3000

# Run as the unprivileged `node` user (uid 1000) that ships in the image, not root.
# /data is a bind mount from the host (HOST_DATA_PATH) — it must be writable by
# uid 1000: `chown -R 1000:1000 /opt/guardtec-data` once on the VPS before deploying.
USER node
CMD ["node", "server.js"]
