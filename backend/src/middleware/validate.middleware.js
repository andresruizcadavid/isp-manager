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
  // Pagination — `coerce` parses string querystring values into numbers
  // and rejects NaN, vs the older `string.transform(Number)` which would
  // happily produce NaN on "abc". Bounds are HARD CAPS:
  //   • limit ∈ [1, 500] — the UI selector exposes 10/20/30/50/100 but
  //     internal "select all filtered" flows (bulk plan change, bulk
  //     modal preview) need up to 500 in one call. 500 matches the
  //     `clientIds.max(500)` cap used by bulk-change-plan so the two
  //     limits stay in lockstep. The cap protects the server from
  //     "?limit=1000000" memory exhaustion attacks.
  //   • page ≥ 1
  pagination: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(500).default(10),
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
