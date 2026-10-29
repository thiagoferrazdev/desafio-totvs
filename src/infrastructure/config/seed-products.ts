export interface SeedProduct {
  sku: string;
  name: string;
  priceInCents: number;
  stockUnits: number;
}

export const SEED_PRODUCTS: SeedProduct[] = [
  { sku: 'CASE-IPH15-BLK', name: 'Capinha iPhone 15 Preta', priceInCents: 7990, stockUnits: 50 },
  { sku: 'CASE-S24-CLR', name: 'Capinha Galaxy S24 Transparente', priceInCents: 5990, stockUnits: 3 },
  { sku: 'CASE-PX8-BLU', name: 'Capinha Pixel 8 Azul', priceInCents: 6990, stockUnits: 0 },
];
