# CSRF Protection

Blenny-ts protects against cross-site request forgery using Hono's built-in
`csrf()` middleware, which validates the `Origin` and `Referer` headers on
every mutation request (POST, PUT, DELETE).

Zero configuration, zero boilerplate — protection is automatic for all routes.

## How it works

The middleware checks that incoming mutation requests originate from the same
origin that served the page. If a forged request comes from an external site,
its `Origin` header will be absent or mismatched, and Blenny returns `403
Forbidden`.

This is the OWASP-recommended approach for server-rendered applications where
all forms are served from the same origin.

## What's not needed

- No hidden `_csrf` fields in forms
- No `csrf` cookies
- No per-handler `csrfGuard()` calls
- No per-handler `csrfToken()` calls

Just write normal forms:

```tsx
function renderForm(c: Context): Response {
  return c.html(
    <form method="post" action="/my-route">
      <input type="text" name="message" />
      <button type="submit">Submit</button>
    </form>,
  );
}
```

## Configuration

The middleware is applied globally in `src/core/bootstrap/middlewares.ts`:

```ts
app.use("*", csrf());
```

To allow specific additional origins (e.g., for API clients), pass an options
object:

```ts
app.use("*", csrf({ origin: ["https://trusted-app.com"] }));
```

See the [Hono CSRF documentation](https://hono.dev/docs/middleware/builtin/csrf)
for full configuration options.

## Proxy environments

If your deployment uses a reverse proxy, ensure the `Origin` header is
preserved. Most modern proxies (nginx, Cloudflare, AWS ALB) forward this header
by default. No additional configuration is needed.
