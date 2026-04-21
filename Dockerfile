FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# install ALL deps including dev (needed for vite build)
RUN npm install

COPY . .

# build frontend
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
