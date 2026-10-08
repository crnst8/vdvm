// One-loop exports, ported from src/audio/export.ts.
//
// WAV: one pattern cycle plus the decay tail at 44.1 kHz, 16-bit stereo, with
// the playback rules (normalisation, mixer, step level and pitch, -12 dB
// master, closed hat choking older open hats). Like the browser export it
// leaves out the listener output gain and its limiter, and it uses the
// pattern's swing as set (circuit timing is a live playback setting).
//
// MIDI: a type-0 file on channel 10 at 480 ticks per quarter note, notes from
// the plugin's MIDI map (unique per slot, so the file plays back into the
// plugin as written) and velocity = 127 x level, the inverse of how incoming
// velocity sets the level. The browser export uses GM notes with a shared
// fallback and velocity = 100 x gain.
#pragma once

#include "MidiMap.h"
#include "Pattern.h"
#include "SampleStore.h"

namespace drums
{
struct StepTimes
{
    std::vector<double> times; // seconds from the loop start
    double duration = 0;
};
StepTimes stepTimes (const PatternState& p);

/** Decoded audio for a sample (at any rate), or an error. */
using SampleSource = std::function<Decoded (const Sample&)>;

/** Rendered stereo loop at exportSampleRate, before WAV encoding (tests inspect it). */
juce::AudioBuffer<float> renderLoop (const PatternState& p, const KitManifest& kit, const SampleSource& source, juce::String& error);

juce::MemoryBlock wavBytes (const juce::AudioBuffer<float>& audio, double rate);
juce::MemoryBlock midiFileBytes (const PatternState& p, const KitManifest& kit, const MidiMap& map);
} // namespace drums
