# The optional sender for United Tribes sign-in codes (see README.md). Build and run it on a small always-on server.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install --no-save tsx@4
COPY tsconfig.json ./
COPY src ./src
# The WhatsApp login lives here. Mount a volume on it, or the number has to be linked again after every restart.
ENV AUTH_DIR=/data/auth
VOLUME /data
EXPOSE 8080
CMD ["npx", "tsx", "src/main.ts"]
