import type { Claims } from '#lib/claims.ts';
import type { Supabase } from '#lib/server/session.ts';

/** What every request carries.
 *
 *  `Cloudflare.Env` is the Worker's bindings and variables (from
 *  `cloudflare:workers`, read in src/lib/server/worker.ts), typed loosely
 *  here on purpose: src/lib/server/env.ts reads it once, checks every value,
 *  and hands the rest of the code a typed `Config`. A missing secret is
 *  reported by name there, not as `undefined` three calls later. */
declare global {
  namespace Cloudflare {
    interface Env {
      HYPERDRIVE?: { connectionString: string };
      [name: string]: unknown;
    }
  }
  namespace App {
    interface Locals {
      /** Supabase Auth, bound to this request's cookies. Used for the login
       *  flow only; data never goes through it. */
      supabase: Supabase;
      /** The verified identity, or null when nobody is logged in. */
      claims: Claims | null;
    }
    interface Error {
      message: string;
    }
  }
}

export {};
