FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server.js ./
COPY src ./src
ENV PORT=7000
EXPOSE 7000
CMD ["node", "server.js"]
