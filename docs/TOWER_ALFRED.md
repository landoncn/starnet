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
http://127.0.0.1:8791/
```

### Clickable macOS app

Install the local app bundle and Desktop shortcut with:

```sh
npm run tower:install-app
```

This creates:

```text
~/Applications/Tower Alfred.app
~/Desktop/Tower Alfred.app -> ~/Applications/Tower Alfred.app
```

The bundle is a native arm64 Mach-O launcher with an original Tower Alfred icon. Clicking it starts Tower without opening Terminal. A per-user `flock` is acquired before startup, a fresh 256-bit nonce is passed only to the owned sidecar, and that nonce must return in the server-injected boot attestation before the browser can open. The sidecar is launched with `--no-open`, and only the lock-owning launcher opens the browser after its exact Tower child becomes ready. Rapid duplicate clicks read the owner nonce from the locked state file and continuously recheck that the original lock remains held; they therefore converge on one owned sidecar. An unrelated process occupying or racing for the configured port cannot satisfy the nonce check and is never opened as Tower. Replacement bundles are built, checked, and signed in staging, then exchanged with the live bundle through Darwin `renameatx_np(..., RENAME_SWAP)` so the installed application path remains continuously available. The local bundle is ad-hoc signed; Developer ID signing, notarization, and DMG packaging remain release work.

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

On every Tower boot, the visible supervisor record is rebound to the server-attested identity: provider `hermes`, model `hermes/<profile>`, authority `hermes-acp`, and the original `nightwarden` presentation skin. Tower treats Hermes ACP as host-authorized, so StarNet's browser-key CTA cannot falsely claim that ALFRED has “no brain wired.” The top bar displays an attested `ALFRED ATTACHED · HERMES ACP · <profile> PROFILE` status.

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
  },
  "studio": {
    "projectRoot": "/Users/alfred/Projects/Anglers-Hollow",
    "kanbanBoard": "anglers-hollow"
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
- `studio.projectRoot`: absolute path to the authorized Angler's Hollow checkout; Tower reads `studio/manifest.json`, `studio/artifacts.json`, optional owner decisions in `studio/artifact-reviews.jsonl`, and registered artifacts
- `studio.kanbanBoard`: validated Hermes Kanban board slug used as the sole live work-status source

### Angler's Hollow Studio command center

In attested Tower mode, the returning-user screen includes a studio command panel. Its roster is the ordered set of durable Hermes profiles declared by the project's `studio/manifest.json`. Current assignments come directly from `hermes kanban --board <board> list --json`; profile existence without a task is shown as idle, and a failed board read is shown as unknown rather than fabricated activity.

The same panel lists project artifacts registered in `studio/artifacts.json`. Only allowlisted raster-image and audio formats are previewable. The sidecar rejects unregistered paths, traversal, symlinks, unsupported types, and files above the configured cap, then serves the selected file behind StarNet's existing local API-token gate. Browser previews use revocable blob URLs, so no project path or API credential is placed in an `<img>` or `<audio>` URL.

Each registered visual or audio artifact also has owner-only `Approve`, `Deny`, and feedback controls. Each decision is durably appended as one bounded JSON line to the fixed project log `studio/artifact-reviews.jsonl`; a truncated crash-tail cannot erase earlier decisions and blocks later writes until repaired. Artifact files and registry metadata are never rewritten by a review action. Review IDs must already exist in the safe registry, decisions are restricted to `pending`, `approved`, or `denied`, feedback is bounded, and the mutation route remains behind the same Tower authentication and loopback/origin boundary.

The permanent studio profiles are `ahtech`, `ahgameplay`, `ahbalance`, `ahnarrative`, `ahvisual`, `ahaudio`, and `ahqa`. ALFRED remains the sole integration authority in the `default` profile; Tower does not turn the specialist profiles into independent supervisors.

The sidecar injects the Tower boot attestation and these non-secret presentation values into served HTML only when `TOWER_ALFRED=1`. A URL query or ordinary StarNet launch cannot activate Tower mode or seed the Tower supervisor.

Each frontend `streamId` owns one reusable ACP runtime/session for the life of the sidecar. Returning to a workstream resumes only that workstream's Hermes session; different workstreams do not share conversational state. Sidecar restart currently starts fresh ACP sessions (see limitations below).

## HTTP boundary

Tower routes are registered only when `TOWER_ALFRED=1`:

- `GET /api/tower/status`
- `GET /api/tower/studio`
- `GET /api/tower/studio/artifact?path=<registered-relative-path>`
- `POST /api/tower/studio/review`
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
- saved-state rebinding to the attested Hermes provider/profile and suppression of the inapplicable browser API-key CTA
- the original Night Warden sprite manifest, gothic skyline/rain overlay, Tower wordmark, and application icon; Night Warden is registered only when server-attested Tower boot is present
- native macOS bundle generation, code signing, Desktop shortcut creation, atomic replacement, validated ports, owned-server checks, and duplicate-launch locking

A live verification also proved:

- `starnet alfred` resolves from `/opt/homebrew/bin/starnet`
- the sidecar uses `.tower-alfred/workspaces`
- the `default` Hermes profile streams real responses through ACP
- server-injected Tower attestation is present only in Tower mode; ordinary StarNet ignores `?tower=alfred`
- `alpha`, `beta`, then `alpha` again creates two ACP sessions and reuses the first
- the browser reaches `screen-game` with ALFRED as supervisor
- the live UI reports `provider: hermes`, `model: hermes/default`, `skin: nightwarden`, and a visible Hermes ACP attachment badge
- an authenticated live UI-path run reports backend `hermes-acp` and returns a real Hermes response
- the macOS app launches through LaunchServices without opening Terminal
- terminating the launcher reaps every exact owned Hermes ACP PID

## Current boundary

The operational Tower Alfred vertical slice, click-to-launch macOS bundle, authoritative ALFRED/Hermes binding, and first original visual package are complete for local use.

It is not yet a public binary release:

1. Tower mode now has an original wordmark, app icon, Night Warden supervisor sprite, palette, and gothic skyline/rain treatment. The underlying repository still retains upstream StarNet assets and station presentation for ordinary source mode, so a fully independent public distribution still requires a complete reserved-asset inventory and replacement pass.
2. A separately named local `Tower Alfred.app` exists and is ad-hoc signed. Developer ID signing, Apple notarization, and a distributable DMG have not been produced.
3. Seven durable Angler's Hollow specialist profiles and a Kanban-backed read-only command panel are now projected in Tower. Specialist work appears as truthful task status and registered art/audio deliverables; live crew animation remains outside this scope.
4. ACP sessions are isolated and reused per workstream while the sidecar is running; sidecar restart currently starts fresh ACP sessions rather than loading a prior ACP session ID.
5. The Tower overlay renames visible runtime text in Tower mode; upstream source-mode behavior remains available and unchanged when Tower mode is off.
6. `product.shortName` and `product.commanderTitle` are reserved configuration fields but are not yet projected separately from `product.name` and the existing station vocabulary.

These boundaries are deliberate. Tower Alfred must not claim a distributable rebrand or visualized multi-agent state until the assets and telemetry actually prove it.
