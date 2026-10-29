export abstract class StockLevels {
  abstract getAvailableUnits(sku: string): number | undefined;

  abstract isStockConsistent(): boolean;
}
