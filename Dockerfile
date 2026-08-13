FROM node:18-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
ENV DATA_PATH=/data
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
