// Tape echo: the C++ port against the browser DSP (reference renders), the
// shared constants, the mode table, pattern round-trips and voice sends.
#include "TestUtil.h"
#include "core/DrumEngine.h"
#include "core/Json.h"
#include "core/Pattern.h"
#include "core/TapeEcho.h"
#include "core/Timing.h"

namespace drums::test
{
namespace
{
    EchoDspParams paramsFromJson (const juce::var& v)
    {
        EchoDspParams p;
        p.on = (bool) v["on"];
        for (int i = 0; i < 3; ++i)
            p.heads[(size_t) i] = (bool) v["heads"][i];
        p.spring = (bool) v["spring"];
        p.speed = (double) v["speed"];
        p.intensity = (double) v["intensity"];
        p.echo = (double) v["echo"];
        p.reverb = (double) v["reverb"];
        p.bass = (double) v["bass"];
        p.treble = (double) v["treble"];
        p.input = (double) v["input"];
        const auto tape = v["tape"].toString();
        p.tape = tape == "new" ? 0 : tape == "old" ? 2 : 1;
        return p;
    }

    /** plugin/scripts/echo-reference.ts input(). */
    float referenceInput (int i, double fs)
    {
        const int burst = (int) jsRound (0.37 * fs), click = (int) jsRound (0.53 * fs);
        const double v = 0.4 * std::sin ((2 * juce::MathConstants<double>::pi * 220 * i) / fs) * std::exp (-(i % burst) / (0.05 * fs))
                         + (i % click == 0 ? 0.6 : 0);
        return (float) v;
    }
} // namespace

class EchoTests : public juce::UnitTest
{
public:
    EchoTests() : juce::UnitTest ("Tape echo", "dsp") {}

    void runTest() override
    {
        beginTest ("matches src/audio/echo/dsp.ts (echo-reference.json)");
        {
            juce::String err;
            const auto ref = parseJson (repoRoot().getChildFile ("plugin/source/tests/data/echo-reference.json").loadFileAsString(), err);
            expect (ref.has_value(), err);
            const int block = (int) (*ref)["block"], stride = (int) (*ref)["stride"];
            for (const auto& c : *(*ref)["cases"].getArray())
            {
                const double fs = (double) c["sampleRate"];
                const int frames = (int) c["frames"];
                const auto* changes = c["changes"].getArray();
                TapeEcho echo (fs);
                std::vector<float> x ((size_t) frames), l ((size_t) frames, 0.0f), r ((size_t) frames, 0.0f);
                for (int i = 0; i < frames; ++i)
                    x[(size_t) i] = referenceInput (i, fs);
                int next = 0;
                for (int o = 0; o < frames; o += block)
                {
                    while (next < changes->size() && (int) (*changes)[next]["at"] <= o)
                        echo.set (paramsFromJson ((*changes)[next++]["params"]));
                    const int n = std::min (block, frames - o);
                    echo.process (x.data() + o, l.data() + o, r.data() + o, n);
                }
                const auto* want = c["left"].getArray();
                double worst = 0;
                int k = 0;
                for (int i = 0; i < frames; i += stride, ++k)
                    worst = std::max (worst, std::abs ((double) l[(size_t) i] - (double) (*want)[k]));
                expectEquals (k, want->size());
                logMessage (c["name"].toString() + ": worst difference " + juce::String (worst, 9));
                expect (worst < 1e-4, c["name"].toString() + " differs by " + juce::String (worst));
            }
        }

        beginTest ("constants match src/ (generated/shared.json)");
        {
            const auto& e = sharedData()["echo"];
            for (int h = 0; h < 3; ++h)
                expectEquals ((double) e["headDelaysSec"][h], echo::headDelaysSec[(size_t) h]);
            expectEquals ((double) e["speedRatio"], echo::speedRatio);
            expectEquals ((double) e["slowTauSec"], echo::slowTauSec);
            expectEquals ((double) e["fastTauSec"], echo::fastTauSec);
            for (const auto& s : echoSyncs)
                expectWithinAbsoluteError ((double) e["syncs"][s.name], s.quarters, 1e-15);
            expectEquals ((int) e["controlFrames"], echo::controlFrames);
            expectEquals ((double) e["tapeLevel"], echo::tapeLevel);
            expectEquals ((double) e["intensityMaxGain"], echo::intensityMaxGain);
            expectEquals ((double) e["playbackRail"], echo::playbackRail);
            expectEquals ((double) e["inputRangeDb"], echo::inputRangeDb);
            expectEquals ((double) e["toneHz"], echo::toneHz);
            expectEquals ((double) e["toneRangeDb"], echo::toneRangeDb);
            expectEquals ((double) e["emphasisHz"], echo::emphasisHz);
            expectEquals ((double) e["emphasisDb"], echo::emphasisDb);
            expectEquals ((double) e["bumpHz"], echo::bumpHz);
            expectEquals ((double) e["bumpDb"], echo::bumpDb);
            expectEquals ((double) e["bumpQ"], echo::bumpQ);
            expectEquals ((double) e["wowHz"], echo::wowHz);
            expectEquals ((double) e["capstanHz"], echo::capstanHz);
            expectEquals ((double) e["rollerHz"], echo::rollerHz);
            for (size_t i = 0; i < 3; ++i)
            {
                expectEquals ((double) e["wear"]["wow"][(int) i], echo::wearWow[i]);
                expectEquals ((double) e["wear"]["capstan"][(int) i], echo::wearCapstan[i]);
                expectEquals ((double) e["wear"]["roller"][(int) i], echo::wearRoller[i]);
                expectEquals ((double) e["wear"]["lossHz"][(int) i], echo::wearLossHz[i]);
                expectEquals ((double) e["wear"]["hissDb"][(int) i], echo::wearHissDb[i]);
                expectEquals ((double) e["springDelaysSec"][(int) i], echo::springDelaysSec[i]);
            }
            expectEquals ((double) e["springTransitionHz"], echo::springTransitionHz);
            expectEquals ((int) e["springStages"], echo::springStages);
            expectEquals ((double) e["springAllpass"], echo::springAllpass);
            expectEquals ((double) e["springT60Sec"], echo::springT60Sec);
            expectEquals ((double) e["springLowCutHz"], echo::springLowCutHz);
            expectEquals ((double) e["springDampHz"], echo::springDampHz);
            expectEquals ((double) e["springLevel"], echo::springLevel);
        }

        beginTest ("mode selector table (RE-20 manual p. 18)");
        {
            for (int mode = 1; mode <= 12; ++mode)
            {
                const auto e = withMode ({}, mode);
                expectEquals (hardwareMode (e.heads, e.spring), mode);
            }
            expectEquals (hardwareMode ({ true, true, false }, false), 0);
            expectEquals (hardwareMode ({ false, false, false }, false), 0);
        }

        beginTest ("sync holds the earliest head on the note inside the motor range");
        {
            EchoState e;
            e.heads = { false, true, true };
            e.sync = 5; // 1/8
            expectWithinAbsoluteError (echo::headDelaysSec[1] / targetSpeed (e, 120), 0.25, 1e-12);
            e.sync = 8; // 1/4 at 60 BPM: past the slowest tape
            expectWithinAbsoluteError (targetSpeed (e, 60), 1 / echo::speedRatio, 1e-12);
        }

        beginTest ("pattern JSON keeps echo settings and sends");
        {
            PatternState p;
            p.id = "p";
            p.kitId = "k";
            p.kitRevision = "0123456789abcdef";
            TrackState t;
            t.slotId = "kick";
            t.sampleId = "s";
            t.echoSend = 0.25;
            p.tracks["kick"] = t;
            auto json = toPatternJson (p);
            expect (json["echo"].isVoid()); // defaults are omitted
            p.echo.on = true;
            p.echo.heads = { false, true, true };
            p.echo.spring = true;
            p.echo.sync = 7;
            p.echo.bass = 0.7;
            p.echo.tape = 2;
            json = toPatternJson (p);
            expectEquals (json["echo"]["sync"].toString(), juce::String ("1/8D"));
            expectEquals (json["echo"]["tape"].toString(), juce::String ("old"));
            expectEquals ((double) json["tracks"][0]["echoSend"], 0.25);
            juce::String err;
            const auto back = fromPatternJson (parseJson (juce::JSON::toString (json), err).value());
            expect (back.has_value());
            expect (back->echo == p.echo);
            expectEquals (back->tracks.at ("kick").echoSend, 0.25);
            expectWithinAbsoluteError (hitSend (*back, &back->tracks.at ("kick")), 0.0625, 1e-12);
        }

        beginTest ("voices send mono, after their gain, only when asked");
        {
            auto data = makeData (480, 48000, 0.5f, 2);
            DrumEngine e;
            e.prepare (48000);
            Hit h;
            h.data = data.get();
            h.when = 0;
            h.send = 0.5;
            e.trigger (h);
            Hit dry = h;
            dry.send = 0;
            e.trigger (dry);
            std::vector<float> l (256, 0.0f), r (256, 0.0f), s (256, 0.0f);
            e.renderVoices (l.data(), r.data(), s.data(), 256);
            e.finish (l.data(), r.data(), 256);
            // Two equal voices on the outputs, half of one on the send.
            expectWithinAbsoluteError (s[100], 0.25f * l[100], 1e-6f);
            e.killAll();
        }

        beginTest ("echo off lets the tails fade, then sleeps");
        {
            TapeEcho echo (48000);
            EchoDspParams p;
            p.on = true;
            p.heads = { true, true, true };
            p.intensity = 0.9;
            p.echo = 0.5;
            echo.set (p);
            std::vector<float> x (48000, 0.0f), l (48000), r (48000);
            x[0] = 0.5f;
            echo.process (x.data(), l.data(), r.data(), 48000);
            p.on = false;
            echo.set (p);
            x[0] = 0;
            int seconds = 0;
            while (! echo.idle() && seconds < 30)
            {
                echo.process (x.data(), l.data(), r.data(), 48000);
                ++seconds;
            }
            expect (echo.idle());
        }
    }
};

static EchoTests echoTests;
} // namespace drums::test
