// Contract parity: canonical JSON and revisions match the TypeScript build,
// the reference checks match src/contract/semantic.ts, and the constants match
// the browser source via generated/shared.json.
#include "TestUtil.h"
#include "core/Constants.h"
#include "core/Contract.h"
#include "core/Json.h"
#include "core/MidiMap.h"
#include "core/Pattern.h"
#include "core/Timing.h"

namespace drums::test
{
class JsonTests : public juce::UnitTest
{
public:
    JsonTests() : juce::UnitTest ("JSON and canonical encoding", "contract") {}

    void runTest() override
    {
        beginTest ("numbers print like JavaScript");
        expectEquals (juce::String (jsNumber (0.0)), juce::String ("0"));
        expectEquals (juce::String (jsNumber (-0.0)), juce::String ("0"));
        expectEquals (juce::String (jsNumber (1.0)), juce::String ("1"));
        expectEquals (juce::String (jsNumber (44100.0)), juce::String ("44100"));
        expectEquals (juce::String (jsNumber (0.1)), juce::String ("0.1"));
        expectEquals (juce::String (jsNumber (-3.25)), juce::String ("-3.25"));
        expectEquals (juce::String (jsNumber (1e21)), juce::String ("1e+21"));
        expectEquals (juce::String (jsNumber (1e-7)), juce::String ("1e-7"));
        expectEquals (juce::String (jsNumber (1.5e-7)), juce::String ("1.5e-7"));
        expectEquals (juce::String (jsNumber (0.000001)), juce::String ("0.000001"));
        expectEquals (juce::String (jsNumber (123456789012345680000.0)), juce::String ("123456789012345680000"));
        expectEquals (juce::String (jsNumber (0.30000000000000004)), juce::String ("0.30000000000000004"));
        expectEquals (juce::String (jsNumber (2.0 / 3.0)), juce::String ("0.6666666666666666"));

        beginTest ("strings quote like JSON.stringify");
        expectEquals (juce::String (jsQuote ("a\"b\\c\n\t\x01")), juce::String ("\"a\\\"b\\\\c\\n\\t\\u0001\""));
        expectEquals (juce::String::fromUTF8 (jsQuote (juce::String::fromUTF8 ("Ace — x")).c_str()),
                      juce::String::fromUTF8 ("\"Ace — x\""));

        beginTest ("canonical JSON sorts keys, keeps arrays, drops root revision only");
        juce::String err;
        const auto v = parseJson (R"({"revision":"x","b":[3,1,{"z":null,"a":true}],"a":{"revision":"keep","c":1.5}})", err);
        expect (v.has_value());
        expectEquals (juce::String (canonicalJson (*v)),
                      juce::String (R"({"a":{"c":1.5,"revision":"keep"},"b":[3,1,{"a":true,"z":null}]})"));

        beginTest ("revisions of the curated catalog match the TypeScript build");
        if (! hasCuratedCatalog())
        {
            logMessage ("skipped: public/catalog not built (npm run catalog:prepare)");
            return;
        }
        const auto root = repoRoot().getChildFile ("public");
        const auto indexJson = parseJson (root.getChildFile ("catalog/index.json").loadFileAsString(), err);
        expect (indexJson.has_value(), err);
        expectEquals (revisionOf (*indexJson), (*indexJson)["revision"].toString());
        int checked = 0, mismatched = 0;
        for (const auto& entry : *(*indexJson)["kits"].getArray())
        {
            const auto file = root.getChildFile (entry["url"].toString());
            const auto kit = parseJson (file.loadFileAsString(), err);
            if (! kit)
            {
                ++mismatched;
                continue;
            }
            ++checked;
            if (revisionOf (*kit) != (*kit)["revision"].toString())
            {
                ++mismatched;
                logMessage ("revision mismatch: " + file.getFullPathName());
            }
        }
        logMessage ("kit revisions checked: " + juce::String (checked));
        expect (checked > 100);
        expectEquals (mismatched, 0);
    }
};

class ContractTests : public juce::UnitTest
{
public:
    ContractTests() : juce::UnitTest ("Catalog contract", "contract") {}

    void runTest() override
    {
        beginTest ("safe relative URLs");
        expect (isSafeRelativeUrl ("media/audio/abc.wav"));
        expect (isSafeRelativeUrl ("catalog/index.json"));
        expect (! isSafeRelativeUrl ("/abs"));
        expect (! isSafeRelativeUrl ("a/../b"));
        expect (! isSafeRelativeUrl ("./a"));
        expect (! isSafeRelativeUrl ("a//b"));
        expect (! isSafeRelativeUrl ("a\\b"));
        expect (! isSafeRelativeUrl ("http://x"));
        expect (! isSafeRelativeUrl ("a b.wav"));
        expect (! isSafeRelativeUrl (""));

        beginTest ("ids");
        expect (isValidId ("hat-closed"));
        expect (isValidId ("linn-linndrum-main"));
        expect (! isValidId ("Hat"));
        expect (! isValidId ("a--b"));
        expect (! isValidId ("-a"));

        beginTest ("resolveUnder refuses escapes, including symlinks");
        TempDir tmp;
        const auto root = tmp.dir.getChildFile ("lib");
        root.getChildFile ("media/audio").createDirectory();
        root.getChildFile ("media/audio/ok.wav").replaceWithText ("x");
        tmp.dir.getChildFile ("outside.wav").replaceWithText ("secret");
        expect (resolveUnder (root, "media/audio/ok.wav").has_value());
        expect (! resolveUnder (root, "../outside.wav").has_value());
        tmp.dir.getChildFile ("outside.wav").createSymbolicLink (root.getChildFile ("media/audio/link.wav"), true);
        expect (! resolveUnder (root, "media/audio/link.wav").has_value(), "symlink escaping the root must be refused");
        tmp.dir.getChildFile ("elsewhere").createDirectory();
        tmp.dir.getChildFile ("elsewhere").createSymbolicLink (root.getChildFile ("media/dir"), true);
        expect (! resolveUnder (root, "media/dir/x.wav").has_value(), "symlinked directory escaping the root must be refused");

        beginTest ("redirects follow chains and detect cycles");
        RedirectMap m { { "a", "b" }, { "b", "c" } };
        expectEquals (*resolveRedirect (m, "a"), juce::String ("c"));
        expectEquals (*resolveRedirect (m, "z"), juce::String ("z"));
        RedirectMap cyc { { "a", "b" }, { "b", "a" } };
        expect (! resolveRedirect (cyc, "a").has_value());

        beginTest ("kit reference checks match semantic.ts messages");
        juce::String err;
        const auto json = parseJson (R"({"schemaVersion":1,"id":"k","machineId":"m","label":"K","revision":"0123456789abcdef",
            "slots":[{"id":"kick","label":"Kick","category":"kick","icon":"kick","defaultSampleId":"s2","sampleIds":["s1"],"chokeGroup":null,"gainDb":0}],
            "samples":[{"id":"s1","blobSha256":"0000000000000000000000000000000000000000000000000000000000000000","url":"media/audio/a.wav","bytes":10,"durationSec":0.5,"channels":1,"sampleRate":44100,"gainDb":0,"peakDbfs":null},
                       {"id":"s3","blobSha256":"0000000000000000000000000000000000000000000000000000000000000000","url":"media/audio/b.wav","bytes":10,"durationSec":0.5,"channels":1,"sampleRate":44100,"gainDb":0,"peakDbfs":-1}]})", err);
        juce::StringArray errors;
        const auto kit = parseKit (*json, errors);
        expect (kit.has_value(), errors.joinIntoString ("; "));
        const auto problems = checkKit (*kit);
        expect (problems.contains ("kit k: slot kick default s2 not in sampleIds"));
        expect (problems.contains ("kit k: sample s3 not used by any slot"));

        beginTest ("unsupported schema version is refused");
        juce::StringArray e2;
        expect (! parseKit (*parseJson (R"({"schemaVersion":2})", err), e2).has_value());
        expect (e2[0].contains ("not supported"));

        beginTest ("curated index and every kit parse and pass reference checks");
        if (! hasCuratedCatalog())
        {
            logMessage ("skipped: public/catalog not built");
            return;
        }
        const auto pub = repoRoot().getChildFile ("public");
        juce::StringArray ie;
        const auto index = parseIndex (*parseJson (pub.getChildFile ("catalog/index.json").loadFileAsString(), err), ie);
        expect (index.has_value(), ie.joinIntoString ("; "));
        expect (checkIndex (*index).isEmpty(), checkIndex (*index).joinIntoString ("; "));
        int bad = 0;
        for (const auto& entry : index->kits)
        {
            juce::StringArray ke;
            const auto k = parseKit (*parseJson (pub.getChildFile (entry.url).loadFileAsString(), err), ke);
            if (! k || ! checkKit (*k, &entry).isEmpty())
            {
                ++bad;
                logMessage ("kit failed: " + entry.id + " " + ke.joinIntoString ("; "));
            }
        }
        expectEquals (bad, 0);
    }
};

class SharedDataTests : public juce::UnitTest
{
public:
    SharedDataTests() : juce::UnitTest ("Constants shared with the browser app", "contract") {}

    void runTest() override
    {
        beginTest ("constants match src/ (generated/shared.json)");
        const auto& c = sharedData()["constants"];
        expectEquals ((double) c["masterGainDb"], masterGainDb);
        expectEquals ((int) c["maxVoices"], maxVoices);
        expectEquals ((double) c["stopFadeSec"], stopFadeSec);
        expectEquals ((double) c["chokeFadeSec"], chokeFadeSec);
        expectEquals ((double) c["outputGainMinDb"], outputGainMinDb);
        expectEquals ((double) c["outputGainMaxDb"], outputGainMaxDb);
        expectEquals ((double) c["targetLufs"], targetLufs);
        expectEquals ((double) c["peakCeilingDb"], peakCeilingDb);
        expectEquals ((double) c["maxBoostDb"], maxBoostDb);
        expectEquals ((double) c["maxCutDb"], maxCutDb);
        expectEquals ((int) c["pitchMinCents"], pitchMinCents);
        expectEquals ((int) c["pitchMaxCents"], pitchMaxCents);
        expectEquals ((int) c["effectivePitchMinCents"], effectivePitchMinCents);
        expectEquals ((int) c["effectivePitchMaxCents"], effectivePitchMaxCents);
        expectEquals ((double) c["lateLimitSec"], lateLimitSec);
        expectEquals ((int) c["steps"], steps);
        expectEquals ((int) c["bpmMin"], bpmMin);
        expectEquals ((int) c["bpmMax"], bpmMax);
        expectEquals ((int) c["bpmDefault"], bpmDefault);
        expectEquals ((double) c["trackGainMinDb"], trackGainMinDb);
        expectEquals ((double) c["trackGainMaxDb"], trackGainMaxDb);

        beginTest ("circuit profiles load");
        const auto* tr909 = circuitFor ("roland-tr-909");
        expect (tr909 != nullptr && tr909->jitter.has_value() && tr909->swingGrids.count (16) == 1);
        expect (circuitFor ("not-a-machine") == nullptr);
        expect (circuitFor ("alesis-hr-16b") != nullptr);

        beginTest ("machineSwing matches circuit.ts");
        SwingSteps linn { SwingSteps::Kind::ticks, 24, 5, {} };
        expectWithinAbsoluteError (machineSwing (60, &linn), 58.333333333, 1e-6);
        expectWithinAbsoluteError (machineSwing (75, &linn), 70.833333333, 1e-6);
        expectEquals (machineSwing (50, &linn), 50.0);
        SwingSteps values { SwingSteps::Kind::values, 0, 0, { 50, 54, 58, 62 } };
        expectEquals (machineSwing (70, &values), 62.0);
        expectEquals (machineSwing (55, nullptr), 55.0);

        beginTest ("jitter stays inside the measured bounds and is deterministic");
        JitterProfile measured;
        measured.maxMs = 2.052;
        measured.meanMs = 1.72;
        StepJitter a (measured, 42), b (measured, 42);
        double sum = 0;
        for (int i = 0; i < 2000; ++i)
        {
            const double x = a.offsetSec (i * 0.125);
            expect (x >= 0 && x <= 0.002052 + 1e-12);
            expectEquals (x, b.offsetSec (i * 0.125));
            sum += x;
        }
        expectWithinAbsoluteError (sum / 2000 * 1000, 1.72, 0.06);
        JitterProfile poll;
        poll.kind = JitterProfile::Kind::poll;
        poll.pollMs = 2;
        poll.maxMs = 4.46;
        StepJitter p (poll, 7);
        for (int i = 0; i < 1000; ++i)
        {
            const double x = p.offsetSec (i * 0.1);
            expect (x >= 0 && x <= 0.00446 + 1e-12);
        }

        beginTest ("pitch maths matches pitch.ts");
        expectEquals (clampPitchCents (1500), 1200);
        expectEquals (clampPitchCents (-0.5), 0);
        expectEquals (clampPitchCents (2.5), 3);
        expectEquals (clampPitchCents (std::nan ("")), 0);
        expectWithinAbsoluteError (pitchRate (1200), 2.0, 1e-12);
        expectWithinAbsoluteError (pitchRate (-3000), 0.25, 1e-12);
        expectWithinAbsoluteError (pitchRate (std::nan ("")), 1.0, 1e-12);
    }
};

class MidiMapTests : public juce::UnitTest
{
public:
    MidiMapTests() : juce::UnitTest ("MIDI note map", "contract") {}

    void runTest() override
    {
        beginTest ("General MIDI first, unique notes for every slot");
        std::vector<std::pair<juce::String, juce::String>> slots { { "kick", "kick" },      { "snare", "snare" },
                                                                   { "hat-closed", "hat" }, { "hat-open", "hat" },
                                                                   { "clave", "percussion" }, { "whistle", "percussion" },
                                                                   { "bell", "percussion" }, { "my-pad", "percussion" } };
        const auto m = buildMidiMap (slots, {});
        expectEquals (m.noteFor ("kick"), 36);
        expectEquals (m.noteFor ("snare"), 38);
        expectEquals (m.noteFor ("hat-closed"), 42);
        expectEquals (m.noteFor ("hat-open"), 46);
        expectEquals (m.noteFor ("clave"), 75);
        std::set<int> notes;
        for (const auto& [id, n] : m.slotNotes)
        {
            expect (n >= 0 && n < 128);
            expect (notes.insert (n).second, "duplicate note for " + id);
        }
        expect (m.noteFor ("whistle") != 75 && m.noteFor ("bell") != 75 && m.noteFor ("my-pad") != 75);
        expectEquals (m.slotIndexForNote[36], 0);

        beginTest ("overrides win and displaced defaults move");
        const auto o = buildMidiMap (slots, { { "my-pad", 36 } });
        expectEquals (o.noteFor ("my-pad"), 36);
        expect (o.noteFor ("kick") != 36);
        expectEquals (o.slotIndexForNote[36], 7);
        expectEquals (midiNoteName (36), juce::String ("C1"));
        expectEquals (midiNoteName (60), juce::String ("C3"));
    }
};

class PatternTests : public juce::UnitTest
{
public:
    PatternTests() : juce::UnitTest ("Pattern model", "contract") {}

    void runTest() override
    {
        beginTest ("clamps match pattern.ts");
        expectEquals (clampBpm (300), 240);
        expectEquals (clampBpm (std::nan ("")), 120);
        expectEquals (clampBpm (99.5), 100);
        expectEquals (clampSwing (80), 75);
        expect (clampTrackGain (-40) == -INFINITY);
        expectEquals (clampTrackGain (10), 6.0);
        expectEquals (clampTrackGain (-3.3), -3.5);
        expectEquals (clampLevel (0.555), 0.56);

        beginTest ("hit gain: level squared, off is silent");
        TrackState t;
        t.levels[3] = 0.5;
        expectWithinAbsoluteError (hitGainDb (t, 3), 40 * std::log10 (0.5), 1e-12);
        expectEquals (hitGainDb (t, -1), 0.0);
        t.levels[4] = 0;
        expect (hitGainDb (t, 4) == -INFINITY);
        t.gainDb = -INFINITY;
        expect (hitGainDb (t, 0) == -INFINITY);

        beginTest ("Pattern v1 JSON round trip keeps everything and omits defaults");
        PatternState p;
        p.id = "p1";
        p.name = "GROOVE";
        p.kitId = "kit-a";
        p.kitRevision = "0123456789abcdef";
        p.bpm = 97;
        p.swing = 62;
        p.swingGrid = 8;
        p.length = 8;
        p.circuit = true;
        p.pitchCents = -300;
        TrackState k;
        k.slotId = "kick";
        k.sampleId = "s1";
        k.stepsOn[0] = k.stepsOn[8] = true;
        k.gainDb = -INFINITY;
        k.levels[2] = 0.25;
        k.stepPitchCents[5] = 700;
        p.tracks["kick"] = k;
        TrackState s;
        s.slotId = "snare";
        s.sampleId = "s2";
        p.tracks["snare"] = s;
        p.updatedAt = "2026-10-08T00:00:00.000Z";
        const auto json = toPatternJson (p);
        const auto back = fromPatternJson (json);
        expect (back.has_value());
        expect (*back == p);
        expect (! json["tracks"][1].getDynamicObject()->hasProperty ("levels"));
        expectEquals ((double) json["tracks"][0]["gainDb"], -60.0);
        expect (juce::String (canonicalJson (json, false)).contains ("\"swingGrid\":8"));
        PatternState plain;
        plain.id = "x";
        plain.kitId = "k";
        plain.kitRevision = "0123456789abcdef";
        plain.updatedAt = "2026-10-08T00:00:00.000Z";
        const auto pj = toPatternJson (plain);
        for (const char* key : { "swing", "swingGrid", "length", "circuit", "pitchCents" })
            expect (! pj.getDynamicObject()->hasProperty (key), key);
        expect (isoNow().endsWith ("Z") && isoNow().length() == 24);

        beginTest ("bindKit keeps foreign tracks and switches unknown variants to the default");
        juce::String err;
        juce::StringArray errors;
        const auto kitJson = parseJson (R"({"schemaVersion":1,"id":"kit-b","machineId":"m","label":"B","revision":"0123456789abcdef",
            "slots":[{"id":"kick","label":"Kick","category":"kick","icon":"kick","defaultSampleId":"b1","sampleIds":["b1"],"chokeGroup":null,"gainDb":0},
                     {"id":"clap","label":"Clap","category":"clap","icon":"clap","defaultSampleId":"b2","sampleIds":["b2"],"chokeGroup":null,"gainDb":0}],
            "samples":[{"id":"b1","blobSha256":"0000000000000000000000000000000000000000000000000000000000000000","url":"media/audio/a.wav","bytes":10,"durationSec":0.5,"channels":1,"sampleRate":44100,"gainDb":0,"peakDbfs":null},
                       {"id":"b2","blobSha256":"0000000000000000000000000000000000000000000000000000000000000000","url":"media/audio/b.wav","bytes":10,"durationSec":0.5,"channels":1,"sampleRate":44100,"gainDb":0,"peakDbfs":null}]})", err);
        const auto kitB = parseKit (*kitJson, errors);
        expect (kitB.has_value(), errors.joinIntoString ("; "));
        const auto bound = bindKit (p, *kitB);
        expectEquals (bound.kitId, juce::String ("kit-b"));
        expectEquals (bound.tracks.at ("kick").sampleId, juce::String ("b1"));
        expect (bound.tracks.at ("kick").stepsOn[8]);
        expect (bound.tracks.count ("snare") == 1);
        expectEquals (bound.tracks.at ("clap").sampleId, juce::String ("b2"));
        // Same kit: a variant the kit lacks is kept (silent, flagged), never replaced.
        auto same = bound;
        same.tracks["kick"].sampleId = "gone";
        expectEquals (bindKit (same, *kitB).tracks.at ("kick").sampleId, juce::String ("gone"));
    }
};

static JsonTests jsonTests;
static ContractTests contractTests;
static SharedDataTests sharedDataTests;
static MidiMapTests midiMapTests;
static PatternTests patternTests;
} // namespace drums::test
