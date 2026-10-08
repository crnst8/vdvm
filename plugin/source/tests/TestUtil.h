// Helpers shared by the core tests.
#pragma once

#include "core/SampleStore.h"

#include <juce_core/juce_core.h>
#include <memory>

namespace drums::test
{
/** Repository root (compiled in), and whether the curated catalog in public/ is present. */
juce::File repoRoot();
bool hasCuratedCatalog();

/** Sample data held only by the test (refcount checks use voiceRefs). */
std::shared_ptr<SampleData> makeData (int frames, double rate, float value, int channels = 1, bool impulseOnly = false);

/** Write a PCM WAV (16 or 24 bit) or AIFF file with a test signal. */
juce::File writeTone (const juce::File& file, double rate, int channels, double seconds, double freq, double amp, int bits = 16,
                      bool aiff = false);

/** A fresh temporary directory removed when the object goes away. */
struct TempDir
{
    juce::File dir;
    TempDir();
    ~TempDir();
};

/** Onset frames where |x| crosses threshold after silence. */
std::vector<int> onsets (const float* data, int n, float threshold = 1.0e-4f);
} // namespace drums::test
