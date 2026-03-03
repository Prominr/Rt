FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY index.html ./

ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 8000

CMD ["npm", "start"]
