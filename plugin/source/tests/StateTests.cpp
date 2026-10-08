// Session state, project restore, missing-library recovery, presets, stores
// and exports.
#include "TestUtil.h"
#include "core/Importer.h"
#include "core/Json.h"
#include "core/Render.h"
#include "core/Session.h"
#include "core/Stores.h"

#include <deque>

namespace drums::test
{
namespace
{
    /** Message-thread stand-in: posted work runs when the test drains the queue. */
    struct Queue
    {
        std::mutex m;
        std::deque<std::function<void()>> q;
        Session::Post post()
        {
            return [this] (std::function<void()> f)
            {
                std::lock_guard lock (m);
                q.push_back (std::move (f));
            };
        }
        void drainUntil (const std::function<bool()>& done, int timeoutMs = 10000)
        {
            const auto until = juce::Time::getMillisecondCounter() + (juce::uint32) timeoutMs;
            while (! done() && juce::Time::getMillisecondCounter() < until)
            {
                std::function<void()> f;
                {
                    std::lock_guard lock (m);
                    if (! q.empty())
                    {
                        f = std::move (q.front());
                        q.pop_front();
                    }
                }
                if (f)
                    f();
                else
                    juce::Thread::sleep (1);
            }
        }
    };

    struct Fixture
    {
        TempDir tmp;
        std::unique_ptr<LibraryManager> libs;
        juce::String libId, kitId;
        std::map<juce::String, juce::String> sha;

        Fixture()
        {
            const auto src = tmp.dir.getChildFile ("src");
            writeTone (src.getChildFile ("kick.wav"), 48000, 1, 0.3, 60, 0.9);
            writeTone (src.getChildFile ("snare.wav"), 48000, 1, 0.3, 200, 0.7);
            writeTone (src.getChildFile ("snare b.wav"), 48000, 1, 0.3, 230, 0.7);
            writeTone (src.getChildFile ("closed hat.wav"), 48000, 1, 0.1, 6000, 0.4);
            writeTone (src.getChildFile ("open hat.wav"), 48000, 1, 0.8, 7000, 0.4);
            libs = std::make_unique<LibraryManager> (tmp.dir.getChildFile ("data"), std::vector<juce::File> {});
            juce::String error;
            libId = libs->createUserLibrary ("Test Library", error);
            const auto out = importSamples (*libs, libId, scanForAudio ({ src }).candidates);
            for (const auto& s : out.imported)
                sha[s.name] = s.sha256;
            KitDraft d;
            d.label = "Test Kit";
            d.slots.push_back ({ {}, "kick", "", { sha["kick"] }, {} });
            d.slots.push_back ({ {}, "snare", "", { sha["snare"], sha["snare b"] }, {} });
            d.slots.push_back ({ {}, "hat-closed", "", { sha["closed hat"] }, {} });
            d.slots.push_back ({ {}, "hat-open", "", { sha["open hat"] }, {} });
            kitId = saveKit (*libs, libId, d, error);
        }
    };
} // namespace

class SessionTests : public juce::UnitTest
{
public:
    SessionTests() : juce::UnitTest ("Session and project state", "state") {}

    void runTest() override
    {
        Fixture fx;
        Queue queue;
        SampleStore store;
        store.setTargetRate (48000);
        Instrument inst;
        inst.prepare (48000, 512);

        beginTest ("selecting a kit loads its chosen samples and publishes playback");
        Session session (*fx.libs, store, inst, queue.post());
        int changes = 0;
        session.addListener ([&] { ++changes; });
        bool finished = false, ok = false;
        session.selectKit (fx.libId, fx.kitId, [&] (bool success, const juce::String&) { finished = true; ok = success; });
        expect (session.status() == KitStatus::loading);
        queue.drainUntil ([&] { return finished; });
        expect (ok);
        expect (session.status() == KitStatus::ready);
        expect (changes > 0);
        expectEquals (session.reference().libraryId, fx.libId);
        expectEquals (session.reference().kitId, fx.kitId);
        expectEquals ((int) session.pattern().tracks.size(), 4);
        const auto snap = inst.snapshots().latest();
        expect (snap != nullptr && snap->slots.size() == 4 && snap->slots[0].sample != nullptr);
        // Only the default variant of the snare was loaded.
        const auto& kit = *session.kit();
        expect (session.isSampleReady (kit.slots[1].sampleIds[0]));
        expect (! session.isSampleReady (kit.slots[1].sampleIds[1]));

        beginTest ("a variant is prepared before the pattern switches to it");
        finished = false;
        session.prepareSample (kit.slots[1].sampleIds[1], [&] (bool success, const juce::String&) { finished = true; ok = success; });
        queue.drainUntil ([&] { return finished; });
        expect (ok && session.isSampleReady (kit.slots[1].sampleIds[1]));
        auto p = session.pattern();
        p.tracks["snare"].sampleId = kit.slots[1].sampleIds[1];
        p.tracks["kick"].stepsOn[0] = true;
        p.swing = 60;
        session.setPattern (p);
        expectEquals (inst.snapshots().latest()->slots[1].sample->sha256, fx.sha["snare b"]);

        beginTest ("project state round-trips into a new instance");
        session.setMidiNote ("snare", 40);
        session.setDraftMeta (true, "snare");
        const auto state = session.toStateJson();
        const auto stateText = juce::JSON::toString (state);
        Instrument inst2;
        inst2.prepare (48000, 512);
        SampleStore store2;
        store2.setTargetRate (48000);
        Session restored (*fx.libs, store2, inst2, queue.post());
        finished = false;
        restored.restoreStateJson (juce::JSON::parse (stateText), [&] (bool success, const juce::String&) { finished = true; ok = success; });
        queue.drainUntil ([&] { return finished; });
        expect (ok);
        const auto sameMusic = [] (PatternState a, PatternState b) { a.updatedAt = b.updatedAt = {}; return a == b; };
        expect (sameMusic (restored.pattern(), session.pattern()));
        expectEquals (restored.selectedSlot(), juce::String ("snare"));
        expect (restored.savedFlag());
        expectEquals (restored.midiMap().noteFor ("snare"), 40);
        expect (restored.isSampleReady (kit.slots[1].sampleIds[1]), "the pattern's variant is loaded on restore");

        beginTest ("a missing library keeps the pattern and reference; locating it recovers");
        TempDir elsewhere;
        LibraryManager emptyLibs (elsewhere.dir.getChildFile ("data"), {});
        Instrument inst3;
        inst3.prepare (48000, 512);
        SampleStore store3;
        Session lost (emptyLibs, store3, inst3, queue.post());
        finished = false;
        lost.restoreStateJson (juce::JSON::parse (stateText), [&] (bool success, const juce::String&) { finished = true; ok = success; });
        queue.drainUntil ([&] { return finished; });
        expect (! ok);
        expect (lost.status() == KitStatus::missing);
        expect (lost.error().contains ("Test Kit") && lost.error().contains ("Test Library"), lost.error());
        expect (sameMusic (lost.pattern(), session.pattern()), "pattern and sample ids preserved");
        expect (inst3.snapshots().latest() == nullptr, "nothing else is bound");
        // A re-saved project still names the original library and kit.
        const auto resaved = lost.toStateJson();
        expectEquals (resaved["library"]["libraryId"].toString(), fx.libId);
        juce::String error;
        expectEquals (emptyLibs.addCatalog (fx.libs->get (fx.libId, error)->record().root, error), fx.libId);
        finished = false;
        lost.retryMissing ([&] (bool success, const juce::String&) { finished = true; ok = success; });
        queue.drainUntil ([&] { return finished; });
        expect (ok && lost.status() == KitStatus::ready);

        beginTest ("re-selecting the playing kit loads nothing; superseded requests are ignored");
        finished = false;
        session.selectKit (fx.libId, fx.kitId, [&] (bool success, const juce::String&) { finished = true; ok = success; });
        expect (finished && ok, "answered at once");
        KitDraft alt;
        alt.label = "Alt Kit";
        alt.slots.push_back ({ {}, "kick", "", { fx.sha["snare"] }, {} });
        juce::String altError;
        const auto altId = saveKit (*fx.libs, fx.libId, alt, altError);
        expect (altId.isNotEmpty(), altError);
        int completions = 0, successes = 0;
        juce::String last;
        session.selectKit (fx.libId, altId, [&] (bool s, const juce::String&) { ++completions; successes += s ? 1 : 0; });
        session.selectKit (fx.libId, fx.kitId, [&] (bool s, const juce::String&) { ++completions; successes += s ? 1 : 0; });
        queue.drainUntil ([&] { return completions == 2; });
        expectEquals (successes, 1);
        expectEquals (session.kit()->id, fx.kitId);

        beginTest ("projects and presets saved before the rename (drums-* formats) still load");
        {
            auto legacy = juce::JSON::parse (stateText);
            setProp (legacy, "format", "drums-plugin-state");
            Instrument instL;
            instL.prepare (48000, 512);
            SampleStore storeL;
            Session old (*fx.libs, storeL, instL, queue.post());
            finished = false;
            old.restoreStateJson (legacy, [&] (bool success, const juce::String&) { finished = true; ok = success; });
            queue.drainUntil ([&] { return finished; });
            expect (ok, "legacy project state loads");
            expectEquals (old.toStateJson()["format"].toString(), juce::String ("vdvm-plugin-state"));
            auto legacyPreset = session.toPresetJson();
            setProp (legacyPreset, "format", "drums-preset");
            juce::String presetError;
            finished = false;
            expect (old.loadPresetJson (legacyPreset, presetError, [&] (bool, const juce::String&) { finished = true; }), presetError);
            queue.drainUntil ([&] { return finished; });
        }

        beginTest ("presets carry the pattern, kit reference and MIDI overrides");
        const auto preset = session.toPresetJson();
        Instrument inst4;
        inst4.prepare (48000, 512);
        SampleStore store4;
        Session other (*fx.libs, store4, inst4, queue.post());
        finished = false;
        expect (other.loadPresetJson (preset, error, [&] (bool success, const juce::String&) { finished = true; ok = success; }), error);
        queue.drainUntil ([&] { return finished; });
        expect (ok);
        expectEquals (other.pattern().swing, 60);
        expectEquals (other.midiMap().noteFor ("snare"), 40);
        expect (! other.loadPresetJson (juce::JSON::parse ("{\"format\":\"x\"}"), error));

        beginTest ("unknown kit id fails without dropping the current kit");
        finished = false;
        session.selectKit (fx.libId, "no-such-kit", [&] (bool success, const juce::String&) { finished = true; ok = success; });
        expect (finished && ! ok);
        expect (session.kit().has_value() && session.status() == KitStatus::ready);

        session.collectGarbage();
    }
};

class StoreTests : public juce::UnitTest
{
public:
    StoreTests() : juce::UnitTest ("Pattern and preference files", "state") {}

    void runTest() override
    {
        TempDir tmp;
        beginTest ("patterns: put, replace, list newest first, delete");
        PatternStore patterns (tmp.dir.getChildFile ("Patterns/patterns.json"));
        PatternState a;
        a.id = "a";
        a.kitId = "k";
        a.kitRevision = "0123456789abcdef";
        a.updatedAt = "2026-10-01T00:00:00.000Z";
        auto b = a;
        b.id = "b";
        b.updatedAt = "2026-10-02T00:00:00.000Z";
        expect (patterns.put (toPatternJson (a)));
        expect (patterns.put (toPatternJson (b)));
        a.name = "RENAMED";
        a.updatedAt = "2026-10-03T00:00:00.000Z";
        expect (patterns.put (toPatternJson (a)));
        auto list = patterns.list();
        expectEquals (list.size(), 2);
        expectEquals (list[0]["name"].toString(), juce::String ("RENAMED"));
        expect (! patterns.put (juce::JSON::parse ("{\"id\":1}")));
        expect (patterns.remove ("a"));
        expectEquals (patterns.list().size(), 1);

        beginTest ("a damaged file is kept aside, not overwritten");
        const auto f = tmp.dir.getChildFile ("prefs.json");
        f.replaceWithText ("{not json");
        PrefsStore prefs (f);
        expect (prefs.get().getDynamicObject() != nullptr);
        expectEquals (tmp.dir.getNumberOfChildFiles (juce::File::findFiles, "prefs.damaged-*"), 1);
        auto patch = makeObject();
        setProp (patch, "outputDb", -3.5);
        expect (prefs.merge (patch));
        expectEquals ((double) prefs.get()["outputDb"], -3.5);
    }
};

class ExportTests : public juce::UnitTest
{
public:
    ExportTests() : juce::UnitTest ("WAV and MIDI export", "state") {}

    void runTest() override
    {
        Fixture fx;
        juce::String error;
        auto lib = fx.libs->get (fx.libId, error);
        const auto kit = *lib->loadKit (fx.kitId, error);
        auto p = newPatternState (kit, "p");
        p.bpm = 120;
        for (int s : { 0, 4, 8, 12 })
            p.tracks["kick"].stepsOn[(size_t) s] = true;
        p.tracks["hat-open"].stepsOn[2] = true;
        p.tracks["hat-closed"].stepsOn[3] = true;
        p.tracks["snare"].stepsOn[4] = true;
        p.tracks["snare"].levels[4] = 0.5;
        const SampleSource source = [&] (const Sample& s) { return decodeAudioFile (*lib->sampleFile (s), s.blobSha256); };

        beginTest ("one loop plus tail at 44.1 kHz with onsets on the step grid");
        const auto audio = renderLoop (p, kit, source, error);
        expect (error.isEmpty(), error);
        const double loop = 16 * 60.0 / 120 / 4;
        expectWithinAbsoluteError (audio.getNumSamples() / 44100.0, loop + 0.8, 0.01); // tail = the longest sample (open hat)
        const auto got = onsets (audio.getReadPointer (0), audio.getNumSamples(), 1.0e-3f);
        expect (! got.empty() && got[0] <= 4);
        // Closed hat at step 3 chokes the open hat from step 2: nothing of the open hat after step 3 + 5 ms
        // except the closed hat itself (0.1 s) and the snare/kick at step 4.
        const int step3 = (int) std::lround (3 * 0.125 * 44100);
        const int quietFrom = step3 + (int) (0.1 * 44100) + 300;
        const int step4 = (int) std::lround (4 * 0.125 * 44100);
        float residue = 0;
        for (int i = quietFrom; i < step4; ++i)
            residue = std::max (residue, std::abs (audio.getSample (0, i)));
        expect (residue < 1.0e-4f, juce::String (residue));

        beginTest ("WAV bytes: 16-bit stereo PCM header the catalog reader accepts");
        const auto wav = wavBytes (audio, 44100);
        juce::String wavError;
        const auto info = readWavInfo (wav.getData(), wav.getSize(), wavError);
        expect (info && info->channels == 2 && info->sampleRate == 44100 && info->bitsPerSample == 16 && info->frames == audio.getNumSamples());

        beginTest ("MIDI: type 0, 480 PPQ, unique notes from the map, velocity 127 x level");
        const auto map = buildMidiMap (kit, { { "snare", 40 } });
        const auto midi = midiFileBytes (p, kit, map);
        juce::MemoryInputStream in (midi, false);
        juce::MidiFile file;
        expect (file.readFrom (in));
        expectEquals (file.getTimeFormat(), (short) 480);
        const auto* track = file.getTrack (0);
        int notes = 0;
        int snareVelocity = -1;
        for (const auto* e : *track)
        {
            if (! e->message.isNoteOn())
                continue;
            ++notes;
            expectEquals (e->message.getChannel(), 10);
            if (e->message.getNoteNumber() == 40)
                snareVelocity = e->message.getVelocity();
        }
        expectEquals (notes, 7);
        expectEquals (snareVelocity, 64); // level 0.5 -> 127 * 0.5 (amplitude 0.25 both ways)
        expectEquals (track->getEndTime(), 1920.0);
    }
};

static SessionTests sessionTests;
static StoreTests storeTests;
static ExportTests exportTests;
} // namespace drums::test
