export class ProductStock {
  private constructor(
    private readonly totalUnits: number,
    private availableUnits: number,
    private reservedUnits: number,
  ) {}

  static withUnits(units: number): ProductStock {
    return new ProductStock(units, units, 0);
  }

  unitsAvailable(): number {
    return this.availableUnits;
  }

  canReserve(units: number): boolean {
    return this.availableUnits >= units;
  }

  reserve(units: number): void {
    this.availableUnits -= units;
    this.reservedUnits += units;
  }

  confirmSale(units: number): void {
    this.reservedUnits -= units;
  }

  release(units: number): void {
    this.reservedUnits -= units;
    this.availableUnits += units;
  }

  isConsistent(): boolean {
    const nothingNegative = this.availableUnits >= 0 && this.reservedUnits >= 0;
    const neverAboveTotal = this.availableUnits + this.reservedUnits <= this.totalUnits;
    return nothingNegative && neverAboveTotal;
  }
}
