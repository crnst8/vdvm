#include "SampleStore.h"
#include "Constants.h"
#include "Json.h"
#include "Resampler.h"

namespace drums
{
juce::AudioFormatManager& audioFormats()
{
    static juce::AudioFormatManager* manager = []
    {
        auto* m = new juce::AudioFormatManager();
        m->registerFormat (new juce::WavAudioFormat(), true);
        m->registerFormat (new juce::AiffAudioFormat(), false);
        m->registerFormat (new juce::FlacAudioFormat(), false);
        return m;
    }();
    return *manager;
}

namespace
{
    Decoded decodeStream (std::unique_ptr<juce::InputStream> stream, const juce::String& name, const DecodeLimits& limits)
    {
        Decoded out;
        auto& formats = audioFormats();
        std::unique_ptr<juce::AudioFormatReader> reader;
        // Prefer the format matching the extension, then try the others (files are often misnamed).
        const auto ext = juce::File::createFileWithoutCheckingPath (name).getFileExtension();
        auto* data = stream.release();
        for (int pass = 0; pass < 2 && reader == nullptr; ++pass)
        {
            for (int i = 0; i < formats.getNumKnownFormats() && reader == nullptr; ++i)
            {
                auto* f = formats.getKnownFormat (i);
                const bool matches = f->canHandleFile (juce::File::createFileWithoutCheckingPath ("x" + ext));
                if (matches != (pass == 0))
                    continue;
                data->setPosition (0);
                reader.reset (f->createReaderFor (data, false));
                if (reader != nullptr)
                    out.formatName = f->getFormatName();
            }
        }
        if (reader == nullptr)
        {
            delete data;
            out.error = "not a supported audio file (WAV, AIFF or FLAC)";
            return out;
        }
        // The reader now owns `data`.
        const auto channels = (int) reader->numChannels;
        const auto rate = reader->sampleRate;
        const auto frames = reader->lengthInSamples;
        if (channels < 1 || channels > limits.maxChannels)
            out.error = juce::String (channels) + " channels; only mono and stereo are supported";
        else if (rate < limits.minRate || rate > limits.maxRate)
            out.error = "sample rate " + juce::String (rate) + " Hz is outside 8-192 kHz";
        else if (frames <= 0)
            out.error = "no audio frames";
        else if ((double) frames / rate > limits.maxDurationSec)
            out.error = "longer than " + juce::String ((int) limits.maxDurationSec) + " s; only one-shots are supported";
        if (out.error.isNotEmpty())
            return out;
        out.pcm.setSize (channels, (int) frames);
        if (! reader->read (&out.pcm, 0, (int) frames, 0, true, true))
        {
            out.pcm.setSize (0, 0);
            out.error = "could not decode the audio data";
            return out;
        }
        out.rate = rate;
        return out;
    }
} // namespace

Decoded decodeAudioData (const void* bytes, size_t size, const juce::String& name, const DecodeLimits& limits)
{
    return decodeStream (std::make_unique<juce::MemoryInputStream> (bytes, size, false), name, limits);
}

Decoded decodeAudioFile (const juce::File& file, const juce::String& expectedSha, const DecodeLimits& limits)
{
    Decoded out;
    if (! file.existsAsFile())
    {
        out.error = "file not found: " + file.getFullPathName();
        return out;
    }
    if (file.getSize() > limits.maxFileBytes)
    {
        out.error = "file is larger than " + juce::String (limits.maxFileBytes / (1024 * 1024)) + " MB";
        return out;
    }
    juce::MemoryBlock bytes;
    if (! file.loadFileAsData (bytes))
    {
        out.error = "could not read " + file.getFullPathName();
        return out;
    }
    if (expectedSha.isNotEmpty() && sha256Hex (bytes.getData(), bytes.getSize()) != expectedSha)
    {
        out.error = "content does not match its catalog hash (file changed or damaged)";
        return out;
    }
    auto stream = std::make_unique<juce::MemoryInputStream> (std::move (bytes));
    return decodeStream (std::move (stream), file.getFileName(), limits);
}

// --- loudness cache ------------------------------------------------------------

LoudnessCache& LoudnessCache::instance()
{
    static LoudnessCache cache;
    return cache;
}

void LoudnessCache::setFile (const juce::File& f)
{
    std::lock_guard lock (mutex);
    file = f;
    juce::String err;
    const auto json = parseJson (f.loadFileAsString(), err);
    if (! json || (int) (*json)["version"] != normalisationAlgorithmVersion)
        return; // absent, damaged or from another algorithm version: start empty
    if (auto* obj = (*json)["levels"].getDynamicObject())
    {
        for (const auto& p : obj->getProperties())
        {
            const auto& v = p.value;
            if (! v.isArray() || v.size() != 2)
                continue;
            const auto read = [] (const juce::var& x) { return x.isVoid() ? -INFINITY : (double) x; };
            levels[p.name.toString()] = { read (v[0]), read (v[1]) };
        }
    }
}

std::optional<HitLevel> LoudnessCache::get (const juce::String& sha)
{
    std::lock_guard lock (mutex);
    const auto it = levels.find (sha);
    if (it == levels.end())
        return std::nullopt;
    return it->second;
}

void LoudnessCache::put (const juce::String& sha, const HitLevel& level)
{
    {
        std::lock_guard lock (mutex);
        levels[sha] = level;
        if (++unsaved < 64)
            return;
    }
    flush();
}

void LoudnessCache::flush()
{
    std::lock_guard lock (mutex);
    if (file == juce::File() || unsaved == 0)
        return;
    auto root = makeObject();
    setProp (root, "version", normalisationAlgorithmVersion);
    auto obj = makeObject();
    for (const auto& [sha, l] : levels)
    {
        juce::Array<juce::var> pair;
        pair.add (std::isfinite (l.lufs) ? juce::var (l.lufs) : juce::var());
        pair.add (std::isfinite (l.peakDb) ? juce::var (l.peakDb) : juce::var());
        setProp (obj, sha, pair);
    }
    setProp (root, "levels", obj);
    writeFileAtomic (file, juce::JSON::toString (root, true));
    unsaved = 0;
}

// --- store ---------------------------------------------------------------------

SampleStore::SampleStore (size_t budget, int threads)
    : budgetBytes (budget),
      pool (juce::ThreadPoolOptions {}.withThreadName ("V.D.V.M samples").withNumberOfThreads (threads))
{
}

SampleStore::~SampleStore()
{
    pool.removeAllJobs (true, 10000);
}

void SampleStore::setTargetRate (double rate)
{
    target = rate > 0 ? rate : 48000.0;
}

void SampleStore::setBudget (size_t bytes)
{
    std::lock_guard lock (mutex);
    budgetBytes = bytes;
    evictLocked();
}

SamplePtr SampleStore::get (const juce::String& sha) const
{
    std::lock_guard lock (mutex);
    const auto it = entries.find (sha);
    if (it == entries.end() || it->second.data->rate != target.load())
        return nullptr;
    it->second.lastUsed = ++clock;
    return it->second.data;
}

SamplePtr SampleStore::loadNow (const LoadRequest& req, juce::String& error)
{
    const double rate = target.load();
    {
        std::unique_lock lock (mutex);
        for (;;)
        {
            const auto it = entries.find (req.sha256);
            if (it != entries.end() && it->second.data->rate == rate)
            {
                it->second.lastUsed = ++clock;
                return it->second.data;
            }
            if (inflight.count (req.sha256) == 0)
                break;
            inflightDone.wait (lock);
        }
        inflight.insert (req.sha256);
    }
    auto decoded = decodeAudioFile (req.file, req.verifyHash ? req.sha256 : juce::String());
    std::shared_ptr<SampleData> data;
    if (decoded.error.isEmpty())
    {
        data = std::make_shared<SampleData>();
        data->sha256 = req.sha256;
        data->sourceRate = decoded.rate;
        auto cached = LoudnessCache::instance().get (req.sha256);
        if (! cached)
        {
            cached = measureHit (decoded.pcm, decoded.rate);
            LoudnessCache::instance().put (req.sha256, *cached);
        }
        data->level = *cached;
        data->normalisationDb = drums::normalisationDb (*cached);
        data->pcm = resampleBuffer (decoded.pcm, decoded.rate, rate);
        data->rate = rate;
    }
    std::lock_guard lock (mutex);
    inflight.erase (req.sha256);
    inflightDone.notify_all();
    if (! data)
    {
        error = decoded.error;
        return nullptr;
    }
    auto& entry = entries[req.sha256];
    if (entry.data)
        graveyard.push_back (entry.data); // replaced (another rate); freed once unused
    entry.data = data;
    entry.lastUsed = ++clock;
    evictLocked();
    return data;
}

void SampleStore::loadSet (const juce::String& pinName, std::vector<LoadRequest> requests, Progress onProgress, Done onDone)
{
    size_t estimate = 0;
    for (const auto& r : requests)
        estimate += (size_t) std::ceil (r.estimatedDurationSec * target.load()) * (size_t) std::max (1, r.estimatedChannels) * sizeof (float);
    {
        std::lock_guard lock (mutex);
        const auto others = [&]
        {
            std::set<juce::String> hashes;
            for (const auto& [name, set] : pins)
                if (name != pinName)
                    hashes.insert (set.begin(), set.end());
            size_t n = 0;
            for (const auto& h : hashes)
                if (const auto it = entries.find (h); it != entries.end())
                    n += it->second.data->bytes();
            return n;
        }();
        if (others + estimate > budgetBytes)
        {
            const auto mib = (estimate + 1048575) / 1048576;
            juce::StringArray errors;
            errors.add ("Kit needs " + juce::String ((int) mib) + " MiB of decoded audio; the memory limit is "
                        + juce::String ((int) (budgetBytes / 1048576)) + " MiB");
            onDone (errors);
            return;
        }
        auto& set = pins[pinName];
        set.clear();
        for (const auto& r : requests)
            set.insert (r.sha256);
    }
    struct Shared
    {
        std::mutex m;
        int done = 0, total = 0;
        juce::StringArray errors;
        Progress progress;
        Done finished;
    };
    auto shared = std::make_shared<Shared>();
    shared->total = (int) requests.size();
    shared->progress = std::move (onProgress);
    shared->finished = std::move (onDone);
    if (shared->progress)
        shared->progress (0, shared->total);
    if (requests.empty())
    {
        shared->finished ({});
        return;
    }
    for (auto& r : requests)
    {
        pool.addJob ([this, shared, r]
        {
            juce::String error;
            loadNow (r, error);
            int done = 0;
            bool last = false;
            {
                std::lock_guard lock (shared->m);
                if (error.isNotEmpty())
                    shared->errors.add (r.file.getFileName() + ": " + error);
                done = ++shared->done;
                last = done == shared->total;
            }
            if (shared->progress)
                shared->progress (done, shared->total);
            if (last)
                shared->finished (shared->errors);
        });
    }
}

void SampleStore::unpin (const juce::String& name)
{
    std::lock_guard lock (mutex);
    pins.erase (name);
    evictLocked();
}

void SampleStore::movePin (const juce::String& from, const juce::String& to)
{
    std::lock_guard lock (mutex);
    auto it = pins.find (from);
    if (it == pins.end())
    {
        pins.erase (to);
    }
    else
    {
        auto set = std::move (it->second);
        pins.erase (it);
        pins[to] = std::move (set);
    }
    evictLocked();
}

void SampleStore::addToPin (const juce::String& name, const juce::String& sha)
{
    std::lock_guard lock (mutex);
    pins[name].insert (sha);
}

size_t SampleStore::usedBytes() const
{
    std::lock_guard lock (mutex);
    size_t n = 0;
    for (const auto& [_, e] : entries)
        n += e.data->bytes();
    return n;
}

size_t SampleStore::pinnedBytes (const juce::String& exclude) const
{
    std::lock_guard lock (mutex);
    std::set<juce::String> hashes;
    for (const auto& [name, set] : pins)
        if (name != exclude)
            hashes.insert (set.begin(), set.end());
    size_t n = 0;
    for (const auto& h : hashes)
        if (const auto it = entries.find (h); it != entries.end())
            n += it->second.data->bytes();
    return n;
}

bool SampleStore::isPinnedLocked (const juce::String& sha) const
{
    for (const auto& [_, set] : pins)
        if (set.count (sha) > 0)
            return true;
    return false;
}

void SampleStore::evictLocked()
{
    size_t used = 0;
    for (const auto& [_, e] : entries)
        used += e.data->bytes();
    if (used <= budgetBytes)
        return;
    std::vector<std::pair<juce::uint64, juce::String>> candidates;
    for (const auto& [sha, e] : entries)
        if (! isPinnedLocked (sha))
            candidates.emplace_back (e.lastUsed, sha);
    std::sort (candidates.begin(), candidates.end());
    for (const auto& [_, sha] : candidates)
    {
        if (used <= budgetBytes)
            break;
        auto it = entries.find (sha);
        used -= it->second.data->bytes();
        graveyard.push_back (std::move (it->second.data));
        entries.erase (it);
    }
}

void SampleStore::collectGarbage()
{
    std::vector<std::shared_ptr<SampleData>> dead;
    {
        std::lock_guard lock (mutex);
        for (auto it = graveyard.begin(); it != graveyard.end();)
        {
            if (it->use_count() == 1 && (*it)->voiceRefs.load() == 0)
            {
                dead.push_back (std::move (*it));
                it = graveyard.erase (it);
            }
            else
            {
                ++it;
            }
        }
    }
    // `dead` is freed here, outside the lock.
}

size_t SampleStore::pendingGarbage() const
{
    std::lock_guard lock (mutex);
    return graveyard.size();
}

void SampleStore::waitIdle()
{
    while (pool.getNumJobs() > 0)
        juce::Thread::sleep (2);
}
} // namespace drums
