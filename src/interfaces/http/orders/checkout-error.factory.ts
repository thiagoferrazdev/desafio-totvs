import { HttpStatus } from '@nestjs/common';
import { CheckoutRejection } from '../../../application/ports/order-repository';
import { ApiError } from '../errors/api-error';

type RejectionOutcome = CheckoutRejection['outcome'];
type RejectionOf<TOutcome extends RejectionOutcome> = Extract<CheckoutRejection, { outcome: TOutcome }>;
type ErrorBuilders = { [TOutcome in RejectionOutcome]: (rejection: RejectionOf<TOutcome>) => ApiError };

const ERROR_BUILDERS: ErrorBuilders = {
  out_of_stock: (rejection) =>
    new ApiError(HttpStatus.CONFLICT, 'OUT_OF_STOCK', `Insufficient stock for ${rejection.sku}`, {
      sku: rejection.sku,
      available: rejection.availableUnits,
    }),
  unknown_sku: (rejection) =>
    new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'UNKNOWN_SKU', `Unknown sku ${rejection.sku}`),
  idempotency_key_reused_with_different_payload: () =>
    new ApiError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency-Key was already used with a different payload',
    ),
};

export class CheckoutErrorFactory {
  static fromRejection(rejection: CheckoutRejection): ApiError {
    const buildError = ERROR_BUILDERS[rejection.outcome] as (rejection: CheckoutRejection) => ApiError;
    return buildError(rejection);
  }

  static pricingUnavailable(): ApiError {
    return new ApiError(
      HttpStatus.SERVICE_UNAVAILABLE,
      'PRICING_UNAVAILABLE',
      'Cannot price the order right now, retry later',
    );
  }
}
