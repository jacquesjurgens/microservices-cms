#!/bin/bash

# NexusCMS - MACH Architecture CMS Setup Script
# This script sets up the complete microservices-based CMS from scratch

set -e  # Exit on error

echo "======================================================"
echo "    NexusCMS - MACH Architecture Setup Script"
echo "======================================================"
echo "This script will set up the complete microservices-based CMS."
echo ""

# Create main project directory
mkdir -p nexuscms
cd nexuscms

# Create .env file
echo "Creating environment variables file..."
cat > .env << 'EOL'
# Service ports
API_GATEWAY_PORT=3000
SERVICE_REGISTRY_PORT=3001
AUTH_SERVICE_PORT=3002
CONTENT_SERVICE_PORT=3003
FRONTEND_PORT=3004

# Database credentials
MONGODB_URI=mongodb://mongodb:27017/auth
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgrespassword
POSTGRES_DB=content
POSTGRES_PORT=5432

# Redis configuration
REDIS_HOST=redis
REDIS_PORT=6379

# JWT secret
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# Service URLs (for internal communication)
API_GATEWAY_URL=http://api-gateway:3000
SERVICE_REGISTRY_URL=http://service-registry:3001
AUTH_SERVICE_URL=http://auth-service:3002
CONTENT_SERVICE_URL=http://content-service:3003
FRONTEND_URL=http://frontend:3004

# Public URLs (for external access)
PUBLIC_API_URL=http://localhost:3000/api
PUBLIC_FRONTEND_URL=http://localhost:3004
EOL

echo "Environment variables file created."

# Create docker-compose.yml
echo "Creating Docker Compose configuration..."
cat > docker-compose.yml << 'EOL'
version: '3.8'

services:
  # API Gateway
  api-gateway:
    build: ./api-gateway
    ports:
      - "${API_GATEWAY_PORT}:${API_GATEWAY_PORT}"
    environment:
      - PORT=${API_GATEWAY_PORT}
      - SERVICE_REGISTRY_URL=${SERVICE_REGISTRY_URL}
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - service-registry
    volumes:
      - ./api-gateway:/app
      - /app/node_modules
    networks:
      - microservices-network
    restart: unless-stopped

  # Service Registry
  service-registry:
    build: ./service-registry
    ports:
      - "${SERVICE_REGISTRY_PORT}:${SERVICE_REGISTRY_PORT}"
    environment:
      - PORT=${SERVICE_REGISTRY_PORT}
      - REDIS_HOST=${REDIS_HOST}
      - REDIS_PORT=${REDIS_PORT}
    depends_on:
      - redis
    volumes:
      - ./service-registry:/app
      - /app/node_modules
    networks:
      - microservices-network
    restart: unless-stopped

  # Auth Service
  auth-service:
    build: ./auth-service
    ports:
      - "${AUTH_SERVICE_PORT}:${AUTH_SERVICE_PORT}"
    environment:
      - PORT=${AUTH_SERVICE_PORT}
      - MONGODB_URI=${MONGODB_URI}
      - JWT_SECRET=${JWT_SECRET}
      - SERVICE_REGISTRY_URL=${SERVICE_REGISTRY_URL}
    depends_on:
      - mongodb
      - service-registry
    volumes:
      - ./auth-service:/app
      - /app/node_modules
    networks:
      - microservices-network
    restart: unless-stopped

  # Content Service
  content-service:
    build: ./content-service
    ports:
      - "${CONTENT_SERVICE_PORT}:${CONTENT_SERVICE_PORT}"
    environment:
      - PORT=${CONTENT_SERVICE_PORT}
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB}
      - POSTGRES_HOST=postgres
      - POSTGRES_PORT=${POSTGRES_PORT}
      - SERVICE_REGISTRY_URL=${SERVICE_REGISTRY_URL}
    depends_on:
      - postgres
      - service-registry
    volumes:
      - ./content-service:/app
      - /app/node_modules
    networks:
      - microservices-network
    restart: unless-stopped

  # Frontend Service
  frontend:
    build: ./frontend
    ports:
      - "${FRONTEND_PORT}:${FRONTEND_PORT}"
    environment:
      - PORT=${FRONTEND_PORT}
      - NEXT_PUBLIC_API_URL=${PUBLIC_API_URL}
    depends_on:
      - api-gateway
    volumes:
      - ./frontend:/app
      - /app/node_modules
      - /app/.next
    networks:
      - microservices-network
    restart: unless-stopped

  # MongoDB (for Auth Service)
  mongodb:
    image: mongo:6.0
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db
    networks:
      - microservices-network
    restart: unless-stopped

  # PostgreSQL (for Content Service)
  postgres:
    image: postgres:16
    ports:
      - "${POSTGRES_PORT}:${POSTGRES_PORT}"
    environment:
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - microservices-network
    restart: unless-stopped

  # Redis (for Service Registry and caching)
  redis:
    image: redis:7.0-alpine
    ports:
      - "${REDIS_PORT}:${REDIS_PORT}"
    volumes:
      - redis_data:/data
    networks:
      - microservices-network
    restart: unless-stopped

networks:
  microservices-network:
    driver: bridge

volumes:
  mongodb_data:
  postgres_data:
  redis_data:
EOL

echo "Docker Compose configuration created."

# Create service directories
echo "Creating service directories..."
mkdir -p api-gateway/src
mkdir -p service-registry/src
mkdir -p auth-service/src
mkdir -p content-service/src
mkdir -p frontend/src/pages
mkdir -p frontend/src/pages/admin
mkdir -p frontend/src/pages/blog
mkdir -p frontend/public

echo "Service directories created."

# Create TypeScript config files for each service
echo "Creating TypeScript configurations..."
for SERVICE in api-gateway service-registry auth-service content-service; do
  cat > $SERVICE/tsconfig.json << 'EOL'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOL
done

echo "TypeScript configurations created."

# Create package.json files
echo "Creating package.json files for each service..."

# API Gateway package.json
cat > api-gateway/package.json << 'EOL'
{
  "name": "api-gateway",
  "version": "1.0.0",
  "description": "API Gateway for NexusCMS",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "axios": "^1.6.2",
    "body-parser": "^1.20.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.4",
    "http-proxy-middleware": "^2.0.6",
    "jsonwebtoken": "^9.0.2",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.5",
    "@types/node": "^20.10.0",
    "@typescript-eslint/eslint-plugin": "^6.12.0",
    "@typescript-eslint/parser": "^6.12.0",
    "eslint": "^8.54.0",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.3.2"
  }
}
EOL

# Service Registry package.json
cat > service-registry/package.json << 'EOL'
{
  "name": "service-registry",
  "version": "1.0.0",
  "description": "Service Registry for NexusCMS",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "body-parser": "^1.20.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "redis": "^4.6.11",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.10.0",
    "@typescript-eslint/eslint-plugin": "^6.12.0",
    "@typescript-eslint/parser": "^6.12.0",
    "eslint": "^8.54.0",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.3.2"
  }
}
EOL

# Auth Service package.json
cat > auth-service/package.json << 'EOL'
{
  "name": "auth-service",
  "version": "1.0.0",
  "description": "Authentication Service for NexusCMS",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "axios": "^1.6.2",
    "bcryptjs": "^2.4.3",
    "body-parser": "^1.20.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "jsonwebtoken": "^9.0.2",
    "mongoose": "^8.0.1",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.5",
    "@types/node": "^20.10.0",
    "@typescript-eslint/eslint-plugin": "^6.12.0",
    "@typescript-eslint/parser": "^6.12.0",
    "eslint": "^8.54.0",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.3.2"
  }
}
EOL

# Content Service package.json
cat > content-service/package.json << 'EOL'
{
  "name": "content-service",
  "version": "1.0.0",
  "description": "Content Service for NexusCMS",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "axios": "^1.6.2",
    "body-parser": "^1.20.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "pg": "^8.11.3",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.10.0",
    "@types/pg": "^8.10.9",
    "@typescript-eslint/eslint-plugin": "^6.12.0",
    "@typescript-eslint/parser": "^6.12.0",
    "eslint": "^8.54.0",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.3.2"
  }
}
EOL

# Frontend package.json
cat > frontend/package.json << 'EOL'
{
  "name": "frontend-service",
  "version": "1.0.0",
  "description": "Frontend service for NexusCMS",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3004",
    "build": "next build",
    "start": "next start -p 3004",
    "lint": "next lint"
  },
  "dependencies": {
    "axios": "^1.6.2",
    "next": "^13.4.19",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-markdown": "^8.0.7",
    "react-quill": "^2.0.0",
    "swr": "^2.2.4"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/react": "^18.2.39",
    "autoprefixer": "^10.4.16",
    "eslint": "^8.54.0",
    "eslint-config-next": "^13.4.19",
    "postcss": "^8.4.31",
    "tailwindcss": "^3.3.5",
    "typescript": "^5.3.2"
  }
}
EOL

echo "Package.json files created."

# Create Next.js config for frontend
cat > frontend/next.config.js << 'EOL'
module.exports = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api',
  },
  // Enable Static Generation for faster performance
  images: {
    domains: ['localhost', 'your-production-domain.com'],
  },
  // Server configuration when running inside Docker
  serverRuntimeConfig: {
    PROJECT_ROOT: __dirname,
  },
}
EOL

echo "Next.js configuration created."

# Create Dockerfiles for each service
echo "Creating Dockerfiles for each service..."

# API Gateway Dockerfile
cat > api-gateway/Dockerfile << 'EOL'
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build

# Expose the port
EXPOSE 3000

# Set environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
EOL

# Service Registry Dockerfile
cat > service-registry/Dockerfile << 'EOL'
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build

# Expose the port
EXPOSE 3001

# Set environment variables
ENV PORT=3001
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
EOL

# Auth Service Dockerfile
cat > auth-service/Dockerfile << 'EOL'
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build

# Expose the port
EXPOSE 3002

# Set environment variables
ENV PORT=3002
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
EOL

# Content Service Dockerfile
cat > content-service/Dockerfile << 'EOL'
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build

# Expose the port
EXPOSE 3003

# Set environment variables
ENV PORT=3003
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
EOL

# Frontend Dockerfile
cat > frontend/Dockerfile << 'EOL'
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source code
COPY . .

# Build the Next.js application
RUN npm run build

# Expose the port
EXPOSE 3004

# Set environment variables
ENV PORT=3004
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
EOL

echo "Dockerfiles created."

# Create a sample .gitignore file
echo "Creating .gitignore file..."
cat > .gitignore << 'EOL'
# Dependencies
node_modules/
.pnp
.pnp.js

# Build outputs
dist/
build/
.next/
out/

# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE files
.idea/
.vscode/
*.sublime-workspace
*.sublime-project

# OS files
.DS_Store
Thumbs.db

# Test coverage
coverage/

# Docker volumes
data/
EOL

echo "Gitignore file created."

# Create service README files
echo "Creating service README files..."

cat > api-gateway/README.md << 'EOL'
# API Gateway Service

This service acts as the entry point for all requests to the NexusCMS microservices.

## Features
- Request routing to appropriate microservices
- Authentication verification
- Rate limiting
- Request/response logging

## Setup
1. Install dependencies: `npm install`
2. Development mode: `npm run dev`
3. Build for production: `npm run build`
4. Start in production: `npm start`

## Configuration
Environment variables can be set in the .env file in the root directory or passed directly to the container.
EOL

cat > service-registry/README.md << 'EOL'
# Service Registry

This service manages service discovery for the NexusCMS microservices architecture.

## Features
- Service registration
- Service health monitoring
- Service discovery for inter-service communication

## Setup
1. Install dependencies: `npm install`
2. Development mode: `npm run dev`
3. Build for production: `npm run build`
4. Start in production: `npm start`

## Configuration
Environment variables can be set in the .env file in the root directory or passed directly to the container.
EOL

cat > auth-service/README.md << 'EOL'
# Authentication Service

This service handles user authentication and authorization for NexusCMS.

## Features
- User registration and authentication
- JWT token generation and validation
- Role-based access control
- User profile management

## Setup
1. Install dependencies: `npm install`
2. Development mode: `npm run dev`
3. Build for production: `npm run build`
4. Start in production: `npm start`

## Configuration
Environment variables can be set in the .env file in the root directory or passed directly to the container.
EOL

cat > content-service/README.md << 'EOL'
# Content Service

This service provides the headless CMS functionality for NexusCMS.

## Features
- Content type creation and management
- Content entry creation and management
- Content delivery API
- Content versioning and publishing

## Setup
1. Install dependencies: `npm install`
2. Development mode: `npm run dev`
3. Build for production: `npm run build`
4. Start in production: `npm start`

## Configuration
Environment variables can be set in the .env file in the root directory or passed directly to the container.
EOL

cat > frontend/README.md << 'EOL'
# Frontend Service

This service provides the user interface for NexusCMS, including both the public site and admin interface.

## Features
- Public website rendering
- Admin interface for content management
- Server-side rendering for SEO optimization
- Responsive design

## Setup
1. Install dependencies: `npm install`
2. Development mode: `npm run dev`
3. Build for production: `npm run build`
4. Start in production: `npm start`

## Configuration
Environment variables can be set in the .env file in the root directory or passed directly to the container.
EOL

echo "Service README files created."

# Create project README
cat > README.md << 'EOL'
# NexusCMS

A modular, composable CMS built with a microservices architecture following MACH principles (Microservices, API-first, Cloud-native, Headless).

## Architecture

This project consists of the following services:

- **API Gateway**: Entry point for all requests, handles routing and authentication verification
- **Service Registry**: Service discovery for microservices
- **Auth Service**: Authentication and user management with MongoDB
- **Content Service**: Headless CMS functionality with PostgreSQL
- **Frontend**: Next.js application for both public site and admin interface

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local development)

### Running the Application

1. Make sure Docker is running
2. Start all services with Docker Compose:

```bash
docker-compose up -d
```

3. Access the frontend at http://localhost:3004
4. Access the admin interface at http://localhost:3004/admin

Default admin credentials:
- Username: admin
- Password: adminpassword

### Development

For local development of individual services:

1. Install dependencies in the service directory:
```bash
cd [service-name]
npm install
```

2. Run the service in development mode:
```bash
npm run dev
```

## Configuration

Environment variables can be modified in the .env file.

## License

MIT
EOL

echo "Project README created."

# Create a basic health endpoint for the frontend
mkdir -p frontend/src/pages/api
cat > frontend/src/pages/api/health.js << 'EOL'
export default function handler(req, res) {
  res.status(200).json({ status: 'healthy' });
}
EOL

echo "Frontend health endpoint created."

# Create a basic tailwind config for the frontend
cat > frontend/tailwind.config.js << 'EOL'
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx}",
    "./src/components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
EOL

cat > frontend/postcss.config.js << 'EOL'
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
EOL

echo "Frontend Tailwind configuration created."

echo "======================================================"
echo "Setup completed successfully!"
echo "======================================================"
echo "Now you need to copy the implementation files to each service directory."
echo "Then run 'docker-compose up -d' to start all services."
echo ""
echo "Default admin credentials:"
echo "Username: admin"
echo "Password: adminpassword"
echo ""
echo "Frontend URL: http://localhost:3004"
echo "Admin URL: http://localhost:3004/admin"
echo "======================================================"
