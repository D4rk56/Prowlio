export interface LRUCache<K, V> {
    has(k: K): boolean;
    get(k: K): V | undefined;
    set(k: K, v: V): void;
    delete(k: K): boolean;
    clear(): void;
    size(): number;
}

export function makeLRU<K = string, V = unknown>(maxSize: number = 2000, ttlMs: number = 3600_000): LRUCache<K, V> {
    const map = new Map<K, { v: V; t: number }>();
    return {
        has(k: K): boolean {
            const e = map.get(k);
            if (!e) return false;
            if (Date.now() - e.t > ttlMs) {
                map.delete(k);
                return false;
            }
            return true;
        },
        get(k: K): V | undefined {
            const e = map.get(k);
            if (!e) return undefined;
            if (Date.now() - e.t > ttlMs) {
                map.delete(k);
                return undefined;
            }
            map.delete(k);
            map.set(k, e);
            return e.v;
        },
        set(k: K, v: V): void {
            if (map.has(k)) {
                map.delete(k);
            } else if (map.size >= maxSize) {
                const firstKey = map.keys().next().value;
                if (firstKey !== undefined) {
                    map.delete(firstKey);
                }
            }
            map.set(k, { v, t: Date.now() });
        },
        delete(k: K): boolean {
            return map.delete(k);
        },
        clear(): void {
            map.clear();
        },
        size(): number {
            return map.size;
        }
    };
}
