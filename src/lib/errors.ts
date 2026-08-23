import { z, ZodError, ZodTypeAny } from 'zod';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string,
    public details: unknown = {}
  ) {
    super(message);
  }
}

export function parseOrThrow<T extends ZodTypeAny>(
  schema: T,
  value: unknown
): z.output<T> {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError(
        400,
        'Validation failed',
        'VALIDATION_ERROR',
        error.flatten()
      );
    }

    throw error;
  }
}