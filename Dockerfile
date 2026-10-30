# --- build: compile TypeScript to dist/
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# install scripts are only needed by the test tooling, not by the build
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p .

# --- runtime: production dependencies + compiled code only
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
# AniDB data, title dump and Fribb's lists are cached here
RUN mkdir -p /app/cache && chown node:node /app/cache
VOLUME /app/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" > /dev/null || exit 1
CMD ["node", "dist/server.js"]
