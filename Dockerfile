FROM node:22-alpine
WORKDIR /app
COPY index.html server.js familjen-grotesk.woff2 ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
