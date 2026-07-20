import '@testing-library/jest-dom/vitest';

/**
 * localStorage determinista para los tests.
 *
 * El que expone el entorno jsdom de este proyecto no implementa `clear()`, y la
 * app depende de localStorage para la sesión. En vez de sortearlo test por test,
 * se instala una implementación completa en memoria.
 */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }
}

// Se define en `window` Y en `globalThis`: el entorno los expone como bindings
// distintos, asi que si solo se parchea uno, el codigo de la app (que usa el
// binding global) y los tests (que leen window) terminan viendo storages
// distintos — la sesion se escribe en uno y se lee del otro.
const storage = new MemoryStorage();

for (const target of new Set<object>([window, globalThis])) {
  Object.defineProperty(target, 'localStorage', {
    value: storage,
    writable: false,
    configurable: true,
  });
}
