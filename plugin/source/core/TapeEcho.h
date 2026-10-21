// Tape echo and spring reverb modelled on the Roland RE-201 Space Echo, ported
// line for line from src/audio/echo/settings.ts and src/audio/echo/dsp.ts.
// Both builds render source/tests/data/echo-reference.json (written by
// plugin/scripts/echo-reference.ts); keep the operation order the same.
// Sources and estimates for every constant: docs/research/SPACE_ECHO.md.
//
// TapeEcho allocates in its constructor only; set() and process() are
// realtime safe.
#pragma once

#include <array>
#include <cstdint>
#include <juce_core/juce_core.h>
#include <optional>
#include <vector>

namespace drums
{
namespace echo
{
    // settings.ts
    inline constexpr std::array<double, 3> headDelaysSec { 0.069, 0.131, 0.189 };
    inline constexpr double speedRatio = 2.575;
    inline constexpr double slowTauSec = 1.89;
    inline constexpr double fastTauSec = 1.07;

    // dsp.ts
    inline constexpr int controlFrames = 32;
    inline constexpr double smoothSec = 0.02;
    inline constexpr double tapeLevel = 2;
    inline constexpr double intensityMaxGain = 1.6;
    inline constexpr double playbackRail = 1.5;
    inline constexpr double inputRangeDb = 18;
    inline constexpr double toneHz = 750;
    inline constexpr double toneRangeDb = 12;
    inline constexpr double emphasisHz = 2500;
    inline constexpr double emphasisDb = 8;
    inline constexpr double bumpHz = 100;
    inline constexpr double bumpDb = 2.5;
    inline constexpr double bumpQ = 1.4;
    inline constexpr double wowHz = 1;
    inline constexpr double capstanHz = 9;
    inline constexpr double rollerHz = 2.1;
    inline constexpr std::array<double, 3> wearWow { 0.0006, 0.0012, 0.0025 };
    inline constexpr std::array<double, 3> wearCapstan { 0.0003, 0.0005, 0.0009 };
    inline constexpr std::array<double, 3> wearRoller { 0.0002, 0.0004, 0.0008 };
    inline constexpr std::array<double, 3> wearLossHz { 11000, 9000, 6500 };
    inline constexpr std::array<double, 3> wearHissDb { -74, -68, -62 };
    inline constexpr std::array<double, 3> springDelaysSec { 0.0347, 0.0411, 0.0463 };
    inline constexpr double springTransitionHz = 4000;
    inline constexpr int springStages = 60;
    inline constexpr double springAllpass = 0.6;
    inline constexpr double springT60Sec = 2.4;
    inline constexpr double springLowCutHz = 120;
    inline constexpr double springDampHz = 6000;
    inline constexpr double springLevel = 1;
    inline constexpr double idleSec = 0.5;
    inline constexpr double idleLevel = 1e-6;
} // namespace echo

/** Tempo-sync note values (quarter notes) in ECHO_SYNCS order. */
struct EchoSyncValue
{
    const char* name;
    double quarters;
};
inline constexpr std::array<EchoSyncValue, 9> echoSyncs { {
    { "1/32", 1.0 / 8 }, { "1/16T", 1.0 / 6 }, { "1/16", 1.0 / 4 }, { "1/8T", 1.0 / 3 }, { "1/16D", 3.0 / 8 },
    { "1/8", 1.0 / 2 }, { "1/4T", 2.0 / 3 }, { "1/8D", 3.0 / 4 }, { "1/4", 1.0 },
} };

/** Stored settings (Pattern v1 `echo`). Knobs 0..1; sync -1 = free, else an index into echoSyncs; tape 0 new, 1 used, 2 old. */
struct EchoState
{
    bool on = false;
    std::array<bool, 3> heads { true, false, false };
    bool spring = false;
    double rate = 0.5;
    int sync = -1;
    double intensity = 0.35, echo = 0.5, reverb = 0.4, bass = 0.5, treble = 0.5, input = 0.5;
    int tape = 1;

    bool operator== (const EchoState&) const = default;
};

/** settings.ts clampKnob: two decimals in 0..1; `fallback` for non-numbers. */
double clampEchoKnob (const juce::var& v, double fallback);
/** settings.ts readEcho: lenient read, every field clamped or defaulted. */
EchoState readEcho (const juce::var& v);
juce::var echoToJson (const EchoState& e);
/** RE-201 MODE SELECTOR position 1-12, or 0 when the hardware has no such combination. */
int hardwareMode (const std::array<bool, 3>& heads, bool spring);
EchoState withMode (EchoState e, int mode);
int leadingHead (const std::array<bool, 3>& heads);
double speedForRate (double rate);
double targetSpeed (const EchoState& e, double bpm);
/** Seconds for the echo to fade after its input stops (12 at most). */
double echoTailSec (const EchoState& e, double bpm);

struct EchoDspParams
{
    bool on = false;
    std::array<bool, 3> heads { true, false, false };
    bool spring = false;
    double speed = 1, intensity = 0, echo = 0, reverb = 0, bass = 0.5, treble = 0.5, input = 0.5;
    int tape = 1;

    bool operator== (const EchoDspParams&) const = default;
};
EchoDspParams echoDspParams (const EchoState& e, double bpm);

/** Abramowitz & Stegun 7.1.26, as in dsp.ts. */
double echoErf (double x);

class TapeEcho
{
public:
    explicit TapeEcho (double sampleRate, uint32_t seed = 1);

    void reset (double speed);
    void set (const EchoDspParams& p);
    /** Add the wet signal for `n` frames of mono `input` to `left` and `right`. */
    void process (const float* input, float* left, float* right, int n);
    bool idle() const { return isIdle; }
    double sampleRate() const { return fs; }
    /** Head-1 delay after motor ballistics (tests). */
    double headOneDelay() const { return delay1; }

private:
    struct Biquad
    {
        double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        double process (double x);
        void clear() { x1 = x2 = y1 = y2 = 0; }
        void set (double b0, double b1, double b2, double a0, double a1, double a2);
        void lowpass (double f, double q, double fs);
        void highpass (double f, double q, double fs);
        void peak (double f, double q, double db, double fs);
    };
    struct Shelf
    {
        double b0 = 1, b1 = 0, a1 = 0, x1 = 0, y1 = 0;
        double process (double x);
        void clear() { x1 = y1 = 0; }
        void low (double f, double g, double fs);
        void high (double f, double g, double fs);
    };
    struct Noise
    {
        uint32_t s = 1;
        double next();
    };
    struct Spring
    {
        Spring (double delaySec, double fs);
        void clear();
        double process (double x);
        std::vector<double> line;
        int w = 0, delay = 1;
        std::vector<double> stages;
        int k = 2, idx = 0;
        double gain = 0, state = 0, dampK = 0, damp = 0;
    };
    struct Smoothed
    {
        double input = 0, active = 0, intensity = 0, echo = 0, reverb = 0, spring = 0, hiss = 0, h0 = 0, h1 = 0, h2 = 0,
               bass = 0.5, treble = 0.5;
    };

    void updateSpeedFilters (double speed);
    void updateTone();
    double read (int h, double target);

    double fs;
    int size = 0, mask = 0;
    std::vector<double> tape, pos;
    int wi = 0;
    std::array<int, 3> ri {};
    double tapePos = 0, delay1 = 0, mod = 0, wow1 = 0, wow2 = 0, phCapstan = 0, phRoller = 0, fb = 0;
    int tick = 0;
    Noise wowNoise, hissNoise;
    Shelf preEmph, deEmph, bassShelf, trebleShelf;
    Biquad loss, bump, lowCut, springIn, springOut;
    std::vector<Spring> springs;
    double kSmooth = 0, kSlow = 0, kFast = 0, kWow = 0;
    Smoothed g, t;
    double toneBass = -1, toneTreble = -1;
    std::optional<EchoDspParams> params;
    int tapeIndex = 1;
    juce::int64 silent = 0;
    bool isIdle = true;
};
} // namespace drums
