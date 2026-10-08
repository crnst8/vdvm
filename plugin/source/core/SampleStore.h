// Decoded sample cache keyed by content hash (port of src/audio/buffers.ts).
// Worker threads read, verify, decode, measure loudness and resample; the
// audio thread only ever sees completed, immutable SampleData through
// playback snapshots. Memory is bounded by a configurable budget with named
// pin sets (active, staging). Evicted data is freed on a non-audio thread only
// after no snapshot and no sounding voice refers to it.
#pragma once

#include "Loudness.h"

#include <juce_audio_formats/juce_audio_formats.h>
#include <atomic>
#include <condition_variable>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <set>

namespace drums
{
struct SampleData
{
    juce::String sha256;
    juce::AudioBuffer<float> pcm; // at `rate`
    double rate = 48000;
    double sourceRate = 48000;
    HitLevel level;
    double normalisationDb = 0;
    /** Voices currently playing this data (audio thread increments/decrements). */
    mutable std::atomic<int> voiceRefs { 0 };

    size_t bytes() const { return (size_t) pcm.getNumSamples() * (size_t) pcm.getNumChannels() * sizeof (float); }
    double durationSec() const { return pcm.getNumSamples() / rate; }
};
using SamplePtr = std::shared_ptr<const SampleData>;

struct LoadRequest
{
    juce::String sha256;          // identity and cache key
    juce::File file;              // where to read it
    bool verifyHash = true;       // check the file bytes against sha256
    double estimatedDurationSec = 0;
    int estimatedChannels = 2;
};

/** Limits for anything decoded (catalog v1 values). */
struct DecodeLimits
{
    juce::int64 maxFileBytes = 512ll * 1024 * 1024;
    double maxDurationSec = 60;
    int maxChannels = 2;
    double minRate = 8000, maxRate = 192000;
};

/** Read, verify and decode one file. Empty pcm and `error` set on failure. */
struct Decoded
{
    juce::AudioBuffer<float> pcm;
    double rate = 0;
    juce::String formatName;
    juce::String error;
};
Decoded decodeAudioFile (const juce::File& file, const juce::String& expectedSha256, const DecodeLimits& limits = {});
Decoded decodeAudioData (const void* data, size_t size, const juce::String& nameForFormat, const DecodeLimits& limits = {});

/** The audio formats the plugin reads (WAV, AIFF, FLAC). */
juce::AudioFormatManager& audioFormats();

/** Process-wide loudness cache keyed by sha256 + algorithm version; persisted to a JSON file when set. */
class LoudnessCache
{
public:
    static LoudnessCache& instance();
    void setFile (const juce::File& file);
    std::optional<HitLevel> get (const juce::String& sha);
    void put (const juce::String& sha, const HitLevel& level);
    void flush();

private:
    std::mutex mutex;
    juce::File file;
    std::map<juce::String, HitLevel> levels;
    int unsaved = 0;
};

class SampleStore
{
public:
    static constexpr size_t defaultBudgetBytes = 768ull * 1024 * 1024;

    explicit SampleStore (size_t budgetBytes = defaultBudgetBytes, int threads = 2);
    ~SampleStore();

    void setTargetRate (double rate);
    double targetRate() const { return target.load(); }
    size_t budget() const { return budgetBytes; }
    void setBudget (size_t bytes);

    /** Ready data for `sha256` at the current target rate, or null. Not for the audio thread. */
    SamplePtr get (const juce::String& sha256) const;
    bool has (const juce::String& sha256) const { return get (sha256) != nullptr; }

    using Progress = std::function<void (int done, int total)>;
    using Done = std::function<void (const juce::StringArray& errors)>;

    /**
     * Load and pin a named set. Rejects up front when the estimate cannot fit beside
     * other pinned sets. Callbacks run on a worker thread.
     */
    void loadSet (const juce::String& pinName, std::vector<LoadRequest> requests, Progress onProgress, Done onDone);

    /** Synchronous load on the calling thread (workers, export, tests). */
    SamplePtr loadNow (const LoadRequest& request, juce::String& error);

    void unpin (const juce::String& name);
    void movePin (const juce::String& from, const juce::String& to);
    void addToPin (const juce::String& name, const juce::String& sha256);

    size_t usedBytes() const;
    size_t pinnedBytes (const juce::String& excludePin = {}) const;

    /** Free evicted data that nothing refers to any more. Call from a non-audio thread. */
    void collectGarbage();
    size_t pendingGarbage() const;

    /** Wait until queued loads finish (tests, shutdown). */
    void waitIdle();

private:
    struct Entry
    {
        std::shared_ptr<SampleData> data;
        mutable juce::uint64 lastUsed = 0;
    };

    void evictLocked();
    bool isPinnedLocked (const juce::String& sha) const;

    mutable std::mutex mutex;
    std::condition_variable inflightDone;
    std::map<juce::String, Entry> entries;
    std::set<juce::String> inflight;
    std::map<juce::String, std::set<juce::String>> pins;
    std::vector<std::shared_ptr<SampleData>> graveyard;
    mutable juce::uint64 clock = 0;
    std::atomic<double> target { 48000.0 };
    size_t budgetBytes;
    juce::ThreadPool pool;
};
} // namespace drums
