import { CatalogItem } from '../../application/ports/product-catalog';

export interface ErpProductSource {
  listProducts(): Promise<CatalogItem[]>;
}
