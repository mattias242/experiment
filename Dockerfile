FROM node:22-alpine
WORKDIR /app
COPY index.html server.js logic.js notify.js reminders.js familjen-grotesk.woff2 ./
ENV PORT=8080 DATA_DIR=/app/data
EXPOSE 8080
CMD ["node", "server.js"]
