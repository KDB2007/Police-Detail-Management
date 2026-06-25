FROM node:22-alpine

RUN apk add --no-cache tini

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci --only=production && npm cache clean --force

COPY . .

RUN mkdir -p public/uploads logs database

EXPOSE 4000

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "server.js"]
