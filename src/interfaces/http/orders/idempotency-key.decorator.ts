import { createParamDecorator, ExecutionContext, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { ApiError } from '../errors/api-error';

const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 128;

function hasValidLength(key: string | undefined): key is string {
  return typeof key === 'string' && key.length >= MIN_KEY_LENGTH && key.length <= MAX_KEY_LENGTH;
}

export const RequiredIdempotencyKey = createParamDecorator((_: unknown, context: ExecutionContext): string => {
  const key = context.switchToHttp().getRequest<Request>().header('idempotency-key');
  if (hasValidLength(key)) return key;

  throw new ApiError(
    HttpStatus.BAD_REQUEST,
    'IDEMPOTENCY_KEY_REQUIRED',
    `Idempotency-Key header (${MIN_KEY_LENGTH}-${MAX_KEY_LENGTH} chars) is required`,
  );
});
