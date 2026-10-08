// Per-hit loudness normalisation, ported from src/audio/loudness.ts:
// BS.1770 K-weighting, maximum momentary loudness over a 400 ms rectangular
// window (zero-padded for short hits), mono counted on both output channels.
// Measured off the audio thread, once per sample, cached by content hash and
// normalisationAlgorithmVersion.
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

namespace drums
{
struct HitLevel
{
    double lufs = -INFINITY;   // -inf for silence
    double peakDb = -INFINITY; // -inf for silence
};

HitLevel measureHit (const juce::AudioBuffer<float>& buffer, double sampleRate);
HitLevel measureHit (const float* const* channels, int numChannels, int numFrames, double sampleRate);

/** Gain in dB that brings a measured hit to targetLufs within the peak ceiling and limits. */
double normalisationDb (const HitLevel& level);
} // namespace drums
