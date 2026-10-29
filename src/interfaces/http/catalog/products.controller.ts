import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { CatalogPage, CatalogProduct, ListCatalogHandler, ListCatalogQuery } from '../../../application/catalog/list-catalog.query';
import { runInSpan } from '../../../shared/tracing';
import { ApiError } from '../errors/api-error';

const BROWSER_AND_CDN_CACHE_SECONDS = 5;

@Controller('products')
export class ProductsController {
  constructor(private readonly listCatalog: ListCatalogHandler) {}

  @Get()
  listProducts(@Res({ passthrough: true }) response: Response): Promise<{ items: CatalogProduct[] }> {
    return runInSpan('GET /products', {}, async () => {
      const page = await this.loadCatalogOrFail();
      setCacheHeaders(response, page);
      return { items: page.products };
    });
  }

  private async loadCatalogOrFail(): Promise<CatalogPage> {
    try {
      return await this.listCatalog.execute(new ListCatalogQuery());
    } catch {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'CATALOG_UNAVAILABLE', 'Catalog temporarily unavailable');
    }
  }
}

function setCacheHeaders(response: Response, page: CatalogPage): void {
  response.setHeader('x-cache', page.freshness);
  response.setHeader('age', Math.floor(page.ageMs / 1000));
  response.setHeader('cache-control', `public, max-age=${BROWSER_AND_CDN_CACHE_SECONDS}`);
}
