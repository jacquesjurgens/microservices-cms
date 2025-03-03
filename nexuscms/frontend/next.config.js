// frontend/next.config.js
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
  // For deployment in a subdirectory
  // basePath: '/app',
};
