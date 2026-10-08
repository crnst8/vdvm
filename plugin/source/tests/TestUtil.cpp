#include "TestUtil.h"

namespace drums::test
{
juce::File repoRoot()
{
    return juce::File (juce::String (DRUMS_REPO_ROOT)).getLinkedTarget();
}

bool hasCuratedCatalog()
{
    return repoRoot().getChildFile ("public/catalog/index.json").existsAsFile()
           && repoRoot().getChildFile ("public/media/audio").isDirectory();
}

std::shared_ptr<SampleData> makeData (int frames, double rate, float value, int channels, bool impulseOnly)
{
    auto d = std::make_shared<SampleData>();
    d->pcm.setSize (channels, frames);
    d->pcm.clear();
    for (int c = 0; c < channels; ++c)
    {
        if (impulseOnly)
            d->pcm.setSample (c, 0, value);
        else
            for (int i = 0; i < frames; ++i)
                d->pcm.setSample (c, i, value);
    }
    d->rate = rate;
    d->sourceRate = rate;
    d->sha256 = juce::String::repeatedString ("0", 64);
    return d;
}

juce::File writeTone (const juce::File& file, double rate, int channels, double seconds, double freq, double amp, int bits, bool aiff)
{
    file.deleteFile();
    file.getParentDirectory().createDirectory();
    std::unique_ptr<juce::AudioFormat> format;
    if (aiff)
        format = std::make_unique<juce::AiffAudioFormat>();
    else
        format = std::make_unique<juce::WavAudioFormat>();
    std::unique_ptr<juce::OutputStream> out = std::make_unique<juce::FileOutputStream> (file);
    auto writer = format->createWriterFor (out, juce::AudioFormatWriterOptions {}
                                                    .withSampleRate (rate)
                                                    .withNumChannels (channels)
                                                    .withBitsPerSample (bits));
    const int frames = (int) std::round (seconds * rate);
    juce::AudioBuffer<float> buf (channels, frames);
    for (int i = 0; i < frames; ++i)
    {
        // Decaying tone, like a drum hit.
        const float v = (float) (amp * std::sin (2 * juce::MathConstants<double>::pi * freq * i / rate) * std::exp (-6.0 * i / frames));
        for (int c = 0; c < channels; ++c)
            buf.setSample (c, i, v);
    }
    writer->writeFromAudioSampleBuffer (buf, 0, frames);
    writer.reset();
    return file;
}

TempDir::TempDir()
{
    dir = juce::File::getSpecialLocation (juce::File::tempDirectory)
              .getChildFile ("drums-tests-" + juce::String::toHexString (juce::Random::getSystemRandom().nextInt64()));
    dir.createDirectory();
}

TempDir::~TempDir()
{
    dir.deleteRecursively();
}

std::vector<int> onsets (const float* data, int n, float threshold)
{
    std::vector<int> out;
    bool quiet = true;
    for (int i = 0; i < n; ++i)
    {
        const bool loud = std::abs (data[i]) > threshold;
        if (loud && quiet)
            out.push_back (i);
        quiet = ! loud;
    }
    return out;
}
} // namespace drums::test
