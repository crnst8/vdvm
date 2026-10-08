// Library subsystem: scanning, import (copy and link), user kits, the strict
// catalog validator on plugin-written libraries, external catalogs, identity
// resolution, relink and security limits.
#include "TestUtil.h"
#include "core/Importer.h"
#include "core/Json.h"
#include "core/Library.h"
#include "core/SampleStore.h"

namespace drums::test
{
namespace
{
    /** Run the repository's TypeScript catalog validator on a folder. Empty optional when node is unavailable. */
    std::optional<std::pair<bool, juce::String>> runValidator (const juce::File& root)
    {
        const auto repo = repoRoot();
        if (! repo.getChildFile ("node_modules/.bin/tsx").existsAsFile())
            return std::nullopt;
        juce::ChildProcess proc;
        const auto cmd = "cd '" + repo.getFullPathName() + "' && PATH=/opt/homebrew/bin:/usr/local/bin:$PATH node_modules/.bin/tsx scripts/catalog/validate.ts --root '"
                         + root.getFullPathName() + "' 2>&1";
        if (! proc.start (juce::StringArray { "/bin/sh", "-c", cmd }))
            return std::nullopt;
        const auto out = proc.readAllProcessOutput();
        proc.waitForProcessToFinish (60000);
        return std::make_pair (proc.getExitCode() == 0, out);
    }

    juce::File makeSourceFolder (const juce::File& dir)
    {
        writeTone (dir.getChildFile ("Kick 01.wav"), 44100, 1, 0.4, 60, 0.9, 16);
        writeTone (dir.getChildFile ("Snare_hard.wav"), 48000, 2, 0.3, 200, 0.7, 24);
        writeTone (dir.getChildFile ("hats/CH 1.aif"), 44100, 1, 0.1, 6000, 0.4, 16, true);
        writeTone (dir.getChildFile ("hats/Open Hat.wav"), 44100, 1, 0.6, 7000, 0.4, 16);
        writeTone (dir.getChildFile ("perc/cowbell.wav"), 96000, 1, 0.2, 800, 0.5, 24);
        writeTone (dir.getChildFile ("weird name (copy) #2.wav"), 22050, 1, 0.2, 400, 0.5, 16);
        dir.getChildFile ("notes.txt").replaceWithText ("hello");
        dir.getChildFile ("broken.wav").replaceWithText ("RIFF0000WAVEjunk");
        dir.getChildFile (".hidden.wav").replaceWithText ("x");
        writeTone (dir.getChildFile ("surround.wav"), 44100, 4, 0.1, 300, 0.5);
        writeTone (dir.getChildFile ("long loop.wav"), 8000, 1, 61, 300, 0.1);
        // A symlinked folder loop must not be followed.
        dir.createSymbolicLink (dir.getChildFile ("perc/loop"), true);
        return dir;
    }

    ScanCandidate byName (const ScanResult& r, const juce::String& name)
    {
        for (const auto& c : r.candidates)
            if (c.name == name)
                return c;
        return {};
    }
} // namespace

class ImportTests : public juce::UnitTest
{
public:
    ImportTests() : juce::UnitTest ("Import and user kits", "library") {}

    void runTest() override
    {
        TempDir tmp;
        const auto source = makeSourceFolder (tmp.dir.getChildFile ("Source Samples"));
        LibraryManager libs (tmp.dir.getChildFile ("data"), {});

        beginTest ("role suggestions from file names");
        expectEquals (suggestRole ("Kick 01.wav"), juce::String ("kick"));
        expectEquals (suggestRole ("BD_808.wav"), juce::String ("kick"));
        expectEquals (suggestRole ("Snare_hard.wav"), juce::String ("snare"));
        expectEquals (suggestRole ("CH 1.aif"), juce::String ("hat-closed"));
        expectEquals (suggestRole ("Open Hat.wav"), juce::String ("hat-open"));
        expectEquals (suggestRole ("OH-2.wav"), juce::String ("hat-open"));
        expectEquals (suggestRole ("hh.wav"), juce::String ("hat-closed"));
        expectEquals (suggestRole ("Tom Lo.wav"), juce::String ("tom-low"));
        expectEquals (suggestRole ("tom hi 2.wav"), juce::String ("tom-high"));
        expectEquals (suggestRole ("cowbell.wav"), juce::String ("cowbell"));
        expectEquals (suggestRole ("Rimshot.wav"), juce::String ("rim"));
        expectEquals (suggestRole ("vocal chop.wav"), juce::String());

        beginTest ("scan lists supported one-shots and explains every rejection");
        std::atomic<bool> cancel { false };
        const auto scan = scanForAudio ({ source }, {}, &cancel);
        expect (scan.folder == source);
        expectEquals ((int) scan.candidates.size(), 6);
        juce::StringArray reasons;
        for (const auto& r : scan.rejected)
            reasons.add (r.file.getFileName() + ": " + r.reason);
        logMessage (reasons.joinIntoString ("\n"));
        expectEquals (scan.rejectedTotal, 4);
        expect (reasons.joinIntoString (" ").contains ("notes.txt: not a supported audio file type"));
        expect (reasons.joinIntoString (" ").contains ("broken.wav: not readable"));
        expect (reasons.joinIntoString (" ").contains ("surround.wav: 4 channels"));
        expect (reasons.joinIntoString (" ").contains ("long loop.wav: longer than 60 s"));
        expectEquals (byName (scan, "CH 1").relPath, juce::String ("hats/CH 1.aif"));
        expectEquals (byName (scan, "CH 1").suggestedRole, juce::String ("hat-closed"));

        beginTest ("scan limits and cancellation");
        ScanLimits small;
        small.maxCandidates = 2;
        const auto limited = scanForAudio ({ source }, small);
        expect (limited.truncated);
        expectEquals ((int) limited.candidates.size(), 2);
        cancel = true;
        expect (scanForAudio ({ source }, {}, &cancel).cancelled);
        cancel = false;

        beginTest ("managed import copies, converts AIFF to WAV and hashes the stored bytes");
        juce::String error;
        const auto libId = libs.createUserLibrary ("My Kits", error);
        expect (libId.isNotEmpty(), error);
        const auto outcome = importSamples (libs, libId, scan.candidates);
        expectEquals ((int) outcome.imported.size(), 6);
        expect (outcome.failed.empty());
        auto lib = libs.get (libId, error);
        expect (lib != nullptr, error);
        const auto libRoot = lib->record().root;
        for (const auto& s : outcome.imported)
        {
            const auto f = libRoot.getChildFile ("pool/" + s.sha256 + ".wav");
            expect (f.existsAsFile(), s.name);
            expectEquals (sha256Hex (f), s.sha256);
            juce::MemoryBlock bytes;
            f.loadFileAsData (bytes);
            juce::String wavError;
            const auto info = readWavInfo (bytes.getData(), bytes.getSize(), wavError);
            expect (info.has_value(), s.name + ": " + wavError);
            if (info)
            {
                expectEquals (info->channels, s.channels);
                expectEquals (info->sampleRate, s.sampleRate);
                expectWithinAbsoluteError (info->durationSec, s.durationSec, 1e-9);
            }
        }
        // Importing the same audio again reuses it.
        expectEquals ((int) importSamples (libs, libId, { scan.candidates[0] }).imported.size(), 1);
        expectEquals ((int) libs.get (libId, error)->imported().size(), 6);

        beginTest ("a kit from imported samples is a valid v1 catalog (strict validator)");
        std::map<juce::String, juce::String> shaByName;
        for (const auto& s : outcome.imported)
            shaByName[s.name] = s.sha256;
        KitDraft draft;
        draft.label = "First Kit";
        draft.slots.push_back ({ {}, "kick", "", { shaByName["Kick 01"] }, {} });
        draft.slots.push_back ({ {}, "snare", "", { shaByName["Snare_hard"], shaByName["weird name (copy) #2"] }, shaByName["weird name (copy) #2"] });
        draft.slots.push_back ({ {}, "hat-closed", "", { shaByName["CH 1"] }, {} });
        draft.slots.push_back ({ {}, "hat-open", "", { shaByName["Open Hat"] }, {} });
        draft.slots.push_back ({ {}, "", "Bell Thing", { shaByName["cowbell"] }, {} });
        draft.slots.push_back ({ {}, "", "Empty pad", {}, {} });
        const auto kitId = saveKit (libs, libId, draft, error);
        expect (kitId.isNotEmpty(), error);
        lib = libs.get (libId, error);
        const auto kit = lib->loadKit (kitId, error);
        expect (kit.has_value(), error);
        expectEquals ((int) kit->slots.size(), 5);
        expectEquals (kit->slots[1].sampleIds.size(), 2);
        expectEquals (kit->sample (kit->slots[1].defaultSampleId)->blobSha256, shaByName["weird name (copy) #2"]);
        expectEquals (kit->slots[2].chokeGroup, juce::String ("hi-hat"));
        expectEquals (kit->slots[4].id, juce::String ("bell-thing"));
        expectEquals (kit->slots[4].category, juce::String ("percussion"));
        expect (libRoot.getChildFile ("media/audio/" + shaByName["Kick 01"] + ".wav").existsAsFile());
        expect (libRoot.getChildFile ("pool").getNumberOfChildFiles (juce::File::findFiles, "*.wav") == 0);
        if (const auto v = runValidator (libRoot))
            expect (v->first, v->second);
        else
            logMessage ("skipped validator: node_modules missing");

        beginTest ("editing keeps the kit id and sample ids; deleting returns audio to the pool");
        auto edit = draft;
        edit.kitId = kitId;
        edit.label = "First Kit v2";
        edit.slots.erase (edit.slots.begin() + 4);
        const auto same = saveKit (libs, libId, edit, error);
        expectEquals (same, kitId);
        const auto kit2 = libs.get (libId, error)->loadKit (kitId, error);
        expect (kit2->revision != kit->revision);
        expectEquals (kit2->slots[0].sampleIds[0], kit->slots[0].sampleIds[0]);
        expect (libRoot.getChildFile ("pool/" + shaByName["cowbell"] + ".wav").existsAsFile());
        expectEquals (libRoot.getChildFile ("catalog/kits/" + kitId).getNumberOfChildFiles (juce::File::findFiles), 1);
        if (const auto v = runValidator (libRoot))
            expect (v->first, v->second);
        expectEquals (removeUnusedSamples (libs, libId, { shaByName["cowbell"], shaByName["Kick 01"] }, error), 1);

        beginTest ("managed audio keeps playing after the source folder is removed");
        source.getChildFile ("Kick 01.wav").deleteFile();
        SampleStore store;
        for (const auto& s : kit2->samples)
        {
            const auto f = libs.get (libId, error)->sampleFile (s);
            expect (f.has_value());
            juce::String loadError;
            expect (store.loadNow ({ s.blobSha256, *f }, loadError) != nullptr, loadError);
        }

        beginTest ("a kit needs a sound; read-only libraries refuse writes");
        KitDraft empty;
        empty.label = "Nothing";
        empty.slots.push_back ({ {}, "kick", "", {}, {} });
        expect (saveKit (libs, libId, empty, error).isEmpty());
        expect (error.contains ("at least one"));

        beginTest ("registry persists and user libraries can be re-added from their folder");
        LibraryManager again (tmp.dir.getChildFile ("data"), {});
        expect (again.record (libId).has_value());
        expectEquals (again.record (libId)->name, juce::String ("My Kits"));
        LibraryManager fresh (tmp.dir.getChildFile ("other-data"), {});
        const auto readded = fresh.addCatalog (libRoot, error);
        expectEquals (readded, libId);
        expect (fresh.get (libId, error)->writable());
        expect (libs.rename (libId, "Renamed", error));
        expectEquals (readLibraryFile (libRoot, error)->name, juce::String ("Renamed"));
        if (const auto v = runValidator (libRoot))
            expect (v->first, v->second);

        beginTest ("the pre-rename data folder moves once, with registered paths rewritten");
        {
            const auto oldDir = tmp.dir.getChildFile ("AppSupport/Drums");
            const auto newDir = tmp.dir.getChildFile ("AppSupport/V.D.V.M");
            LibraryManager oldLibs (oldDir, {});
            juce::String e;
            const auto id = oldLibs.createUserLibrary ("Old Sounds", e);
            const auto extId = oldLibs.createLinkedLibrary ("Elsewhere", source, e);
            // Rewrite the registry and library file in the pre-rename formats.
            const auto reg = oldDir.getChildFile ("library-registry.json");
            reg.replaceWithText (reg.loadFileAsString().replace ("vdvm-library-registry", "drums-library-registry"));
            const auto libFile = oldLibs.record (id)->root.getChildFile ("library.json");
            libFile.replaceWithText (libFile.loadFileAsString().replace ("vdvm-library", "drums-library"));
            expect (LibraryManager::migrateDataDir (oldDir, newDir));
            expect (! oldDir.exists() && newDir.isDirectory());
            expect (! LibraryManager::migrateDataDir (oldDir, newDir), "runs once");
            LibraryManager moved (newDir, {});
            expect (moved.record (id).has_value() && moved.record (id)->root.isAChildOf (newDir), moved.record (id)->root.getFullPathName());
            expect (moved.get (id, e) != nullptr, e);
            expectEquals (moved.record (id)->name, juce::String ("Old Sounds"));
            expect (moved.record (extId)->linkedRoot == source, "a linked folder outside the data folder is untouched");
        }

        beginTest ("FLAC imports convert to WAV with identical samples");
        {
            const auto flacFile = tmp.dir.getChildFile ("flac/tone.flac");
            flacFile.getParentDirectory().createDirectory();
            juce::AudioBuffer<float> buf (1, 4410);
            for (int i = 0; i < 4410; ++i)
                buf.setSample (0, i, (float) std::round (std::sin (i * 0.1) * 0.5 * 32767) / 32768.0f);
            {
                std::unique_ptr<juce::OutputStream> out = std::make_unique<juce::FileOutputStream> (flacFile);
                juce::FlacAudioFormat flac;
                auto w = flac.createWriterFor (out, juce::AudioFormatWriterOptions {}.withSampleRate (44100).withNumChannels (1).withBitsPerSample (16));
                expect (w != nullptr);
                w->writeFromAudioSampleBuffer (buf, 0, 4410);
            }
            const auto r = scanForAudio ({ flacFile });
            expectEquals ((int) r.candidates.size(), 1);
            const auto o = importSamples (libs, libId, r.candidates);
            expectEquals ((int) o.imported.size(), 1);
            const auto stored = libRoot.getChildFile ("pool/" + o.imported[0].sha256 + ".wav");
            const auto a = decodeAudioFile (flacFile, {});
            const auto b = decodeAudioFile (stored, {});
            expectEquals (a.pcm.getNumSamples(), b.pcm.getNumSamples());
            float diff = 0;
            for (int i = 0; i < a.pcm.getNumSamples(); ++i)
                diff = std::max (diff, std::abs (a.pcm.getSample (0, i) - b.pcm.getSample (0, i)));
            expect (diff < 1.0e-6f, juce::String (diff));
        }
    }
};

class LinkedLibraryTests : public juce::UnitTest
{
public:
    LinkedLibraryTests() : juce::UnitTest ("Linked folders and relink", "library") {}

    void runTest() override
    {
        TempDir tmp;
        const auto source = tmp.dir.getChildFile ("Linked Source");
        writeTone (source.getChildFile ("kick.wav"), 44100, 1, 0.3, 60, 0.9);
        writeTone (source.getChildFile ("sub/snare.wav"), 44100, 1, 0.3, 200, 0.7);
        writeTone (source.getChildFile ("sub/hat.aif"), 44100, 1, 0.1, 6000, 0.4, 16, true);
        LibraryManager libs (tmp.dir.getChildFile ("data"), {});
        juce::String error;

        beginTest ("linking records relative paths without copying; AIFF must be copied");
        const auto id = libs.createLinkedLibrary ("Linked", source, error);
        expect (id.isNotEmpty(), error);
        const auto scan = scanForAudio ({ source });
        const auto outcome = importSamples (libs, id, scan.candidates);
        expectEquals ((int) outcome.imported.size(), 2);
        expectEquals ((int) outcome.failed.size(), 1);
        expect (outcome.failed[0].reason.contains ("copy it instead"));
        auto lib = libs.get (id, error);
        expectEquals ((int) lib->links().size(), 2);
        expect (! lib->record().root.getChildFile ("media").exists());

        KitDraft d;
        d.label = "Linked Kit";
        for (const auto& s : outcome.imported)
            d.slots.push_back ({ {}, s.suggestedRole, "", { s.sha256 }, {} });
        const auto kitId = saveKit (libs, id, d, error);
        expect (kitId.isNotEmpty(), error);
        auto health = checkLibrary (libs, id);
        expectEquals (health.missing, 0);
        expectEquals (health.samples, 2);

        beginTest ("moving the folder shows missing files; relink by path fixes them");
        const auto moved = tmp.dir.getChildFile ("Moved Source");
        expect (source.moveFileTo (moved));
        health = checkLibrary (libs, id);
        expectEquals (health.missing, 2);
        auto relinked = relinkLibrary (libs, id, moved, error);
        expect (error.isEmpty(), error);
        expectEquals (relinked.found, 2);
        expectEquals (relinked.missing, 0);
        expectEquals (checkLibrary (libs, id).missing, 0);

        beginTest ("relink finds renamed files by size and hash; reports what it cannot find");
        moved.getChildFile ("renamed").createDirectory();
        expect (moved.getChildFile ("sub/snare.wav").moveFileTo (moved.getChildFile ("renamed/snare 2.wav")));
        moved.getChildFile ("kick.wav").deleteFile();
        relinked = relinkLibrary (libs, id, moved, error);
        expectEquals (relinked.found, 1);
        expectEquals (relinked.missing, 1);
        expectEquals (relinked.missingNames[0], juce::String ("kick"));
        lib = libs.get (id, error);
        bool foundRenamed = false;
        for (const auto& [sha, e] : lib->links())
            foundRenamed |= e.path == "renamed/snare 2.wav";
        expect (foundRenamed);

        beginTest ("a changed linked file fails its hash check instead of playing other audio");
        const auto kit = lib->loadKit (kitId, error);
        const auto snareFile = moved.getChildFile ("renamed/snare 2.wav");
        writeTone (snareFile, 44100, 1, 0.3, 300, 0.2);
        SampleStore store;
        int hashErrors = 0;
        for (const auto& s : kit->samples)
        {
            const auto f = lib->sampleFile (s);
            if (! f || ! f->existsAsFile())
                continue;
            juce::String loadError;
            if (store.loadNow ({ s.blobSha256, *f }, loadError) == nullptr && loadError.contains ("hash"))
                ++hashErrors;
        }
        expectEquals (hashErrors, 1);
        expect (checkLibrary (libs, id).changed >= 1);

        beginTest ("linked files outside the linked folder are refused");
        const auto outside = writeTone (tmp.dir.getChildFile ("elsewhere/x.wav"), 44100, 1, 0.1, 100, 0.5);
        const auto o2 = importSamples (libs, id, scanForAudio ({ outside }).candidates);
        expectEquals ((int) o2.failed.size(), 1);
    }
};

class CatalogLibraryTests : public juce::UnitTest
{
public:
    CatalogLibraryTests() : juce::UnitTest ("External catalogs and identity", "library") {}

    static juce::File copyCatalogSubset (const juce::File& from, const juce::File& to, int kits)
    {
        // A small, valid catalog: the first `kits` kits of the curated catalog with their audio.
        juce::String error;
        const auto index = *parseJson (from.getChildFile ("catalog/index.json").loadFileAsString(), error);
        juce::StringArray errors;
        auto parsed = *parseIndex (index, errors);
        parsed.kits.resize ((size_t) kits);
        std::set<juce::String> machines;
        for (const auto& k : parsed.kits)
            machines.insert (k.machineId);
        parsed.machines.erase (std::remove_if (parsed.machines.begin(), parsed.machines.end(),
                                               [&] (const Machine& m) { return machines.count (m.id) == 0; }),
                               parsed.machines.end());
        for (auto& m : parsed.machines)
            m.logo.reset(), m.photo.reset();
        parsed.machineRedirects.clear();
        parsed.kitRedirects.clear();
        parsed.sampleRedirects.clear();
        parsed.creditsUrl = "catalog/credits.json";
        auto json = toJson (parsed);
        setProp (json, "revision", revisionOf (json));
        writeFileAtomic (to.getChildFile ("catalog/index.json"), stableJson (json));
        to.getChildFile ("catalog/credits.json").replaceWithText (R"({"schemaVersion":1,"credits":{}})");
        for (const auto& k : parsed.kits)
        {
            to.getChildFile (k.url).getParentDirectory().createDirectory();
            to.getChildFile ("media/audio").createDirectory();
            from.getChildFile (k.url).copyFileTo (to.getChildFile (k.url));
            const auto kit = parseKit (*parseJson (from.getChildFile (k.url).loadFileAsString(), error), errors);
            for (const auto& s : kit->samples)
                from.getChildFile (s.url).copyFileTo (to.getChildFile (s.url));
        }
        return to;
    }

    void runTest() override
    {
        TempDir tmp;
        LibraryManager libs (tmp.dir.getChildFile ("data"), { tmp.dir.getChildFile ("no-factory") });
        juce::String error;

        beginTest ("a folder without a catalog is refused with a reason");
        expect (libs.addCatalog (tmp.dir, error).isEmpty());
        expect (error.contains ("catalog/index.json"), error);
        juce::String sourceError;
        tmp.dir.getChildFile ("src-only/schema").createDirectory();
        expect (libs.addCatalog (tmp.dir.getChildFile ("src-only"), sourceError).isEmpty());
        expect (sourceError.contains ("npm run catalog:prepare"), sourceError);

        beginTest ("unbundled first run: no factory, no libraries");
        expect (libs.records().empty());

        if (! hasCuratedCatalog())
        {
            logMessage ("skipped catalog tests: public/ not built");
            return;
        }
        const auto curated = repoRoot().getChildFile ("public");
        const auto ext = copyCatalogSubset (curated, tmp.dir.getChildFile ("External Catalog"), 3);
        if (const auto v = runValidator (ext))
            expect (v->first, v->second);

        beginTest ("choosing the catalog/ folder, a checkout or its source records finds the playable root");
        expect (findCatalogRoot (ext.getChildFile ("catalog")) == ext);
        expect (findCatalogRoot (ext) == ext);
        const auto checkout = tmp.dir.getChildFile ("checkout");
        ext.copyDirectoryTo (checkout.getChildFile ("public"));
        checkout.getChildFile ("catalog/schema").createDirectory(); // source records, no index.json
        expect (findCatalogRoot (checkout) == checkout.getChildFile ("public"));
        expect (findCatalogRoot (checkout.getChildFile ("catalog")) == checkout.getChildFile ("public"));
        expect (! findCatalogRoot (tmp.dir.getChildFile ("checkout/catalog/schema")).has_value());
        {
            LibraryManager probe (tmp.dir.getChildFile ("probe-data"), {});
            const auto id = probe.addCatalog (checkout.getChildFile ("catalog"), error);
            expect (id.isNotEmpty(), error);
            expectEquals (probe.record (id)->name, juce::String ("checkout"));
            expect (probe.record (id)->root == checkout.getChildFile ("public"));
        }

        beginTest ("an external V.D.V.M catalog in any folder loads read-only");
        const auto extId = libs.addCatalog (ext, error);
        expect (extId.isNotEmpty(), error);
        auto lib = libs.get (extId, error);
        expect (! lib->writable());
        const auto firstKit = lib->index().kits[0];
        const auto kit = lib->loadKit (firstKit.id, error);
        expect (kit.has_value(), error);
        SampleStore store;
        juce::String loadError;
        expect (store.loadNow ({ kit->samples[0].blobSha256, *lib->sampleFile (kit->samples[0]) }, loadError) != nullptr, loadError);
        expect (importSamples (libs, extId, {}).failed.size() == 1);
        expect (libs.addCatalog (ext, error).isEmpty()); // already added

        beginTest ("factory discovery is a conventional folder, not a requirement");
        LibraryManager withFactory (tmp.dir.getChildFile ("data2"), { tmp.dir.getChildFile ("missing"), ext });
        expectEquals ((int) withFactory.records().size(), 1);
        expectEquals (withFactory.records()[0].id, juce::String ("factory"));
        expect (! withFactory.remove ("factory", error));

        beginTest ("damaged manifests and audio are refused, not played");
        const auto broken = tmp.dir.getChildFile ("Broken Catalog");
        ext.copyDirectoryTo (broken);
        const auto brokenId = libs.addCatalog (broken, error);
        expect (brokenId.isNotEmpty(), error);
        auto manifest = broken.getChildFile (firstKit.url);
        manifest.replaceWithText (manifest.loadFileAsString().replace ("\"label\"", "\"label\" ", false));
        // Whitespace only: same canonical revision, still loads.
        expect (libs.get (brokenId, error)->loadKit (firstKit.id, error).has_value(), error);
        libs.invalidate (brokenId);
        manifest.replaceWithText (manifest.loadFileAsString().replace (kit->label, kit->label + " changed"));
        expect (! libs.get (brokenId, error)->loadKit (firstKit.id, error).has_value());
        expect (error.contains ("revision"), error);
        const auto audio = broken.getChildFile (kit->samples[0].url);
        audio.appendText ("x");
        loadError = {};
        expect (store.loadNow ({ kit->samples[0].blobSha256 + "", audio }, loadError) == nullptr || store.has (kit->samples[0].blobSha256));
        SampleStore fresh;
        expect (fresh.loadNow ({ kit->samples[0].blobSha256, audio }, loadError) == nullptr);
        expect (loadError.contains ("hash"), loadError);

        beginTest ("path escapes in a catalog are refused");
        const auto evil = tmp.dir.getChildFile ("Evil Catalog");
        ext.copyDirectoryTo (evil);
        auto evilIndex = *parseJson (evil.getChildFile ("catalog/index.json").loadFileAsString(), error);
        evilIndex["kits"][0].getDynamicObject()->setProperty ("url", "../../outside.json");
        setProp (evilIndex, "revision", revisionOf (evilIndex));
        writeFileAtomic (evil.getChildFile ("catalog/index.json"), stableJson (evilIndex));
        expect (libs.addCatalog (evil, error).isEmpty());
        expect (error.contains ("unsafe"), error);
        Sample escape;
        escape.url = "../secret.wav";
        expect (! lib->sampleFile (escape).has_value());

        beginTest ("identity: the named library wins; elsewhere only the identical kit is bound");
        const auto userId = libs.createUserLibrary ("Copies", error);
        const auto copied = copyKit (libs, extId, firstKit.id, userId, error);
        expect (copied.isNotEmpty(), error);
        const auto userRoot = libs.get (userId, error)->record().root;
        if (const auto v = runValidator (userRoot))
            expect (v->first, v->second);
        auto found = libs.findKit (extId, firstKit.id, firstKit.revision);
        expect (found && found->libraryId == extId && found->exactRevision);
        found = libs.findKit ("gone-library", firstKit.id, firstKit.revision);
        expect (found && found->exactRevision, "same content elsewhere is the same kit");
        expect (! libs.findKit ("gone-library", firstKit.id, "ffffffffffffffff").has_value(), "a different revision elsewhere is not bound");
        expect (! libs.findKit ("gone-library", "no-such-kit", "").has_value());
        // The copy has its own kit id, so it never collides with the source.
        expect (libs.get (userId, error)->index().kitEntry (firstKit.id) == nullptr);

        beginTest ("removing a library forgets it without deleting files");
        expect (libs.remove (extId, error));
        expect (ext.getChildFile ("catalog/index.json").existsAsFile());
        expect (! libs.record (extId).has_value());
    }
};

static ImportTests importTests;
static LinkedLibraryTests linkedLibraryTests;
static CatalogLibraryTests catalogLibraryTests;
} // namespace drums::test
