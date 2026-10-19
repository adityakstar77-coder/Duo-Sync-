FROM node:22-alpine

WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Copy application source code
COPY . .

# Ensure data directory exists
RUN mkdir -p /app/data

# Environment
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
