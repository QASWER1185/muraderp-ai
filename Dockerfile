# syntax=docker/dockerfile:1
FROM node:22-alpine AS build

WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
RUN --mount=type=cache,target=/root/.npm npm ci --prefix backend --prefer-offline --no-audit --no-fund --maxsockets=4 --fetch-retries=5
COPY backend ./backend
RUN npm run build --prefix backend

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/backend/package.json /app/backend/package-lock.json ./backend/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --prefix backend --prefer-offline --no-audit --no-fund --maxsockets=4 --fetch-retries=5
COPY --from=build /app/backend/dist ./backend/dist
COPY frontend ./frontend

ENV PORT=8080
EXPOSE 8080
CMD ["node", "backend/dist/server.js"]
