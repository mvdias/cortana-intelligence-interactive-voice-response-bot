import async = require('async');
import { QueryOptions, SearchCallback, SearchResponse, SearchResult, SearchResultDocument } from 'azure-search-client';
import { Entity, LuisResult } from 'cognitive-luis-client';
import { SpeechResult } from 'cognitive-speech-client';
import { SEARCH_SETTINGS } from './config';
import _ from './lodash-mixins';
import { SEARCH } from './services';
import { getEntityScopes, setImmediate } from './util';

export interface SkuAttributes {
  [key: string]: string;
}
export interface ProductSku extends SkuAttributes {
  productNumber: string;
}
export interface ProductSkuSelection {
  skus: ProductSku[];
  entities: Entity[];
  selected: SkuAttributes;
  product: string;
  attribute?: string;
}

export type FindProductCallback = (err: Error, matches: SearchResultDocument[]) => void;

class App {
  findProduct(speech: SpeechResult, luis: LuisResult, callback: FindProductCallback): void {
    const query = this.getProductQuery(speech.header.name, luis.entities);

    async.waterfall([
      (next: SearchCallback<SearchResult>) => {
        SEARCH.search(SEARCH_SETTINGS.index, query, next);
      },
      (searchResp: SearchResponse<SearchResult>, next: FindProductCallback) => {
        const candidates = this.rankProducts(speech.header.name, searchResp.result.value);
        // const resultsWithAllEntities = searchResp.result.value
        //   .filter((doc) => util.hasAllEntities(doc, luis.entities, SEARCH_SETTINGS.entities));
        setImmediate(next, null, candidates);
      },
    ], callback);
  }

  rankProducts(queryText: string, searchResults: SearchResultDocument[]): SearchResultDocument[] {
    const queryTokens = this.tokenize(queryText);
    return _.chain(searchResults)
      .each((result) => {
        const resultTokens = this.tokenize(result.name);
        result.$score = _.xdiff(resultTokens, queryTokens).length / resultTokens.length;
      })
      .sortBy('$score')
      .takeWhile((x, i, array) => i === 0 || x.$score === array[i - 1].$score)
      .value();
  }

  getSkuChoices(args: ProductSkuSelection): ProductSku[] {
    args.entities
      .map((x) => {
        return { mapping: _.find(SEARCH_SETTINGS.entities, {entity: x.type}), entity: x };
      })
      .filter((x) => x.mapping && x.mapping.sku)
      .forEach((x) => {
        const canonical = _.keys(x.entity.resolution)[0].toLowerCase();
        const filtered = _.filter(args.skus, (sku) => sku[x.mapping.sku].toLowerCase() === canonical);
        if (filtered.length > 0) {
          args.skus = filtered;
        }
      });
    _.each(args.selected, (v, k) => {
      args.skus = args.skus.filter((x) => x[k] === v);
    });
    return args.skus;
  }

  getNextSkuAttribute(skus: ProductSku[]): {name: string, choices: string[]} {
    const sets = skus.reduce((m, c) => {
      Object.keys(c)
        .filter((x) => x !== 'productNumber')
        .forEach((x) => {
          m[x] = m[x] || new Set<string>();
          m[x].add(c[x]);
        });
      return m;
    }, {});

    return Object.keys(sets)
      .map((x) => ({
        choices: Array.from<string>(sets[x]),
        name: x,
      })).find((x) => x.choices.length > 1);
  }

  private tokenize(text: string): string[] {
    return text.replace(/\W/g, ' ').trim().toLowerCase().split(/\s+/);
  }

  private getProductQuery(searchText: string, entities: Entity[]): QueryOptions {
    const entityScopes = getEntityScopes(entities, SEARCH_SETTINGS.entities);
    return {
      queryType: 'full',
      search: `${searchText} ${entityScopes}`,
      select: 'name,category,colors,sizes,sex,products,description_EN',
      top: 3,
    };
  }
}

export const APP = new App();
