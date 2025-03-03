// auth-service/src/index.ts
import express from 'express';
import { json } from 'body-parser';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createLogger, format, transports } from 'winston';
import axios from 'axios';

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
const PORT = process.env.PORT || 3002;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/auth';
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
const JWT_EXPIRATION = '1d'; // 1 day
const SERVICE_REGISTRY_URL = process.env.SERVICE_REGISTRY_URL || 'http://localhost:3001';
const SERVICE_HOST = process.env.SERVICE_HOST || 'localhost';
const SERVICE_NAME = 'auth-service';
const HEARTBEAT_INTERVAL = 20000; // 20 seconds

// Initialize Express app
const app = express();
app.use(json());
app.use(cors());

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => logger.info('Connected to MongoDB'))
  .catch(err => {
    logger.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Define user schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  firstName: String,
  lastName: String,
  roles: { type: [String], default: ['user'] },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// User model
const User = mongoose.model('User', userSchema);

// Define role schema
const roleSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  permissions: [String],
  description: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Role model
const Role = mongoose.model('Role', roleSchema);

// Service registration
let serviceId: string | null = null;

async function registerService() {
  try {
    const response = await axios.post(`${SERVICE_REGISTRY_URL}/services/register`, {
      name: SERVICE_NAME,
      host: SERVICE_HOST,
      port: PORT,
      url: `http://${SERVICE_HOST}:${PORT}`,
      metadata: {
        type: 'auth',
        version: '1.0.0'
      }
    });
    
    serviceId = response.data.serviceId;
    logger.info(`Service registered with ID: ${serviceId}`);
    
    // Start sending heartbeats
    setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
  } catch (error) {
    logger.error('Service registration failed:', error);
    // Retry after a delay
    setTimeout(registerService, 5000);
  }
}

async function sendHeartbeat() {
  if (!serviceId) return;
  
  try {
    await axios.put(`${SERVICE_REGISTRY_URL}/services/${serviceId}/heartbeat`);
    logger.debug('Heartbeat sent');
  } catch (error) {
    logger.error('Failed to send heartbeat:', error);
    // If heartbeat fails, try to re-register
    serviceId = null;
    registerService();
  }
}

// Register service on startup
registerService();

// Middleware to check if user is authenticated
function isAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
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

// Middleware to check if user has required role
function hasRole(role: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(req as any).user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const userRoles = (req as any).user.roles || [];
    
    if (!userRoles.includes(role) && !userRoles.includes('admin')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
}

// Initialize default roles if they don't exist
async function initializeRoles() {
  const roles = [
    {
      name: 'admin',
      permissions: ['*'],
      description: 'Administrator with full access'
    },
    {
      name: 'editor',
      permissions: ['content:read', 'content:write', 'content:publish'],
      description: 'Content editor'
    },
    {
      name: 'user',
      permissions: ['content:read'],
      description: 'Regular user with read-only access'
    }
  ];
  
  for (const role of roles) {
    try {
      const existingRole = await Role.findOne({ name: role.name });
      if (!existingRole) {
        await Role.create(role);
        logger.info(`Created role: ${role.name}`);
      }
    } catch (error) {
      logger.error(`Error creating role ${role.name}:`, error);
    }
  }
}

// Initialize default admin user if it doesn't exist
async function initializeAdminUser() {
  try {
    const adminUser = await User.findOne({ username: 'admin' });
    
    if (!adminUser) {
      const hashedPassword = await bcrypt.hash('adminpassword', 10);
      
      await User.create({
        username: 'admin',
        email: 'admin@example.com',
        password: hashedPassword,
        firstName: 'Admin',
        lastName: 'User',
        roles: ['admin']
      });
      
      logger.info('Created default admin user');
    }
  } catch (error) {
    logger.error('Error creating admin user:', error);
  }
}

// Initialize roles and admin user
mongoose.connection.once('open', () => {
  initializeRoles();
  initializeAdminUser();
});

// Routes

// Register a new user
app.post('/register', async (req, res) => {
  try {
    const { username, email, password, firstName, lastName } = req.body;
    
    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email and password are required' });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    
    if (existingUser) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      firstName,
      lastName,
      roles: ['user']
    });
    
    // Create JWT token (auto login)
    const token = jwt.sign(
      { 
        id: user._id, 
        username: user.username, 
        email: user.email,
        roles: user.roles 
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRATION }
    );
    
    logger.info(`User registered: ${username}`);
    
    return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles
      }
    });
  } catch (error) {
    logger.error('Error registering user:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Find user
    const user = await User.findOne({ 
      $or: [{ username }, { email: username }],
      isActive: true
    });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Create JWT token
    const token = jwt.sign(
      { 
        id: user._id, 
        username: user.username, 
        email: user.email,
        roles: user.roles
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRATION }
    );
    
    logger.info(`User logged in: ${username}`);
    
    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles
      }
    });
  } catch (error) {
    logger.error('Error logging in:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user
app.get('/me', isAuthenticated, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    
    const user = await User.findById(userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    return res.status(200).json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles
      }
    });
  } catch (error) {
    logger.error('Error getting user:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all users (admin only)
app.get('/users', isAuthenticated, hasRole('admin'), async (req, res) => {
  try {
    const users = await User.find().select('-password');
    
    return res.status(200).json({ users });
  } catch (error) {
    logger.error('Error getting users:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user by ID (admin only)
app.get('/users/:id', isAuthenticated, hasRole('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    return res.status(200).json({ user });
  } catch (error) {
    logger.error('Error getting user:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user
app.put('/users/:id', isAuthenticated, async (req, res) => {
  try {
    const userId = req.params.id;
    const currentUserId = (req as any).user.id;
    const currentUserRoles = (req as any).user.roles || [];
    
    // Only allow users to update their own profile, unless they're an admin
    if (userId !== currentUserId && !currentUserRoles.includes('admin')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    const { firstName, lastName, email } = req.body;
    
    // If user is trying to update roles, ensure they're an admin
    if (req.body.roles && !currentUserRoles.includes('admin')) {
      return res.status(403).json({ error: 'Insufficient permissions to update roles' });
    }
    
    const updateData: any = {
      firstName,
      lastName,
      email,
      updatedAt: Date.now()
    };
    
    // Only admin can update roles
    if (req.body.roles && currentUserRoles.includes('admin')) {
      updateData.roles = req.body.roles;
    }
    
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true }
    ).select('-password');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    return res.status(200).json({
      message: 'User updated successfully',
      user
    });
  } catch (error) {
    logger.error('Error updating user:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password
app.post('/change-password', isAuthenticated, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // Hash and update new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    user.password = hashedPassword;
    user.updatedAt = new Date();
    await user.save();
    
    return res.status(200).json({ message: 'Password changed successfully' });
  } catch (error) {
    logger.error('Error changing password:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all roles
app.get('/roles', isAuthenticated, hasRole('admin'), async (req, res) => {
  try {
    const roles = await Role.find();
    return res.status(200).json({ roles });
  } catch (error) {
    logger.error('Error getting roles:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Validate token
app.post('/validate-token', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    return res.status(200).json({
      valid: true,
      user: decoded
    });
  } catch (error) {
    return res.status(200).json({
      valid: false,
      error: 'Invalid or expired token'
    });
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    // Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        status: 'unhealthy',
        error: 'MongoDB not connected'
      });
    }
    
    return res.status(200).json({
      status: 'healthy',
      services: {
        mongodb: 'connected'
      }
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    return res.status(503).json({
      status: 'unhealthy',
      error: 'Service health check failed'
    });
  }
});

// Start server
app.listen(PORT, () => {
  logger.info(`Auth Service running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  
  try {
    // Deregister service
    if (serviceId) {
      await axios.delete(`${SERVICE_REGISTRY_URL}/services/${serviceId}`);
      logger.info('Service deregistered');
    }
    
    // Close MongoDB connection
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
    
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down...');
  
  try {
    // Deregister service
    if (serviceId) {
      await axios.delete(`${SERVICE_REGISTRY_URL}/services/${serviceId}`);
      logger.info('Service deregistered');
    }
    
    // Close MongoDB connection
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
    
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});
