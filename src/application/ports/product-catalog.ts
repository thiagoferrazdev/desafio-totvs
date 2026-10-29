export interface CatalogItem {
  sku: string;
  name: string;
  priceInCents: number;
}

export type CatalogFreshness = 'hit' | 'stale' | 'miss' | 'stale_if_error';

export interface CatalogSnapshot {
  items: CatalogItem[];
  freshness: CatalogFreshness;
  ageMs: number;
}

export abstract class ProductCatalog {
  abstract loadSnapshot(): Promise<CatalogSnapshot>;
}
