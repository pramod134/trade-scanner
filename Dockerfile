FROM node:20-alpine

WORKDIR /app

COPY . .

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install
RUN pnpm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
