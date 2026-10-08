# V.D.V.M plugin

The drum machine as a native instrument plugin: VST3, AU and Standalone on
macOS, built with JUCE 8.0.9 and CMake. The UI is the browser app's React
code running in a WebView; sound, kit loading, libraries and project state are
C++.

The product is named **V.D.V.M**, or **VDVM** / `vdvm` where a period is not allowed (plugin codes,
bundle and package IDs, file format tags, environment variables). The repository, C++ classes,
CMake targets and the bridge's internal event names keep the name `drums`.

One plugin (ID `Vdvm`/`Vdm1`, bundle `one.re20.vdvm`) serves both editions.
The bundled installer adds a catalog as the factory library; the unbundled
installer adds nothing else and the plugin opens on its Sources tab.

## Commands

All from the repo root.

| Command | What it does |
|---|---|
| `plugin/dev build` | `npm run plugin:ui`, then VST3, AU, Standalone and both test runners (Release) |
| `plugin/dev test [category]` | headless core tests: `contract`, `dsp`, `sequencer`, `library`, `state` |
| `plugin/dev hosttest` | loads the built VST3 like a DAW and checks rendered audio |
| `plugin/dev pluginval` | pluginval at strictness 10 (downloaded once into `~/.cache/drums-plugin/tools`) |
| `plugin/dev check` | build, test, hosttest, pluginval |
| `plugin/dev standalone` | Standalone app |
| `plugin/dev install` / `uninstall` | copy to / remove from `~/Library/Audio/Plug-Ins` (then `auval -v aumu Vdm1 Vdvm`) |
| `plugin/dev release [dir]` | universal build in `plugin/build-release`, all checks, both installers |
| `plugin/package.sh unbundled` | `plugin/build/packages/V.D.V.M-<version>-unbundled.pkg` |
| `plugin/package.sh bundled [dir]` | same plus the catalog in `dir` (default `public/`) as the factory library |
| `npm run plugin:shared` | regenerate `source/core/generated/shared.json` from `src/` (checked by `npm test`) |

Requirements: CMake 3.25+, a C++20 compiler (Xcode or Command Line Tools),
Node 24 for the UI bundle. JUCE comes from `~/.cache/drums-plugin/juce-8.0.9`
when present (`git clone --depth 1 --branch 8.0.9 https://github.com/juce-framework/JUCE.git`),
otherwise CMake downloads that tag.

The tests and the Standalone use `VDVM_FACTORY_DIR` as the factory library,
else `public/` when a full catalog is built there, else the generated test kits
in `public/fixture/`.

Environment variables: `VDVM_DATA_DIR` (user data folder), `VDVM_FACTORY_DIR`
(extra factory location, checked first), `VDVM_UI_DEV_URL` (load the UI from a
Vite dev server started with `npx vite --mode plugin`), `VDVM_BRIDGE_LOG`
(log every bridge call to a file).

## Layout

| Path | Contents |
|---|---|
| `source/core/` | Everything testable without a host: contract parsing and canonical revisions (`Contract`, `Json`), `Loudness`, `Pattern`, `Timing` (circuit swing and jitter), `MidiMap`, `Resampler`, `SampleStore`, `DrumEngine`, `StepSequencer`, `Playback` (snapshots + `Instrument`), `Render` (WAV/MIDI export), `Library`, `Importer`, `Stores`, `Session` |
| `source/core/generated/shared.json` | Circuit timing, GM notes and constants generated from `src/` |
| `source/plugin/` | `PluginProcessor` (parameters, host transport, state), `PluginEditor` (WebView), `Bridge` (native functions, events, resource provider, dialogs) |
| `source/tests/` | Core tests (JUCE UnitTest); `data/loudness-reference.json` comes from `scripts/loudness-reference.ts` |
| `source/hosttest/` | DAW-style VST3 host test |
| `scripts/` | UI bundle, shared data, loudness reference |
| `src/platform/` (repo root) | The UI side: `web.ts` (browser), `native.ts` + `bridge.ts` (plugin), chosen by the `@platform` alias |
| `src/ui/library/SourcesTab.tsx` | Plugin-only tab: libraries, import, kit editor, MIDI notes, presets, host sync |

## How it works

- **Audio thread.** `Instrument::process` reads host position, parameters and
  MIDI, asks `StepSequencer` which steps fall inside the block, and triggers
  `DrumEngine` voices at sample offsets. No allocation, locks, file IO, JSON or
  WebView calls. Playback state arrives as immutable `PlaybackSnapshot`s through
  `SnapshotExchange`; retired snapshots and evicted samples are freed on the
  message thread only once the audio thread and every voice have let go.
- **Timing.** Steps sit on the host's absolute sixteenth grid (16 steps = one
  4/4 bar from PPQ 0; the 8-step loop repeats the first half). Swing is latched
  per pair (16th) or group (8th) as in the browser. Jumps and loops re-seek
  without bursting skipped steps. Free-run mode (Standalone, or no host
  transport) uses the plugin's own tempo.
- **Tempo HOST / FREE** (TEMPO key in Playback, parameter `hostSync`). HOST:
  the host's tempo and transport drive the pattern; the BPM readout shows the
  host tempo and ON/OFF previews at it while the host is stopped. FREE: the
  panel's own BPM, and the host transport is ignored. The Standalone app has
  no host and hides the key.
- **Stop.** Host stop cancels queued hits and lets tails ring; the panel's
  ON/OFF stop uses the browser's 5 ms fade.
- **Window.** Sources → Window: Wide (desktop panel, 1240 × 880 CSS px) or
  Compact (phone panel, 420 × 900), and zoom 60-115% (Cmd/Ctrl + − 0). Zoom is
  WKWebView page zoom on macOS, so the wide panel stays wide in a small window;
  on Windows and Linux the page applies CSS zoom instead. Default: Wide at 70%.
  The choice is saved with the project and as the default for new instances.
- **Kits.** `Session` loads the chosen samples on worker threads (hash
  verified, decoded, loudness measured and cached, resampled to the host rate)
  and makes the kit active at once when stopped or at the next step 1 while
  playing. Missing variants stay silent; nothing is substituted.
- **Libraries.** `LibraryManager` keeps a per-user registry
  (`library-registry.json`) plus the auto-discovered factory folder. User
  libraries are valid V.D.V.M v1 catalogs written by the plugin (imported audio
  in `pool/` until a kit uses it, then in `media/audio/`); linked libraries keep
  audio in the user's folder and find it through `links.json`. Projects store
  library id + kit id + revision; another library is used only if it holds the
  identical kit revision, otherwise the project shows the missing state and
  keeps its pattern.
- **State.** The DAW project holds the pattern (Pattern v1), the kit
  reference, MIDI note overrides, editor size and the parameters. Saved
  patterns, preferences, presets and logs live in the data folder, shared by
  every instance and both editions.
- **UI.** The same React app as the browser, built with `--mode plugin`:
  `@platform` resolves to `src/platform/native.ts`, which mirrors native state
  and calls C++ through JUCE's native integration. Library files (catalog JSON,
  logos, photos) are served from disk under `/lib/<libraryId>/`.

## Host parameters

`output` (-24 to +12 dB), `swing` (50-75), `pitch` (±1200 cents), `bpm`
(FREE tempo), `hostSync` (TEMPO HOST/FREE), `run` (ON/OFF), `pad1`-`pad16` volume
(-36 to +6 dB, -37 = off) for the first 16 slots of the kit. Kits with more
slots keep the rest in the pattern only.

## Data locations (macOS)

Builds named `Drums` (before 0.4) are migrated on first run: `~/Library/Application Support/Drums`
moves to `…/V.D.V.M`, and old projects, presets, libraries and backups still load. A DAW sees the
renamed plugin as a new plugin, so a project saved with the old one needs the instrument swapped once.

- User data: `~/Library/Application Support/V.D.V.M/` (registry, `prefs.json`,
  `Patterns/`, `Presets/`, `User Libraries/`, `Cache/loudness.json`, `Logs/ui.log`)
- Factory: `~/Library/Application Support/V.D.V.M/Factory` or
  `/Library/Application Support/V.D.V.M/Factory` (the bundled installer uses the latter)
- Windows and Linux paths are coded (`%LOCALAPPDATA%\V.D.V.M`, `%PROGRAMDATA%\V.D.V.M\Factory`,
  `$XDG_DATA_HOME/V.D.V.M`) but not built or tested.
