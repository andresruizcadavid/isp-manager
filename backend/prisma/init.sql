-- Create database if it doesn't exist
-- This file is used for Docker initialization

-- Set timezone
SET timezone = 'America/Bogota';

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create indexes for better performance
-- These will be created by Prisma migrations, but we can add them here for initial setup
