# Cutmat

Two image tools that run in the browser. Images are processed on your device.

- **Batch tools** (`index.html`): resize, crop, convert, compress and watermark many images in one pass.
- **Design** (`design.html`): lay out posts, slides and flyers with text, shapes and your own images, then download PNG, JPG or PDF.

## Running it

There is no build step. Serve the folder with any static file server and open `index.html`:

```bash
python -m http.server 5173
```

## Accounts

The design editor keeps designs in the browser. Signing in also copies them to a Supabase project so they open on other computers.

- `cloud-config.js` holds the project URL and its publishable key. Empty values turn accounts off.
- `supabase/schema.sql` creates the table, storage bucket and access rules. Run it once in a new project.
