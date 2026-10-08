#include "Resampler.h"

#include <cmath>
#include <vector>

namespace drums
{
namespace
{
    constexpr int zeroCrossings = 24;   // kernel half-width in output-band zero crossings
    constexpr int tableResolution = 512; // kernel samples per zero crossing

    double besselI0 (double x)
    {
        double sum = 1, term = 1;
        for (int k = 1; k < 32; ++k)
        {
            term *= (x / (2 * k)) * (x / (2 * k));
            sum += term;
        }
        return sum;
    }

    /** Kaiser-windowed sinc sampled at tableResolution points per zero crossing, 0..zeroCrossings. */
    const std::vector<float>& kernelTable()
    {
        static const std::vector<float> table = []
        {
            constexpr double beta = 9.0;
            const double i0b = besselI0 (beta);
            std::vector<float> t ((size_t) (zeroCrossings * tableResolution + 2));
            for (size_t i = 0; i < t.size(); ++i)
            {
                const double x = (double) i / tableResolution; // in zero crossings
                if (x >= zeroCrossings)
                {
                    t[i] = 0;
                    continue;
                }
                const double sinc = x == 0 ? 1.0 : std::sin (juce::MathConstants<double>::pi * x) / (juce::MathConstants<double>::pi * x);
                const double r = x / zeroCrossings;
                t[i] = (float) (sinc * besselI0 (beta * std::sqrt (1 - r * r)) / i0b);
            }
            return t;
        }();
        return table;
    }
} // namespace

juce::AudioBuffer<float> resampleBuffer (const juce::AudioBuffer<float>& in, double inRate, double outRate)
{
    if (inRate == outRate || in.getNumSamples() == 0)
        return juce::AudioBuffer<float> (in);
    const double ratio = outRate / inRate;
    // Cutoff relative to the input Nyquist: below the output Nyquist when downsampling, with a small guard band.
    const double cutoff = std::min (1.0, ratio) * 0.96;
    const int inLen = in.getNumSamples();
    const int outLen = (int) std::ceil (inLen * ratio - 1e-6);
    const auto& table = kernelTable();
    const double halfWidth = zeroCrossings / cutoff; // in input samples
    juce::AudioBuffer<float> out (in.getNumChannels(), outLen);
    for (int c = 0; c < in.getNumChannels(); ++c)
    {
        const float* x = in.getReadPointer (c);
        float* y = out.getWritePointer (c);
        for (int i = 0; i < outLen; ++i)
        {
            const double t = i / ratio;
            const int lo = std::max (0, (int) std::ceil (t - halfWidth));
            const int hi = std::min (inLen - 1, (int) std::floor (t + halfWidth));
            double acc = 0;
            for (int j = lo; j <= hi; ++j)
            {
                const double pos = std::abs (t - j) * cutoff * tableResolution;
                const auto idx = (size_t) pos;
                if (idx + 1 >= table.size())
                    continue;
                const double frac = pos - (double) idx;
                const double k = table[idx] + frac * (table[idx + 1] - table[idx]);
                acc += x[j] * k;
            }
            y[i] = (float) (acc * cutoff);
        }
    }
    return out;
}
} // namespace drums
