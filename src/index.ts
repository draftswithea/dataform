import type { z, ZodTypeAny } from "zod";

// ------------------ Public Types ------------------

export interface PersistOptions {
  /** Storage key. A UUID is generated when omitted; read it back from `form.key`. */
  key?: string;
  /** Maximum delay before pending changes are written. Default: 300. */
  delayMs?: number;
  /** Discard persisted state older than this many milliseconds. Default: never. */
  ttlMs?: number;
  /** Bump to discard drafts saved under an incompatible shape. Default: 1. */
  version?: number;
}

export interface DataformOptions {
  /** Persist state (including Blobs and Files) to IndexedDB. */
  persist?: boolean | PersistOptions;
}

export interface Dataform<T> {
  /** Reactive state. Mutate it like a plain object. */
  readonly data: T;
  /** Persistence key, or undefined when persistence is disabled. */
  readonly key: string | undefined;
  /** Resolves once any persisted state has been restored. */
  readonly ready: Promise<void>;
  subscribe(listener: () => void): () => void;
  getFormData(): FormData;
  /** Deletes the persisted copy. */
  clear(): Promise<void>;
  /** Flushes pending writes and detaches all listeners. */
  dispose(): Promise<void>;
}

// ------------------ Internal Types ------------------

type ResolvedPersist = Required<PersistOptions>;

interface PersistedRecord {
  data: object;
  version: number;
  updatedAt: number;
}

interface Persister {
  load(): Promise<object | undefined>;
  schedule(): void;
  clear(): Promise<void>;
  dispose(): Promise<void>;
}

// ------------------ Type Guards ------------------

/** Plain objects and arrays: the only values tracked and serialized recursively. */
function isContainer(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const isZodSchema = (value: unknown): value is ZodTypeAny =>
  typeof (value as ZodTypeAny | undefined)?.safeParse === "function";

// ------------------ IndexedDB ------------------

const DB_NAME = "dataform";
const STORE = "forms";
const UPDATED_AT_INDEX = "updatedAt";

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result
        .createObjectStore(STORE)
        .createIndex(UPDATED_AT_INDEX, "updatedAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = undefined; // allow a later retry
      reject(request.error);
    };
  });
  return dbPromise;
}

/** Runs a single request and resolves once its transaction has committed. */
async function withStore<R>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<R>,
): Promise<R> {
  const db = await openDb();
  return new Promise<R>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/** Keys of every persisted form, e.g. to offer "resume draft" UIs. */
export const listFormKeys = () =>
  withStore<IDBValidKey[]>("readonly", (store) => store.getAllKeys());

/** Removes persisted forms not written to within `maxAgeMs`. Call once on app start. */
export async function purgeExpiredForms(maxAgeMs: number): Promise<void> {
  const range = IDBKeyRange.upperBound(Date.now() - maxAgeMs);
  await withStore("readwrite", (store) => {
    const request = store.index(UPDATED_AT_INDEX).openKeyCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    return request;
  });
}

// ------------------ Reactive Proxy ------------------

/** Maps every proxy back to its target so assigned proxies are stored unwrapped. */
const rawByProxy = new WeakMap<object, object>();

const toRaw = <V>(value: V): V =>
  (rawByProxy.get(value as object) as V | undefined) ?? value;

/**
 * Wraps `root` in a change-tracking proxy. Children are proxied lazily on first
 * access and cached, so the underlying data is never mutated or eagerly walked.
 */
function createReactive<T extends object>(root: T, onChange: () => void): T {
  const proxies = new WeakMap<object, object>();

  const wrap = (target: object): object => {
    let proxy = proxies.get(target);
    if (!proxy) {
      proxy = new Proxy(target, handler);
      proxies.set(target, proxy);
      rawByProxy.set(proxy, target);
    }
    return proxy;
  };

  const handler: ProxyHandler<object> = {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      return isContainer(value) ? wrap(value) : value;
    },
    set(target, prop, value) {
      const next = toRaw(value);
      const previous = Reflect.get(target, prop);
      const ok = Reflect.set(target, prop, next);
      if (ok && !Object.is(previous, next)) onChange();
      return ok;
    },
    deleteProperty(target, prop) {
      const ok = Reflect.deleteProperty(target, prop);
      if (ok) onChange();
      return ok;
    },
  };

  return wrap(root) as T;
}

/** Swaps the contents of `target` in place so existing references stay valid. */
function replaceContents(target: object, source: object): void {
  if (Array.isArray(target)) {
    target.length = 0;
  } else {
    for (const key of Object.keys(target)) {
      delete (target as Record<string, unknown>)[key];
    }
  }
  Object.assign(target, source);
}

// ------------------ FormData Serialization ------------------

function serializeScalar(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return value === null ? "" : String(value);
}

function appendToFormData(formData: FormData, value: unknown, key = ""): void {
  if (value === undefined) return;

  if (value instanceof Blob) {
    formData.append(key, value);
  } else if (isContainer(value)) {
    for (const [childKey, child] of Object.entries(value)) {
      appendToFormData(formData, child, key ? `${key}[${childKey}]` : childKey);
    }
  } else {
    formData.append(key, serializeScalar(value));
  }
}

// ------------------ Persistence ------------------

const PERSIST_DEFAULTS = { delayMs: 300, ttlMs: Infinity, version: 1 } as const;

const generateKey = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function resolvePersist(
  persist: DataformOptions["persist"],
): ResolvedPersist | undefined {
  if (!persist) return undefined;
  const overrides = persist === true ? {} : persist;
  return {
    ...PERSIST_DEFAULTS,
    ...overrides,
    key: overrides.key ?? generateKey(),
  };
}

const warn = (error: unknown) =>
  console.warn("[dataform] persistence error:", error);

const noopPersister: Persister = {
  load: async () => undefined,
  schedule: () => undefined,
  clear: async () => undefined,
  dispose: async () => undefined,
};

function createPersister(
  root: object,
  { key, delayMs, ttlMs, version }: ResolvedPersist,
  schema?: ZodTypeAny,
): Persister {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    // IndexedDB structured-clones the record synchronously inside put().
    const record: PersistedRecord = {
      data: root,
      version,
      updatedAt: Date.now(),
    };
    await withStore("readwrite", (store) => store.put(record, key)).catch(warn);
  };

  // Debounced writes would otherwise be lost when the tab closes.
  const flushWhenHidden = () => {
    if (document.visibilityState === "hidden") void flush();
  };
  globalThis.document?.addEventListener("visibilitychange", flushWhenHidden);

  return {
    async load() {
      try {
        const record = await withStore<PersistedRecord | undefined>(
          "readonly",
          (store) => store.get(key),
        );
        if (!record || record.version !== version) return undefined;
        if (Date.now() - record.updatedAt > ttlMs) return undefined;
        if (!schema) return record.data;

        const result = schema.safeParse(record.data);
        return result.success ? result.data : undefined;
      } catch (error) {
        warn(error);
        return undefined;
      }
    },

    // Throttled rather than debounced: one timer per burst, no reset per mutation.
    schedule() {
      timer ??= setTimeout(flush, delayMs);
    },

    async clear() {
      clearTimeout(timer);
      timer = undefined;
      await withStore("readwrite", (store) => store.delete(key)).catch(warn);
    },

    async dispose() {
      globalThis.document?.removeEventListener(
        "visibilitychange",
        flushWhenHidden,
      );
      await flush();
    },
  };
}

// ------------------ Main API ------------------

export function dataform<T extends object>(
  initialData: T,
  options?: DataformOptions,
): Dataform<T>;

export function dataform<S extends ZodTypeAny>(
  initialData: z.input<S>,
  schema: S,
  options?: DataformOptions,
): Dataform<z.output<S>>;

export function dataform(
  initialData: unknown,
  second?: ZodTypeAny | DataformOptions,
  third?: DataformOptions,
): Dataform<unknown> {
  if (!isContainer(initialData)) {
    throw new TypeError("dataform only supports plain object and array roots");
  }

  const schema = isZodSchema(second) ? second : undefined;
  const options = ((schema ? third : second) ?? {}) as DataformOptions;

  const root = structuredClone(
    schema ? schema.parse(initialData) : initialData,
  ) as object;
  const config = resolvePersist(options.persist);
  const persister = config
    ? createPersister(root, config, schema)
    : noopPersister;

  const listeners = new Set<() => void>();
  let touched = false;
  let notifyQueued = false;

  const notify = () => listeners.forEach((listener) => listener());

  // Coalesces bursts of mutations (e.g. array.push in a loop) into one notification.
  const onChange = () => {
    touched = true;
    persister.schedule();
    if (notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      notify();
    });
  };

  const data = createReactive(root, onChange);

  // Edits made before hydration finishes take precedence over the stored draft.
  const ready = persister.load().then((stored) => {
    if (!stored || touched || Array.isArray(stored) !== Array.isArray(root))
      return;
    replaceContents(root, stored);
    notify();
  });

  return {
    data,
    key: config?.key,
    ready,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getFormData() {
      const formData = new FormData();
      appendToFormData(formData, root); // raw root avoids proxy overhead
      return formData;
    },
    clear: persister.clear,
    async dispose() {
      listeners.clear();
      await persister.dispose();
    },
  };
}

// ------------------ Utility Type ------------------

export type DeepWritable<T> = T extends Blob | Date
  ? T
  : { -readonly [K in keyof T]: DeepWritable<T[K]> };
