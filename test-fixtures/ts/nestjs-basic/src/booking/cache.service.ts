import { Injectable, Inject } from '@nestjs/common';

@Injectable()
export class CacheService {
  constructor(@Inject('CACHE_MANAGER') private readonly cacheManager: CacheManager) {}

  get(key: string) {
    return this.cacheManager.get(key);
  }
}
