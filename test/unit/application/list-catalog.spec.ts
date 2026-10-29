import { ListCatalogHandler, ListCatalogQuery } from '../../../src/application/catalog/list-catalog.query';
import { ProductCatalog } from '../../../src/application/ports/product-catalog';
import { fakeStockLevels } from '../../support/fakes';

describe('ListCatalogHandler', () => {
  it('shows a product with no stock record as unavailable', async () => {
    const catalog: ProductCatalog = {
      loadSnapshot: async () => ({
        items: [{ sku: 'NEW-SKU', name: 'Capinha nova', priceInCents: 1_000 }],
        freshness: 'hit',
        ageMs: 0,
      }),
    };
    const handler = new ListCatalogHandler(catalog, fakeStockLevels(undefined));

    const page = await handler.execute(new ListCatalogQuery());

    expect(page.products).toEqual([{ sku: 'NEW-SKU', name: 'Capinha nova', price: 1_000, available: 0, inStock: false }]);
  });
});
