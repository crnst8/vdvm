// Circuit timing (documented hardware swing positions and measured step
// jitter), ported from src/audio/circuit.ts with data from src/data/timing.ts
// via generated/shared.json. Only machines with a profile get circuit timing;
// user kits play straight timing plus the user's swing.
#pragma once

#include <juce_core/juce_core.h>
#include <map>
#include <optional>
#include <vector>

namespace drums
{
struct SwingSteps
{
    enum class Kind { ticks, values } kind = Kind::ticks;
    int divisions = 0, maxSteps = 0;
    std::vector<double> values;
};

struct JitterProfile
{
    enum class Kind { measured, poll } kind = Kind::measured;
    double maxMs = 0;
    std::optional<double> meanMs;
    double pollMs = 0;
};

struct CircuitProfile
{
    juce::String summary;
    std::map<int, SwingSteps> swingGrids; // keyed by 8 / 16
    std::optional<JitterProfile> jitter;
};

/** Profile for a catalog machine id, or nullptr. */
const CircuitProfile* circuitFor (const juce::String& machineId);

/** The swing the hardware would play for a requested amount (nearest reachable position, capped). */
double machineSwing (double requested, const SwingSteps* steps);

/** Small deterministic generator (xorshift64*), safe on the audio thread. */
struct Rng
{
    juce::uint64 state;
    explicit Rng (juce::uint64 seed) : state (seed != 0 ? seed : 0x9E3779B97F4A7C15ull) {}
    double next() // [0, 1)
    {
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        return (double) ((state * 0x2545F4914F6CDD1Dull) >> 11) * (1.0 / 9007199254740992.0);
    }
};

/** Per-run jitter source. Offsets are lateness in seconds, never negative. */
class StepJitter
{
public:
    StepJitter (const JitterProfile& profile, juce::uint64 seed);
    double offsetSec (double whenSec);

private:
    JitterProfile profile;
    Rng rng;
    double pollPhaseMs = 0;
};

/** General MIDI percussion notes keyed by slot id or category (src/audio/export.ts GM_NOTES). */
const std::map<juce::String, int>& gmNotes();

/** generated/shared.json, parsed once. */
const juce::var& sharedData();
} // namespace drums
