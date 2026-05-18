import { env } from '../config/env.js';

export const errorMiddleware = (error, req, res, next) => {
  console.error('Error occurred:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Prisma errors
  if (error.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_ENTRY',
        message: 'Registro duplicado',
        details: env.NODE_ENV === 'development' ? error.meta : undefined
      }
    });
  }

  if (error.code === 'P2025') {
    return res.status(404).json({
      success: false,
      error: {
        code: 'RECORD_NOT_FOUND',
        message: 'Registro no encontrado'
      }
    });
  }

  if (error.code === 'P2003') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'FOREIGN_KEY_CONSTRAINT',
        message: 'Violación de restricción de clave externa'
      }
    });
  }

  // Validation errors
  if (error.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Error de validación',
        details: error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }))
      }
    });
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Token inválido'
      }
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: {
        code: 'TOKEN_EXPIRED',
        message: 'Token expirado'
      }
    });
  }

  // Multer errors (file upload)
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message: 'Archivo demasiado grande'
      }
    });
  }

  if (error.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'TOO_MANY_FILES',
        message: 'Demasiados archivos'
      }
    });
  }

  // Custom application errors
  if (error.isOperational) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: {
        code: error.code || 'APPLICATION_ERROR',
        message: error.message
      }
    });
  }

  // Default error
  const statusCode = error.statusCode || 500;
  const message = env.NODE_ENV === 'production' 
    ? 'Error interno del servidor' 
    : error.message || 'Error desconocido';

  res.status(statusCode).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message,
      ...(env.NODE_ENV === 'development' && {
        stack: error.stack,
        details: error
      })
    }
  });
};

// Custom error class
export class AppError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// Async error wrapper
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
