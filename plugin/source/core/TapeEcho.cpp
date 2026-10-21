#include "TapeEcho.h"
#include "Constants.h"

namespace drums
{
namespace
{
    constexpr double twoPi = 2 * juce::MathConstants<double>::pi;
    constexpr double sqrtHalf = 0.70710678118654752440;
    constexpr std::array<const char*, 3> tapeNames { "new", "used", "old" };

    double pow10 (double x) { return std::pow (10.0, x); }
} // namespace

// --- settings --------------------------------------------------------------------

double clampEchoKnob (const juce::var& v, double fallback)
{
    if (! (v.isInt() || v.isInt64() || v.isDouble()))
        return fallback;
    const double x = (double) v;
    if (! std::isfinite (x))
        return fallback;
    return std::min (1.0, std::max (0.0, jsRound (x * 100) / 100));
}

EchoState readEcho (const juce::var& v)
{
    EchoState d;
    auto* o = v.getDynamicObject();
    if (o == nullptr)
        return d;
    EchoState e;
    e.on = v["on"].isBool() && (bool) v["on"];
    if (const auto* heads = v["heads"].getArray(); heads != nullptr && heads->size() == 3)
        for (int i = 0; i < 3; ++i)
            e.heads[(size_t) i] = (*heads)[i].isBool() && (bool) (*heads)[i];
    e.spring = v["spring"].isBool() && (bool) v["spring"];
    e.rate = clampEchoKnob (v["rate"], d.rate);
    e.sync = -1;
    if (v["sync"].isString())
        for (size_t i = 0; i < echoSyncs.size(); ++i)
            if (v["sync"].toString() == echoSyncs[i].name)
                e.sync = (int) i;
    e.intensity = clampEchoKnob (v["intensity"], d.intensity);
    e.echo = clampEchoKnob (v["echo"], d.echo);
    e.reverb = clampEchoKnob (v["reverb"], d.reverb);
    e.bass = clampEchoKnob (v["bass"], d.bass);
    e.treble = clampEchoKnob (v["treble"], d.treble);
    e.input = clampEchoKnob (v["input"], d.input);
    e.tape = d.tape;
    for (size_t i = 0; i < tapeNames.size(); ++i)
        if (v["tape"].toString() == tapeNames[i])
            e.tape = (int) i;
    return e;
}

juce::var echoToJson (const EchoState& e)
{
    auto* o = new juce::DynamicObject();
    o->setProperty ("on", e.on);
    juce::Array<juce::var> heads;
    for (bool h : e.heads)
        heads.add (h);
    o->setProperty ("heads", heads);
    o->setProperty ("spring", e.spring);
    o->setProperty ("rate", e.rate);
    o->setProperty ("sync", e.sync >= 0 && e.sync < (int) echoSyncs.size() ? juce::var (echoSyncs[(size_t) e.sync].name) : juce::var());
    o->setProperty ("intensity", e.intensity);
    o->setProperty ("echo", e.echo);
    o->setProperty ("reverb", e.reverb);
    o->setProperty ("bass", e.bass);
    o->setProperty ("treble", e.treble);
    o->setProperty ("input", e.input);
    o->setProperty ("tape", tapeNames[(size_t) std::clamp (e.tape, 0, 2)]);
    return juce::var (o);
}

int hardwareMode (const std::array<bool, 3>& heads, bool spring)
{
    const int key = (heads[0] ? 1 : 0) | (heads[1] ? 2 : 0) | (heads[2] ? 4 : 0);
    // RE-20 owner's manual p. 18: 1-4 echo only, 5-11 echo and reverb, 12 reverb only.
    constexpr std::array<int, 8> echoOnly { 0, 1, 2, 0, 3, 0, 4, 0 };
    constexpr std::array<int, 8> withReverb { 12, 5, 6, 8, 7, 10, 9, 11 };
    return spring ? withReverb[(size_t) key] : echoOnly[(size_t) key];
}

EchoState withMode (EchoState e, int mode)
{
    constexpr std::array<std::pair<int, bool>, 12> table { { { 1, false }, { 2, false }, { 4, false }, { 6, false }, { 1, true }, { 2, true },
                                                            { 4, true }, { 3, true }, { 6, true }, { 5, true }, { 7, true }, { 0, true } } };
    const auto [key, spring] = table[(size_t) std::clamp (mode, 1, 12) - 1];
    e.heads = { (key & 1) != 0, (key & 2) != 0, (key & 4) != 0 };
    e.spring = spring;
    return e;
}

int leadingHead (const std::array<bool, 3>& heads)
{
    for (int i = 0; i < 3; ++i)
        if (heads[(size_t) i])
            return i;
    return -1;
}

double speedForRate (double rate)
{
    const double slowest = 1 / echo::speedRatio;
    return slowest + std::min (1.0, std::max (0.0, rate)) * (1 - slowest);
}

double targetSpeed (const EchoState& e, double bpm)
{
    const int h = leadingHead (e.heads);
    if (e.sync < 0 || e.sync >= (int) echoSyncs.size() || h < 0 || ! (bpm > 0))
        return speedForRate (e.rate);
    const double t = (echoSyncs[(size_t) e.sync].quarters * 60) / bpm;
    return std::min (1.0, std::max (1 / echo::speedRatio, echo::headDelaysSec[(size_t) h] / t));
}

double echoTailSec (const EchoState& e, double bpm)
{
    const double speed = targetSpeed (e, bpm);
    double longest = 0;
    for (size_t h = 0; h < 3; ++h)
        longest = std::max (longest, e.heads[h] ? echo::headDelaysSec[h] / speed : 0.0);
    const double loop = echo::intensityMaxGain * e.intensity;
    const double tail = longest == 0 ? 0 : loop < 0.97 ? longest * (1 + std::log (1e-3) / std::log (std::max (loop, 0.01))) : INFINITY;
    return std::min (12.0, std::max (tail, e.spring ? echo::springT60Sec : 0.0));
}

EchoDspParams echoDspParams (const EchoState& e, double bpm)
{
    EchoDspParams p;
    p.on = e.on;
    p.heads = e.heads;
    p.spring = e.spring;
    p.speed = targetSpeed (e, bpm);
    p.intensity = e.intensity;
    p.echo = e.echo;
    p.reverb = e.reverb;
    p.bass = e.bass;
    p.treble = e.treble;
    p.input = e.input;
    p.tape = e.tape;
    return p;
}

double echoErf (double x)
{
    const double ax = std::abs (x);
    const double t = 1 / (1 + 0.3275911 * ax);
    const double y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * std::exp (-ax * ax);
    return x < 0 ? -y : y;
}

namespace
{
    inline double tapeCurve (double x) { return echoErf (0.886226925452758 * x); }
} // namespace

// --- filters -----------------------------------------------------------------------

double TapeEcho::Biquad::process (double x)
{
    const double y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
}

void TapeEcho::Biquad::set (double nb0, double nb1, double nb2, double a0, double na1, double na2)
{
    b0 = nb0 / a0;
    b1 = nb1 / a0;
    b2 = nb2 / a0;
    a1 = na1 / a0;
    a2 = na2 / a0;
}

void TapeEcho::Biquad::lowpass (double f, double q, double rate)
{
    const double w = twoPi * f / rate, c = std::cos (w), al = std::sin (w) / (2 * q);
    set ((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
}

void TapeEcho::Biquad::highpass (double f, double q, double rate)
{
    const double w = twoPi * f / rate, c = std::cos (w), al = std::sin (w) / (2 * q);
    set ((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
}

void TapeEcho::Biquad::peak (double f, double q, double db, double rate)
{
    const double A = pow10 (db / 40), w = twoPi * f / rate, c = std::cos (w), al = std::sin (w) / (2 * q);
    set (1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
}

double TapeEcho::Shelf::process (double x)
{
    const double y = b0 * x + b1 * x1 - a1 * y1;
    x1 = x;
    y1 = y;
    return y;
}

void TapeEcho::Shelf::low (double f, double gain, double rate)
{
    const double k = std::tan (juce::MathConstants<double>::pi * f / rate), r = std::sqrt (gain);
    const double a0 = 1 + k / r;
    b0 = (1 + k * r) / a0;
    b1 = (k * r - 1) / a0;
    a1 = (k / r - 1) / a0;
}

void TapeEcho::Shelf::high (double f, double gain, double rate)
{
    const double k = std::tan (juce::MathConstants<double>::pi * f / rate), r = std::sqrt (gain);
    const double a0 = 1 / r + k;
    b0 = (r + k) / a0;
    b1 = (k - r) / a0;
    a1 = (k - 1 / r) / a0;
}

double TapeEcho::Noise::next()
{
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return s / 4294967296.0 * 2 - 1;
}

// --- spring ------------------------------------------------------------------------

TapeEcho::Spring::Spring (double delaySec, double rate)
{
    delay = std::max (1, (int) jsRound (delaySec * rate));
    line.assign ((size_t) delay + 1, 0.0);
    k = std::max (2, (int) jsRound (rate / (2 * echo::springTransitionHz)));
    stages.assign ((size_t) (echo::springStages * k), 0.0);
    const double meanGroupDelay = echo::springStages * k / rate;
    gain = pow10 (-3 * (delaySec + meanGroupDelay) / echo::springT60Sec);
    dampK = 1 - std::exp (-twoPi * echo::springDampHz / rate);
}

void TapeEcho::Spring::clear()
{
    std::fill (line.begin(), line.end(), 0.0);
    std::fill (stages.begin(), stages.end(), 0.0);
    state = damp = 0;
    w = idx = 0;
}

double TapeEcho::Spring::process (double x)
{
    line[(size_t) w] = x + gain * state;
    int r = w + 1;
    if (r > delay)
        r = 0;
    double y = line[(size_t) r];
    w = r;
    const double a = echo::springAllpass;
    for (int m = 0, base = 0; m < echo::springStages; ++m, base += k)
    {
        const double old = stages[(size_t) (base + idx)];
        const double v = y - a * old;
        stages[(size_t) (base + idx)] = v;
        y = a * v + old;
    }
    idx = idx + 1 == k ? 0 : idx + 1;
    damp += dampK * (y - damp);
    state = damp;
    return y;
}

// --- echo --------------------------------------------------------------------------

TapeEcho::TapeEcho (double sampleRate, uint32_t seed) : fs (sampleRate)
{
    const double longest = echo::headDelaysSec[2] * echo::speedRatio * 1.2;
    size = (int) std::pow (2.0, std::ceil (std::log2 (longest * fs + 8)));
    mask = size - 1;
    tape.assign ((size_t) size, 0.0);
    pos.assign ((size_t) size, 0.0);
    wowNoise.s = 0x9e3779b9u ^ seed;
    hissNoise.s = 0x85ebca6bu ^ seed;
    if (wowNoise.s == 0)
        wowNoise.s = 1;
    if (hissNoise.s == 0)
        hissNoise.s = 1;
    for (double d : echo::springDelaysSec)
        springs.emplace_back (d, fs);
    kSmooth = 1 - std::exp (-1 / (echo::smoothSec * fs));
    kSlow = 1 - std::exp (-1 / (echo::slowTauSec * fs));
    kFast = 1 - std::exp (-1 / (echo::fastTauSec * fs));
    kWow = 1 - std::exp (-twoPi * echo::wowHz * echo::controlFrames / fs);
    preEmph.high (echo::emphasisHz, pow10 (echo::emphasisDb / 20), fs);
    deEmph.high (echo::emphasisHz, pow10 (-echo::emphasisDb / 20), fs);
    springIn.highpass (echo::springLowCutHz, sqrtHalf, fs);
    springOut.lowpass (echo::springTransitionHz, sqrtHalf, fs);
    delay1 = echo::headDelaysSec[0];
    reset (1);
}

void TapeEcho::reset (double speed)
{
    std::fill (tape.begin(), tape.end(), 0.0);
    tapePos = 0;
    wi = 0;
    for (int j = 1; j < size; ++j)
        pos[(size_t) ((wi - j) & mask)] = -j * speed / fs;
    pos[(size_t) wi] = 0;
    for (size_t h = 0; h < 3; ++h)
        ri[h] = (wi - (int) std::ceil (echo::headDelaysSec[h] * fs / speed) - 4) & mask;
    delay1 = echo::headDelaysSec[0] / speed;
    fb = 0;
    mod = wow1 = wow2 = phCapstan = phRoller = 0;
    tick = 0;
    for (auto* f : { &preEmph, &deEmph, &bassShelf, &trebleShelf })
        f->clear();
    for (auto* f : { &loss, &bump, &lowCut, &springIn, &springOut })
        f->clear();
    for (auto& s : springs)
        s.clear();
    silent = 0;
    updateSpeedFilters (speed);
}

void TapeEcho::set (const EchoDspParams& p)
{
    const bool first = ! params.has_value();
    const bool wake = isIdle && p.on;
    params = p;
    tapeIndex = std::clamp (p.tape, 0, 2);
    t.input = p.input <= 0 ? 0 : pow10 ((p.input - 0.5) * 2 * echo::inputRangeDb / 20);
    t.active = p.on ? 1 : 0;
    const double loop = echo::intensityMaxGain * p.intensity;
    const int heads = (p.heads[0] ? 1 : 0) + (p.heads[1] ? 1 : 0) + (p.heads[2] ? 1 : 0);
    const double boost = std::sqrt ((double) std::max (1, heads)) * pow10 (echo::bumpDb / 20)
                         * pow10 (std::max ({ 0.0, std::abs (p.bass - 0.5), std::abs (p.treble - 0.5) }) * 2 * echo::toneRangeDb / 20);
    t.intensity = p.on ? loop : std::min (loop, 0.9 / boost);
    t.echo = 2 * p.echo * p.echo;
    t.reverb = 2 * p.reverb * p.reverb * echo::springLevel;
    t.spring = p.spring ? 1 : 0;
    t.hiss = p.on ? pow10 (echo::wearHissDb[(size_t) tapeIndex] / 20) * std::sqrt (3.0) : 0;
    t.h0 = p.heads[0] ? 1 : 0;
    t.h1 = p.heads[1] ? 1 : 0;
    t.h2 = p.heads[2] ? 1 : 0;
    t.bass = p.bass;
    t.treble = p.treble;
    if (wake)
    {
        reset (p.speed);
        isIdle = false;
    }
    if (first || wake)
        g = t;
}

void TapeEcho::updateSpeedFilters (double speed)
{
    const double nyq = 0.45 * fs;
    loss.lowpass (std::min (nyq, echo::wearLossHz[(size_t) tapeIndex] * speed), sqrtHalf, fs);
    bump.peak (echo::bumpHz * speed, echo::bumpQ, echo::bumpDb, fs);
    lowCut.highpass (0.5 * echo::bumpHz * speed, sqrtHalf, fs);
}

void TapeEcho::updateTone()
{
    if (g.bass != toneBass)
    {
        toneBass = g.bass;
        bassShelf.low (echo::toneHz, pow10 ((g.bass - 0.5) * 2 * echo::toneRangeDb / 20), fs);
    }
    if (g.treble != toneTreble)
    {
        toneTreble = g.treble;
        trebleShelf.high (echo::toneHz, pow10 ((g.treble - 0.5) * 2 * echo::toneRangeDb / 20), fs);
    }
}

double TapeEcho::read (int h, double target)
{
    int r = ri[(size_t) h];
    if (((wi - r) & mask) > size - 8)
        r = (wi - size + 8) & mask;
    while (((wi - r) & mask) > 3 && pos[(size_t) ((r + 1) & mask)] <= target)
        r = (r + 1) & mask;
    ri[(size_t) h] = r;
    const double p0 = pos[(size_t) r], p1 = pos[(size_t) ((r + 1) & mask)];
    const double span = p1 - p0;
    const double f = span > 0 ? std::min (1.0, std::max (0.0, (target - p0) / span)) : 0;
    const double xm1 = tape[(size_t) ((r - 1) & mask)], x0 = tape[(size_t) r], x1 = tape[(size_t) ((r + 1) & mask)],
                 x2 = tape[(size_t) ((r + 2) & mask)];
    const double c1 = 0.5 * (x1 - xm1);
    const double c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const double c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + x0;
}

void TapeEcho::process (const float* input, float* left, float* right, int n)
{
    if (! params || isIdle)
        return;
    const auto& p = *params;
    const double ks = kSmooth;
    const double d0 = echo::headDelaysSec[0], d1 = echo::headDelaysSec[1], d2 = echo::headDelaysSec[2];
    const double target1 = d0 / p.speed;
    const auto ti = (size_t) tapeIndex;
    for (int i = 0; i < n; ++i)
    {
        g.input += (t.input - g.input) * ks;
        g.active += (t.active - g.active) * ks;
        g.intensity += (t.intensity - g.intensity) * ks;
        g.echo += (t.echo - g.echo) * ks;
        g.reverb += (t.reverb - g.reverb) * ks;
        g.spring += (t.spring - g.spring) * ks;
        g.hiss += (t.hiss - g.hiss) * ks;
        g.h0 += (t.h0 - g.h0) * ks;
        g.h1 += (t.h1 - g.h1) * ks;
        g.h2 += (t.h2 - g.h2) * ks;
        g.bass += (t.bass - g.bass) * ks;
        g.treble += (t.treble - g.treble) * ks;
        delay1 += (target1 - delay1) * (target1 > delay1 ? kSlow : kFast);
        const double speed = d0 / delay1;
        if (tick == 0)
        {
            const double k = kWow;
            wow1 += k * (wowNoise.next() - wow1);
            wow2 += k * (wow1 - wow2);
            const double wow = wow2 * echo::wearWow[ti] * 2 / std::sqrt (k / 3);
            const double step = twoPi * speed * echo::controlFrames / fs;
            phCapstan += echo::capstanHz * step;
            phRoller += echo::rollerHz * step;
            if (phCapstan > twoPi)
                phCapstan -= twoPi;
            if (phRoller > twoPi)
                phRoller -= twoPi;
            mod = wow + echo::wearCapstan[ti] * std::sin (phCapstan) + echo::wearRoller[ti] * std::sin (phRoller);
            updateSpeedFilters (speed);
            updateTone();
        }
        tick = tick + 1 == echo::controlFrames ? 0 : tick + 1;
        tapePos += speed * (1 + mod) / fs;

        const double x = (double) input[i] * g.input * g.active;
        const double rec = std::tanh (x + fb);
        wi = (wi + 1) & mask;
        tape[(size_t) wi] = tapeCurve (preEmph.process (rec * echo::tapeLevel));
        pos[(size_t) wi] = tapePos;
        double y = 0;
        if (g.h0 > 1e-4)
            y += g.h0 * read (0, tapePos - d0);
        if (g.h1 > 1e-4)
            y += g.h1 * read (1, tapePos - d1);
        if (g.h2 > 1e-4)
            y += g.h2 * read (2, tapePos - d2);
        y /= std::sqrt (std::max (1.0, g.h0 + g.h1 + g.h2));
        y += hissNoise.next() * g.hiss * std::min (1.0, g.h0 + g.h1 + g.h2);
        y = lowCut.process (bump.process (deEmph.process (loss.process (y))));
        y = trebleShelf.process (bassShelf.process (y)) / echo::tapeLevel;
        y = echo::playbackRail * std::tanh (y / echo::playbackRail);
        fb = y * g.intensity;
        double r = 0;
        if (g.spring > 1e-4)
        {
            const double s = springIn.process (std::tanh (x));
            const double a = springs[0].process (s);
            const double b = springs[1].process (s);
            const double c = springs[2].process (s);
            r = springOut.process ((a + b + c) / 3);
        }
        const double wet = y * g.echo + r * g.reverb * g.spring;
        left[i] += (float) wet;
        right[i] += (float) wet;
        if (t.active == 0)
        {
            silent = std::abs (wet) < echo::idleLevel && std::abs (fb) < echo::idleLevel ? silent + 1 : 0;
            if (silent > echo::idleSec * fs)
            {
                isIdle = true;
                return;
            }
        }
    }
}
} // namespace drums
