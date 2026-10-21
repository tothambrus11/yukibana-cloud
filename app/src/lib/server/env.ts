/** The Worker's configuration, read once per request and checked.
 *
 *  The Worker's env is whatever wrangler.jsonc, `wrangler secret` and .dev.vars
 *  put there, untyped. This is the one place that looks at it. A value that
 *  is missing fails here with its name, so "GITHUB_WEBHOOK_SECRET is not set"
 *  is the error, not a signature that never verifies.
 */

export interface S3Config {
  /** Where the Worker talks to the bucket. */
  readonly endpoint: string;
  /** Where a browser talks to it, for presigned URLs. The same as `endpoint`
   *  in production; in a devcontainer the two are different machines. */
  readonly publicEndpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface Config {
  readonly databaseUrl: string;
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
  /** The id of the registry's client on Supabase Auth's OAuth 2.1 server,
   *  through which a terminal or an IDE logs in by way of the website
   *  (`/auth/connect`, see #lib/connect). Not a secret: the client is
   *  public, and PKCE is what protects its codes. Null where none is
   *  registered: the CLI then falls back to logging in with GitHub
   *  directly, as before. */
  readonly oauthClientId: string | null;
  /** The site's canonical address, which must be Auth's `site_url`: the
   *  IDE login works only there (see #lib/connect), so `/auth/connect`
   *  moves to it and `/api/auth/config` tells the CLI. Null where the site
   *  is wherever it was asked (development). */
  readonly siteUrl: string | null;
  readonly s3: S3Config;
  /** The largest submission body the API accepts, whatever the project says. */
  readonly submissionMaxBytes: number;
  /** The largest archive a release may carry, each. Two of them must fit in
   *  one request under the platform's body limit. */
  readonly releaseMaxBytes: number;
}

function text(env: Record<string, unknown>, name: string): string {
  const v = env[name];
  if (typeof v !== 'string' || v === '') throw new Error(`${name} is not set`);
  return v;
}

/** An optional value: unset and empty are both null. */
function optional(env: Record<string, unknown>, name: string): string | null {
  const v = env[name];
  return typeof v === 'string' && v !== '' ? v : null;
}

/** The configuration in `env`, or an error naming the first missing value. */
export function configOf(env: Cloudflare.Env): Config {
  const databaseUrl = env.HYPERDRIVE?.connectionString ?? text(env, 'DATABASE_URL');
  return {
    databaseUrl,
    supabaseUrl: text(env, 'PUBLIC_SUPABASE_URL'),
    supabasePublishableKey: text(env, 'SUPABASE_PUBLISHABLE_KEY'),
    oauthClientId: optional(env, 'SUPABASE_OAUTH_CLIENT_ID'),
    siteUrl: optional(env, 'SITE_URL'),
    s3: {
      endpoint: text(env, 'S3_ENDPOINT'),
      publicEndpoint: typeof env['S3_PUBLIC_ENDPOINT'] === 'string' && env['S3_PUBLIC_ENDPOINT'] !== '' ? env['S3_PUBLIC_ENDPOINT'] : text(env, 'S3_ENDPOINT'),
      bucket: text(env, 'S3_BUCKET'),
      region: text(env, 'S3_REGION'),
      accessKeyId: text(env, 'S3_ACCESS_KEY_ID'),
      secretAccessKey: text(env, 'S3_SECRET_ACCESS_KEY'),
    },
    submissionMaxBytes: Number.parseInt(text(env, 'SUBMISSION_MAX_BYTES'), 10),
    releaseMaxBytes: Number.parseInt(text(env, 'RELEASE_MAX_BYTES'), 10),
  };
}
