// Engine, pattern and loudness constants. Each mirrors a value in src/ and is
// checked against generated/shared.json by the core tests.
#pragma once

#include <algorithm>
#include <cmath>

namespace drums
{
inline constexpr double masterGainDb = -12.0;
inline constexpr int maxVoices = 64;
inline constexpr double stopFadeSec = 0.005;
inline constexpr double chokeFadeSec = 0.005;
inline constexpr double outputGainMinDb = -24.0;
inline constexpr double outputGainMaxDb = 12.0;
inline constexpr double outputRampSec = 0.02;

inline constexpr double targetLufs = -20.0;
inline constexpr double peakCeilingDb = 3.0;
inline constexpr double maxBoostDb = 24.0;
inline constexpr double maxCutDb = -24.0;
/** Bump when measureHit or normalisationDb changes, so cached gains are recomputed. */
inline constexpr int normalisationAlgorithmVersion = 1;

inline constexpr int pitchMinCents = -1200;
inline constexpr int pitchMaxCents = 1200;
inline constexpr int effectivePitchMinCents = -2400;
inline constexpr int effectivePitchMaxCents = 2400;

inline constexpr double lateLimitSec = 0.05;
inline constexpr int steps = 16;
inline constexpr int pageSize = 8;
inline constexpr int bpmMin = 40;
inline constexpr int bpmMax = 240;
inline constexpr int bpmDefault = 120;
inline constexpr double trackGainMinDb = -36.0;
inline constexpr double trackGainMaxDb = 6.0;

/** WAV export format of src/audio/export.ts. */
inline constexpr int exportSampleRate = 44100;

/** JavaScript Math.round: halves round toward +infinity. */
inline double jsRound (double x) { return std::floor (x + 0.5); }

inline double dbToGain (double db) { return std::isfinite (db) ? std::pow (10.0, db / 20.0) : 0.0; }
inline double gainToDb (double g) { return g > 0 ? 20.0 * std::log10 (g) : -INFINITY; }

/** src/audio/pitch.ts clampPitchCents: integer, ±1200; 0 for non-finite. */
inline int clampPitchCents (double value)
{
    if (! std::isfinite (value))
        return 0;
    return (int) std::clamp (jsRound (value), (double) pitchMinCents, (double) pitchMaxCents);
}

/** src/audio/pitch.ts pitchRate: 2^(cents/1200) with cents bounded to ±2400; non-finite = 1. */
inline double pitchRate (double effectiveCents)
{
    const double cents = std::isfinite (effectiveCents)
                             ? std::clamp (effectiveCents, (double) effectivePitchMinCents, (double) effectivePitchMaxCents)
                             : 0.0;
    return std::pow (2.0, cents / 1200.0);
}
} // namespace drums
