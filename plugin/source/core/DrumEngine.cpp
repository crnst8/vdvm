#include "DrumEngine.h"

namespace drums
{
namespace
{
    // Limiter settings of the browser's DynamicsCompressorNode (engine.ts): threshold -1 dB, hard knee, ratio 20,
    // attack 2 ms, release 100 ms. No lookahead and no automatic makeup gain here.
    constexpr double limiterThresholdDb = -1.0;
    constexpr double limiterRatio = 20.0;
    constexpr double limiterAttackSec = 0.002;
    constexpr double limiterReleaseSec = 0.1;

    inline float cubic (const float* x, int len, double pos)
    {
        const int i = (int) pos;
        const float f = (float) (pos - i);
        const float xm1 = i - 1 >= 0 && i - 1 < len ? x[i - 1] : 0.0f;
        const float x0 = i < len ? x[i] : 0.0f;
        const float x1 = i + 1 < len ? x[i + 1] : 0.0f;
        const float x2 = i + 2 < len ? x[i + 2] : 0.0f;
        // 4-point, 3rd-order Hermite.
        const float c1 = 0.5f * (x1 - xm1);
        const float c2 = xm1 - 2.5f * x0 + 2.0f * x1 - 0.5f * x2;
        const float c3 = 0.5f * (x2 - xm1) + 1.5f * (x0 - x1);
        return ((c3 * f + c2) * f + c1) * f + x0;
    }
} // namespace

void DrumEngine::prepare (double sampleRate)
{
    killAll();
    rate = sampleRate > 0 ? sampleRate : 48000;
    stopFadeFrames = std::max (1, (int) std::lround (stopFadeSec * rate));
    chokeFadeFrames = std::max (1, (int) std::lround (chokeFadeSec * rate));
    limiterAttack = 1.0 - std::exp (-1.0 / (limiterAttackSec * rate));
    limiterRelease = 1.0 - std::exp (-1.0 / (limiterReleaseSec * rate));
    outputCurrent = outputTarget;
    outputRampLeft = 0;
}

void DrumEngine::release (Voice& v)
{
    if (v.active && v.data != nullptr)
        v.data->voiceRefs.fetch_sub (1, std::memory_order_acq_rel);
    v.active = false;
    v.data = nullptr;
}

void DrumEngine::killAll()
{
    for (auto& v : voices)
        release (v);
}

void DrumEngine::fade (Voice& v, juce::int64 at, int length)
{
    if (at >= v.fadeAt)
        return;
    v.fadeAt = at;
    v.fadeLen = length;
}

DrumEngine::Voice* DrumEngine::freeVoice()
{
    for (auto& v : voices)
        if (! v.active)
            return &v;
    // Pool exhausted (only with many fading voices): reuse the voice closest to its end.
    Voice* victim = &voices[0];
    for (auto& v : voices)
        if (std::min (v.fadeAt, v.naturalEnd) < std::min (victim->fadeAt, victim->naturalEnd))
            victim = &v;
    release (*victim);
    return victim;
}

void DrumEngine::trigger (const Hit& hit)
{
    if (hit.data == nullptr || hit.data->pcm.getNumSamples() == 0 || ! std::isfinite (hit.gainDb))
        return;
    const juce::int64 at = std::max (hit.when, clock);
    const double pitch = pitchRate (hit.pitchCents);
    if (hit.hat == HatRole::closed)
    {
        for (auto& v : voices)
            if (v.active && v.hat == HatRole::open && v.start < at && v.fadeAt > at)
                fade (v, at, chokeFadeFrames);
    }
    // The cap counts voices sounding at `at`.
    int sounding = 0;
    Voice* oldest = nullptr;
    for (auto& v : voices)
    {
        if (! v.active || ! v.counted || v.start > at || std::min (v.fadeAt, v.naturalEnd) <= at)
            continue;
        ++sounding;
        if (v.fadeAt == INT64_MAX && (oldest == nullptr || v.start < oldest->start))
            oldest = &v;
    }
    if (sounding >= maxVoices && oldest != nullptr)
    {
        fade (*oldest, std::max (at, oldest->start), stopFadeFrames);
        oldest->counted = false;
    }
    auto* v = freeVoice();
    v->data = hit.data;
    hit.data->voiceRefs.fetch_add (1, std::memory_order_acq_rel);
    v->active = true;
    v->counted = true;
    v->pos = 0;
    v->inc = (hit.data->rate / rate) * pitch;
    v->gain = (float) (dbToGain (hit.gainDb) * masterGain);
    v->start = at;
    v->fadeAt = INT64_MAX;
    v->fadeLen = stopFadeFrames;
    v->naturalEnd = at + (juce::int64) std::ceil (hit.data->pcm.getNumSamples() / v->inc);
    v->hat = hit.hat;
    v->kitTag = hit.kitTag;
}

void DrumEngine::stopAll (juce::int64 at, bool onlyKit, uint32_t kitTag)
{
    for (auto& v : voices)
    {
        if (! v.active || (onlyKit && v.kitTag != kitTag))
            continue;
        if (v.start > at)
            release (v);
        else if (v.fadeAt > at)
            fade (v, at, stopFadeFrames);
    }
}

void DrumEngine::cancelFrom (juce::int64 from)
{
    for (auto& v : voices)
        if (v.active && v.start >= from)
            release (v);
}

void DrumEngine::renderVoice (Voice& v, float* left, float* right, int n)
{
    const juce::int64 blockStart = clock;
    const juce::int64 blockEnd = clock + n;
    if (v.start >= blockEnd)
        return;
    const auto& pcm = v.data->pcm;
    const int len = pcm.getNumSamples();
    const float* l = pcm.getReadPointer (0);
    const float* r = pcm.getNumChannels() > 1 ? pcm.getReadPointer (1) : l;
    int i = (int) std::max<juce::int64> (0, v.start - blockStart);
    for (; i < n; ++i)
    {
        const juce::int64 t = blockStart + i;
        float g = v.gain;
        if (t >= v.fadeAt)
        {
            const double k = 1.0 - (double) (t - v.fadeAt) / v.fadeLen;
            if (k <= 0)
            {
                release (v);
                return;
            }
            g *= (float) k;
        }
        if (v.pos >= len)
        {
            release (v);
            return;
        }
        left[i] += g * cubic (l, len, v.pos);
        right[i] += g * cubic (r, len, v.pos);
        v.pos += v.inc;
    }
}

void DrumEngine::render (float* left, float* right, int n)
{
    for (auto& v : voices)
        if (v.active)
            renderVoice (v, left, right, n);
    applyOutput (left, right, n);
    clock += n;
}

void DrumEngine::setOutputGainDb (double db)
{
    outputDb = std::clamp (db, outputGainMinDb, outputGainMaxDb);
    outputTarget = dbToGain (outputDb);
    outputRampLeft = std::max (1, (int) std::lround (outputRampSec * rate));
    outputStep = (outputTarget - outputCurrent) / outputRampLeft;
    limiting = outputDb > 0;
    if (! limiting)
        limiterGrDb = 0;
}

void DrumEngine::applyOutput (float* left, float* right, int n)
{
    if (outputRampLeft == 0 && outputCurrent == 1.0 && ! limiting)
        return;
    for (int i = 0; i < n; ++i)
    {
        if (outputRampLeft > 0)
        {
            outputCurrent += outputStep;
            if (--outputRampLeft == 0)
                outputCurrent = outputTarget;
        }
        double l = left[i] * outputCurrent;
        double r = right[i] * outputCurrent;
        if (limiting)
        {
            const double peak = std::max (std::abs (l), std::abs (r));
            const double levelDb = peak > 1e-9 ? 20 * std::log10 (peak) : -180;
            const double over = levelDb - limiterThresholdDb;
            const double want = over > 0 ? over * (1 - 1 / limiterRatio) : 0;
            limiterGrDb += (want - limiterGrDb) * (want > limiterGrDb ? limiterAttack : limiterRelease);
            const double g = dbToGain (-limiterGrDb);
            l *= g;
            r *= g;
        }
        left[i] = (float) l;
        right[i] = (float) r;
    }
}

int DrumEngine::activeVoices() const
{
    int n = 0;
    for (const auto& v : voices)
        n += v.active ? 1 : 0;
    return n;
}

int DrumEngine::soundingAt (juce::int64 at) const
{
    int n = 0;
    for (const auto& v : voices)
        n += v.active && v.counted && v.start <= at && std::min (v.fadeAt, v.naturalEnd) > at ? 1 : 0;
    return n;
}

int DrumEngine::pendingAfter (juce::int64 at) const
{
    int n = 0;
    for (const auto& v : voices)
        n += v.active && v.start > at ? 1 : 0;
    return n;
}
} // namespace drums
