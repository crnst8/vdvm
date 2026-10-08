// Pattern state, ported from src/state/pattern.ts (PatternState, toPattern,
// fromPattern, bindKit, hitGainDb, hitPitchCents). The UI edits patterns with
// the TypeScript reducer; the plugin keeps this copy for playback, host state,
// automation and presets.
#pragma once

#include "Constants.h"
#include "Contract.h"

#include <array>
#include <map>

namespace drums
{
struct TrackState
{
    juce::String slotId, sampleId;
    std::array<bool, steps> stepsOn {};
    double gainDb = 0; // -inf = off
    std::array<double, steps> levels;
    std::array<int, steps> stepPitchCents {};

    TrackState() { levels.fill (1.0); }
};

struct PatternState
{
    juce::String id, name = "UNTITLED", kitId, kitRevision;
    int bpm = bpmDefault;
    int swing = 50;
    int swingGrid = 16;
    bool circuit = false;
    int length = 16;
    int pitchCents = 0;
    std::map<juce::String, TrackState> tracks;
    juce::String updatedAt;

    bool operator== (const PatternState&) const = default;
};

inline bool operator== (const TrackState& a, const TrackState& b)
{
    return a.slotId == b.slotId && a.sampleId == b.sampleId && a.stepsOn == b.stepsOn && a.gainDb == b.gainDb
           && a.levels == b.levels && a.stepPitchCents == b.stepPitchCents;
}

int clampBpm (double bpm);
int clampSwing (double swing);
double clampTrackGain (double db);
double clampLevel (double x);

/** dB offset from track gain and step level (level squared); -inf when silent. step < 0 = the drum itself. */
double hitGainDb (const TrackState& track, int step);
/** Overall pitch plus the track's offset for the step (step < 0: overall only). */
int hitPitchCents (const PatternState& p, const TrackState* track, int step);

PatternState newPatternState (const KitManifest& kit, const juce::String& id);
/** Ensure a track for every slot of `kit`; keep tracks for other slots. */
PatternState bindKit (PatternState state, const KitManifest& kit);

/** Contract Pattern v1 JSON (catalog/schema/pattern.schema.json). */
juce::var toPatternJson (const PatternState& p);
/** Lenient read with the clamps of fromPattern; nullopt when the structure is not a pattern. */
std::optional<PatternState> fromPatternJson (const juce::var& json);

juce::String newPatternId();
juce::String isoNow();
} // namespace drums
