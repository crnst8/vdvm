#include "Loudness.h"
#include "Constants.h"

#include <vector>

namespace drums
{
namespace
{
    struct Biquad
    {
        double b0, b1, b2, a1, a2;
    };

    void kWeighting (double rate, Biquad& shelf, Biquad& highPass)
    {
        double K = std::tan (juce::MathConstants<double>::pi * 1681.974450955533 / rate);
        const double Vh = std::pow (10.0, 3.999843853973347 / 20.0);
        const double Vb = std::pow (Vh, 0.4996667741545416);
        double Q = 0.7071752369554196;
        double a0 = 1 + K / Q + K * K;
        shelf = { (Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0,
                  2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0 };
        K = std::tan (juce::MathConstants<double>::pi * 38.13547087602444 / rate);
        Q = 0.5003270373238773;
        a0 = 1 + K / Q + K * K;
        highPass = { 1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0 };
    }

    template <typename In>
    void filter (const In* x, int n, const Biquad& f, double* out)
    {
        double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (int i = 0; i < n; ++i)
        {
            const double x0 = x[i];
            const double y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
            x2 = x1;
            x1 = x0;
            y2 = y1;
            y1 = y0;
            out[i] = y0;
        }
    }
} // namespace

HitLevel measureHit (const float* const* channels, int numChannels, int n, double rate)
{
    if (n <= 0 || numChannels <= 0)
        return {};
    Biquad shelf {}, highPass {};
    kWeighting (rate, shelf, highPass);
    std::vector<double> power ((size_t) n, 0.0), shelved ((size_t) n), stage ((size_t) n);
    const double weight = numChannels == 1 ? 2.0 : 1.0;
    double peak = 0;
    for (int c = 0; c < numChannels; ++c)
    {
        const float* data = channels[c];
        for (int i = 0; i < n; ++i)
            peak = std::max (peak, (double) std::abs (data[i]));
        filter (data, n, shelf, shelved.data());
        filter (shelved.data(), n, highPass, stage.data());
        for (int i = 0; i < n; ++i)
            power[(size_t) i] += weight * stage[(size_t) i] * stage[(size_t) i];
    }
    const int window = std::max (1, (int) std::lround (0.4 * rate));
    double sum = 0;
    for (int i = 0; i < std::min (window, n); ++i)
        sum += power[(size_t) i];
    double max = sum;
    for (int i = window; i < n; ++i)
    {
        sum += power[(size_t) i] - power[(size_t) (i - window)];
        max = std::max (max, sum);
    }
    const double ms = max / window;
    HitLevel level;
    level.lufs = ms > 0 ? -0.691 + 10 * std::log10 (ms) : -INFINITY;
    level.peakDb = peak > 0 ? 20 * std::log10 (peak) : -INFINITY;
    return level;
}

HitLevel measureHit (const juce::AudioBuffer<float>& buffer, double sampleRate)
{
    return measureHit (buffer.getArrayOfReadPointers(), buffer.getNumChannels(), buffer.getNumSamples(), sampleRate);
}

double normalisationDb (const HitLevel& level)
{
    if (! std::isfinite (level.lufs) || ! std::isfinite (level.peakDb))
        return 0;
    const double toTarget = targetLufs - level.lufs;
    const double toCeiling = peakCeilingDb - level.peakDb;
    return std::min (maxBoostDb, std::max (maxCutDb, std::min (toTarget, toCeiling)));
}
} // namespace drums
