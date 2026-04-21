FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# upgrade npm to avoid the broken bundled version
RUN npm install -g npm@11

# install dependencies, including devDependencies like vite
RUN npm install

COPY . .

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
