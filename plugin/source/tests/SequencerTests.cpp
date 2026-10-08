// Step timing (host sync, free-run, swing, loops, jumps) and the realtime
// instrument: snapshots, kit swap at the bar, stop policy, MIDI and choke.
#include "TestUtil.h"
#include "core/Playback.h"
#include "core/StepSequencer.h"

namespace drums::test
{
namespace
{
    std::vector<StepEvent> run (StepSequencer& seq, double ppqStart, double bpm, double rate, int frames, int block,
                                const SequencerSettings& s, juce::int64 frameBase = 0)
    {
        std::vector<StepEvent> out;
        const double ppf = bpm / 60.0 / rate;
        for (int i = 0; i < frames; i += block)
        {
            const int n = std::min (block, frames - i);
            seq.process (ppqStart + i * ppf, ppf, n, s, [&] (StepEvent e)
            {
                e.offset += i + (int) frameBase;
                out.push_back (e);
            });
        }
        return out;
    }

    KitManifest testKit (const juce::String& id, const std::vector<juce::String>& slotIds)
    {
        KitManifest k;
        k.id = id;
        k.machineId = "test-machine";
        k.label = id;
        k.revision = "0123456789abcdef";
        int n = 0;
        for (const auto& sid : slotIds)
        {
            Sample s;
            s.id = id + "-s" + juce::String (n++);
            s.blobSha256 = juce::String::repeatedString ("0", 64);
            s.url = "media/audio/x.wav";
            s.bytes = 10;
            s.durationSec = 1;
            k.samples.push_back (s);
            Slot sl;
            sl.id = sid;
            sl.label = sid;
            sl.category = categoryForRole (sid);
            sl.icon = iconForRole (sid);
            sl.defaultSampleId = s.id;
            sl.sampleIds.add (s.id);
            k.slots.push_back (sl);
        }
        return k;
    }
} // namespace

class SequencerTests : public juce::UnitTest
{
public:
    SequencerTests() : juce::UnitTest ("Step sequencer", "sequencer") {}

    void runTest() override
    {
        constexpr double rate = 48000;
        SequencerSettings straight;

        beginTest ("straight 16ths at 120 BPM land on exact frames, one bar from ppq 0");
        {
            StepSequencer seq;
            seq.setSampleRate (rate);
            const auto ev = run (seq, 0, 120, rate, 96000, 512, straight);
            expectEquals ((int) ev.size(), 16);
            for (int i = 0; i < 16 && i < (int) ev.size(); ++i)
            {
                expectEquals (ev[(size_t) i].step, i);
                expectEquals (ev[(size_t) i].offset, i * 6000);
            }
        }

        beginTest ("block size does not change event frames");
        {
            StepSequencer a, b;
            a.setSampleRate (rate);
            b.setSampleRate (rate);
            const auto x = run (a, 0.37, 133, rate, 200000, 64, straight);
            const auto y = run (b, 0.37, 133, rate, 200000, 1013, straight);
            expectEquals (x.size(), y.size());
            for (size_t i = 0; i < std::min (x.size(), y.size()); ++i)
                expectEquals (x[i].offset, y[i].offset);
        }

        beginTest ("starting mid-bar picks up the grid in phase");
        {
            StepSequencer seq;
            seq.setSampleRate (rate);
            // ppq 1.1: the next step is index 5 (ppq 1.25) at 0.15 qn = 3600 frames at 120 BPM.
            const auto ev = run (seq, 1.1, 120, rate, 4000, 512, straight);
            expectEquals ((int) ev.size(), 1);
            expectEquals (ev[0].step, 5);
            expectEquals (ev[0].offset, 3600);
        }

        beginTest ("16th swing delays every second step; 8th swing the last two of four");
        {
            SequencerSettings s16;
            s16.swing = 66;
            StepSequencer seq;
            seq.setSampleRate (rate);
            const auto ev = run (seq, 0, 120, rate, 24000, 256, s16);
            expectEquals ((int) ev.size(), 4);
            expectEquals (ev[1].offset, (int) std::ceil (6000 * 66 / 50.0 - 1e-7));
            expectEquals (ev[2].offset, 12000);
            SequencerSettings s8;
            s8.swing = 60;
            s8.grid = 8;
            StepSequencer seq8;
            seq8.setSampleRate (rate);
            const auto e8 = run (seq8, 0, 120, rate, 24000, 256, s8);
            expectEquals ((int) e8.size(), 4);
            expectEquals (e8[1].offset, 7200);
            expectEquals (e8[2].offset, 14400);
            expectEquals (e8[3].offset, 14400 + 4800);
        }

        beginTest ("swing is latched per pair: a change mid-pair applies to the next pair");
        {
            StepSequencer seq;
            seq.setSampleRate (rate);
            SequencerSettings s;
            std::vector<StepEvent> ev;
            const double ppf = 120 / 60.0 / rate;
            for (int i = 0; i < 24000; i += 100)
            {
                s.swing = i < 3000 ? 50 : 75; // changes between step 0 and step 1
                seq.process (i * ppf, ppf, 100, s, [&] (StepEvent e) { e.offset += i; ev.push_back (e); });
            }
            expectEquals (ev[1].offset, 6000);  // pair 0 keeps 50
            expectEquals (ev[3].offset, 12000 + 9000); // pair 1 uses 75
        }

        beginTest ("8-step loop repeats steps 1-8 every half bar");
        {
            SequencerSettings s;
            s.length = 8;
            StepSequencer seq;
            seq.setSampleRate (rate);
            const auto ev = run (seq, 0, 120, rate, 96000, 512, s);
            expectEquals ((int) ev.size(), 16);
            expectEquals (ev[8].step, 0);
            expectEquals (ev[15].step, 7);
        }

        beginTest ("a jump re-seeks without bursting the skipped steps");
        {
            StepSequencer seq;
            seq.setSampleRate (rate);
            const double ppf = 120 / 60.0 / rate;
            std::vector<StepEvent> ev;
            const auto emit = [&] (const StepEvent& e) { ev.push_back (e); };
            seq.process (0, ppf, 512, straight, emit);
            expect (! seq.wouldJump (512 * ppf, ppf));
            expect (seq.wouldJump (3.0, ppf));
            const bool jumped = seq.process (3.0, ppf, 512, straight, emit); // host loop/jump to beat 4
            expect (jumped);
            expectEquals ((int) ev.size(), 2);
            expectEquals (ev[1].step, 12);
            expectEquals (ev[1].offset, 0);
        }

        beginTest ("tempo change applies from the next block without drift on the grid");
        {
            StepSequencer seq;
            seq.setSampleRate (rate);
            std::vector<StepEvent> ev;
            double ppq = 0;
            for (int i = 0; i < 400; ++i)
            {
                const double bpm = i < 100 ? 120 : 90;
                const double ppf = bpm / 60.0 / rate;
                seq.process (ppq, ppf, 480, straight, [&] (const StepEvent& e) { ev.push_back (e); });
                ppq += ppf * 480;
            }
            for (size_t i = 0; i < ev.size(); ++i)
                expectWithinAbsoluteError (ev[i].ppq, (double) ev[i].index * 0.25, 1e-9);
        }

        beginTest ("negative ppq (pre-roll) maps to steps on the same grid");
        {
            StepSequencer seq;
            seq.setSampleRate (rate);
            const auto ev = run (seq, -1.0, 120, rate, 24000, 512, straight);
            expectEquals ((int) ev.size(), 4);
            expectEquals (ev[0].step, 12);
            expectEquals (ev[0].offset, 0);
        }
    }
};

class InstrumentTests : public juce::UnitTest
{
public:
    InstrumentTests() : juce::UnitTest ("Realtime instrument", "sequencer") {}

    struct Rig
    {
        Instrument inst;
        LiveParams params;
        HostPosition host;
        juce::MidiBuffer midi;
        std::vector<float> l, r;
        double rate;

        explicit Rig (double sr = 48000) : rate (sr)
        {
            inst.prepare (sr, 512);
            params.hostSync = true;
        }

        void render (int frames, int block = 512)
        {
            const size_t base = l.size();
            l.resize (base + (size_t) frames, 0.0f);
            r.resize (base + (size_t) frames, 0.0f);
            for (int i = 0; i < frames; i += block)
            {
                const int n = std::min (block, frames - i);
                inst.process (l.data() + base + i, r.data() + base + i, n, host, params, midi);
                midi.clear();
                if (host.valid && host.playing)
                    host.ppq += host.bpm / 60.0 / rate * n;
            }
        }
    };

    void runTest() override
    {
        const auto kitA = testKit ("kit-a", { "kick", "snare", "hat-closed", "hat-open" });
        const auto kitB = testKit ("kit-b", { "kick", "clap" });
        const auto impulse = makeData (64, 48000, 1.0f, 1, true);
        const auto longDc = makeData (48000, 48000, 0.2f);
        const auto dataFor = [&] (const Sample& s) -> SamplePtr
        {
            return s.id.endsWith ("s3") ? SamplePtr (longDc) : SamplePtr (impulse);
        };

        beginTest ("host-synced bar plays each slot's steps at exact frames");
        {
            Rig rig;
            auto p = newPatternState (kitA, "p");
            for (int s : { 0, 4, 8, 12 })
                p.tracks["kick"].stepsOn[(size_t) s] = true;
            p.tracks["snare"].stepsOn[4] = true;
            rig.inst.snapshots().publish (buildSnapshot (p, kitA, 1, buildMidiMap (kitA), dataFor, false));
            rig.host = { true, true, true, 0.0, 120.0 };
            rig.render (96000);
            const auto got = onsets (rig.l.data(), (int) rig.l.size());
            expectEquals ((int) got.size(), 4);
            for (size_t i = 0; i < got.size(); ++i)
                expectEquals (got[i], (int) i * 24000);
            // Kick + snare on step 4 at the same frame.
            expectWithinAbsoluteError ((double) rig.l[24000], 2 * dbToGain (-12), 1e-5);
            expect (rig.inst.playing.load() && rig.inst.followingHost.load());
        }

        beginTest ("host stop cancels queued hits and lets tails ring; ON/OFF stop fades");
        {
            Rig rig;
            auto p = newPatternState (kitA, "p");
            p.tracks["hat-open"].stepsOn[0] = true;
            rig.inst.snapshots().publish (buildSnapshot (p, kitA, 1, buildMidiMap (kitA), dataFor, false));
            rig.host = { true, true, true, 0.0, 120.0 };
            rig.render (4096);
            rig.host.playing = false;
            rig.render (4096);
            expect (std::abs (rig.l[8000]) > 0.01f, "tail rings after host stop");

            Rig free;
            free.params.hostSync = false;
            free.params.run = true;
            free.params.bpm = 120;
            free.inst.snapshots().publish (buildSnapshot (p, kitA, 1, buildMidiMap (kitA), dataFor, false));
            free.render (4096);
            free.params.run = false;
            free.render (4096);
            expect (std::abs (free.l[4096 + 1000]) < 1e-6f, "ON/OFF stop fades within 5 ms");
        }

        beginTest ("tempo HOST: ON/OFF with the host stopped runs at the host's tempo; FREE ignores the host");
        {
            auto p = newPatternState (kitA, "p");
            p.tracks["kick"].stepsOn[0] = p.tracks["kick"].stepsOn[4] = true;
            Rig rig;
            rig.inst.snapshots().publish (buildSnapshot (p, kitA, 1, buildMidiMap (kitA), dataFor, false));
            rig.host = { false, false, true, 0.0, 60.0 }; // host stopped, reports 60 BPM
            rig.params.hostSync = true;
            rig.params.run = true;
            rig.params.bpm = 120;
            rig.render (60000);
            auto got = onsets (rig.l.data(), (int) rig.l.size());
            expect (got.size() >= 2 && got[1] - got[0] == 48000, "step 5 one beat later at 60 BPM");
            expectWithinAbsoluteError (rig.inst.hostTempo.load(), 60.0, 1e-9);

            Rig free;
            free.inst.snapshots().publish (buildSnapshot (p, kitA, 1, buildMidiMap (kitA), dataFor, false));
            free.host = { true, true, true, 3.3, 60.0 }; // host playing elsewhere in the bar
            free.params.hostSync = false;
            free.params.run = true;
            free.params.bpm = 120;
            free.render (30000);
            got = onsets (free.l.data(), (int) free.l.size());
            expect (got.size() >= 2 && got[0] == 0 && got[1] - got[0] == 24000, "starts at its own step 1, 120 BPM");
            expect (! free.inst.followingHost.load());
        }

        beginTest ("kit switch while playing commits at the next step 1");
        {
            Rig rig;
            auto p = newPatternState (kitA, "p");
            p.tracks["kick"].stepsOn[0] = true;
            rig.inst.snapshots().publish (buildSnapshot (p, kitA, 1, buildMidiMap (kitA), dataFor, false));
            rig.host = { true, true, true, 0.0, 120.0 };
            rig.render (30000);
            auto pb = bindKit (p, kitB);
            rig.inst.snapshots().publish (buildSnapshot (pb, kitB, 2, buildMidiMap (kitB), dataFor, true));
            rig.render (30000); // still in bar 1: kit A stays
            expectEquals ((int) rig.inst.committedKitTag.load(), 1);
            rig.render (40000); // crosses ppq 4
            expectEquals ((int) rig.inst.committedKitTag.load(), 2);
            rig.inst.snapshots().collect();
        }

        beginTest ("MIDI notes trigger slots at their sample offsets with velocity as level squared");
        {
            Rig rig;
            auto p = newPatternState (kitA, "p");
            rig.inst.snapshots().publish (buildSnapshot (p, kitA, 1, buildMidiMap (kitA), dataFor, false));
            rig.midi.addEvent (juce::MidiMessage::noteOn (10, 38, (juce::uint8) 64), 100);
            rig.render (512);
            const auto got = onsets (rig.l.data(), 512);
            expectEquals ((int) got.size(), 1);
            expectEquals (got[0], 100);
            const double level = 64.0 / 127.0;
            expectWithinAbsoluteError ((double) rig.l[100], level * level * dbToGain (-12), 1e-5);
        }

        beginTest ("closed hat from the sequencer chokes an open hat from MIDI");
        {
            Rig rig;
            auto p = newPatternState (kitA, "p");
            p.tracks["hat-closed"].stepsOn[2] = true;
            rig.inst.snapshots().publish (buildSnapshot (p, kitA, 1, buildMidiMap (kitA), dataFor, false));
            rig.midi.addEvent (juce::MidiMessage::noteOn (10, 46, 1.0f), 0); // open hat (long)
            rig.host = { true, true, true, 0.0, 120.0 };
            rig.render (20000);
            expect (std::abs (rig.l[11000]) > 0.01f);
            expect (std::abs (rig.l[12400]) < 1e-6f);
        }

        beginTest ("pad gain parameters override track gain; off is silent");
        {
            Rig rig;
            auto p = newPatternState (kitA, "p");
            p.tracks["kick"].stepsOn[0] = true;
            rig.inst.snapshots().publish (buildSnapshot (p, kitA, 1, buildMidiMap (kitA), dataFor, false));
            rig.params.padGainDb[0] = -6;
            rig.host = { true, true, true, 0.0, 120.0 };
            rig.render (512);
            expectWithinAbsoluteError ((double) rig.l[0], dbToGain (-18), 1e-5);
            Rig off;
            off.inst.snapshots().publish (buildSnapshot (p, kitA, 1, buildMidiMap (kitA), dataFor, false));
            off.params.padGainDb[0] = -INFINITY;
            off.host = { true, true, true, 0.0, 120.0 };
            off.render (512);
            expectEquals (off.l[0], 0.0f);
        }

        beginTest ("auditions play the current kit at once; stale kit auditions are dropped");
        {
            Rig rig;
            auto p = newPatternState (kitA, "p");
            rig.inst.snapshots().publish (buildSnapshot (p, kitA, 1, buildMidiMap (kitA), dataFor, false));
            rig.render (512);
            rig.inst.queueAudition ({ 1, -1, 1 });
            rig.inst.queueAudition ({ 1, -1, 99 });
            rig.render (512);
            expectEquals ((int) onsets (rig.l.data(), (int) rig.l.size()).size(), 1);
        }

        beginTest ("circuit jitter delays whole steps within the measured maximum");
        {
            auto kit909 = testKit ("kit-909", { "kick" });
            kit909.machineId = "roland-tr-909";
            auto p = newPatternState (kit909, "p");
            p.circuit = true;
            for (int s = 0; s < 16; ++s)
                p.tracks["kick"].stepsOn[(size_t) s] = true;
            Rig rig;
            rig.inst.setJitterSeed (3);
            rig.inst.snapshots().publish (buildSnapshot (p, kit909, 1, buildMidiMap (kit909), dataFor, false));
            rig.host = { true, true, true, 0.0, 120.0 };
            rig.render (96000);
            const auto got = onsets (rig.l.data(), (int) rig.l.size());
            expectEquals ((int) got.size(), 16);
            int maxLate = 0;
            for (size_t i = 0; i < got.size(); ++i)
            {
                const int late = got[i] - (int) i * 6000;
                expect (late >= 0);
                maxLate = std::max (maxLate, late);
            }
            expect (maxLate <= (int) std::ceil (0.00446 * 48000) + 1, juce::String (maxLate));
            expect (maxLate > 0);
        }

        beginTest ("missing sample data leaves the slot silent");
        {
            Rig rig;
            auto p = newPatternState (kitA, "p");
            p.tracks["kick"].stepsOn[0] = true;
            rig.inst.snapshots().publish (buildSnapshot (p, kitA, 1, buildMidiMap (kitA), [] (const Sample&) { return SamplePtr(); }, false));
            rig.host = { true, true, true, 0.0, 120.0 };
            rig.render (4096);
            expectEquals ((int) onsets (rig.l.data(), 4096).size(), 0);
        }

        beginTest ("retired snapshots are freed only after the audio thread lets go");
        {
            Rig rig;
            auto p = newPatternState (kitA, "p");
            auto first = buildSnapshot (p, kitA, 1, buildMidiMap (kitA), dataFor, false);
            std::weak_ptr<const PlaybackSnapshot> weakFirst = first;
            rig.inst.snapshots().publish (std::move (first));
            rig.render (512); // audio now holds the first snapshot as current
            rig.inst.snapshots().publish (buildSnapshot (p, kitA, 1, buildMidiMap (kitA), dataFor, false));
            rig.inst.snapshots().collect();
            expect (! weakFirst.expired(), "still current on the audio thread");
            rig.render (512);
            rig.inst.snapshots().collect();
            expect (weakFirst.expired(), "freed after the audio thread moved on");
        }
    }
};

static SequencerTests sequencerTests;
static InstrumentTests instrumentTests;
} // namespace drums::test
