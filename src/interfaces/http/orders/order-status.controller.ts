import { Controller, Get, HttpStatus, Param } from '@nestjs/common';
import { GetOrderStatusHandler, GetOrderStatusQuery } from '../../../application/orders/get-order-status.query';
import { Order, OrderStatus } from '../../../domain/order';
import { ApiError } from '../errors/api-error';

export interface OrderStatusResponse {
  orderId: string;
  status: OrderStatus;
  attempts: number;
  invoiceId?: string;
  failureReason?: string;
  updatedAt: string;
}

@Controller('orders')
export class OrderStatusController {
  constructor(private readonly getOrderStatus: GetOrderStatusHandler) {}

  @Get(':orderId/status')
  async findOrderStatus(@Param('orderId') orderId: string): Promise<OrderStatusResponse> {
    const order = await this.getOrderStatus.execute(new GetOrderStatusQuery(orderId));
    if (!order) throw new ApiError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found');
    return statusResponseOf(order);
  }
}

function statusResponseOf(order: Order): OrderStatusResponse {
  return {
    orderId: order.id,
    status: order.status,
    attempts: order.invoicingAttempts,
    invoiceId: order.invoiceId,
    failureReason: order.failureReason,
    updatedAt: new Date(order.updatedAt).toISOString(),
  };
}
