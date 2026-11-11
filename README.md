<img
  src="https://raw.githubusercontent.com/draftswithea/draftswithea/main/assets/draftswithea-indicator.png"
  alt="dataform"
  style="display: block; margin: 0 auto;"
  width="300"
/>

**Dataform** keeps your form's data in one object, lets you edit it like any normal JavaScript object, and turns it into `FormData` when you're ready to submit. It handles files and images, can optionally validate with Zod, and can save drafts in the browser so they survive a page refresh.

Start with the basics below. Each section adds one capability, so you only need to read as far as your project requires.

## Contents

1. [Install](#1-install)
2. [Your first form](#2-your-first-form)
3. [Submitting with FormData](#3-submitting-with-formdata)
4. [Uploading files and images](#4-uploading-files-and-images)
5. [Listening for changes](#5-listening-for-changes)
6. [Validating with Zod](#6-validating-with-zod)
7. [Saving drafts](#7-saving-drafts)
8. [Cleaning up](#8-cleaning-up)
9. [Managing stored drafts](#9-managing-stored-drafts)
10. [API reference](#10-api-reference)
11. [Limitations](#11-limitations)

---

## 1. Install

```bash
npm install @draftswithea/dataform zod
```

```bash
pnpm add @draftswithea/dataform zod
```

Zod is a peer dependency. You only need it for validation (section 6), but TypeScript also uses its types, so install it either way.

Alternatively, you can copy `src/index.ts` into your project and skip the package.

---

## 2. Your first form

Pass in your starting data, and you get back an object called `data`:

```ts
import { dataform } from "@draftswithea/dataform";

const form = dataform({
  name: "Alice",
  email: "alice@example.com",
  age: 30,
});

form.data.name = "Bob";
console.log(form.data.name); // "Bob"
```

`data` behaves like a normal object. Assigning to it updates the form, and nested values work the same way:

```ts
const form = dataform({
  user: { name: "Alice", settings: { darkMode: true } },
  tags: ["tech"],
});

form.data.user.settings.darkMode = false;
form.data.tags.push("javascript");
```

> **Note:** The root must be a plain object or an array. You can't start with a class instance, `Map`, or `Set`.

---

## 3. Submitting with FormData

When you're ready to send the form, call `getFormData()`:

```ts
const formData = form.getFormData();

await fetch("/api/signup", { method: "POST", body: formData });
```

Nested fields use bracket notation, which most servers can parse:

| Your data                     | FormData entry                                     |
| ----------------------------- | -------------------------------------------------- |
| `{ user: { name: "Alice" } }` | `user[name]=Alice`                                 |
| `{ tags: ["a", "b"] }`        | `tags[0]=a`, `tags[1]=b`                           |
| `{ joined: new Date(...) }`   | ISO string, e.g. `joined=2026-11-11T00:00:00.000Z` |
| `{ nickname: null }`          | `nickname=` (empty string)                         |
| `{ nickname: undefined }`     | Skipped                                            |

---

## 4. Uploading files and images

`File` and `Blob` values are added to FormData as files, not strings, so you can store them directly:

```ts
const form = dataform({
  title: "",
  avatar: null as File | null,
  attachments: [] as File[],
});

avatarInput.addEventListener("change", (event) => {
  form.data.avatar = event.target.files[0];
});

attachInput.addEventListener("change", (event) => {
  form.data.attachments.push(...event.target.files);
});

// Submitting sends the files as multipart/form-data
await fetch("/api/upload", { method: "POST", body: form.getFormData() });
```

Tip: Set `null` as the starting value and type it with `as File | null`, so TypeScript knows the field will hold a file later.

---

## 5. Listening for changes

Use `subscribe` to run code whenever the form changes. This is how you connect dataform to a UI framework or update a preview:

```ts
const unsubscribe = form.subscribe(() => {
  preview.textContent = form.data.name;
});

// Later, when you no longer need updates:
unsubscribe();
```

Rapid changes (like pushing 100 items in a loop) are batched, so your listener runs once per tick instead of once per change.

With React, you can connect it to `useSyncExternalStore`:

```ts
const snapshot = useSyncExternalStore(form.subscribe, () => form.data);
```

---

## 6. Validating with Zod

Pass a Zod schema as the second argument to check and type your data:

```ts
import { z } from "zod";
import { dataform } from "@draftswithea/dataform";

const signupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  age: z.number().min(18),
  avatar: z.instanceof(File).optional(),
});

const form = dataform(
  { name: "Alice", email: "alice@example.com", age: 25 },
  signupSchema,
);
```

Two things happen when you pass a schema:

1. The initial data is validated. If it doesn't match, `dataform` throws the Zod error.
2. `form.data` is typed from the schema, so `form.data.age` is a `number` in your editor.

Validation runs when the form is created, and again when a saved draft is restored (section 7). To check the current values before submitting, run the schema yourself:

```ts
const result = signupSchema.safeParse(form.data);

if (!result.success) {
  console.log(result.error.issues);
}
```

---

## 7. Saving drafts

Add `persist` to keep the form's data in IndexedDB. Drafts can include files and images, and they're restored after a page refresh:

```ts
const form = dataform(
  { name: "", avatar: null as File | null },
  { persist: true },
);

await form.ready; // Wait for any saved draft to load
```

Changes are saved shortly after you make them, and pending changes are saved when the tab is hidden. Persistence failures log a warning and never throw.

### Resuming a draft

Each form gets its own key, so separate forms never overwrite each other. To resume a draft later, store the key somewhere you can read it back, such as the URL, `sessionStorage`, or route state:

```ts
const form = dataform(
  { name: "", avatar: null as File | null },
  { persist: true },
);

sessionStorage.setItem("signup-draft", form.key!);
```

Then, on a later visit:

```ts
const key = sessionStorage.getItem("signup-draft") ?? undefined;

const form = dataform(
  { name: "", avatar: null as File | null },
  { persist: { key } },
);

await form.ready;
```

If no key is found, `key` is `undefined`, and dataform starts a new draft.

### Persistence options

```ts
dataform(initialData, {
  persist: {
    key: "my-draft", // Use a specific key (default: a generated UUID)
    delayMs: 300, // Wait this long after the last change before saving
    ttlMs: 7 * 24 * 60 * 60 * 1000, // Ignore drafts older than 7 days
    version: 2, // Ignore drafts saved under an older version
  },
});
```

Use `version` when your form's shape changes. Increase it, and old drafts are ignored instead of loading the wrong fields.

### Schema and drafts

When you use persistence with a schema, every restored draft is validated. If the draft doesn't match the schema, it's discarded and you start from `initialData`.

### Edits before restore

If you change a field before `ready` resolves, your edit wins and the saved draft is not applied. Await `ready` before your first edit if you want the draft to load first.

---

## 8. Cleaning up

Two methods handle teardown:

```ts
// Delete the saved draft (e.g., after a successful submit)
await form.clear();

// Save any pending changes and stop listening (e.g., when a component unmounts)
await form.dispose();
```

In React, call `dispose()` in the effect cleanup:

```ts
useEffect(() => {
  const form = dataform(initial, { persist: true });
  return () => void form.dispose();
}, []);
```

---

## 9. Managing stored drafts

Abandoned drafts stay in IndexedDB unless you remove them. Two helpers let you manage them:

```ts
import { listFormKeys, purgeExpiredForms } from "@draftswithea/dataform";

// Run once when your app starts: delete drafts not updated in 30 days
await purgeExpiredForms(30 * 24 * 60 * 60 * 1000);

// Get every stored draft key, e.g. to show a "resume draft" list
const keys = await listFormKeys();
```

---

## 10. API reference

### `dataform(initialData, options?)`

Creates a form without a schema.

| Parameter     | Type              | Description         |
| ------------- | ----------------- | ------------------- |
| `initialData` | `object \| array` | Starting state      |
| `options`     | `DataformOptions` | Optional, see below |

### `dataform(initialData, schema, options?)`

Creates a form validated by a Zod schema. `data` is typed from the schema.

### Returned object

| Property / method     | Description                                                      |
| --------------------- | ---------------------------------------------------------------- |
| `data`                | Reactive state. Edit it like a normal object.                    |
| `key`                 | Persistence key, or `undefined` if persistence is off            |
| `ready`               | Promise that resolves once any saved draft has loaded            |
| `subscribe(listener)` | Calls `listener` after changes. Returns an unsubscribe function. |
| `getFormData()`       | Returns the current state as `FormData`                          |
| `clear()`             | Deletes the saved draft                                          |
| `dispose()`           | Saves pending changes and stops listening                        |

### `DataformOptions`

| Option    | Type                        | Default     | Description                    |
| --------- | --------------------------- | ----------- | ------------------------------ |
| `persist` | `boolean \| PersistOptions` | `undefined` | Turns on IndexedDB persistence |

### `PersistOptions`

| Option    | Type     | Default        | Description                                   |
| --------- | -------- | -------------- | --------------------------------------------- |
| `key`     | `string` | Generated UUID | Storage key for this form                     |
| `delayMs` | `number` | `300`          | Wait time after the last change before saving |
| `ttlMs`   | `number` | Never expires  | Ignore drafts older than this                 |
| `version` | `number` | `1`            | Ignore drafts saved under a different version |

### Helpers

| Function                      | Description                                  |
| ----------------------------- | -------------------------------------------- |
| `listFormKeys()`              | Returns the keys of all stored drafts        |
| `purgeExpiredForms(maxAgeMs)` | Deletes drafts not updated within `maxAgeMs` |

### Types

| Type              | Description                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `Dataform<T>`     | The object returned by `dataform`                                                                    |
| `DataformOptions` | Options for `dataform`                                                                               |
| `PersistOptions`  | Options for `persist`                                                                                |
| `DeepWritable<T>` | Removes `readonly` from a type, including nested properties. `Blob` and `Date` are left as they are. |

---

## 11. Limitations

- **Root type:** Must be a plain object or array.
- **Plain data only:** Class instances, `Map`, and `Set` are not tracked or serialized. `Date` is converted to an ISO string.
- **Circular references:** Not supported.
- **Encoding:** FormData uses `multipart/form-data`, not JSON, so your server needs to parse bracket notation (e.g., `user[name]`).
- **Storage:** Persistence uses IndexedDB, so it requires a browser environment. Server-side rendering needs persistence turned off or guarded.

## Browser support

Works in modern browsers that support:

- Proxy (ES2015)
- FormData and Blob/File
- IndexedDB (for persistence only)
- `structuredClone`

## Migrating from `frmz`

| Before                                    | After                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `import { frmz } from "frmz"`             | `import { dataform } from "@draftswithea/dataform"`                     |
| `const { data, getFormData } = frmz(...)` | `const form = dataform(...)`, then `form.data` and `form.getFormData()` |
| Schema inferred automatically             | Schema is optional. Pass one to validate.                               |
| No persistence                            | `{ persist: true }`                                                     |

## Contributing

Found an issue or want to add a feature? Open an issue or pull request on the GitHub repository.

## License

[MIT LICENSE](./LICENSE.md)
