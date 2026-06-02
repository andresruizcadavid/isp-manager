import { z } from 'zod';
import { AppError } from './error.middleware.js';

export const validateBody = (schema) => {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(error);
        return;
      }
      next(error);
    }
  };
};

export const validateQuery = (schema) => {
  return (req, res, next) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(error);
        return;
      }
      next(error);
    }
  };
};

export const validateParams = (schema) => {
  return (req, res, next) => {
    try {
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(error);
        return;
      }
      next(error);
    }
  };
};

// Common validation schemas
export const commonSchemas = {
  // Pagination
  pagination: z.object({
    page: z.string().transform(Number).default('1'),
    limit: z.string().transform(Number).default('10'),
    search: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc')
  }),

  // ID parameter
  idParam: z.object({
    id: z.string().min(1, 'ID es requerido')
  }),

  // Date range
  dateRange: z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional()
  }),

  // Status filter
  statusFilter: z.object({
    status: z.string().optional()
  })
};

// Response validation helper
export const validateResponse = (data, schema) => {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Response validation error:', error.errors);
      throw new AppError(
        'Error en el formato de respuesta del servidor',
        500,
        'RESPONSE_VALIDATION_ERROR'
      );
    }
    throw error;
  }
};
