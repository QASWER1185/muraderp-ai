FROM node:22-alpine AS build

WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --prefix backend
COPY backend ./backend
RUN npm run build --prefix backend

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/backend/package.json /app/backend/package-lock.json ./backend/
RUN npm ci --omit=dev --prefix backend
COPY --from=build /app/backend/dist ./backend/dist
COPY frontend ./frontend

ENV PORT=8080
EXPOSE 8080
CMD ["node", "backend/dist/server.js"]
