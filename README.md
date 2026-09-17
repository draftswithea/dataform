<img src="./public/logo.png" alt="Demo" width="100" height="100" />

# `frmz` - FormData Builder

A schema-aware reactive FormData builder with Zod validation and full Blob/File support. Manage form state, validate data, and generate submission-ready FormData with a reactive proxy.

## Features

- ✅ **Automatic Schema Inference**: Derive Zod schemas from your data structures
- ✅ **Manual Schema Validation**: Use custom Zod schemas for precise control
- ✅ **Reactive Data Proxy**: Live updates with deep object reactivity
- ✅ **Blob & File Support**: Perfect for file uploads and image handling
- ✅ **TypeScript First**: Full type safety and intelligent inference
- ✅ **FormData Generation**: Create fetch-ready FormData objects automatically

## Installation

Copy the `src/index.ts` into your project if you don't want to add additional dependencies to your project or

```bash
npm install frmz zod

pnpm add frmz zod
```

Note: Zod is a peer dependency and must be installed separately.

## Basic Usage

```ts
import { frmz } from "frmz";

// Create a form manager with automatic schema inference
const { data, getFormData } = frmz({
  user: {
    name: "Alice",
    email: "alice@example.com",
    age: 30,
  },
  preferences: {
    newsletter: true,
    tags: ["tech", "programming"],
  },
});

// Update values reactively
data.user.name = "Bob"; // Changes are tracked
data.preferences.tags.push("javascript");

// Generate FormData for submission
const formData = getFormData();
// formData contains: user[name]=Bob, user[email]=alice@example.com, etc.
```

## File Upload Example

```ts
// Handle file inputs with full type safety
document.getElementById("avatar").addEventListener("change", (e) => {
  const file = e.target.files[0];

  const { data, getFormData } = frmz({
    profile: {
      name: "John Doe",
      avatar: file, // File object handled properly
      documents: [file], // Works in arrays too
      metadata: {
        uploadDate: new Date().toISOString(),
      },
    },
  });

  // Submit to server
  fetch("/api/upload", {
    method: "POST",
    body: getFormData(), // Contains the file properly
  });
});
```

## Advanced Schema Validation

```ts
import { z } from "zod";
import { frmz } from "frmz";

const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  avatar: z.instanceof(Blob).optional(),
  age: z.number().min(18),
  tags: z.array(z.string()),
});

const { data, getFormData } = frmz(
  {
    name: "Alice",
    email: "alice@example.com",
    age: 25,
    tags: ["developer"],
    avatar: someFile, // Optional blob
  },
  userSchema, // Custom schema override
);
```

## API Reference

### 1. `frmz(initialData)`

Creates a form manager with inferred schema.

**Parameters:**

- `initialData`: Object or array to use as initial state

**Returns:**

- `data`: Reactive proxy of the initial data
- `getFormData()`: FormData: Function that returns current state as FormData

### 2. `frmz(initialData, schema)`

Creates a form manager with custom Zod schema.

**Parameters:**

- `initialData`: Data matching the provided schema
- `schema`: Zod schema for validation

**Returns:**

- `data`: Reactive proxy of validated data
- `getFormData()`: FormData: Function that returns current state as FormData

## Reactive Data Pattern

The `data` object is a deep proxy that tracks changes:

```ts
const { data, getFormData } = frmz({
  user: { name: "Alice", settings: { darkMode: true } },
});

// All changes are tracked
data.user.name = "Bob"; // Simple property
data.user.settings.darkMode = false; // Nested property
data.user.settings.fontSize = 16; // New properties

// getFormData() captures all current changes
const formData = getFormData(); // Contains latest state
```

### FormData Output Format

The generated FormData uses standard encoding:

**Object properties:**

```text
user[name]=Alice
user[email]=alice@example.com
```

**Array elements:**

```text
tags[0]=tech
tags[1]=programming
```

**File uploads:**

```text
tags[0]=tech
tags[1]=programming
```

## Type Utilities
`DeepWritable<T>`
Utility type to make deeply nested readonly types writable:

```typescript
import type { DeepWritable } from "frmz";

type User = DeepWritable<typeof userSchema>;
// Now all properties are mutable
```

## Error Handling

The library throws Zod validation errors when provided data doesn't match the schema:

```typescript
try {
  const manager = frmz(
    { email: "invalid-email" },
    z.object({ email: z.string().email() }),
  );
} catch (error) {
  console.error("Validation failed:", error.errors);
}
```

## Common Use Cases

1. Form State Management

   ```ts
   const { data, getFormData } = frmz(initialFormState);

   // Bind to input events
   input.addEventListener("change", (e) => {
     data.user.name = e.target.value;
   });

   // Submit handler
   form.addEventListener("submit", async (e) => {
     e.preventDefault();
     await fetch("/submit", { body: getFormData() });
   });
   ```

2. File Upload Forms

   ```ts
   const { data, getFormData } = frmz({
     title: "",
     description: "",
     attachments: [], // Will hold files
   });

   // Add files to array
   fileInput.addEventListener("change", (e) => {
     data.attachments.push(...e.target.files);
   });
   ```

3. Configuration Objects
   ```ts
   const { data, getFormData } = frmz({
     settings: {
       theme: "dark",
       notifications: true,
       layout: { grid: true, spacing: 2 },
     },
   });
   ```

## Limitations

- Root Types: Only objects and arrays are supported as root values

- FormData Encoding: Uses standard multipart/form-data encoding (not JSON)

- Circular References: Not supported in the data structure

- Server Processing: Requires server-side support for bracket notation (e.g.,`user[name]`)

##  Browser Support

Works in all modern browsers that support:

- Proxy API (ES2015)

- FormData API

- Blob/File API

##  Contributing

Found an issue? Want to add a feature? Please open an issue or PR on our GitHub repository.

##  License

MIT License - feel free to use in your projects!
