import { Order } from '../../domain/order';
import { OrderRepository } from '../ports/order-repository';
import { QueryHandler } from '../query-handler';

export class GetOrderStatusQuery {
  constructor(readonly orderId: string) {}
}

export class GetOrderStatusHandler implements QueryHandler<GetOrderStatusQuery, Order | undefined> {
  constructor(private readonly orders: OrderRepository) {}

  async execute(query: GetOrderStatusQuery): Promise<Order | undefined> {
    return this.orders.findOrderById(query.orderId);
  }
}
