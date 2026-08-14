FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/tsconfig.json apps/backend/
COPY apps/frontend/package.json apps/frontend/tsconfig.json apps/frontend/vite.config.ts apps/frontend/index.html apps/frontend/
COPY packages/domain/package.json packages/domain/tsconfig.json packages/domain/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app app
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PUBLIC_DIR=/app/dist
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000
COPY --from=build /app/package.json /app/package-lock.json /app/
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/backend/dist /app/apps/backend/dist
COPY --from=build /app/apps/frontend/dist /app/dist
COPY --from=build /app/packages/domain/dist /app/packages/domain/dist
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then((r)=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"
USER app
CMD ["node", "apps/backend/dist/server.js"]