export interface QueryHandler<TQuery, TResult> {
  execute(query: TQuery): Promise<TResult>;
}
