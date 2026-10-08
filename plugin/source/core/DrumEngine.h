// Native voice engine, ported from src/audio/engine.ts. Fixed voice pool, no
// allocation, locks or IO on the audio thread. Times are absolute sample
// frames on the engine clock (render() advances it).
//
// Semantics kept from the browser engine:
// - per-hit gain = normalisation + mixer dB, then the fixed -12 dB master;
// - pitch = 2^(cents/1200) as a playback-rate change (pitched-down hits last longer);
// - a closed hat chokes open-hat voices that started strictly earlier, with a
//   5 ms fade starting at the closed-hat onset; same-time hats layer;
// - at most 64 voices sounding at a hit's onset; the oldest unfaded one is
//   stolen with a 5 ms fade; hits queued later do not count;
// - stop fades sounding voices over 5 ms and cancels queued ones;
// - listener output gain -24..+12 dB after the master, ramped over 20 ms,
//   with a peak limiter in circuit only above 0 dB.
#pragma once

#include "Constants.h"
#include "SampleStore.h"

#include <array>
#include <cstdint>

namespace drums
{
enum class HatRole : uint8_t { none, open, closed };

struct Hit
{
    const SampleData* data = nullptr;
    juce::int64 when = 0;  // absolute frame
    double gainDb = 0;     // normalisation + mixer (master applied by the engine)
    double pitchCents = 0;
    HatRole hat = HatRole::none;
    uint32_t kitTag = 0;
    int slotIndex = -1;
};

class DrumEngine
{
public:
    static constexpr int poolSize = 256;

    void prepare (double sampleRate);
    double sampleRate() const { return rate; }
    juce::int64 now() const { return clock; }
    /** Move the clock without rendering (tests, offline render start). */
    void setNow (juce::int64 frame) { clock = frame; }

    void trigger (const Hit& hit);
    /** Fade sounding voices from `at` and cancel queued ones; optionally only one kit's voices. */
    void stopAll (juce::int64 at, bool onlyKit = false, uint32_t kitTag = 0);
    /** Cancel hits that have not started by `from`. */
    void cancelFrom (juce::int64 from);
    /** Release every voice at once (reset, sample-rate change). */
    void killAll();

    /** Render `n` frames (added to out) starting at now(); advances the clock. */
    void render (float* left, float* right, int n);

    void setOutputGainDb (double db);
    double outputGainDb() const { return outputDb; }

    int activeVoices() const;
    int soundingAt (juce::int64 at) const;
    int pendingAfter (juce::int64 at) const;

private:
    struct Voice
    {
        const SampleData* data = nullptr;
        double pos = 0, inc = 1;
        float gain = 0;
        juce::int64 start = 0;
        juce::int64 fadeAt = INT64_MAX;
        juce::int64 naturalEnd = 0;
        int fadeLen = 1;
        HatRole hat = HatRole::none;
        uint32_t kitTag = 0;
        bool active = false;
        bool counted = true; // false once stolen: no longer counts toward the cap
    };

    void release (Voice& v);
    void fade (Voice& v, juce::int64 at, int length);
    Voice* freeVoice();
    void renderVoice (Voice& v, float* left, float* right, int n);
    void applyOutput (float* left, float* right, int n);

    std::array<Voice, poolSize> voices {};
    double rate = 48000;
    juce::int64 clock = 0;
    int stopFadeFrames = 240, chokeFadeFrames = 240;
    float masterGain = (float) dbToGain (masterGainDb);

    double outputDb = 0;
    double outputTarget = 1, outputCurrent = 1, outputStep = 0;
    int outputRampLeft = 0;
    bool limiting = false;
    double limiterGrDb = 0, limiterAttack = 0, limiterRelease = 0;
};
} // namespace drums
