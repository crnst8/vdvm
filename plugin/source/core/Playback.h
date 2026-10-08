// The realtime instrument: immutable playback snapshots built on the message
// thread, handed to the audio thread without locks, plus the per-block
// processing that merges sequencer steps, MIDI notes and pad auditions into
// the voice engine at sample offsets.
//
// Event order at one frame: sequencer steps, then incoming MIDI, then
// auditions. A closed hat chokes only open hats that started earlier, so hits
// at the same frame layer whatever their source.
#pragma once

#include "DrumEngine.h"
#include "MidiMap.h"
#include "Pattern.h"
#include "StepSequencer.h"
#include "Timing.h"

#include <juce_audio_basics/juce_audio_basics.h>
#include <atomic>
#include <memory>
#include <mutex>
#include <optional>
#include <vector>

namespace drums
{
inline constexpr int automatablePads = 16;

struct PlaybackSlot
{
    juce::String id;
    HatRole hat = HatRole::none;
    const SampleData* sample = nullptr; // null: missing or not loaded; the slot is silent
    double normalisationDb = 0;
    double gainDb = 0; // track gain, -inf = off (pads beyond the automatable ones)
    std::array<bool, steps> on {};
    std::array<double, steps> levelDb {}; // 40 log10(level); -inf for level 0
    std::array<int, steps> stepPitchCents {};
};

struct PlaybackSnapshot
{
    uint32_t kitTag = 0;
    juce::String kitId, machineId;
    std::vector<PlaybackSlot> slots;
    std::array<int, 128> slotForNote {};
    int length = 16;
    int swingGrid = 16;
    bool circuit = false;
    const CircuitProfile* circuitProfile = nullptr; // null unless circuit timing applies
    /** Kit changed while playing: take effect at the next step 1. */
    bool applyAtBar = false;
    std::vector<SamplePtr> owned; // keeps sample data alive while this snapshot exists
};
using SnapshotPtr = std::shared_ptr<const PlaybackSnapshot>;

/** Build a snapshot from a pattern bound to `kit`, with sample data from `store` (missing data = silent slot). */
SnapshotPtr buildSnapshot (const PatternState& pattern, const KitManifest& kit, uint32_t kitTag, const MidiMap& midi,
                           const std::function<SamplePtr (const Sample&)>& dataFor, bool applyAtBar);

/**
 * Lock-free handoff of snapshots to the audio thread. publish() and collect()
 * run on the message thread; the audio thread calls acquire() once per block
 * inside beginBlock()/endBlock(). A retired snapshot is destroyed only after
 * the audio thread has provably stopped using it.
 */
class SnapshotExchange
{
public:
    void publish (SnapshotPtr next);
    void collect();
    SnapshotPtr latest() const;

    // audio thread
    void beginBlock();
    const PlaybackSnapshot* published() const { return next.load (std::memory_order_acquire); }
    void reportInUse (const PlaybackSnapshot* current, const PlaybackSnapshot* pending);
    void endBlock();

private:
    struct Retired
    {
        SnapshotPtr snapshot;
        juce::uint64 epoch;
    };
    std::atomic<const PlaybackSnapshot*> next { nullptr };
    std::atomic<const PlaybackSnapshot*> inUseCurrent { nullptr }, inUsePending { nullptr };
    std::atomic<bool> inProcess { false };
    std::atomic<juce::uint64> blocks { 0 };
    // message thread only
    mutable std::mutex mutex;
    SnapshotPtr owner;
    std::vector<Retired> retired;
};

/** Values read from host parameters every block (automation applies sample-block accurately). */
struct LiveParams
{
    double bpm = 120;      // free-run tempo
    double swing = 50;
    int pitchCents = 0;
    double outputDb = 0;
    bool hostSync = true;  // HOST tempo mode: follow the host's transport and tempo; FREE: own tempo, host transport ignored
    bool run = false;      // free-run ON/OFF
    std::array<double, automatablePads> padGainDb {};
};

struct HostPosition
{
    bool valid = false;  // ppq is known
    bool playing = false;
    bool hasBpm = false; // the host reports a tempo (also while stopped, in most hosts)
    double ppq = 0;
    double bpm = 120;
};

struct Audition
{
    int slotIndex = -1;
    int step = -1; // -1 = the drum at its track volume
    uint32_t kitTag = 0;
};

class Instrument
{
public:
    Instrument();

    void prepare (double sampleRate, int maxBlock);
    void reset();

    SnapshotExchange& snapshots() { return exchange; }
    /** Message thread: queue a pad audition (lock-free, dropped when the queue is full). */
    void queueAudition (const Audition& a);
    /**
     * Message thread: play imported audio before it belongs to a kit. The caller keeps the data
     * alive until previewsConsumed >= seq and its voiceRefs is 0.
     */
    void queuePreview (const SampleData* data, juce::uint64 seq);
    std::atomic<juce::uint64> previewsConsumed { 0 };

    /** Seed for circuit jitter (deterministic renders and tests). */
    void setJitterSeed (juce::uint64 seed) { jitterSeed = seed; }

    /** Audio thread. Adds to `left`/`right` (cleared by the caller). */
    void process (float* left, float* right, int numFrames, const HostPosition& host, const LiveParams& params,
                  const juce::MidiBuffer& midi);

    // Telemetry for the UI (read on the message thread).
    std::atomic<int> currentStep { -1 };
    std::atomic<bool> playing { false };
    std::atomic<bool> followingHost { false };
    std::atomic<uint32_t> committedKitTag { 0 };
    std::atomic<int> voices { 0 };
    /** Tempo the host reports, 0 when it reports none. */
    std::atomic<double> hostTempo { 0.0 };

    DrumEngine& engine() { return voiceEngine; }

private:
    void triggerSlot (const PlaybackSnapshot& s, int slotIndex, int step, juce::int64 when, double extraDb, double pitchOverride,
                      bool usePitchOverride, const LiveParams& params);
    double trackGain (const PlaybackSnapshot& s, int slotIndex, const LiveParams& params) const;
    void commit (const PlaybackSnapshot* s, juce::int64 at);

    SnapshotExchange exchange;
    DrumEngine voiceEngine;
    StepSequencer sequencer;
    const PlaybackSnapshot* current = nullptr;
    const PlaybackSnapshot* pending = nullptr;
    const PlaybackSnapshot* lastSeen = nullptr;
    double rate = 48000;
    double freePpq = 0;
    bool wasRunning = false;
    bool wasHostDriven = false;
    juce::uint64 jitterSeed = 1;
    std::optional<StepJitter> jitter; // in place: no allocation on the audio thread
    const CircuitProfile* jitterFor = nullptr;

    juce::AbstractFifo auditionFifo { 64 };
    std::array<Audition, 64> auditions {};
    struct Preview
    {
        const SampleData* data = nullptr;
        juce::uint64 seq = 0;
    };
    juce::AbstractFifo previewFifo { 16 };
    std::array<Preview, 16> previewQueue {};
};
} // namespace drums
