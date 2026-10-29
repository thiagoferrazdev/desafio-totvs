import { cacheSnapshotAge } from '../../shared/metrics';
import { runInSpan } from '../../shared/tracing';
import { CatalogFreshness, CatalogItem, ProductCatalog } from '../ports/product-catalog';
import { StockLevels } from '../ports/stock-levels';
import { QueryHandler } from '../query-handler';

export interface CatalogProduct {
  sku: string;
  name: string;
  price: number;
  available: number;
  inStock: boolean;
}

export interface CatalogPage {
  products: CatalogProduct[];
  freshness: CatalogFreshness;
  ageMs: number;
}

export class ListCatalogQuery {}

export class ListCatalogHandler implements QueryHandler<ListCatalogQuery, CatalogPage> {
  constructor(
    private readonly catalog: ProductCatalog,
    private readonly stock: StockLevels,
  ) {}

  execute(_query: ListCatalogQuery): Promise<CatalogPage> {
    return runInSpan('catalog.list_products', {}, async () => {
      const snapshot = await this.catalog.loadSnapshot();
      cacheSnapshotAge.set({ cache: 'catalog' }, snapshot.ageMs / 1000);
      return {
        products: snapshot.items.map((item) => this.withLiveAvailability(item)),
        freshness: snapshot.freshness,
        ageMs: snapshot.ageMs,
      };
    });
  }

  private withLiveAvailability(item: CatalogItem): CatalogProduct {
    const availableUnits = this.stock.getAvailableUnits(item.sku) ?? 0;
    return {
      sku: item.sku,
      name: item.name,
      price: item.priceInCents,
      available: availableUnits,
      inStock: availableUnits > 0,
    };
  }
}
