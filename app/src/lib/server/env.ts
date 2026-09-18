/** The Worker's configuration, read once per request and checked.
 *
 *  `platform.env` is whatever wrangler.jsonc, `wrangler secret` and .dev.vars
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

export interface GitHubConfig {
  readonly appId: string;
  readonly appSlug: string;
  /** PEM, as GitHub hands it out (PKCS#1) or converted (PKCS#8). */
  readonly privateKey: string;
  readonly webhookSecret: string;
}

export interface Config {
  readonly databaseUrl: string;
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
  readonly s3: S3Config;
  readonly github: GitHubConfig;
  /** The largest submission body the API accepts, whatever the project says. */
  readonly submissionMaxBytes: number;
}

function text(env: Record<string, unknown>, name: string): string {
  const v = env[name];
  if (typeof v !== 'string' || v === '') throw new Error(`${name} is not set`);
  return v;
}

/** The configuration in `env`, or an error naming the first missing value. */
export function configOf(env: Env): Config {
  const databaseUrl = env.HYPERDRIVE?.connectionString ?? text(env, 'DATABASE_URL');
  return {
    databaseUrl,
    supabaseUrl: text(env, 'PUBLIC_SUPABASE_URL'),
    supabasePublishableKey: text(env, 'SUPABASE_PUBLISHABLE_KEY'),
    s3: {
      endpoint: text(env, 'S3_ENDPOINT'),
      publicEndpoint: typeof env['S3_PUBLIC_ENDPOINT'] === 'string' && env['S3_PUBLIC_ENDPOINT'] !== '' ? env['S3_PUBLIC_ENDPOINT'] : text(env, 'S3_ENDPOINT'),
      bucket: text(env, 'S3_BUCKET'),
      region: text(env, 'S3_REGION'),
      accessKeyId: text(env, 'S3_ACCESS_KEY_ID'),
      secretAccessKey: text(env, 'S3_SECRET_ACCESS_KEY'),
    },
    github: {
      appId: text(env, 'GITHUB_APP_ID'),
      appSlug: text(env, 'GITHUB_APP_SLUG'),
      privateKey: text(env, 'GITHUB_APP_PRIVATE_KEY'),
      webhookSecret: text(env, 'GITHUB_WEBHOOK_SECRET'),
    },
    submissionMaxBytes: Number.parseInt(text(env, 'SUBMISSION_MAX_BYTES'), 10),
  };
}
