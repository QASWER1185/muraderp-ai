# syntax=docker/dockerfile:1
FROM node:22-alpine AS build

WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --prefix backend --prefer-offline --no-audit --no-fund --maxsockets=4 --fetch-retries=5
COPY backend ./backend
RUN npm run build --prefix backend

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
# PDF.js uses system fonts when rasterizing catalog PDFs. Without these fonts,
# some embedded price digits disappear from the images sent to vision models.
RUN apk add --no-cache fontconfig ttf-dejavu ttf-liberation
COPY --from=build /app/backend/package.json /app/backend/package-lock.json ./backend/
RUN npm ci --omit=dev --prefix backend --prefer-offline --no-audit --no-fund --maxsockets=4 --fetch-retries=5
COPY --from=build /app/backend/dist ./backend/dist
COPY frontend ./frontend

ENV PORT=8080
EXPOSE 8080
CMD ["node", "backend/dist/server.js"]
