# Registration reCAPTCHA v3 setup

Registration runs Google reCAPTCHA v3 when the user submits the form. It sends a
fresh token in Supabase signup metadata as `recaptcha_token`. The backend's
`POST /api/auth/before-user-created` endpoint verifies that token when Supabase
calls the **Before User Created** Auth hook. It checks the signature, Google's
result, the `signup` action, score, hostname, and token age before allowing the
account to be created. The token is single-use and expires after two minutes.

The hook must be enabled in Supabase for server enforcement. Deploying the
frontend alone does not protect direct calls to the Supabase signup API.

## 1. Create Google keys

Open the [Google reCAPTCHA admin console](https://www.google.com/recaptcha/admin/create).
Register a **reCAPTCHA v3** site (score based), with each hostname used by the
frontend. Add `localhost` for local development and your production hostname,
without `https://`, ports, or paths. Keep Google's domain validation enabled.
Use the v3 site key and its matching secret key; v2 keys do not work here.

## 2. Configure the frontend

Add the public site key to `frontend/.env.local` for development and to the
frontend host's build environment for production:

```dotenv
VITE_RECAPTCHA_SITE_KEY=your_public_v3_site_key
```

Restart Vite after changing local values. Rebuild/redeploy the frontend after
changing production values. This is the only reCAPTCHA key that belongs in a
`VITE_` variable.

## 3. Configure the backend and Supabase hook

1. Deploy the backend with the new hook endpoint to a public HTTPS URL reachable
   by Supabase. The hook needs a response within five seconds; keep this service
   available without slow cold starts.
2. In Supabase Dashboard, open **Authentication → Hooks → Before User Created**,
   choose the HTTP endpoint, and enter
   `https://YOUR_BACKEND/api/auth/before-user-created`.
3. Generate the hook signing secret and store it privately as `AUTH_HOOK_SECRET`
   in the backend environment, including its `v1,whsec_` prefix. This is a
   separate secret from Google's key.
4. Set these backend environment variables, then restart/redeploy the backend:

   ```dotenv
   AUTH_HOOK_SECRET=your_supabase_hook_signing_secret
   RECAPTCHA_SECRET_KEY=your_google_v3_secret_key
   RECAPTCHA_ALLOWED_HOSTNAMES=localhost,your-frontend.example
   RECAPTCHA_MIN_SCORE=0.5
   ```

   Hostnames must exactly match the frontend hosts registered with Google.
   Adjust the minimum score using observed legitimate signup traffic in Google's
   console. Keep both secrets out of source control and the frontend bundle.
5. Save and enable the hook in Supabase. Keep ordinary email signup enabled.
   Supabase's separate built-in CAPTCHA setting supports hCaptcha and Turnstile;
   it cannot verify Google tokens. This integration uses the Auth hook instead.

The backend reads its process environment. If using an ignored
`backend/.env.local` locally, Node 20.6+ can load it explicitly from the repository
root after `npm run build:backend`:

```sh
node --env-file=backend/.env.local backend/dist/server.js
```

For local signup tests, use `http://localhost:5173`, a Google key allowing
`localhost`, and a backend hook URL Supabase can reach over HTTPS. Supabase cannot
call a hook at your computer's private `localhost` address.

## 4. Verify activation

Submit registration in a real browser with a new test account. The old math
question is gone; v3 runs when **START JOURNEY** is submitted, with no checkbox
challenge. Confirm that a legitimate signup succeeds and that a direct signup
request without `options.data.recaptcha_token` is rejected. Use a fresh email
when checking rejection because this hook runs only before a new user is created.

Missing keys, blocked Google scripts, timeouts, and rejected verification should
show an error and leave the form available for another attempt. Each new attempt
gets a new token. Existing logins do not run this hook. New users created through
other flows also need a valid registration token; this implementation does not
exempt OAuth or anonymous signup. The consumed token remains in user metadata;
it is not a password or an authorization credential and cannot be reused.

References: [Google v3 integration](https://developers.google.com/recaptcha/docs/v3),
[Google server verification](https://developers.google.com/recaptcha/docs/verify),
[Supabase Before User Created hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook).
