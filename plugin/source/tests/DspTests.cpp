// Engine, loudness, resampler and sample-store checks. The engine checks port
// src/diagnostics/render-checks.ts and tests/engine.test.ts to offline C++.
#include "TestUtil.h"
#include "core/DrumEngine.h"
#include "core/Json.h"
#include "core/Loudness.h"
#include "core/Resampler.h"
#include "core/SampleStore.h"

namespace drums::test
{
namespace
{
    struct Render
    {
        std::vector<float> l, r;
        explicit Render (int n) : l ((size_t) n, 0.0f), r ((size_t) n, 0.0f) {}
    };

    Render renderEngine (DrumEngine& e, int frames, int block = 128)
    {
        Render out (frames);
        for (int i = 0; i < frames; i += block)
        {
            const int n = std::min (block, frames - i);
            e.render (out.l.data() + i, out.r.data() + i, n);
        }
        return out;
    }

    Hit hitOf (const SampleData& d, juce::int64 when, HatRole hat = HatRole::none, double gainDb = 0, double cents = 0)
    {
        Hit h;
        h.data = &d;
        h.when = when;
        h.hat = hat;
        h.gainDb = gainDb;
        h.pitchCents = cents;
        return h;
    }
} // namespace

class EngineTests : public juce::UnitTest
{
public:
    EngineTests() : juce::UnitTest ("Voice engine", "dsp") {}

    void runTest() override
    {
        constexpr double rate = 48000;
        const auto impulse = makeData (64, rate, 1.0f, 1, true);

        beginTest ("onsets land on the exact frame at -12 dB master");
        {
            DrumEngine e;
            e.prepare (rate);
            std::vector<int> expected;
            for (int i = 0; i < 16; ++i)
            {
                const int at = 2400 + i * 6000;
                expected.push_back (at);
                e.trigger (hitOf (*impulse, at));
            }
            const auto out = renderEngine (e, 100000, 512);
            const auto got = onsets (out.l.data(), (int) out.l.size());
            expectEquals ((int) got.size(), 16);
            for (size_t i = 0; i < std::min (got.size(), expected.size()); ++i)
                expectEquals (got[i], expected[i]);
            expectWithinAbsoluteError ((double) out.l[2400], dbToGain (-12), 1e-6);
            expectEquals (out.l[2400], out.r[2400]); // mono plays on both channels
        }

        beginTest ("closed hat chokes an older open hat at its onset, with a 5 ms fade");
        {
            DrumEngine e;
            e.prepare (rate);
            const auto dc = makeData ((int) (0.8 * rate), rate, 0.5f);
            const auto silent = makeData (1, rate, 0.0f);
            e.trigger (hitOf (*dc, (juce::int64) (0.1 * rate), HatRole::open));
            e.trigger (hitOf (*silent, (juce::int64) (0.5 * rate), HatRole::closed));
            const auto out = renderEngine (e, (int) rate);
            const auto at = [&] (double t) { return std::abs (out.l[(size_t) std::lround (t * rate)]); };
            expect (at (0.3) > 0.01f && at (0.49) > 0.01f);
            expect (at (0.5025) > 0.0f && at (0.5025) < at (0.49)); // mid-fade
            expect (at (0.52) < 1e-6f);
        }

        beginTest ("same-frame hats layer; open never chokes closed");
        {
            DrumEngine e;
            e.prepare (rate);
            const auto dc = makeData ((int) (0.5 * rate), rate, 0.25f);
            e.trigger (hitOf (*dc, 1000, HatRole::open));
            e.trigger (hitOf (*dc, 1000, HatRole::closed));
            e.trigger (hitOf (*dc, 5000, HatRole::open));
            const auto out = renderEngine (e, 20000);
            // open(1000) + closed(1000) + open(5000) all sound at 10000.
            expectWithinAbsoluteError ((double) out.l[10000], 3 * 0.25 * dbToGain (-12), 1e-5);
        }

        beginTest ("stop cancels queued hits and fades sounding voices");
        {
            DrumEngine e;
            e.prepare (rate);
            const auto dc = makeData ((int) rate, rate, 0.5f);
            e.trigger (hitOf (*dc, 0));
            e.trigger (hitOf (*dc, 24000));
            auto out = renderEngine (e, 4800);
            e.stopAll (e.now());
            expectEquals (e.pendingAfter (e.now()), 0);
            const auto rest = renderEngine (e, 48000);
            expect (std::abs (rest.l[100]) > 0.0f);
            expect (std::abs (rest.l[300]) < 1e-6f);
            expect (std::abs (rest.l[24000 - 4800 + 10]) < 1e-6f);
            expectEquals (e.activeVoices(), 0);
            expectEquals (dc->voiceRefs.load(), 0);
        }

        beginTest ("the cap counts sounding voices and steals the oldest");
        {
            DrumEngine e;
            e.prepare (rate);
            const auto dc = makeData ((int) rate, rate, 0.01f);
            for (int i = 0; i < maxVoices; ++i)
                e.trigger (hitOf (*dc, i));
            expectEquals (e.soundingAt (100), maxVoices);
            e.trigger (hitOf (*dc, 100));
            expectEquals (e.soundingAt (100), maxVoices);
            // Hits queued far ahead do not count toward the cap now.
            for (int i = 0; i < 10; ++i)
                e.trigger (hitOf (*dc, 400000 + i));
            expectEquals (e.soundingAt (100), maxVoices);
            renderEngine (e, 1000);
            expect (e.activeVoices() <= maxVoices + 10);
        }

        beginTest ("pitch is a rate change: an octave down lasts twice as long");
        {
            DrumEngine e;
            e.prepare (rate);
            const auto dc = makeData (4800, rate, 0.5f);
            e.trigger (hitOf (*dc, 0, HatRole::none, 0, -1200));
            const auto out = renderEngine (e, 20000);
            int last = 0;
            for (int i = 0; i < 20000; ++i)
                if (std::abs (out.l[(size_t) i]) > 1e-4f)
                    last = i;
            expectWithinAbsoluteError (last, 9600, 3);
        }

        beginTest ("data at another rate plays at its own pitch");
        {
            DrumEngine e;
            e.prepare (48000);
            const auto dc = makeData (4410, 44100, 0.5f);
            e.trigger (hitOf (*dc, 0));
            const auto out = renderEngine (e, 10000);
            int last = 0;
            for (int i = 0; i < 10000; ++i)
                if (std::abs (out.l[(size_t) i]) > 1e-4f)
                    last = i;
            expectWithinAbsoluteError (last, 4800, 3);
        }

        beginTest ("output gain ramps; the limiter holds boosted peaks near -1 dBFS");
        {
            DrumEngine e;
            e.prepare (rate);
            const auto loud = makeData ((int) rate, rate, 0.99f);
            e.setOutputGainDb (12);
            e.trigger (hitOf (*loud, 0, HatRole::none, 12));
            const auto out = renderEngine (e, (int) rate);
            float peakLate = 0;
            for (int i = 24000; i < 48000; ++i)
                peakLate = std::max (peakLate, std::abs (out.l[(size_t) i]));
            // 0.99 * +12 dB mix * -12 master * +12 output = +11.9 dBFS unlimited; held within 1 dB of the threshold.
            expect (gainToDb (peakLate) < 0.0 && gainToDb (peakLate) > -2.0, juce::String (gainToDb (peakLate)));
            DrumEngine q;
            q.prepare (rate);
            q.setOutputGainDb (-24);
            q.trigger (hitOf (*loud, 0));
            const auto quiet = renderEngine (q, 4800);
            expectWithinAbsoluteError (gainToDb (std::abs (quiet.l[4000])), gainToDb (0.99) - 12 - 24, 0.05);
        }

        beginTest ("stopAll with a kit filter leaves other kits sounding");
        {
            DrumEngine e;
            e.prepare (rate);
            const auto dc = makeData ((int) rate, rate, 0.5f);
            auto a = hitOf (*dc, 0);
            a.kitTag = 1;
            auto b = hitOf (*dc, 0);
            b.kitTag = 2;
            e.trigger (a);
            e.trigger (b);
            renderEngine (e, 100);
            e.stopAll (e.now(), true, 1);
            const auto out = renderEngine (e, 1000);
            expectWithinAbsoluteError ((double) out.l[900], 0.5 * dbToGain (-12), 1e-5);
        }
    }
};

class LoudnessTests : public juce::UnitTest
{
public:
    LoudnessTests() : juce::UnitTest ("Loudness parity", "dsp") {}

    void runTest() override
    {
        beginTest ("silence and limits");
        juce::AudioBuffer<float> silent (1, 1000);
        silent.clear();
        const auto s = measureHit (silent, 48000);
        expect (s.lufs == -INFINITY && s.peakDb == -INFINITY);
        expectEquals (normalisationDb (s), 0.0);
        expectEquals (normalisationDb ({ -80, -40 }), maxBoostDb);
        expectEquals (normalisationDb ({ 10, -1 }), maxCutDb);
        expectEquals (normalisationDb ({ -30, 0 }), 3.0); // peak ceiling wins over +10 dB

        beginTest ("mono counts on both channels (equal to the same signal in stereo)");
        juce::AudioBuffer<float> mono (1, 20000), stereo (2, 20000);
        for (int i = 0; i < 20000; ++i)
        {
            const float v = (float) std::sin (i * 0.05) * 0.5f;
            mono.setSample (0, i, v);
            stereo.setSample (0, i, v);
            stereo.setSample (1, i, v);
        }
        expectWithinAbsoluteError (measureHit (mono, 44100).lufs, measureHit (stereo, 44100).lufs, 1e-9);

        beginTest ("matches src/audio/loudness.ts on real catalog samples");
        if (! hasCuratedCatalog())
        {
            logMessage ("skipped: public/media not present");
            return;
        }
        juce::String err;
        const auto rows = parseJson (repoRoot().getChildFile ("plugin/source/tests/data/loudness-reference.json").loadFileAsString(), err);
        expect (rows.has_value() && rows->isArray(), err);
        int compared = 0;
        double worst = 0;
        for (const auto& row : *rows->getArray())
        {
            const auto file = repoRoot().getChildFile (row["file"].toString());
            if (! file.existsAsFile())
                continue;
            const auto decoded = decodeAudioFile (file, {});
            expect (decoded.error.isEmpty(), decoded.error);
            const auto level = measureHit (decoded.pcm, decoded.rate);
            const double ref = (double) row["normalisationDb"];
            worst = std::max (worst, std::abs (normalisationDb (level) - ref));
            if (! row["lufs"].isVoid())
                expectWithinAbsoluteError (level.lufs, (double) row["lufs"], 0.001);
            ++compared;
        }
        logMessage ("compared " + juce::String (compared) + " samples, worst normalisation difference "
                    + juce::String (worst, 6) + " dB");
        expect (compared >= 20);
        expect (worst < 0.001);
    }
};

class ResamplerTests : public juce::UnitTest
{
public:
    ResamplerTests() : juce::UnitTest ("Resampler", "dsp") {}

    static double rmsAt (const juce::AudioBuffer<float>& b, double rate, double freq)
    {
        // Single-bin DFT magnitude over the middle of the buffer.
        double re = 0, im = 0;
        const int n0 = b.getNumSamples() / 4, n1 = 3 * b.getNumSamples() / 4;
        for (int i = n0; i < n1; ++i)
        {
            const double ph = 2 * juce::MathConstants<double>::pi * freq * i / rate;
            re += b.getSample (0, i) * std::cos (ph);
            im += b.getSample (0, i) * std::sin (ph);
        }
        return 2 * std::sqrt (re * re + im * im) / (n1 - n0);
    }

    void runTest() override
    {
        beginTest ("44.1 -> 48 kHz keeps a 1 kHz tone's level and length");
        juce::AudioBuffer<float> in (1, 44100);
        for (int i = 0; i < 44100; ++i)
            in.setSample (0, i, (float) (0.5 * std::sin (2 * juce::MathConstants<double>::pi * 1000 * i / 44100.0)));
        const auto up = resampleBuffer (in, 44100, 48000);
        expectEquals (up.getNumSamples(), 48000);
        expectWithinAbsoluteError (rmsAt (up, 48000, 1000), 0.5, 0.002);

        beginTest ("96 -> 44.1 kHz removes content above the new Nyquist");
        juce::AudioBuffer<float> hi (1, 96000);
        for (int i = 0; i < 96000; ++i)
            hi.setSample (0, i, (float) (0.5 * std::sin (2 * juce::MathConstants<double>::pi * 30000 * i / 96000.0)));
        const auto down = resampleBuffer (hi, 96000, 44100);
        // 30 kHz would alias to 14.1 kHz without filtering.
        expect (rmsAt (down, 44100, 14100) < 0.001, juce::String (rmsAt (down, 44100, 14100)));
    }
};

class SampleStoreTests : public juce::UnitTest
{
public:
    SampleStoreTests() : juce::UnitTest ("Sample store", "dsp") {}

    void runTest() override
    {
        TempDir tmp;
        const auto wav = writeTone (tmp.dir.getChildFile ("a.wav"), 44100, 1, 0.5, 200, 0.5);
        const auto sha = sha256Hex (wav);

        beginTest ("loads, verifies, measures and resamples to the target rate");
        {
            SampleStore store;
            store.setTargetRate (48000);
            juce::String error;
            const auto d = store.loadNow ({ sha, wav }, error);
            expect (d != nullptr, error);
            expectEquals (d->rate, 48000.0);
            expectEquals (d->sourceRate, 44100.0);
            expectWithinAbsoluteError (d->durationSec(), 0.5, 0.001);
            expect (std::isfinite (d->level.lufs));
            expect (store.get (sha) == d);
        }

        beginTest ("hash mismatch, unsupported files and limits are refused with a message");
        {
            SampleStore store;
            juce::String error;
            expect (store.loadNow ({ juce::String::repeatedString ("a", 64), wav }, error) == nullptr);
            expect (error.contains ("hash"), error);
            const auto junk = tmp.dir.getChildFile ("junk.wav");
            junk.replaceWithText ("not audio");
            error = {};
            expect (store.loadNow ({ sha256Hex (junk), junk }, error) == nullptr);
            expect (error.contains ("supported"), error);
            const auto quad = writeTone (tmp.dir.getChildFile ("quad.wav"), 44100, 4, 0.1, 200, 0.5);
            error = {};
            expect (store.loadNow ({ sha256Hex (quad), quad }, error) == nullptr);
            expect (error.contains ("channels"), error);
            const auto aiff = writeTone (tmp.dir.getChildFile ("b.aif"), 48000, 2, 0.2, 300, 0.5, 24, true);
            error = {};
            expect (store.loadNow ({ sha256Hex (aiff), aiff }, error) != nullptr, error);
        }

        beginTest ("loadSet reports progress and rejects kits over the budget");
        {
            SampleStore store (1024 * 1024);
            store.setTargetRate (44100);
            juce::WaitableEvent done;
            juce::StringArray errors;
            std::atomic<int> progressCalls { 0 };
            store.loadSet ("staging", { { sha, wav, true, 0.5, 1 } }, [&] (int, int) { ++progressCalls; },
                           [&] (const juce::StringArray& e) { errors = e; done.signal(); });
            expect (done.wait (5000));
            expect (errors.isEmpty(), errors.joinIntoString ("; "));
            expect (progressCalls.load() >= 2);
            juce::WaitableEvent rejected;
            store.loadSet ("other", { { "f", wav, false, 30.0, 2 } }, nullptr,
                           [&] (const juce::StringArray& e) { errors = e; rejected.signal(); });
            expect (rejected.wait (5000));
            expect (errors.size() == 1 && errors[0].contains ("MiB"), errors.joinIntoString ("; "));
        }

        beginTest ("evicted data is freed only when no voice uses it");
        {
            SampleStore store (200 * 1024);
            store.setTargetRate (44100);
            juce::String error;
            auto d = store.loadNow ({ sha, wav }, error);
            expect (d != nullptr);
            const auto* raw = d.get();
            raw->voiceRefs.fetch_add (1);
            d.reset();
            const auto wav2 = writeTone (tmp.dir.getChildFile ("c.wav"), 44100, 1, 0.9, 300, 0.5);
            store.loadNow ({ sha256Hex (wav2), wav2 }, error); // pushes the first one out of the budget
            expect (! store.has (sha));
            store.collectGarbage();
            expectEquals ((int) store.pendingGarbage(), 1); // a voice still plays it
            raw->voiceRefs.fetch_sub (1);
            store.collectGarbage();
            expectEquals ((int) store.pendingGarbage(), 0);
        }

        beginTest ("a target-rate change reloads at the new rate");
        {
            SampleStore store;
            store.setTargetRate (44100);
            juce::String error;
            auto a = store.loadNow ({ sha, wav }, error);
            store.setTargetRate (96000);
            expect (store.get (sha) == nullptr);
            auto b = store.loadNow ({ sha, wav }, error);
            expectEquals (b->rate, 96000.0);
            expectEquals (b->pcm.getNumSamples(), 48000);
        }
    }
};

static EngineTests engineTests;
static LoudnessTests loudnessTests;
static ResamplerTests resamplerTests;
static SampleStoreTests sampleStoreTests;
} // namespace drums::test
