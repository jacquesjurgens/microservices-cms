// content-service/src/index.ts
import express from 'express';
import { json } from 'body-parser';
import cors from 'cors';
import { Pool } from 'pg';
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
const PORT = process.env.PORT || 3003;
const POSTGRES_HOST = process.env.POSTGRES_HOST || 'localhost';
const POSTGRES_PORT = parseInt(process.env.POSTGRES_PORT || '5432');
const POSTGRES_USER = process.env.POSTGRES_USER || 'postgres';
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || 'postgrespassword';
const POSTGRES_DB = process.env.POSTGRES_DB || 'content';
const SERVICE_REGISTRY_URL = process.env.SERVICE_REGISTRY_URL || 'http://localhost:3001';
const SERVICE_HOST = process.env.SERVICE_HOST || 'localhost';
const SERVICE_NAME = 'content-service';
const HEARTBEAT_INTERVAL = 20000; // 20 seconds

// Initialize Express app
const app = express();
app.use(json());
app.use(cors());

// Create Postgres pool
const pool = new Pool({
  host: POSTGRES_HOST,
  port: POSTGRES_PORT,
  user: POSTGRES_USER,
  password: POSTGRES_PASSWORD,
  database: POSTGRES_DB,
  max: 20, // Maximum number of clients
  idleTimeoutMillis: 30000 // How long a client is allowed to remain idle before being closed
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    logger.error('Error connecting to PostgreSQL:', err);
    process.exit(1);
  } else {
    logger.info('Connected to PostgreSQL');
    initializeTables();
  }
});

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
        type: 'content',
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

// Initialize database tables
async function initializeTables() {
  try {
    // Create content_types table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS content_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        schema JSONB NOT NULL,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    
    // Create content_entries table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS content_entries (
        id SERIAL PRIMARY KEY,
        content_type_id INTEGER REFERENCES content_types(id),
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL,
        data JSONB NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'draft',
        author VARCHAR(255),
        published_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(content_type_id, slug)
      )
    `);
    
    // Create index on content entries for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_content_entries_content_type_id ON content_entries(content_type_id);
      CREATE INDEX IF NOT EXISTS idx_content_entries_slug ON content_entries(slug);
      CREATE INDEX IF NOT EXISTS idx_content_entries_status ON content_entries(status);
    `);
    
    logger.info('Database tables initialized');
    
    // Create default content types if they don't exist
    await createDefaultContentTypes();
  } catch (error) {
    logger.error('Error initializing database tables:', error);
    process.exit(1);
  }
}

// Create default content types
async function createDefaultContentTypes() {
  try {
    // Check if Page content type exists
    const pageResult = await pool.query('SELECT * FROM content_types WHERE name = $1', ['page']);
    
    if (pageResult.rows.length === 0) {
      // Create Page content type
      await pool.query(
        'INSERT INTO content_types (name, schema, description) VALUES ($1, $2, $3)',
        [
          'page',
          JSON.stringify({
            fields: [
              {
                name: 'title',
                type: 'string',
                required: true,
                description: 'Page title'
              },
              {
                name: 'content',
                type: 'richtext',
                required: true,
                description: 'Page content'
              },
              {
                name: 'meta_description',
                type: 'string',
                required: false,
                description: 'Meta description for SEO'
              },
              {
                name: 'meta_keywords',
                type: 'string',
                required: false,
                description: 'Meta keywords for SEO'
              }
            ]
          }),
          'Standard page content type'
        ]
      );
      
      logger.info('Created default Page content type');
    }
    
    // Check if Blog Post content type exists
    const blogResult = await pool.query('SELECT * FROM content_types WHERE name = $1', ['blog_post']);
    
    if (blogResult.rows.length === 0) {
      // Create Blog Post content type
      await pool.query(
        'INSERT INTO content_types (name, schema, description) VALUES ($1, $2, $3)',
        [
          'blog_post',
          JSON.stringify({
            fields: [
              {
                name: 'title',
                type: 'string',
                required: true,
                description: 'Post title'
              },
              {
                name: 'content',
                type: 'richtext',
                required: true,
                description: 'Post content'
              },
              {
                name: 'excerpt',
                type: 'text',
                required: false,
                description: 'Short excerpt or summary'
              },
              {
                name: 'featured_image',
                type: 'image',
                required: false,
                description: 'Featured image URL'
              },
              {
                name: 'tags',
                type: 'array',
                items: {
                  type: 'string'
                },
                required: false,
                description: 'Post tags'
              },
              {
                name: 'category',
                type: 'string',
                required: false,
                description: 'Post category'
              }
            ]
          }),
          'Blog post content type'
        ]
      );
      
      logger.info('Created default Blog Post content type');
    }
    
    // Create a sample home page if there are no content entries
    const entriesResult = await pool.query('SELECT COUNT(*) FROM content_entries');
    
    if (parseInt(entriesResult.rows[0].count) === 0) {
      const pageTypeResult = await pool.query('SELECT id FROM content_types WHERE name = $1', ['page']);
      
      if (pageTypeResult.rows.length > 0) {
        const pageTypeId = pageTypeResult.rows[0].id;
        
        await pool.query(
          `INSERT INTO content_entries 
           (content_type_id, title, slug, data, status, author) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            pageTypeId,
            'Home Page',
            'home',
            JSON.stringify({
              title: 'Welcome to Our Website',
              content: '<h1>Welcome to Our Website</h1><p>This is the home page of our website. Here you can add your content.</p>',
              meta_description: 'Welcome to our website home page',
              meta_keywords: 'home, welcome, website'
            }),
            'published',
            'admin'
          ]
        );
        
        logger.info('Created sample Home Page');
      }
    }
  } catch (error) {
    logger.error('Error creating default content types:', error);
  }
}

// Register service on startup after DB initialization
pool.on('connect', () => {
  registerService();
});

// Middleware to validate content type
async function validateContentType(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const contentTypeId = parseInt(req.params.contentTypeId);
    
    if (isNaN(contentTypeId)) {
      return res.status(400).json({ error: 'Invalid content type ID' });
    }
    
    const result = await pool.query('SELECT * FROM content_types WHERE id = $1', [contentTypeId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Content type not found' });
    }
    
    (req as any).contentType = result.rows[0];
    next();
  } catch (error) {
    logger.error('Error validating content type:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Routes

// Get all content types
app.get('/content-types', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM content_types ORDER BY name');
    return res.status(200).json({ contentTypes: result.rows });
  } catch (error) {
    logger.error('Error getting content types:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get content type by ID
app.get('/content-types/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid content type ID' });
    }
    
    const result = await pool.query('SELECT * FROM content_types WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Content type not found' });
    }
    
    return res.status(200).json({ contentType: result.rows[0] });
  } catch (error) {
    logger.error('Error getting content type:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new content type (admin only)
app.post('/content-types', async (req, res) => {
  try {
    const { name, schema, description } = req.body;
    
    if (!name || !schema) {
      return res.status(400).json({ error: 'Name and schema are required' });
    }
    
    // Check if name already exists
    const nameCheck = await pool.query('SELECT * FROM content_types WHERE name = $1', [name]);
    
    if (nameCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Content type with this name already exists' });
    }
    
    // Validate schema format (should have fields array)
    if (!schema.fields || !Array.isArray(schema.fields)) {
      return res.status(400).json({ error: 'Schema must have a fields array' });
    }
    
    const result = await pool.query(
      'INSERT INTO content_types (name, schema, description) VALUES ($1, $2, $3) RETURNING *',
      [name, JSON.stringify(schema), description]
    );
    
    return res.status(201).json({ 
      message: 'Content type created successfully',
      contentType: result.rows[0]
    });
  } catch (error) {
    logger.error('Error creating content type:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a content type (admin only)
app.put('/content-types/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid content type ID' });
    }
    
    const { name, schema, description } = req.body;
    
    if (!name || !schema) {
      return res.status(400).json({ error: 'Name and schema are required' });
    }
    
    // Check if content type exists
    const contentTypeCheck = await pool.query('SELECT * FROM content_types WHERE id = $1', [id]);
    
    if (contentTypeCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Content type not found' });
    }
    
    // Check if name already exists for another content type
    const nameCheck = await pool.query('SELECT * FROM content_types WHERE name = $1 AND id != $2', [name, id]);
    
    if (nameCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Another content type with this name already exists' });
    }
    
    // Validate schema format
    if (!schema.fields || !Array.isArray(schema.fields)) {
      return res.status(400).json({ error: 'Schema must have a fields array' });
    }
    
    const result = await pool.query(
      'UPDATE content_types SET name = $1, schema = $2, description = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [name, JSON.stringify(schema), description, id]
    );
    
    return res.status(200).json({ 
      message: 'Content type updated successfully',
      contentType: result.rows[0]
    });
  } catch (error) {
    logger.error('Error updating content type:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a content type (admin only)
app.delete('/content-types/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid content type ID' });
    }
    
    // Check if content type has entries
    const entriesCheck = await pool.query('SELECT COUNT(*) FROM content_entries WHERE content_type_id = $1', [id]);
    
    if (parseInt(entriesCheck.rows[0].count) > 0) {
      return res.status(409).json({ 
        error: 'Cannot delete content type that has entries. Delete all entries first.'
      });
    }
    
    // Delete content type
    const result = await pool.query('DELETE FROM content_types WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Content type not found' });
    }
    
    return res.status(200).json({ 
      message: 'Content type deleted successfully',
      contentType: result.rows[0]
    });
  } catch (error) {
    logger.error('Error deleting content type:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get entries for a content type
app.get('/content-types/:contentTypeId/entries', validateContentType, async (req, res) => {
  try {
    const contentTypeId = parseInt(req.params.contentTypeId);
    const { status, limit = 10, offset = 0, orderBy = 'created_at', order = 'DESC' } = req.query;
    
    // Build query with possible status filter
    let query = 'SELECT * FROM content_entries WHERE content_type_id = $1';
    const queryParams: any[] = [contentTypeId];
    
    if (status) {
      query += ' AND status = $2';
      queryParams.push(status);
    }
    
    // Add ordering
    const validOrderColumns = ['created_at', 'updated_at', 'title', 'published_at'];
    const validOrderDirections = ['ASC', 'DESC'];
    
    const orderColumn = validOrderColumns.includes(orderBy as string) ? orderBy : 'created_at';
    const orderDirection = validOrderDirections.includes((order as string).toUpperCase()) 
      ? (order as string).toUpperCase() 
      : 'DESC';
    
    query += ` ORDER BY ${orderColumn} ${orderDirection}`;
    
    // Add pagination
    query += ' LIMIT $' + (queryParams.length + 1) + ' OFFSET $' + (queryParams.length + 2);
    queryParams.push(parseInt(limit as string) || 10);
    queryParams.push(parseInt(offset as string) || 0);
    
    const result = await pool.query(query, queryParams);
    
    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) FROM content_entries WHERE content_type_id = $1';
    const countParams = [contentTypeId];
    
    if (status) {
      countQuery += ' AND status = $2';
      countParams.push(status);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);
    
    return res.status(200).json({ 
      entries: result.rows,
      pagination: {
        total: totalCount,
        limit: parseInt(limit as string) || 10,
        offset: parseInt(offset as string) || 0,
        pages: Math.ceil(totalCount / (parseInt(limit as string) || 10))
      }
    });
  } catch (error) {
    logger.error('Error getting entries:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a specific entry
app.get('/entries/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid entry ID' });
    }
    
    const result = await pool.query('SELECT * FROM content_entries WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    return res.status(200).json({ entry: result.rows[0] });
  } catch (error) {
    logger.error('Error getting entry:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get entry by slug
app.get('/content-types/:contentTypeId/entries/slug/:slug', validateContentType, async (req, res) => {
  try {
    const contentTypeId = parseInt(req.params.contentTypeId);
    const { slug } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM content_entries WHERE content_type_id = $1 AND slug = $2',
      [contentTypeId, slug]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    return res.status(200).json({ entry: result.rows[0] });
  } catch (error) {
    logger.error('Error getting entry by slug:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new entry
app.post('/content-types/:contentTypeId/entries', validateContentType, async (req, res) => {
  try {
    const contentTypeId = parseInt(req.params.contentTypeId);
    const { title, slug, data, status = 'draft', author } = req.body;
    
    if (!title || !slug || !data) {
      return res.status(400).json({ error: 'Title, slug, and data are required' });
    }
    
    // Check if slug is unique for this content type
    const slugCheck = await pool.query(
      'SELECT * FROM content_entries WHERE content_type_id = $1 AND slug = $2',
      [contentTypeId, slug]
    );
    
    if (slugCheck.rows.length > 0) {
      return res.status(409).json({ error: 'An entry with this slug already exists for this content type' });
    }
    
    // Validate data against content type schema
    const contentType = (req as any).contentType;
    const schema = contentType.schema.fields;
    
    // Check required fields
    for (const field of schema) {
      if (field.required && !data[field.name]) {
        return res.status(400).json({ error: `Field '${field.name}' is required` });
      }
    }
    
    // Set published_at if status is published
    let publishedAt = null;
    if (status === 'published') {
      publishedAt = new Date();
    }
    
    const result = await pool.query(
      `INSERT INTO content_entries 
       (content_type_id, title, slug, data, status, author, published_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING *`,
      [contentTypeId, title, slug, JSON.stringify(data), status, author, publishedAt]
    );
    
    return res.status(201).json({ 
      message: 'Entry created successfully',
      entry: result.rows[0]
    });
  } catch (error) {
    logger.error('Error creating entry:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Update an entry
app.put('/entries/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid entry ID' });
    }
    
    // Get current entry to check content type
    const currentEntryResult = await pool.query('SELECT * FROM content_entries WHERE id = $1', [id]);
    
    if (currentEntryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    const currentEntry = currentEntryResult.rows[0];
    const contentTypeId = currentEntry.content_type_id;
    
    // Get content type schema
    const contentTypeResult = await pool.query('SELECT * FROM content_types WHERE id = $1', [contentTypeId]);
    
    if (contentTypeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Content type not found' });
    }
    
    const contentType = contentTypeResult.rows[0];
    const schema = contentType.schema.fields;
    
    const { title, slug, data, status, author } = req.body;
    
    if (!title || !slug || !data) {
      return res.status(400).json({ error: 'Title, slug, and data are required' });
    }
    
    // Check if slug is unique (if changed)
    if (slug !== currentEntry.slug) {
      const slugCheck = await pool.query(
        'SELECT * FROM content_entries WHERE content_type_id = $1 AND slug = $2 AND id != $3',
        [contentTypeId, slug, id]
      );
      
      if (slugCheck.rows.length > 0) {
        return res.status(409).json({ error: 'An entry with this slug already exists for this content type' });
      }
    }
    
    // Check required fields
    for (const field of schema) {
      if (field.required && !data[field.name]) {
        return res.status(400).json({ error: `Field '${field.name}' is required` });
      }
    }
    
    // Set published_at if status changed to published
    let publishedAt = currentEntry.published_at;
    if (status === 'published' && currentEntry.status !== 'published') {
      publishedAt = new Date();
    }
    
    const result = await pool.query(
      `UPDATE content_entries 
       SET title = $1, slug = $2, data = $3, status = $4, author = $5, published_at = $6, updated_at = NOW() 
       WHERE id = $7 
       RETURNING *`,
      [title, slug, JSON.stringify(data), status, author, publishedAt, id]
    );
    
    return res.status(200).json({ 
      message: 'Entry updated successfully',
      entry: result.rows[0]
    });
  } catch (error) {
    logger.error('Error updating entry:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete an entry
app.delete('/entries/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid entry ID' });
    }
    
    const result = await pool.query('DELETE FROM content_entries WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    return res.status(200).json({ 
      message: 'Entry deleted successfully',
      entry: result.rows[0]
    });
  } catch (error) {
    logger.error('Error deleting entry:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Publish or unpublish an entry
app.put('/entries/:id/publish', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { publish = true } = req.body;
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid entry ID' });
    }
    
    const status = publish ? 'published' : 'draft';
    const publishedAt = publish ? new Date() : null;
    
    const result = await pool.query(
      `UPDATE content_entries 
       SET status = $1, published_at = $2, updated_at = NOW() 
       WHERE id = $3 
       RETURNING *`,
      [status, publishedAt, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    return res.status(200).json({ 
      message: publish ? 'Entry published successfully' : 'Entry unpublished successfully',
      entry: result.rows[0]
    });
  } catch (error) {
    logger.error('Error publishing/unpublishing entry:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    // Check DB connection
    const result = await pool.query('SELECT 1');
    
    return res.status(200).json({
      status: 'healthy',
      services: {
        postgres: 'connected'
      }
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    return res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed'
    });
  }
});

// Start server
app.listen(PORT, () => {
  logger.info(`Content Service running on port ${PORT}`);
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
    
    // Close pool
    await pool.end();
    logger.info('Database connection pool closed');
    
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
    
    // Close pool
    await pool.end();
    logger.info('Database connection pool closed');
    
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});
