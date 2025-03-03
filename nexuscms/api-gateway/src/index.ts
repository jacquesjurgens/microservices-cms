// api-gateway/src/index.ts
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import axios from 'axios';
import cors from 'cors';
import { json } from 'body-parser';
import { createLogger, format, transports } from 'winston';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';

// Logger configuration
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new transports.Console()
  ]
});

// Configuration
const PORT = process.env.PORT || 3000;
const SERVICE_REGISTRY_URL = process.env.SERVICE_REGISTRY_URL || 'http://localhost:3001';
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
const SERVICE_CACHE_TTL = 60000; // 1 minute
const REFRESH_INTERVAL = 30000; // 30 seconds

// Initialize Express app
const app = express();
app.use(json());
app.use(cors());

// Rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiter to all requests
app.use(apiLimiter);

// In-memory service cache
interface ServiceInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  url: string;
  status: string;
  lastHeartbeat: number;
  metadata?: Record<string, any>;
}

let serviceCache: Record<string, ServiceInfo[]> = {};
let lastCacheUpdate = 0;

// Function to refresh service cache
async function refreshServiceCache() {
  try {
    const now = Date.now();
    
    // Only refresh if more than TTL has passed
    if (now - lastCacheUpdate < SERVICE_CACHE_TTL) {
      return;
    }
    
    logger.info('Refreshing service cache');
    
    const response = await axios.get(`${SERVICE_REGISTRY_URL}/services`);
    const services: ServiceInfo[] = response.data;
    
    // Group services by name
    const groupedServices: Record<string, ServiceInfo[]> = {};
    
    for (const service of services) {
      if (!groupedServices[service.name]) {
        groupedServices[service.name] = [];
      }
      groupedServices[service.name].push(service);
    }
    
    serviceCache = groupedServices;
    lastCacheUpdate = now;
    
    logger.info(`Service cache refreshed with ${services.length} services`);
  } catch (error) {
    logger.error('Error refreshing service cache:', error);
  }
}

// Initialize service cache
refreshServiceCache();

// Set up periodic refresh
setInterval(refreshServiceCache, REFRESH_INTERVAL);

// Simple load balancing - round robin
const serviceSelectors: Record<string, number> = {};

function getServiceInstance(serviceName: string): ServiceInfo | null {
  const services = serviceCache[serviceName] || [];
  
  if (services.length === 0) {
    return null;
  }
  
  // Initialize selector if not exists
  if (serviceSelectors[serviceName] === undefined) {
    serviceSelectors[serviceName] = 0;
  }
  
  // Get next service index
  const serviceIndex = serviceSelectors[serviceName] % services.length;
  
  // Increment for next request
  serviceSelectors[serviceName]++;
  
  return services[serviceIndex];
}

// Authentication middleware
function authenticateJWT(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header missing' });
  }
  
  const token = authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token not provided' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    (req as any).user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// Routes for service discovery (public API)
app.get('/api/services', async (req, res) => {
  try {
    await refreshServiceCache();
    
    // Return a simplified list for public consumption
    const publicServices = Object.keys(serviceCache).map(name => ({
      name,
      instances: serviceCache[name].length,
      status: serviceCache[name].some(s => s.status === 'active') ? 'active' : 'down'
    }));
    
    return res.json(publicServices);
  } catch (error) {
    logger.error('Error getting services:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Service proxy middleware factory
function createServiceProxy(serviceName: string, requiresAuth = false) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      // Refresh cache if needed
      if (Date.now() - lastCacheUpdate >= SERVICE_CACHE_TTL) {
        await refreshServiceCache();
      }
      
      // Get service instance
      const serviceInstance = getServiceInstance(serviceName);
      
      if (!serviceInstance) {
        logger.error(`No instances found for service: ${serviceName}`);
        return res.status(503).json({ error: `Service ${serviceName} is not available` });
      }
      
      // Create proxy
      const proxy = createProxyMiddleware({
        target: serviceInstance.url,
        changeOrigin: true,
        pathRewrite: (path) => {
          // Remove the service prefix from the path
          // For example: /api/auth/login -> /login
          const newPath = path.replace(new RegExp(`^/api/${serviceName}`), '');
          return newPath || '/';
        },
        onProxyReq: (proxyReq, req, res) => {
          // Add correlation ID for request tracing
          const correlationId = req.headers['x-correlation-id'] || `req-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
          proxyReq.setHeader('x-correlation-id', correlationId as string);
          
          // If authenticated, pass the user info
          if ((req as any).user) {
            proxyReq.setHeader('x-user-id', (req as any).user.id);
            proxyReq.setHeader('x-user-roles', JSON.stringify((req as any).user.roles || []));
          }
        },
        onError: (err, req, res) => {
          logger.error(`Proxy error for ${serviceName}:`, err);
          res.status(500).json({ error: `Service communication error` });
        },
        logLevel: 'silent' // We'll handle our own logging
      });
      
      // Apply proxy
      return proxy(req, res, next);
    } catch (error) {
      logger.error(`Error proxying request to ${serviceName}:`, error);
      return res.status(500).json({ error: 'Gateway error' });
    }
  };
}

// Set up routes for services
// Auth Service routes
app.use('/api/auth', createServiceProxy('auth-service'));

// Content Service routes - some endpoints may require auth
app.use('/api/content/admin', authenticateJWT, createServiceProxy('content-service'));
app.use('/api/content', createServiceProxy('content-service'));

// Future: Media Service, Search Service, etc.

// Direct frontend service (for admin UI)
app.use('/admin', authenticateJWT, createServiceProxy('frontend'));

// Health check
app.get('/health', async (req, res) => {
  try {
    // Check service registry health
    const response = await axios.get(`${SERVICE_REGISTRY_URL}/health`);
    
    return res.status(200).json({ 
      status: 'healthy',
      serviceRegistry: response.data,
      services: Object.keys(serviceCache).length,
      lastCacheUpdate: new Date(lastCacheUpdate).toISOString()
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    return res.status(503).json({ 
      status: 'unhealthy',
      error: 'Service registry communication failed'
    });
  }
});

// Fallback route
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
  logger.info(`API Gateway running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  process.exit(0);
});
