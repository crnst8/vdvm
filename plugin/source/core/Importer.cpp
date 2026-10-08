#include "Importer.h"
#include "Json.h"
#include "Pattern.h"
#include "SampleStore.h"

#include <regex>
#include <set>

namespace drums
{
// --- WAV header --------------------------------------------------------------------

std::optional<WavInfo> readWavInfo (const void* data, size_t size, juce::String& error)
{
    const auto* b = static_cast<const juce::uint8*> (data);
    const auto tag = [&] (size_t o) { return juce::String (reinterpret_cast<const char*> (b + o), 4); };
    const auto u16 = [&] (size_t o) { return (int) (b[o] | (b[o + 1] << 8)); };
    const auto u32 = [&] (size_t o) { return (juce::uint32) b[o] | ((juce::uint32) b[o + 1] << 8) | ((juce::uint32) b[o + 2] << 16) | ((juce::uint32) b[o + 3] << 24); };
    if (size < 12 || tag (0) != "RIFF" || tag (8) != "WAVE")
    {
        error = "not a RIFF/WAVE file";
        return std::nullopt;
    }
    size_t off = 12;
    std::optional<WavInfo> fmt;
    juce::int64 dataBytes = -1;
    while (off + 8 <= size)
    {
        const auto id = tag (off);
        const auto chunk = u32 (off + 4);
        const size_t body = off + 8;
        if (id == "fmt " && body + 16 <= size)
        {
            int code = u16 (body);
            WavInfo w;
            w.channels = u16 (body + 2);
            w.sampleRate = (int) u32 (body + 4);
            w.bitsPerSample = u16 (body + 14);
            if (code == 0xfffe && chunk >= 40 && body + 26 <= size)
                code = u16 (body + 24);
            if (code != 1 && code != 3)
            {
                error = "unsupported WAV format code " + juce::String (code);
                return std::nullopt;
            }
            w.pcm = code == 1;
            fmt = w;
        }
        else if (id == "data")
        {
            dataBytes = std::min<juce::int64> (chunk, (juce::int64) size - (juce::int64) body);
            if (fmt)
                break;
        }
        off = body + chunk + (chunk & 1);
    }
    if (! fmt)
    {
        error = "missing fmt chunk";
        return std::nullopt;
    }
    if (dataBytes < 0)
    {
        error = "missing data chunk";
        return std::nullopt;
    }
    const int frameBytes = fmt->bitsPerSample / 8 * fmt->channels;
    if (frameBytes <= 0 || fmt->sampleRate <= 0)
    {
        error = "invalid fmt values";
        return std::nullopt;
    }
    fmt->dataBytes = dataBytes;
    fmt->frames = dataBytes / frameBytes;
    fmt->durationSec = (double) fmt->frames / fmt->sampleRate;
    return fmt;
}

// --- names and roles -----------------------------------------------------------

juce::String slugify (const juce::String& text, int maxLength)
{
    juce::String out;
    bool dash = false;
    for (auto c : text.toLowerCase())
    {
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))
        {
            if (dash && out.isNotEmpty())
                out << '-';
            out << juce::String::charToString (c);
            dash = false;
        }
        else
        {
            dash = true;
        }
        if (out.length() >= maxLength)
            break;
    }
    while (out.endsWithChar ('-'))
        out = out.dropLastCharacters (1);
    return out;
}

const juce::StringArray& knownRoles()
{
    static const juce::StringArray roles { "kick",  "snare",   "hat-closed", "hat-open", "clap",    "rim",   "tom-low",
                                           "tom-mid", "tom-high", "tom",     "crash",    "ride",    "cymbal", "cowbell",
                                           "conga", "bongo",   "clave",      "shaker",   "tambourine", "cabasa", "maracas",
                                           "agogo", "timbale", "triangle",   "woodblock", "percussion", "effects" };
    return roles;
}

juce::String labelForRole (const juce::String& role)
{
    static const std::map<juce::String, juce::String> labels {
        { "kick", "Kick" }, { "snare", "Snare" }, { "hat-closed", "Closed Hat" }, { "hat-open", "Open Hat" }, { "clap", "Clap" },
        { "rim", "Rim" }, { "tom-low", "Low Tom" }, { "tom-mid", "Mid Tom" }, { "tom-high", "High Tom" }, { "tom", "Tom" },
        { "crash", "Crash" }, { "ride", "Ride" }, { "cymbal", "Cymbal" }, { "cowbell", "Cowbell" }, { "conga", "Conga" },
        { "bongo", "Bongo" }, { "clave", "Clave" }, { "shaker", "Shaker" }, { "tambourine", "Tambourine" }, { "cabasa", "Cabasa" },
        { "maracas", "Maracas" }, { "agogo", "Agogo" }, { "timbale", "Timbale" }, { "triangle", "Triangle" },
        { "woodblock", "Woodblock" }, { "percussion", "Percussion" }, { "effects", "Effects" }
    };
    const auto it = labels.find (role);
    return it != labels.end() ? it->second : role;
}

juce::String suggestRole (const juce::String& fileName)
{
    // Words separated by anything that is not a letter or digit, plus the joined form for tokens like "openhat".
    auto name = juce::File::createFileWithoutCheckingPath (fileName).getFileNameWithoutExtension().toLowerCase();
    std::string s = " " + name.replaceCharacters ("_-.()[]{}#,+&", "             ").toStdString() + " ";
    const auto has = [&] (const char* pattern) { return std::regex_search (s, std::regex (pattern)); };
    if (has ("open ?h(i ?)?h(at)?|(^| )o ?hh?( |\\d)|(^| )hh ?o( |\\d)|ohat|hat ?open|open"))
        if (has ("hat|hh|(^| )oh"))
            return "hat-open";
    if (has ("(^| )oh\\d*( )"))
        return "hat-open";
    if (has ("hat|hihat|hi ?hat|(^| )c?hh\\d*( )|(^| )ch\\d*( )|closed"))
        return "hat-closed";
    if (has ("kick|kik|(^| )bd\\d*( )|bass ?drum|bassdrum"))
        return "kick";
    if (has ("snare|snr|(^| )sd\\d*( )|(^| )sn\\d*( )"))
        return "snare";
    if (has ("clap|(^| )cp\\d*( )|(^| )clp"))
        return "clap";
    if (has ("rim|(^| )rs\\d*( )|side ?stick|sidestick"))
        return "rim";
    if (has ("tom"))
    {
        if (has ("lo|low|floor|(^| )lt"))
            return "tom-low";
        if (has ("mid|med|(^| )mt"))
            return "tom-mid";
        if (has ("hi|high|(^| )ht"))
            return "tom-high";
        return "tom";
    }
    if (has ("crash|(^| )cr\\d*( )"))
        return "crash";
    if (has ("ride|(^| )rd\\d*( )"))
        return "ride";
    if (has ("cym|china|splash"))
        return "cymbal";
    if (has ("cowbell|cow ?bell|(^| )cb\\d*( )|(^| )cow"))
        return "cowbell";
    if (has ("conga"))
        return "conga";
    if (has ("bongo"))
        return "bongo";
    if (has ("clave|(^| )cl\\d*( )"))
        return "clave";
    if (has ("shaker|shake"))
        return "shaker";
    if (has ("tamb"))
        return "tambourine";
    if (has ("cabasa"))
        return "cabasa";
    if (has ("maraca"))
        return "maracas";
    if (has ("agogo"))
        return "agogo";
    if (has ("timbal"))
        return "timbale";
    if (has ("triangle|(^| )tri\\d*( )"))
        return "triangle";
    if (has ("wood ?block|(^| )block"))
        return "woodblock";
    if (has ("perc"))
        return "percussion";
    if (has ("(^| )fx|effect|sfx|noise|zap"))
        return "effects";
    return {};
}

// --- scan ------------------------------------------------------------------------

namespace
{
    bool isAudioExtension (const juce::File& f)
    {
        return f.hasFileExtension ("wav;wave;aif;aiff;aifc;flac");
    }

    bool isHidden (const juce::File& f)
    {
        const auto n = f.getFileName();
        return n.startsWithChar ('.') || n == "__MACOSX";
    }

    void addRejected (ScanResult& r, const juce::File& f, const juce::String& reason, const ScanLimits& limits)
    {
        ++r.rejectedTotal;
        if ((int) r.rejected.size() < limits.maxRejectedListed)
            r.rejected.push_back ({ f, reason });
    }

    void examine (ScanResult& r, const juce::File& f, const juce::File& base, const ScanLimits& limits)
    {
        if (! isAudioExtension (f))
        {
            addRejected (r, f, "not a supported audio file type", limits);
            return;
        }
        if (f.getSize() > limits.maxFileBytes)
        {
            addRejected (r, f, "file is too large", limits);
            return;
        }
        std::unique_ptr<juce::AudioFormatReader> reader (audioFormats().createReaderFor (f));
        if (reader == nullptr)
        {
            addRejected (r, f, "not readable as WAV, AIFF or FLAC", limits);
            return;
        }
        const double rate = reader->sampleRate;
        const double duration = rate > 0 ? (double) reader->lengthInSamples / rate : 0;
        if (reader->numChannels < 1 || reader->numChannels > 2)
            addRejected (r, f, juce::String ((int) reader->numChannels) + " channels; only mono and stereo are supported", limits);
        else if (rate < 8000 || rate > 192000)
            addRejected (r, f, "sample rate outside 8-192 kHz", limits);
        else if (reader->lengthInSamples <= 0)
            addRejected (r, f, "no audio frames", limits);
        else if (duration > limits.maxDurationSec)
            addRejected (r, f, "longer than 60 s; only one-shots are supported", limits);
        else
        {
            ScanCandidate c;
            c.file = f;
            c.relPath = base == juce::File() ? f.getFileName() : f.getRelativePathFrom (base).replaceCharacter ('\\', '/');
            c.name = f.getFileNameWithoutExtension();
            c.format = f.getFileExtension().substring (1).toLowerCase();
            c.channels = (int) reader->numChannels;
            c.sampleRate = rate;
            c.durationSec = duration;
            c.bytes = f.getSize();
            c.suggestedRole = suggestRole (f.getFileName());
            r.candidates.push_back (c);
        }
    }

    void walk (ScanResult& r, const juce::File& dir, const juce::File& base, int depth, const ScanLimits& limits,
               const std::atomic<bool>* cancel, const std::function<void (int, int)>& progress)
    {
        if (depth > limits.maxDepth)
        {
            r.truncated = true;
            return;
        }
        auto children = dir.findChildFiles (juce::File::findFilesAndDirectories, false, "*", juce::File::FollowSymlinks::no);
        children.sort();
        for (const auto& f : children)
        {
            if (cancel != nullptr && cancel->load())
            {
                r.cancelled = true;
                return;
            }
            if (r.examined >= limits.maxEntries || (int) r.candidates.size() >= limits.maxCandidates)
            {
                r.truncated = true;
                return;
            }
            if (isHidden (f))
                continue;
            ++r.examined;
            if (f.isSymbolicLink())
            {
                // Symlinked folders are never followed (they can loop or leave the chosen folder).
                if (f.isDirectory())
                    continue;
            }
            if (f.isDirectory())
                walk (r, f, base, depth + 1, limits, cancel, progress);
            else
                examine (r, f, base, limits);
            if (progress && r.examined % 64 == 0)
                progress (r.examined, (int) r.candidates.size());
            if (r.cancelled)
                return;
        }
    }
} // namespace

ScanResult scanForAudio (const juce::Array<juce::File>& items, const ScanLimits& limits, const std::atomic<bool>* cancel,
                         const std::function<void (int, int)>& progress)
{
    ScanResult r;
    int folders = 0;
    for (const auto& item : items)
        folders += item.isDirectory() ? 1 : 0;
    if (items.size() == 1 && folders == 1)
        r.folder = items[0];
    for (const auto& item : items)
    {
        if (r.cancelled || r.truncated)
            break;
        if (item.isDirectory())
            walk (r, item, item, 0, limits, cancel, progress);
        else if (item.existsAsFile())
        {
            ++r.examined;
            examine (r, item, r.folder != juce::File() ? r.folder : juce::File(), limits);
        }
        else
            addRejected (r, item, "not found", limits);
    }
    if (progress)
        progress (r.examined, (int) r.candidates.size());
    return r;
}

// --- library writing -------------------------------------------------------------

namespace
{
    juce::var samplesJson (const std::map<juce::String, ImportedSample>& table)
    {
        auto root = makeObject();
        setProp (root, "format", "vdvm-library-samples");
        setProp (root, "version", 1);
        auto obj = makeObject();
        for (const auto& [sha, s] : table)
        {
            auto o = makeObject();
            setProp (o, "name", s.name);
            setProp (o, "originalPath", s.originalPath);
            setProp (o, "format", s.format);
            setProp (o, "suggestedRole", s.suggestedRole);
            setProp (o, "importedAt", s.importedAt);
            setProp (o, "channels", s.channels);
            setProp (o, "sampleRate", s.sampleRate);
            setProp (o, "durationSec", s.durationSec);
            setProp (o, "bytes", (juce::int64) s.bytes);
            setProp (o, "peakDbfs", s.peakDbfs ? juce::var (*s.peakDbfs) : juce::var());
            setProp (obj, sha, o);
        }
        setProp (root, "samples", obj);
        return root;
    }

    juce::var linksJson (const std::map<juce::String, LinkEntry>& table)
    {
        auto root = makeObject();
        auto obj = makeObject();
        for (const auto& [sha, e] : table)
        {
            auto o = makeObject();
            setProp (o, "path", e.path);
            setProp (o, "bytes", (juce::int64) e.bytes);
            setProp (o, "modifiedMs", (juce::int64) e.modifiedMs);
            setProp (obj, sha, o);
        }
        setProp (root, "links", obj);
        return root;
    }

    std::optional<double> peakDbfsOf (const juce::AudioBuffer<float>& pcm)
    {
        float peak = 0;
        for (int c = 0; c < pcm.getNumChannels(); ++c)
            peak = std::max (peak, pcm.getMagnitude (c, 0, pcm.getNumSamples()));
        if (peak <= 0)
            return std::nullopt;
        return std::min (0.0, std::floor (20 * std::log10 ((double) peak) * 100 + 0.5) / 100);
    }

    /** WAV bytes for the managed store: the original when the catalog reader accepts it, else 24-bit PCM. */
    bool storedWavBytes (const juce::File& source, const juce::MemoryBlock& original, const Decoded& decoded, juce::MemoryBlock& out,
                         juce::String& error)
    {
        juce::String wavError;
        if (const auto info = readWavInfo (original.getData(), original.getSize(), wavError))
        {
            if (info->channels == decoded.pcm.getNumChannels() && info->sampleRate == (int) decoded.rate
                && info->frames == decoded.pcm.getNumSamples())
            {
                out = original;
                return true;
            }
        }
        juce::ignoreUnused (source);
        auto stream = std::make_unique<juce::MemoryOutputStream> (out, false);
        std::unique_ptr<juce::OutputStream> base (stream.release());
        juce::WavAudioFormat wav;
        auto writer = wav.createWriterFor (base, juce::AudioFormatWriterOptions {}
                                                     .withSampleRate (decoded.rate)
                                                     .withNumChannels (decoded.pcm.getNumChannels())
                                                     .withBitsPerSample (24));
        if (writer == nullptr || ! writer->writeFromAudioSampleBuffer (decoded.pcm, 0, decoded.pcm.getNumSamples()))
        {
            error = "could not convert to WAV";
            return false;
        }
        writer.reset();
        juce::String check;
        if (! readWavInfo (out.getData(), out.getSize(), check))
        {
            error = "converted WAV failed the catalog check: " + check;
            return false;
        }
        return true;
    }

    struct Writable
    {
        std::shared_ptr<Library> lib;
        LibraryRecord rec;
    };

    std::optional<Writable> writableLibrary (LibraryManager& m, const juce::String& id, juce::String& error)
    {
        auto lib = m.get (id, error);
        if (! lib)
            return std::nullopt;
        if (! lib->writable())
        {
            error = lib->record().name + " is read-only. Import into one of your own libraries.";
            return std::nullopt;
        }
        return Writable { lib, lib->record() };
    }

    juce::File pooledFile (const LibraryRecord& r, const juce::String& sha) { return r.root.getChildFile ("pool/" + sha + ".wav"); }
    juce::File assignedFile (const LibraryRecord& r, const juce::String& sha) { return r.root.getChildFile ("media/audio/" + sha + ".wav"); }

    /** Stored location of an imported sample in a user library, wherever it is now. */
    juce::File storedFile (const LibraryRecord& r, const juce::String& sha)
    {
        const auto a = assignedFile (r, sha);
        return a.existsAsFile() ? a : pooledFile (r, sha);
    }

    juce::String machineIdFor (const LibraryRecord& r)
    {
        auto slug = slugify (r.name, 40);
        if (slug.isEmpty())
            slug = "library";
        return "user-" + slug + "-" + r.id.getLastCharacters (6);
    }

    /** Rewrite the index from the kit manifests on disk and place audio files (assigned vs pool). */
    bool rebuildLibrary (const LibraryRecord& r, const std::vector<KitManifest>& kits, juce::String& error)
    {
        CatalogIndex index;
        index.creditsUrl = "catalog/credits.json";
        if (! kits.empty())
        {
            Machine m;
            m.id = machineIdFor (r);
            m.manufacturer = "User";
            m.model = r.name;
            m.displayName = r.name;
            m.kind = "unknown";
            m.identityStatus = "unresolved";
            index.machines.push_back (m);
        }
        std::set<juce::String> used;
        for (const auto& k : kits)
        {
            index.kits.push_back ({ k.id, k.machineId, k.label, k.revision, "catalog/kits/" + k.id + "/" + k.revision + ".json" });
            for (const auto& s : k.samples)
                used.insert (s.blobSha256);
        }
        auto json = toJson (index);
        setProp (json, "revision", revisionOf (json));
        if (r.kind == LibraryKind::user)
        {
            // Audio a kit uses lives in media/audio; the rest waits in pool/.
            r.root.getChildFile ("media/audio").createDirectory();
            r.root.getChildFile ("pool").createDirectory();
            for (const auto& f : r.root.getChildFile ("pool").findChildFiles (juce::File::findFiles, false, "*.wav"))
                if (used.count (f.getFileNameWithoutExtension()) > 0)
                    f.moveFileTo (assignedFile (r, f.getFileNameWithoutExtension()));
            for (const auto& f : r.root.getChildFile ("media/audio").findChildFiles (juce::File::findFiles, false, "*.wav"))
                if (used.count (f.getFileNameWithoutExtension()) == 0)
                    f.moveFileTo (pooledFile (r, f.getFileNameWithoutExtension()));
            r.root.getChildFile ("pool").createDirectory();
        }
        // Remove manifests that are no longer the current revision of a kit.
        std::set<juce::String> current;
        for (const auto& k : kits)
            current.insert ("catalog/kits/" + k.id + "/" + k.revision + ".json");
        for (const auto& f : r.root.getChildFile ("catalog/kits").findChildFiles (juce::File::findFiles, true, "*.json"))
        {
            const auto rel = f.getRelativePathFrom (r.root).replaceCharacter ('\\', '/');
            if (current.count (rel) == 0)
                f.deleteFile();
        }
        for (const auto& d : r.root.getChildFile ("catalog/kits").findChildFiles (juce::File::findDirectories, false))
            if (d.getNumberOfChildFiles (juce::File::findFilesAndDirectories) == 0)
                d.deleteRecursively();
        if (! writeFileAtomic (r.root.getChildFile ("catalog/index.json"), stableJson (json)))
        {
            error = "Could not write the library index.";
            return false;
        }
        return true;
    }

    std::vector<KitManifest> loadAllKits (const Library& lib, juce::String& error)
    {
        std::vector<KitManifest> kits;
        for (const auto& e : lib.index().kits)
        {
            auto k = lib.loadKit (e.id, error);
            if (k)
                kits.push_back (*k);
        }
        return kits;
    }

    juce::String sampleIdFor (const juce::String& kitId, const juce::String& sha)
    {
        const auto key = kitId + ":" + sha;
        return "s-" + sha256Hex (key.toRawUTF8(), (size_t) key.getNumBytesAsUTF8()).substring (0, 20);
    }
} // namespace

ImportOutcome importSamples (LibraryManager& libraries, const juce::String& libraryId, const std::vector<ScanCandidate>& candidates,
                             const std::atomic<bool>* cancel, const std::function<void (int, int)>& progress)
{
    ImportOutcome outcome;
    juce::String error;
    const auto w = writableLibrary (libraries, libraryId, error);
    if (! w)
    {
        outcome.failed.push_back ({ {}, error });
        return outcome;
    }
    const auto& rec = w->rec;
    auto table = w->lib->imported();
    auto links = w->lib->links();
    int done = 0;
    for (const auto& c : candidates)
    {
        if (cancel != nullptr && cancel->load())
        {
            outcome.cancelled = true;
            break;
        }
        juce::MemoryBlock bytes;
        if (c.file.getSize() > 512ll * 1024 * 1024 || ! c.file.loadFileAsData (bytes))
        {
            outcome.failed.push_back ({ c.file, "could not read the file" });
            continue;
        }
        const auto decoded = decodeAudioData (bytes.getData(), bytes.getSize(), c.file.getFileName());
        if (decoded.error.isNotEmpty())
        {
            outcome.failed.push_back ({ c.file, decoded.error });
            continue;
        }
        ImportedSample s;
        s.name = c.name.isNotEmpty() ? c.name : c.file.getFileNameWithoutExtension();
        s.originalPath = c.file.getFullPathName();
        s.format = c.file.getFileExtension().substring (1).toLowerCase();
        s.suggestedRole = c.suggestedRole;
        s.importedAt = isoNow();
        s.channels = decoded.pcm.getNumChannels();
        s.sampleRate = (int) decoded.rate;
        s.peakDbfs = peakDbfsOf (decoded.pcm);
        if (rec.kind == LibraryKind::user)
        {
            juce::MemoryBlock stored;
            juce::String convertError;
            if (! storedWavBytes (c.file, bytes, decoded, stored, convertError))
            {
                outcome.failed.push_back ({ c.file, convertError });
                continue;
            }
            juce::String wavError;
            const auto info = readWavInfo (stored.getData(), stored.getSize(), wavError);
            s.sha256 = sha256Hex (stored.getData(), stored.getSize());
            s.bytes = (juce::int64) stored.getSize();
            s.durationSec = info->durationSec;
            if (! storedFile (rec, s.sha256).existsAsFile() && ! writeFileAtomic (pooledFile (rec, s.sha256), stored))
            {
                outcome.failed.push_back ({ c.file, "could not write to the library folder" });
                continue;
            }
        }
        else
        {
            // Linked: the original file is the audio. Its hash identifies it; the catalog reader rules still apply.
            const auto base = canonicalFile (rec.linkedRoot);
            const auto real = canonicalFile (c.file);
            if (! real.isAChildOf (base))
            {
                outcome.failed.push_back ({ c.file, "not inside the linked folder " + rec.linkedRoot.getFullPathName() });
                continue;
            }
            juce::String wavError;
            const auto info = readWavInfo (bytes.getData(), bytes.getSize(), wavError);
            if (! info)
            {
                outcome.failed.push_back ({ c.file, "linked files must be PCM or float WAV (" + wavError + "); copy it instead" });
                continue;
            }
            s.sha256 = sha256Hex (bytes.getData(), bytes.getSize());
            s.bytes = (juce::int64) bytes.getSize();
            s.durationSec = info->durationSec;
            links[s.sha256] = { real.getRelativePathFrom (base).replaceCharacter ('\\', '/'), s.bytes,
                                real.getLastModificationTime().toMilliseconds() };
        }
        if (const auto it = table.find (s.sha256); it != table.end())
            outcome.imported.push_back (it->second); // same audio already here: reuse it
        else
        {
            table[s.sha256] = s;
            outcome.imported.push_back (s);
        }
        if (progress)
            progress (++done, (int) candidates.size());
    }
    writeFileAtomic (rec.root.getChildFile ("samples.json"), stableJson (samplesJson (table)));
    if (rec.kind == LibraryKind::linked)
        writeFileAtomic (rec.root.getChildFile ("links.json"), stableJson (linksJson (links)));
    libraries.invalidate (libraryId);
    return outcome;
}

juce::String saveKit (LibraryManager& libraries, const juce::String& libraryId, const KitDraft& draft, juce::String& error)
{
    const auto w = writableLibrary (libraries, libraryId, error);
    if (! w)
        return {};
    const auto& rec = w->rec;
    const auto& table = w->lib->imported();
    auto kits = loadAllKits (*w->lib, error);
    error = {};

    KitManifest kit;
    kit.label = draft.label.trim().isEmpty() ? juce::String ("Untitled kit") : draft.label.trim();
    if (draft.kitId.isNotEmpty())
    {
        if (w->lib->index().kitEntry (draft.kitId) == nullptr)
        {
            error = "That kit is no longer in this library.";
            return {};
        }
        kit.id = draft.kitId;
    }
    else
    {
        auto base = slugify (kit.label, 60);
        if (base.isEmpty())
            base = "kit";
        juce::String id;
        do
            id = base + "-" + juce::String::toHexString (juce::Random::getSystemRandom().nextInt()).paddedLeft ('0', 8).substring (0, 6);
        while (w->lib->index().kitEntry (id) != nullptr);
        kit.id = id;
    }
    kit.machineId = machineIdFor (rec);

    std::set<juce::String> slotIds;
    std::set<juce::String> sampleIdsInKit;
    for (const auto& d : draft.slots)
    {
        juce::StringArray shas;
        for (const auto& sha : d.sampleShas)
            if (table.count (sha) > 0 && ! shas.contains (sha))
                shas.add (sha);
        if (shas.isEmpty())
            continue;
        Slot slot;
        auto id = d.id.isNotEmpty() && isValidId (d.id) ? d.id : d.role.isNotEmpty() && isValidId (d.role) ? d.role : slugify (d.label, 40);
        if (id.isEmpty())
            id = "pad";
        if (slotIds.count (id) > 0)
        {
            int n = 2;
            while (slotIds.count (id + "-" + juce::String (n)) > 0)
                ++n;
            id = id + "-" + juce::String (n);
        }
        slotIds.insert (id);
        slot.id = id;
        const auto role = d.role.isNotEmpty() ? d.role : id;
        slot.label = d.label.trim().isNotEmpty() ? d.label.trim() : labelForRole (role);
        slot.category = categoryForRole (role);
        slot.icon = iconForRole (role);
        // v1 convention: both hat slots share the "hi-hat" group; the closed hat chokes the open hat.
        slot.chokeGroup = id == "hat-closed" || id == "hat-open" ? juce::String ("hi-hat") : juce::String();
        slot.gainDb = 0;
        const auto defaultSha = shas.contains (d.defaultSha) ? d.defaultSha : shas[0];
        for (const auto& sha : shas)
        {
            const auto sid = sampleIdFor (kit.id, sha);
            slot.sampleIds.add (sid);
            if (sha == defaultSha)
                slot.defaultSampleId = sid;
            if (sampleIdsInKit.insert (sid).second)
            {
                const auto& meta = table.at (sha);
                Sample s;
                s.id = sid;
                s.label = meta.name.isNotEmpty() ? meta.name : juce::String();
                s.blobSha256 = sha;
                s.url = "media/audio/" + sha + ".wav";
                s.bytes = meta.bytes;
                s.durationSec = meta.durationSec;
                s.channels = meta.channels;
                s.sampleRate = meta.sampleRate;
                s.gainDb = 0;
                s.peakDbfs = meta.peakDbfs;
                kit.samples.push_back (s);
            }
        }
        kit.slots.push_back (slot);
    }
    if (kit.slots.empty())
    {
        error = "A kit needs at least one pad with a sound.";
        return {};
    }
    auto json = toJson (kit);
    kit.revision = revisionOf (json);
    setProp (json, "revision", kit.revision);
    // Validate exactly as a loader would before anything is written.
    juce::StringArray parseErrors;
    const auto check = parseKit (json, parseErrors);
    if (! check || ! checkKit (*check).isEmpty())
    {
        error = "Internal error: the kit failed validation (" + (check ? checkKit (*check)[0] : parseErrors[0]) + ")";
        return {};
    }
    kits.erase (std::remove_if (kits.begin(), kits.end(), [&] (const auto& k) { return k.id == kit.id; }), kits.end());
    kits.push_back (kit);
    if (! writeFileAtomic (rec.root.getChildFile ("catalog/kits/" + kit.id + "/" + kit.revision + ".json"), stableJson (json)))
    {
        error = "Could not write the kit.";
        return {};
    }
    if (! rebuildLibrary (rec, kits, error))
        return {};
    libraries.invalidate (libraryId);
    return kit.id;
}

bool deleteKit (LibraryManager& libraries, const juce::String& libraryId, const juce::String& kitId, juce::String& error)
{
    const auto w = writableLibrary (libraries, libraryId, error);
    if (! w)
        return false;
    auto kits = loadAllKits (*w->lib, error);
    error = {};
    const auto before = kits.size();
    kits.erase (std::remove_if (kits.begin(), kits.end(), [&] (const auto& k) { return k.id == kitId; }), kits.end());
    if (kits.size() == before)
    {
        error = "That kit is not in this library.";
        return false;
    }
    const bool ok = rebuildLibrary (w->rec, kits, error);
    libraries.invalidate (libraryId);
    return ok;
}

int removeUnusedSamples (LibraryManager& libraries, const juce::String& libraryId, const juce::StringArray& shas, juce::String& error)
{
    const auto w = writableLibrary (libraries, libraryId, error);
    if (! w)
        return 0;
    std::set<juce::String> used;
    for (const auto& k : loadAllKits (*w->lib, error))
        for (const auto& s : k.samples)
            used.insert (s.blobSha256);
    error = {};
    auto table = w->lib->imported();
    auto links = w->lib->links();
    int removed = 0;
    for (const auto& sha : shas)
    {
        if (used.count (sha) > 0 || table.erase (sha) == 0)
            continue;
        links.erase (sha);
        if (w->rec.kind == LibraryKind::user)
            pooledFile (w->rec, sha).deleteFile();
        ++removed;
    }
    writeFileAtomic (w->rec.root.getChildFile ("samples.json"), stableJson (samplesJson (table)));
    if (w->rec.kind == LibraryKind::linked)
        writeFileAtomic (w->rec.root.getChildFile ("links.json"), stableJson (linksJson (links)));
    libraries.invalidate (libraryId);
    return removed;
}

juce::String copyKit (LibraryManager& libraries, const juce::String& fromId, const juce::String& kitId, const juce::String& toId,
                      juce::String& error)
{
    auto from = libraries.get (fromId, error);
    if (! from)
        return {};
    const auto kit = from->loadKit (kitId, error);
    if (! kit)
        return {};
    const auto to = writableLibrary (libraries, toId, error);
    if (! to || to->rec.kind != LibraryKind::user)
    {
        if (error.isEmpty())
            error = "Kits can only be copied into a library that stores its own audio.";
        return {};
    }
    // Copy audio (verified against the source hash) into the destination pool and record it as imported.
    auto table = to->lib->imported();
    for (const auto& s : kit->samples)
    {
        if (table.count (s.blobSha256) > 0)
            continue;
        const auto file = from->sampleFile (s);
        juce::MemoryBlock bytes;
        if (! file || ! file->loadFileAsData (bytes) || sha256Hex (bytes.getData(), bytes.getSize()) != s.blobSha256)
        {
            error = "Sound " + (s.label.isNotEmpty() ? s.label : s.id) + " is missing or damaged in " + from->record().name + ".";
            return {};
        }
        juce::String wavError;
        const auto info = readWavInfo (bytes.getData(), bytes.getSize(), wavError);
        if (! info)
        {
            error = "Sound " + s.id + " is not a catalog WAV: " + wavError;
            return {};
        }
        if (! storedFile (to->rec, s.blobSha256).existsAsFile() && ! writeFileAtomic (pooledFile (to->rec, s.blobSha256), bytes))
        {
            error = "Could not write to " + to->rec.root.getFullPathName();
            return {};
        }
        ImportedSample m;
        m.sha256 = s.blobSha256;
        m.name = s.label.isNotEmpty() ? s.label : s.id;
        m.originalPath = from->record().name + ": " + kit->label;
        m.format = "wav";
        m.importedAt = isoNow();
        m.channels = info->channels;
        m.sampleRate = info->sampleRate;
        m.durationSec = info->durationSec;
        m.bytes = (juce::int64) bytes.getSize();
        m.peakDbfs = s.peakDbfs;
        table[s.blobSha256] = m;
    }
    writeFileAtomic (to->rec.root.getChildFile ("samples.json"), stableJson (samplesJson (table)));
    libraries.invalidate (toId);
    KitDraft draft;
    const auto* machine = from->index().machine (kit->machineId);
    draft.label = machine != nullptr && ! kit->label.startsWith (machine->displayName) ? machine->displayName + " " + kit->label : kit->label;
    for (const auto& slot : kit->slots)
    {
        SlotDraft d;
        d.id = slot.id;
        d.role = knownRoles().contains (slot.id) ? slot.id : juce::String();
        d.label = slot.label;
        for (const auto& sid : slot.sampleIds)
            if (const auto* s = kit->sample (sid))
                d.sampleShas.add (s->blobSha256);
        if (const auto* def = kit->sample (slot.defaultSampleId))
            d.defaultSha = def->blobSha256;
        draft.slots.push_back (d);
    }
    return saveKit (libraries, toId, draft, error);
}

RelinkOutcome relinkLibrary (LibraryManager& libraries, const juce::String& libraryId, const juce::File& newRoot, juce::String& error,
                             const std::atomic<bool>* cancel)
{
    RelinkOutcome out;
    auto lib = libraries.get (libraryId, error);
    if (! lib || lib->record().kind != LibraryKind::linked)
    {
        if (error.isEmpty())
            error = "Only linked libraries can be relinked to a folder.";
        return out;
    }
    if (! newRoot.isDirectory())
    {
        error = "Folder not found.";
        return out;
    }
    auto links = lib->links();
    std::map<juce::String, LinkEntry> fixed;
    std::vector<juce::String> unresolved;
    const auto base = canonicalFile (newRoot);
    for (const auto& [sha, e] : links)
    {
        const auto f = base.getChildFile (e.path);
        if (f.existsAsFile() && canonicalFile (f).isAChildOf (base) && f.getSize() == e.bytes && sha256Hex (f) == sha)
            fixed[sha] = { e.path, e.bytes, f.getLastModificationTime().toMilliseconds() };
        else
            unresolved.push_back (sha);
    }
    if (! unresolved.empty())
    {
        // Search by size first, hash only those candidates.
        std::multimap<juce::int64, juce::File> bySize;
        int seen = 0;
        for (const auto& entry : juce::RangedDirectoryIterator (newRoot, true, "*", juce::File::findFiles, juce::File::FollowSymlinks::no))
        {
            if ((cancel != nullptr && cancel->load()) || ++seen > 200000)
                break;
            if (isAudioExtension (entry.getFile()))
                bySize.emplace (entry.getFileSize(), entry.getFile());
        }
        for (const auto& sha : unresolved)
        {
            const auto& e = links.at (sha);
            bool found = false;
            const auto range = bySize.equal_range (e.bytes);
            for (auto it = range.first; it != range.second && ! found; ++it)
            {
                if (sha256Hex (it->second) == sha)
                {
                    const auto real = canonicalFile (it->second);
                    if (! real.isAChildOf (base))
                        continue;
                    fixed[sha] = { real.getRelativePathFrom (base).replaceCharacter ('\\', '/'), e.bytes,
                                   real.getLastModificationTime().toMilliseconds() };
                    found = true;
                }
            }
            if (! found)
            {
                fixed[sha] = e; // keep the old link so a later relink can still find it
                ++out.missing;
                const auto meta = lib->imported().find (sha);
                out.missingNames.add (meta != lib->imported().end() ? meta->second.name : sha.substring (0, 12));
            }
        }
    }
    out.found = (int) links.size() - out.missing;
    if (! libraries.relocate (libraryId, newRoot, error))
        return out;
    writeFileAtomic (lib->record().root.getChildFile ("links.json"), stableJson (linksJson (fixed)));
    libraries.invalidate (libraryId);
    return out;
}

LibraryHealth checkLibrary (LibraryManager& libraries, const juce::String& libraryId)
{
    LibraryHealth h;
    juce::String error;
    auto lib = libraries.get (libraryId, error);
    if (! lib)
    {
        h.problems.add (error);
        return h;
    }
    std::set<juce::String> seen;
    for (const auto& e : lib->index().kits)
    {
        const auto kit = lib->loadKit (e.id, error);
        if (! kit)
        {
            h.problems.add (error);
            continue;
        }
        ++h.kits;
        for (const auto& s : kit->samples)
        {
            if (! seen.insert (s.blobSha256).second)
                continue;
            ++h.samples;
            const auto f = lib->sampleFile (s);
            if (! f || ! f->existsAsFile())
            {
                ++h.missing;
                continue;
            }
            if (lib->record().kind == LibraryKind::linked)
            {
                const auto it = lib->links().find (s.blobSha256);
                if (it != lib->links().end()
                    && (f->getSize() != it->second.bytes || f->getLastModificationTime().toMilliseconds() != it->second.modifiedMs))
                    ++h.changed;
            }
            else if (f->getSize() != s.bytes)
            {
                ++h.changed;
            }
        }
    }
    return h;
}
} // namespace drums
