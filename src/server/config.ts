import path from 'node:path';

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  /** Set cookies with the Secure flag. Enable whenever PlanB is served over HTTPS. */
  secureCookies: boolean;
  /** Trust X-Forwarded-* from a reverse proxy such as Caddy. */
  trustProxy: boolean;
  /** Public base URL, used in connection instructions (e.g. https://planb.example.com). */
  publicUrl: string;
  /** Serve the built web client from this folder (production). */
  staticDir: string | null;
  sessionDays: number;
  loginRateLimit: { max: number; windowMs: number };
}

const bool = (v: string | undefined, fallback: boolean) => (v === undefined || v === '' ? fallback : /^(1|true|yes)$/i.test(v));

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = process.env;
  const port = Number(env.PLANB_PORT ?? env.PORT ?? 8787);
  const production = env.NODE_ENV === 'production';
  return {
    host: env.PLANB_HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    port,
    dataDir: path.resolve(env.PLANB_DATA_DIR ?? './data'),
    secureCookies: bool(env.PLANB_SECURE_COOKIES, production),
    trustProxy: bool(env.PLANB_TRUST_PROXY, production),
    publicUrl: (env.PLANB_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    staticDir: env.PLANB_STATIC_DIR ?? (production ? path.resolve('dist/client') : null),
    sessionDays: Number(env.PLANB_SESSION_DAYS ?? 30),
    loginRateLimit: { max: Number(env.PLANB_LOGIN_MAX ?? 10), windowMs: 15 * 60 * 1000 },
    ...overrides,
  };
}
