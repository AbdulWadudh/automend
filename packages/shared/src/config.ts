/**
 * The single source of truth for every configured value in Automend.
 *
 * Nothing in the codebase hardcodes a port, timeout, limit, route path, queue name or default —
 * it is defined here once and imported as `config.<domain>.<value>`.
 *
 * The file has two halves, and the split is the whole point:
 *
 * 1. **Primitives** — the small set of values a human actually chooses. Each appears exactly once.
 * 2. **`config`** — everything else, *derived* from those primitives. A URL is never written out
 *    as a string literal; it is composed from a host and a port. Change `WEB_DEV_PORT` and the
 *    CORS origin list, the Vite dev server and the generated `.env.example` all follow.
 *
 * If you find yourself typing a port number or a host inside the `config` object below, it belongs
 * in the primitives block instead.
 *
 * Alongside this file, `env.ts` holds per-deployment overrides, Zod-validated at startup. Its
 * defaults come from here; it never hardcodes one.
 *
 * This module imports nothing, so anything — including the browser bundle — can import it.
 */

// ───────────────────────────── Primitives ─────────────────────────────
// The only place a port, host or path segment is written down.

const API_PORT = 3000;
const WORKER_HEALTH_PORT = 3002;
const WEB_PORT = 8080;
const WEB_DEV_PORT = 5173;

/** Fixed by the Drizzle Gateway image the database studio runs as; not ours to choose. */
const STUDIO_PORT = 4983;

/** Fixed by the official Postgres and Redis images; not ours to choose. */
const POSTGRES_CONTAINER_PORT = 5432;
const REDIS_CONTAINER_PORT = 6379;

const LOCAL_HOST = "localhost";

/**
 * Reported to the telemetry backend as `service.version`. Mirrors the root package.json version —
 * `tests/config.test.ts` fails if the two drift, since the browser bundle cannot read that file.
 */
const APP_VERSION = "0.1.0";

const API_PREFIX = "/api";
const API_VERSION = "v1";
const HEALTH_PATH = "/health";

/**
 * Better-Auth generates its own routes beneath this one segment (`/sign-in/email`,
 * `/callback/google`, `/get-session`, …), so the whole subtree belongs to it and nothing of ours
 * may be mounted inside it. It is versioned like every other API path.
 *
 * Treat it as an address of record rather than an internal route: it is what gets registered with
 * every OAuth provider as a redirect URI, so changing it obliges every deployment to re-register
 * with Google and anything added later.
 */
const AUTH_PATH = "/auth";

/**
 * Only the two page paths that other paths are *built from* are named here. The rest are written
 * once, inline, in `webClient.routes` — a constant with a single consumer is a second name for a
 * string, not a derivation, and this block is for values that would otherwise be repeated.
 *
 * `createFileRoute()` still takes a string literal either way: the router plugin derives the route
 * tree from file names and cannot resolve a value from here. Only *links* read these.
 */
const APP_ROUTE = "/app";
/** The router's placeholder syntax, so a link and the file-based route agree on the parameter. */
const FLOW_ID_PARAM = "flowId";
const RUN_ID_PARAM = "runId";

const PRODUCT_NAME = "Automend";
const PUBLIC_DOMAIN = "automend.k79.quest";
const REPOSITORY_URL = "https://github.com/AbdulWadudh/automend";

/** OTLP ingestion ports. Fixed by the OpenTelemetry spec, not ours to choose. */
const OTLP_HTTP_PORT = 4318;
const OTLP_GRPC_PORT = 4317;

/** Path the browser posts its log records to on the web app's own origin, then proxied on. */
const OTLP_PROXY_PREFIX = "/otlp";

/**
 * The operator consoles live under one prefix of their own, outside the versioned API.
 *
 * Not a corner of `/api/v1` because everything there answers with the `{ data }` / `{ error }`
 * envelope, and these serve HTML and their own static bundles. The web app proxies this prefix
 * onward unchanged — unchanged being the requirement, since a dashboard builds its asset URLs from
 * the path it was mounted at — so the consoles are reached on the one public origin and the API
 * still needs no domain of its own.
 */
const OPS_PREFIX = "/ops";
const OPS_QUEUES_PATH = "/queues";

/**
 * Local development credentials for the compose stack. Deliberately trivial and non-secret —
 * real deployments supply their own through the environment, and these never reach an image.
 */
const LOCAL_POSTGRES_USER = "automend";
const LOCAL_POSTGRES_PASSWORD = "automend";
const LOCAL_POSTGRES_DATABASE = "automend";

/**
 * The local database studio's admin password. Throwaway like the ones above — but unlike them it must
 * not be *blank*, and that is not a style preference.
 *
 * Drizzle Gateway's login handler is `if (!MASTERPASS) return { success: true }`. With no master
 * password it still renders a password box and accepts **anything typed into it**, which reads as a
 * console that is protected and is not. A real value here means the local studio behaves the way the
 * deployed one does, so the difference is never discovered in production.
 */
const LOCAL_STUDIO_PASSWORD = "automend-studio-local";

/** Compose service names — how one container addresses another on the local stack's network. */
const LOCAL_POSTGRES_SERVICE = "postgres";
const LOCAL_REDIS_SERVICE = "redis";
/** Named for what it is rather than what runs it, the same way `redis` is really Dragonfly. */
const STUDIO_SERVICE = "studio";

/**
 * Images for the local stack. Keep the Postgres major version in step with the deployed one —
 * developing against a different major is how a migration passes locally and fails in production.
 */
const LOCAL_POSTGRES_IMAGE = "postgres:18-alpine";
const LOCAL_REDIS_IMAGE = "docker.dragonflydb.io/dragonflydb/dragonfly:v1.40.1";

/**
 * The database studio is Drizzle Gateway — Drizzle Studio packaged to be self-hosted.
 *
 * A container rather than `drizzle-kit studio`, which serves its data to a *hosted* front-end at
 * local.drizzle.studio over a connection to 127.0.0.1: that is a laptop tool, and there is no
 * terminal on a deployed server to run it from. Pinned rather than `:latest`, like every other
 * image here, so a redeploy cannot quietly change what is reading the database.
 */
const STUDIO_IMAGE = "ghcr.io/drizzle-team/gateway:1.4.1";

/**
 * Where the Postgres data volume mounts.
 *
 * Postgres 18 moved `PGDATA` to `/var/lib/postgresql/<major>/docker` and now declares the *parent*
 * `/var/lib/postgresql` as its volume, so that is what must be mounted. Mounting the old
 * `/var/lib/postgresql/data` against an 18 image silently gets you a container whose data lives
 * outside the volume — it looks fine until the container is recreated and the database is empty.
 */
const LOCAL_POSTGRES_DATA_PATH = "/var/lib/postgresql";

/**
 * Where Drizzle Gateway keeps its own store — the connections you add and the sessions you sign in
 * with. Absolute rather than the `./app` the image's docs show, because the two only agree while
 * the container's working directory stays `/`.
 */
const STUDIO_STORE_PATH = "/app";

// ───────────────────────────── Derivations ─────────────────────────────

function httpUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}

function postgresUrl(options: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): string {
  const { host, port, user, password, database } = options;
  return `postgres://${user}:${password}@${host}:${port}/${database}`;
}

function redisUrl(host: string, port: number): string {
  return `redis://${host}:${port}`;
}

function emailAddress(mailbox: string, domain: string): string {
  return `${mailbox}@${domain}`;
}

const API_BASE_PATH = `${API_PREFIX}/${API_VERSION}` as const;
const AUTH_BASE_PATH = `${API_BASE_PATH}${AUTH_PATH}` as const;
const APP_FLOWS_ROUTE = `${APP_ROUTE}/flows` as const;
const APP_RUNS_ROUTE = `${APP_ROUTE}/runs` as const;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const MS_PER_SECOND = 1_000;

/**
 * Wall-clock caps on execution, and the only place they are chosen.
 *
 * A step cannot outlast the run it belongs to, and a `delay` step — which genuinely blocks, because
 * suspending and resuming a run does not exist yet — cannot outlast its step. Everything downstream
 * is derived from these two so the three can never contradict each other.
 */
const ENGINE_STEP_TIMEOUT_MS = 5 * SECONDS_PER_MINUTE * MS_PER_SECOND;
const ENGINE_RUN_TIMEOUT_MS = 15 * SECONDS_PER_MINUTE * MS_PER_SECOND;
/** Room for a delay step's own overhead, so the wait ends before the timeout fires rather than with it. */
const DELAY_TIMEOUT_HEADROOM_MS = 10 * MS_PER_SECOND;

/**
 * How a flow can be started, named once.
 *
 * `config.kits.triggerStrategies` and `config.runs.sources` are the same list seen from two ends — a run's
 * source *is* the strategy of the trigger that produced it — so writing it twice would let them drift into
 * a run whose source no trigger could have caused.
 */
const TRIGGER_STRATEGIES = ["manual", "webhook", "polling", "cron"] as const;

export const config = {
  appVersion: APP_VERSION,

  /**
   * Identity values only. Headlines, feature copy and the body of the legal documents stay in the
   * components that render them — this is the handful of values that would otherwise be repeated
   * across the header, the footer and both legal pages.
   */
  company: {
    productName: PRODUCT_NAME,
    /** The entity the terms are entered into with. Same as the product name until incorporated. */
    legalEntityName: PRODUCT_NAME,
    domain: PUBLIC_DOMAIN,
    repositoryUrl: REPOSITORY_URL,
    emails: {
      support: emailAddress("support", PUBLIC_DOMAIN),
      privacy: emailAddress("privacy", PUBLIC_DOMAIN),
      security: emailAddress("security", PUBLIC_DOMAIN),
    },
    legal: {
      /** Bump in the same change that edits either document — both pages read it from here. */
      effectiveDate: "2026-08-15",
      /** Placeholder: the real jurisdiction the entity is registered in must replace this. */
      governingLaw: "England and Wales",
    },
  },

  /** Service identities and their network defaults. Names appear in logs and health reports. */
  services: {
    api: {
      name: "api",
      defaultPort: API_PORT,
    },
    worker: {
      name: "worker",
      defaultHealthPort: WORKER_HEALTH_PORT,
      defaultConcurrency: 5,
      minConcurrency: 1,
      maxConcurrency: 100,
    },
    web: {
      name: "web",
      defaultPort: WEB_PORT,
      devServerPort: WEB_DEV_PORT,
      /** Where `bun run dev:web` sends `/api` when the API runs on the host. */
      defaultApiProxyTarget: httpUrl(LOCAL_HOST, API_PORT),
      staticRoot: "./dist",
      indexFile: "index.html",
      rootElementId: "root",
    },
    migrations: {
      name: "migrate",
      /** Resolved relative to `packages/db/src/`, where the migration runner lives. */
      folder: "../migrations",
    },
  },

  /** Shapes and bounds the environment loader validates against. */
  env: {
    nodeEnvs: ["development", "test", "production"],
    defaultNodeEnv: "development",
    logLevels: ["fatal", "error", "warn", "info", "debug", "trace"],
    defaultLogLevel: "info",
    port: {
      min: 1,
      max: 65_535,
    },
    /**
     * Connection strings are checked by scheme, so a URL pointing at the wrong kind of service
     * fails at startup rather than at first connect.
     */
    urlSchemes: {
      database: ["postgres", "postgresql"],
      redis: ["redis", "rediss"],
      api: ["http", "https"],
    },
    originListSeparator: ",",
  },

  http: {
    apiVersion: API_VERSION,
    basePath: API_BASE_PATH,
    routes: {
      /** Probed by the container platform. */
      health: HEALTH_PATH,
      /** The same report, reachable by the browser through the web app's proxy. */
      apiHealth: `${API_BASE_PATH}${HEALTH_PATH}`,
      flows: `${API_BASE_PATH}/flows`,
      /** Runs across every flow. A sibling of `flows` because the dashboard does not read one flow. */
      runs: `${API_BASE_PATH}/runs`,
      connections: `${API_BASE_PATH}/connections`,
      /**
       * The kit catalogue the builder renders from.
       *
       * Served over HTTP rather than imported, because a kit's code calls third-party APIs and has no business
       * in a browser bundle. The builder needs kit *metadata* — what fields a step has, what a trigger's sample
       * payload looks like — and this is how it gets it without the implementations coming too.
       */
      kits: `${API_BASE_PATH}/kits`,
      /**
       * Inbound webhooks. The only unauthenticated route in the versioned API: the caller is a
       * third-party service that has no session and never will. What stands in for authentication
       * is the flow's own id in the URL — 122 bits of randomness, and the reason the address must
       * be treated as a credential.
       */
      hooks: `${API_BASE_PATH}/hooks`,
      /** Better-Auth mounts every one of its own endpoints beneath this single base. */
      auth: AUTH_BASE_PATH,
      authPattern: `${AUTH_BASE_PATH}/*`,
      /**
       * Ours, not Better-Auth's: what the sign-in page needs to know *before* anyone signs in.
       * Which providers a deployment configured is a runtime fact, so it cannot be a build flag.
       *
       * A sibling of `auth`, not a child. Everything under `auth/` is generated by Better-Auth and
       * a plugin may add a path there at any version — mounting our own route inside that subtree
       * would mean one of the two silently shadowing the other.
       */
      authProviders: `${API_BASE_PATH}/auth-providers`,
      apiProxyPrefix: API_PREFIX,
      apiProxyPattern: `${API_PREFIX}/*`,
      /** Browser telemetry is proxied through this app's origin, so the collector stays private. */
      otlpProxyPrefix: OTLP_PROXY_PREFIX,
      otlpProxyPattern: `${OTLP_PROXY_PREFIX}/*`,
      /**
       * The operator consoles, proxied through this app's origin like the two above — but
       * *verbatim*, with the prefix left on. A dashboard writes its own asset and API URLs relative
       * to the path it was mounted at, so rewriting the prefix away the way the OTLP proxy does
       * would serve the page and then 404 every script it asks for.
       */
      opsPrefix: OPS_PREFIX,
      opsProxyPattern: `${OPS_PREFIX}/*`,
      /** Bull Board, mounted by the api. Off unless the deployment sets credentials for it. */
      queueDashboard: `${OPS_PREFIX}${OPS_QUEUES_PATH}`,
      /**
       * The JSON API *about* the consoles — which ones this deployment has, and the endpoint that
       * exchanges the operator password for a session. Versioned like every other API route, and
       * deliberately not under `opsPrefix`: that prefix is the consoles themselves, and mixing an
       * envelope-returning API into it would make the web app's verbatim proxy rule ambiguous.
       */
      operations: `${API_BASE_PATH}/operations`,
      /** Sub-paths within `operations`, so the route file and the browser client cannot disagree. */
      operationsConsoles: "/consoles",
      operationsSession: "/session",
      wildcard: "*",
      matchAll: "/*",
    },
    proxy: {
      /**
       * Headers that must not be forwarded to an upstream.
       *
       * `host` is the important one: it still names *this* origin, and any upstream behind a
       * CDN or reverse proxy that routes by Host will reject the request outright. The rest are
       * hop-by-hop headers (RFC 9110 §7.6.1) that describe the inbound connection, not the
       * request, plus `content-length`, which fetch recomputes for the forwarded body.
       */
      strippedRequestHeaders: [
        "host",
        "connection",
        "keep-alive",
        "transfer-encoding",
        "upgrade",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "content-length",
      ],
    },
    cors: {
      allowedMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowCredentials: true,
      /**
       * Both local front-end origins: the Vite dev server and the web container. Derived from the
       * port primitives, so changing a port cannot leave a stale origin behind here.
       */
      defaultOrigins: [httpUrl(LOCAL_HOST, WEB_DEV_PORT), httpUrl(LOCAL_HOST, WEB_PORT)],
    },
  },

  /**
   * Authentication and workspace membership.
   *
   * Better-Auth is the implementation; everything here is named for what it does, so the values
   * still read correctly if the library is ever swapped.
   */
  auth: {
    /** Every Better-Auth endpoint hangs off this base — the browser calls it on its own origin. */
    basePath: AUTH_BASE_PATH,
    /**
     * Signs session cookies and encrypts stored OAuth tokens. Rejected below this length so a
     * deployment cannot ship a guessable one; `openssl rand -base64 32` produces a good value.
     */
    secretMinLength: 32,
    session: {
      expiresInSeconds: 30 * SECONDS_PER_DAY,
      /** How often an active session's expiry is pushed forward, so it does not write on every hit. */
      updateAgeSeconds: SECONDS_PER_DAY,
      /**
       * A signed copy of the session rides in a cookie for this long, so the common "who am I"
       * check costs no database round trip. Kept short: it is how long a revoked session can
       * still read as valid.
       */
      cookieCacheSeconds: 5 * SECONDS_PER_MINUTE,
    },
    /**
     * A workspace is the tenant. Every user gets one on sign-up, because a flow cannot be stored
     * without a tenant to scope it to — see `organization.personalWorkspaceName`.
     */
    organization: {
      /** Named after the person, since a first workspace is theirs alone until they invite someone. */
      personalWorkspaceSuffix: "'s workspace",
      /** Fallback when an OAuth profile carries no name at all. */
      fallbackWorkspaceName: "My workspace",
      creatorRole: "owner",
      /** Appended to a slug when the derived one is already taken. */
      slugSeparator: "-",
      slugRandomSuffixLength: 6,
    },
    /** The OAuth providers a deployment may enable. Each is on only if its credentials are set. */
    socialProviders: {
      google: {
        id: "google",
        label: "Google",
      },
    },
  },

  /**
   * Secrets held at rest — connector API tokens today, anything else a flow must keep tomorrow.
   *
   * The scheme is envelope encryption: a single-use data key per secret, itself encrypted with the
   * master key from the environment. See `crypto.ts` for why that beats encrypting each secret
   * with the master key directly.
   */
  secrets: {
    /** Authenticated encryption, so an edited ciphertext fails instead of decrypting to garbage. */
    algorithm: "aes-256-gcm",
    keyLengthBytes: 32,
    /** 96 bits, the size GCM is defined for; a different length weakens it. */
    ivLengthBytes: 12,
    envelopeVersion: 1,
    /** How much of a stored token is shown back, so it can be recognised but not reconstructed. */
    hintLength: 4,
    hintMaskLength: 4,
  },

  /**
   * Third-party services a workspace can connect, for flows to act through.
   *
   * A connector is not a sign-in method: connecting Slack asks for permission to *do* things,
   * with scopes far broader than a login. The two are kept apart deliberately — see the auth
   * package — and a provider only appears here once its credentials are configured.
   */
  connectors: {
    /**
     * OAuth connections are held by Better-Auth under these provider ids, which are suffixed so
     * they can never collide with a sign-in provider of the same name. Connecting Google for
     * automation must not silently widen the scopes of signing in with Google.
     */
    connectionProviderSuffix: "-connector",
    /**
     * Every OAuth connector must name a `userInfoUrl` and request scopes that identify the
     * account, on top of whatever it needs to do its job. That is not optional: the callback
     * resolves an email, an id and a name before it will store anything, and a connector without
     * them fails at the redirect with `user_info_is_missing`.
     */
    providers: [
      {
        id: "slack",
        label: "Slack",
        kind: "oauth",
        summary: "Post messages to a Slack workspace.",
        /**
         * Bot scopes, sent as `scope`. A step acts as the app rather than as whoever installed it,
         * so the token a kit is handed is the bot token — which is what makes a flow keep working
         * after the person who authorised it leaves the workspace.
         *
         * `chat:write.public` is what lets the app post to a public channel it was never invited
         * to; without it every target channel needs a manual `/invite` first.
         *
         * Nothing broader, even though widening later forces every workspace to re-authorise: a
         * scope no action uses is one nobody can point at a step to justify.
         */
        scopes: ["chat:write", "chat:write.public"],
        /**
         * User scopes, sent as `user_scope` and used for nothing but identity.
         *
         * The v2 install response carries no email, and the callback refuses a connection without
         * one. These buy a *user* token that `openid.connect.userInfo` will answer for; it is read
         * once during the callback and never stored — see `packages/auth/src/slack.ts`.
         */
        userScopes: ["openid", "email", "profile"],
        authorizationUrl: "https://slack.com/oauth/v2/authorize",
        tokenUrl: "https://slack.com/api/oauth.v2.access",
        userInfoUrl: "https://slack.com/api/openid.connect.userInfo",
        /**
         * Required, not defensive: the app is opted into PKCE in Slack's own settings, and once it
         * is, Slack rejects an authorization request that carries no `code_challenge`.
         */
        pkce: true,
      },
      {
        id: "google",
        label: "Google",
        kind: "oauth",
        summary: "Send mail from a Google account.",
        /** The identity scopes come first because they are what makes the connection storable. */
        scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.send"],
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        userInfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
        /**
         * `select_account` because a workspace connects *accounts*, not people: whoever is already
         * signed in to Google is rarely the mailbox being connected, and without this Google skips
         * the chooser entirely and silently reuses that session.
         *
         * `consent` is not redundant with it. Google issues a refresh token only on the first
         * authorisation unless consent is re-requested, and without a refresh token the connection
         * stops working an hour later with no way to renew it.
         */
        prompt: "select_account consent",
        /** Required for a refresh token at all — `prompt` alone does not produce one. */
        accessType: "offline",
      },
      {
        id: "discord",
        label: "Discord",
        kind: "oauth",
        summary: "Read the servers an account belongs to.",
        /** `email` is required, not decorative: the callback refuses a connection without one. */
        scopes: ["identify", "email", "guilds"],
        authorizationUrl: "https://discord.com/oauth2/authorize",
        tokenUrl: "https://discord.com/api/oauth2/token",
        userInfoUrl: "https://discord.com/api/users/@me",
        /**
         * Discord re-authorises an already-approved app without showing anything, which leaves no
         * opportunity to switch account. It has no `select_account`; forcing the consent screen is
         * as far as it goes — switching account itself is done in Discord.
         */
        prompt: "consent",
      },
      {
        id: "api-token",
        label: "API token",
        kind: "token",
        summary: "Any service that authenticates with a bearer token or key.",
        scopes: [],
      },
    ],
  },

  /**
   * The flow definition — the document the builder edits and the engine will later execute.
   *
   * `definitionVersion` is stored with every flow so a future shape change can migrate old rows
   * instead of failing to parse them.
   */
  flows: {
    /**
     * 2 since kits.
     *
     * A v1 step named one of four hardcoded kinds (`http-request`, `send-email`, `delay`, `log`) and carried
     * fields specific to each. A v2 step names a kit and an action and carries an opaque `input`, so the set
     * of things a step can do is the registry rather than a union in this file. `upgradeFlowDefinition` in
     * `@automend/kits` migrates stored v1 rows on read.
     */
    definitionVersion: 2,
    maxSteps: 50,
    /** What a new flow starts with: a trigger somebody can press. */
    defaultTrigger: {
      kitId: "core",
      triggerName: "manual",
      name: "When triggered manually",
    },
    httpMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    defaultHttpMethod: "GET",

    /** The flow picker, which asks the API as somebody types rather than filtering a list it holds. */
    picker: {
      resultLimit: 20,
      maxResultLimit: 100,
      /** Long enough that a fast typist sends one request rather than one per keystroke. */
      debounceMs: 200,
      maxQueryLength: 100,
    },
    delay: {
      defaultMs: MS_PER_SECOND,
      minMs: 0,
      /**
       * Derived from the step timeout rather than chosen, because a delay genuinely blocks its step —
       * suspending a run and resuming it later does not exist yet, so a wait occupies a worker slot
       * for its whole duration and the engine would kill anything longer mid-wait.
       *
       * That makes this a short wait for letting an upstream settle or pacing a rate limit, not a
       * scheduling tool. Anything longer belongs in a schedule trigger.
       */
      maxMs: ENGINE_STEP_TIMEOUT_MS - DELAY_TIMEOUT_HEADROOM_MS,
    },
    /** Inbound webhook deliveries — what a `webhook` trigger actually receives. */
    webhook: {
      /**
       * Every method, because a webhook endpoint does not get to choose what a third party sends.
       * The flow decides what to do with it; the endpoint's job is to accept it.
       */
      acceptsAllMethods: true,
      /**
       * Bodies above this are rejected with 413 rather than stored. A webhook receiver is an
       * unauthenticated write endpoint, so the size of what it will keep has to be bounded.
       */
      maxBodyBytes: 1_000_000,
      /**
       * Read from the request when present, so a sender that retries does not run the flow twice.
       * Generated when absent — a delivery is still recorded, it just cannot be de-duplicated.
       */
      idempotencyHeader: "idempotency-key",
      /**
       * Never stored. A webhook's own authentication arrives in these, and a delivery log is not
       * a place to keep other people's credentials.
       */
      redactedHeaders: ["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key"],
      /** How many the builder lists. Enough to find the one you just sent, not a log viewer. */
      recentDeliveries: 20,
    },

    /**
     * `{{variable}}` substitution in step fields.
     *
     * Substitution, emphatically not evaluation. A template may name a value from the data the
     * flow received; it may not call anything, index arbitrarily or compute. That is the platform's
     * first rule — user-authored code never runs in a server process — applied to the place where
     * it would be most tempting to add "just a small expression language".
     */
    templates: {
      openDelimiter: "{{",
      closeDelimiter: "}}",
      /**
       * The two roots a `{{variable}}` path may start from — the keys of the engine's resolution context.
       *
       * Shared rather than written down in each place because the builder *writes* these paths and the
       * engine *resolves* them, and the two silently disagreeing is not a hypothetical: the picker once
       * offered paths taken straight from a webhook body, so `{{email}}` resolved to nothing and the
       * literal travelled on to Gmail, which reported it as `Invalid To header`.
       *
       * `tests/config.test.ts` and `apps/worker/tests/engine/resolve-input.test.ts` between them pin these
       * to the context the engine actually builds.
       */
      triggerVariablePrefix: "trigger",
      stepsVariablePrefix: "steps",
      /**
       * Where a path that names *no* root is looked for, in order.
       *
       * `{{email}}` is what somebody writes when the webhook they just sent had an `email` field, and
       * insisting on `{{trigger.body.email}}` for it is a rule the data gives no hint of. So a rootless path
       * is tried against the trigger's body first — the overwhelmingly common intent — and then against the
       * trigger's own envelope, which is what makes `{{method}}` work too.
       *
       * A path that *does* begin with a root above is never rewritten. Explicit always wins, so a template
       * can always reach exactly one thing and the picker's own output is never ambiguous.
       */
      rootlessVariableFallbacks: ["trigger.body", "trigger"],
      /** How deep into a received payload the variable picker will look for values to offer. */
      maxSampleDepth: 6,
      /** A cap on what the picker lists, so a large payload cannot produce an unusable menu. */
      maxSampleVariables: 200,
      /** Longer values are elided in the picker; the whole value is still what gets substituted. */
      previewLength: 60,
    },

    /** Where the builder drops nodes, and how far apart it stacks them. */
    canvas: {
      triggerPosition: { x: 0, y: 0 },
      stepSpacing: { x: 0, y: 140 },
      /** Nudges a new node aside when the slot below the last one is already occupied. */
      collisionOffset: { x: 260, y: 0 },
      /**
       * The builder's draggable split. Strings because `react-resizable-panels` v4 reads a bare number
       * as *pixels* and a unitless string as a percentage — a number here would be a 62px canvas.
       */
      layout: {
        /** Uniquely names the saved layout, so the width somebody drags survives a reload. */
        storageId: "automend.builder-layout",
        canvasPercent: "62",
        inspectorPercent: "38",
        minCanvasPercent: "30",
        minPanelPercent: "18",
      },
      minZoom: 0.25,
      maxZoom: 2,
      fitViewPadding: 0.25,
      /**
       * How far `fitView` may zoom *in*, which is what decides the opening view.
       *
       * Without a ceiling a two-node flow fills the canvas, so the first thing you do on opening one is
       * zoom out to see where there is room to build. Below 1 the graph opens with space around it.
       */
      fitViewMaxZoom: 1.2,
    },
  },

  /**
   * Kits — one per third-party service, each bundling the actions a flow can take and the triggers
   * that can start one. A kit is the unit of "add a service", so everything here describes the
   * vocabulary a kit author writes against rather than any one service.
   *
   * A kit names the *connector* it needs (`config.connectors.providers`); a workspace's authorised
   * instance of that connector is a connection. The kit never holds a credential itself.
   */
  kits: {
    /**
     * The input types a kit may declare. Each one needs a branch in the framework's schema builder
     * and a control in the builder's inspector, so the list is short on purpose — a kit that wants
     * a richer field composes these rather than adding a seventh.
     */
    propertyTypes: ["shortText", "longText", "number", "checkbox", "staticDropdown", "json"],
    /** How a trigger learns that something happened. */
    triggerStrategies: TRIGGER_STRATEGIES,
    /**
     * The strategies this deployment can actually fire. `polling` and `cron` are absent until the
     * scheduler exists: the catalogue reports the rest unavailable so the builder can refuse them
     * with a reason, rather than accepting a flow that would silently never run.
     */
    schedulableTriggerStrategies: ["manual", "webhook"],
    /**
     * How a polling trigger recognises what it has already seen. `timestamp` suits a service that
     * dates its records; `lastItem` suits one that only guarantees an order.
     */
    dedupeStrategies: ["timestamp", "lastItem"],
    /** A single poll cannot hand the engine an unbounded backlog. */
    maxPollItems: 100,
    /** What a trigger returns when the builder tests it — enough to populate the variable picker. */
    testPollItems: 5,
    /**
     * The shape of a kit id and of an action or trigger name: camelCase.
     *
     * Here rather than beside the code that enforces it, because two packages need the same rule —
     * `kit-framework` checks it when a kit is declared, and `flow-definition` checks it on a step read back
     * out of the database. A second copy is how a stored flow comes to name something no kit could be.
     */
    namePattern: "^[a-z][a-zA-Z0-9]*$",

    /**
     * What the engine does with a rate limit a kit declares.
     *
     * The bucket lives in Redis and is keyed by *connection*, not by kit: a service's quota belongs to the
     * account being acted as, so two Google connections in one workspace must not throttle each other, and
     * two workspaces must not throttle each other at all.
     */
    limits: {
      /** Half a step's own budget, so waiting for a token can never use up the time meant for the work. */
      waitBudgetMs: Math.floor(ENGINE_STEP_TIMEOUT_MS / 2),
      /**
       * A wait longer than this re-checks rather than sleeping it out: the bucket refills predictably, but
       * another worker may take the token first, so the computed wait is a floor rather than a promise.
       */
      recheckIntervalCapMs: 1_000,
      /**
       * Redis key prefix. The hashtag goes around the *bucket's* identity rather than the prefix, so
       * Dragonfly locks one bucket at a time instead of putting every limiter on one thread — the opposite
       * of what queue names need, and for the same reason.
       */
      keyPrefix: "kit-limit",
      /** An idle bucket is kept for this many refill periods before Redis reclaims it. */
      bucketTtlPeriods: 2,
    },
    /**
     * How much text a step's field may hold, by shape of field.
     *
     * These are defaults a property can raise or lower, and they exist so that *unbounded* is never
     * what a kit author gets by forgetting. A flow definition is one `jsonb` document written whole,
     * so a single unbounded field is a way to make a row nobody can load.
     *
     * They bound what an author can type, not what a variable resolves to — a short template may
     * legitimately substitute a large value, and truncating that would corrupt the data rather than
     * protect anything.
     */
    textMaxLength: {
      /** A line: a recipient, a URL, a subject. */
      short: 2_000,
      /** A body, a note, a JSON document. */
      long: 50_000,
    },
  },

  /**
   * The execution engine — a subprocess per run, spawned by the worker.
   *
   * The limits here are the ones the platform can actually enforce. Bun's spawn options provide a
   * wall-clock timeout, an output cap and a kill signal, and nothing for memory, CPU, filesystem or
   * network; a memory ceiling is a container concern and is documented as such rather than pretended
   * to here.
   */
  engine: {
    /** One step. Also what bounds a `delay`, which is why `flows.delay.maxMs` is derived from it. */
    stepTimeoutMs: ENGINE_STEP_TIMEOUT_MS,
    /** The whole run, however many steps it has. Enforced by the parent, which kills the subprocess. */
    runTimeoutMs: ENGINE_RUN_TIMEOUT_MS,
    /**
     * What the subprocess may write to stdout and stderr before it is killed.
     *
     * A kit logging in a loop must not be able to exhaust the worker's memory through the pipe it
     * reports on.
     */
    maxOutputBytes: 8 * 1_024 * 1_024,
    /** How long the parent waits for a killed subprocess to exit before giving up on it. */
    shutdownGraceMs: 5 * MS_PER_SECOND,

    /** The guarded HTTP client every kit reaches the network through. */
    http: {
      requestTimeoutMs: 30 * MS_PER_SECOND,
      /**
       * Redirects are followed by us rather than by `fetch`, so each hop can be re-checked against the
       * address rules below — a permitted URL redirecting to `169.254.169.254` is the whole SSRF
       * problem in one request.
       */
      maxRedirects: 3,
      /** Bytes of response body read before the request is abandoned. */
      maxResponseBytes: 5 * 1_024 * 1_024,
      /**
       * Hostnames and address ranges a flow may never reach: loopback, link-local (which is where
       * every cloud provider's credential endpoint lives) and the private ranges, since a self-hosted
       * deployment's own database and Redis sit on them.
       *
       * The default is the safe one. A deployment that genuinely automates against a service on its
       * own network needs an override, which arrives with the guard that reads this.
       *
       * `blockedHostnames` holds names that are refused *whatever* that override says, so it is deliberately
       * short: a cloud metadata endpoint has no legitimate use from a flow. `localhost` is absent on purpose —
       * loopback is what the override is mostly *for*, and listing it here would have made the setting inert.
       */
      blockedHostnames: ["metadata.google.internal", "metadata.goog"],
      allowPrivateNetworkByDefault: false,
    },
  },

  /**
   * Flow runs — one execution of a flow, and the journal of what each of its steps did.
   *
   * The status vocabulary is closed and the legal transitions between them live in `runs.ts`, because a
   * run that goes from `succeeded` back to `running` is a bug the type system cannot catch on its own.
   */
  runs: {
    statuses: ["pending", "running", "succeeded", "failed", "timedOut", "cancelled"],
    /** A run exists before the worker picks it up: it is created in the same transaction as its outbox row. */
    initialStatus: "pending",
    /** Once a run reaches one of these it never changes again, which is what makes a retry safe to replay. */
    terminalStatuses: ["succeeded", "failed", "timedOut", "cancelled"],

    /**
     * A step's own outcome. `skipped` is not a failure — it is a step the walk never reached, because a
     * step before it failed and the author did not ask to continue.
     */
    stepStatuses: ["pending", "running", "succeeded", "failed", "skipped"],
    terminalStepStatuses: ["succeeded", "failed", "skipped"],

    /** What started a run. The same list as the trigger strategies, seen from the run's end. */
    sources: TRIGGER_STRATEGIES,

    /**
     * BullMQ's retry policy for a flow execution job.
     *
     * Retries are safe *because* of the step journal: a retried job replays the output of every step that
     * already succeeded rather than re-invoking it, so the third attempt at a flow does not send a third
     * email. Without that journal this would have to be 1.
     */
    retry: {
      attempts: 3,
      backoffMs: 5 * MS_PER_SECOND,
    },

    /** How many runs the builder lists for a flow. Enough to find the one you just started. */
    recentRuns: 50,

    /** The run dashboard. */
    dashboard: {
      pageSize: 25,
      maxPageSize: 100,
      /** Only polled while a run on screen is unfinished; terminal runs never change again. */
      liveRefetchIntervalMs: 3 * MS_PER_SECOND,
      defaultStatsWindowHours: 24,
      maxStatsWindowHours: 24 * 30,
      statsWindowChoices: [1, 24, 24 * 7, 24 * 30],
      /**
       * The feed and the open run beside it, as percentages. Strings for the same reason the builder's
       * are: a bare number is pixels to `react-resizable-panels` v4.
       */
      layout: {
        storageId: "automend.runs-layout",
        feedPercent: "58",
        detailPercent: "42",
        minFeedPercent: "32",
        minDetailPercent: "28",
      },
      /** A step may return a megabyte of JSON; pasting all of it into the DOM makes the page unusable. */
      payloadPreviewChars: 20_000,
    },
  },

  database: {
    /** Kept small: many API and worker replicas share one Postgres. */
    apiMaxConnections: 10,
    workerMaxConnections: 5,
    /** One connection, so concurrent deploys cannot race on the migrations table. */
    migrationMaxConnections: 1,
    /** Fail a health check quickly rather than letting a request hang on an unreachable DB. */
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 30_000,
  },

  redis: {
    /** Backoff with a ceiling, so a server restart does not produce a reconnect storm. */
    retryBackoffStepMs: 200,
    retryBackoffCeilingMs: 5_000,
    /** The API issues only short commands; a real outage should surface immediately. */
    apiMaxRetriesPerRequest: 1,
    /** Required by BullMQ: its blocking commands must not be aborted by a retry limit. */
    workerMaxRetriesPerRequest: null,
  },

  queue: {
    flowExecutions: {
      /**
       * The curly brackets are part of the queue name, not a template literal.
       *
       * Automend runs DragonflyDB as its Redis server, started with
       * `--cluster_mode=emulated --lock_on_hashtags`. That lets it lock at the {hashtag} level
       * instead of locking the whole store for BullMQ's Lua scripts. Every queue needs its own
       * hashtag, or all queues land on one thread and serialise behind each other.
       *
       * The braces are inert on stock Redis, so this name is correct on either server.
       */
      name: "{flow-executions}",
      jobName: "execute-flow",
      /**
       * How much finished work the queue keeps, which is the only thing the queue dashboard can show.
       *
       * Bounded by count rather than kept forever: Redis holds this, so unbounded history is a slow leak
       * of memory that nothing reclaims. A count also degrades sensibly — the newest are the ones anybody
       * is looking at.
       *
       * Failures are kept in greater number than successes on purpose. A completed job is history; a
       * failed one is work somebody may still want to read or re-run, and the whole point of keeping it is
       * that it outlives the noise of the successes around it.
       *
       * Which set a failure lands in is not obvious, and worth writing down because it misleads otherwise.
       * A failed run *does* fail its job: the processor rethrows once the journal is written. But BullMQ then
       * retries, and the retry finds the run already settled and returns without executing anything — so the
       * job ends up **completed**. The failed set therefore holds almost nothing: a run still mid-retry, or one
       * that died outside a step.
       *
       * The consequence is that the queue cannot be read as the record of what succeeded. `flow_runs` and
       * `flow_step_runs` are; the job's `returnValue` summary is what makes the queue's own view honest about it.
       */
      retention: {
        completedJobs: 250,
        failedJobs: 500,
      },
    },
  },

  /**
   * The relay that drains `flow_run_outbox` onto the queue.
   *
   * Its own domain rather than a member of `config.queue`, because everything in there is a queue and
   * `tests/config.test.ts` asserts as much — the outbox is what *feeds* a queue.
   *
   * An interval rather than a `LISTEN`: a row can be committed by any API replica, and polling one small
   * partial index every second is cheaper than every replica holding a listener connection open. The
   * latency it adds is bounded by the interval, and it applies to *starting* a run rather than to running
   * one.
   */
  outbox: {
    relayIntervalMs: MS_PER_SECOND,
    /** Rows per pass. Small, because a pass holds row locks for its whole duration. */
    batchSize: 50,
    /**
     * After this many failures a row stops being retried and is reported as stuck instead.
     *
     * Retrying forever would hide the one failure mode of this pattern that is invisible from outside: the
     * run exists, it looks queued, and nothing will ever execute it.
     */
    maxAttempts: 10,
    /** How long a published row is kept before pruning — long enough to answer "did that get queued?". */
    keepPublishedForMs: SECONDS_PER_DAY * MS_PER_SECOND,
  },

  health: {
    /**
     * An unreachable dependency must make `/health` answer "down" promptly, rather than hanging
     * until the orchestrator's own probe timeout fires.
     */
    probeTimeoutMs: 3_000,
  },

  /**
   * The two operator consoles: a queue dashboard the api serves, and a database studio that runs as
   * its own container.
   *
   * Neither is a product surface, and the reason is the same for both: they see *across* tenants.
   * The queue holds every workspace's job payloads and the studio holds every workspace's rows, so
   * putting either behind the ordinary session would hand any signed-in user everybody else's data.
   * They are gated on a credential of their own instead, and each is **off** until one is set —
   * absent credentials means the surface does not exist rather than that it stands open.
   */
  ops: {
    queueDashboard: {
      /** Shown in the dashboard's own header, so it is obvious whose queues these are. */
      boardTitle: `${PRODUCT_NAME} queues`,
      /**
       * Long enough not to be worth guessing at, since this is the whole of what stands between the
       * internet and a console that can read every tenant's job payloads and enqueue new work.
       */
      passwordMinLength: 16,
      /**
       * How the browser carries the fact that the operator password was accepted.
       *
       * A cookie rather than HTTP Basic, because Basic is answered by the *browser's* own credential
       * dialog — an OS-chrome box on a themed product, which no CSS can reach and which cannot say
       * what is being asked for or what it grants. The password is presented on a real page instead,
       * and this is what the dashboard checks afterwards.
       */
      session: {
        cookieName: "automend_ops",
        /**
         * A working day, and shorter than a user session on purpose: this grants far more than
         * signing in does, so it should lapse over a weekend rather than persist for a month.
         */
        maxAgeSeconds: 8 * SECONDS_PER_HOUR,
      },
    },
    databaseStudio: {
      serviceName: STUDIO_SERVICE,
      image: STUDIO_IMAGE,
      containerPort: STUDIO_PORT,
      /**
       * Gateway keeps the connections you add and the session you signed in with here, so it has to
       * be a mounted volume — without one, every restart asks for the database credentials again.
       */
      storePath: STUDIO_STORE_PATH,
      /**
       * The local stack's password, so the studio on a laptop is gated the way the deployed one is.
       *
       * Never blank: Gateway treats an absent master password as "accept any password" rather than as
       * "no login", so a blank value produces a login box that lets everyone through. `tests/config.test.ts`
       * fails if this is ever emptied.
       */
      localPassword: LOCAL_STUDIO_PASSWORD,
    },
  },

  /**
   * OpenTelemetry log export. Automend ships logs to SigNoz, which is OTLP-native — the code
   * targets the OTLP protocol, not SigNoz specifically, so any OTLP backend works.
   */
  telemetry: {
    /** OTLP/HTTP rather than gRPC: it works unchanged from Node, Bun and the browser. */
    logsPath: "/v1/logs",
    otlpHttpPort: OTLP_HTTP_PORT,
    otlpGrpcPort: OTLP_GRPC_PORT,
    /**
     * Fallback only. Real deployments set OTEL_EXPORTER_OTLP_ENDPOINT to a remote collector, which
     * is why there is no host-vs-container split for it: a remote URL resolves the same from both.
     */
    defaultEndpoint: httpUrl(LOCAL_HOST, OTLP_HTTP_PORT),
    export: {
      /** Batch rather than per-record, so a log line never blocks a request. */
      maxQueueSize: 2_048,
      maxExportBatchSize: 512,
      scheduledDelayMs: 5_000,
    },
    /**
     * Log levels mapped onto OTel severity numbers, so SigNoz's severity filter works. Keyed by
     * label rather than by pino's numeric level, because the logger is configured to emit the
     * label — see `logging.emitLevelLabel`.
     * https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
     */
    logLevelToSeverityNumber: {
      trace: 1,
      debug: 5,
      info: 9,
      warn: 13,
      error: 17,
      fatal: 21,
    },
    /** Log-record fields that pino owns; everything else becomes an OTel attribute. */
    reservedLogFields: ["level", "time", "msg", "pid", "hostname", "name"],
    browser: {
      /** Instrumentation scope name reported to the backend for browser-emitted records. */
      scopeName: "automend-web-browser",
      /** Kept short so a user closing the tab loses at most this much telemetry. */
      scheduledDelayMs: 2_000,
      maxExportBatchSize: 64,
    },
  },

  logging: {
    redactionCensor: "[redacted]",
    /**
     * Values that must never reach a log line, even at trace level. Centralised so a new call
     * site cannot accidentally opt out of redaction.
     */
    redactedPaths: [
      "DATABASE_URL",
      "REDIS_URL",
      "password",
      "token",
      "secret",
      "apiKey",
      "*.password",
      "*.token",
      "*.secret",
      "*.apiKey",
      "*.accessToken",
      "*.refreshToken",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
  },

  validation: {
    /**
     * An upper bound on a *submitted* operator password, so a sign-in request cannot be used to hand
     * the api an arbitrarily large body to hash. The minimum lives in `ops.queueDashboard`, because
     * it constrains the deployment's configuration rather than the request.
     */
    opsPassword: {
      maxLength: 200,
    },
    flowName: {
      minLength: 1,
      maxLength: 200,
    },
    flowDescription: {
      maxLength: 1_000,
    },
    /** Names the builder shows on a node. Short, because they are drawn inside a fixed-width box. */
    flowNodeName: {
      minLength: 1,
      maxLength: 100,
    },
    stepUrl: {
      maxLength: 2_000,
    },
    logMessage: {
      maxLength: 1_000,
    },
    /** Comma-separated, and each entry may itself be a template, so this is generous. */
    emailRecipients: {
      minLength: 1,
      maxLength: 2_000,
    },
    emailSubject: {
      maxLength: 500,
    },
    emailBody: {
      maxLength: 50_000,
    },
    slackChannel: {
      maxLength: 200,
    },
    /** Slack truncates a message above 40,000 characters; there is no point accepting more. */
    slackMessage: {
      maxLength: 40_000,
    },
    /** `1735689600.000100` — but it may be a template, so this is generous rather than exact. */
    slackTimestamp: {
      maxLength: 200,
    },
    webhookPath: {
      minLength: 1,
      maxLength: 200,
    },
    cronExpression: {
      minLength: 1,
      maxLength: 100,
    },
    idempotencyKey: {
      minLength: 1,
      maxLength: 255,
    },
    /**
     * Longer than the eight characters Better-Auth allows by default: a self-hosted automation
     * platform holds the credentials to everything it automates.
     */
    password: {
      minLength: 12,
      maxLength: 128,
    },
    userName: {
      minLength: 1,
      maxLength: 100,
    },
    workspaceName: {
      minLength: 1,
      maxLength: 100,
    },
    connectionName: {
      minLength: 1,
      maxLength: 100,
    },
    /** Wide enough for a JWT, which is the longest thing anyone reasonably pastes in as a token. */
    connectionToken: {
      minLength: 1,
      maxLength: 4_000,
    },
  },

  /** Browser-side defaults. Safe to import from React code — this module has no dependencies. */
  webClient: {
    routes: {
      home: "/",
      status: "/status",
      privacy: "/privacy",
      terms: "/tos",
      signIn: "/sign-in",
      signUp: "/sign-up",
      app: APP_ROUTE,
      flows: APP_FLOWS_ROUTE,
      flowDetail: `${APP_FLOWS_ROUTE}/$${FLOW_ID_PARAM}`,
      runs: APP_RUNS_ROUTE,
      runDetail: `${APP_RUNS_ROUTE}/$${RUN_ID_PARAM}`,
      connections: `${APP_ROUTE}/connections`,
      profile: `${APP_ROUTE}/profile`,
      operations: `${APP_ROUTE}/operations`,
    },
    /** The parameter names in `flowDetail` and `runDetail`, so `useParams()` and the link cannot disagree. */
    flowIdParam: FLOW_ID_PARAM,
    runIdParam: RUN_ID_PARAM,
    /**
     * Where a guarded route sends an unauthenticated visitor, and the search parameter it uses to
     * remember where they were going.
     */
    redirectSearchParam: "redirect",
    /** Deep-linkable anchors on the landing page — the header, the footer and the sections agree. */
    landingSections: {
      howItWorks: "how-it-works",
      features: "features",
      selfHosting: "self-hosting",
      faq: "faq",
    },
    /**
     * Appearance. `system` follows the operating system and keeps following it, so a laptop that
     * switches at sunset switches the app with it.
     *
     * The class is what Tailwind's `dark` variant reads, and `index.html` applies the stored choice
     * before first paint — a theme applied from React arrives one frame late, which is a flash of the
     * wrong colours on every load.
     */
    theme: {
      options: ["system", "light", "dark"],
      defaultOption: "system",
      storageKey: "automend.theme",
      darkClass: "dark",
    },
    /**
     * The sidebar remembers whether it is collapsed.
     *
     * The shadcn component already *writes* this cookie on every toggle; nothing read it back, because
     * that is a server-side step in Next.js and this is a single-page app. So the name mirrors the
     * constant inside `components/ui/sidebar.tsx`, and `tests/sidebar-state.test.ts` fails if the
     * vendored file is regenerated with a different one.
     */
    sidebar: {
      cookieName: "sidebar_state",
    },
    defaultApiBasePath: API_BASE_PATH,
    queryStaleTimeMs: 10_000,
    queryRetryCount: 1,
    healthRefetchIntervalMs: 15_000,
    routerPreload: "intent",
  },

  /**
   * Values used only by the local development stack and by the `.env.example` generator.
   *
   * Application code must never read from here — it reads validated values from `env.ts`. This
   * exists so `docker-compose.yml` and `.env.example` derive from the same primitives as the code
   * instead of repeating them.
   */
  localDev: {
    host: LOCAL_HOST,
    postgres: {
      serviceName: LOCAL_POSTGRES_SERVICE,
      image: LOCAL_POSTGRES_IMAGE,
      containerPort: POSTGRES_CONTAINER_PORT,
      user: LOCAL_POSTGRES_USER,
      password: LOCAL_POSTGRES_PASSWORD,
      database: LOCAL_POSTGRES_DATABASE,
      dataPath: LOCAL_POSTGRES_DATA_PATH,
    },
    redis: {
      serviceName: LOCAL_REDIS_SERVICE,
      image: LOCAL_REDIS_IMAGE,
      containerPort: REDIS_CONTAINER_PORT,
    },

    /**
     * Ports `bun run dev` binds on the host, so it can say which app is blocked rather than
     * letting one of three parallel processes die with a bare EADDRINUSE.
     *
     * `envVar` is how a deployment moves the port; the Vite dev server has none, because the web
     * app reads `services.web.devServerPort` from here directly.
     */
    hostPorts: [
      { label: "api", defaultPort: API_PORT, envVar: "API_PORT" },
      { label: "worker health", defaultPort: WORKER_HEALTH_PORT, envVar: "WORKER_HEALTH_PORT" },
      { label: "web dev server", defaultPort: WEB_DEV_PORT, envVar: null },
    ],

    docker: {
      /** What `bun run dev:up` starts. The apps run on the host, so only their backing stores. */
      dependencyServices: [LOCAL_POSTGRES_SERVICE, LOCAL_REDIS_SERVICE],
      /**
       * How to start the engine when it is not already running.
       *
       * Linux is deliberately absent: there `dockerd` is a system service rather than an app, and
       * starting it needs privileges this script must not take. The script says so instead.
       */
      desktopLaunchers: {
        win32: ["C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"],
        darwin: ["open", "-a", "Docker"],
      },
      /** Docker Desktop routinely takes over a minute from launch to a responsive engine. */
      engineReadyTimeoutMs: 180_000,
      enginePollIntervalMs: 2_000,
    },
    /**
     * Two views of the same local services.
     *
     * `*FromHost` is for an app run with `bun run dev:*`; `*FromContainer` is for an app inside the
     * compose network, where `localhost` is the container itself. Both are only *defaults* — point
     * the matching variables in `.env` at a deployed database and everything follows.
     */
    urls: {
      database: postgresUrl({
        host: LOCAL_HOST,
        port: POSTGRES_CONTAINER_PORT,
        user: LOCAL_POSTGRES_USER,
        password: LOCAL_POSTGRES_PASSWORD,
        database: LOCAL_POSTGRES_DATABASE,
      }),
      databaseFromContainer: postgresUrl({
        host: LOCAL_POSTGRES_SERVICE,
        port: POSTGRES_CONTAINER_PORT,
        user: LOCAL_POSTGRES_USER,
        password: LOCAL_POSTGRES_PASSWORD,
        database: LOCAL_POSTGRES_DATABASE,
      }),
      redis: redisUrl(LOCAL_HOST, REDIS_CONTAINER_PORT),
      redisFromContainer: redisUrl(LOCAL_REDIS_SERVICE, REDIS_CONTAINER_PORT),
      /** What `bun run dev:up --all` publishes the database studio on. */
      studio: httpUrl(LOCAL_HOST, STUDIO_PORT),
      api: httpUrl(LOCAL_HOST, API_PORT),
      /**
       * The origin a *browser* uses, which is what OAuth redirects must be built from — never the
       * API's own address, since the browser only ever talks to the web app.
       */
      webDev: httpUrl(LOCAL_HOST, WEB_DEV_PORT),
      web: httpUrl(LOCAL_HOST, WEB_PORT),
    },
  },
} as const;

export type AutomendConfig = typeof config;
