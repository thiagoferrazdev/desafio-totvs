import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiError } from './errors/api-error';

interface FieldProblem {
  field: string;
  problems: string[];
}

export function describeValidationErrors(errors: ValidationError[], parentPath = ''): FieldProblem[] {
  return errors.flatMap((error) => {
    const fieldPath = parentPath ? `${parentPath}.${error.property}` : error.property;
    const ownProblems = error.constraints ? [{ field: fieldPath, problems: Object.values(error.constraints) }] : [];
    return [...ownProblems, ...describeValidationErrors(error.children ?? [], fieldPath)];
  });
}

export const requestBodyValidation = new ValidationPipe({
  whitelist: true,
  transform: true,
  exceptionFactory: (errors) =>
    new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Invalid request body', describeValidationErrors(errors)),
});
