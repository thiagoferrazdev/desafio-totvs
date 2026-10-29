import { Clock } from '../../application/ports/clock';
import { CatalogItem, CatalogSnapshot, ProductCatalog } from '../../application/ports/product-catalog';
import { logger } from '../../shared/logger';
import { runInSpan } from '../../shared/tracing';
import { StaleWhileRevalidateCache } from '../cache/stale-while-revalidate-cache';
import { ErpProductSource } from './erp-product-source';

export interface CatalogCacheSettings {
  freshForMs: number;
  serveStaleWhileRefreshingForMs: number;
  serveStaleOnErrorForMs: number;
  ttlJitterRatio: number;
}

const CATALOG_CACHE_KEY = 'catalog';

export class CachedErpProductCatalog implements ProductCatalog {
  private readonly cache: StaleWhileRevalidateCache<CatalogItem[]>;

  constructor(
    private readonly erp: ErpProductSource,
    settings: CatalogCacheSettings,
    clock: Clock,
  ) {
    this.cache = new StaleWhileRevalidateCache<CatalogItem[]>({
      name: 'catalog',
      ...settings,
      clock,
      onBackgroundRefreshFailed: (error) => logger.warn({ err: String(error) }, 'catalog refresh failed, serving stale data'),
    });
  }

  loadSnapshot(): Promise<CatalogSnapshot> {
    return runInSpan('cache.get', { 'cache.name': 'catalog' }, async () => {
      const cached = await this.cache.getOrLoad(CATALOG_CACHE_KEY, () => this.erp.listProducts());
      return { items: cached.value, freshness: cached.result, ageMs: cached.ageMs };
    });
  }
}
