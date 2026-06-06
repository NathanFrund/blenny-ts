# CSRF Protection

Blenny-ts provides double-submit cookie CSRF protection for form POST handlers.

## API

```ts
import { csrfGuard, csrfToken } from "../../core/csrf.ts";
```

### `csrfToken(c: Context): string`

Generates a new random token, sets it as the `csrf` cookie, and returns the
value. Call this in your GET handler and pass the token to your template so it
can be included as a hidden form field.

The token rotates on every call — each page load gets a fresh value. Both the
cookie and the hidden field are updated together, so multiple tabs each work
independently.

### `csrfGuard(c: Context, body: Record<string, unknown>): Response | null`

Compares the `csrf` cookie value against the `_csrf` field in the parsed form
body. Returns `null` on success, or a `403 Response` on failure.

## Usage

Every module with `<form method="post">` must follow this pattern:

```tsx
// GET handler — render the form with a CSRF token
function renderMyForm(c: Context): Response {
  return c.html(
    <form method="post" action="/my-route">
      <input type="hidden" name="_csrf" value={csrfToken(c)} />
      <input type="text" name="message" />
      <button type="submit">Submit</button>
    </form>,
  );
}

// POST handler — guard before processing
async function handleMyForm(c: Context): Promise<Response> {
  const body = await c.req.parseBody();
  const bad = csrfGuard(c, body);
  if (bad) return bad;

  // safe to process the form ...
  return c.redirect("/success");
}
```

## What it protects against

CSRF attacks where an external site tricks a logged-in user into submitting a
form on your domain. The attacker cannot read the `csrf` cookie (it is
`httpOnly`) and therefore cannot include a matching `_csrf` value in their
forged form.

## Notes

- The cookie is set with `SameSite=Lax` for defense in depth.
- `maxAge` is 1 hour; a new token is issued on every page load.
- Every `<form method="post">` **must** include a `_csrf` hidden field.
- Every POST handler **must** call `csrfGuard()` before processing the body.
