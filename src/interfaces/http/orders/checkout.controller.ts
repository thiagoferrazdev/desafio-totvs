import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { PlaceOrderCommand, PlaceOrderResult, PricingUnavailableError } from '../../../application/orders/place-order.command';
import { PlaceOrderHandler } from '../../../application/orders/place-order.handler';
import { OrderStatus } from '../../../domain/order';
import { addOrderIdToRequestContext, currentRequestContext } from '../../../shared/request-context';
import { buildTraceparentHeader, runInSpan } from '../../../shared/tracing';
import { CheckoutErrorFactory } from './checkout-error.factory';
import { CheckoutRequestDto } from './checkout-request.dto';
import { RequiredIdempotencyKey } from './idempotency-key.decorator';

export interface CheckoutAcceptedResponse {
  orderId: string;
  status: OrderStatus;
  total: number;
}

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly placeOrder: PlaceOrderHandler) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  startCheckout(
    @RequiredIdempotencyKey() idempotencyKey: string,
    @Body() checkoutRequest: CheckoutRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CheckoutAcceptedResponse> {
    return runInSpan('POST /checkout', {}, async () => {
      const result = await this.placeOrderOrFail(
        new PlaceOrderCommand({
          customerId: checkoutRequest.customerId,
          items: checkoutRequest.items,
          idempotencyKey,
          correlationId: currentRequestContext().correlationId,
          traceparent: buildTraceparentHeader(),
        }),
      );
      if (!('order' in result)) throw CheckoutErrorFactory.fromRejection(result);

      const { order } = result;
      addOrderIdToRequestContext(order.id);
      response.setHeader('location', `/orders/${order.id}/status`);
      if (result.outcome === 'order_already_exists_for_key') response.setHeader('idempotent-replayed', 'true');
      return { orderId: order.id, status: order.status, total: order.totalInCents };
    });
  }

  private async placeOrderOrFail(command: PlaceOrderCommand): Promise<PlaceOrderResult> {
    try {
      return await this.placeOrder.execute(command);
    } catch (error) {
      if (error instanceof PricingUnavailableError) throw CheckoutErrorFactory.pricingUnavailable();
      throw error;
    }
  }
}
