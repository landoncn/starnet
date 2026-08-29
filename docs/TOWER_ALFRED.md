# Tower Alfred

Tower Alfred is a Hermes-backed derivative mode for this StarNet codebase. It makes the existing Hermes `default` profile—ALFRED—the authoritative conversational and execution engine while retaining the station UI as a local visual command center.

## Start it

Prerequisites:

- macOS or another Node-supported host
- Node.js 22 (the verified toolchain)
- Hermes Agent installed and configured
- `hermes acp --check` succeeds

From this checkout:

```sh
npm ci
npm link
starnet alfred
```

The installed command resolves to the checkout's `bin/starnet.mjs`. It checks Hermes ACP, starts the local sidecar, waits for a real HTTP response, and opens:

```text
http://127.0.0.1:8791/?tower=alfred&...
```

Headless/operator mode:

```sh
starnet alfred --no-open
```

Other options:

```text
--port PORT
--profile NAME
--config PATH
--help
```

Stop Tower Alfred with `Ctrl-C`. The launcher forwards termination to the sidecar, and the sidecar terminates only the Hermes ACP process it owns.

## Authority model

```text
Terminal: starnet alfred
          |
          v
Tower launcher (configuration + health check)
          |
          +--> StarNet sidecar in TOWER_ALFRED mode
          |       |
          |       +--> Tower HTTP/NDJSON adapter
          |       |       |
          |       |       +--> Hermes ACP client SDK
          |       |               |
          |       |               +--> hermes --profile default acp
          |       |
          |       +--> existing station UI/event contract
          |
          +--> browser at the Tower-specific local origin
```

Hermes remains authoritative for:

- ALFRED's identity and standing instructions
- provider/model configuration
- memory and persistent sessions
- skills and tools
- tool permission requests
- cancellation and tool execution

The station owns:

- visual presentation
- local layout and station state
- translation of ACP updates into existing `agent.*` events
- permission UI transport

Tower Alfred does not import or duplicate Hermes credentials, sessions, databases, or secrets.

## Configuration

Edit `tower-alfred.config.json`, or pass a different file with `--config`.

```json
{
  "product": {
    "name": "Tower Alfred",
    "shortName": "TOWER ALFRED",
    "commanderTitle": "Master Nesbitt"
  },
  "hermes": {
    "profile": "default",
    "command": "hermes"
  },
  "supervisor": {
    "name": "ALFRED",
    "role": "Supervisory Intelligence",
    "authority": "primary"
  },
  "server": {
    "host": "127.0.0.1",
    "port": 8791,
    "openBrowser": true
  },
  "storage": {
    "workspaces": ".tower-alfred/workspaces"
  }
}
```

Operational fields:

- `product.name`: browser title and runtime brand overlay
- `hermes.profile`: authoritative Hermes profile; overridden by `--profile`
- `hermes.command`: Hermes executable
- `supervisor.name`: seeded station supervisor and status identity
- `supervisor.role`: seeded station purpose/role
- `server.host`: browser URL host; restricted to `127.0.0.1` or `localhost` because the sidecar is loopback-only
- `server.port`: Tower origin and sidecar port; overridden by `--port`
- `server.openBrowser`: whether launch opens the browser
- `storage.workspaces`: Tower-specific StarNet state root, relative to the repository unless absolute

The sidecar injects the Tower boot attestation and these non-secret presentation values into served HTML only when `TOWER_ALFRED=1`. A URL query or ordinary StarNet launch cannot activate Tower mode or seed the Tower supervisor.

Each frontend `streamId` owns one reusable ACP runtime/session for the life of the sidecar. Returning to a workstream resumes only that workstream's Hermes session; different workstreams do not share conversational state. Sidecar restart currently starts fresh ACP sessions (see limitations below).

## HTTP boundary

Tower routes are registered only when `TOWER_ALFRED=1`:

- `GET /api/tower/status`
- `POST /api/tower/run`
- `POST /api/tower/consent`
- `POST /api/tower/cancel`

They use StarNet's existing local API-token gate. `/api/tower/run` emits newline-delimited events compatible with the existing station harness:

- `agent.run.start`
- `agent.token` (`payload.delta`)
- `agent.tool_call`
- `permission.prompt`
- `agent.tool_result`
- `agent.run.error`
- `agent.run.end`

Permission requests pause the ACP call. Tower renders only the options included in that request and returns the selected ACP `optionId` exactly. It never translates StarNet's broader “Full access” grade into a persistent Hermes grant. Unsupported or timed-out decisions fail closed to the request's reject option.

If the browser aborts or the response stream closes, the HTTP adapter cancels the exact emitted Tower run. Graceful sidecar shutdown waits for all Tower runtimes to stop (within StarNet's existing three-second hard deadline), and each ACP runtime signals its owned child without waiting on a stalled cancel transport.

## Storage isolation

Tower Alfred uses:

```text
<checkout>/.tower-alfred/workspaces
```

and port `8791` by default. The separate workspace and browser origin prevent Tower state from reading or overwriting an ordinary StarNet source-run save. `.tower-alfred/` is gitignored.

Hermes continues to use its own profile-safe home. Tower does not copy that home into its workspace.

## Verified behavior

The implementation includes automated tests for:

- ACP initialization, per-workstream persistent sessions, streaming, exact-option permission response, cancellation, and child ownership
- launcher argument/config validation and workspace isolation
- event projection and permission round-trip
- HTTP status/run/consent/cancel routes
- server-attested mode gating that ignores a query-only activation attempt
- Tower-mode frontend routing and seeded supervisor identity

A live verification also proved:

- `starnet alfred` resolves from `/opt/homebrew/bin/starnet`
- the sidecar uses `.tower-alfred/workspaces`
- the `default` Hermes profile streams real responses through ACP
- server-injected Tower attestation is present only in Tower mode; ordinary StarNet ignores `?tower=alfred`
- `alpha`, `beta`, then `alpha` again creates two ACP sessions and reuses the first
- the browser reaches `screen-game` with ALFRED as supervisor
- terminating the launcher reaps every exact owned Hermes ACP PID

## Current boundary

The first operational Tower Alfred vertical slice is complete. It is suitable for local development and use.

It is not yet a public binary release:

1. The upstream StarNet name, logo, sprites, station artwork, and other brand assets are separately reserved and are not granted by the MIT code license. Tower Alfred must replace those assets before public distribution.
2. The current command opens the browser-backed source application. A separately named/notarized Tower Alfred `.app`/DMG has not been produced.
3. Delegated Hermes subagents execute correctly through ALFRED, but they are not yet projected as individually animated crew members in the station.
4. ACP sessions are isolated and reused per workstream while the sidecar is running; sidecar restart currently starts fresh ACP sessions rather than loading a prior ACP session ID.
5. The Tower overlay renames visible runtime text in Tower mode; upstream source-mode behavior remains available and unchanged when Tower mode is off.
6. `product.shortName` and `product.commanderTitle` are reserved configuration fields but are not yet projected separately from `product.name` and the existing station vocabulary.

These boundaries are deliberate. Tower Alfred must not claim a distributable rebrand or visualized multi-agent state until the assets and telemetry actually prove it.
