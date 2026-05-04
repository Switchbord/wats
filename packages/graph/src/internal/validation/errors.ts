import { GraphRequestValidationError } from "../../errors";

export function graphValidationError(message: string, cause?: unknown): GraphRequestValidationError {
  return new GraphRequestValidationError(message, cause);
}

export function wrapGraphValidation<T>(message: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof GraphRequestValidationError) throw error;
    throw graphValidationError(message, error);
  }
}
