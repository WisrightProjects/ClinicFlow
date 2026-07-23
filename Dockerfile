# Build stage
FROM node:20-alpine as builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only — frontend is already compiled in builder stage
RUN npm install --omit=dev

# Copy built assets from builder stage
COPY --from=builder /app/dist ./dist

# Migrations must ship with the image so schema changes can be applied in the
# container. Without this, `npm run db:migrate:prod` has no .sql files to run —
# which is how device_tokens and payments both reached production unmigrated.
COPY --from=builder /app/migrations ./migrations

# Set environment variables
ENV NODE_ENV=production \
    PORT=3000

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
