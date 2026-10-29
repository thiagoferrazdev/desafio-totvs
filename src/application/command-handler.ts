export interface CommandHandler<TCommand, TResult = void> {
  execute(command: TCommand): Promise<TResult>;
}
